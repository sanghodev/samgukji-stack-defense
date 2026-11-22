import type { CombatTuning } from '../config/combatConfig';
import type { IGameSystem } from './ModuleRegistry';

/**
 * Reusable hit-stop controller.
 * Pauses only combat/entity simulation while keeping input buffering,
 * Web Audio timing, camera shake, and debug UI completely responsive.
 */
export class HitStopSystem implements IGameSystem {
  public readonly id = 'hit-stop';

  private remainingMs = 0;
  private readonly tuning: CombatTuning;

  constructor(tuning: CombatTuning) {
    this.tuning = tuning;
  }

  public trigger(baseDurationMs: number): void {
    const scaled = Math.max(0, baseDurationMs * this.tuning.hitStopScale);
    if (scaled > this.remainingMs) {
      this.remainingMs = scaled;
    }
  }

  public get isActive(): boolean {
    return this.remainingMs > 0;
  }

  public get remaining(): number {
    return this.remainingMs;
  }

  /**
   * Advances the hit-stop timer using real frame delta.
   * Returns true if combat simulation should be frozen for this frame.
   */
  public step(realDeltaMs: number): boolean {
    if (this.remainingMs <= 0) {
      return false;
    }
    this.remainingMs = Math.max(0, this.remainingMs - Math.min(realDeltaMs, 50));
    return true;
  }

  public reset(): void {
    this.remainingMs = 0;
  }
}
