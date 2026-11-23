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
  isEnemyProjectile?: boolean;
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
 * True 2.5D world-space projectile (Huang Zhong's arrows, Guan Yu's green wind blades,
 * and Sneaky Assassin's thrown daggers).
 * Tracks prevX/prevY for swept collision so fast projectiles never tunnel and only hit
 * targets in their actual 2.5D depth lane.
 */
export class Projectile {
  public readonly id: string;
  public readonly ownerHeroId: string;
  public readonly isEnemyProjectile: boolean;
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
    this.isEnemyProjectile = Boolean(cfg.isEnemyProjectile);
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

    this.shadow = scene.add.ellipse(0, 2, 26, 7, 0x1a120b, 0.32);
    const isDagger = cfg.textureKey === 'enemy_dagger';
    const isEnemyArrow = cfg.textureKey === 'enemy_arrow';
    if (scene.textures.exists('combat_vfx')) {
      const isWind = cfg.textureKey === 'wind_blade_projectile';
      this.sprite = scene.add.image(0, -28, 'combat_vfx', isWind ? 1 : 3);
      this.sprite.setScale(
        isWind ? 0.62 : isDagger ? 0.42 : isEnemyArrow ? 0.48 : cfg.penetrating ? 0.56 : 0.44,
      );
      if (isDagger || isEnemyArrow) {
        this.sprite.setTint(cfg.tint ?? (isEnemyArrow ? 0xfb923c : 0xf43f5e));
      }
    } else {
      this.sprite = scene.add.image(
        0,
        -26,
        isDagger || isEnemyArrow ? 'arrow_projectile' : (cfg.textureKey ?? 'arrow_projectile'),
      );
      if (cfg.penetrating) {
        this.sprite.setScale(1.35, 1.35);
      }
      if (cfg.tint) {
        this.sprite.setTint(cfg.tint);
      }
    }
    this.sprite.setOrigin(0.5);
    this.sprite.setRotation(Math.atan2(this.vy, this.vx));

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
