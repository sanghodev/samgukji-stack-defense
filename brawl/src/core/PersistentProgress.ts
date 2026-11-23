export type PermanentAbilityCategory = 'fire' | 'water' | 'lightning' | 'healing';

export interface PermanentAbilityUnlock {
  readonly id: string;
  readonly category: PermanentAbilityCategory;
  readonly nameKr: string;
  readonly descKr: string;
  readonly bonusDamagePct: number; // Kept tiny (< 5%) so stage balance stays intact
}

export const PERMANENT_ABILITY_CATALOG: readonly PermanentAbilityUnlock[] = [
  {
    id: 'fire_ember',
    category: 'fire',
    nameKr: '불씨의 증표 (프로토타입)',
    descKr: '제1장 첫 클리어 해금 — 필살기 타격 시 미세한 화염 보너스 (+4%)',
    bonusDamagePct: 0.04,
  },
  {
    id: 'water_flow',
    category: 'water',
    nameKr: '유수의 기운 (준비 중)',
    descKr: '향후 업데이트 예정 영구 능력 슬롯',
    bonusDamagePct: 0,
  },
  {
    id: 'lightning_spark',
    category: 'lightning',
    nameKr: '벽력의 섬광 (준비 중)',
    descKr: '향후 업데이트 예정 영구 능력 슬롯',
    bonusDamagePct: 0,
  },
  {
    id: 'healing_breath',
    category: 'healing',
    nameKr: '회복의 숨결 (준비 중)',
    descKr: '향후 업데이트 예정 영구 능력 슬롯',
    bonusDamagePct: 0,
  },
];

export interface PersistentSaveData {
  version: 1;
  bestScore: number;
  fastestClearMs: number | null;
  totalClears: number;
  unlockedPermanentAbilities: string[];
}

const STORAGE_KEY = 'tkm_stage1_progress_v1';

export function createDefaultSaveData(): PersistentSaveData {
  return {
    version: 1,
    bestScore: 0,
    fastestClearMs: null,
    totalClears: 0,
    unlockedPermanentAbilities: [],
  };
}

/**
 * Safe versioned browser storage wrapper for best records & rare permanent unlocks.
 * Never throws on unavailable/corrupted localStorage.
 * Strictly separated from per-run temporary treasures.
 */
export class PersistentProgressStore {
  private data: PersistentSaveData;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(customStorage?: Pick<Storage, 'getItem' | 'setItem'> | null) {
    if (customStorage !== undefined) {
      this.storage = customStorage;
    } else {
      try {
        this.storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
      } catch {
        this.storage = null;
      }
    }
    this.data = this.load();
  }

  public get snapshot(): Readonly<PersistentSaveData> {
    return this.data;
  }

  public hasPermanentAbility(id: string): boolean {
    return this.data.unlockedPermanentAbilities.includes(id);
  }

  public getPermanentDamageBonus(): number {
    let bonus = 0;
    for (const id of this.data.unlockedPermanentAbilities) {
      const def = PERMANENT_ABILITY_CATALOG.find((a) => a.id === id);
      if (def) bonus += def.bonusDamagePct;
    }
    return Math.min(0.08, bonus);
  }

  public recordStage1Victory(score: number, clearTimeMs: number): {
    isNewBestScore: boolean;
    newlyUnlockedId: string | null;
  } {
    const isNewBestScore = score > this.data.bestScore;
    if (isNewBestScore) {
      this.data.bestScore = Math.round(score);
    }
    if (this.data.fastestClearMs === null || clearTimeMs < this.data.fastestClearMs) {
      this.data.fastestClearMs = Math.round(clearTimeMs);
    }
    this.data.totalClears += 1;

    let newlyUnlockedId: string | null = null;
    if (!this.data.unlockedPermanentAbilities.includes('fire_ember')) {
      this.data.unlockedPermanentAbilities.push('fire_ember');
      newlyUnlockedId = 'fire_ember';
    }

    this.save();
    return { isNewBestScore, newlyUnlockedId };
  }

  private load(): PersistentSaveData {
    if (!this.storage) return createDefaultSaveData();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultSaveData();
      const parsed = JSON.parse(raw) as Partial<PersistentSaveData>;
      if (parsed.version !== 1) return createDefaultSaveData();
      return {
        version: 1,
        bestScore: typeof parsed.bestScore === 'number' && Number.isFinite(parsed.bestScore) ? Math.max(0, parsed.bestScore) : 0,
        fastestClearMs:
          typeof parsed.fastestClearMs === 'number' && Number.isFinite(parsed.fastestClearMs) && parsed.fastestClearMs > 0
            ? parsed.fastestClearMs
            : null,
        totalClears: typeof parsed.totalClears === 'number' && Number.isFinite(parsed.totalClears) ? Math.max(0, parsed.totalClears) : 0,
        unlockedPermanentAbilities: Array.isArray(parsed.unlockedPermanentAbilities)
          ? parsed.unlockedPermanentAbilities.filter((x): x is string => typeof x === 'string')
          : [],
      };
    } catch {
      return createDefaultSaveData();
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore quota / privacy mode errors gracefully
    }
  }
}
