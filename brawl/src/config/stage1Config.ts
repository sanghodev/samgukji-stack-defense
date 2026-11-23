import type { BanditArchetype } from './step4Config.ts';
import type { EnvObjectKind } from './mayhemConfig.ts';

export type StageState =
  | 'PREPARATION'
  | 'INTRO'
  | 'WAVE_START'
  | 'WAVE_ACTIVE'
  | 'WAVE_CLEARED'
  | 'TREASURE_REWARD'
  | 'BOSS_WARNING'
  | 'BOSS_ACTIVE'
  | 'VICTORY'
  | 'DEFEAT'
  | 'PAUSED';

export type MusicIntensity = 'CALM' | 'WAVE_LIGHT' | 'WAVE_INTENSE' | 'BOSS' | 'VICTORY' | 'DEFEAT';

export type SpawnLocationKey =
  | 'FORTRESS_GATE'
  | 'LEFT_ALLEY_REAR'
  | 'RIGHT_ALLEY_REAR'
  | 'LEFT_STALL_MID'
  | 'RIGHT_STALL_MID'
  | 'LEFT_FRONT'
  | 'RIGHT_FRONT';

export interface WorldSpawnPoint {
  readonly key: SpawnLocationKey;
  readonly x: number;
  readonly y: number;
  readonly labelKr: string;
}

/**
 * Valid, reachable spawn positions around the marketplace perimeter.
 * Never spawns outside ARENA_BOUNDS or directly on top of center heroes.
 */
export const STAGE1_SPAWN_POINTS: Record<SpawnLocationKey, WorldSpawnPoint> = {
  FORTRESS_GATE: { key: 'FORTRESS_GATE', x: 915, y: 294, labelKr: '장안문 성문' },
  LEFT_ALLEY_REAR: { key: 'LEFT_ALLEY_REAR', x: 355, y: 306, labelKr: '좌측 막사' },
  RIGHT_ALLEY_REAR: { key: 'RIGHT_ALLEY_REAR', x: 995, y: 308, labelKr: '우측 수레' },
  LEFT_STALL_MID: { key: 'LEFT_STALL_MID', x: 245, y: 425, labelKr: '좌측 장터' },
  RIGHT_STALL_MID: { key: 'RIGHT_STALL_MID', x: 1055, y: 425, labelKr: '우측 장터' },
  LEFT_FRONT: { key: 'LEFT_FRONT', x: 225, y: 585, labelKr: '좌측 전방' },
  RIGHT_FRONT: { key: 'RIGHT_FRONT', x: 1055, y: 585, labelKr: '우측 전방' },
};

export interface WaveSpawnGroup {
  readonly archetypes: readonly BanditArchetype[];
  readonly count: number;
  readonly locations: readonly SpawnLocationKey[];
}

export interface WaveDefinition {
  readonly waveNumber: number; // 1..5
  readonly titleKr: string;
  readonly subtitleKr: string;
  readonly baseTotalEnemies: number; // Solo baseline (sum of waves 1-4 ~= 30)
  readonly spawnGroupSize: number;
  readonly spawnIntervalMs: number;
  readonly eliteProbability: number;
  readonly guaranteedElites: number;
  readonly isBossWave: boolean;
  readonly awardTreasureAfter: boolean;
  readonly musicIntensity: MusicIntensity;
  readonly archetypePool: readonly BanditArchetype[];
  readonly spawnLocations: readonly SpawnLocationKey[];
  readonly envRefreshProps?: ReadonlyArray<{ kind: EnvObjectKind; x: number; y: number }>;
  readonly comedicEventKr?: string;
}

export const STAGE_1_INFO = {
  chapterId: 'stage_1',
  titleKr: '제1장 — 산적 소탕',
  subtitleEn: 'Bandit Mayhem',
  locationKr: '장안성 외곽 시장',
} as const;

