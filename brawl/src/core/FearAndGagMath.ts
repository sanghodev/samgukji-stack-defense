export type FearState =
  | 'CALM'
  | 'NERVOUS'
  | 'FRIGHTENED'
  | 'PANICKING'
  | 'TERRIFIED';

/**
 * Classifies numeric fear [0..100] into a discrete FearState using hysteresis
 * so bandits do not rapidly flicker between states around thresholds.
 */
export function classifyFearState(
  fear: number,
  prevState: FearState,
  panicThreshold: number,
): FearState {
  const f = Math.max(0, Math.min(100, fear));
  const hyst = 6;
  const pThresh = Math.max(20, Math.min(95, panicThreshold));
  const terrifiedThresh = Math.min(98, pThresh + 24);
  const frightenedThresh = Math.max(15, pThresh - 16);
  const nervousThresh = Math.max(8, frightenedThresh - 14);

  // Escalate immediately when crossing upward
  if (f >= terrifiedThresh) return 'TERRIFIED';
  if (f >= pThresh) {
    if (prevState === 'TERRIFIED' && f >= terrifiedThresh - hyst) return 'TERRIFIED';
    return 'PANICKING';
  }
  if (f >= frightenedThresh) {
    if (prevState === 'PANICKING' && f >= pThresh - hyst) return 'PANICKING';
    return 'FRIGHTENED';
  }
  if (f >= nervousThresh) {
    if (prevState === 'FRIGHTENED' && f >= frightenedThresh - hyst) return 'FRIGHTENED';
    return 'NERVOUS';
  }
  if (prevState === 'NERVOUS' && f >= nervousThresh - hyst) return 'NERVOUS';
  return 'CALM';
}

/**
 * Computes fear gained from a battlefield event, weighted by archetype sensitivity and courage.
 */
export function computeFearGain(
  baseEventFear: number,
  fearSensitivity: number,
  fearGainMultiplier: number,
  effectiveCourage: number,
): number {
  if (baseEventFear <= 0 || fearGainMultiplier <= 0) return 0;
  const courageDamp = Math.max(0.18, 1.25 - (effectiveCourage / 100) * 0.95);
  return baseEventFear * fearSensitivity * fearGainMultiplier * courageDamp;
}

/**
 * Speed- and panic-coupled running stumble/trip evaluator.
 * Never trips idle enemies; triggers comedic stumble during frantic panic runs or sharp turns.
 */
export function evaluateRunningTrip(
  moveSpeed: number,
  isPanicking: boolean,
  isSharpTurn: boolean,
  clumsyMultiplier: number,
  baseTripProbability: number,
  dtSec: number,
  roll01: number,
): boolean {
  if (moveSpeed < 95 || baseTripProbability <= 0) return false;
  if (!isPanicking && !isSharpTurn && clumsyMultiplier < 1.5) return false;

  const panicBoost = isPanicking ? 1.35 : 0.65;
  const turnBoost = isSharpTurn ? 2.1 : 1.0;
  const speedBoost = Math.min(1.5, moveSpeed / 140);
  const ratePerSec = Math.min(
    0.85,
    baseTripProbability * clumsyMultiplier * panicBoost * turnBoost * speedBoost * 0.55,
  );
  const stepChance = 1 - Math.pow(1 - ratePerSec, Math.min(0.1, dtSec));
  return roll01 < stepChance;
}

export interface CameraGagCheckInput {
  enabled: boolean;
  isAnyGagActive: boolean;
  cooldownRemainingMs: number;
  enemyEligible: boolean;
  launchSpeed: number;
  launchThreshold: number;
  /** Positive vy means launched toward the viewer (foreground) */
  vy: number;
  gagChance: number;
  roll01: number;
}

/**
 * Deterministic eligibility check for the rare screen-glass collision gag.
 */
export function evaluateCameraGagEligibility(input: CameraGagCheckInput): boolean {
  if (!input.enabled) return false;
  if (input.isAnyGagActive) return false;
  if (input.cooldownRemainingMs > 0) return false;
  if (!input.enemyEligible) return false;
  if (input.launchSpeed < input.launchThreshold) return false;
  // Must be launched generally toward the viewer (+Y)
  if (input.vy < 45) return false;
  return input.roll01 < Math.max(0, Math.min(1, input.gagChance));
}
