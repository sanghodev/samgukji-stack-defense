import type { BanditArchetype } from '../config/step4Config.ts';
import {
  getStageDifficultyProfile,
  SeededRng,
  type SpawnLocationKey,
  STAGE_1_WAVES,
  STAGE1_SPAWN_POINTS,
  type StageDifficultyProfile,
  type StageState,
  type WaveDefinition,
  type WorldSpawnPoint,
} from '../config/stage1Config.ts';

export interface SpawnInstruction {
  readonly archetype: BanditArchetype;
  readonly spawnPoint: WorldSpawnPoint;
  readonly hpMultiplier: number;
}

export interface RunScoreStats {
  totalScore: number;
  highestCombo: number;
  maxMultiHit: number;
  longestChain: number;
  objectsDestroyed: number;
  tablesThrown: number;
  enemiesDefeated: number;
  enemiesSurrendered: number;
  bossDodges: number;
  clearTimeMs: number;
  bestMomentKr: string;
}

export interface StageStepInput {
  deltaMs: number;
  activeNonNeutralizedEnemies: number;
  activeBossAlive: boolean;
  bossSpawned: boolean;
  aliveHeroCount: number;
  heroPositions: ReadonlyArray<{ x: number; y: number }>;
}

export interface StageStepResult {
  stateChangedTo?: StageState;
  spawns: SpawnInstruction[];
  shouldSpawnBoss: boolean;
  shouldFlushHidingBandits: boolean;
  waveBanner?: { titleKr: string; subtitleKr: string; waveNumber: number };
  refreshEnvWaveIndex?: number;
}

/**
 * Reusable Stage Flow State Machine for Three Kingdoms Mayhem.
 * Manages waves 1..5, flexible 1-4 party scaling, anti-stall rules for hiding/fleeing/surrendered
 * bandits, boss warning/battle, treasure rewards, scoring, victory, and defeat.
 */
export class StageDirector {
  public state: StageState = 'PREPARATION';
  public waveIndex = 0; // 0..4 (corresponds to Wave 1..5)
  public difficulty: StageDifficultyProfile;
  public rng: SeededRng;
  public runSeed: number;

  public remainingSpawnsInWave = 0;
  public elitesRemainingInWave = 0;
  public readonly stats: RunScoreStats;

  private stateTimerMs = 0;
  private spawnTimerMs = 0;
  private stallWatchMs = 0;
  private victoryTriggered = false;
  private defeatTriggered = false;
  private bossSpawnedFlag = false;
  private pausedFromState: StageState | null = null;
  private readonly scoredEventIds = new Set<string>();

  constructor(humanCount = 1, aiCount = 3, seed = Date.now()) {
    this.runSeed = seed >>> 0;
    this.rng = new SeededRng(this.runSeed);
    this.difficulty = getStageDifficultyProfile(humanCount, aiCount);
    this.stats = this.createEmptyStats();
  }

  private createEmptyStats(): RunScoreStats {
    return {
      totalScore: 0,
      highestCombo: 0,
      maxMultiHit: 0,
      longestChain: 0,
      objectsDestroyed: 0,
      tablesThrown: 0,
      enemiesDefeated: 0,
      enemiesSurrendered: 0,
      bossDodges: 0,
      clearTimeMs: 0,
      bestMomentKr: '장터의 평화를 지킨 영웅들!',
    };
  }

  public get currentWave(): WaveDefinition {
    return STAGE_1_WAVES[Math.max(0, Math.min(STAGE_1_WAVES.length - 1, this.waveIndex))];
  }

  public get totalWaves(): number {
    return STAGE_1_WAVES.length;
  }

  public resetForNewRun(humanCount: number, aiCount: number, seed = Date.now()): void {
    this.runSeed = seed >>> 0;
    this.rng = new SeededRng(this.runSeed);
    this.difficulty = getStageDifficultyProfile(humanCount, aiCount);
    this.state = 'PREPARATION';
    this.waveIndex = 0;
    this.remainingSpawnsInWave = 0;
    this.elitesRemainingInWave = 0;
    this.stateTimerMs = 0;
    this.spawnTimerMs = 0;
    this.stallWatchMs = 0;
    this.victoryTriggered = false;
    this.defeatTriggered = false;
    this.bossSpawnedFlag = false;
    this.pausedFromState = null;
    this.scoredEventIds.clear();
    Object.assign(this.stats, this.createEmptyStats());
  }

