import type { HeroId } from './heroConfig.ts';
import type { SeededRng } from './stage1Config.ts';

export type TreasureRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export interface TreasureModifierDelta {
  comboExtraHit?: number;
  extraReach?: number;
  attackArcMultiplier?: number;
  damageMultiplier?: number;
  attackSpeedMultiplier?: number;
  knockbackMultiplier?: number;
  collisionTransferMultiplier?: number;
  chargeDistanceMultiplier?: number;
  cycloneRadiusMultiplier?: number;
  throwPowerMultiplier?: number;
  extraProjectileCount?: number;
  burstExtraArrows?: number;
  specialExtraHits?: number;
  specialCooldownMultiplier?: number; // negative reduces cooldown (e.g., -0.18)
  maxHpBonus?: number;
  healAmount?: number;
  afterimageTrail?: boolean;
  heavyPierceBonus?: number;
  heavyWindProjectile?: boolean;
  chargeFinalShockwave?: boolean;
  piercingBasicArrows?: boolean;
  arrowSpreadWide?: boolean;
}

export interface TreasureDefinition {
  readonly id: string;
  readonly heroId: HeroId | 'ANY';
  readonly tier: number; // 1..5 for hero evolution, 0 for shared
  readonly nameKr: string;
  readonly icon: string;
  readonly rarity: TreasureRarity;
  readonly prerequisiteId?: string;
  readonly shortEffectKr: string;
  readonly comparisonKr: string;
  readonly modifiers: TreasureModifierDelta;
}

export interface ComputedHeroModifiers {
  comboExtraHit: number;
  extraReach: number;
  attackArcMultiplier: number;
  damageMultiplier: number;
  attackSpeedMultiplier: number;
  knockbackMultiplier: number;
  collisionTransferMultiplier: number;
  chargeDistanceMultiplier: number;
  cycloneRadiusMultiplier: number;
  throwPowerMultiplier: number;
  extraProjectileCount: number;
  burstExtraArrows: number;
  specialExtraHits: number;
  specialCooldownMultiplier: number;
  maxHpBonus: number;
  afterimageTrail: boolean;
  heavyPierceBonus: number;
  heavyWindProjectile: boolean;
  chargeFinalShockwave: boolean;
  piercingBasicArrows: boolean;
  arrowSpreadWide: boolean;
}

export function createBaseHeroModifiers(): ComputedHeroModifiers {
  return {
    comboExtraHit: 0,
    extraReach: 0,
    attackArcMultiplier: 1.0,
    damageMultiplier: 1.0,
    attackSpeedMultiplier: 1.0,
    knockbackMultiplier: 1.0,
    collisionTransferMultiplier: 1.0,
    chargeDistanceMultiplier: 1.0,
    cycloneRadiusMultiplier: 1.0,
    throwPowerMultiplier: 1.0,
    extraProjectileCount: 0,
    burstExtraArrows: 0,
    specialExtraHits: 0,
    specialCooldownMultiplier: 1.0,
    maxHpBonus: 0,
    afterimageTrail: false,
    heavyPierceBonus: 0,
    heavyWindProjectile: false,
    chargeFinalShockwave: false,
    piercingBasicArrows: false,
    arrowSpreadWide: false,
  };
}

/**
 * 5-tier hero-specific treasure evolution + shared arcade treasures.
 * Every upgrade makes attacks visibly and mechanically MORE FUN!
 */
