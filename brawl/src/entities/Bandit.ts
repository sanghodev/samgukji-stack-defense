import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { BANDIT_COMBAT_CONFIG, CombatTuning } from '../config/combatConfig';
import {
  AirborneBodyState,
  check25DMeleeHit,
  CombatHitTracker,
  MeleeTargetHurtbox,
  stepAirbornePhysics,
} from '../core/CombatMath';
import type { ChainReactionTier } from '../core/MayhemPhysics';
import {
  clampToArena,
  getDepthOrder,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';
import { CombatCoordinator } from '../systems/CombatCoordinator';

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
}

/**
 * Cute 2-head-tall blue-uniformed bandit with full finite-state machine,
 * separated ground/airborne 2.5D physics, and exaggerated cartoon hit reactions.
 */
export class Bandit {
  public readonly id: string;
  public readonly slotIndex: number;
  public readonly collisionRadius = BANDIT_COMBAT_CONFIG.collisionRadius;
  public readonly mass = 1.0;
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

  // Step 3 Mayhem Physics: domino chain & slipping state
  public chainDepth = 0;
  public chainCooldownMs = 0;
  public slipImmunityMs = 0;
  public isSlipping = false;

  private readonly scene: Phaser.Scene;
  private readonly tuning: CombatTuning;
  private readonly callbacks: BanditCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly telegraphText: Phaser.GameObjects.Text;
  private readonly reactionText: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly hitTracker = new CombatHitTracker();