  /** Smoothly adjusts future spawn budgets when players join or leave mid-stage. */
  public updatePartySize(humanCount: number, aiCount: number): void {
    const prev = this.difficulty;
    this.difficulty = getStageDifficultyProfile(humanCount, aiCount);
    // Smoothly adjust ONLY remaining future spawns (never abruptly delete active enemies or dump a huge burst)
    if (this.remainingSpawnsInWave > 0 && prev.waveCountMultiplier > 0) {
      const ratio = this.difficulty.waveCountMultiplier / prev.waveCountMultiplier;
      const adjusted = Math.round(this.remainingSpawnsInWave * (0.5 + 0.5 * ratio));
      this.remainingSpawnsInWave = Math.max(1, Math.min(this.remainingSpawnsInWave + 3, adjusted));
    }
  }

  public startIntro(): StageState {
    if (this.state !== 'PREPARATION') return this.state;
    this.state = 'INTRO';
    this.stateTimerMs = 0;
    return this.state;
  }

  public finishIntroAndBeginStage(): StageStepResult {
    this.waveIndex = 0;
    return this.enterWaveStart(0);
  }

  public jumpToWave(targetWaveIndex: number): StageStepResult {
    const clamped = Math.max(0, Math.min(STAGE_1_WAVES.length - 1, targetWaveIndex));
    this.victoryTriggered = false;
    this.defeatTriggered = false;
    this.bossSpawnedFlag = false;
    return this.enterWaveStart(clamped);
  }

  public finishTreasureReward(): StageStepResult {
    if (this.state !== 'TREASURE_REWARD') {
      return { spawns: [], shouldSpawnBoss: false, shouldFlushHidingBandits: false };
    }
    const nextIdx = this.waveIndex + 1;
    if (nextIdx >= STAGE_1_WAVES.length) {
      return this.triggerVictory();
    }
    return this.enterWaveStart(nextIdx);
  }

  public pause(): void {
    if (this.state === 'PAUSED' || this.state === 'VICTORY' || this.state === 'DEFEAT') return;
    this.pausedFromState = this.state;
    this.state = 'PAUSED';
  }

  public resume(): void {
    if (this.state !== 'PAUSED' || !this.pausedFromState) return;
    this.state = this.pausedFromState;
    this.pausedFromState = null;
  }

  public triggerVictory(): StageStepResult {
    if (this.victoryTriggered || this.defeatTriggered) {
      return { spawns: [], shouldSpawnBoss: false, shouldFlushHidingBandits: false };
    }
    this.victoryTriggered = true;
    this.remainingSpawnsInWave = 0;
    this.state = 'VICTORY';
    this.stateTimerMs = 0;
    this.computeBestMoment();
    return {
      stateChangedTo: 'VICTORY',
      spawns: [],
      shouldSpawnBoss: false,
      shouldFlushHidingBandits: false,
    };
  }

  public triggerDefeat(): StageStepResult {
    if (this.defeatTriggered || this.victoryTriggered) {
      return { spawns: [], shouldSpawnBoss: false, shouldFlushHidingBandits: false };
    }
    this.defeatTriggered = true;
    this.remainingSpawnsInWave = 0;
    this.state = 'DEFEAT';
    this.stateTimerMs = 0;
    return {
      stateChangedTo: 'DEFEAT',
      spawns: [],
      shouldSpawnBoss: false,
      shouldFlushHidingBandits: false,
    };
  }

