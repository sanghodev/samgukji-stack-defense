import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { BANDIT_COMBAT_CONFIG, CombatTuning } from '../config/combatConfig';
import {
  ArchetypeSpec,
  BANDIT_ARCHETYPES,
  BanditArchetype,
  Step4Tuning,
} from '../config/step4Config';
import {
  AirborneBodyState,
  check25DMeleeHit,
  CombatHitTracker,
  MeleeTargetHurtbox,
  stepAirbornePhysics,
} from '../core/CombatMath';
import {
  classifyFearState,
  computeFearGain,
  evaluateRunningTrip,
  FearState,
} from '../core/FearAndGagMath';
import type { ChainReactionTier } from '../core/MayhemPhysics';
import {
  clampToArena,
  getDepthOrder,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';
import { CombatCoordinator } from '../systems/CombatCoordinator';
import type { EnvironmentalObject } from './EnvironmentalObject';

export type BanditState =
  | 'IDLE'
  | 'APPROACH'
  | 'ATTACK_WINDUP'
  | 'ATTACK_ACTIVE'
  | 'ATTACK_RECOVERY'
  | 'HURT'
  | 'KNOCKBACK'
  | 'KNOCKDOWN'
  | 'RECOVER'
  | 'FLEE'
  | 'MOVING_TO_COVER'
  | 'HIDING'
  | 'PEEKING'
  | 'SURRENDERED'
  | 'CAMERA_GAGGED'
  | 'DEFEATED';

export interface BanditHitRequest {
  damage: number;
  dirX: number;
  dirY: number;
  knockbackForce: number;
  launchVz: number;
  isHeavy: boolean;
}

export interface BanditCallbacks {
  onAttackWhoosh: () => void;
  onHitPlayer: (damage: number, dirX: number, dirY: number) => void;
  onLanded: (bandit: Bandit, impactSpeed: number) => void;
  onDefeated: (bandit: Bandit) => void;
  onPanic: (bandit: Bandit) => void;
  onTrip: (bandit: Bandit) => void;
  onHide: (bandit: Bandit) => void;
  onPeek: (bandit: Bandit) => void;
  onSurrender: (bandit: Bandit) => void;
  onTryCameraGag: (bandit: Bandit, launchSpeed: number, vy: number) => boolean;
}

/**
 * Cute 2-head-tall bandit with 6 data-driven comedic personalities,
 * fear/panic hysteresis, fleeing, running trips, cover hiding/peeking,
 * surrendering, and rare camera-glass gag integration.
 */
export class Bandit {
  public readonly id: string;
  public readonly slotIndex: number;
  public readonly archetype: BanditArchetype;
  public readonly spec: ArchetypeSpec;
  public readonly collisionRadius = BANDIT_COMBAT_CONFIG.collisionRadius;
  public readonly mass: number;
  public readonly container: Phaser.GameObjects.Container;

  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public vx = 0;
  public vy = 0;
  public elevationZ = 0;
  public vz = 0;
  public hp: number;
  public maxHp: number;
  public state: BanditState = 'IDLE';
  public readyForRemoval = false;

  // Step 3 Mayhem Physics
  public chainDepth = 0;
  public chainCooldownMs = 0;
  public slipImmunityMs = 0;
  public isSlipping = false;

  // Step 4 Fear, Cover & Comedic AI
  public fear = 0;
  public fearState: FearState = 'CALM';
  public coverObject: EnvironmentalObject | null = null;
  public tripImmunityMs = 0;
  public hasBeenCameraGagged = false;

  private readonly scene: Phaser.Scene;
  private readonly tuning: CombatTuning;
  private readonly step4: Step4Tuning;
  private readonly callbacks: BanditCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly telegraphText: Phaser.GameObjects.Text;
  private readonly reactionText: Phaser.GameObjects.Text;
  private readonly aiDebugText: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly hitTracker = new CombatHitTracker();

  private readonly baseSpriteScale: number;
  private stateTimerMs = 0;
  private walkPhase = 0;
  private flashTimerMs = 0;
  private facingDirX = -1;
  private attackDirX = -1;
  private attackDirY = 0;
  private prevMoveDirX = 0;
  private prevMoveDirY = 0;
  private tumbleSpinDir = 1;
  private defeatTriggered = false;
  private surrenderTriggered = false;
  private personalAttackCooldownMs = 0;
  private sneakyRetreatMs = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    slotIndex: number,
    archetype: BanditArchetype,
    spawnX: number,
    spawnY: number,
    tuning: CombatTuning,
    step4: Step4Tuning,
    callbacks: BanditCallbacks,
  ) {
    this.scene = scene;
    this.id = id;
    this.slotIndex = slotIndex;
    this.archetype = archetype;
    this.spec = BANDIT_ARCHETYPES[archetype];
    this.mass = this.spec.mass;
    this.baseSpriteScale = 0.56 * this.spec.scaleMul;

    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.tuning = tuning;
    this.step4 = step4;
    this.callbacks = callbacks;
    this.maxHp = Math.round(tuning.enemyMaxHp * this.spec.hpMul);
    this.hp = this.maxHp;

    this.shadow = scene.add.ellipse(
      0,
      2,
      46 * this.spec.scaleMul,
      15 * this.spec.scaleMul,
      0x1a120b,
      0.4,
    );

    // Elite uses armored frame 1; others use cute blue-uniformed bandit frame 0
    const spriteFrame = archetype === 'elite' ? 1 : 0;
    this.sprite = scene.add.sprite(0, 4, 'enemies_4types', spriteFrame);
    this.sprite.setOrigin(0.5, 0.9);
    this.sprite.setScale(this.baseSpriteScale);

    this.telegraphText = scene.add
      .text(0, -76, '!', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ef4444',
        stroke: '#1c120c',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.reactionText = scene.add
      .text(0, -72, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#1c120c',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.aiDebugText = scene.add
      .text(0, -90, '', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '10px',
        color: this.spec.badgeColor,
        backgroundColor: 'rgba(11,16,27,0.75)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.hpBarBg = scene.add.rectangle(0, -64, 46, 6, 0x1c120c, 0.85).setVisible(false);
    this.hpBarFill = scene.add
      .rectangle(-22, -64, 44, 4, archetype === 'elite' ? 0xf59e0b : 0xef4444, 1)
      .setOrigin(0, 0.5)
      .setVisible(false);

    this.container = scene.add.container(this.x, this.y, [
      this.shadow,
      this.sprite,
      this.hpBarBg,
      this.hpBarFill,
      this.telegraphText,
      this.reactionText,
      this.aiDebugText,
    ]);

    this.state = 'APPROACH';
    this.personalAttackCooldownMs = 550 + slotIndex * 140;
    this.syncVisuals();
  }

  public get isAlive(): boolean {
    return this.state !== 'DEFEATED' && this.hp > 0;
  }

  /** Neutralized enemies (defeated OR surrendered) count toward stage clear without forcing harm. */
  public get isNeutralized(): boolean {
    return this.state === 'DEFEATED' || this.state === 'SURRENDERED';
  }

  public get isVulnerable(): boolean {
    return (
      this.state !== 'DEFEATED' &&
      this.state !== 'KNOCKDOWN' &&
      this.state !== 'RECOVER' &&
      this.state !== 'CAMERA_GAGGED'
    );
  }

  public get groundSpeed(): number {
    return Math.hypot(this.vx, this.vy / PERSPECTIVE_CONFIG.verticalMoveRatio);
  }

  public get isChainProjectile(): boolean {
    return (
      (this.state === 'KNOCKBACK' || this.state === 'HURT' || this.state === 'DEFEATED') &&
      this.groundSpeed >= 130
    );
  }

  public get canSlipNow(): boolean {
    return (
      (this.state === 'APPROACH' || this.state === 'FLEE' || this.state === 'MOVING_TO_COVER') &&
      this.slipImmunityMs <= 0 &&
      this.elevationZ <= 0 &&
      !this.isSlipping
    );
  }

  public get effectivePanicThreshold(): number {
    return Phaser.Math.Clamp(
      this.spec.panicThreshold + this.step4.panicThresholdOffset,
      18,
      98,
    );
  }

  public get effectiveSurrenderThreshold(): number {
    if (this.spec.surrenderThreshold > 100) return 101;
    return Phaser.Math.Clamp(
      this.spec.surrenderThreshold + this.step4.surrenderThresholdOffset,
      40,
      99,
    );
  }

  public getHurtbox(): MeleeTargetHurtbox {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      radius: this.collisionRadius,
      elevationZ: this.elevationZ,
      vulnerable: this.isVulnerable,
    };
  }

  public syncMaxHpFromTuning(): void {
    const newMax = Math.max(10, Math.round(this.tuning.enemyMaxHp * this.spec.hpMul));
    if (newMax !== this.maxHp && this.isAlive) {
      const ratio = this.hp / Math.max(1, this.maxHp);
      this.maxHp = newMax;
      this.hp = Math.max(1, Math.round(this.maxHp * ratio));
      this.updateHpBar();
    }
  }

  /**
   * Event-driven fear increase (Zhang Fei roar, charge, ally launched, heavy smash, etc.).
   */
  public addFear(baseAmount: number, coordinator: CombatCoordinator): void {
    if (this.isNeutralized || this.state === 'CAMERA_GAGGED') return;

    const effCourage = Phaser.Math.Clamp(
      this.spec.courage * this.step4.enemyCourageMultiplier,
      5,
      100,
    );
    const delta = computeFearGain(
      baseAmount,
      this.spec.fearSensitivity,
      this.step4.fearGainMultiplier,
      effCourage,
    );
    this.fear = Phaser.Math.Clamp(this.fear + delta, 0, 100);
    const prev = this.fearState;
    this.fearState = classifyFearState(this.fear, prev, this.effectivePanicThreshold);

    // Transition immediately into panic/flee if standing/approaching!
    if (
      (this.fearState === 'PANICKING' || this.fearState === 'TERRIFIED') &&
      (this.state === 'IDLE' || this.state === 'APPROACH' || this.state === 'ATTACK_WINDUP')
    ) {
      coordinator.releaseAttackToken(this.id);
      this.telegraphText.setVisible(false);
      this.enterPanicState();
    }
  }

  public forcePanic(coordinator: CombatCoordinator): void {
    if (this.isNeutralized || this.state === 'CAMERA_GAGGED') return;
    this.fear = 92;
    this.fearState = 'TERRIFIED';
    coordinator.releaseAttackToken(this.id);
    this.telegraphText.setVisible(false);
    this.enterPanicState();
  }

  public resetAiState(coordinator: CombatCoordinator): void {
    if (this.state === 'DEFEATED' || this.state === 'CAMERA_GAGGED') return;
    coordinator.releaseAttackToken(this.id);
    this.releaseCurrentCover();
    this.fear = 0;
    this.fearState = 'CALM';
    this.surrenderTriggered = false;
    this.state = 'APPROACH';
    this.reactionText.setVisible(false);
    this.telegraphText.setVisible(false);
  }

  public onCoverDestroyed(coordinator: CombatCoordinator): void {
    if (!this.coverObject) return;
    this.coverObject = null;
    if (this.state === 'HIDING' || this.state === 'PEEKING' || this.state === 'MOVING_TO_COVER') {
      this.addFear(28, coordinator);
      this.reactionText.setText('들켰다!!');
      this.reactionText.setColor('#fb923c');
      this.reactionText.setVisible(true);
      this.state = 'FLEE';
      this.stateTimerMs = 1500;
      this.callbacks.onPanic(this);
    }
  }

  public takeHit(hit: BanditHitRequest, coordinator: CombatCoordinator): boolean {
    if (!this.isVulnerable) return false;

    coordinator.releaseAttackToken(this.id);
    this.releaseCurrentCover();
    this.telegraphText.setVisible(false);
    this.isSlipping = false;
    this.chainDepth = 0;

    const dmg = Math.max(1, Math.round(hit.damage));
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimerMs = 95;
    this.updateHpBar();

    // Receiving a powerful hit generates fear (especially for overconfident & cowards!)
    const hitFear = hit.isHeavy ? 32 : 12;
    this.fear = Phaser.Math.Clamp(
      this.fear +
        computeFearGain(
          hitFear,
          this.spec.fearSensitivity,
          this.step4.fearGainMultiplier,
          this.spec.courage * this.step4.enemyCourageMultiplier,
        ),
      0,
      100,
    );
    this.fearState = classifyFearState(this.fear, this.fearState, this.effectivePanicThreshold);

    const len = Math.hypot(hit.dirX, hit.dirY) || 1;
    const nx = hit.dirX / len;
    const ny = hit.dirY / len;

    // Heavier mass (Elite) resists knockback slightly
    const massResist = 1 / Math.max(0.8, this.mass);
    const kb = hit.knockbackForce * this.tuning.knockbackMultiplier * massResist;
    this.vx = nx * kb;
    this.vy = ny * kb * PERSPECTIVE_CONFIG.verticalMoveRatio;
    this.tumbleSpinDir = nx >= 0 ? 1 : -1;
    this.facingDirX = -nx;

    // Check rare Camera-Glass Collision Gag on exceptional foreground launches!
    if (
      (hit.isHeavy || hit.launchVz >= 240) &&
      this.spec.cameraGagEligible &&
      !this.hasBeenCameraGagged
    ) {
      const launchSpd = this.groundSpeed;
      if (this.callbacks.onTryCameraGag(this, launchSpd, this.vy)) {
        this.hasBeenCameraGagged = true;
        this.state = 'CAMERA_GAGGED';
        this.container.setVisible(false);
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.elevationZ = 0;
        return true;
      }
    }

    if (this.hp <= 0) {
      this.enterDefeated(hit.launchVz > 0 ? hit.launchVz : 240);
      return true;
    }

    if (hit.launchVz > 0 || hit.isHeavy) {
      this.state = 'KNOCKBACK';
      this.vz = Math.max(200, hit.launchVz * Math.sqrt(this.tuning.knockbackMultiplier) * massResist);
      this.elevationZ = Math.max(this.elevationZ, 4);
      this.stateTimerMs = 900;
      this.reactionText.setText(hit.isHeavy ? '악!!' : '으악!');
      this.reactionText.setColor(hit.isHeavy ? '#fde047' : '#7dd3fc');
      this.reactionText.setVisible(true);
    } else {
      this.state = 'HURT';
      this.stateTimerMs = BANDIT_COMBAT_CONFIG.hurtDurationMs;
      this.reactionText.setText('헉!');
      this.reactionText.setColor('#ffffff');
      this.reactionText.setVisible(true);
    }

    return true;
  }

  /**
   * Called by CameraGagController after the screen-glass slide finishes.
   * Cleanly resolves the single authoritative world bandit (no duplicate entities!).
   */
  public resolveAfterCameraGag(): void {
    if (this.state !== 'CAMERA_GAGGED') return;
    this.container.setVisible(true);
    const clamped = clampToArena(this.x, Math.max(this.y, 620), this.collisionRadius);
    this.x = clamped.x;
    this.y = clamped.y;

    if (this.hp <= 0) {
      this.enterDefeated(80);
    } else {
      this.state = 'KNOCKDOWN';
      this.stateTimerMs = BANDIT_COMBAT_CONFIG.knockdownDurationMs;
      this.reactionText.setText('★ @ ★');
      this.reactionText.setColor('#fde047');
      this.reactionText.setVisible(true);
    }
    this.syncVisuals();
  }

  public applyChainImpulse(
    tier: ChainReactionTier,
    vx: number,
    vy: number,
    launchVz: number,
    damage: number,
    nextChainDepth: number,
    coordinator: CombatCoordinator,
  ): boolean {
    if (!this.isVulnerable || this.chainCooldownMs > 0 || tier === 'NONE') {
      return false;
    }

    coordinator.releaseAttackToken(this.id);
    this.releaseCurrentCover();
    this.telegraphText.setVisible(false);
    this.isSlipping = false;
    this.chainDepth = nextChainDepth;
    this.chainCooldownMs = 260;
    this.flashTimerMs = 85;

    this.hp = Math.max(0, this.hp - Math.max(1, Math.round(damage)));
    this.updateHpBar();

    this.vx = vx;
    this.vy = vy;
    this.tumbleSpinDir = vx >= 0 ? 1 : -1;
    if (Math.abs(vx) > 8) this.facingDirX = -Math.sign(vx);

    if (this.hp <= 0) {
      this.enterDefeated(Math.max(190, launchVz));
      return true;
    }

    if (tier === 'LAUNCHED' || tier === 'KNOCKDOWN') {
      this.state = 'KNOCKBACK';
      this.vz = Math.max(165, launchVz);
      this.elevationZ = Math.max(this.elevationZ, 4);
      this.stateTimerMs = 880;
      this.reactionText.setText(tier === 'LAUNCHED' ? '도미노!!' : '으악!');
      this.reactionText.setColor('#fb923c');
      this.reactionText.setVisible(true);
    } else {
      this.state = 'HURT';
      this.stateTimerMs = tier === 'PUSHED' ? 300 : 220;
      this.reactionText.setText(tier === 'PUSHED' ? '어어!' : '헉!');
      this.reactionText.setColor('#fde047');
      this.reactionText.setVisible(true);
    }

    return true;
  }

  public triggerSlip(coordinator: CombatCoordinator): boolean {
    if (!this.canSlipNow) return false;
    return this.enterStumbleOrSlip(coordinator, true);
  }

  public triggerTrip(coordinator: CombatCoordinator): boolean {
    if (this.tripImmunityMs > 0 || this.elevationZ > 0) return false;
    return this.enterStumbleOrSlip(coordinator, false);
  }

  private enterStumbleOrSlip(coordinator: CombatCoordinator, isSlip: boolean): boolean {
    coordinator.releaseAttackToken(this.id);
    this.releaseCurrentCover();
    this.telegraphText.setVisible(false);
    this.isSlipping = isSlip;
    this.slipImmunityMs = 2400;
    this.tripImmunityMs = 3000;

    const spd = Math.max(155, this.groundSpeed * (isSlip ? 1.45 : 1.15));
    const len = Math.hypot(this.vx, this.vy) || 1;
    const nx = this.vx / len;
    const ny = this.vy / len;

    this.vx = nx * spd;
    this.vy = ny * spd;
    this.vz = isSlip ? 155 : 120;
    this.elevationZ = 5;
    // Slip flips backward; trip pitches forward onto face!
    this.tumbleSpinDir = isSlip ? (nx >= 0 ? -1 : 1) : nx >= 0 ? 1 : -1;
    this.state = 'KNOCKBACK';
    this.stateTimerMs = 740;

    this.reactionText.setText(isSlip ? '미끄덩!' : '꽈당!');
    this.reactionText.setColor(isSlip ? '#38bdf8' : '#fb923c');
    this.reactionText.setVisible(true);
    if (!isSlip) {
      this.callbacks.onTrip(this);
    }
    return true;
  }

  public update(
    deltaMs: number,
    playerX: number,
    playerY: number,
    playerAlive: boolean,
    coordinator: CombatCoordinator,
    otherBandits: Bandit[],
    envObjects: EnvironmentalObject[],
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    if (this.state === 'CAMERA_GAGGED') return;

    const dt = Math.min(deltaMs, 50) * 0.001;
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.flashTimerMs > 0) this.flashTimerMs = Math.max(0, this.flashTimerMs - deltaMs);
    if (this.personalAttackCooldownMs > 0) this.personalAttackCooldownMs = Math.max(0, this.personalAttackCooldownMs - deltaMs);
    if (this.chainCooldownMs > 0) this.chainCooldownMs = Math.max(0, this.chainCooldownMs - deltaMs);
    if (this.slipImmunityMs > 0) this.slipImmunityMs = Math.max(0, this.slipImmunityMs - deltaMs);
    if (this.tripImmunityMs > 0) this.tripImmunityMs = Math.max(0, this.tripImmunityMs - deltaMs);
    if (this.sneakyRetreatMs > 0) this.sneakyRetreatMs = Math.max(0, this.sneakyRetreatMs - deltaMs);

    // Passive fear decay when hiding or far from hero, plus elite ally rally bonus
    if (!this.isNeutralized && this.fear > 0) {
      const distHero = Math.hypot(playerX - this.x, (playerY - this.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      let decay = distHero > 220 ? 5.5 : 1.8;
      if (this.state === 'HIDING') decay += 4.5;
      // Elite ally nearby rallies cowardly bandits!
      for (const other of otherBandits) {
        if (other !== this && other.isAlive && other.archetype === 'elite') {
          if (Math.hypot(other.x - this.x, other.y - this.y) < 160) {
            decay += 6.5;
            break;
          }
        }
      }
      this.fear = Math.max(0, this.fear - decay * dt);
      this.fearState = classifyFearState(this.fear, this.fearState, this.effectivePanicThreshold);
    }

    const usesPhysics =
      this.state === 'HURT' ||
      this.state === 'KNOCKBACK' ||
      this.state === 'KNOCKDOWN' ||
      this.state === 'DEFEATED';

    if (usesPhysics) {
      const body: AirborneBodyState = {
        x: this.x,
        y: this.y,
        vx: this.vx,
        vy: this.vy,
        elevationZ: this.elevationZ,
        vz: this.vz,
      };
      const step = stepAirbornePhysics(
        body,
        dt,
        BANDIT_COMBAT_CONFIG.gravity,
        BANDIT_COMBAT_CONFIG.groundFriction,
        BANDIT_COMBAT_CONFIG.airDrag,
      );
      this.x = body.x;
      this.y = body.y;
      this.vx = body.vx;
      this.vy = body.vy;
      this.elevationZ = body.elevationZ;
      this.vz = body.vz;

      if (step.landed) {
        this.callbacks.onLanded(this, step.impactSpeed);
        if (this.state === 'KNOCKBACK') {
          this.state = 'KNOCKDOWN';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.knockdownDurationMs;
          this.reactionText.setText('★ @ ★');
          this.reactionText.setColor('#fde047');
          this.reactionText.setVisible(true);
        }
      }
    }

    switch (this.state) {
      case 'IDLE': {
        this.reactionText.setVisible(false);
        this.telegraphText.setVisible(false);
        if (playerAlive) this.state = 'APPROACH';
        break;
      }

      case 'APPROACH': {
        this.reactionText.setVisible(false);
        this.telegraphText.setVisible(false);
        if (!playerAlive) {
          this.state = 'IDLE';
          break;
        }

        // Check if panic/surrender threshold crossed
        if (this.fearState === 'PANICKING' || this.fearState === 'TERRIFIED') {
          this.enterPanicState();
          break;
        }

        const flank = coordinator.getFlankOffset(this.slotIndex);
        // Sneaky bandits try to circle behind the player's back
        const ox = this.archetype === 'sneaky' ? -flank.ox * 1.15 : flank.ox;
        const oy = this.archetype === 'sneaky' ? -Math.abs(flank.oy) : flank.oy;
        const goalX = playerX + ox;
        const goalY = playerY + oy;
        const dxGoal = goalX - this.x;
        const dyGoal = goalY - this.y;
        const distGoal = Math.hypot(dxGoal, dyGoal);

        const sep = this.computeSeparation(otherBandits);
        const speedFactor = getDepthSpeedFactor(this.y);
        const moveSpd = this.tuning.enemyMoveSpeed * speedFactor * this.spec.aggression;

        if (distGoal > 14) {
          this.vx = (dxGoal / distGoal) * moveSpd + sep.x;
          this.vy = (dyGoal / distGoal) * moveSpd * PERSPECTIVE_CONFIG.verticalMoveRatio + sep.y;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          this.walkPhase += dt * 11;
        } else {
          this.vx = sep.x * 0.5;
          this.vy = sep.y * 0.5;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
        }

        // Clumsy bandits can occasionally stumble if turning sharply while running!
        if (this.checkRunningTrip(dt, false, coordinator)) break;

        const toPlayerX = playerX - this.x;
        const toPlayerY = playerY - this.y;
        const distPlayer = Math.hypot(toPlayerX, toPlayerY / PERSPECTIVE_CONFIG.verticalMoveRatio);
        if (Math.abs(toPlayerX) > 4) this.facingDirX = Math.sign(toPlayerX);

        if (
          distPlayer <= BANDIT_COMBAT_CONFIG.attackRange + 14 &&
          this.personalAttackCooldownMs <= 0 &&
          coordinator.requestAttackToken(this.id)
        ) {
          const dLen = Math.hypot(toPlayerX, toPlayerY) || 1;
          this.attackDirX = toPlayerX / dLen;
          this.attackDirY = toPlayerY / dLen;
          this.vx = 0;
          this.vy = 0;
          this.state = 'ATTACK_WINDUP';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.attackWindupMs;
          this.telegraphText.setVisible(true);
        }
        break;
      }

      case 'ATTACK_WINDUP': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.telegraphText.setVisible(false);
          this.state = 'ATTACK_ACTIVE';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.attackActiveMs;
          this.hitTracker.beginAttack();
          this.callbacks.onAttackWhoosh();
        }
        break;
      }

      case 'ATTACK_ACTIVE': {
        this.stateTimerMs -= deltaMs;
        const scale = getPerspectiveScale(this.y);
        this.x += this.attackDirX * 95 * scale * dt;
        this.y += this.attackDirY * 95 * PERSPECTIVE_CONFIG.verticalMoveRatio * scale * dt;

        if (playerAlive && this.hitTracker.canHit('player')) {
          const res = check25DMeleeHit(
            {
              originX: this.x,
              originY: this.y,
              dirX: this.attackDirX,
              dirY: this.attackDirY,
              range: BANDIT_COMBAT_CONFIG.attackRange,
              halfWidth: BANDIT_COMBAT_CONFIG.attackHalfWidth,
              verticalRatio: PERSPECTIVE_CONFIG.verticalMoveRatio,
            },
            {
              id: 'player',
              x: playerX,
              y: playerY,
              radius: 18,
              elevationZ: 0,
              vulnerable: true,
            },
          );
          if (res.hit) {
            this.hitTracker.recordHit('player');
            this.callbacks.onHitPlayer(
              BANDIT_COMBAT_CONFIG.attackDamage * (this.archetype === 'elite' ? 1.35 : 1),
              this.attackDirX,
              this.attackDirY,
            );
          }
        }

        if (this.stateTimerMs <= 0) {
          this.state = 'ATTACK_RECOVERY';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.attackRecoveryMs;
          coordinator.releaseAttackToken(this.id);
        }
        break;
      }

      case 'ATTACK_RECOVERY': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.personalAttackCooldownMs = 850 + Math.random() * 450;
          if (this.archetype === 'sneaky') {
            // Sneaky bandits dash away right after landing a hit!
            this.state = 'FLEE';
            this.stateTimerMs = 950;
          } else {
            this.state = playerAlive ? 'APPROACH' : 'IDLE';
          }
        }
        break;
      }

      case 'FLEE': {
        this.stateTimerMs -= deltaMs;

        // Check surrender condition when low HP & terrified!
        if (this.shouldSurrender(otherBandits)) {
          this.enterSurrendered(coordinator);
          break;
        }

        // Try to claim a nearby hiding cover object (table/barrel) if preferred!
        const hidePref = this.spec.hidingPreference * this.step4.hidingPreference;
        if (hidePref > 0.25 && this.coverObject === null && Math.random() < hidePref * 0.08) {
          const cover = this.findNearestCover(envObjects, playerX, playerY);
          if (cover && cover.claimCover(this.id)) {
            this.coverObject = cover;
            this.state = 'MOVING_TO_COVER';
            this.stateTimerMs = 2600;
            this.reactionText.setText('숨자!');
            this.reactionText.setColor('#7dd3fc');
            this.reactionText.setVisible(true);
            break;
          }
        }

        // Run away from hero with slight sideways local avoidance
        const awayX = this.x - playerX;
        const awayY = (this.y - playerY) / PERSPECTIVE_CONFIG.verticalMoveRatio;
        const len = Math.hypot(awayX, awayY) || 1;
        const sideSign = this.slotIndex % 2 === 0 ? 1 : -1;
        const nx = (awayX / len) * 0.8 + (-awayY / len) * 0.35 * sideSign;
        const ny = (awayY / len) * 0.8 + (awayX / len) * 0.35 * sideSign;
        const nLen = Math.hypot(nx, ny) || 1;

        const speedFactor = getDepthSpeedFactor(this.y);
        const fleeSpd =
          this.tuning.enemyMoveSpeed *
          this.spec.escapeSpeedMul *
          this.step4.fleeSpeedMultiplier *
          speedFactor;

        this.vx = (nx / nLen) * fleeSpd;
        this.vy = (ny / nLen) * fleeSpd * PERSPECTIVE_CONFIG.verticalMoveRatio;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.walkPhase += dt * 16;
        if (Math.abs(this.vx) > 5) this.facingDirX = Math.sign(this.vx);

        if (this.checkRunningTrip(dt, true, coordinator)) break;

        if (this.stateTimerMs <= 0 && this.fearState !== 'TERRIFIED') {
          this.reactionText.setVisible(false);
          this.state = playerAlive ? 'APPROACH' : 'IDLE';
        }
        break;
      }

      case 'MOVING_TO_COVER': {
        this.stateTimerMs -= deltaMs;
        if (!this.coverObject || !this.coverObject.canProvideCover) {
          this.releaseCurrentCover();
          this.state = 'FLEE';
          this.stateTimerMs = 1100;
          break;
        }

        const spot = this.coverObject.getCoverSpot();
        const dx = spot.x - this.x;
        const dy = spot.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= 16) {
          this.x = spot.x;
          this.y = spot.y;
          this.vx = 0;
          this.vy = 0;
          this.state = 'HIDING';
          this.stateTimerMs = Math.max(600, this.step4.peekIntervalMs);
          this.reactionText.setText('덜덜...');
          this.reactionText.setColor('#bae6fd');
          this.reactionText.setVisible(true);
          this.callbacks.onHide(this);
          break;
        }

        const speedFactor = getDepthSpeedFactor(this.y);
        const spd =
          this.tuning.enemyMoveSpeed *
          this.spec.escapeSpeedMul *
          this.step4.fleeSpeedMultiplier *
          speedFactor;
        this.vx = (dx / dist) * spd;
        this.vy = (dy / dist) * spd;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.walkPhase += dt * 15;
        if (Math.abs(this.vx) > 5) this.facingDirX = Math.sign(this.vx);

        if (this.checkRunningTrip(dt, true, coordinator)) break;

        if (this.stateTimerMs <= 0) {
          this.releaseCurrentCover();
          this.state = 'FLEE';
          this.stateTimerMs = 900;
        }
        break;
      }

      case 'HIDING': {
        this.stateTimerMs -= deltaMs;
        if (!this.coverObject || !this.coverObject.canProvideCover) {
          this.onCoverDestroyed(coordinator);
          break;
        }

        const spot = this.coverObject.getCoverSpot();
        this.x = spot.x;
        this.y = spot.y;
        this.vx = 0;
        this.vy = 0;

        if (this.stateTimerMs <= 0) {
          this.state = 'PEEKING';
          this.stateTimerMs = 680;
          this.reactionText.setText('슬쩍...');
          this.reactionText.setColor('#fde047');
          this.reactionText.setVisible(true);
          this.callbacks.onPeek(this);
        }
        break;
      }

      case 'PEEKING': {
        this.stateTimerMs -= deltaMs;
        if (!this.coverObject || !this.coverObject.canProvideCover) {
          this.onCoverDestroyed(coordinator);
          break;
        }

        const distHero = Math.hypot(
          playerX - this.x,
          (playerY - this.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        this.facingDirX = Math.sign(playerX - this.x) || 1;

        if (this.stateTimerMs <= 0) {
          if (distHero < 165) {
            // Danger is right here! Duck back down or panic!
            this.state = 'HIDING';
            this.stateTimerMs = Math.max(600, this.step4.peekIntervalMs * 0.8);
            this.reactionText.setText('으악!');
          } else if (this.fearState === 'CALM' || this.fearState === 'NERVOUS') {
            // Calmed down — rejoin combat!
            this.releaseCurrentCover();
            this.reactionText.setVisible(false);
            this.state = 'APPROACH';
          } else {
            this.state = 'HIDING';
            this.stateTimerMs = Math.max(600, this.step4.peekIntervalMs);
            this.reactionText.setText('덜덜...');
          }
        }
        break;
      }

      case 'SURRENDERED': {
        this.vx = 0;
        this.vy = 0;
        this.reactionText.setText('항복!!');
        this.reactionText.setColor('#fef08a');
        this.reactionText.setVisible(true);
        break;
      }

      case 'HURT': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.reactionText.setVisible(false);
          if (this.fearState === 'PANICKING' || this.fearState === 'TERRIFIED') {
            this.enterPanicState();
          } else {
            this.state = playerAlive ? 'APPROACH' : 'IDLE';
          }
        }
        break;
      }

      case 'KNOCKBACK': {
        this.stateTimerMs -= deltaMs;
        if (this.elevationZ <= 0 && this.stateTimerMs <= 650) {
          this.state = 'KNOCKDOWN';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.knockdownDurationMs;
          this.reactionText.setText('★ @ ★');
        }
        break;
      }

      case 'KNOCKDOWN': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.state = 'RECOVER';
          this.stateTimerMs = BANDIT_COMBAT_CONFIG.recoverDurationMs;
          this.reactionText.setVisible(false);
        }
        break;
      }

      case 'RECOVER': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.personalAttackCooldownMs = 550;
          if (this.shouldSurrender(otherBandits)) {
            this.enterSurrendered(coordinator);
          } else if (this.fearState === 'PANICKING' || this.fearState === 'TERRIFIED') {
            this.enterPanicState();
          } else {
            this.state = playerAlive ? 'APPROACH' : 'IDLE';
          }
        }
        break;
      }

      case 'DEFEATED': {
        this.stateTimerMs -= deltaMs;
        if (this.elevationZ <= 0 && this.stateTimerMs < 480) {
          const blink = Math.floor(this.stateTimerMs / 65) % 2 === 0;
          this.container.setAlpha(blink ? 0.85 : 0.2);
        }
        if (this.stateTimerMs <= 0) {
          this.readyForRemoval = true;
        }
        break;
      }
    }

    // Clamp inside arena boundaries & resolve static props
    const scale = getPerspectiveScale(this.y);
    const afterProps = resolveProps(this.x, this.y, this.collisionRadius * scale);
    const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);
    this.x = clamped.x;
    this.y = clamped.y;

    this.syncVisuals();
  }

  private enterPanicState(): void {
    this.state = 'FLEE';
    this.stateTimerMs = 1750 + Math.random() * 650;
    this.reactionText.setText(this.archetype === 'coward' ? '살려줘!!' : '도망쳐!');
    this.reactionText.setColor('#38bdf8');
    this.reactionText.setVisible(true);
    this.callbacks.onPanic(this);
  }

  private shouldSurrender(otherBandits: Bandit[]): boolean {
    const thresh = this.effectiveSurrenderThreshold;
    if (thresh > 100 || this.fear < thresh) return false;
    const hpRatio = this.hp / Math.max(1, this.maxHp);
    const activeAllies = otherBandits.filter((b) => b !== this && !b.isNeutralized).length;
    return hpRatio <= 0.5 || activeAllies <= 2;
  }

  private enterSurrendered(coordinator: CombatCoordinator): void {
    coordinator.releaseAttackToken(this.id);
    this.releaseCurrentCover();
    this.state = 'SURRENDERED';
    this.vx = 0;
    this.vy = 0;
    this.telegraphText.setVisible(false);
    this.hpBarBg.setVisible(false);
    this.hpBarFill.setVisible(false);
    if (!this.surrenderTriggered) {
      this.surrenderTriggered = true;
      this.callbacks.onSurrender(this);
    }
  }

  private checkRunningTrip(
    dt: number,
    isPanicking: boolean,
    coordinator: CombatCoordinator,
  ): boolean {
    if (this.tripImmunityMs > 0) return false;
    const spd = this.groundSpeed;
    const curDirX = spd > 1 ? this.vx / spd : 0;
    const curDirY = spd > 1 ? this.vy / spd : 0;
    const dot = curDirX * this.prevMoveDirX + curDirY * this.prevMoveDirY;
    const isSharpTurn = Math.hypot(this.prevMoveDirX, this.prevMoveDirY) > 0.5 && dot < 0.25;
    this.prevMoveDirX = curDirX;
    this.prevMoveDirY = curDirY;

    const tripped = evaluateRunningTrip(
      spd,
      isPanicking,
      isSharpTurn,
      this.spec.tripMultiplier,
      this.step4.tripProbability,
      dt,
      Math.random(),
    );
    if (tripped) {
      return this.triggerTrip(coordinator);
    }
    return false;
  }

  private findNearestCover(
    envObjects: EnvironmentalObject[],
    heroX: number,
    heroY: number,
  ): EnvironmentalObject | null {
    let best: EnvironmentalObject | null = null;
    let bestScore = Infinity;

    for (const obj of envObjects) {
      if (!obj.canProvideCover) continue;
      if (obj.coverOccupantId !== null && obj.coverOccupantId !== this.id) continue;
      const distSelf = Math.hypot(obj.x - this.x, obj.y - this.y);
      const distHero = Math.hypot(obj.x - heroX, obj.y - heroY);
      if (distHero < 95) continue; // Don't run straight into the hero to hide!
      const score = distSelf - distHero * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = obj;
      }
    }
    return best;
  }

  private releaseCurrentCover(): void {
    if (this.coverObject) {
      this.coverObject.releaseCover(this.id);
      this.coverObject = null;
    }
  }

  private computeSeparation(otherBandits: Bandit[]): { x: number; y: number } {
    let sepX = 0;
    let sepY = 0;
    for (const other of otherBandits) {
      if (other === this || other.isNeutralized) continue;
      const ox = this.x - other.x;
      const oy = (this.y - other.y) * 1.4;
      const d = Math.hypot(ox, oy);
      if (d > 0.1 && d < 44) {
        const push = (44 - d) / 44;
        sepX += (ox / d) * push * 88;
        sepY += (oy / d) * push * 58;
      }
    }
    return { x: sepX, y: sepY };
  }

  private enterDefeated(launchVz: number): void {
    this.releaseCurrentCover();
    this.state = 'DEFEATED';
    this.stateTimerMs = 820;
    this.vz = launchVz;
    this.elevationZ = Math.max(this.elevationZ, 6);
    this.hpBarBg.setVisible(false);
    this.hpBarFill.setVisible(false);
    this.telegraphText.setVisible(false);
    this.reactionText.setText('X_X');
    this.reactionText.setColor('#fca5a5');
    this.reactionText.setVisible(true);

    if (!this.defeatTriggered) {
      this.defeatTriggered = true;
      this.callbacks.onDefeated(this);
    }
  }

  private updateHpBar(): void {
    const show = this.hp > 0 && this.hp < this.maxHp && this.state !== 'SURRENDERED';
    this.hpBarBg.setVisible(show);
    this.hpBarFill.setVisible(show);
    if (show) {
      const ratio = Phaser.Math.Clamp(this.hp / Math.max(1, this.maxHp), 0, 1);
      this.hpBarFill.width = Math.max(2, Math.round(44 * ratio));
    }
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y));

    this.sprite.setFlipX(this.facingDirX < 0);

    if (this.flashTimerMs > 0) {
      this.sprite.setTintFill(0xffffff);
    } else if (this.state === 'ATTACK_WINDUP') {
      this.sprite.setTint(0xffb4a2);
    } else if (this.spec.tintColor !== null) {
      this.sprite.setTint(this.spec.tintColor);
    } else {
      this.sprite.clearTint();
    }

    let spriteY = 4 - this.elevationZ;
    let rot = 0;
    let sx = this.baseSpriteScale;
    let sy = this.baseSpriteScale;

    switch (this.state) {
      case 'APPROACH': {
        spriteY = 4 - Math.abs(Math.sin(this.walkPhase)) * 4.5;
        rot = Math.cos(this.walkPhase) * 0.06;
        break;
      }
      case 'FLEE':
      case 'MOVING_TO_COVER': {
        // Frantic high-tempo panic sprint wobble!
        spriteY = 4 - Math.abs(Math.sin(this.walkPhase)) * 7;
        rot = Math.sin(this.walkPhase) * 0.16;
        break;
      }
      case 'HIDING': {
        // Crouched down behind cover, trembling slightly
        const tremble = Math.sin(performance.now() * 0.03) * 1.5;
        spriteY = 14;
        sx = this.baseSpriteScale * 1.06;
        sy = this.baseSpriteScale * 0.68;
        this.sprite.x = tremble;
        break;
      }
      case 'PEEKING': {
        // Slowly popping head up over cover to check!
        spriteY = 6;
        sx = this.baseSpriteScale * 0.96;
        sy = this.baseSpriteScale * 0.92;
        this.sprite.x = 0;
        break;
      }
      case 'SURRENDERED': {
        // Kneeling & trembling with hands up
        const shiver = Math.sin(performance.now() * 0.028) * 1.8;
        spriteY = 12;
        sx = this.baseSpriteScale * 1.04;
        sy = this.baseSpriteScale * 0.78;
        this.sprite.x = shiver;
        break;
      }
      case 'ATTACK_WINDUP': {
        rot = -this.facingDirX * 0.24;
        sx = this.baseSpriteScale * 1.1;
        sy = this.baseSpriteScale * 0.9;
        break;
      }
      case 'ATTACK_ACTIVE': {
        rot = this.facingDirX * 0.22;
        sx = this.baseSpriteScale * 1.14;
        sy = this.baseSpriteScale * 0.92;
        break;
      }
      case 'HURT': {
        rot = -this.facingDirX * 0.28;
        sx = this.baseSpriteScale * 0.88;
        sy = this.baseSpriteScale * 1.14;
        break;
      }
      case 'KNOCKBACK':
      case 'DEFEATED': {
        if (this.elevationZ > 0) {
          rot = this.tumbleSpinDir * (1.25 + (this.elevationZ / 90) * 0.6);
          sx = this.baseSpriteScale * 1.08;
          sy = this.baseSpriteScale * 0.92;
        } else {
          rot = this.tumbleSpinDir * (Math.PI * 0.48);
          spriteY = 12;
          sx = this.baseSpriteScale * 1.08;
          sy = this.baseSpriteScale * 0.85;
        }
        break;
      }
      case 'KNOCKDOWN': {
        rot = this.tumbleSpinDir * (Math.PI * 0.48);
        spriteY = 12;
        sx = this.baseSpriteScale * 1.08;
        sy = this.baseSpriteScale * 0.85;
        this.reactionText.y = -34 + Math.sin(performance.now() * 0.012) * 3;
        break;
      }
      case 'RECOVER': {
        const p = 1 - Phaser.Math.Clamp(this.stateTimerMs / BANDIT_COMBAT_CONFIG.recoverDurationMs, 0, 1);
        rot = this.tumbleSpinDir * (Math.PI * 0.48) * (1 - p);
        spriteY = Phaser.Math.Linear(12, 4, p);
        sx = this.baseSpriteScale * (1 + (1 - p) * 0.12);
        sy = this.baseSpriteScale * (0.85 + p * 0.15);
        break;
      }
      default:
        break;
    }

    if (this.state !== 'HIDING' && this.state !== 'SURRENDERED') {
      this.sprite.x = 0;
    }
    this.sprite.y = spriteY;
    this.sprite.rotation = rot;
    this.sprite.setScale(sx, sy);

    const shScale = Phaser.Math.Clamp(1 - this.elevationZ * 0.0045, 0.45, 1);
    this.shadow.setScale(shScale, shScale);
    this.shadow.setAlpha(0.4 * shScale);

    if (this.state !== 'KNOCKDOWN') {
      this.reactionText.y = spriteY - 70;
    }

    // Optional AI state & fear debug readout
    if (this.step4.showAiDebug && this.state !== 'DEFEATED') {
      this.aiDebugText.setVisible(true);
      this.aiDebugText.setText(
        `[${this.spec.labelKr}] ${this.state} F:${Math.round(this.fear)}`,
      );
    } else {
      this.aiDebugText.setVisible(false);
    }
  }

  public destroy(): void {
    this.releaseCurrentCover();
    this.container.destroy(true);
  }
}
