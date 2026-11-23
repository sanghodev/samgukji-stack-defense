import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG, PLAYER_CONFIG } from '../config/arenaConfig';
import { ATTACK_SPECS, AttackSpec, AttackType, CombatTuning } from '../config/combatConfig';
import {
  HERO_DATA,
  HeroDataSpec,
  HeroId,
  SlotControlType,
  Step5Tuning,
} from '../config/heroConfig';
import { Step4Tuning } from '../config/step4Config';
import {
  ComputedHeroModifiers,
  computeHeroModifiers,
  createBaseHeroModifiers,
  TREASURE_BY_ID,
} from '../config/treasureConfig';
import { CombatHitTracker, MeleeHitboxQuery } from '../core/CombatMath';
import {
  clampToArena,
  getDepthOrder,
  getDepthRatio,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';
import { HeroActionInput } from '../systems/MultiInputManager';
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

const GUANYU_FRAME = {
  IDLE: 0,
  RUN_A: 1,
  RUN_B: 2,
  SWEEP_1: 3,
  SWEEP_2: 4,
  HEAVY: 5,
  CYCLONE_A: 6,
  CYCLONE_B: 7,
} as const;

const HUANGZHONG_FRAME = {
  IDLE: 0,
  RUN_A: 1,
  RUN_B: 2,
  DRAW: 3,
  RELEASE: 4,
  HEAVY_DRAW: 5,
  BURST: 6,
  READY: 7,
} as const;

const PLAYER_BADGE_COLORS = ['#38bdf8', '#22c55e', '#f97316', '#facc15'] as const;

export interface ArrowFireRequest {
  hero: Warrior;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  penetrating: boolean;
  isBurst: boolean;
}

export interface WarriorCombatCallbacks {
  onFootstep: (hero: Warrior, heavy: boolean) => void;
  onAttackActiveStart: (
    hero: Warrior,
    attackType: AttackType,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    range: number,
  ) => void;
  onFireArrow: (req: ArrowFireRequest) => void;
  onZhangFeiRoar: (hero: Warrior) => void;
  onZhangFeiChargeRush: (hero: Warrior) => void;
  onZhangFeiChargeSkid: (hero: Warrior) => void;
  onWhiteDragonStrike: (hero: Warrior, strikeIndex: number, isFinal: boolean) => void;
  onGuanYuCyclonePulse: (hero: Warrior, isFinal: boolean) => void;
  onHuangZhongBurst: (hero: Warrior) => void;
  onSpecialCooldownRejected: (hero: Warrior) => void;
  onHeroHurt: (hero: Warrior, damage: number) => void;
  onHeroDefeated: (hero: Warrior) => void;
}

/**
 * Shared 4-Hero entity (Zhao Yun, Guan Yu, Zhang Fei, Huang Zhong).
 * Identical combat rules, hitboxes, cooldowns, and physics apply whether controlled
 * by a Human (Keyboard/Gamepad) or AIHeroController.
 */
export class Warrior {
  public readonly id: string;
  public readonly heroId: HeroId;
  public readonly collisionRadius = PLAYER_CONFIG.collisionRadius;
  public readonly container: Phaser.GameObjects.Container;
  public readonly hitTracker = new CombatHitTracker();
  public readonly chargeHitTracker = new CombatHitTracker();

  public slotIndex: number;
  public controlType: SlotControlType;
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

  // Combat state
  public attackPhase: AttackPhase = 'NONE';
  public currentAttack: AttackSpec | null = null;
  public attackDirX = 0;
  public attackDirY = 1;

  // Step 3 Carried object
  public carriedObject: EnvironmentalObject | null = null;

  // Step 4-5 Signature Special states
  public chargePhase: ChargePhase = 'NONE';
  public chargeDirX = 1;
  public chargeDirY = 0;
  public chargeEnergy = 0;
  public chargeCurrentSpeed = 0;
  public specialCooldownMs = 0;
  public specialMaxCooldownMs: number;

  // Step 6 Per-Hero Treasure Evolution State
  public readonly acquiredTreasures: string[] = [];
  public heroMods: ComputedHeroModifiers = createBaseHeroModifiers();

  // Zhao Yun White Dragon Rush (백룡연격) & Guan Yu Cyclone (청룡선풍참)
  private whiteDragonTimerMs = 0;
  private whiteDragonStrikesLeft = 0;
  private whiteDragonStrikeTickMs = 0;
  private whiteDragonDirX = 1;
  private whiteDragonDirY = 0;

  private cycloneTimerMs = 0;
  private cyclonePulseTickMs = 0;
  private cyclonePulsesLeft = 0;

  private readonly scene: Phaser.Scene;
  private readonly tuning: CombatTuning;
  private readonly step4: Step4Tuning;
  private readonly step5: Step5Tuning;
  private readonly callbacks: WarriorCombatCallbacks;
  private readonly groundRing: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly tagText: Phaser.GameObjects.Text;

  private readonly zhaoYunDirScale = 0.78;
  private readonly zhaoYunRunScale = 0.68;
  private readonly zhaoYunActionScale = 0.68;
  private readonly customSheetScale = 0.72;

  private phaseTimerMs = 0;
  private comboStep = 0;
  private comboWindowTimerMs = 0;
  private bufferedAttack: 'LIGHT' | 'HEAVY' | null = null;

  private chargeTimerMs = 0;
  private chargeDistanceTraveled = 0;

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
    heroId: HeroId,
    slotIndex: number,
    controlType: SlotControlType,
    spawnX: number,
    spawnY: number,
    tuning: CombatTuning,
    step4: Step4Tuning,
    step5: Step5Tuning,
    callbacks: WarriorCombatCallbacks,
  ) {
    this.scene = scene;
    this.id = `hero_${heroId}`;
    this.heroId = heroId;
    this.slotIndex = slotIndex;
    this.controlType = controlType;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.tuning = tuning;
    this.step4 = step4;
    this.step5 = step5;
    this.callbacks = callbacks;

    const prof = this.profile;
    this.maxHp = prof.maxHp;
    this.hp = prof.maxHp;
    this.specialMaxCooldownMs = prof.specialCooldownMs;

    // Subtle colored ground ring for instant 4-hero visual clarity
    this.groundRing = scene.add.graphics();
    this.groundRing.lineStyle(2.5, prof.accentHex, 0.72);
    this.groundRing.strokeEllipse(0, 2, 58, 22);

    this.shadow = scene.add.ellipse(0, 2, 52, 17, 0x1a120b, 0.42);

    const initTex =
      heroId === 'zhaoyun'
        ? 'zhaoyun_8dir'
        : heroId === 'guanyu'
          ? 'guanyu_sheet'
          : heroId === 'zhangfei'
            ? 'zhangfei_sheet'
            : 'huangzhong_sheet';

    this.sprite = scene.add.sprite(0, 6, initTex, heroId === 'zhaoyun' ? 2 : 0);
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(
      heroId === 'zhaoyun' ? this.zhaoYunDirScale : this.customSheetScale,
    );

    // Compact non-obstructive P1/P2/P3/P4 or AI marker high above head
    this.tagText = scene.add
      .text(0, -86, '', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: 'rgba(11,16,27,0.78)',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5);

    this.container = scene.add.container(this.x, this.y, [
      this.groundRing,
      this.shadow,
      this.sprite,
      this.tagText,
    ]);

    this.updateControlBadge();
    this.syncTransform();
  }

  public get profile(): HeroDataSpec {
    return HERO_DATA[this.heroId];
  }

  public get isHumanControlled(): boolean {
    return this.controlType === 'HUMAN';
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
    return (
      this.attackPhase !== 'NONE' ||
      this.whiteDragonTimerMs > 0 ||
      this.cycloneTimerMs > 0
    );
  }

  public get isCharging(): boolean {
    return this.chargePhase !== 'NONE';
  }

  public get isChargeActive(): boolean {
    return this.chargePhase === 'CHARGING';
  }

  public get isHitboxActive(): boolean {
    return !this.profile.isRanged && this.attackPhase === 'ACTIVE' && this.currentAttack !== null;
  }

  public get isCarrying(): boolean {
    return this.carriedObject !== null && !this.carriedObject.isBroken;
  }

  public get specialReadyRatio(): number {
    if (this.step4.chargeNoCooldown || this.specialCooldownMs <= 0) return 1;
    return Phaser.Math.Clamp(
      1 - this.specialCooldownMs / Math.max(1, this.specialMaxCooldownMs),
      0,
      1,
    );
  }

  public setOwnership(slotIndex: number, controlType: SlotControlType): void {
    this.slotIndex = slotIndex;
    this.controlType = controlType;
    this.updateControlBadge();
  }

  public setFacingToward(dirX: number, dirY: number): void {
    if (Math.hypot(dirX, dirY) < 0.05) return;
    this.facingAngle = Math.atan2(dirY, dirX);
    this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
  }

  private updateControlBadge(): void {
    if (this.controlType === 'HUMAN') {
      const col = PLAYER_BADGE_COLORS[this.slotIndex % PLAYER_BADGE_COLORS.length];
      this.tagText.setText(`P${this.slotIndex + 1}`);
      this.tagText.setColor(col);
      this.tagText.setAlpha(0.95);
    } else {
      this.tagText.setText('AI');
      this.tagText.setColor('#94a3b8');
      this.tagText.setAlpha(0.75);
    }
  }

  public addTreasure(treasureId: string): boolean {
    const def = TREASURE_BY_ID.get(treasureId);
    if (!def) return false;
    if (def.heroId !== 'ANY' && def.heroId !== this.heroId) return false;
    if (treasureId !== 'shared_peach' && this.acquiredTreasures.includes(treasureId)) {
      return false;
    }
    this.acquiredTreasures.push(treasureId);
    this.heroMods = computeHeroModifiers(this.acquiredTreasures);

    const newMaxHp = this.profile.maxHp + this.heroMods.maxHpBonus;
    const hpDiff = Math.max(0, newMaxHp - this.maxHp);
    this.maxHp = newMaxHp;
    if (hpDiff > 0) this.hp = Math.min(this.maxHp, this.hp + hpDiff);
    if (def.modifiers.healAmount) {
      this.heal(def.modifiers.healAmount);
    }
    return true;
  }

  public resetTreasures(): void {
    this.acquiredTreasures.length = 0;
    this.heroMods = createBaseHeroModifiers();
    this.maxHp = this.profile.maxHp;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  public heal(amount: number): void {
    if (this.isDefeated) return;
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, Math.round(amount)));
  }

  public revive(hpRatio = 0.55): void {
    if (!this.isDefeated) return;
    this.isDefeated = false;
    this.hp = Math.max(20, Math.round(this.maxHp * hpRatio));
    this.invulnTimerMs = 1500;
    this.sprite.rotation = 0;
    this.sprite.y = 6;
    this.container.setAlpha(1);
    this.syncTransform();
  }

  public triggerSpecial(input: HeroActionInput, ignoreCooldown = false): boolean {
    if (this.isDefeated || this.isCharging || this.whiteDragonTimerMs > 0 || this.cycloneTimerMs > 0) {
      return false;
    }

    const onCooldown =
      !ignoreCooldown && !this.step4.chargeNoCooldown && this.specialCooldownMs > 0;
    if (onCooldown) {
      this.callbacks.onSpecialCooldownRejected(this);
      return false;
    }

    if (this.isCarrying) this.dropCarriedObject();
    this.cancelAttack();

    if (input.isMoving) {
      this.setFacingToward(input.x, input.y);
    }

    const baseCd =
      this.heroId === 'zhangfei'
        ? this.step4.chargeCooldownMs
        : this.profile.specialCooldownMs;
    const cd = Math.round(baseCd * this.heroMods.specialCooldownMultiplier);
    this.specialMaxCooldownMs = cd;
    this.specialCooldownMs = this.step4.chargeNoCooldown ? 0 : cd;

    switch (this.heroId) {
      case 'zhangfei': {
        // 맹장돌진 (Rampaging Charge)
        this.chargePhase = 'ANTICIPATION';
        this.chargeTimerMs = this.step4.chargeAnticipationMs;
        this.chargeDirX = Math.cos(this.facingAngle);
        this.chargeDirY = Math.sin(this.facingAngle);
        this.chargeEnergy = this.step4.chargeEnergy;
        this.chargeCurrentSpeed = 0;
        this.chargeDistanceTraveled = 0;
        this.chargeHitTracker.beginAttack();
        this.callbacks.onZhangFeiRoar(this);
        return true;
      }

      case 'zhaoyun': {
        // 백룡연격 (White Dragon Rush — rapid forward dash + multi-strikes!)
        this.whiteDragonDirX = Math.cos(this.facingAngle);
        this.whiteDragonDirY = Math.sin(this.facingAngle);
        this.whiteDragonStrikesLeft =
          3 + Math.max(0, this.step5.treasureMods.extraStrikes) + this.heroMods.specialExtraHits;
        this.whiteDragonTimerMs = this.whiteDragonStrikesLeft * 90 + 60;
        this.whiteDragonStrikeTickMs = 0;
        return true;
      }

      case 'guanyu': {
        // 청룡선풍참 (Azure Dragon Cyclone — wide sweeping emerald cyclone pulses!)
        const pulses = 3 + this.heroMods.specialExtraHits;
        this.cyclonePulsesLeft = pulses;
        this.cycloneTimerMs = pulses * 135 + 40;
        this.cyclonePulseTickMs = 0;
        return true;
      }

      case 'huangzhong': {
        // 만시제발 (Thousand Arrow Burst — wide golden spread volley in 2.5D!)
        this.callbacks.onHuangZhongBurst(this);
        this.attackPhase = 'RECOVERY';
        this.currentAttack = ATTACK_SPECS.LIGHT_2;
        this.phaseTimerMs = 150;
        return true;
      }
    }
  }

  public consumeChargeEnergy(amount: number, hardStop = false): void {
    if (this.chargePhase !== 'CHARGING') return;
    this.chargeEnergy = Math.max(0, this.chargeEnergy - amount);
    if (hardStop || this.chargeEnergy <= 0) {
      this.enterChargeRecovery();
    } else {
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
    const mult = (this.heroId === 'zhangfei' ? 1.12 : 1.0) * this.heroMods.throwPowerMultiplier;
    obj.throwInDirection(dirX, dirY, throwForce * mult);
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

  public bufferInput(input: HeroActionInput): void {
    if (
      this.isDefeated ||
      this.isCarrying ||
      this.isCharging ||
      this.whiteDragonTimerMs > 0 ||
      this.cycloneTimerMs > 0
    ) {
      return;
    }
    if (input.heavyAttackPressed) {
      this.bufferedAttack = 'HEAVY';
    } else if (input.lightAttackPressed) {
      this.bufferedAttack = 'LIGHT';
    }
  }

  public getActiveHitbox(): MeleeHitboxQuery | null {
    if (!this.isHitboxActive || !this.currentAttack) return null;
    const prof = this.profile;
    const heavyBonus = this.currentAttack.isHeavy ? 1 + this.heroMods.heavyPierceBonus : 1;
    return {
      originX: this.x,
      originY: this.y,
      dirX: this.attackDirX,
      dirY: this.attackDirY,
      range:
        (this.currentAttack.range * prof.rangeMultiplier * heavyBonus +
          this.step5.treasureMods.extraReach +
          this.heroMods.extraReach) *
        this.tuning.attackRangeMultiplier,
      halfWidth:
        this.currentAttack.halfWidth *
        prof.widthMultiplier *
        this.heroMods.attackArcMultiplier *
        this.tuning.attackRangeMultiplier,
      verticalRatio: PERSPECTIVE_CONFIG.verticalMoveRatio,
      backGrace: this.heroId === 'guanyu' ? 24 : 14,
    };
  }

  public takeDamage(amount: number, dirX: number, dirY: number): boolean {
    if (
      this.isDefeated ||
      this.invulnTimerMs > 0 ||
      this.chargePhase === 'CHARGING' ||
      this.whiteDragonTimerMs > 0
    ) {
      return false;
    }

    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnTimerMs = 650;
    this.hurtFlashTimerMs = 120;

    const len = Math.hypot(dirX, dirY) || 1;
    this.knockbackVx = (dirX / len) * 195;
    this.knockbackVy = (dirY / len) * 195 * PERSPECTIVE_CONFIG.verticalMoveRatio;

    if (this.attackPhase === 'WINDUP') this.cancelAttack();

    this.callbacks.onHeroHurt(this, dmg);

    if (this.hp <= 0) {
      this.isDefeated = true;
      this.dropCarriedObject();
      this.cancelAttack();
      this.cancelCharge();
      this.callbacks.onHeroDefeated(this);
    }
    return true;
  }

  public reset(spawnX: number, spawnY: number): void {
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
    this.whiteDragonTimerMs = 0;
    this.cycloneTimerMs = 0;
    this.cancelAttack();
    this.cancelCharge();
    this.container.setAlpha(1);
    this.sprite.clearTint();
    this.syncTransform();
  }

  public update(
    deltaMs: number,
    input: HeroActionInput,
    allHeroes: Warrior[],
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    const dt = Math.min(deltaMs, 50) * 0.001;
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.invulnTimerMs > 0) this.invulnTimerMs = Math.max(0, this.invulnTimerMs - deltaMs);
    if (this.hurtFlashTimerMs > 0) this.hurtFlashTimerMs = Math.max(0, this.hurtFlashTimerMs - deltaMs);
    if (this.specialCooldownMs > 0) this.specialCooldownMs = Math.max(0, this.specialCooldownMs - deltaMs);

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

    // 1. Zhang Fei Bulldozer Charge
    if (this.isCharging) {
      this.updateCharge(deltaMs, dt, resolveProps);
      this.updateAnimation(dt, deltaMs);
      this.syncTransform();
      return;
    }

    // 2. Zhao Yun White Dragon Rush (real world-space forward dash + multi-strikes!)
    if (this.whiteDragonTimerMs > 0) {
      this.whiteDragonTimerMs = Math.max(0, this.whiteDragonTimerMs - deltaMs);
      this.whiteDragonStrikeTickMs -= deltaMs;
      const spdFactor = getDepthSpeedFactor(this.y);
      const dashSpd = 520 * spdFactor;
      this.vx = this.whiteDragonDirX * dashSpd;
      this.vy = this.whiteDragonDirY * dashSpd * PERSPECTIVE_CONFIG.verticalMoveRatio;

      const nextX = this.x + this.vx * dt;
      const nextY = this.y + this.vy * dt;
      const afterProps = resolveProps(nextX, nextY, this.collisionRadius * this.currentScale);
      const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);
      this.x = clamped.x;
      this.y = clamped.y;

      if (this.whiteDragonStrikesLeft > 0 && this.whiteDragonStrikeTickMs <= 0) {
        const idx = 3 - this.whiteDragonStrikesLeft;
        this.whiteDragonStrikesLeft -= 1;
        this.whiteDragonStrikeTickMs = 90;
        this.callbacks.onWhiteDragonStrike(this, idx, this.whiteDragonStrikesLeft === 0);
      }

      this.updateAnimation(dt, deltaMs);
      this.syncTransform();
      return;
    }

    // 3. Guan Yu Azure Dragon Cyclone (wide spinning area pulses!)
    if (this.cycloneTimerMs > 0) {
      this.cycloneTimerMs = Math.max(0, this.cycloneTimerMs - deltaMs);
      this.cyclonePulseTickMs -= deltaMs;
      // Allow gentle drift movement while spinning
      const spdFactor = getDepthSpeedFactor(this.y);
      this.vx = input.x * 130 * spdFactor;
      this.vy = input.y * 130 * PERSPECTIVE_CONFIG.verticalMoveRatio * spdFactor;
      const clamped = clampToArena(
        this.x + this.vx * dt,
        this.y + this.vy * dt,
        this.collisionRadius,
      );
      this.x = clamped.x;
      this.y = clamped.y;

      if (this.cyclonePulsesLeft > 0 && this.cyclonePulseTickMs <= 0) {
        this.cyclonePulsesLeft -= 1;
        this.cyclonePulseTickMs = 135;
        this.callbacks.onGuanYuCyclonePulse(this, this.cyclonePulsesLeft === 0);
      }

      this.updateAnimation(dt, deltaMs);
      this.syncTransform();
      return;
    }

    this.stepAttackStateMachine(deltaMs, input);

    const speedFactor = getDepthSpeedFactor(this.y);
    const attackMoveMul = this.currentAttack ? this.currentAttack.moveSpeedFactor : 1.0;
    const carryMoveMul = this.carriedObject ? this.carriedObject.spec.carrySpeedFactor : 1.0;
    const heroSpeedMul = this.profile.speedMultiplier;

    // Soft ally separation so 4 heroes never block each other!
    let sepX = 0;
    let sepY = 0;
    for (const ally of allHeroes) {
      if (ally === this || ally.isDefeated) continue;
      const ox = this.x - ally.x;
      const oy = (this.y - ally.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const d = Math.hypot(ox, oy);
      if (d > 0.1 && d < 36) {
        const push = ((36 - d) / 36) * 95;
        sepX += (ox / d) * push;
        sepY += (oy / d) * push * PERSPECTIVE_CONFIG.verticalMoveRatio;
      }
    }

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
      this.setFacingToward(input.x, input.y);
    }

    let lungeVx = 0;
    let lungeVy = 0;
    if (this.attackPhase === 'ACTIVE' && this.currentAttack && !this.profile.isRanged) {
      const lunge = this.currentAttack.lungeSpeed * speedFactor;
      lungeVx = this.attackDirX * lunge;
      lungeVy = this.attackDirY * lunge * PERSPECTIVE_CONFIG.verticalMoveRatio;
    }

    const kbDamp = Math.exp(-12 * dt);
    this.knockbackVx *= kbDamp;
    this.knockbackVy *= kbDamp;
    if (Math.abs(this.knockbackVx) < 4) this.knockbackVx = 0;
    if (Math.abs(this.knockbackVy) < 4) this.knockbackVy = 0;

    const nextX = this.x + (this.vx + lungeVx + this.knockbackVx + sepX) * dt;
    const nextY = this.y + (this.vy + lungeVy + this.knockbackVy + sepY) * dt;

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
        this.callbacks.onZhangFeiChargeRush(this);
      }
      return;
    }

    if (this.chargePhase === 'CHARGING') {
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

      if (this.dustCooldownMs <= 0) {
        this.spawnFootstepDust(1.35);
        this.callbacks.onFootstep(this, true);
        this.dustCooldownMs = 68;
      } else {
        this.dustCooldownMs -= deltaMs;
      }

      const maxDist =
        this.step4.chargeMaxDistance *
        this.step5.treasureMods.chargeDistanceMul *
        this.heroMods.chargeDistanceMultiplier;
      if (hitBoundary || this.chargeDistanceTraveled >= maxDist || this.chargeEnergy <= 0) {
        this.enterChargeRecovery();
      }
      return;
    }

    if (this.chargePhase === 'RECOVERY') {
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
    this.callbacks.onZhangFeiChargeSkid(this);
  }

  private cancelCharge(): void {
    this.chargePhase = 'NONE';
    this.chargeTimerMs = 0;
    this.chargeCurrentSpeed = 0;
    this.chargeHitTracker.clear();
  }

  private stepAttackStateMachine(deltaMs: number, input: HeroActionInput): void {
    const speedScale = Math.max(
      0.4,
      this.tuning.attackSpeedMultiplier *
        this.profile.attackSpeedMultiplier *
        this.step5.heroAttackSpeedMultiplier *
        this.heroMods.attackSpeedMultiplier,
    );

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

      if (this.profile.isRanged) {
        // Huang Zhong fires 1, 2, or 3 2.5D arrows depending on Treasure Evolution!
        const arrowCount = Math.min(3, 1 + this.heroMods.extraProjectileCount);
        const baseAngle = Math.atan2(this.attackDirY, this.attackDirX);
        const spreadStep = this.heroMods.arrowSpreadWide ? 0.19 : 0.13;
        const penetrating = this.currentAttack.isHeavy || this.heroMods.piercingBasicArrows;

        for (let i = 0; i < arrowCount; i++) {
          const offset = (i - (arrowCount - 1) / 2) * spreadStep;
          const a = baseAngle + offset;
          this.callbacks.onFireArrow({
            hero: this,
            x: this.x + Math.cos(a) * 22,
            y: this.y + Math.sin(a) * 14,
            dirX: Math.cos(a),
            dirY: Math.sin(a),
            penetrating,
            isBurst: false,
          });
        }
      } else {
        const range =
          (this.currentAttack.range * this.profile.rangeMultiplier + this.heroMods.extraReach) *
          this.tuning.attackRangeMultiplier;
        this.callbacks.onAttackActiveStart(
          this,
          this.currentAttack.type,
          this.x,
          this.y,
          this.attackDirX,
          this.attackDirY,
          range,
        );
      }
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

  private startAttack(kind: 'LIGHT' | 'HEAVY', input: HeroActionInput): void {
    if (input.isMoving) {
      this.setFacingToward(input.x, input.y);
    }

    this.attackDirX = Math.cos(this.facingAngle);
    this.attackDirY = Math.sin(this.facingAngle);

    let attackType: AttackType;
    if (kind === 'HEAVY') {
      attackType = 'HEAVY';
      this.comboStep = 0;
    } else if (this.profile.isRanged) {
      attackType = 'LIGHT_1';
      this.comboStep = 0;
    } else {
      const extraHits = this.heroMods.comboExtraHit;
      if (this.comboStep === 0) {
        attackType = 'LIGHT_1';
        this.comboStep = 1;
      } else if (this.comboStep === 1) {
        attackType = 'LIGHT_2';
        this.comboStep = 2;
      } else if (this.comboStep === 2 && extraHits > 0) {
        // Extra fast combo strike unlocked by Zhao Yun Tier 1 / Guan Yu Tier 2!
        attackType = 'LIGHT_2';
        this.comboStep = 3;
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
    } else if (this.whiteDragonTimerMs > 0) {
      this.sprite.setTint(0xbae6fd);
    } else if (this.cycloneTimerMs > 0) {
      this.sprite.setTint(0xbbf7d0);
    } else {
      this.sprite.clearTint();
    }

    if (this.invulnTimerMs > 0 && this.hurtFlashTimerMs <= 0) {
      this.container.setAlpha(Math.floor(this.invulnTimerMs / 60) % 2 === 0 ? 1 : 0.48);
    } else {
      this.container.setAlpha(1);
    }

    if (this.heroId === 'zhaoyun') {
      this.updateZhaoYunVisuals(dt, deltaMs);
    } else {
      this.updateCustomHeroVisuals(dt, deltaMs);
    }
  }

  private updateCustomHeroVisuals(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;
    if (this.dustCooldownMs > 0) this.dustCooldownMs -= deltaMs;

    const faceLeft = this.isCharging
      ? this.chargeDirX < -0.15
      : this.isAttacking
        ? this.attackDirX < -0.15
        : Math.cos(this.facingAngle) < -0.15;

    let frame = 0;
    let sx = this.customSheetScale;
    let sy = this.customSheetScale;
    let rot = 0;
    let yOff = 6;

    if (this.heroId === 'zhangfei') {
      if (this.chargePhase === 'ANTICIPATION') {
        frame = ZHANGFEI_FRAME.CHARGE_ROAR;
        sx *= 1.14;
        sy *= 0.86;
        rot = (faceLeft ? 1 : -1) * 0.1;
        yOff = 9;
      } else if (this.chargePhase === 'CHARGING') {
        frame = ZHANGFEI_FRAME.CHARGE_RUSH;
        sx *= 1.18;
        sy *= 0.92;
        rot = (faceLeft ? -1 : 1) * 0.14;
      } else if (this.chargePhase === 'RECOVERY') {
        frame = ZHANGFEI_FRAME.CHARGE_SKID;
      } else if (this.currentAttack && this.attackPhase !== 'NONE') {
        frame =
          this.currentAttack.isHeavy || this.currentAttack.isFinisher
            ? ZHANGFEI_FRAME.HEAVY
            : ZHANGFEI_FRAME.SWING;
      } else if (isMoving) {
        this.walkBobPhase += dt * 13;
        frame = Math.floor(this.walkBobPhase) % 2 === 0 ? ZHANGFEI_FRAME.RUN_A : ZHANGFEI_FRAME.RUN_B;
        yOff = 6 - Math.abs(Math.sin(this.walkBobPhase)) * 5;
        rot = Math.cos(this.walkBobPhase) * 0.06;
      } else {
        this.idleBreathPhase += dt * 3.0;
        const b = Math.sin(this.idleBreathPhase) * 0.02;
        sx *= 1 - b * 0.5;
        sy *= 1 + b;
      }
    } else if (this.heroId === 'guanyu') {
      if (this.cycloneTimerMs > 0) {
        frame =
          Math.floor(this.cycloneTimerMs / 65) % 2 === 0
            ? GUANYU_FRAME.CYCLONE_A
            : GUANYU_FRAME.CYCLONE_B;
        sx *= 1.12;
      } else if (this.currentAttack && this.attackPhase !== 'NONE') {
        frame = this.currentAttack.isHeavy
          ? GUANYU_FRAME.HEAVY
          : this.currentAttack.type === 'LIGHT_2'
            ? GUANYU_FRAME.SWEEP_2
            : GUANYU_FRAME.SWEEP_1;
        if (this.attackPhase === 'ACTIVE') {
          sx *= 1.12;
          sy *= 0.94;
        }
      } else if (isMoving) {
        this.walkBobPhase += dt * 12;
        frame = Math.floor(this.walkBobPhase) % 2 === 0 ? GUANYU_FRAME.RUN_A : GUANYU_FRAME.RUN_B;
        yOff = 6 - Math.abs(Math.sin(this.walkBobPhase)) * 4.5;
        rot = Math.cos(this.walkBobPhase) * 0.05;
      } else {
        this.idleBreathPhase += dt * 2.8;
        const b = Math.sin(this.idleBreathPhase) * 0.018;
        sx *= 1 - b * 0.5;
        sy *= 1 + b;
      }
    } else {
      // Huang Zhong
      if (this.currentAttack && this.attackPhase !== 'NONE') {
        if (this.attackPhase === 'WINDUP') {
          frame = this.currentAttack.isHeavy
            ? HUANGZHONG_FRAME.HEAVY_DRAW
            : HUANGZHONG_FRAME.DRAW;
        } else {
          frame = HUANGZHONG_FRAME.RELEASE;
        }
      } else if (isMoving) {
        this.walkBobPhase += dt * 13.5;
        frame =
          Math.floor(this.walkBobPhase) % 2 === 0
            ? HUANGZHONG_FRAME.RUN_A
            : HUANGZHONG_FRAME.RUN_B;
        yOff = 6 - Math.abs(Math.sin(this.walkBobPhase)) * 4.5;
      } else {
        this.idleBreathPhase += dt * 3.0;
        const b = Math.sin(this.idleBreathPhase) * 0.018;
        sx *= 1 - b * 0.5;
        sy *= 1 + b;
      }
    }

    if (isMoving && this.dustCooldownMs <= 0 && currentSpeed > 90 && !this.isCharging) {
      this.spawnFootstepDust(this.heroId === 'zhangfei' ? 1.1 : 0.95);
      this.callbacks.onFootstep(this, this.heroId === 'zhangfei');
      this.dustCooldownMs = 210;
    }

    this.sprite.setFrame(frame);
    this.sprite.setFlipX(faceLeft);
    this.sprite.setScale(sx, sy);
    this.sprite.rotation = rot;
    this.sprite.y = yOff;
  }

  private updateZhaoYunVisuals(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;
    if (this.dustCooldownMs > 0) this.dustCooldownMs -= deltaMs;

    if (this.whiteDragonTimerMs > 0) {
      const f =
        Math.floor(this.whiteDragonTimerMs / 65) % 2 === 0
          ? ZHAOYUN_ACTION_FRAME.LIGHT_3
          : ZHAOYUN_ACTION_FRAME.HEAVY_ACTIVE;
      if (this.sprite.texture.key !== 'zhaoyun_actions') {
        this.sprite.setTexture('zhaoyun_actions', f);
      } else {
        this.sprite.setFrame(f);
      }
      this.sprite.setFlipX(this.whiteDragonDirX < -0.15);
      this.sprite.setScale(this.zhaoYunActionScale * 1.1, this.zhaoYunActionScale * 0.94);
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
      this.sprite.setScale(this.zhaoYunActionScale);
      this.sprite.rotation = 0;
      this.sprite.y = 6;
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
        this.sprite.y = 6 - Math.abs(Math.sin(this.walkBobPhase)) * 5.5;
        this.sprite.rotation = Math.cos(this.walkBobPhase) * 0.045;
        this.sprite.setScale(this.zhaoYunDirScale);
      }

      if (this.dustCooldownMs <= 0 && currentSpeed > 95) {
        this.spawnFootstepDust(1.0);
        this.callbacks.onFootstep(this, false);
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
        this.zhaoYunDirScale * (1 - breath * 0.5),
        this.zhaoYunDirScale * (1 + breath),
      );
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.24);
      this.sprite.y = Phaser.Math.Linear(this.sprite.y, 6, 0.24);
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