  private readonly baseSpriteScale = 0.56;
  private stateTimerMs = 0;
  private walkPhase = 0;
  private flashTimerMs = 0;
  private facingDirX = -1;
  private facingDirY = 0;
  private attackDirX = -1;
  private attackDirY = 0;
  private tumbleSpinDir = 1;
  private defeatTriggered = false;
  private personalAttackCooldownMs = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    slotIndex: number,
    spawnX: number,
    spawnY: number,
    tuning: CombatTuning,
    callbacks: BanditCallbacks,
  ) {
    this.scene = scene;
    this.id = id;
    this.slotIndex = slotIndex;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.tuning = tuning;
    this.callbacks = callbacks;
    this.maxHp = tuning.enemyMaxHp;
    this.hp = this.maxHp;

    // Ground shadow anchored at feet (0, 0)
    this.shadow = scene.add.ellipse(0, 2, 46, 15, 0x1a120b, 0.4);

    // Cute 2-head-tall blue-uniformed bandit sprite (frame 0 of enemies_4types)
    this.sprite = scene.add.sprite(0, 4, 'enemies_4types', 0);
    this.sprite.setOrigin(0.5, 0.9);
    this.sprite.setScale(this.baseSpriteScale);

    // Clear attack telegraph ("!")
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

    // Exaggerated cartoon hit / dizzy reaction badge
    this.reactionText = scene.add
      .text(0, -72, '', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#1c120c',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Compact enemy HP bar (shown only when damaged)
    this.hpBarBg = scene.add.rectangle(0, -64, 46, 6, 0x1c120c, 0.85).setVisible(false);
    this.hpBarFill = scene.add
      .rectangle(-22, -64, 44, 4, 0xef4444, 1)
      .setOrigin(0, 0.5)
      .setVisible(false);

    this.container = scene.add.container(this.x, this.y, [
      this.shadow,
      this.sprite,
      this.hpBarBg,
      this.hpBarFill,
      this.telegraphText,
      this.reactionText,
    ]);

    this.state = 'APPROACH';
    this.personalAttackCooldownMs = 500 + slotIndex * 180;
    this.syncVisuals(0);
  }

  public get isAlive(): boolean {
    return this.state !== 'DEFEATED' && this.hp > 0;
  }

  public get isVulnerable(): boolean {
    return (
      this.state !== 'DEFEATED' &&
      this.state !== 'KNOCKDOWN' &&
      this.state !== 'RECOVER'
    );
  }

  public get groundSpeed(): number {
    return Math.hypot(this.vx, this.vy / PERSPECTIVE_CONFIG.verticalMoveRatio);
  }

  /** True when this bandit is flying fast enough to bowl into other bandits or barrels! */
  public get isChainProjectile(): boolean {
    return (
      (this.state === 'KNOCKBACK' || this.state === 'HURT' || this.state === 'DEFEATED') &&
      this.groundSpeed >= 130
    );
  }

  public get canSlipNow(): boolean {
    return (
      this.state === 'APPROACH' &&
      this.slipImmunityMs <= 0 &&
      this.elevationZ <= 0 &&
      !this.isSlipping
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
    const newMax = Math.max(10, Math.round(this.tuning.enemyMaxHp));
    if (newMax !== this.maxHp && this.isAlive) {
      const ratio = this.hp / Math.max(1, this.maxHp);
      this.maxHp = newMax;
      this.hp = Math.max(1, Math.round(this.maxHp * ratio));
      this.updateHpBar();
    }
  }

  public takeHit(hit: BanditHitRequest, coordinator: CombatCoordinator): boolean {
    if (!this.isVulnerable) return false;

    coordinator.releaseAttackToken(this.id);
    this.telegraphText.setVisible(false);
    this.isSlipping = false;
    this.chainDepth = 0;

    const dmg = Math.max(1, Math.round(hit.damage));
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimerMs = 95;
    this.updateHpBar();

    // Normalize knockback direction
    const len = Math.hypot(hit.dirX, hit.dirY) || 1;
    const nx = hit.dirX / len;
    const ny = hit.dirY / len;

    const kb = hit.knockbackForce * this.tuning.knockbackMultiplier;
    this.vx = nx * kb;
    this.vy = ny * kb * PERSPECTIVE_CONFIG.verticalMoveRatio;
    this.tumbleSpinDir = nx >= 0 ? 1 : -1;

    // Face toward attacker on impact
    this.facingDirX = -nx;

    if (this.hp <= 0) {
      this.enterDefeated(hit.launchVz > 0 ? hit.launchVz : 240);
      return true;
    }

    if (hit.launchVz > 0 || hit.isHeavy) {
      this.state = 'KNOCKBACK';
      this.vz = Math.max(210, hit.launchVz * Math.sqrt(this.tuning.knockbackMultiplier));
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
   * Receives domino knockback transfer from another launched bandit.
   */
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

  /**
   * Comedic surface hazard slip (water puddle, spilled food, banana peel).
   */
  public triggerSlip(coordinator: CombatCoordinator): boolean {
    if (!this.canSlipNow) return false;

    coordinator.releaseAttackToken(this.id);
    this.telegraphText.setVisible(false);
    this.isSlipping = true;
    this.slipImmunityMs = 2400;

    // Feet shoot forward along current run direction, body flips backward!
    const spd = Math.max(165, this.groundSpeed * 1.45);
    const len = Math.hypot(this.vx, this.vy) || 1;
    const nx = this.vx / len;
    const ny = this.vy / len;

    this.vx = nx * spd;
    this.vy = ny * spd;
    this.vz = 155;
    this.elevationZ = 5;
    this.tumbleSpinDir = nx >= 0 ? -1 : 1; // Backward comic flip!
    this.state = 'KNOCKBACK';
    this.stateTimerMs = 760;

    this.reactionText.setText('미끄덩!');
    this.reactionText.setColor('#38bdf8');
    this.reactionText.setVisible(true);
    return true;
  }

  public update(
    deltaMs: number,
    playerX: number,
    playerY: number,
    playerAlive: boolean,
    coordinator: CombatCoordinator,
    otherBandits: Bandit[],
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    const dt = Math.min(deltaMs, 50) * 0.001;
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.flashTimerMs > 0) {
      this.flashTimerMs = Math.max(0, this.flashTimerMs - deltaMs);
    }
    if (this.personalAttackCooldownMs > 0) {
      this.personalAttackCooldownMs = Math.max(0, this.personalAttackCooldownMs - deltaMs);
    }
    if (this.chainCooldownMs > 0) {
      this.chainCooldownMs = Math.max(0, this.chainCooldownMs - deltaMs);
    }
    if (this.slipImmunityMs > 0) {
      this.slipImmunityMs = Math.max(0, this.slipImmunityMs - deltaMs);
    }

    // Step 2.5D knockback + gravity physics for airborne/staggered/defeated states
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

    // Finite-state machine behavior
    switch (this.state) {
      case 'IDLE': {
        this.reactionText.setVisible(false);
        this.telegraphText.setVisible(false);
        if (playerAlive) {
          this.state = 'APPROACH';
        }
        break;
      }

      case 'APPROACH': {
        this.reactionText.setVisible(false);
        this.telegraphText.setVisible(false);
        if (!playerAlive) {
          this.state = 'IDLE';
          break;
        }

        const flank = coordinator.getFlankOffset(this.slotIndex);
        const goalX = playerX + flank.ox;
        const goalY = playerY + flank.oy;
        const dxGoal = goalX - this.x;
        const dyGoal = goalY - this.y;
        const distGoal = Math.hypot(dxGoal, dyGoal);

        // Separation force from nearby bandits so they stay readable
        let sepX = 0;
        let sepY = 0;
        for (const other of otherBandits) {
          if (other === this || !other.isAlive) continue;
          const ox = this.x - other.x;
          const oy = (this.y - other.y) * 1.4;
          const d = Math.hypot(ox, oy);
          if (d > 0.1 && d < 46) {
            const push = (46 - d) / 46;
            sepX += (ox / d) * push * 90;
            sepY += (oy / d) * push * 60;
          }
        }

        const speedFactor = getDepthSpeedFactor(this.y);
        const moveSpd = this.tuning.enemyMoveSpeed * speedFactor;

        if (distGoal > 14) {
          this.vx = (dxGoal / distGoal) * moveSpd + sepX;
          this.vy = (dyGoal / distGoal) * moveSpd * PERSPECTIVE_CONFIG.verticalMoveRatio + sepY;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          this.walkPhase += dt * 11;
        } else {
          this.vx = sepX * 0.5;
          this.vy = sepY * 0.5;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
        }

        // Face player
        const toPlayerX = playerX - this.x;
        const toPlayerY = playerY - this.y;
        const distPlayer = Math.hypot(
          toPlayerX,
          toPlayerY / PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (Math.abs(toPlayerX) > 4) {
          this.facingDirX = Math.sign(toPlayerX);
        }
        this.facingDirY = toPlayerY;

        // Request staggered attack token when within melee strike distance
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
        // Small forward lunge during swing
        const scale = getPerspectiveScale(this.y);
        this.x += this.attackDirX * 95 * scale * dt;
        this.y += this.attackDirY * 95 * PERSPECTIVE_CONFIG.verticalMoveRatio * scale * dt;

        // Check 2.5D hit against player once per swing
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
              BANDIT_COMBAT_CONFIG.attackDamage,
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
          this.state = playerAlive ? 'APPROACH' : 'IDLE';
        }
        break;
      }

      case 'HURT': {
        this.stateTimerMs -= deltaMs;
        if (this.stateTimerMs <= 0) {
          this.reactionText.setVisible(false);
          this.state = playerAlive ? 'APPROACH' : 'IDLE';
        }
        break;
      }

      case 'KNOCKBACK': {
        this.stateTimerMs -= deltaMs;
        // Safety fallback so a bandit can never get stuck in KNOCKBACK
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
          this.state = playerAlive ? 'APPROACH' : 'IDLE';
        }
        break;
      }

      case 'DEFEATED': {
        this.stateTimerMs -= deltaMs;
        // Blink out after hitting the ground
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

    // Always clamp inside arena boundaries & resolve static prop collisions
    const scale = getPerspectiveScale(this.y);
    const afterProps = resolveProps(this.x, this.y, this.collisionRadius * scale);
    const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);
    this.x = clamped.x;
    this.y = clamped.y;

    this.syncVisuals(deltaMs);
  }

  private enterDefeated(launchVz: number): void {
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
    const show = this.hp > 0 && this.hp < this.maxHp;
    this.hpBarBg.setVisible(show);
    this.hpBarFill.setVisible(show);
    if (show) {
      const ratio = Phaser.Math.Clamp(this.hp / Math.max(1, this.maxHp), 0, 1);
      this.hpBarFill.width = Math.max(2, Math.round(44 * ratio));
    }
  }

  private syncVisuals(_deltaMs: number): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y));

    // Facing flip (frame 0 faces right by default)
    this.sprite.setFlipX(this.facingDirX < 0);

    // Hit flash tint
    if (this.flashTimerMs > 0) {
      this.sprite.setTintFill(0xffffff);
    } else if (this.state === 'ATTACK_WINDUP') {
      this.sprite.setTint(0xffb4a2);
    } else {
      this.sprite.clearTint();
    }

    // Controlled pixel-art cartoon offsets, rotation, and squash-and-stretch
    let spriteY = 4 - this.elevationZ;
    let rot = 0;
    let sx = this.baseSpriteScale;
    let sy = this.baseSpriteScale;

    switch (this.state) {
      case 'APPROACH': {
        const bob = Math.abs(Math.sin(this.walkPhase)) * 4.5;
        spriteY = 4 - bob;
        rot = Math.cos(this.walkPhase) * 0.06;
        break;
      }
      case 'ATTACK_WINDUP': {
        // Lean back & squash in anticipation
        rot = -this.facingDirX * 0.24;
        sx = this.baseSpriteScale * 1.1;
        sy = this.baseSpriteScale * 0.9;
        break;
      }
      case 'ATTACK_ACTIVE': {
        // Snap forward with stretch
        rot = this.facingDirX * 0.22;
        sx = this.baseSpriteScale * 1.14;
        sy = this.baseSpriteScale * 0.92;
        break;
      }
      case 'HURT': {
        // Cartoon recoil squash & tilt backward
        rot = -this.facingDirX * 0.28;
        sx = this.baseSpriteScale * 0.88;
        sy = this.baseSpriteScale * 1.14;
        break;
      }
      case 'KNOCKBACK':
      case 'DEFEATED': {
        if (this.elevationZ > 0) {
          // Tumble mid-air
          rot = this.tumbleSpinDir * (1.25 + (this.elevationZ / 90) * 0.6);
          sx = this.baseSpriteScale * 1.08;
          sy = this.baseSpriteScale * 0.92;
        } else {
          // Flat on the cobblestones
          rot = this.tumbleSpinDir * (Math.PI * 0.48);
          spriteY = 12;
          sx = this.baseSpriteScale * 1.08;
          sy = this.baseSpriteScale * 0.85;
        }
        break;
      }
      case 'KNOCKDOWN': {
        // Lying knocked out on the ground
        rot = this.tumbleSpinDir * (Math.PI * 0.48);
        spriteY = 12;
        sx = this.baseSpriteScale * 1.08;
        sy = this.baseSpriteScale * 0.85;
        this.reactionText.y = -34 + Math.sin(performance.now() * 0.012) * 3;
        break;
      }
      case 'RECOVER': {
        // Pushing back up
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

    this.sprite.y = spriteY;
    this.sprite.rotation = rot;
    this.sprite.setScale(sx, sy);

    // Shadow shrinks softly when airborne
    const shScale = Phaser.Math.Clamp(1 - this.elevationZ * 0.0045, 0.45, 1);
    this.shadow.setScale(shScale, shScale);
    this.shadow.setAlpha(0.4 * shScale);

    if (this.state !== 'KNOCKDOWN') {
      this.reactionText.y = spriteY - 70;
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
