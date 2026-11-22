import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG, PLAYER_CONFIG } from '../config/arenaConfig';
import { ATTACK_SPECS, AttackSpec, AttackType, CombatTuning } from '../config/combatConfig';
import { HERO_PROFILES, HeroId, HeroProfile, Step4Tuning } from '../config/step4Config';
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
export type ChargePhase = 'NONE' | 'ANTICIPATION' | 'CHARGING' | 'RECOVERY';

const ZHAOYUN_ACTION_FRAME = {
  LIGHT_1: 0,
  LIGHT_2: 1,
  LIGHT_3: 2,
  WHIRLWIND: 3,
  HEAVY_WINDUP: 4,
  HEAVY_ACTIVE: 7,
} as const;

const ZHANGFEI_FRAME = {
  IDLE: 0,
  RUN_A: 1,
  RUN_B: 2,
  SWING: 3,
  HEAVY: 4,
  CHARGE_ROAR: 5,
  CHARGE_RUSH: 6,
  CHARGE_SKID: 7,
} as const;

export interface WarriorCombatCallbacks {
  onFootstep: (heavy: boolean) => void;
  onAttackActiveStart: (
    attackType: AttackType,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    range: number,
  ) => void;
  onZhangFeiRoar: (x: number, y: number) => void;
  onZhangFeiChargeRush: (x: number, y: number, dirX: number, dirY: number) => void;
  onZhangFeiChargeSkid: (x: number, y: number) => void;
  onZhaoYunWhirlwind: (x: number, y: number) => void;
  onSpecialCooldownRejected: () => void;
  onPlayerHurt: (damage: number, hp: number, maxHp: number) => void;
  onPlayerDefeated: () => void;
}

/**
 * Playable hero controller supporting both Zhao Yun (조운) and Zhang Fei (장비).
 * Preserves STEP 1 movement/perspective, STEP 2 Z/X combos, STEP 3 SPACE pickup/throw,
 * and adds STEP 4 TAB hero switch & V signature special (Zhang Fei's 맹장돌진 / Zhao Yun's 청룡선풍).
 */
export class Warrior {
  public readonly id = 'player_hero';
  public readonly collisionRadius = PLAYER_CONFIG.collisionRadius;
  public readonly container: Phaser.GameObjects.Container;
  public readonly hitTracker = new CombatHitTracker();
  public readonly chargeHitTracker = new CombatHitTracker();

  public heroId: HeroId;
  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public vx = 0;
  public vy = 0;
  public facingAngle = Math.PI / 2;
  public facingLabel: FacingDirection = 'S';

  public maxHp: number;
  public hp: number;
  public isDefeated = false;

  // Step 2 Combat state
  public attackPhase: AttackPhase = 'NONE';
  public currentAttack: AttackSpec | null = null;
  public attackDirX = 0;
  public attackDirY = 1;

  // Step 3 Carried object
  public carriedObject: EnvironmentalObject | null = null;

  // Step 4 Zhang Fei Bulldozer Charge & Special Cooldown
  public chargePhase: ChargePhase = 'NONE';
  public chargeDirX = 1;
  public chargeDirY = 0;
  public chargeEnergy = 0;
  public chargeCurrentSpeed = 0;
  public specialCooldownMs = 0;
  public specialMaxCooldownMs = 4200;

  private readonly scene: Phaser.Scene;
  private readonly tuning: CombatTuning;
  private readonly step4: Step4Tuning;
  private readonly callbacks: WarriorCombatCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;

  private readonly zhaoYunDirScale = 0.78;
  private readonly zhaoYunRunScale = 0.68;
  private readonly zhaoYunActionScale = 0.68;
  private readonly zhangFeiScale = 0.78;

  private phaseTimerMs = 0;
  private comboStep = 0;
  private comboWindowTimerMs = 0;
  private bufferedAttack: 'LIGHT' | 'HEAVY' | null = null;

  private chargeTimerMs = 0;
  private chargeDistanceTraveled = 0;
  private whirlwindTimerMs = 0;