export const TREASURE_CATALOG: readonly TreasureDefinition[] = [
  // ==================== ZHAO YUN (조운) ====================
  {
    id: 'zy_t1',
    heroId: 'zhaoyun',
    tier: 1,
    nameKr: '비룡연창',
    icon: '🔱',
    rarity: 'COMMON',
    shortEffectKr: '기본 창 콤보에 추가 찌르기 발동 & 공격 속도 증가',
    comparisonKr: '콤보 타수 3타 → 4타 · 공속 +10%',
    modifiers: { comboExtraHit: 1, attackSpeedMultiplier: 0.1 },
  },
  {
    id: 'zy_t2',
    heroId: 'zhaoyun',
    tier: 2,
    nameKr: '장창신위',
    icon: '⚡',
    rarity: 'RARE',
    prerequisiteId: 'zy_t1',
    shortEffectKr: '창 리치와 타격 범위가 크게 늘어나 멀리 있는 산적도 제압',
    comparisonKr: '창 리치 +28px · 범위 +12%',
    modifiers: { extraReach: 28, attackArcMultiplier: 0.12 },
  },
  {
    id: 'zy_t3',
    heroId: 'zhaoyun',
    tier: 3,
    nameKr: '청룡잔영',
    icon: '💠',
    rarity: 'RARE',
    prerequisiteId: 'zy_t2',
    shortEffectKr: '공격 시 푸른 창 잔영이 남아 추가 위력과 속도감 부여',
    comparisonKr: '푸른 잔영 ON · 공격력 +14%',
    modifiers: { afterimageTrail: true, damageMultiplier: 0.14 },
  },
  {
    id: 'zy_t4',
    heroId: 'zhaoyun',
    tier: 4,
    nameKr: '관통돌파',
    icon: '🌪️',
    rarity: 'EPIC',
    prerequisiteId: 'zy_t3',
    shortEffectKr: '전방 강공격 찌르기가 훨씬 길고 강력하게 산적을 뚫고 밀어냄',
    comparisonKr: '강공격 돌진 +28% · 넉백 +20%',
    modifiers: { heavyPierceBonus: 0.28, knockbackMultiplier: 0.2 },
  },
  {
    id: 'zy_t5',
    heroId: 'zhaoyun',
    tier: 5,
    nameKr: '백룡승천',
    icon: '🐉',
    rarity: 'LEGENDARY',
    prerequisiteId: 'zy_t4',
    shortEffectKr: '필살기 [백룡연격] 다단 연타 +3회 & 재사용 시간 단축',
    comparisonKr: '백룡연격 4타 → 7타 · 쿨타임 -20%',
    modifiers: { specialExtraHits: 3, specialCooldownMultiplier: -0.2, damageMultiplier: 0.1 },
  },

  // ==================== GUAN YU (관우) ====================
  {
    id: 'gy_t1',
    heroId: 'guanyu',
    tier: 1,
    nameKr: '청룡광참',
    icon: '🌙',
    rarity: 'COMMON',
    shortEffectKr: '청룡언월도의 베기 호가 넓어져 주변 산적을 한꺼번에 휩씀',
    comparisonKr: '베기 폭 +26% · 리치 +18px',
    modifiers: { attackArcMultiplier: 0.26, extraReach: 18 },
  },
  {
    id: 'gy_t2',
    heroId: 'guanyu',
    tier: 2,
    nameKr: '연환추격',
    icon: '⚔️',
    rarity: 'RARE',
    prerequisiteId: 'gy_t1',
    shortEffectKr: '베기 끝자락에 추가 후속 참격이 터지며 위력 상승',
    comparisonKr: '추가 참격 +1타 · 공격력 +12%',
    modifiers: { comboExtraHit: 1, damageMultiplier: 0.12 },
  },
  {
    id: 'gy_t3',
    heroId: 'guanyu',
    tier: 3,
    nameKr: '군웅격퇴',
    icon: '💥',
    rarity: 'RARE',
    prerequisiteId: 'gy_t2',
    shortEffectKr: '여러 명의 산적을 동시에 멀리 날려 연쇄 충돌 유도',
    comparisonKr: '넉백 +30% · 연쇄 전파 +20%',
    modifiers: { knockbackMultiplier: 0.3, collisionTransferMultiplier: 0.2 },
  },
  {
    id: 'gy_t4',
    heroId: 'guanyu',
    tier: 4,
    nameKr: '청룡풍파',
    icon: '🍃',
    rarity: 'EPIC',
    prerequisiteId: 'gy_t3',
    shortEffectKr: '강공격 시 전방으로 녹색 청룡 검풍 투사체를 발사!',
    comparisonKr: '강공격 검풍 발사 ON · 공격력 +12%',
    modifiers: { heavyWindProjectile: true, damageMultiplier: 0.12 },
  },
  {
    id: 'gy_t5',
    heroId: 'guanyu',
    tier: 5,
    nameKr: '청룡대선풍',
    icon: '🌀',
    rarity: 'LEGENDARY',
    prerequisiteId: 'gy_t4',
    shortEffectKr: '필살기 [청룡선풍참] 회전 반경 대폭 확대 & 추가 회전 베기',
    comparisonKr: '선풍 반경 +38% · 타수 +2 · 쿨타임 -18%',
    modifiers: { cycloneRadiusMultiplier: 0.38, specialExtraHits: 2, specialCooldownMultiplier: -0.18 },
  },

  // ==================== ZHANG FEI (장비) ====================
  {
    id: 'zf_t1',
    heroId: 'zhangfei',
    tier: 1,
    nameKr: '만부부당',
    icon: '🐗',
    rarity: 'COMMON',
    shortEffectKr: '[맹장돌진] 돌진 거리가 길어져 장터 끝까지 돌파 가능',
    comparisonKr: '돌진 거리 +35%',
    modifiers: { chargeDistanceMultiplier: 0.35 },
  },
  {
    id: 'zf_t2',
    heroId: 'zhangfei',
    tier: 2,
    nameKr: '파산격',
    icon: '🔨',
    rarity: 'RARE',
    prerequisiteId: 'zf_t1',
    shortEffectKr: '타격과 돌진의 넉백 위력이 폭발적으로 증가',
    comparisonKr: '넉백 +32% · 공격력 +14%',
    modifiers: { knockbackMultiplier: 0.32, damageMultiplier: 0.14 },
  },
  {
    id: 'zf_t3',
    heroId: 'zhangfei',
    tier: 3,
    nameKr: '도미노광란',
    icon: '🎳',
    rarity: 'RARE',
    prerequisiteId: 'zf_t2',
    shortEffectKr: '날아간 산적이 다른 산적을 연달아 쓰러뜨리는 전파력 강화',
    comparisonKr: '도미노 연쇄 전파 +42%',
    modifiers: { collisionTransferMultiplier: 0.42 },
  },
  {
    id: 'zf_t4',
    heroId: 'zhangfei',
    tier: 4,
    nameKr: '괴력투척',
    icon: '🪵',
    rarity: 'EPIC',
    prerequisiteId: 'zf_t3',
    shortEffectKr: '테이블과 술통을 훨씬 빠르고 파괴적으로 투척',
    comparisonKr: '사물 투척 위력 +45%',
    modifiers: { throwPowerMultiplier: 0.45, damageMultiplier: 0.08 },
  },
  {
    id: 'zf_t5',
    heroId: 'zhangfei',
    tier: 5,
    nameKr: '천지진동',
    icon: '🌋',
    rarity: 'LEGENDARY',
    prerequisiteId: 'zf_t4',
    shortEffectKr: '[맹장돌진] 종료 시 거대한 충격파가 터져 주변 적 전원 기절!',
    comparisonKr: '돌진 피니시 대충격파 ON · 쿨타임 -20%',
    modifiers: { chargeFinalShockwave: true, specialCooldownMultiplier: -0.2 },
  },

  // ==================== HUANG ZHONG (황충) ====================
  {
    id: 'hz_t1',
    heroId: 'huangzhong',
    tier: 1,
    nameKr: '신궁속사',
    icon: '🏹',
    rarity: 'COMMON',
    shortEffectKr: '활시위를 당기는 속도가 빨라져 끊임없이 화살 발사',
    comparisonKr: '연사 속도 +24%',
    modifiers: { attackSpeedMultiplier: 0.24 },
  },
  {
    id: 'hz_t2',
    heroId: 'huangzhong',
    tier: 2,
    nameKr: '쌍시연발',
    icon: '🎯',
    rarity: 'RARE',
    prerequisiteId: 'hz_t1',
    shortEffectKr: '기본 공격마다 화살을 2발 동시에 발사!',
    comparisonKr: '기본 화살 1발 → 2발',
    modifiers: { extraProjectileCount: 1 },
  },
  {
    id: 'hz_t3',
    heroId: 'huangzhong',
    tier: 3,
    nameKr: '삼시산탄',
    icon: '🌟',
    rarity: 'RARE',
    prerequisiteId: 'hz_t2',
    shortEffectKr: '부채꼴 3방향으로 화살을 동시에 날려 다수의 산적 제압',
    comparisonKr: '기본 화살 2발 → 3발 부채꼴',
    modifiers: { extraProjectileCount: 1, arrowSpreadWide: true },
  },
  {
    id: 'hz_t4',
    heroId: 'huangzhong',
    tier: 4,
    nameKr: '파갑관통',
    icon: '☄️',
    rarity: 'EPIC',
    prerequisiteId: 'hz_t3',
    shortEffectKr: '일반 화살도 산적을 관통하며 위력 상승!',
    comparisonKr: '화살 관통 ON · 공격력 +16%',
    modifiers: { piercingBasicArrows: true, damageMultiplier: 0.16 },
  },
  {
    id: 'hz_t5',
    heroId: 'huangzhong',
    tier: 5,
    nameKr: '만시폭풍',
    icon: '🎇',
    rarity: 'LEGENDARY',
    prerequisiteId: 'hz_t4',
    shortEffectKr: '필살기 [만시제발]이 사방으로 쏟아지는 초대형 화살 폭풍으로 진화!',
    comparisonKr: '필살기 화살 +6발 · 쿨타임 -20%',
    modifiers: { burstExtraArrows: 6, specialCooldownMultiplier: -0.2 },
  },

  // ==================== SHARED ARCADE TREASURES ====================
  {
    id: 'shared_peach',
    heroId: 'ANY',
    tier: 0,
    nameKr: '도원 선도',
    icon: '🍑',
    rarity: 'COMMON',
    shortEffectKr: '체력을 즉시 45 회복하고 최대 체력 증가',
    comparisonKr: 'HP +45 회복 · 최대 HP +20',
    modifiers: { maxHpBonus: 20, healAmount: 45 },
  },
  {
    id: 'shared_drum',
    heroId: 'ANY',
    tier: 0,
    nameKr: '전장의 북',
    icon: '🥁',
    rarity: 'RARE',
    shortEffectKr: '필살기 회전율과 공격 속도가 눈에 띄게 빨라짐',
    comparisonKr: '필살기 쿨타임 -15% · 공속 +10%',
    modifiers: { specialCooldownMultiplier: -0.15, attackSpeedMultiplier: 0.1 },
  },
  {
    id: 'shared_chaos_jade',
    heroId: 'ANY',
    tier: 0,
    nameKr: '난장판 옥패',
    icon: '🪩',
    rarity: 'EPIC',
    shortEffectKr: '사물 투척과 연쇄 충돌 위력이 대폭 강화되어 장터가 아수라장!',
    comparisonKr: '넉백 +18% · 연쇄 전파 +25% · 투척 +25%',
    modifiers: {
      knockbackMultiplier: 0.18,
      collisionTransferMultiplier: 0.25,
      throwPowerMultiplier: 0.25,
    },
  },
  {
    id: 'shared_valor_seal',
    heroId: 'ANY',
    tier: 0,
    nameKr: '무장의 인장',
    icon: '🏅',
    rarity: 'RARE',
    shortEffectKr: '모든 공격의 위력과 타격 범위가 고르게 상승',
    comparisonKr: '공격력 +15% · 리치 +14px',
    modifiers: { damageMultiplier: 0.15, extraReach: 14 },
  },
];

