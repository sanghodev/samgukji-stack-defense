import Phaser from 'phaser';
import {
  HEALTH_PICKUP_SPECS,
  HealthPickupKind,
  HealthPickupSpec,
} from '../core/HeroDefenseMath';
import {
  clampToArena,
  getDepthOrder,
  getPerspectiveScale,
} from '../core/Perspective';

/**
 * Arcade 2.5D Health Recovery Pickup (왕만두 / 붉은 체력약 / 황금 선약).
 * Pops into the air with a crisp bounce, hovers gently with a warm glow ring,
 * and heals injured heroes (or grants bonus points if everyone is full HP).
 */
export class HealthPickup {
  public readonly id: string;
  public readonly kind: HealthPickupKind;
  public readonly spec: HealthPickupSpec;
  public x: number;
  public y: number;
  public collected = false;
  public expired = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly glowRing: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;

  private vx: number;
  private vy: number;
  private elevationZ = 12;
  private vz = 235;
  private bounced = false;
  private ageMs = 0;
  private readonly maxLifetimeMs = 18000;

  constructor(
    scene: Phaser.Scene,
    id: string,
    kind: HealthPickupKind,
    spawnX: number,
    spawnY: number,
  ) {
    this.id = id;
    this.kind = kind;
    this.spec = HEALTH_PICKUP_SPECS[kind];

    const clamped = clampToArena(spawnX, spawnY, 26);
    this.x = clamped.x;
    this.y = clamped.y;

    const ang = Math.random() * Math.PI * 2;
    const spd = 48 + Math.random() * 44;
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd * 0.55;

    this.shadow = scene.add.ellipse(0, 4, 34, 12, 0x120a06, 0.42);
    this.glowRing = scene.add.ellipse(0, 2, 46, 18, this.spec.glowColor, 0.26);
    this.glowRing.setStrokeStyle(2, this.spec.glowColor, 0.85);

    const tex = scene.textures.exists('heal_items') ? 'heal_items' : 'mayhem_props';
    const frame = tex === 'heal_items' ? this.spec.frame : 5;
    this.sprite = scene.add.sprite(0, 0, tex, frame);
    this.sprite.setOrigin(0.5, 0.85);
    this.sprite.setScale(tex === 'heal_items' ? 0.58 : 0.46);

    this.container = scene.add.container(this.x, this.y, [
      this.shadow,
      this.glowRing,
      this.sprite,
    ]);
    this.syncVisuals();
  }

  public get isPickable(): boolean {
    return !this.collected && !this.expired && this.ageMs >= 260;
  }

  public get allowFullHpPickup(): boolean {
    return this.ageMs >= 1600;
  }

  public update(deltaMs: number): void {
    if (this.collected || this.expired) return;
    const dt = Math.min(deltaMs, 50) * 0.001;
    this.ageMs += deltaMs;

    if (this.ageMs >= this.maxLifetimeMs) {
      this.expired = true;
      return;
    }

    if (this.elevationZ > 0 || this.vz !== 0) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vz -= 780 * dt;
      this.elevationZ += this.vz * dt;

      if (this.elevationZ <= 0) {
        this.elevationZ = 0;
        if (!this.bounced && Math.abs(this.vz) > 95) {
          this.bounced = true;
          this.vz = Math.abs(this.vz) * 0.36;
          this.vx *= 0.42;
          this.vy *= 0.42;
        } else {
          this.vz = 0;
          this.vx = 0;
          this.vy = 0;
        }
      }
      const clamped = clampToArena(this.x, this.y, 26);
      this.x = clamped.x;
      this.y = clamped.y;
    }

    this.syncVisuals();
  }

  public markCollected(): void {
    this.collected = true;
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y) + 2);

    const bob = this.elevationZ <= 0 ? Math.sin(this.ageMs * 0.0065) * 3.5 : 0;
    this.sprite.y = -this.elevationZ - 2 + bob;

    const pulse = 0.86 + Math.sin(this.ageMs * 0.008) * 0.16;
    this.glowRing.setScale(pulse, pulse);
    this.glowRing.setAlpha(this.elevationZ > 4 ? 0.12 : 0.28 + Math.sin(this.ageMs * 0.008) * 0.12);

    const shScale = Phaser.Math.Clamp(1 - this.elevationZ * 0.005, 0.5, 1);
    this.shadow.setScale(shScale, shScale);

    // Blink clearly during the final 3.5 seconds before despawning
    const remaining = this.maxLifetimeMs - this.ageMs;
    if (remaining < 3500) {
      this.container.setAlpha(Math.floor(remaining / 110) % 2 === 0 ? 0.95 : 0.32);
    } else {
      this.container.setAlpha(1);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
