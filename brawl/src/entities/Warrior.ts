import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG, PLAYER_CONFIG } from '../config/arenaConfig';
import {
  clampToArena,
  getDepthOrder,
  getDepthRatio,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';
import { MoveInputState } from '../systems/InputSystem';

const DIR_LABELS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

export type FacingDirection = (typeof DIR_LABELS)[number];

/**
 * Playable chibi Zhao Yun (조운) warrior entity.
 * Supports smooth 8-direction movement, 2.5D perspective scaling,
 * ground shadow, automatic Y-depth sorting, and footstep dust feedback.
 */
export class Warrior {
  public readonly id = 'player_zhaoyun';
  public readonly collisionRadius = PLAYER_CONFIG.collisionRadius;
  public readonly container: Phaser.GameObjects.Container;

  public x: number;
  public y: number;
  public vx = 0;
  public vy = 0;
  public facingAngle = Math.PI / 2; // Start facing viewer (South)
  public facingLabel: FacingDirection = 'S';

  private readonly scene: Phaser.Scene;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;

  private readonly dirBaseScale = 0.78;
  private readonly runBaseScale = 0.68;

  private runFrameFloat = 0;
  private walkBobPhase = 0;
  private idleBreathPhase = 0;
  private dustCooldownMs = 0;
  private lastHorizontalFlip = false;

  constructor(scene: Phaser.Scene, spawnX: number, spawnY: number) {
    this.scene = scene;
    this.x = spawnX;
    this.y = spawnY;

    // Ground shadow anchored at feet (0, 0)
    this.shadow = scene.add.ellipse(0, 2, 54, 18, 0x1a120b, 0.42);

    // Chibi Zhao Yun sprite anchored at bottom-center (feet)
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

  public update(
    deltaMs: number,
    input: MoveInputState,
    resolveProps: (x: number, y: number, radius: number) => Point2D,
  ): void {
    const dt = Math.min(deltaMs, 50) * 0.001;
    const speedFactor = getDepthSpeedFactor(this.y);

    // Target 8-direction velocity with classic 2.5D vertical foreshortening
    const targetVx = input.x * PLAYER_CONFIG.baseMoveSpeed * speedFactor;
    const targetVy =
      input.y * PLAYER_CONFIG.baseMoveSpeed * PERSPECTIVE_CONFIG.verticalMoveRatio * speedFactor;

    const rate = input.isMoving ? PLAYER_CONFIG.accelRate : PLAYER_CONFIG.decelRate;
    const maxStep = rate * dt;

    this.vx = this.approach(this.vx, targetVx, maxStep);
    this.vy = this.approach(this.vy, targetVy, maxStep);

    if (input.isMoving) {
      this.facingAngle = Math.atan2(input.y, input.x);
      this.facingLabel = DIR_LABELS[this.angleToSector(this.facingAngle)];
    }

    // Integrate & clamp inside arena trapezoid + resolve prop collisions
    const nextX = this.x + this.vx * dt;
    const nextY = this.y + this.vy * dt;

    const afterProps = resolveProps(nextX, nextY, this.collisionRadius * this.currentScale);
    const clamped = clampToArena(afterProps.x, afterProps.y, this.collisionRadius);

    // Stop velocity axis if blocked by boundary so animations stay honest
    if (Math.abs(clamped.x - nextX) > 0.5) this.vx *= 0.25;
    if (Math.abs(clamped.y - nextY) > 0.5) this.vy *= 0.25;

    this.x = clamped.x;
    this.y = clamped.y;

    this.updateAnimation(dt, deltaMs);
    this.syncTransform();
  }

  private updateAnimation(dt: number, deltaMs: number): void {
    const currentSpeed = this.speed;
    const isMoving = currentSpeed > 22;

    if (this.dustCooldownMs > 0) {
      this.dustCooldownMs -= deltaMs;
    }

    if (isMoving) {
      const speedNorm = Phaser.Math.Clamp(currentSpeed / PLAYER_CONFIG.baseMoveSpeed, 0.35, 1.15);
      const predominantlyHorizontal = Math.abs(this.vx) > Math.abs(this.vy) * 1.45;

      if (predominantlyHorizontal) {
        // Brisk side-scrolling arcade run cycle (`zhaoyun_run`)
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
        // True 8-direction movement (clearly faces viewer when moving S and shows back when moving N)
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

      // Subtle shadow pulse & periodic footstep dust
      const shadowPulse = 1 - Math.abs(Math.sin(this.walkBobPhase)) * 0.07;
      this.shadow.setScale(shadowPulse, shadowPulse);

      if (this.dustCooldownMs <= 0 && currentSpeed > 95) {
        this.spawnFootstepDust();
        this.dustCooldownMs = 190;
      }
    } else {
      // Idle 8-direction stance with subtle breathing
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
