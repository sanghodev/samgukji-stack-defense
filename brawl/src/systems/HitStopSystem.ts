import type { CombatTuning } from '../config/combatConfig.ts';
import type { HitStopClass, PolishSettings } from '../config/polishConfig.ts';
import type { IGameSystem } from './ModuleRegistry.ts';

const HITSTOP_PRIORITY: Record<HitStopClass, number> = {
  LIGHT: 1,
  MEDIUM: 2,
  HEAVY: 3,
  ENV_MAJOR: 4,
  FINISHER: 5,
};

/**
 * Priority-aware, capped hit-stop controller.
 * Pauses only combat/entity simulation while keeping input buffering,
 * Web Audio timing, camera shake, and debug UI completely responsive.
 * Prevents multiple simultaneous impacts from stacking into accidental freezes.
 */
export class HitStopSystem implements IGameSystem {
  public readonly id = 'hit-stop';

  private remainingMs = 0;
  private activePriority = 0;
  private readonly tuning: CombatTuning;
  private readonly polish?: PolishSettings;

  constructor(tuning: CombatTuning, polish?: PolishSettings) {
    this.tuning = tuning;
    this.polish = polish;
  }

  public trigger(baseDurationMs: number, hitClass: HitStopClass = 'MEDIUM'): void {
    const cap = this.polish?.maxHitStopCapMs ?? 105;
    const scaled = Math.min(cap, Math.max(0, baseDurationMs * this.tuning.hitStopScale));
    if (scaled <= 0) return;

    const prio = HITSTOP_PRIORITY[hitClass];
    if (this.remainingMs <= 0 || prio > this.activePriority) {
      this.remainingMs = Math.max(this.remainingMs, scaled);
      this.activePriority = prio;
    } else if (prio === this.activePriority && scaled > this.remainingMs) {
      this.remainingMs = Math.min(cap, scaled);
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
      this.activePriority = 0;
      return false;
    }
    this.remainingMs = Math.max(0, this.remainingMs - Math.min(realDeltaMs, 50));
    if (this.remainingMs <= 0) {
      this.activePriority = 0;
    }
    return true;
  }

  public reset(): void {
    this.remainingMs = 0;
    this.activePriority = 0;
  }
}
