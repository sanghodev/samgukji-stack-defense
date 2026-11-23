export type HeroId = 'zhaoyun' | 'guanyu' | 'zhangfei' | 'huangzhong';

export type HeroRole = 'striker' | 'crowd_control' | 'initiator' | 'ranged';

export type SlotControlType = 'HUMAN' | 'AI' | 'EMPTY';

export type AiAggressionMode = 'PASSIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface HeroTreasureModifiers {
  extraStrikes: number;
  extraReach: number;
  extraSpreadArrows: number;
  cycloneRadiusMul: number;
  chargeDistanceMul: number;
}

export interface HeroDataSpec {
  readonly id: HeroId;
  readonly displayName: string;
  readonly engName: string;
  readonly roleLabelKr: string;
  readonly role: HeroRole;
  readonly specialName: string;
  readonly accentColor: string;
  readonly accentHex: number;
  readonly maxHp: number;
  readonly speedMultiplier: number;
  readonly damageMultiplier: number;
  readonly knockbackMultiplier: number;
  readonly rangeMultiplier: number;
  readonly widthMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly specialCooldownMs: number;
  readonly isRanged: boolean;
}

export const ALL_HERO_IDS: readonly HeroId[] = [
  'zhaoyun',
  'guanyu',
  'zhangfei',
  'huangzhong',
] as const;

export const HERO_DATA: Record<HeroId, HeroDataSpec> = {
  zhaoyun: {
    id: 'zhaoyun',
    displayName: '조운',
    engName: 'ZHAO YUN',
    roleLabelKr: '돌격 창술',
    role: 'striker',
    specialName: '백룡연격',
    accentColor: '#38bdf8',
    accentHex: 0x38bdf8,
    maxHp: 110,
    speedMultiplier: 1.08,
    damageMultiplier: 1.0,
    knockbackMultiplier: 1.0,
    rangeMultiplier: 1.02,
    widthMultiplier: 0.95,
    attackSpeedMultiplier: 1.16,
    specialCooldownMs: 3600,
    isRanged: false,
  },
  guanyu: {
    id: 'guanyu',
    displayName: '관우',
    engName: 'GUAN YU',
    roleLabelKr: '광역 제압',
    role: 'crowd_control',
    specialName: '청룡선풍참',
    accentColor: '#22c55e',
    accentHex: 0x22c55e,
    maxHp: 125,
    speedMultiplier: 0.96,
    damageMultiplier: 1.14,
    knockbackMultiplier: 1.15,
    rangeMultiplier: 1.32,
    widthMultiplier: 1.48,
    attackSpeedMultiplier: 0.88,
    specialCooldownMs: 4000,
    isRanged: false,
  },
  zhangfei: {
    id: 'zhangfei',
    displayName: '장비',
    engName: 'ZHANG FEI',
    roleLabelKr: '돌진 파괴',
    role: 'initiator',
    specialName: '맹장돌진',
    accentColor: '#c084fc',
    accentHex: 0xc084fc,
    maxHp: 130,
    speedMultiplier: 0.92,
    damageMultiplier: 1.22,
    knockbackMultiplier: 1.34,
    rangeMultiplier: 1.05,
    widthMultiplier: 1.15,
    attackSpeedMultiplier: 0.92,
    specialCooldownMs: 4200,
    isRanged: false,
  },
  huangzhong: {
    id: 'huangzhong',
    displayName: '황충',
    engName: 'HUANG ZHONG',
    roleLabelKr: '원거리 궁수',
    role: 'ranged',
    specialName: '만시제발',
    accentColor: '#facc15',
    accentHex: 0xfacc15,
    maxHp: 100,
    speedMultiplier: 1.02,
    damageMultiplier: 0.92,
    knockbackMultiplier: 0.85,
    rangeMultiplier: 1.0,
    widthMultiplier: 1.0,
    attackSpeedMultiplier: 1.12,
    specialCooldownMs: 3800,
    isRanged: true,
  },
};

export interface PartySlotConfig {
  slotIndex: number; // 0..3
  control: SlotControlType;
  heroId: HeroId | null;
  deviceId: string | null; // 'keyboard' | 'gamepad:0' | null
}

export interface PartyBalanceProfile {
  readonly enemyCount: number;
  readonly enemyHpMultiplier: number;
  readonly maxConcurrentAttackers: number;
}

/**
 * Scales encounter intensity smoothly for 1 to 4 active heroes so
 * solo play feels fair and 4-hero mayhem stays lively!
 */
export function getPartyBalanceProfile(activeHeroCount: number): PartyBalanceProfile {
  const n = Math.max(1, Math.min(4, Math.round(activeHeroCount)));
  switch (n) {
    case 1:
      return { enemyCount: 7, enemyHpMultiplier: 0.9, maxConcurrentAttackers: 1 };
    case 2:
      return { enemyCount: 10, enemyHpMultiplier: 1.0, maxConcurrentAttackers: 2 };
    case 3:
      return { enemyCount: 13, enemyHpMultiplier: 1.1, maxConcurrentAttackers: 2 };
    default:
      return { enemyCount: 15, enemyHpMultiplier: 1.2, maxConcurrentAttackers: 3 };
  }
}

export interface Step5Tuning {
  aiAggression: AiAggressionMode;
  aiDisabled: boolean;
  friendlyFire: boolean;
  showProjectiles: boolean;
  showAiGoals: boolean;
  heroDamageMultiplier: number;
  heroAttackSpeedMultiplier: number;
  treasureMods: HeroTreasureModifiers;
}

export function createDefaultStep5Tuning(): Step5Tuning {
  return {
    aiAggression: 'BALANCED',
    aiDisabled: false,
    friendlyFire: false,
    showProjectiles: false,
    showAiGoals: false,
    heroDamageMultiplier: 1.0,
    heroAttackSpeedMultiplier: 1.0,
    treasureMods: {
      extraStrikes: 0,
      extraReach: 0,
      extraSpreadArrows: 0,
      cycloneRadiusMul: 1.0,
      chargeDistanceMul: 1.0,
    },
  };
}