  public step(input: StageStepInput): StageStepResult {
    const res: StageStepResult = {
      spawns: [],
      shouldSpawnBoss: false,
      shouldFlushHidingBandits: false,
    };

    if (
      this.state === 'PREPARATION' ||
      this.state === 'INTRO' ||
      this.state === 'TREASURE_REWARD' ||
      this.state === 'VICTORY' ||
      this.state === 'DEFEAT' ||
      this.state === 'PAUSED'
    ) {
      return res;
    }

    const dt = Math.min(input.deltaMs, 100);
    this.stateTimerMs += dt;
    this.stats.clearTimeMs += dt;

    // Check defeat first (all eligible heroes downed)
    if (input.aliveHeroCount <= 0) {
      return this.triggerDefeat();
    }

    if (this.state === 'WAVE_START') {
      if (this.stateTimerMs >= 1350) {
        const wave = this.currentWave;
        if (wave.isBossWave) {
          this.state = 'BOSS_WARNING';
          this.stateTimerMs = 0;
          res.stateChangedTo = 'BOSS_WARNING';
        } else {
          this.state = 'WAVE_ACTIVE';
          this.stateTimerMs = 0;
          this.spawnTimerMs = 0; // Immediate first spawn group
          res.stateChangedTo = 'WAVE_ACTIVE';
        }
      }
      return res;
    }

    if (this.state === 'BOSS_WARNING') {
      if (this.stateTimerMs >= 1900) {
        this.state = 'BOSS_ACTIVE';
        this.stateTimerMs = 0;
        this.spawnTimerMs = 1200;
        res.stateChangedTo = 'BOSS_ACTIVE';
        if (!this.bossSpawnedFlag) {
          this.bossSpawnedFlag = true;
          res.shouldSpawnBoss = true;
        }
      }
      return res;
    }

    if (this.state === 'WAVE_ACTIVE') {
      this.stepSpawning(dt, input, res);

      // Anti-stall: if all spawns are done and <= 2 enemies remain for > 5s, flush any hiding bandits!
      if (this.remainingSpawnsInWave <= 0 && input.activeNonNeutralizedEnemies > 0 && input.activeNonNeutralizedEnemies <= 2) {
        this.stallWatchMs += dt;
        if (this.stallWatchMs >= 5000) {
          this.stallWatchMs = 0;
          res.shouldFlushHidingBandits = true;
        }
      } else {
        this.stallWatchMs = 0;
      }

      // Wave cleared when queue empty and all bandits are defeated/surrendered/resolved
      if (this.remainingSpawnsInWave <= 0 && input.activeNonNeutralizedEnemies <= 0) {
        this.state = 'WAVE_CLEARED';
        this.stateTimerMs = 0;
        res.stateChangedTo = 'WAVE_CLEARED';
      }
      return res;
    }

    if (this.state === 'WAVE_CLEARED') {
      if (this.stateTimerMs >= 1100) {
        if (this.currentWave.awardTreasureAfter) {
          this.state = 'TREASURE_REWARD';
          this.stateTimerMs = 0;
          res.stateChangedTo = 'TREASURE_REWARD';
        } else {
          const nextIdx = this.waveIndex + 1;
          if (nextIdx >= STAGE_1_WAVES.length) {
            return this.triggerVictory();
          }
          return this.enterWaveStart(nextIdx);
        }
      }
      return res;
    }

    if (this.state === 'BOSS_ACTIVE') {
      // Spawn small escort bandits gradually during boss fight
      if (input.activeBossAlive) {
        this.stepSpawning(dt, input, res);
      }

      // Boss defeated -> Victory!
      if (input.bossSpawned && !input.activeBossAlive) {
        return this.triggerVictory();
      }
      return res;
    }

    return res;
  }

  private enterWaveStart(idx: number): StageStepResult {
    this.waveIndex = idx;
    const wave = this.currentWave;
    this.state = 'WAVE_START';
    this.stateTimerMs = 0;
    this.spawnTimerMs = 0;
    this.stallWatchMs = 0;

    // Calculate scaled wave budget with slight seeded variation (-1..+1)
    const variance = wave.isBossWave ? 0 : this.rng.int(-1, 1);
    const scaled = Math.max(
      wave.isBossWave ? 2 : 4,
      Math.round(wave.baseTotalEnemies * this.difficulty.waveCountMultiplier) + variance,
    );
    this.remainingSpawnsInWave = scaled;
    this.elitesRemainingInWave =
      wave.guaranteedElites > 0
        ? wave.guaranteedElites + this.difficulty.extraElites
        : 0;

    return {
      stateChangedTo: 'WAVE_START',
      spawns: [],
      shouldSpawnBoss: false,
      shouldFlushHidingBandits: false,
      waveBanner: {
        titleKr: wave.titleKr,
        subtitleKr: wave.subtitleKr,
        waveNumber: wave.waveNumber,
      },
      refreshEnvWaveIndex: wave.envRefreshProps ? idx : undefined,
    };
  }

