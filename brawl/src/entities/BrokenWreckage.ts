import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { AirborneBodyState, stepAirbornePhysics } from '../core/CombatMath';
import {
  clampToArena,
  getDepthOrder,
  getPerspectiveScale,
} from '../core/Perspective';

/**
 * Persistent 16-bit pixel-art broken wreckage piece left behind on the muddy courtyard
 * when tables, barrels, wine jars, fruit baskets, or dumpling steamers smash apart!
 *
 * Features real lightweight 2.5D physics:
 * - Pops into the air with spin & bounce upon destruction
 * - Stays permanently on the floor to build an authentic chaotic battlefield ("난장판")
 * - Physically kicks up, bounces, spins, and scatters again whenever heroes dash/charge,
 *   bandits slam down, or Boss shockwaves erupt nearby!
 */
export class BrokenWreckage {
  public readonly id: string;
  public readonly frameIndex: number;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public elevationZ: number;
  public vz: number;
  public readyForRemoval = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly baseScale: number;
  private spinAngle = 0;
  private spinSpeed = 0;
  private kickCooldownMs = 0;
  private fadingOut = false;
  private alpha = 1;

  constructor(
    scene: Phaser.Scene,
    id: string,
    frameIndex: number,
    spawnX: number,
    spawnY: number,
    vx: number,
    vy: number,
    vz: number,
    baseScale = 0.56,
  ) {
    this.id = id;
    this.frameIndex = frameIndex;
    this.baseScale = baseScale;

    const clamped = clampToArena(spawnX, spawnY, 18);
    this.x = clamped.x;
    this.y = clamped.y;
    this.vx = vx;
    this.vy = vy;
    this.elevationZ = 14;
    this.vz = vz;
    this.spinSpeed = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6);

    this.shadow = scene.add.ellipse(0, 3, 44 * baseScale * 1.4, 14 * baseScale * 1.3, 0x1a120b, 0.34);
    this.sprite = scene.add
      .image(0, 4, 'broken_wreckage', frameIndex)
      .setOrigin(0.5, 0.88)
      .setScale(baseScale);

    this.container = scene.add.container(this.x, this.y, [this.shadow, this.sprite]);
    this.syncVisuals();
  }

  public get speed(): number {
    return Math.hypot(this.vx, this.vy / PERSPECTIVE_CONFIG.verticalMoveRatio);
  }

  /**
   * Kicks this broken plank/jar/bowl into the air again when an actor charges,
   * slams, or explodes nearby!
   */
  public applyImpulse(dirX: number, dirY: number, force: number, liftVz = 185): boolean {
    if (this.kickCooldownMs > 0 || this.fadingOut) return false;
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    const jitter = (Math.random() - 0.5) * 0.45;
    const c = Math.cos(jitter);
    const s = Math.sin(jitter);
    const rx = nx * c - ny * s;
    const ry = nx * s + ny * c;

    this.vx += rx * force;
    this.vy += ry * force * PERSPECTIVE_CONFIG.verticalMoveRatio;
    this.vz = Math.max(this.vz, liftVz + Math.random() * 80);
    this.elevationZ = Math.max(this.elevationZ, 4);
    this.spinSpeed = (rx >= 0 ? 1 : -1) * (6 + Math.random() * 8);
    this.kickCooldownMs = 260;
    return true;
  }

  public startFadeOut(): void {
    this.fadingOut = true;
  }

  public update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) * 0.001;
    if (this.kickCooldownMs > 0) {
      this.kickCooldownMs = Math.max(0, this.kickCooldownMs - deltaMs);
    }

    if (this.fadingOut) {
      this.alpha = Math.max(0, this.alpha - dt * 1.8);
      this.container.setAlpha(this.alpha);
      if (this.alpha <= 0.02) {
        this.readyForRemoval = true;
        return;
      }
    }

    if (this.elevationZ > 0 || this.speed > 6) {
      const body: AirborneBodyState = {
        x: this.x,
        y: this.y,
        vx: this.vx,
        vy: this.vy,
        elevationZ: this.elevationZ,
        vz: this.vz,
      };
      const step = stepAirbornePhysics(body, dt, 980, 6.2, 0.42);
      this.x = body.x;
      this.y = body.y;
      this.vx = body.vx;
      this.vy = body.vy;
      this.elevationZ = body.elevationZ;
      this.vz = body.vz;

      const clamped = clampToArena(this.x, this.y, 18);
      if (Math.abs(clamped.x - this.x) > 1) this.vx *= -0.45;
      if (Math.abs(clamped.y - this.y) > 1) this.vy *= -0.45;
      this.x = clamped.x;
      this.y = clamped.y;

      if (this.elevationZ > 2) {
        this.spinAngle += this.spinSpeed * dt;
      } else {
        // Settle cleanly upright-ish on the ground after landing
        this.spinSpeed *= Math.exp(-9 * dt);
        this.spinAngle = Phaser.Math.Linear(this.spinAngle, Math.sin(this.frameIndex * 2.1) * 0.14, 0.22);
      }

      if (step.landed && step.impactSpeed < 95) {
        this.vx *= 0.65;
        this.vy *= 0.65;
      }

      this.syncVisuals();
    }
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    // Keep resting wreckage just below standing characters at the same Y depth so feet stay readable!
    this.container.setDepth(getDepthOrder(this.y) - (this.elevationZ > 6 ? 0 : 12));

    this.sprite.setY(4 - this.elevationZ);
    this.sprite.setRotation(this.spinAngle);

    const shScale = Phaser.Math.Clamp(1 - this.elevationZ * 0.005, 0.35, 1);
    this.shadow.setScale(shScale, shScale);
    this.shadow.setAlpha(0.34 * shScale);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}

export { getWreckageFramesForKind } from '../core/HeroDefenseMath';
