import Phaser from 'phaser';
import { CombatTuning } from '../config/combatConfig';
import { IGameSystem, SystemContext } from './ModuleRegistry';

/**
 * Controlled fixed-camera screen shake.
 * Guarantees exact restoration to scroll (0, 0) with zero permanent drift.
 */
export class ScreenShakeSystem implements IGameSystem {
  public readonly id = 'screen-shake';

  private camera?: Phaser.Cameras.Scene2D.Camera;
  private readonly tuning: CombatTuning;

  private remainingMs = 0;
  private totalDurationMs = 1;
  private magnitude = 0;
  private dirX = 0;
  private dirY = 0;
  private phase = 0;

  constructor(tuning: CombatTuning) {
    this.tuning = tuning;
  }

  public init(ctx: SystemContext): void {
    this.camera = ctx.scene.cameras.main;
    this.camera.setScroll(0, 0);
  }

  public trigger(
    baseIntensity: number,
    durationMs: number,
    dirX = 0,
    dirY = 0,
  ): void {
    if (!this.tuning.screenShakeEnabled || baseIntensity <= 0 || durationMs <= 0) {
      return;
    }

    const scaled = baseIntensity * this.tuning.screenShakeIntensity;
    if (scaled <= 0.1) return;

    // Prioritize stronger shake
    if (scaled >= this.magnitude || this.remainingMs <= 0) {
      this.magnitude = scaled;
      this.totalDurationMs = durationMs;
      this.remainingMs = durationMs;
      const len = Math.hypot(dirX, dirY);
      this.dirX = len > 0 ? dirX / len : 0;
      this.dirY = len > 0 ? dirY / len : 0;
      this.phase = 0;
    }
  }

  public update(_time: number, delta: number): void {
    if (!this.camera) return;

    if (!this.tuning.screenShakeEnabled || this.remainingMs <= 0) {
      if (this.camera.scrollX !== 0 || this.camera.scrollY !== 0) {
        this.camera.setScroll(0, 0);
      }
      this.magnitude = 0;
      return;
    }

    const dt = Math.min(delta, 50);
    this.remainingMs = Math.max(0, this.remainingMs - dt);
    this.phase += dt * 0.065;

    if (this.remainingMs <= 0) {
      this.magnitude = 0;
      this.camera.setScroll(0, 0);
      return;
    }

    const decay = this.remainingMs / this.totalDurationMs;
    const amp = this.magnitude * decay * decay;

    // Punchy damped directional oscillation + crisp jitter
    const punch = Math.sin(this.phase * 2.4) * amp;
    const jitterX = (Math.random() * 2 - 1) * amp * 0.55;
    const jitterY = (Math.random() * 2 - 1) * amp * 0.55;

    const offsetX = Math.round(this.dirX * punch + jitterX);
    const offsetY = Math.round(this.dirY * punch + jitterY);
    this.camera.setScroll(offsetX, offsetY);
  }

  public reset(): void {
    this.remainingMs = 0;
    this.magnitude = 0;
    this.camera?.setScroll(0, 0);
  }

  public destroy(): void {
    this.reset();
    this.camera = undefined;
  }
}
