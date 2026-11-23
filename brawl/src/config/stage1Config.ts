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
  FORTRESS_GATE: { key: 'FORTRESS_GATE', x: 640, y: 245, labelKr: '장안문 성문' },
  LEFT_ALLEY_REAR: { key: 'LEFT_ALLEY_REAR', x: 350, y: 270, labelKr: '좌측 골목' },
  RIGHT_ALLEY_REAR: { key: 'RIGHT_ALLEY_REAR', x: 930, y: 270, labelKr: '우측 골목' },
  LEFT_STALL_MID: { key: 'LEFT_STALL_MID', x: 255, y: 420, labelKr: '좌측 시장' },
  RIGHT_STALL_MID: { key: 'RIGHT_STALL_MID', x: 1025, y: 420, labelKr: '우측 시장' },
  LEFT_FRONT: { key: 'LEFT_FRONT', x: 220, y: 580, labelKr: '좌측 전방' },
  RIGHT_FRONT: { key: 'RIGHT_FRONT', x: 1060, y: 580, labelKr: '우측 전방' },
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
    titleKr: 'WAVE 1 — 산적이 나타났다!',
    subtitleKr: '장터를 습격한 산적 무리를 물리치세요!',
    baseTotalEnemies: 6,
    spawnGroupSize: 3,
    spawnIntervalMs: 2600,
    eliteProbability: 0,
    guaranteedElites: 0,
    isBossWave: false,
    awardTreasureAfter: false,
    musicIntensity: 'WAVE_LIGHT',
    archetypePool: ['overconfident', 'stubborn', 'clumsy'],
    spawnLocations: ['FORTRESS_GATE', 'LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR'],
    comedicEventKr: '산적들이 장터 한복판으로 우르르 몰려옵니다!',
  },
  {
    waveNumber: 2,
    titleKr: 'WAVE 2 — 우당탕 시장 난투',
    subtitleKr: '테이블과 술통을 집어 던져 연쇄 충돌을 일으키세요!',
    baseTotalEnemies: 8,
    spawnGroupSize: 3,
    spawnIntervalMs: 2400,
    eliteProbability: 0,
    guaranteedElites: 0,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_LIGHT',
    archetypePool: ['coward', 'clumsy', 'overconfident', 'coward'],
    spawnLocations: ['LEFT_STALL_MID', 'RIGHT_STALL_MID', 'FORTRESS_GATE'],
    envRefreshProps: [
      { kind: 'table', x: 470, y: 455 },
      { kind: 'table', x: 810, y: 455 },
      { kind: 'barrel_water', x: 640, y: 365 },
      { kind: 'ceramic_jar', x: 540, y: 540 },
      { kind: 'ceramic_jar', x: 740, y: 540 },
    ],
    comedicEventKr: '겁쟁이 산적들이 비명을 지르며 뛰쳐나옵니다!',
  },
  {
    waveNumber: 3,
    titleKr: 'WAVE 3 — 난장판 확대!',
    subtitleKr: '사방에서 몰려오는 산적들을 시원하게 날려버리세요!',
    baseTotalEnemies: 9,
    spawnGroupSize: 4,
    spawnIntervalMs: 2200,
    eliteProbability: 0.1,
    guaranteedElites: 0,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_INTENSE',
    archetypePool: ['sneaky', 'coward', 'clumsy', 'overconfident', 'stubborn'],
    spawnLocations: [
      'FORTRESS_GATE',
      'LEFT_ALLEY_REAR',
      'RIGHT_ALLEY_REAR',
      'LEFT_STALL_MID',
      'RIGHT_STALL_MID',
    ],
    envRefreshProps: [
      { kind: 'fruit_basket', x: 430, y: 530 },
      { kind: 'fruit_basket', x: 850, y: 530 },
      { kind: 'barrel_water', x: 500, y: 345 },
      { kind: 'barrel_water', x: 780, y: 345 },
      { kind: 'barrel_empty', x: 640, y: 575 },
    ],
    comedicEventKr: '과일 바구니와 술통이 장터 곳곳에 쏟아집니다!',
  },
  {
    waveNumber: 4,
    titleKr: 'WAVE 4 — 정예 산적 등장!',
    subtitleKr: '강력한 정예 산적의 강타를 피하고 사물로 응징하세요!',
    baseTotalEnemies: 7,
    spawnGroupSize: 3,
    spawnIntervalMs: 2500,
    eliteProbability: 0.2,
    guaranteedElites: 1,
    isBossWave: false,
    awardTreasureAfter: true,
    musicIntensity: 'WAVE_INTENSE',
    archetypePool: ['stubborn', 'sneaky', 'coward', 'overconfident'],
    spawnLocations: ['FORTRESS_GATE', 'LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR', 'LEFT_FRONT', 'RIGHT_FRONT'],
    envRefreshProps: [
      { kind: 'table', x: 550, y: 470 },
      { kind: 'table', x: 730, y: 470 },
      { kind: 'barrel_water', x: 640, y: 380 },
    ],
    comedicEventKr: '붉은 머리띠의 정예 산적이 성문을 박차고 나타났습니다!',
  },
  {
    waveNumber: 5,
    titleKr: 'WAVE 5 — 산적 두목 습격!',
    subtitleKr: '장안성 외곽의 산적 두목을 쓰러뜨리고 마을을 구하세요!',
    baseTotalEnemies: 4, // Escort bandits alongside the Boss
    spawnGroupSize: 2,
    spawnIntervalMs: 4200,
    eliteProbability: 0,
    guaranteedElites: 0,
    isBossWave: true,
    awardTreasureAfter: false,
    musicIntensity: 'BOSS',
    archetypePool: ['coward', 'clumsy', 'overconfident'],
    spawnLocations: ['LEFT_ALLEY_REAR', 'RIGHT_ALLEY_REAR'],
    envRefreshProps: [
      { kind: 'table', x: 460, y: 490 },
      { kind: 'table', x: 820, y: 490 },
      { kind: 'barrel_water', x: 380, y: 380 },
      { kind: 'barrel_water', x: 900, y: 380 },
      { kind: 'ceramic_jar', x: 640, y: 590 },
    ],
    comedicEventKr: '쿵! 쿵! 쿵! 거대한 산적 두목이 몽둥이를 들고 등장합니다!',
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
 * Preserves satisfying knockback feel instead of turning bandits into HP sponges.
 */
export function getStageDifficultyProfile(
  humanCount: number,
  aiCount: number,
): StageDifficultyProfile {
  const total = Math.max(1, Math.min(4, humanCount + aiCount));
  // AI companions contribute ~0.75 of a human player's effective combat strength
  const effectiveStrength = Math.max(1, humanCount + aiCount * 0.75);

  switch (total) {
    case 1:
      return {
        activeHeroCount: 1,
        effectiveStrength,
        waveCountMultiplier: 1.0, // ~30 total bandits before boss
        maxSimultaneousEnemies: 7,
        enemyHpMultiplier: 0.9,
        bossHp: 620,
        maxConcurrentAttackers: 1,
        extraElites: 0,
      };
    case 2:
      return {
        activeHeroCount: 2,
        effectiveStrength,
        waveCountMultiplier: 1.28,
        maxSimultaneousEnemies: 11,
        enemyHpMultiplier: 1.0,
        bossHp: 860,
        maxConcurrentAttackers: 2,
        extraElites: 0,
      };
    case 3:
      return {
        activeHeroCount: 3,
        effectiveStrength,
        waveCountMultiplier: 1.52,
        maxSimultaneousEnemies: 15,
        enemyHpMultiplier: 1.08,
        bossHp: 1100,
        maxConcurrentAttackers: 2,
        extraElites: 1,
      };
    default:
      return {
        activeHeroCount: 4,
        effectiveStrength,
        waveCountMultiplier: 1.75,
        maxSimultaneousEnemies: 19,
        enemyHpMultiplier: 1.16,
        bossHp: 1340,
        maxConcurrentAttackers: 3,
        extraElites: 1,
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
