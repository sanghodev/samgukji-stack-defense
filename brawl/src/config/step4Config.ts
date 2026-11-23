export type HeroId = 'zhaoyun' | 'zhangfei';

export type BanditArchetype =
  | 'coward'
  | 'overconfident'
  | 'clumsy'
  | 'sneaky'
  | 'stubborn'
  | 'elite'
  | 'archer'
  | 'bomber'
  | 'grappler'
  | 'soldier';

export interface HeroProfile {
  readonly id: HeroId;
  readonly displayName: string;
  readonly engName: string;
  readonly specialName: string;
  readonly maxHp: number;
  readonly speedMultiplier: number;
  readonly damageMultiplier: number;
  readonly knockbackMultiplier: number;
  readonly accentColor: string;
}

export const HERO_PROFILES: Record<HeroId, HeroProfile> = {
  zhaoyun: {
    id: 'zhaoyun',
    displayName: '조운',
    engName: 'ZHAO YUN',
    specialName: '청룡선풍',
    maxHp: 100,
    speedMultiplier: 1.04,
    damageMultiplier: 1.0,
    knockbackMultiplier: 1.0,
    accentColor: '#38bdf8',
  },
  zhangfei: {
    id: 'zhangfei',
    displayName: '장비',
    engName: 'ZHANG FEI',
    specialName: '맹장돌진',
    maxHp: 130,
    speedMultiplier: 0.92,
    damageMultiplier: 1.24,
    knockbackMultiplier: 1.32,
    accentColor: '#c084fc',
  },
};

export interface ArchetypeSpec {
  readonly archetype: BanditArchetype;
  readonly labelKr: string;
  readonly badgeColor: string;
  readonly tintColor: number | null;
  readonly scaleMul: number;
  readonly hpMul: number;
  readonly mass: number;
  readonly courage: number; // 0..100
  readonly aggression: number; // 0.5..1.5
  readonly fearSensitivity: number; // multiplier on incoming fear
  readonly panicThreshold: number; // 0..100
  readonly escapeSpeedMul: number;
  readonly tripMultiplier: number;
  readonly hidingPreference: number; // 0..1
  readonly surrenderThreshold: number; // 0..100 (101 = never)
  readonly cameraGagEligible: boolean;
}

export const BANDIT_ARCHETYPES: Record<BanditArchetype, ArchetypeSpec> = {
  coward: {
    archetype: 'coward',
    labelKr: '겁쟁이',
    badgeColor: '#38bdf8',
    tintColor: 0xbae6fd,
    scaleMul: 0.94,
    hpMul: 0.85,
    mass: 0.9,
    courage: 22,
    aggression: 0.7,
    fearSensitivity: 1.85,
    panicThreshold: 44,
    escapeSpeedMul: 1.24,
    tripMultiplier: 1.35,
    hidingPreference: 0.88,
    surrenderThreshold: 80,
    cameraGagEligible: true,
  },
  overconfident: {
    archetype: 'overconfident',
    labelKr: '도끼병',
    badgeColor: '#fbbf24',
    tintColor: 0xfef08a,
    scaleMul: 1.02,
    hpMul: 1.04,
    mass: 1.05,
    courage: 58,
    aggression: 1.26,
    fearSensitivity: 1.15,
    panicThreshold: 66,
    escapeSpeedMul: 1.12,
    tripMultiplier: 1.0,
    hidingPreference: 0.4,
    surrenderThreshold: 88,
    cameraGagEligible: true,
  },
  clumsy: {
    archetype: 'clumsy',
    labelKr: '덜렁이',
    badgeColor: '#fb923c',
    tintColor: 0xfed7aa,
    scaleMul: 0.98,
    hpMul: 0.92,
    mass: 0.95,
    courage: 42,
    aggression: 0.95,
    fearSensitivity: 1.35,
    panicThreshold: 56,
    escapeSpeedMul: 1.15,
    tripMultiplier: 2.35,
    hidingPreference: 0.62,
    surrenderThreshold: 86,
    cameraGagEligible: true,
  },
  sneaky: {
    archetype: 'sneaky',
    labelKr: '자객',
    badgeColor: '#a78bfa',
    tintColor: 0xddd6fe,
    scaleMul: 0.96,
    hpMul: 0.9,
    mass: 0.92,
    courage: 44,
    aggression: 1.12,
    fearSensitivity: 1.35,
    panicThreshold: 58,
    escapeSpeedMul: 1.26,
    tripMultiplier: 1.0,
    hidingPreference: 0.75,
    surrenderThreshold: 84,
    cameraGagEligible: true,
  },
  stubborn: {
    archetype: 'stubborn',
    labelKr: '고집쟁이',
    badgeColor: '#f87171',
    tintColor: null,
    scaleMul: 1.04,
    hpMul: 1.15,
    mass: 1.12,
    courage: 86,
    aggression: 1.2,
    fearSensitivity: 0.45,
    panicThreshold: 88,
    escapeSpeedMul: 0.95,
    tripMultiplier: 0.7,
    hidingPreference: 0.15,
    surrenderThreshold: 101,
    cameraGagEligible: true,
  },
  elite: {
    archetype: 'elite',
    labelKr: '정예',
    badgeColor: '#f59e0b',
    tintColor: 0xfde68a,
    scaleMul: 1.16,
    hpMul: 1.65,
    mass: 1.48,
    courage: 95,
    aggression: 1.32,
    fearSensitivity: 0.22,
    panicThreshold: 96,
    escapeSpeedMul: 0.9,
    tripMultiplier: 0.4,
    hidingPreference: 0.0,
    surrenderThreshold: 101,
    cameraGagEligible: false,
  },
  archer: {
    archetype: 'archer',
    labelKr: '궁수',
    badgeColor: '#4ade80',
    tintColor: 0xbbf7d0,
    scaleMul: 0.96,
    hpMul: 0.88,
    mass: 0.9,
    courage: 48,
    aggression: 1.05,
    fearSensitivity: 1.3,
    panicThreshold: 58,
    escapeSpeedMul: 1.2,
    tripMultiplier: 1.1,
    hidingPreference: 0.7,
    surrenderThreshold: 84,
    cameraGagEligible: true,
  },
  bomber: {
    archetype: 'bomber',
    labelKr: '폭탄병',
    badgeColor: '#fb923c',
    tintColor: 0xfdba74,
    scaleMul: 0.98,
    hpMul: 0.96,
    mass: 0.95,
    courage: 62,
    aggression: 1.08,
    fearSensitivity: 1.1,
    panicThreshold: 68,
    escapeSpeedMul: 1.16,
    tripMultiplier: 1.25,
    hidingPreference: 0.5,
    surrenderThreshold: 88,
    cameraGagEligible: true,
  },
  grappler: {
    archetype: 'grappler',
    labelKr: '괴력병',
    badgeColor: '#f43f5e',
    tintColor: 0xfda4af,
    scaleMul: 1.22,
    hpMul: 1.55,
    mass: 1.52,
    courage: 92,
    aggression: 1.16,
    fearSensitivity: 0.28,
    panicThreshold: 94,
    escapeSpeedMul: 0.85,
    tripMultiplier: 0.45,
    hidingPreference: 0.0,
    surrenderThreshold: 101,
    cameraGagEligible: false,
  },
  soldier: {
    archetype: 'soldier',
    labelKr: '정규군',
    badgeColor: '#60a5fa',
    tintColor: 0xbfdbfe,
    scaleMul: 1.02,
    hpMul: 1.24,
    mass: 1.18,
    courage: 88,
    aggression: 1.18,
    fearSensitivity: 0.38,
    panicThreshold: 90,
    escapeSpeedMul: 0.96,
    tripMultiplier: 0.55,
    hidingPreference: 0.1,
    surrenderThreshold: 101,
    cameraGagEligible: true,
  },
};

