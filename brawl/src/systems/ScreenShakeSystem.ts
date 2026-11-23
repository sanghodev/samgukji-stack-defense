import Phaser from 'phaser';
import { DEPTH_LAYERS, GAME_HEIGHT, GAME_WIDTH } from '../config/arenaConfig';
import { CombatTuning } from '../config/combatConfig';
import { PolishSettings } from '../config/polishConfig';
import { IGameSystem, SystemContext } from './ModuleRegistry';

/**
 * Controlled fixed-camera feedback manager (directional shake + brief impact flash).
 * Guarantees exact restoration to scroll (0, 0), enforces max shake cap,
 * and respects Reduced Motion accessibility preferences.
 */
export class ScreenShakeSystem implements IGameSystem {
  public readonly id = 'screen-shake';

  private camera?: Phaser.Cameras.Scene2D.Camera;
  private flashRect?: Phaser.GameObjects.Rectangle;
  private readonly tuning: CombatTuning;
  private readonly polish?: PolishSettings;

  private remainingMs = 0;
  private totalDurationMs = 1;
  private magnitude = 0;
  private dirX = 0;
  private dirY = 0;
  private phase = 0;

  private flashRemainingMs = 0;
  private flashDurationMs = 1;
  private flashPeakAlpha = 0;

  constructor(tuning: CombatTuning, polish?: PolishSettings) {
    this.tuning = tuning;
    this.polish = polish;
  }

  public init(ctx: SystemContext): void {
    this.camera = ctx.scene.cameras.main;
    this.camera.setScroll(0, 0);

    this.flashRect = ctx.scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_LAYERS.HUD - 2)
      .setVisible(false);
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

    const motionMul = this.polish?.reduceMotion ? 0.2 : 1.0;
    const cap = this.polish?.maxShakeCap ?? 11;
    const scaled = Math.min(cap, baseIntensity * this.tuning.screenShakeIntensity * motionMul);
    if (scaled <= 0.15) return;

    // Prioritize stronger shake without unbounded accumulation
    if (scaled >= this.magnitude || this.remainingMs <= 0) {
      this.magnitude = scaled;
      this.totalDurationMs = Math.min(280, durationMs);
      this.remainingMs = this.totalDurationMs;
      const len = Math.hypot(dirX, dirY);
      this.dirX = len > 0 ? dirX / len : 0;
      this.dirY = len > 0 ? dirY / len : 0;
      this.phase = 0;
    }
  }

  /**
   * Brief, non-prolonged impact flash for heavy specials, chain breaks, and boss defeats.
   * Disabled automatically when Reduce Motion is enabled.
   */
  public triggerImpactFlash(color = 0xffffff, alpha = 0.16, durationMs = 55): void {
    if (!this.flashRect || this.polish?.reduceMotion) return;
    const strength = this.polish?.impactFlashStrength ?? 0.65;
    const clampedAlpha = Math.min(0.22, alpha * strength);
    if (clampedAlpha <= 0.01) return;

    this.flashRect.setFillStyle(color, 1);
    this.flashRect.setVisible(true);
    this.flashPeakAlpha = clampedAlpha;
    this.flashDurationMs = Math.min(70, Math.max(25, durationMs));
    this.flashRemainingMs = this.flashDurationMs;
  }

  public update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50);

    // Update brief impact flash
    if (this.flashRect && this.flashRemainingMs > 0) {
      this.flashRemainingMs = Math.max(0, this.flashRemainingMs - dt);
      if (this.flashRemainingMs <= 0) {
        this.flashRect.setVisible(false);
        this.flashRect.setAlpha(0);
      } else {
        const t = this.flashRemainingMs / this.flashDurationMs;
        this.flashRect.setAlpha(this.flashPeakAlpha * t);
      }
    }

    if (!this.camera) return;

    if (!this.tuning.screenShakeEnabled || this.remainingMs <= 0) {
      if (this.camera.scrollX !== 0 || this.camera.scrollY !== 0) {
        this.camera.setScroll(0, 0);
      }
      this.magnitude = 0;
      return;
    }

    this.remainingMs = Math.max(0, this.remainingMs - dt);
    this.phase += dt * 0.065;

    if (this.remainingMs <= 0) {
      this.magnitude = 0;
      this.camera.setScroll(0, 0);
      return;
    }

    const decay = this.remainingMs / this.totalDurationMs;
    const amp = this.magnitude * decay * decay;

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
    this.flashRemainingMs = 0;
    this.flashRect?.setVisible(false);
    this.camera?.setScroll(0, 0);
  }

  public destroy(): void {
    this.reset();
    this.flashRect?.destroy();
    this.flashRect = undefined;
    this.camera = undefined;
  }
}