export const TREASURE_BY_ID: ReadonlyMap<string, TreasureDefinition> = new Map(
  TREASURE_CATALOG.map((t) => [t.id, t]),
);

/**
 * Aggregates all acquired treasure IDs for a hero with predictable stacking & safety caps
 * (prevents infinite damage or unbounded projectile explosions).
 */
export function computeHeroModifiers(acquiredIds: readonly string[]): ComputedHeroModifiers {
  const m = createBaseHeroModifiers();
  for (const id of acquiredIds) {
    const def = TREASURE_BY_ID.get(id);
    if (!def) continue;
    const d = def.modifiers;
    if (d.comboExtraHit) m.comboExtraHit += d.comboExtraHit;
    if (d.extraReach) m.extraReach += d.extraReach;
    if (d.attackArcMultiplier) m.attackArcMultiplier += d.attackArcMultiplier;
    if (d.damageMultiplier) m.damageMultiplier += d.damageMultiplier;
    if (d.attackSpeedMultiplier) m.attackSpeedMultiplier += d.attackSpeedMultiplier;
    if (d.knockbackMultiplier) m.knockbackMultiplier += d.knockbackMultiplier;
    if (d.collisionTransferMultiplier) m.collisionTransferMultiplier += d.collisionTransferMultiplier;
    if (d.chargeDistanceMultiplier) m.chargeDistanceMultiplier += d.chargeDistanceMultiplier;
    if (d.cycloneRadiusMultiplier) m.cycloneRadiusMultiplier += d.cycloneRadiusMultiplier;
    if (d.throwPowerMultiplier) m.throwPowerMultiplier += d.throwPowerMultiplier;
    if (d.extraProjectileCount) m.extraProjectileCount += d.extraProjectileCount;
    if (d.burstExtraArrows) m.burstExtraArrows += d.burstExtraArrows;
    if (d.specialExtraHits) m.specialExtraHits += d.specialExtraHits;
    if (d.specialCooldownMultiplier) m.specialCooldownMultiplier += d.specialCooldownMultiplier;
    if (d.maxHpBonus) m.maxHpBonus += d.maxHpBonus;
    if (d.afterimageTrail) m.afterimageTrail = true;
    if (d.heavyPierceBonus) m.heavyPierceBonus += d.heavyPierceBonus;
    if (d.heavyWindProjectile) m.heavyWindProjectile = true;
    if (d.chargeFinalShockwave) m.chargeFinalShockwave = true;
    if (d.piercingBasicArrows) m.piercingBasicArrows = true;
    if (d.arrowSpreadWide) m.arrowSpreadWide = true;
  }

  // Predictable safety clamps
  m.comboExtraHit = Math.min(2, m.comboExtraHit);
  m.extraReach = Math.min(72, m.extraReach);
  m.attackArcMultiplier = Math.min(1.8, m.attackArcMultiplier);
  m.damageMultiplier = Math.min(2.4, m.damageMultiplier);
  m.attackSpeedMultiplier = Math.min(1.75, m.attackSpeedMultiplier);
  m.knockbackMultiplier = Math.min(2.2, m.knockbackMultiplier);
  m.collisionTransferMultiplier = Math.min(2.2, m.collisionTransferMultiplier);
  m.chargeDistanceMultiplier = Math.min(1.9, m.chargeDistanceMultiplier);
  m.cycloneRadiusMultiplier = Math.min(1.85, m.cycloneRadiusMultiplier);
  m.throwPowerMultiplier = Math.min(2.0, m.throwPowerMultiplier);
  m.extraProjectileCount = Math.min(2, m.extraProjectileCount); // Max 3 basic arrows
  m.burstExtraArrows = Math.min(8, m.burstExtraArrows);
  m.specialExtraHits = Math.min(4, m.specialExtraHits);
  m.specialCooldownMultiplier = Math.max(0.5, m.specialCooldownMultiplier);
  return m;
}

