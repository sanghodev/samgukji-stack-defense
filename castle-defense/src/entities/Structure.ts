import Phaser from 'phaser';
import { SpriteStack } from '../graphics/SpriteStack';

export type StructureKind = 'castle' | 'barricade';

export interface StructureConfig {
  kind: StructureKind;
  x: number;
  y: number;
  maxHp: number;
  collisionRadius: number;
  rotation?: number;
  /** When true, uses the painted battlefield backdrop instead of a procedural stack. */
  usePaintedBackdrop?: boolean;
}

/**
 * Central Castle Gate or destructible wooden Barricade rendered via SpriteStack
 * (or aligned directly onto the high-detail painted fortress backdrop).
 */
export class Structure {
  public readonly scene: Phaser.Scene;
  public readonly kind: StructureKind;
  public readonly stack?: SpriteStack;
  public readonly collisionRadius: number;

  public x: number;
  public y: number;
  public hp: number;
  public maxHp: number;
  public isDestroyed = false;

  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly gateFlash?: Phaser.GameObjects.Ellipse;
  private readonly hpBarWidth: number;
  private readonly hpBarYOffset: number;
  private readonly baseRotation: number;

  constructor(scene: Phaser.Scene, config: StructureConfig) {
    this.scene = scene;
    this.kind = config.kind;
    this.x = config.x;
    this.y = config.y;
    this.hp = config.maxHp;
    this.maxHp = config.maxHp;
    this.collisionRadius = config.collisionRadius;
    this.baseRotation = config.rotation ?? 0;

    if (config.usePaintedBackdrop) {
      // Subtle impact flash overlay aligned directly on the painted wooden gate
      this.gateFlash = scene.add.ellipse(this.x, this.y - 12, 94, 72, 0xffffff, 0);
      this.gateFlash.setDepth(this.y + 5);
      this.hpBarWidth = 104;
      this.hpBarYOffset = 68;
    } else if (this.kind === 'castle') {
      this.stack = new SpriteStack(scene, this.x, this.y, {
        textureKey: 'castle_gate_stack',
        layerSpacing: 2,
        scale: 2.35,
        rotation: this.baseRotation,
        shadowRadiusX: 76,
        shadowRadiusY: 48,
        shadowAlpha: 0.42,
      });
      this.hpBarWidth = 120;
      this.hpBarYOffset = this.stack.getStackHeight() + 14;
    } else {
      this.stack = new SpriteStack(scene, this.x, this.y, {
        textureKey: 'barricade_stack',
        layerSpacing: 2,
        scale: 2.2,
        rotation: this.baseRotation,
        shadowRadiusX: 30,
        shadowRadiusY: 16,
        shadowAlpha: 0.34,
      });
      this.hpBarWidth = 58;
      this.hpBarYOffset = this.stack.getStackHeight() + 10;
    }

    this.hpBar = scene.add.graphics();
    this.hpBar.setDepth(9000);
    this.redrawHpBar();
  }

  public takeDamage(amount: number): boolean {
    if (this.isDestroyed || amount <= 0) return false;

    this.hp = Math.max(0, this.hp - amount);

    if (this.stack) {
      this.stack.flashHit(80, 0xffffff);
      const originX = this.x;
      const originY = this.y;
      this.scene.tweens.add({
        targets: this.stack,
        x: originX + Phaser.Math.Between(-3, 3),
        y: originY + Phaser.Math.Between(-2, 2),
        duration: 45,
        yoyo: true,
        onComplete: () => {
          if (this.stack?.active) {
            this.stack.setPosition(originX, originY);
          }
        },
      });
    } else if (this.gateFlash) {
      this.gateFlash.setFillStyle(0xffffff, 0.55);
      this.scene.tweens.add({
        targets: this.gateFlash,
        alpha: 0,
        duration: 110,
      });
    }

    // Show progressive structural collapse on barricades
    if (this.kind === 'barricade' && this.stack) {
      const ratio = this.hp / this.maxHp;
      this.stack.setVisibleLayerRatio(Math.max(0.25, ratio));
    }

    if (this.hp <= 0) {
      this.isDestroyed = true;
      if (this.kind === 'barricade' && this.stack) {
        this.stack.setVisibleLayerRatio(0.18);
        this.stack.setBaseTint(0x6b5b4f);
        this.stack.setAlpha(0.75);
      } else if (this.stack) {
        this.stack.setBaseTint(0x7f1d1d);
      }
      this.redrawHpBar();
      return true;
    }

    this.redrawHpBar();
    return false;
  }

  /** Repair a damaged or destroyed structure (e.g. rebuilding a barricade or fortifying castle). */
  public repair(amount: number): boolean {
    if (this.hp >= this.maxHp && !this.isDestroyed) return false;

    this.isDestroyed = false;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.stack) {
      this.stack.setAlpha(1);
      this.stack.setBaseTint(0xffffff);
      this.stack.setVisibleLayerRatio(1);
      this.stack.flashHit(140, 0xfde047);
    } else if (this.gateFlash) {
      this.gateFlash.setFillStyle(0x4ade80, 0.5);
      this.scene.tweens.add({
        targets: this.gateFlash,
        alpha: 0,
        duration: 200,
      });
    }
    this.redrawHpBar();
    return true;
  }

  public syncDepth(): void {
    this.stack?.syncDepth();
  }

  public redrawHpBar(): void {
    this.hpBar.clear();

    // Hide full-HP barricade bar to keep the battlefield clean
    if (this.kind === 'barricade' && this.hp >= this.maxHp && !this.isDestroyed) {
      return;
    }

    const bx = this.x - this.hpBarWidth / 2;
    const by = this.y - this.hpBarYOffset;
    const bh = this.kind === 'castle' ? 8 : 6;

    if (this.isDestroyed && this.kind === 'barricade') {
      // Subtle amber dashed/muted marker indicating rebuildable rubble
      this.hpBar.fillStyle(0x111827, 0.72);
      this.hpBar.fillRect(bx - 1, by - 1, this.hpBarWidth + 2, bh + 2);
      this.hpBar.lineStyle(1, 0xf59e0b, 0.85);
      this.hpBar.strokeRect(bx, by, this.hpBarWidth, bh);
      return;
    }

    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const fillColor =
      ratio > 0.55 ? 0x22c55e : ratio > 0.25 ? 0xf59e0b : 0xef4444;

    this.hpBar.fillStyle(0x0f172a, 0.85);
    this.hpBar.fillRect(bx - 1, by - 1, this.hpBarWidth + 2, bh + 2);

    this.hpBar.fillStyle(fillColor, 1);
    this.hpBar.fillRect(bx, by, Math.round(this.hpBarWidth * ratio), bh);
  }

  public destroy(): void {
    this.hpBar.destroy();
    this.gateFlash?.destroy();
    this.stack?.destroy();
  }
}