export const STAGE_1_WAVES: readonly WaveDefinition[] = [
  {
    waveNumber: 1,
    titleKr: 'WAVE 1 — 산적 대군 습격!',
    subtitleKr: '장터를 뒤덮는 산적 무리를 물리치세요!',
    baseTotalEnemies: 28,
    spawnGroupSize: 7,
    spawnIntervalMs: 1200,
    eliteProbability: 0.06,
    guaranteedElites: 1,
    isBossWave: false,
    awardTreasureAfter: false,
    musicIntensity: 'WAVE_LIGHT',
    archetypePool: ['overconfident', 'stubborn', 'clumsy', 'coward', 'archer', 'bomber', 'grappler'],
    spawnLocations: ['FORTRESS_GATE', 'LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR', 'LEFT_STALL_MID', 'RIGHT_STALL_MID'],
    comedicEventKr: '산적 무리와 궁수·폭탄병이 장터 한복판으로 우르르 몰려옵니다!',
  },
  {
    waveNumber: 2,
    titleKr: 'WAVE 2 — 우당탕 시장 대난투',
    subtitleKr: '테이블과 시장 물건을 집어 던져 연쇄 충돌을 일으키세요!',
    baseTotalEnemies: 36,
    spawnGroupSize: 9,
    spawnIntervalMs: 1100,
    eliteProbability: 0.12,
    guaranteedElites: 2,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_LIGHT',
    archetypePool: ['coward', 'clumsy', 'overconfident', 'sneaky', 'archer', 'bomber', 'grappler', 'soldier'],
    spawnLocations: ['LEFT_STALL_MID', 'RIGHT_STALL_MID', 'FORTRESS_GATE', 'LEFT_FRONT', 'RIGHT_FRONT'],
    envRefreshProps: [
      { kind: 'table', x: 470, y: 455 },
      { kind: 'table', x: 810, y: 455 },
      { kind: 'silk_bolts', x: 640, y: 315 },
      { kind: 'fish_tub', x: 640, y: 380 },
      { kind: 'meat_stall', x: 370, y: 420 },
      { kind: 'grain_sack', x: 540, y: 545 },
      { kind: 'bean_sack', x: 740, y: 545 },
      { kind: 'spice_stall', x: 480, y: 595 },
      { kind: 'fruit_basket', x: 800, y: 595 },
    ],
    comedicEventKr: '사방에서 화살·폭탄·장사꾼 괴한들이 쏟아져 나옵니다!',
  },
  {
    waveNumber: 3,
    titleKr: 'WAVE 3 — 난장판 확대!',
    subtitleKr: '궁수·폭탄병·자객·거한까지 총출동! 시원하게 날려버리세요!',
    baseTotalEnemies: 44,
    spawnGroupSize: 11,
    spawnIntervalMs: 1050,
    eliteProbability: 0.16,
    guaranteedElites: 2,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_INTENSE',
    archetypePool: ['sneaky', 'archer', 'bomber', 'grappler', 'soldier', 'overconfident', 'stubborn', 'clumsy'],
    spawnLocations: [
      'FORTRESS_GATE',
      'LEFT_ALLEY_REAR',
      'RIGHT_ALLEY_REAR',
      'LEFT_STALL_MID',
      'RIGHT_STALL_MID',
      'LEFT_FRONT',
      'RIGHT_FRONT',
    ],
    envRefreshProps: [
      { kind: 'silk_bolts', x: 430, y: 530 },
      { kind: 'meat_stall', x: 850, y: 530 },
      { kind: 'fish_tub', x: 500, y: 355 },
      { kind: 'barrel_water', x: 780, y: 355 },
      { kind: 'grain_sack', x: 640, y: 575 },
      { kind: 'table', x: 520, y: 395 },
      { kind: 'table', x: 760, y: 395 },
      { kind: 'bean_sack', x: 410, y: 330 },
      { kind: 'spice_stall', x: 870, y: 330 },
    ],
    comedicEventKr: '비단·생선·고기·푸대자루가 장터 곳곳에 쏟아집니다!',
  },
  {
    waveNumber: 4,
    titleKr: 'WAVE 4 — 정규군 & 정예 산적 총공세!',
    subtitleKr: '중갑병·거한·폭탄병의 맹공을 뚫고 장터를 평정하세요!',
    baseTotalEnemies: 38,
    spawnGroupSize: 10,
    spawnIntervalMs: 1150,
    eliteProbability: 0.24,
    guaranteedElites: 4,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_INTENSE',
    archetypePool: ['soldier', 'grappler', 'bomber', 'archer', 'sneaky', 'overconfident', 'stubborn'],
    spawnLocations: ['FORTRESS_GATE', 'LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR', 'LEFT_FRONT', 'RIGHT_FRONT'],
    envRefreshProps: [
      { kind: 'table', x: 550, y: 470 },
      { kind: 'table', x: 730, y: 470 },
      { kind: 'fish_tub', x: 640, y: 385 },
      { kind: 'grain_sack', x: 450, y: 550 },
      { kind: 'bean_sack', x: 830, y: 550 },
      { kind: 'silk_bolts', x: 640, y: 305 },
    ],
    comedicEventKr: '투구 쓴 정규군과 정예 부대가 성문을 박차고 나타났습니다!',
  },
  {
    waveNumber: 5,
    titleKr: 'WAVE 5 — 산적 두목 대침공!',
    subtitleKr: '장안성 외곽의 산적 두목과 정예 호위 대군을 물리치세요!',
    baseTotalEnemies: 22, // Escort bandits alongside the Boss
    spawnGroupSize: 6,
    spawnIntervalMs: 2100,
    eliteProbability: 0.18,
    guaranteedElites: 2,
    isBossWave: true,
    awardTreasureAfter: false,
    musicIntensity: 'BOSS',
    archetypePool: ['archer', 'bomber', 'grappler', 'soldier', 'sneaky', 'overconfident'],
    spawnLocations: ['LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR', 'LEFT_STALL_MID', 'RIGHT_STALL_MID'],
    envRefreshProps: [
      { kind: 'table', x: 460, y: 490 },
      { kind: 'table', x: 820, y: 490 },
      { kind: 'fish_tub', x: 380, y: 380 },
      { kind: 'meat_stall', x: 900, y: 380 },
      { kind: 'grain_sack', x: 640, y: 590 },
      { kind: 'silk_bolts', x: 520, y: 610 },
      { kind: 'spice_stall', x: 760, y: 610 },
    ],
    comedicEventKr: '쿵! 쿵! 쿵! 거대한 산적 두목과 정예 호위대가 몰려옵니다!',
  },
];

