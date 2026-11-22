import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG, PLAYER_CONFIG } from '../config/arenaConfig';
import { ATTACK_SPECS, AttackSpec, AttackType, CombatTuning } from '../config/combatConfig';
import { CombatHitTracker, MeleeHitboxQuery } from '../core/CombatMath';
import {
  clampToArena,
  getDepthOrder,
  getDepthRatio,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';
import { MoveInputState } from '../systems/InputSystem';

import type { EnvironmentalObject } from './EnvironmentalObject';

const DIR_LABELS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type FacingDirection = (typeof DIR_LABELS)[number];

export type AttackPhase = 'NONE' | 'WINDUP' | 'ACTIVE' | 'RECOVERY';

const ACTION_FRAME = {
  LIGHT_1: 0,
  LIGHT_2: 1,
  LIGHT_3: 2,
  HEAVY_WINDUP: 4,
  HEAVY_ACTIVE: 7,
} as const;

export interface WarriorCombatCallbacks {
  onFootstep: () => void;
  onAttackActiveStart: (
    attackType: AttackType,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    range: number,
  ) => void;
  onPlayerHurt: (damage: number, hp: number, maxHp: number) => void;
  onPlayerDefeated: () => void;
}

/**
 * Playable chibi Zhao Yun (조운) warrior entity.
 * Preserves STEP 1 8-direction movement & 2.5D perspective scaling, STEP 2 Z/X combat,
 * and adds STEP 3 object pickup, overhead carrying, aiming, throwing, and dropping.
 */
export class Warrior {
  public readonly id = 'player_zhaoyun';
  public readonly collisionRadius = PLAYER_CONFIG.collisionRadius;
  public readonly container: Phaser.GameObjects.Container;
  public readonly hitTracker = new CombatHitTracker();

  public x: number;
  public y: number;
  public vx = 0;
  public vy = 0;
  public facingAngle = Math.PI / 2; // Start facing viewer (South)
  public facingLabel: FacingDirection = 'S';

  public maxHp = 100;
  public hp = 100;
  public isDefeated = false;

  // Combat state
  public attackPhase: AttackPhase = 'NONE';
  public currentAttack: AttackSpec | null = null;
  public attackDirX = 0;
  public attackDirY = 1;

  // Step 3: Currently carried environmental object (table, jar, fruit basket)
  public carriedObject: EnvironmentalObject | null = null;

  private readonly scene: Phaser.Scene;
  private readonly tuning: CombatTuning;
  private readonly callbacks: WarriorCombatCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;

  private readonly dirBaseScale = 0.78;
  private readonly runBaseScale = 0.68;
  private readonly actionBaseScale = 0.68;

  private phaseTimerMs = 0;
  private comboStep = 0; // 0, 1, 2
  private comboWindowTimerMs = 0;
  private bufferedAttack: 'LIGHT' | 'HEAVY' | null = null;

  private invulnTimerMs = 0;
  private hurtFlashTimerMs = 0;
  private hurtRecoilTimerMs = 0;
  private knockbackVx = 0;
  private knockbackVy = 0;

  private runFrameFloat = 0;
  private walkBobPhase = 0;
  private idleBreathPhase = 0;
  private dustCooldownMs = 0;
  private lastHorizontalFlip = false;

  constructor(
    scene: Phaser.Scene,
    spawnX: number,
    spawnY: number,
    tuning: CombatTuning,
    callbacks: WarriorCombatCallbacks,
  ) {
    this.scene = scene;
    this.x = spawnX;
    this.y = spawnY;
    this.tuning = tuning;
    this.callbacks = callbacks;

    this.shadow = scene.add.ellipse(0, 2, 54, 18, 0x1a120b, 0.42);

    this.sprite = scene.add.sprite(0, 6, 'zhaoyun_8dir', 2);
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(this.dirBaseScale);

    this.container = scene.add.container(this.x, this.y, [this.shadow, this.sprite]);
    this.syncTransform();
  }

  public get currentScale(): number {
    return getPerspectiveScale(this.y);
  }

  public get depthRatio(): number {
    return getDepthRatio(this.y);
  }

  public get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  public get isAttacking(): boolean {
    return this.attackPhase !== 'NONE';
  }

  public get isHitboxActive(): boolean {
    return this.attackPhase === 'ACTIVE' && this.currentAttack !== null;
  }

  public get isCarrying(): boolean {
    return this.carriedObject !== null && !this.carriedObject.isBroken;
  }

  public pickUpObject(obj: EnvironmentalObject): boolean {
    if (this.isDefeated || this.isCarrying || this.isAttacking) return false;
    if (!obj.pickUpBy(this.id)) return false;
    this.carriedObject = obj;
    this.carriedObject.syncToCarrier(this.x, this.y);
    return true;
  }

  public throwCarriedObject(throwForce: number): EnvironmentalObject | null {
    if (!this.carriedObject) return null;
    const obj = this.carriedObject;
    this.carriedObject = null;
    const dirX = Math.cos(this.facingAngle);
    const dirY = Math.sin(this.facingAngle);
    obj.throwInDirection(dirX, dirY, throwForce);
    return obj;
  }

  public dropCarriedObject(): void {
    if (!this.carriedObject) return;
    const obj = this.carriedObject;
    this.carriedObject = null;
    obj.dropAt(
      this.x + Math.cos(this.facingAngle) * 26,
      this.y + Math.sin(this.facingAngle) * 18,
    );
  }

  /**
   * Queues Z/X attacks even during Hit-Stop so combo input buffering never drops presses!
   */
  public bufferInput(input: MoveInputState): void {
    if (this.isDefeated || this.isCarrying) return;
    if (input.heavyAttackPressed) {
      this.bufferedAttack = 'HEAVY';
    } else if (input.lightAttackPressed) {
      this.bufferedAttack = 'LIGHT';
    }
  }

  /**
   * Returns the active 2.5D melee hitbox query when in ACTIVE frames, or null otherwise.
   */
  public getActiveHitbox(): MeleeHitboxQuery | null {
    if (!this.isHitboxActive || !this.currentAttack) return null;
    return {
      originX: this.x,
      originY: this.y,
      dirX: this.attackDirX,
      dirY: this.attackDirY,
      range: this.currentAttack.range * this.tuning.attackRangeMultiplier,
      halfWidth: this.currentAttack.halfWidth * this.tuning.attackRangeMultiplier,
      verticalRatio: PERSPECTIVE_CONFIG.verticalMoveRatio,
      backGrace: 14,
    };
  }

  public takeDamage(amount: number, dirX: number, dirY: number): boolean {
    if (this.isDefeated || this.invulnTimerMs > 0) return false;

    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnTimerMs = 650;
    this.hurtFlashTimerMs = 120;
    this.hurtRecoilTimerMs = 110;

    // Brief knockback without locking movement permanently
    const len = Math.hypot(dirX, dirY) || 1;
    this.knockbackVx = (dirX / len) * 210;
    this.knockbackVy = (dirY / len) * 210 * PERSPECTIVE_CONFIG.verticalMoveRatio;

    // Cleanly cancel attack windup if interrupted so animation never gets stuck
    if (this.attackPhase === 'WINDUP') {
      this.cancelAttack();
    }

    this.callbacks.onPlayerHurt(dmg, this.hp, this.maxHp);

    if (this.hp <= 0) {
      this.isDefeated = true;
      this.dropCarriedObject();
      this.cancelAttack();
      this.callbacks.onPlayerDefeated();
    }
    return true;
  }

  public reset(spawnX: number, spawnY: number): void {
    this.carriedObject = null;
    this.x = spawnX;
    this.y = spawnY;
    this.vx = 0;
    this.vy = 0;
    this.knockbackVx = 0;
    this.knockbackVy = 0;
    this.facingAngle = Math.PI / 2;
    this.facingLabel = 'S';
    this.hp = this.maxHp;
    this.isDefeated = false;
    this.invulnTimerMs = 0;
    this.hurtFlashTimerMs = 0;
    this.hurtRecoilTimerMs = 0;
    this.comboStep = 0;
    this.comboWindowTimerMs = 0;
    this.bufferedAttack = null;
    this.cancelAttack();
    this.container.setAlpha(1);
    this.sprite.clearTint();
    this.syncTransform();
  }

  public update(
    deltaMs: number,
    input: MoveInputState,
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    const dt = Math.min(deltaMs, 50) * 0.001;

    if (this.invulnTimerMs > 0) this.invulnTimerMs = Math.max(0, this.invulnTimerMs - deltaMs);
    if (this.hurtFlashTimerMs > 0) this.hurtFlashTimerMs = Math.max(0, this.hurtFlashTimerMs - deltaMs);
    if (this.hurtRecoilTimerMs > 0) this.hurtRecoilTimerMs = Math.max(0, this.hurtRecoilTimerMs - deltaMs);

    // Decay combo window when idle between hits
    if (this.attackPhase === 'NONE' && this.comboWindowTimerMs > 0) {
      this.comboWindowTimerMs = Math.max(0, this.comboWindowTimerMs - deltaMs);
      if (this.comboWindowTimerMs <= 0) {
        this.comboStep = 0;
      }
    }

    if (this.isDefeated) {
      this.vx *= Math.exp(-8 * dt);
      this.vy *= Math.exp(-8 * dt);
      this.sprite.rotation = Math.PI * 0.45;
      this.sprite.y = 14;
      this.syncTransform();
      return;
    }

    // Consume buffered attacks when idle or late in recovery
    this.stepAttackStateMachine(deltaMs, input);

    // Movement during combat & carrying:
    const speedFactor = getDepthSpeedFactor(this.y);
    const attackMoveMul = this.currentAttack ? this.currentAttack.moveSpeedFactor : 1.0;
    const carryMoveMul = this.carriedObject ? this.carriedObject.spec.carrySpeedFactor : 1.0;

    const targetVx = input.x * PLAYER_CONFIG.baseMoveSpeed * speedFactor * attackMoveMul * carryMoveMul;
    const targetVy =
      input.y *
      PLAYER_CONFIG.baseMoveSpeed *
      PERSPECTIVE_CONFIG.verticalMoveRatio *
      speedFactor *
      attackMoveMul *
      carryMoveMul;

    const rate = input.isMoving ? PLAYER_CONFIG.accelRate : PLAYER_CONFIG.decelRate;
    const maxStep = rate * dt;

    this.vx = this.approach(this.vx, targetVx, maxStep);
    this.vy = this.approach(this.vy, targetVy, maxStep);

    // Allow changing facing direction when not locked inside WINDUP/ACTIVE
    if (input.isMoving && (this.attackPhase === 'NONE' || this.attackPhase === 'RECOVERY')) {
      this.facingAngle = Math.atan2(input.y, input.x);
      this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
    }

    // Forward lunge impulse during attack ACTIVE frames
    let lungeVx = 0;
    let lungeVy = 0;
    if (this.attackPhase === 'ACTIVE' && this.currentAttack) {
      const lunge = this.currentAttack.lungeSpeed * speedFactor;
      lungeVx = this.attackDirX * lunge;
      lungeVy = this.attackDirY * lunge * PERSPECTIVE_CONFIG.verticalMoveRatio;
    }

    // Decay damage knockback smoothly
    const kbDamp = Math.exp(-12 * dt);
    this.knockbackVx *= kbDamp;
    this.knockbackVy *= kbDamp;
    if (Math.abs(this.knockbackVx) < 4) this.knockbackVx = 0;
    if (Math.abs(this.knockbackVy) < 4) this.knockbackVy = 0;

    const nextX = this.x + (this.vx + lungeVx + this.knockbackVx) * dt;
    const nextY = this.y + (this.vy + lungeVy + this.knockbackVy) * dt;

    const afterProps = resolveProps(nextX, nextY, this.collisionRadius * this.currentScale);
    const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);

    if (Math.abs(clamped.x - nextX) > 0.5) this.vx *= 0.25;
    if (Math.abs(clamped.y - nextY) > 0.5) this.vy *= 0.25;

    this.x = clamped.x;
    this.y = clamped.y;

    this.updateAnimation(dt, deltaMs);
    this.syncTransform();

    // Keep carried object cleanly attached overhead with matching depth order
    if (this.carriedObject) {
      if (this.carriedObject.isBroken) {
        this.carriedObject = null;
      } else {
        this.carriedObject.syncToCarrier(this.x, this.y);
      }
    }
  }

  private stepAttackStateMachine(deltaMs: number, input: MoveInputState): void {
    const speedScale = Math.max(0.4, this.tuning.attackSpeedMultiplier);

    if (this.attackPhase === 'NONE') {
      if (this.bufferedAttack) {
        const next = this.bufferedAttack;
        this.bufferedAttack = null;
        this.startAttack(next, input);
      }
      return;
    }

    this.phaseTimerMs -= deltaMs * speedScale;

    if (this.attackPhase === 'WINDUP' && this.phaseTimerMs <= 0 && this.currentAttack) {
      this.attackPhase = 'ACTIVE';
      this.phaseTimerMs = this.currentAttack.activeMs;
      this.hitTracker.beginAttack();
      this.callbacks.onAttackActiveStart(
        this.currentAttack.type,
        this.x,
        this.y,
        this.attackDirX,
        this.attackDirY,
        this.currentAttack.range * this.tuning.attackRangeMultiplier,
      );
      return;
    }

    if (this.attackPhase === 'ACTIVE' && this.phaseTimerMs <= 0 && this.currentAttack) {
      this.attackPhase = 'RECOVERY';
      this.phaseTimerMs = this.currentAttack.recoveryMs;
      return;
    }

    if (this.attackPhase === 'RECOVERY' && this.currentAttack) {
      // Allow crisp combo-chaining in the final 45% of light attack recovery!
      const canChainEarly =
        !this.currentAttack.isHeavy &&
        !this.currentAttack.isFinisher &&
        this.bufferedAttack !== null &&
        this.phaseTimerMs <= this.currentAttack.recoveryMs * 0.45;

      if (canChainEarly || this.phaseTimerMs <= 0) {
        const finished = this.currentAttack;
        this.attackPhase = 'NONE';
        this.currentAttack = null;

        if (!finished.isHeavy && !finished.isFinisher) {
          this.comboWindowTimerMs = this.tuning.comboWindowMs;
        } else {
          this.comboStep = 0;
          this.comboWindowTimerMs = 0;
        }

        if (this.bufferedAttack) {
          const next = this.bufferedAttack;
          this.bufferedAttack = null;
          this.startAttack(next, input);
        }
      }
    }
  }

  private startAttack(kind: 'LIGHT' | 'HEAVY', input: MoveInputState): void {
    // Allow immediate direction re-aiming on attack start if a directional key is held
    if (input.isMoving) {
      this.facingAngle = Math.atan2(input.y, input.x);
      this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
    }

    this.attackDirX = Math.cos(this.facingAngle);
    this.attackDirY = Math.sin(this.facingAngle);

    let attackType: AttackType;
    if (kind === 'HEAVY') {
      attackType = 'HEAVY';
      this.comboStep = 0;
    } else {
      if (this.comboStep === 0) {
        attackType = 'LIGHT_1';
        this.comboStep = 1;
      } else if (this.comboStep === 1) {
        attackType = 'LIGHT_2';
        this.comboStep = 2;
      } else {
        attackType = 'LIGHT_3';
        this.comboStep = 0;
      }
    }

    this.currentAttack = ATTACK_SPECS[attackType];
    this.attackPhase = 'WINDUP';
    this.phaseTimerMs = this.currentAttack.windupMs;
  }

  private cancelAttack(): void {
    this.attackPhase = 'NONE';
    this.currentAttack = null;
    this.phaseTimerMs = 0;
    this.hitTracker.clear();
  }

  private updateAnimation(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;

    if (this.dustCooldownMs > 0) {
      this.dustCooldownMs -= deltaMs;
    }

    // Hurt flash & invulnerability blink
    if (this.hurtFlashTimerMs > 0) {
      this.sprite.setTintFill(0xffffff);
    } else if (this.attackPhase === 'WINDUP' && this.currentAttack?.isHeavy) {
      // Subtle gold-cyan anticipation glint on Heavy windup
      this.sprite.setTint(0xbbeeff);
    } else {
      this.sprite.clearTint();
    }

    if (this.invulnTimerMs > 0 && this.hurtFlashTimerMs <= 0) {
      this.container.setAlpha(Math.floor(this.invulnTimerMs / 60) % 2 === 0 ? 1 : 0.48);
    } else {
      this.container.setAlpha(1);
    }

    // 1. Attack poses (distinct for Light 1, 2, 3, and Heavy windup/thrust)
    if (this.currentAttack && this.attackPhase !== 'NONE') {
      let frame: number = ACTION_FRAME.LIGHT_1;
      if (this.currentAttack.type === 'LIGHT_1') frame = ACTION_FRAME.LIGHT_1;
      else if (this.currentAttack.type === 'LIGHT_2') frame = ACTION_FRAME.LIGHT_2;
      else if (this.currentAttack.type === 'LIGHT_3') frame = ACTION_FRAME.LIGHT_3;
      else if (this.currentAttack.type === 'HEAVY') {
        frame =
          this.attackPhase === 'WINDUP'
            ? ACTION_FRAME.HEAVY_WINDUP
            : ACTION_FRAME.HEAVY_ACTIVE;
      }

      if (this.sprite.texture.key !== 'zhaoyun_actions') {
        this.sprite.setTexture('zhaoyun_actions', frame);
      } else {
        this.sprite.setFrame(frame);
      }

      const flipX = this.attackDirX < -0.15;
      this.sprite.setFlipX(flipX);

      // Squash-and-stretch + directional thrust lean for punchy weapon motion
      let sx = this.actionBaseScale;
      let sy = this.actionBaseScale;
      let rot = 0;

      if (this.attackPhase === 'WINDUP') {
        sx = this.actionBaseScale * (this.currentAttack.isHeavy ? 0.9 : 0.95);
        sy = this.actionBaseScale * (this.currentAttack.isHeavy ? 1.08 : 1.04);
        rot = (flipX ? 1 : -1) * (this.currentAttack.isHeavy ? 0.14 : 0.06);
      } else if (this.attackPhase === 'ACTIVE') {
        sx = this.actionBaseScale * (this.currentAttack.isHeavy ? 1.18 : 1.1);
        sy = this.actionBaseScale * (this.currentAttack.isHeavy ? 0.9 : 0.95);
        rot = (flipX ? -1 : 1) * (this.currentAttack.isHeavy ? 0.12 : 0.06);
      }

      this.sprite.setScale(sx, sy);
      this.sprite.rotation = rot;
      this.sprite.y = 6;
      this.shadow.setScale(1, 1);
      return;
    }

    // 2. Movement & Idle (STEP 1 preserved)
    if (isMoving) {
      const speedNorm = Phaser.Math.Clamp(currentSpeed / PLAYER_CONFIG.baseMoveSpeed, 0.35, 1.15);
      const predominantlyHorizontal = Math.abs(this.vx) > Math.abs(this.vy) * 1.45;

      if (predominantlyHorizontal) {
        this.runFrameFloat = (this.runFrameFloat + dt * 11 * speedNorm) % 4;
        const frameIdx = Math.floor(this.runFrameFloat);
        this.lastHorizontalFlip = this.vx < 0;

        if (this.sprite.texture.key !== 'zhaoyun_run') {
          this.sprite.setTexture('zhaoyun_run', frameIdx);
        } else {
          this.sprite.setFrame(frameIdx);
        }
        this.sprite.setFlipX(this.lastHorizontalFlip);
        this.sprite.setScale(this.runBaseScale);
        this.sprite.y = 6;
        const lean = Phaser.Math.Clamp((this.vx / PLAYER_CONFIG.baseMoveSpeed) * 0.08, -0.08, 0.08);
        this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, lean, 0.25);
      } else {
        const sector = this.angleToSector(this.facingAngle);
        if (this.sprite.texture.key !== 'zhaoyun_8dir') {
          this.sprite.setTexture('zhaoyun_8dir', sector);
        } else {
          this.sprite.setFrame(sector);
        }
        this.sprite.setFlipX(false);

        this.walkBobPhase += dt * 15 * speedNorm;
        const bob = Math.abs(Math.sin(this.walkBobPhase)) * 5.5;
        const sway = Math.cos(this.walkBobPhase) * 0.045;
        const squash = Math.sin(this.walkBobPhase * 2) * 0.028;

        this.sprite.y = 6 - bob;
        this.sprite.rotation = sway;
        this.sprite.setScale(
          this.dirBaseScale * (1 + squash),
          this.dirBaseScale * (1 - squash),
        );
      }

      const shadowPulse = 1 - Math.abs(Math.sin(this.walkBobPhase)) * 0.07;
      this.shadow.setScale(shadowPulse, shadowPulse);

      if (this.dustCooldownMs <= 0 && currentSpeed > 95) {
        this.spawnFootstepDust();
        this.callbacks.onFootstep();
        this.dustCooldownMs = 190;
      }
    } else {
      const sector = this.angleToSector(this.facingAngle);
      if (this.sprite.texture.key !== 'zhaoyun_8dir') {
        this.sprite.setTexture('zhaoyun_8dir', sector);
      } else {
        this.sprite.setFrame(sector);
      }
      this.sprite.setFlipX(false);

      this.idleBreathPhase += dt * 3.1;
      const breath = Math.sin(this.idleBreathPhase) * 0.018;

      this.sprite.setScale(
        Phaser.Math.Linear(this.sprite.scaleX, this.dirBaseScale * (1 - breath * 0.5), 0.22),
        Phaser.Math.Linear(this.sprite.scaleY, this.dirBaseScale * (1 + breath), 0.22),
      );
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.24);
      this.sprite.y = Phaser.Math.Linear(this.sprite.y, 6, 0.24);
      this.shadow.setScale(1, 1);
    }
  }

  private spawnFootstepDust(): void {
    if (!this.scene.textures.exists('dust_puff')) return;

    const scale = this.currentScale;
    const dust = this.scene.add.image(
      this.x + Phaser.Math.Between(-8, 8) * scale,
      this.y + 2,
      'dust_puff',
    );
    dust.setDepth(getDepthOrder(this.y) - 1);
    dust.setScale(0.55 * scale);
    dust.setAlpha(0.55);

    this.scene.tweens.add({
      targets: dust,
      x: dust.x - this.vx * 0.08,
      y: dust.y - 6 * scale,
      scale: 1.05 * scale,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => dust.destroy(),
    });
  }

  private syncTransform(): void {
    const scale = this.currentScale;
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y));
  }

  private angleToSector(radians: number): number {
    const wrapped = Phaser.Math.Angle.Wrap(radians);
    const sector = Math.round((wrapped / (Math.PI * 2)) * 8);
    return ((sector % 8) + 8) % 8;
  }

  private approach(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