export interface Step4Tuning {
  // Zhang Fei Bulldozer Charge (맹장돌진)
  chargeAnticipationMs: number;
  chargeAcceleration: number;
  chargeMaxSpeed: number;
  chargeMaxDistance: number;
  chargeEnergy: number;
  chargeDamage: number;
  chargeKnockback: number;
  chargeEnergyLossPerHit: number;
  chargeLaunchVz: number;
  chargeRecoveryMs: number;
  chargeCooldownMs: number;
  chargeNoCooldown: boolean;

  // Enemy AI & Fear
  enemyCourageMultiplier: number;
  fearGainMultiplier: number;
  panicThresholdOffset: number;
  fleeSpeedMultiplier: number;
  tripProbability: number;
  hidingPreference: number;
  peekIntervalMs: number;
  surrenderThresholdOffset: number;
  showAiDebug: boolean;

  // Camera-Glass Collision Gag
  cameraGagEnabled: boolean;
  cameraGagLaunchThreshold: number;
  cameraGagChance: number;
  cameraGagDurationMs: number;
  cameraGagCooldownMs: number;
  cameraGagSplatVolume: number;
  cameraGagSqueakVolume: number;
}

export function createDefaultStep4Tuning(): Step4Tuning {
  return {
    // Zhang Fei Charge defaults
    chargeAnticipationMs: 210,
    chargeAcceleration: 2600,
    chargeMaxSpeed: 680,
    chargeMaxDistance: 490,
    chargeEnergy: 100,
    chargeDamage: 42,
    chargeKnockback: 540,
    chargeEnergyLossPerHit: 22,
    chargeLaunchVz: 315,
    chargeRecoveryMs: 250,
    chargeCooldownMs: 4200,
    chargeNoCooldown: false,

    // Enemy AI defaults
    enemyCourageMultiplier: 1.0,
    fearGainMultiplier: 1.0,
    panicThresholdOffset: 0,
    fleeSpeedMultiplier: 1.0,
    tripProbability: 0.24,
    hidingPreference: 1.0,
    peekIntervalMs: 1450,
    surrenderThresholdOffset: 0,
    showAiDebug: false,

    // Camera-Glass Gag defaults
    cameraGagEnabled: true,
    cameraGagLaunchThreshold: 340,
    cameraGagChance: 0.30,
    cameraGagDurationMs: 1120,
    cameraGagCooldownMs: 7500,
    cameraGagSplatVolume: 1.0,
    cameraGagSqueakVolume: 0.9,
  };
}
