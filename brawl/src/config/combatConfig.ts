export type AttackType = 'LIGHT_1' | 'LIGHT_2' | 'LIGHT_3' | 'HEAVY';

export interface AttackSpec {
  readonly type: AttackType;
  readonly windupMs: number;
  readonly activeMs: number;
  readonly recoveryMs: number;
  readonly baseDamage: number;
  readonly range: number;
  readonly halfWidth: number;
  readonly knockbackForce: number;
  readonly launchVz: number;
  readonly hitStopMs: number;
  readonly shakeIntensity: number;
  readonly shakeDurationMs: number;
  readonly moveSpeedFactor: number;
  readonly lungeSpeed: number;
  readonly isFinisher: boolean;
  readonly isHeavy: boolean;
}

export const ATTACK_SPECS: Record<AttackType, AttackSpec> = {
  // ~180 ms total: crisp fast horizontal strike
  LIGHT_1: {
    type: 'LIGHT_1',
    windupMs: 40,
    activeMs: 65,
    recoveryMs: 75,
    baseDamage: 16,
    range: 92,
    halfWidth: 36,
    knockbackForce: 155,
    launchVz: 0,
    hitStopMs: 25,
    shakeIntensity: 0,
    shakeDurationMs: 0,
    moveSpeedFactor: 0.62,
    lungeSpeed: 70,
    isFinisher: false,
    isHeavy: false,
  },
  // ~220 ms total: slightly stronger follow-up
  LIGHT_2: {
    type: 'LIGHT_2',
    windupMs: 50,
    activeMs: 75,
    recoveryMs: 95,
    baseDamage: 22,
    range: 100,
    halfWidth: 40,
    knockbackForce: 205,
    launchVz: 0,
    hitStopMs: 25,
    shakeIntensity: 1.4,
    shakeDurationMs: 45,
    moveSpeedFactor: 0.52,
    lungeSpeed: 95,
    isFinisher: false,
    isHeavy: false,
  },
  // ~300 ms total: powerful finishing thrust with knockback & launch
  LIGHT_3: {
    type: 'LIGHT_3',
    windupMs: 70,
    activeMs: 90,
    recoveryMs: 140,
    baseDamage: 34,
    range: 118,
    halfWidth: 46,
    knockbackForce: 375,
    launchVz: 245,
    hitStopMs: 55,
    shakeIntensity: 4.5,
    shakeDurationMs: 110,
    moveSpeedFactor: 0.3,
    lungeSpeed: 185,
    isFinisher: true,
    isHeavy: false,
  },
  // ~410 ms total: brief anticipation, strong forward lunge, heavy knockback & launch
  HEAVY: {
    type: 'HEAVY',
    windupMs: 115,
    activeMs: 105,
    recoveryMs: 190,
    baseDamage: 48,
    range: 136,
    halfWidth: 48,
    knockbackForce: 510,
    launchVz: 345,
    hitStopMs: 80,
    shakeIntensity: 9.0,
    shakeDurationMs: 165,
    moveSpeedFactor: 0.08,
    lungeSpeed: 380,
    isFinisher: false,
    isHeavy: true,
  },
};

export interface CombatTuning {
  playerDamageMultiplier: number;
  attackRangeMultiplier: number;
  attackSpeedMultiplier: number;
  comboWindowMs: number;
  hitStopScale: number;
  knockbackMultiplier: number;
  enemyMaxHp: number;
  enemyMoveSpeed: number;
  screenShakeIntensity: number;
  screenShakeEnabled: boolean;
  audioVolume: number;
  enemyCount: number;
  showHitboxes: boolean;
  showGroundPositions: boolean;
}

export function createDefaultCombatTuning(): CombatTuning {
  return {
    playerDamageMultiplier: 1.0,
    attackRangeMultiplier: 1.0,
    attackSpeedMultiplier: 1.0,
    comboWindowMs: 360,
    hitStopScale: 1.0,
    knockbackMultiplier: 1.0,
    enemyMaxHp: 100,
    enemyMoveSpeed: 128,
    screenShakeIntensity: 1.0,
    screenShakeEnabled: true,
    audioVolume: 0.7,
    enemyCount: 6,
    showHitboxes: false,
    showGroundPositions: false,
  };
}

export const BANDIT_COMBAT_CONFIG = {
  collisionRadius: 19,
  attackRange: 68,
  attackHalfWidth: 32,
  attackDamage: 12,
  attackWindupMs: 390,
  attackActiveMs: 110,
  attackRecoveryMs: 340,
  hurtDurationMs: 240,
  knockdownDurationMs: 680,
  recoverDurationMs: 280,
  gravity: 1120,
  groundFriction: 7.5,
  airDrag: 1.15,
} as const;
