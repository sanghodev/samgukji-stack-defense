import Phaser from 'phaser';

export type TreasureKind = 'speed_jade' | 'dragon_orb' | 'gold_chest';

export interface TreasureMeta {
  kind: TreasureKind;
  textureKey: string;
  glowColor: number;
  label: string;
  textColor: string;
}

const TREASURE_META: Record<TreasureKind, TreasureMeta> = {
  speed_jade: {
    kind: 'speed_jade',
    textureKey: 'treasure_jade',
    glowColor: 0x34d399,
    label: '질풍의 옥패! 창 빠르기 UP',
    textColor: '#6ee7b7',
  },
  dragon_orb: {
    kind: 'dragon_orb',
    textureKey: 'treasure_orb',
    glowColor: 0x38bdf8,
    label: '청룡 보주! 콤보 폭발 강화',
    textColor: '#67e8f9',
  },
  gold_chest: {
    kind: 'gold_chest',
    textureKey: 'treasure_chest',
    glowColor: 0xfbbf24,
    label: '황금 보물! +60G · EXP+',
    textColor: '#fde047',
  },
};

/**
 * Glowing collectible treasure dropped on the battlefield.
 * Pops up with a bounce arc, pulses with a light ring, and magnetically
 * flies into Zhao Yun when he approaches.
 */
export class TreasureDrop {
  public readonly scene: Phaser.Scene;
  public readonly kind: TreasureKind;
  public readonly meta: TreasureMeta;
  public readonly container: Phaser.GameObjects.Container;

  public x: number;
  public y: number;
  public collected = false;
  public expired = false;

  private readonly icon: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Arc;
  private ageMs = 0;
  private readonly lifetimeMs = 18000;
  private popZ = 18;
  private popVz = 190;
  private driftVx: number;
  private driftVy: number;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: TreasureKind) {
    this.scene = scene;
    this.kind = kind;
    this.meta = TREASURE_META[kind];
    this.x = x;
    this.y = y;

    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed = Phaser.Math.FloatBetween(45, 105);
    this.driftVx = Math.cos(angle) * speed;
    this.driftVy = Math.sin(angle) * speed;

    this.glow = scene.add.circle(0, 2, 20, this.meta.glowColor, 0.28);
    this.glow.setStrokeStyle(2, this.meta.glowColor, 0.85);

    this.icon = scene.add.image(0, -10, this.meta.textureKey);
    this.icon.setScale(1.15);

    this.container = scene.add.container(x, y, [this.glow, this.icon]);
    this.container.setDepth(y);
  }

  /** Returns true if Zhao Yun collected this treasure this frame. */
  public update(dtMs: number, playerX: number, playerY: number): boolean {
    if (this.collected || this.expired) return false;

    const dt = dtMs / 1000;
    this.ageMs += dtMs;
    if (this.ageMs >= this.lifetimeMs) {
      this.expired = true;
      return false;
    }

    // Initial drop bounce arc
    if (this.popZ > 0 || this.popVz !== 0) {
      this.popZ += this.popVz * dt;
      this.popVz -= 780 * dt;
      this.x += this.driftVx * dt;
      this.y += this.driftVy * dt;
      if (this.popZ <= 0) {
        this.popZ = 0;
        this.popVz = 0;
        this.driftVx = 0;
        this.driftVy = 0;
      }
    }

    // Magnetic pull toward Zhao Yun within 125px
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 28) {
      this.collected = true;
      return true;
    }

    if (dist < 135 && this.popZ <= 2) {
      const pullSpeed = 420 * (1 - dist / 155) + 140;
      this.x += (dx / dist) * pullSpeed * dt;
      this.y += (dy / dist) * pullSpeed * dt;
    }

    // Floating pulse animation & blink near expiration
    const bob = Math.sin(this.ageMs * 0.007) * 4;
    this.icon.y = -10 - this.popZ + bob;
    const pulse = 1 + Math.sin(this.ageMs * 0.008) * 0.14;
    this.glow.setScale(pulse, pulse * 0.65);

    if (this.ageMs > this.lifetimeMs - 3000) {
      this.container.setAlpha(Math.sin(this.ageMs * 0.025) > 0 ? 1 : 0.35);
    }

    this.container.setPosition(this.x, this.y);
    this.container.setDepth(this.y);
    return false;
  }

  public destroy(): void {
    this.container.destroy();
  }
}