  private invulnTimerMs = 0;
  private hurtFlashTimerMs = 0;
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
    initialHero: HeroId,
    tuning: CombatTuning,
    step4: Step4Tuning,
    callbacks: WarriorCombatCallbacks,
  ) {
    this.scene = scene;
    this.heroId = initialHero;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.tuning = tuning;
    this.step4 = step4;
    this.callbacks = callbacks;

    const prof = this.profile;
    this.maxHp = prof.maxHp;
    this.hp = prof.maxHp;

    this.shadow = scene.add.ellipse(0, 2, 54, 18, 0x1a120b, 0.42);
    this.sprite = scene.add.sprite(
      0,
      6,
      initialHero === 'zhangfei' ? 'zhangfei_sheet' : 'zhaoyun_8dir',
      initialHero === 'zhangfei' ? 0 : 2,
    );
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(initialHero === 'zhangfei' ? this.zhangFeiScale : this.zhaoYunDirScale);

    this.container = scene.add.container(this.x, this.y, [this.shadow, this.sprite]);
    this.syncTransform();
  }

  public get profile(): HeroProfile {
    return HERO_PROFILES[this.heroId];
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
    return this.attackPhase !== 'NONE' || this.whirlwindTimerMs > 0;
  }

  public get isCharging(): boolean {
    return this.chargePhase !== 'NONE';
  }

  public get isChargeActive(): boolean {
    return this.chargePhase === 'CHARGING';
  }

  public get isHitboxActive(): boolean {
    return this.attackPhase === 'ACTIVE' && this.currentAttack !== null;
  }

  public get isCarrying(): boolean {
    return this.carriedObject !== null && !this.carriedObject.isBroken;
  }

  public get specialReadyRatio(): number {
    if (this.step4.chargeNoCooldown || this.specialCooldownMs <= 0) return 1;
    return Phaser.Math.Clamp(1 - this.specialCooldownMs / Math.max(1, this.specialMaxCooldownMs), 0, 1);
  }

  public switchHero(targetHero?: HeroId): HeroId {
    const next: HeroId = targetHero ?? (this.heroId === 'zhangfei' ? 'zhaoyun' : 'zhangfei');
    if (next === this.heroId) return this.heroId;

    this.cancelAttack();
    this.cancelCharge();
    this.heroId = next;

    const prof = this.profile;
    const hpRatio = this.hp / Math.max(1, this.maxHp);
    this.maxHp = prof.maxHp;
    this.hp = Math.max(1, Math.round(this.maxHp * hpRatio));
    this.specialCooldownMs = 0;
    this.specialMaxCooldownMs =
      next === 'zhangfei' ? this.step4.chargeCooldownMs : 3200;

    if (next === 'zhangfei') {
      this.sprite.setTexture('zhangfei_sheet', ZHANGFEI_FRAME.IDLE);
      this.sprite.setScale(this.zhangFeiScale);
    } else {
      this.sprite.setTexture('zhaoyun_8dir', this.angleToSector(this.facingAngle));
      this.sprite.setScale(this.zhaoYunDirScale);
    }
    this.sprite.clearTint();
    this.syncTransform();
    return this.heroId;
  }

  public triggerSpecial(input: MoveInputState, ignoreCooldown = false): boolean {
    if (this.isDefeated || this.isCharging) return false;

    const onCooldown = !ignoreCooldown && !this.step4.chargeNoCooldown && this.specialCooldownMs > 0;
    if (onCooldown) {
      this.callbacks.onSpecialCooldownRejected();
      return false;
    }

    // Drop carried object cleanly before unleashing signature special
    if (this.isCarrying) {
      this.dropCarriedObject();
    }
    this.cancelAttack();

    if (input.isMoving) {
      this.facingAngle = Math.atan2(input.y, input.x);
      this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
    }

    if (this.heroId === 'zhangfei') {
      // PHASE 1: ANTICIPATION (Roar & shoulder drop!)
      this.chargePhase = 'ANTICIPATION';
      this.chargeTimerMs = this.step4.chargeAnticipationMs;
      this.chargeDirX = Math.cos(this.facingAngle);
      this.chargeDirY = Math.sin(this.facingAngle);
      this.chargeEnergy = this.step4.chargeEnergy;
      this.chargeCurrentSpeed = 0;
      this.chargeDistanceTraveled = 0;
      this.specialMaxCooldownMs = this.step4.chargeCooldownMs;
      this.specialCooldownMs = this.step4.chargeNoCooldown ? 0 : this.step4.chargeCooldownMs;
      this.chargeHitTracker.beginAttack();
      this.callbacks.onZhangFeiRoar(this.x, this.y);
      return true;
    } else {
      // Zhao Yun's 청룡선풍 (360° whirlwind)
      this.whirlwindTimerMs = 280;
      this.specialMaxCooldownMs = 3200;
      this.specialCooldownMs = this.step4.chargeNoCooldown ? 0 : 3200;
      this.callbacks.onZhaoYunWhirlwind(this.x, this.y);
      return true;
    }
  }

  /**
   * Called when Zhang Fei's bulldozer charge smashes into a bandit or heavy obstacle.
   */
  public consumeChargeEnergy(amount: number, hardStop = false): void {
    if (this.chargePhase !== 'CHARGING') return;
    this.chargeEnergy = Math.max(0, this.chargeEnergy - amount);
    if (hardStop || this.chargeEnergy <= 0) {
      this.enterChargeRecovery();
    } else {
      // Slight momentum dip on collision while continuing to plow through!
      this.chargeCurrentSpeed = Math.max(
        this.step4.chargeMaxSpeed * 0.55,
        this.chargeCurrentSpeed * 0.86,
      );
    }
  }

  public pickUpObject(obj: EnvironmentalObject): boolean {
    if (this.isDefeated || this.isCarrying || this.isAttacking || this.isCharging) return false;
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
    obj.throwInDirection(dirX, dirY, throwForce * (this.heroId === 'zhangfei' ? 1.12 : 1.0));
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

  public bufferInput(input: MoveInputState): void {
    if (this.isDefeated || this.isCarrying || this.isCharging) return;
    if (input.heavyAttackPressed) {
      this.bufferedAttack = 'HEAVY';
    } else if (input.lightAttackPressed) {
      this.bufferedAttack = 'LIGHT';
    }
  }

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
    // Zhang Fei has super-armor during active bulldozer charge!
    if (this.isDefeated || this.invulnTimerMs > 0 || this.chargePhase === 'CHARGING') {
      return false;
    }

    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnTimerMs = 650;
    this.hurtFlashTimerMs = 120;

    const len = Math.hypot(dirX, dirY) || 1;
    this.knockbackVx = (dirX / len) * 200;
    this.knockbackVy = (dirY / len) * 200 * PERSPECTIVE_CONFIG.verticalMoveRatio;

    if (this.attackPhase === 'WINDUP') {
      this.cancelAttack();
    }

    this.callbacks.onPlayerHurt(dmg, this.hp, this.maxHp);

    if (this.hp <= 0) {
      this.isDefeated = true;
      this.dropCarriedObject();
      this.cancelAttack();
      this.cancelCharge();
      this.callbacks.onPlayerDefeated();
    }
    return true;
  }

  public reset(spawnX: number, spawnY: number, heroId?: HeroId): void {
    if (heroId) this.heroId = heroId;
    this.carriedObject = null;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.vx = 0;
    this.vy = 0;
    this.knockbackVx = 0;
    this.knockbackVy = 0;
    this.facingAngle = Math.PI / 2;
    this.facingLabel = 'S';
    this.maxHp = this.profile.maxHp;
    this.hp = this.maxHp;
    this.isDefeated = false;
    this.invulnTimerMs = 0;
    this.hurtFlashTimerMs = 0;
    this.comboStep = 0;
    this.comboWindowTimerMs = 0;
    this.bufferedAttack = null;
    this.specialCooldownMs = 0;
    this.whirlwindTimerMs = 0;
    this.cancelAttack();
    this.cancelCharge();
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
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.invulnTimerMs > 0) this.invulnTimerMs = Math.max(0, this.invulnTimerMs - deltaMs);
    if (this.hurtFlashTimerMs > 0) this.hurtFlashTimerMs = Math.max(0, this.hurtFlashTimerMs - deltaMs);
    if (this.specialCooldownMs > 0) this.specialCooldownMs = Math.max(0, this.specialCooldownMs - deltaMs);
    if (this.whirlwindTimerMs > 0) this.whirlwindTimerMs = Math.max(0, this.whirlwindTimerMs - deltaMs);

    if (this.attackPhase === 'NONE' && this.comboWindowTimerMs > 0) {
      this.comboWindowTimerMs = Math.max(0, this.comboWindowTimerMs - deltaMs);
      if (this.comboWindowTimerMs <= 0) this.comboStep = 0;
    }

    if (this.isDefeated) {
      this.vx *= Math.exp(-8 * dt);
      this.vy *= Math.exp(-8 * dt);
      this.sprite.rotation = Math.PI * 0.45;
      this.sprite.y = 14;
      this.syncTransform();
      return;
    }

    // Handle Zhang Fei's 맹장돌진 (Bulldozer Charge) state machine
    if (this.isCharging) {
      this.updateCharge(deltaMs, dt, resolveProps);
      this.updateAnimation(dt, deltaMs);
      this.syncTransform();
      return;
    }

    this.stepAttackStateMachine(deltaMs, input);

    const speedFactor = getDepthSpeedFactor(this.y);
    const attackMoveMul = this.currentAttack ? this.currentAttack.moveSpeedFactor : 1.0;
    const carryMoveMul = this.carriedObject ? this.carriedObject.spec.carrySpeedFactor : 1.0;
    const heroSpeedMul = this.profile.speedMultiplier;

    const targetVx =
      input.x * PLAYER_CONFIG.baseMoveSpeed * heroSpeedMul * speedFactor * attackMoveMul * carryMoveMul;
    const targetVy =
      input.y *
      PLAYER_CONFIG.baseMoveSpeed *
      heroSpeedMul *
      PERSPECTIVE_CONFIG.verticalMoveRatio *
      speedFactor *
      attackMoveMul *
      carryMoveMul;

    const rate = input.isMoving ? PLAYER_CONFIG.accelRate : PLAYER_CONFIG.decelRate;
    const maxStep = rate * dt;

    this.vx = this.approach(this.vx, targetVx, maxStep);
    this.vy = this.approach(this.vy, targetVy, maxStep);

    if (input.isMoving && (this.attackPhase === 'NONE' || this.attackPhase === 'RECOVERY')) {
      this.facingAngle = Math.atan2(input.y, input.x);
      this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
    }

    let lungeVx = 0;
    let lungeVy = 0;
    if (this.attackPhase === 'ACTIVE' && this.currentAttack) {
      const lunge = this.currentAttack.lungeSpeed * speedFactor;
      lungeVx = this.attackDirX * lunge;
      lungeVy = this.attackDirY * lunge * PERSPECTIVE_CONFIG.verticalMoveRatio;
    }

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

    if (this.carriedObject) {
      if (this.carriedObject.isBroken) {
        this.carriedObject = null;
      } else {
        this.carriedObject.syncToCarrier(this.x, this.y);
      }
    }
  }

  private updateCharge(
    deltaMs: number,
    dt: number,
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    const speedFactor = getDepthSpeedFactor(this.y);

    if (this.chargePhase === 'ANTICIPATION') {
      this.vx *= Math.exp(-14 * dt);
      this.vy *= Math.exp(-14 * dt);
      this.chargeTimerMs -= deltaMs;
      if (this.chargeTimerMs <= 0) {
        this.chargePhase = 'CHARGING';
        this.chargeCurrentSpeed = this.step4.chargeMaxSpeed * 0.48;
        this.callbacks.onZhangFeiChargeRush(this.x, this.y, this.chargeDirX, this.chargeDirY);
      }
      return;
    }

    if (this.chargePhase === 'CHARGING') {
      // Explosive acceleration up to chargeMaxSpeed
      this.chargeCurrentSpeed = Math.min(
        this.step4.chargeMaxSpeed,
        this.chargeCurrentSpeed + this.step4.chargeAcceleration * dt,
      );

      this.vx = this.chargeDirX * this.chargeCurrentSpeed * speedFactor;
      this.vy =
        this.chargeDirY *
        this.chargeCurrentSpeed *
        PERSPECTIVE_CONFIG.verticalMoveRatio *
        speedFactor;

      const stepDx = this.vx * dt;
      const stepDy = this.vy * dt;
      const nextX = this.x + stepDx;
      const nextY = this.y + stepDy;

      const afterProps = resolveProps(nextX, nextY, this.collisionRadius * this.currentScale);
      const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);

      const hitBoundary =
        Math.abs(clamped.x - nextX) > 2.5 || Math.abs(clamped.y - nextY) > 2.5;

      this.x = clamped.x;
      this.y = clamped.y;
      this.chargeDistanceTraveled += Math.hypot(
        stepDx,
        stepDy / PERSPECTIVE_CONFIG.verticalMoveRatio,
      );

      // Continuous charge dust puffs
      if (this.dustCooldownMs <= 0) {
        this.spawnFootstepDust(1.35);
        this.callbacks.onFootstep(true);
        this.dustCooldownMs = 68;
      } else {
        this.dustCooldownMs -= deltaMs;
      }

      if (
        hitBoundary ||
        this.chargeDistanceTraveled >= this.step4.chargeMaxDistance ||
        this.chargeEnergy <= 0
      ) {
        this.enterChargeRecovery();
      }
      return;
    }

    if (this.chargePhase === 'RECOVERY') {
      // Skid to a stop with braking dust
      const brake = Math.exp(-10 * dt);
      this.vx *= brake;
      this.vy *= brake;
      const nextX = this.x + this.vx * dt;
      const nextY = this.y + this.vy * dt;
      const afterProps = resolveProps(nextX, nextY, this.collisionRadius * this.currentScale);
      const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);
      this.x = clamped.x;
      this.y = clamped.y;

      this.chargeTimerMs -= deltaMs;
      if (this.chargeTimerMs <= 0) {
        this.chargePhase = 'NONE';
        this.vx = 0;
        this.vy = 0;
      }
    }
  }

  private enterChargeRecovery(): void {
    this.chargePhase = 'RECOVERY';
    this.chargeTimerMs = this.step4.chargeRecoveryMs;
    this.spawnFootstepDust(1.6);
    this.callbacks.onZhangFeiChargeSkid(this.x, this.y);
  }

  private cancelCharge(): void {
    this.chargePhase = 'NONE';
    this.chargeTimerMs = 0;
    this.chargeCurrentSpeed = 0;
    this.chargeHitTracker.clear();
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
    if (this.hurtFlashTimerMs > 0) {
      this.sprite.setTintFill(0xffffff);
    } else if (this.chargePhase === 'ANTICIPATION') {
      this.sprite.setTint(0xfef08a);
    } else if (this.chargePhase === 'CHARGING') {
      this.sprite.setTint(0xe9d5ff);
    } else if (this.attackPhase === 'WINDUP' && this.currentAttack?.isHeavy) {
      this.sprite.setTint(0xbbeeff);
    } else {
      this.sprite.clearTint();
    }

    if (this.invulnTimerMs > 0 && this.hurtFlashTimerMs <= 0) {
      this.container.setAlpha(Math.floor(this.invulnTimerMs / 60) % 2 === 0 ? 1 : 0.48);
    } else {
      this.container.setAlpha(1);
    }

    if (this.heroId === 'zhangfei') {
      this.updateZhangFeiVisuals(dt, deltaMs);
    } else {
      this.updateZhaoYunVisuals(dt, deltaMs);
    }
  }

  private updateZhangFeiVisuals(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;
    if (this.dustCooldownMs > 0) this.dustCooldownMs -= deltaMs;

    const faceLeft = this.isCharging
      ? this.chargeDirX < -0.15
      : this.isAttacking
        ? this.attackDirX < -0.15
        : Math.cos(this.facingAngle) < -0.15;

    let frame: number = ZHANGFEI_FRAME.IDLE;
    let sx = this.zhangFeiScale;
    let sy = this.zhangFeiScale;
    let rot = 0;
    let yOff = 6;

    if (this.chargePhase === 'ANTICIPATION') {
      frame = ZHANGFEI_FRAME.CHARGE_ROAR;
      sx = this.zhangFeiScale * 1.14;
      sy = this.zhangFeiScale * 0.86;
      rot = (faceLeft ? 1 : -1) * 0.1;
      yOff = 9;
    } else if (this.chargePhase === 'CHARGING') {
      frame = ZHANGFEI_FRAME.CHARGE_RUSH;
      sx = this.zhangFeiScale * 1.18;
      sy = this.zhangFeiScale * 0.92;
      rot = (faceLeft ? -1 : 1) * 0.14;
      yOff = 5;
    } else if (this.chargePhase === 'RECOVERY') {
      frame = ZHANGFEI_FRAME.CHARGE_SKID;
      sx = this.zhangFeiScale * 1.08;
      sy = this.zhangFeiScale * 0.94;
      rot = (faceLeft ? 1 : -1) * 0.12;
    } else if (this.currentAttack && this.attackPhase !== 'NONE') {
      frame =
        this.currentAttack.isHeavy || this.currentAttack.isFinisher
          ? ZHANGFEI_FRAME.HEAVY
          : ZHANGFEI_FRAME.SWING;
      if (this.attackPhase === 'ACTIVE') {
        sx = this.zhangFeiScale * 1.14;
        sy = this.zhangFeiScale * 0.92;
      }
    } else if (isMoving) {
      this.walkBobPhase += dt * 13;
      frame = Math.floor(this.walkBobPhase) % 2 === 0 ? ZHANGFEI_FRAME.RUN_A : ZHANGFEI_FRAME.RUN_B;
      yOff = 6 - Math.abs(Math.sin(this.walkBobPhase)) * 5;
      rot = Math.cos(this.walkBobPhase) * 0.06;
      if (this.dustCooldownMs <= 0 && currentSpeed > 90) {
        this.spawnFootstepDust(1.1);
        this.callbacks.onFootstep(true);
        this.dustCooldownMs = 210;
      }
    } else {
      this.idleBreathPhase += dt * 3.0;
      const b = Math.sin(this.idleBreathPhase) * 0.022;
      sx = this.zhangFeiScale * (1 - b * 0.5);
      sy = this.zhangFeiScale * (1 + b);
    }

    if (this.sprite.texture.key !== 'zhangfei_sheet') {
      this.sprite.setTexture('zhangfei_sheet', frame);
    } else {
      this.sprite.setFrame(frame);
    }
    this.sprite.setFlipX(faceLeft);
    this.sprite.setScale(sx, sy);
    this.sprite.rotation = rot;
    this.sprite.y = yOff;
    this.shadow.setScale(1.12, 1.08);
  }

  private updateZhaoYunVisuals(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;
    if (this.dustCooldownMs > 0) this.dustCooldownMs -= deltaMs;

    if (this.whirlwindTimerMs > 0) {
      if (this.sprite.texture.key !== 'zhaoyun_actions') {
        this.sprite.setTexture('zhaoyun_actions', ZHAOYUN_ACTION_FRAME.WHIRLWIND);
      } else {
        this.sprite.setFrame(ZHAOYUN_ACTION_FRAME.WHIRLWIND);
      }
      this.sprite.setFlipX(Math.floor(this.whirlwindTimerMs / 55) % 2 === 0);
      this.sprite.setScale(this.zhaoYunActionScale * 1.08);
      this.sprite.rotation = 0;
      this.sprite.y = 6;
      return;
    }

    if (this.currentAttack && this.attackPhase !== 'NONE') {
      let frame: number = ZHAOYUN_ACTION_FRAME.LIGHT_1;
      if (this.currentAttack.type === 'LIGHT_1') frame = ZHAOYUN_ACTION_FRAME.LIGHT_1;
      else if (this.currentAttack.type === 'LIGHT_2') frame = ZHAOYUN_ACTION_FRAME.LIGHT_2;
      else if (this.currentAttack.type === 'LIGHT_3') frame = ZHAOYUN_ACTION_FRAME.LIGHT_3;
      else if (this.currentAttack.type === 'HEAVY') {
        frame =
          this.attackPhase === 'WINDUP'
            ? ZHAOYUN_ACTION_FRAME.HEAVY_WINDUP
            : ZHAOYUN_ACTION_FRAME.HEAVY_ACTIVE;
      }

      if (this.sprite.texture.key !== 'zhaoyun_actions') {
        this.sprite.setTexture('zhaoyun_actions', frame);
      } else {
        this.sprite.setFrame(frame);
      }

      const flipX = this.attackDirX < -0.15;
      this.sprite.setFlipX(flipX);

      let sx = this.zhaoYunActionScale;
      let sy = this.zhaoYunActionScale;
      let rot = 0;
      if (this.attackPhase === 'WINDUP') {
        sx = this.zhaoYunActionScale * (this.currentAttack.isHeavy ? 0.9 : 0.95);
        sy = this.zhaoYunActionScale * (this.currentAttack.isHeavy ? 1.08 : 1.04);
        rot = (flipX ? 1 : -1) * (this.currentAttack.isHeavy ? 0.14 : 0.06);
      } else if (this.attackPhase === 'ACTIVE') {
        sx = this.zhaoYunActionScale * (this.currentAttack.isHeavy ? 1.18 : 1.1);
        sy = this.zhaoYunActionScale * (this.currentAttack.isHeavy ? 0.9 : 0.95);
        rot = (flipX ? -1 : 1) * (this.currentAttack.isHeavy ? 0.12 : 0.06);
      }

      this.sprite.setScale(sx, sy);
      this.sprite.rotation = rot;
      this.sprite.y = 6;
      this.shadow.setScale(1, 1);
      return;
    }

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
        this.sprite.setScale(this.zhaoYunRunScale);
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
          this.zhaoYunDirScale * (1 + squash),
          this.zhaoYunDirScale * (1 - squash),
        );
      }

      const shadowPulse = 1 - Math.abs(Math.sin(this.walkBobPhase)) * 0.07;
      this.shadow.setScale(shadowPulse, shadowPulse);

      if (this.dustCooldownMs <= 0 && currentSpeed > 95) {
        this.spawnFootstepDust(1.0);
        this.callbacks.onFootstep(false);
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
        Phaser.Math.Linear(this.sprite.scaleX, this.zhaoYunDirScale * (1 - breath * 0.5), 0.22),
        Phaser.Math.Linear(this.sprite.scaleY, this.zhaoYunDirScale * (1 + breath), 0.22),
      );
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.24);
      this.sprite.y = Phaser.Math.Linear(this.sprite.y, 6, 0.24);
      this.shadow.setScale(1, 1);
    }
  }

  private spawnFootstepDust(sizeMul = 1.0): void {
    if (!this.scene.textures.exists('dust_puff')) return;

    const scale = this.currentScale * sizeMul;
    const dust = this.scene.add.image(
      this.x + Phaser.Math.Between(-8, 8) * scale,
      this.y + 2,
      'dust_puff',
    );
    dust.setDepth(getDepthOrder(this.y) - 1);
    dust.setScale(0.55 * scale);
    dust.setAlpha(0.6);

    this.scene.tweens.add({
      targets: dust,
      x: dust.x - this.vx * 0.08,
      y: dust.y - 6 * scale,
      scale: 1.1 * scale,
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