  private stepSpawning(dt: number, input: StageStepInput, res: StageStepResult): void {
    if (this.remainingSpawnsInWave <= 0) return;

    this.spawnTimerMs -= dt;
    if (this.spawnTimerMs > 0) return;

    const wave = this.currentWave;
    const capacity = Math.max(
      0,
      this.difficulty.maxSimultaneousEnemies - input.activeNonNeutralizedEnemies,
    );
    if (capacity <= 0) {
      this.spawnTimerMs = 600;
      return;
    }

    const batchCount = Math.min(
      this.remainingSpawnsInWave,
      capacity,
      Math.max(1, wave.spawnGroupSize),
    );

    for (let i = 0; i < batchCount; i++) {
      let archetype: BanditArchetype;
      if (this.elitesRemainingInWave > 0) {
        archetype = 'elite';
        this.elitesRemainingInWave -= 1;
      } else if (wave.eliteProbability > 0 && this.rng.next() < wave.eliteProbability) {
        archetype = 'elite';
      } else {
        archetype = this.rng.pick(wave.archetypePool);
      }

      const loc = this.pickSafeSpawnLocation(wave.spawnLocations, input.heroPositions);
      // Small jitter within safe arena bounds
      const jitterX = this.rng.int(-24, 24);
      const jitterY = this.rng.int(-14, 14);
      res.spawns.push({
        archetype,
        spawnPoint: {
          ...loc,
          x: loc.x + jitterX,
          y: loc.y + jitterY,
        },
        hpMultiplier: this.difficulty.enemyHpMultiplier,
      });
      this.remainingSpawnsInWave -= 1;
    }

    this.spawnTimerMs = wave.spawnIntervalMs;
  }

  private pickSafeSpawnLocation(
    candidates: readonly SpawnLocationKey[],
    heroPositions: ReadonlyArray<{ x: number; y: number }>,
  ): WorldSpawnPoint {
    // Prefer spawn points at least 150px away from all heroes to avoid unfair pop-in
    const safe = candidates.filter((key) => {
      const pt = STAGE1_SPAWN_POINTS[key];
      return heroPositions.every((h) => Math.hypot(h.x - pt.x, h.y - pt.y) >= 150);
    });
    const pool = safe.length > 0 ? safe : candidates;
    return STAGE1_SPAWN_POINTS[this.rng.pick(pool)];
  }

  // ==================== SCORING & MAYHEM STATS ====================

  public addScoreEvent(
    eventId: string | null,
    points: number,
  ): boolean {
    if (eventId) {
      if (this.scoredEventIds.has(eventId)) return false;
      this.scoredEventIds.add(eventId);
      if (this.scoredEventIds.size > 400) {
        const first = this.scoredEventIds.values().next().value;
        if (first) this.scoredEventIds.delete(first);
      }
    }
    this.stats.totalScore += Math.max(0, Math.round(points));
    return true;
  }

  public recordCombo(comboHits: number): void {
    if (comboHits > this.stats.highestCombo) {
      this.stats.highestCombo = comboHits;
    }
  }

  public recordMultiHit(count: number): void {
    if (count > this.stats.maxMultiHit) {
      this.stats.maxMultiHit = count;
    }
    if (count >= 3) {
      this.stats.totalScore += count * 45;
    }
  }

  public recordChainCollision(eventId: string, chainDepth: number): boolean {
    if (!this.addScoreEvent(eventId, 75 * chainDepth)) return false;
    if (chainDepth > this.stats.longestChain) {
      this.stats.longestChain = chainDepth;
    }
    return true;
  }

  public recordObjectDestroyed(isTable = false): void {
    this.stats.objectsDestroyed += 1;
    this.stats.totalScore += isTable ? 90 : 45;
  }

  public recordTableThrown(): void {
    this.stats.tablesThrown += 1;
    this.stats.totalScore += 40;
  }

  public recordEnemyDefeated(isElite = false, isBoss = false): void {
    this.stats.enemiesDefeated += 1;
    this.stats.totalScore += isBoss ? 1500 : isElite ? 320 : 100;
  }

  public recordEnemySurrendered(): void {
    this.stats.enemiesSurrendered += 1;
    this.stats.totalScore += 120;
  }

  public recordBossAttackDodged(): void {
    this.stats.bossDodges += 1;
    this.stats.totalScore += 150;
  }

  private computeBestMoment(): void {
    if (this.stats.longestChain >= 3) {
      this.stats.bestMomentKr = `초대형 ${this.stats.longestChain}연쇄 도미노 충돌 달성!`;
    } else if (this.stats.highestCombo >= 25) {
      this.stats.bestMomentKr = `숨 쉴 틈 없는 ${this.stats.highestCombo} HIT 폭풍 콤보!`;
    } else if (this.stats.objectsDestroyed >= 8) {
      this.stats.bestMomentKr = `장터 기물 ${this.stats.objectsDestroyed}개 박살 — 진정한 난장판!`;
    } else if (this.stats.enemiesSurrendered >= 3) {
      this.stats.bestMomentKr = `산적 ${this.stats.enemiesSurrendered}명이 겁에 질려 백기 투항!`;
    } else {
      this.stats.bestMomentKr = '산적 두목을 완벽하게 제압한 장안성의 수호자!';
    }
  }
}