export interface StageDifficultyProfile {
  readonly activeHeroCount: number;
  readonly effectiveStrength: number;
  readonly waveCountMultiplier: number;
  readonly maxSimultaneousEnemies: number;
  readonly enemyHpMultiplier: number;
  readonly bossHp: number;
  readonly maxConcurrentAttackers: number;
  readonly extraElites: number;
}

/**
 * Scales Stage 1 smoothly for ANY active party size (1 to 4 heroes, with or without AI).
 */
export function getStageDifficultyProfile(
  humanCount: number,
  aiCount: number,
): StageDifficultyProfile {
  const total = Math.max(1, Math.min(4, humanCount + aiCount));
  const effectiveStrength = Math.max(1, humanCount + aiCount * 0.75);

  switch (total) {
    case 1:
      return {
        activeHeroCount: 1,
        effectiveStrength,
        waveCountMultiplier: 1.0,
        maxSimultaneousEnemies: 22,
        enemyHpMultiplier: 1.25,
        bossHp: 1100,
        maxConcurrentAttackers: 2,
        extraElites: 1,
      };
    case 2:
      return {
        activeHeroCount: 2,
        effectiveStrength,
        waveCountMultiplier: 1.28,
        maxSimultaneousEnemies: 32,
        enemyHpMultiplier: 1.4,
        bossHp: 1550,
        maxConcurrentAttackers: 3,
        extraElites: 2,
      };
    case 3:
      return {
        activeHeroCount: 3,
        effectiveStrength,
        waveCountMultiplier: 1.52,
        maxSimultaneousEnemies: 42,
        enemyHpMultiplier: 1.55,
        bossHp: 2000,
        maxConcurrentAttackers: 4,
        extraElites: 3,
      };
    default:
      return {
        activeHeroCount: 4,
        effectiveStrength,
        waveCountMultiplier: 1.75,
        maxSimultaneousEnemies: 52,
        enemyHpMultiplier: 1.7,
        bossHp: 2500,
        maxConcurrentAttackers: 5,
        extraElites: 4,
      };
  }
}

/**
 * Deterministic Mulberry32 PRNG for bounded run-to-run variation.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  public pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
}
