import Phaser from 'phaser';
import { ARENA_BOUNDS, PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import {
  ENV_OBJECT_SPECS,
  EnvObjectKind,
  EnvObjectSpec,
  MayhemTuning,
} from '../config/mayhemConfig';
import {
  AirborneBodyState,
  CombatHitTracker,
  stepAirbornePhysics,
} from '../core/CombatMath';
import {
  clampToArena,
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';

export type EnvObjectState =
  | 'IDLE'
  | 'PICKED_UP'
  | 'CARRIED'
  | 'THROWN'
  | 'ROLLING'
  | 'IMPACT'
  | 'BROKEN';

export interface EnvObjectCallbacks {
  onWallHit: (obj: EnvironmentalObject) => void;
  onLanded: (obj: EnvironmentalObject, impactSpeed: number) => void;
  onBroken: (obj: EnvironmentalObject, dirX: number, dirY: number) => void;
  onRollTick: (obj: EnvironmentalObject) => void;
}

/**
 * Reusable interactive 2.5D environmental object:
 * - Wooden tables (pickupable, throwable, multi-hit, breakable)
 * - Wooden barrels (roll when struck, water barrels spill puddles on break)
 * - Ceramic jars (pickupable, shatter into crisp ceramic shards)
 * - Fruit baskets (pickupable, spill fruit & create slippery food/banana hazards)
 */
export class EnvironmentalObject {
  public readonly id: string;
  public readonly spec: EnvObjectSpec;
  public readonly container: Phaser.GameObjects.Container;
  public readonly hitTracker = new CombatHitTracker();

  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public elevationZ = 0;
  public vx = 0;
  public vy = 0;
  public vz = 0;

  public durability: number;
  public maxDurability: number;
  public state: EnvObjectState = 'IDLE';
  public ownerId: string | null = null;
  public readyForRemoval = false;

  private readonly scene: Phaser.Scene;
  private readonly tuning: MayhemTuning;
  private readonly callbacks: EnvObjectCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly bodyGfx: Phaser.GameObjects.Graphics;
  private readonly promptBadge: Phaser.GameObjects.Container;

  private spinAngle = 0;
  private spinSpeed = 0;
  private flashTimerMs = 0;
  private rollSoundTimerMs = 0;
  private lastImpactDirX = 1;
  private lastImpactDirY = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    kind: EnvObjectKind,
    spawnX: number,
    spawnY: number,
    tuning: MayhemTuning,
    callbacks: EnvObjectCallbacks,
  ) {
    this.scene = scene;
    this.id = id;
    this.spec = ENV_OBJECT_SPECS[kind];
    this.tuning = tuning;
    this.callbacks = callbacks;

    const clamped = clampToArena(spawnX, spawnY, this.spec.radius);
    this.x = clamped.x;
    this.y = clamped.y;
    this.prevX = this.x;
    this.prevY = this.y;

    this.maxDurability = Math.max(
      1,
      Math.round(this.spec.durability * tuning.objectDurabilityMultiplier),
    );
    this.durability = this.maxDurability;

    this.shadow = scene.add.ellipse(
      0,
      3,
      this.spec.radius * 2.15,
      this.spec.radius * 0.78,
      0x1a120b,
      0.38,
    );

    this.bodyGfx = scene.add.graphics();
    this.drawObjectArt();

    // Small crisp pickup indicator shown when Zhao Yun is within grab reach
    const pillBg = scene.add.rectangle(0, 0, 56, 18, 0x1c120c, 0.88);
    pillBg.setStrokeStyle(1, 0xfbbf24, 0.9);
    const pillTxt = scene.add
      .text(0, 0, 'SPACE', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5);
    this.promptBadge = scene.add
      .container(0, -this.spec.radius * 2.2 - 14, [pillBg, pillTxt])
      .setVisible(false);

    this.container = scene.add.container(this.x, this.y, [
      this.shadow,
      this.bodyGfx,
      this.promptBadge,
    ]);
    this.syncVisuals();
  }

  public get mass(): number {
    return this.spec.mass * this.tuning.objectMassMultiplier;
  }

  public get radius(): number {
    return this.spec.radius;
  }

  public get speed(): number {
    return Math.hypot(this.vx, this.vy / PERSPECTIVE_CONFIG.verticalMoveRatio);
  }

  public get isBroken(): boolean {
    return this.state === 'BROKEN';
  }

  public get canBePickedUp(): boolean {
    return (
      this.spec.pickupable &&
      this.ownerId === null &&
      this.state === 'IDLE' &&
      !this.isBroken
    );
  }

  public get isActiveProjectile(): boolean {
    return (
      (this.state === 'THROWN' || this.state === 'ROLLING') &&
      this.speed > 75 &&
      !this.isBroken
    );
  }

  public setPickupPromptVisible(show: boolean): void {
    this.promptBadge.setVisible(show && this.canBePickedUp);
  }

  public pickUpBy(ownerId: string): boolean {
    if (!this.canBePickedUp) return false;
    this.ownerId = ownerId;
    this.state = 'CARRIED';
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.elevationZ = 44;
    this.spinAngle = 0;
    this.spinSpeed = 0;
    this.promptBadge.setVisible(false);
    return true;
  }

  public syncToCarrier(carrierX: number, carrierY: number): void {
    if (this.state !== 'CARRIED') return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.x = carrierX;
    this.y = carrierY;
    this.elevationZ = 46;
    this.syncVisuals(getDepthOrder(carrierY) + 3);
  }

  public throwInDirection(dirX: number, dirY: number, throwForce: number): void {
    if (this.state !== 'CARRIED') return;
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;

    // Heavier objects travel slightly slower than light jars, yet still fast & exciting
    const weightAdjust = Phaser.Math.Clamp(1.18 - this.mass * 0.08, 0.78, 1.15);
    const speed = throwForce * weightAdjust;

    this.ownerId = null;
    this.state = 'THROWN';
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = nx * speed;
    this.vy = ny * speed * PERSPECTIVE_CONFIG.verticalMoveRatio;
    this.vz = 155;
    this.elevationZ = 38;
    this.spinSpeed = (nx >= 0 ? 1 : -1) * (this.spec.kind === 'table' ? 5.5 : 8.5);
    this.lastImpactDirX = nx;
    this.lastImpactDirY = ny;
    this.hitTracker.beginAttack();
  }

  public dropAt(x: number, y: number): void {
    if (this.state !== 'CARRIED') return;
    this.ownerId = null;
    this.state = 'IDLE';
    const clamped = clampToArena(x, y, this.spec.radius);
    this.x = clamped.x;
    this.y = clamped.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.elevationZ = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.spinAngle = 0;
    this.spinSpeed = 0;
    this.syncVisuals();
  }

  /**
   * Called when struck by Zhao Yun's spear, a flying bandit, or another object.
   */
  public applyStrike(
    dirX: number,
    dirY: number,
    force: number,
    durabilityLoss: number,
    isHeavy: boolean,
  ): void {
    if (this.isBroken || this.state === 'CARRIED') return;

    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    this.lastImpactDirX = nx;
    this.lastImpactDirY = ny;
    this.flashTimerMs = 85;

    this.durability = Math.max(0, this.durability - durabilityLoss);

    if (this.durability <= 0) {
      this.shatter(nx, ny);
      return;
    }

    // Barrels roll enthusiastically across the arena when hit!
    if (this.spec.rollable) {
      const rollSpd = Math.min(540, (force / Math.max(0.8, this.mass * 0.65)) * (isHeavy ? 1.25 : 1.0));
      this.vx = nx * rollSpd;
      this.vy = ny * rollSpd * PERSPECTIVE_CONFIG.verticalMoveRatio;
      this.state = 'ROLLING';
      this.spinSpeed = (nx >= 0 ? 1 : -1) * 9.5;
      this.hitTracker.beginAttack();
    } else {
      // Tables or sturdy props slide back a bit when struck directly
      const pushSpd = Math.min(340, force / Math.max(1, this.mass * 0.85));
      this.vx = nx * pushSpd;
      this.vy = ny * pushSpd * PERSPECTIVE_CONFIG.verticalMoveRatio;
      if (isHeavy) {
        this.vz = 120;
        this.elevationZ = Math.max(this.elevationZ, 4);
        this.state = 'THROWN';
        this.hitTracker.beginAttack();
      }
    }
  }

  /**
   * Absorbs collision impact when hitting an enemy or another object while moving.
   */
  public onProjectileImpact(durabilityDamage = 1, speedRetain = 0.68): void {
    if (this.isBroken) return;
    this.flashTimerMs = 70;
    this.vx *= speedRetain;
    this.vy *= speedRetain;
    this.durability = Math.max(0, this.durability - durabilityDamage);

    if (this.durability <= 0) {
      this.shatter(this.lastImpactDirX, this.lastImpactDirY);
    }
  }

  public shatter(dirX = 0, dirY = 0): void {
    if (this.isBroken) return;
    this.state = 'BROKEN';
    this.ownerId = null;
    this.durability = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.promptBadge.setVisible(false);
    this.readyForRemoval = true;
    this.callbacks.onBroken(this, dirX, dirY);
  }

  public update(
    deltaMs: number,
    resolveStaticProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    if (this.isBroken || this.state === 'CARRIED') return;

    const dt = Math.min(deltaMs, 50) * 0.001;
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.flashTimerMs > 0) {
      this.flashTimerMs = Math.max(0, this.flashTimerMs - deltaMs);
    }

    const isMoving =
      this.state === 'THROWN' ||
      this.state === 'ROLLING' ||
      Math.hypot(this.vx, this.vy) > 4 ||
      this.elevationZ > 0;

    if (isMoving) {
      const friction =
        (this.state === 'ROLLING' ? 2.1 : 5.4) * this.tuning.surfaceFriction;
      const body: AirborneBodyState = {
        x: this.x,
        y: this.y,
        vx: this.vx,
        vy: this.vy,
        elevationZ: this.elevationZ,
        vz: this.vz,
      };

      const step = stepAirbornePhysics(body, dt, 980, friction, 0.45);
      this.x = body.x;
      this.y = body.y;
      this.vx = body.vx;
      this.vy = body.vy;
      this.elevationZ = body.elevationZ;
      this.vz = body.vz;

      if (this.state === 'THROWN' || this.state === 'ROLLING') {
        this.spinAngle += this.spinSpeed * dt;
        this.spinSpeed *= Math.exp(-2.2 * dt);
      }

      if (this.state === 'ROLLING' && this.speed > 75) {
        this.rollSoundTimerMs -= deltaMs;
        if (this.rollSoundTimerMs <= 0) {
          this.callbacks.onRollTick(this);
          this.rollSoundTimerMs = 210;
        }
      }

      if (step.landed) {
        this.callbacks.onLanded(this, step.impactSpeed);
        if (this.state === 'THROWN') {
          // Fragile ceramic jars & fruit baskets shatter on hard ground impact!
          if (this.spec.material === 'ceramic' || this.spec.material === 'fruit') {
            this.shatter(this.lastImpactDirX, this.lastImpactDirY);
            return;
          }
          // Heavy wooden tables lose durability on slam and settle if slow
          this.durability = Math.max(0, this.durability - 1);
          if (this.durability <= 0) {
            this.shatter(this.lastImpactDirX, this.lastImpactDirY);
            return;
          }
          this.spinAngle = 0;
          this.spinSpeed = 0;
        }
      }

      // Check arena boundary collision (wall smash!)
      const bounds = getHorizontalBoundsAtY(this.y);
      const scale = getPerspectiveScale(this.y);
      const margin = this.spec.radius * scale;
      const hitWall =
        this.x <= bounds.left + margin + 2 ||
        this.x >= bounds.right - margin - 2 ||
        this.y <= ARENA_BOUNDS.backY + this.spec.radius * 0.45 + 2 ||
        this.y >= ARENA_BOUNDS.frontY - this.spec.radius * 0.45 - 2;

      const resolved = resolveStaticProps(this.x, this.y, this.spec.radius * scale);
      const clamped = clampToArena(resolved.x, resolved.y, this.spec.radius);
      this.x = clamped.x;
      this.y = clamped.y;

      if (hitWall && this.speed > 175) {
        this.callbacks.onWallHit(this);
        this.vx *= -0.35;
        this.vy *= -0.35;
        this.onProjectileImpact(1, 0.5);
        if (this.isBroken) return;
      }

      if (this.elevationZ <= 0 && this.speed < 28) {
        this.vx = 0;
        this.vy = 0;
        this.spinAngle = 0;
        this.spinSpeed = 0;
        this.state = 'IDLE';
      }
    }

    this.syncVisuals();
  }

  private drawObjectArt(): void {
    const g = this.bodyGfx;
    g.clear();

    switch (this.spec.kind) {
      case 'table': {
        // Classic 16-bit wooden tavern table (wide tabletop + 4 sturdy legs + wood grain)
        g.fillStyle(0x451a03, 1);
        g.fillRect(-26, -18, 6, 20);
        g.fillRect(20, -18, 6, 20);
        g.fillRect(-20, -24, 5, 16);
        g.fillRect(15, -24, 5, 16);
        // Tabletop front thickness
        g.fillStyle(0x78350f, 1);
        g.fillRect(-30, -24, 60, 9);
        // Sunlit tabletop surface
        g.fillStyle(0xb45309, 1);
        g.fillRect(-30, -34, 60, 12);
        g.fillStyle(0xd97706, 0.75);
        g.fillRect(-27, -32, 54, 4);
        // Wood plank grain lines
        g.lineStyle(1, 0x5c2b0e, 0.85);
        g.strokeRect(-30, -34, 60, 19);
        g.lineBetween(-28, -28, 28, -28);
        // Decorative bowl & tea cup on top of the tavern table!
        g.fillStyle(0xfef3c7, 1);
        g.fillRect(-14, -38, 10, 5);
        g.fillStyle(0xef4444, 1);
        g.fillRect(8, -39, 7, 6);
        break;
      }
      case 'barrel_water':
      case 'barrel_empty': {
        // Round wooden barrel with iron hoops
        g.fillStyle(0x78350f, 1);
        g.fillRoundedRect(-17, -36, 34, 38, 8);
        g.fillStyle(0x92400e, 1);
        g.fillRoundedRect(-14, -34, 28, 34, 6);
        // Vertical stave lines
        g.lineStyle(1, 0x451a03, 0.7);
        g.lineBetween(-6, -34, -6, 0);
        g.lineBetween(6, -34, 6, 0);
        // Dark iron bands
        g.fillStyle(0x334155, 1);
        g.fillRect(-17, -28, 34, 4);
        g.fillRect(-17, -11, 34, 4);
        // Top lid: bright cyan-blue water rim if water-filled!
        if (this.spec.containsWater) {
          g.fillStyle(0x0284c7, 1);
          g.fillEllipse(0, -34, 26, 10);
          g.fillStyle(0x7dd3fc, 0.9);
          g.fillEllipse(-3, -35, 14, 5);
        } else {
          g.fillStyle(0xb45309, 1);
          g.fillEllipse(0, -34, 26, 10);
        }
        break;
      }
      case 'ceramic_jar': {
        // Glazed terracotta / celadon Three Kingdoms ceramic jar
        g.fillStyle(0x9a3412, 1);
        g.fillCircle(0, -14, 15);
        g.fillStyle(0xc2410c, 1);
        g.fillCircle(-2, -16, 11);
        g.fillStyle(0xfdba74, 0.6);
        g.fillCircle(-5, -20, 4);
        // Neck & red cloth wine seal
        g.fillStyle(0xdc2626, 1);
        g.fillRect(-7, -31, 14, 6);
        g.fillStyle(0xfef08a, 1);
        g.fillRect(-6, -26, 12, 2);
        break;
      }
      case 'fruit_basket': {
        // Woven bamboo basket overflowing with peaches, apples, and bananas
        g.fillStyle(0x92400e, 1);
        g.fillRoundedRect(-18, -18, 36, 20, 5);
        g.fillStyle(0xd97706, 1);
        g.fillRect(-16, -16, 32, 14);
        g.lineStyle(1, 0x78350f, 0.85);
        g.lineBetween(-16, -11, 16, -11);
        g.lineBetween(-16, -6, 16, -6);
        // Colorful fruit pile on top
        g.fillStyle(0xef4444, 1);
        g.fillCircle(-8, -21, 6);
        g.fillStyle(0xf97316, 1);
        g.fillCircle(7, -21, 6);
        g.fillStyle(0xfacc15, 1);
        g.fillEllipse(0, -25, 13, 6);
        g.fillStyle(0x22c55e, 1);
        g.fillCircle(-1, -19, 4);
        break;
      }
    }
  }

  private syncVisuals(overrideDepth?: number): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(overrideDepth ?? getDepthOrder(this.y));

    this.bodyGfx.y = -this.elevationZ;
    this.bodyGfx.rotation = this.spinAngle;

    if (this.flashTimerMs > 0) {
      this.bodyGfx.setAlpha(0.65);
    } else {
      this.bodyGfx.setAlpha(1);
    }

    const shScale = Phaser.Math.Clamp(1 - this.elevationZ * 0.005, 0.4, 1);
    this.shadow.setScale(shScale, shScale);
    this.shadow.setAlpha(this.state === 'CARRIED' ? 0.15 : 0.38 * shScale);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
