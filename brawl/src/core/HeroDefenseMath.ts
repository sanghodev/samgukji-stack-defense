import type { HeroId } from '../config/heroConfig.ts';
import type { EnvObjectKind } from '../config/mayhemConfig.ts';

export type HeroBodyState =
  | 'NORMAL'
  | 'GUARDING'
  | 'AIRBORNE_LAUNCH'
  | 'KNOCKDOWN'
  | 'RECOVER'
  | 'DIZZY';

export interface HeroHitOptions {
  heavy?: boolean;
  causesDizzy?: boolean;
  knockdownForce?: number;
  launchVz?: number;
  dizzyDurationMs?: number;
}

export interface HeroHitResolution {
  outcome: 'IGNORED' | 'GUARDED' | 'STAGGER' | 'KNOCKDOWN' | 'DIZZY';
  finalDamage: number;
  knockbackSpeed: number;
  launchVz: number;
  dizzyMs: number;
  resetComboCounter: boolean;
}

export interface HeroIncomingHitParams {
  baseDamage: number;
  isGuarding: boolean;
  isInvulnerable: boolean;
  isSuperArmored: boolean;
  isDefeated: boolean;
  consecutiveHits: number;
  opts?: HeroHitOptions;
}

/**
 * Pure deterministic damage, guard, knockdown, and dizzy resolution for playable heroes.
 * - Guarding cuts damage by 75%, negates knockdown & dizzy, and preserves player combo.
 * - Heavy boss/elite hits or 3 consecutive unguarded hits launch the hero into KNOCKDOWN.
 * - Boss Ground Slams, Rushes, and heavy stun hits inflict DIZZY (어질어질!) after landing.
 */
export function resolveHeroIncomingHit(params: HeroIncomingHitParams): HeroHitResolution {
  const {
    baseDamage,
    isGuarding,
    isInvulnerable,
    isSuperArmored,
    isDefeated,
    consecutiveHits,
    opts,
  } = params;

  if (isDefeated || isInvulnerable || isSuperArmored) {
    return {
      outcome: 'IGNORED',
      finalDamage: 0,
      knockbackSpeed: 0,
      launchVz: 0,
      dizzyMs: 0,
      resetComboCounter: false,
    };
  }

  const rawDmg = Math.max(1, Math.round(baseDamage));

  if (isGuarding) {
    return {
      outcome: 'GUARDED',
      finalDamage: Math.max(1, Math.round(rawDmg * 0.25)),
      knockbackSpeed: opts?.heavy ? 135 : 70,
      launchVz: 0,
      dizzyMs: 0,
      resetComboCounter: false,
    };
  }

  if (opts?.causesDizzy) {
    return {
      outcome: 'DIZZY',
      finalDamage: rawDmg,
      knockbackSpeed: opts.knockdownForce ?? 315,
      launchVz: opts.launchVz ?? 245,
      dizzyMs: opts.dizzyDurationMs ?? 2100,
      resetComboCounter: true,
    };
  }

  if (opts?.heavy || consecutiveHits >= 3) {
    return {
      outcome: 'KNOCKDOWN',
      finalDamage: rawDmg,
      knockbackSpeed: opts?.knockdownForce ?? 285,
      launchVz: opts?.launchVz ?? 235,
      dizzyMs: 0,
      resetComboCounter: true,
    };
  }

  return {
    outcome: 'STAGGER',
    finalDamage: rawDmg,
    knockbackSpeed: 185,
    launchVz: 0,
    dizzyMs: 0,
    resetComboCounter: true,
  };
}

/**
 * Maps acquired treasure/skill count to escalating visual aura tiers (0..3).
 */
export function getPowerUpVisualTier(treasureCount: number): 0 | 1 | 2 | 3 {
  if (treasureCount >= 5) return 3;
  if (treasureCount >= 3) return 2;
  if (treasureCount >= 1) return 1;
  return 0;
}

/**
 * Returns the 16-bit broken_wreckage frame indices to spawn for a destroyed prop kind.
 */
export function getWreckageFramesForKind(
  kind: EnvObjectKind,
  rng = Math.random,
): Array<{ frame: number; scale: number }> {
  switch (kind) {
    case 'table':
      return [
        { frame: 0, scale: 0.48 }, // Broken table top snapped in half
        { frame: 1, scale: 0.42 }, // Broken legs & wood planks pile
        { frame: 7, scale: 0.28 }, // Cracked porcelain bowl!
      ];
    case 'barrel_water':
    case 'barrel_empty':
      return [{ frame: 2, scale: 0.43 }]; // Smashed barrel staves & iron hoop
    case 'ceramic_jar':
      return [
        { frame: 3, scale: 0.40 }, // Cracked spilling wine jar
        { frame: 4, scale: 0.34 }, // Scattered ceramic shards
      ];
    case 'fruit_basket':
      return [
        { frame: rng() < 0.5 ? 5 : 6, scale: 0.39 }, // Overturned apple basket OR dumpling steamer!
      ];
  }
}

export function getHeroSpecialPoseFrames(heroId: HeroId): {
  carryFrame: number;
  koFrame: number;
} {
  switch (heroId) {
    case 'zhaoyun':
      return { carryFrame: 0, koFrame: 4 };
    case 'guanyu':
      return { carryFrame: 1, koFrame: 5 };
    case 'zhangfei':
      return { carryFrame: 2, koFrame: 6 };
    case 'huangzhong':
      return { carryFrame: 3, koFrame: 7 };
  }
}