/**
 * Rolls up to 3 distinct treasure choices tailored to a hero.
 * Always includes the next available hero-specific evolution tier first!
 */
export function rollTreasureChoices(
  heroId: HeroId,
  acquiredIds: readonly string[],
  rng: SeededRng,
): TreasureDefinition[] {
  const owned = new Set(acquiredIds);
  const choices: TreasureDefinition[] = [];

  // 1. Next eligible hero-specific evolution treasure
  const nextHeroTier = TREASURE_CATALOG.find(
    (t) =>
      t.heroId === heroId &&
      !owned.has(t.id) &&
      (!t.prerequisiteId || owned.has(t.prerequisiteId)),
  );
  if (nextHeroTier) {
    choices.push(nextHeroTier);
  }

  // 2. Also allow skipping ahead 1 tier as a rare lucky offer if tier+1 exists and isn't already added
  const futureHeroTier = TREASURE_CATALOG.find(
    (t) =>
      t.heroId === heroId &&
      !owned.has(t.id) &&
      t.id !== nextHeroTier?.id &&
      nextHeroTier &&
      t.tier === nextHeroTier.tier + 1,
  );
  if (futureHeroTier && choices.length < 3) {
    choices.push(futureHeroTier);
  }

  // 3. Fill remaining slots with shared arcade treasures (shuffled via seeded RNG)
  const sharedPool = TREASURE_CATALOG.filter(
    (t) => t.heroId === 'ANY' && (!owned.has(t.id) || t.id === 'shared_peach'),
  );
  const shuffled = [...sharedPool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (const item of shuffled) {
    if (choices.length >= 3) break;
    if (!choices.some((c) => c.id === item.id)) {
      choices.push(item);
    }
  }

  return choices.slice(0, 3);
}
