import Phaser from 'phaser';
import { ARENA_BOUNDS, PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { CombatHitTracker } from '../core/CombatMath';
import {
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
} from '../core/Perspective';

export interface ProjectileConfig {
  id: string;
  ownerHeroId: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  damage: number;
  knockbackForce: number;
  launchVz: number;
  penetrating: boolean;
  maxRange: number;
  radius: number;
  tint?: number;
  textureKey?: string;
}

/**
 * True 2.5D world-space projectile (Huang Zhong's arrows & Guan Yu's green wind blades).
 * Tracks prevX/prevY for swept collision so fast projectiles never tunnel and only hit
 * targets in their actual 2.5D depth lane.
 */
export class Projectile {
  public readonly id: string;
  public readonly ownerHeroId: string;
  public readonly hitTracker = new CombatHitTracker();
  public readonly damage: number;
  public readonly knockbackForce: number;
  public readonly launchVz: number;
  public readonly penetrating: boolean;
  public readonly radius: number;
  public readonly dirX: number;
  public readonly dirY: number;

  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public vx: number;
  public vy: number;
  public readyForRemoval = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Image;
  private traveled = 0;
  private readonly maxRange: number;

  constructor(scene: Phaser.Scene, cfg: ProjectileConfig) {
    this.id = cfg.id;
    this.ownerHeroId = cfg.ownerHeroId;
    this.damage = cfg.damage;
    this.knockbackForce = cfg.knockbackForce;
    this.launchVz = cfg.launchVz;
    this.penetrating = cfg.penetrating;
    this.radius = cfg.radius;
    this.maxRange = cfg.maxRange;

    const len = Math.hypot(cfg.dirX, cfg.dirY) || 1;
    this.dirX = cfg.dirX / len;
    this.dirY = cfg.dirY / len;

    this.x = cfg.x;
    this.y = cfg.y;
    this.prevX = cfg.x;
    this.prevY = cfg.y;

    this.vx = this.dirX * cfg.speed;
    this.vy = this.dirY * cfg.speed * PERSPECTIVE_CONFIG.verticalMoveRatio;

    this.shadow = scene.add.ellipse(0, 2, 22, 6, 0x1a120b, 0.28);
    this.sprite = scene.add.image(0, -26, cfg.textureKey ?? 'arrow_projectile');
    this.sprite.setOrigin(0.5);
    this.sprite.setRotation(Math.atan2(this.vy, this.vx));
    if (cfg.tint) {
      this.sprite.setTint(cfg.tint);
    }
    if (cfg.penetrating) {
      this.sprite.setScale(1.35, 1.35);
    }

    this.container = scene.add.container(this.x, this.y, [this.shadow, this.sprite]);
    this.hitTracker.beginAttack();
    this.syncVisuals();
  }

  public update(deltaMs: number): void {
    if (this.readyForRemoval) return;
    const dt = Math.min(deltaMs, 50) * 0.001;

    this.prevX = this.x;
    this.prevY = this.y;

    const dx = this.vx * dt;
    const dy = this.vy * dt;
    this.x += dx;
    this.y += dy;
    this.traveled += Math.hypot(dx, dy / PERSPECTIVE_CONFIG.verticalMoveRatio);

    // Expire if outside arena trapezoid or max range reached
    const bounds = getHorizontalBoundsAtY(this.y);
    const outOfBounds =
      this.y < ARENA_BOUNDS.backY - 12 ||
      this.y > ARENA_BOUNDS.frontY + 12 ||
      this.x < bounds.left - 16 ||
      this.x > bounds.right + 16;

    if (outOfBounds || this.traveled >= this.maxRange) {
      this.readyForRemoval = true;
      return;
    }

    this.syncVisuals();
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y) + 12);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
