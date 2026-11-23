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
export type EnemySkillKind =
  | 'NONE'
  | 'WHIRLWIND'
  | 'GROUND_SLAM'
  | 'DASH_CLEAVE'
  | 'DAGGER_THROW'
  | 'ARROW_SHOT'
  | 'BOMB_THROW'
  | 'BEAR_HUG';

/**
 * Selects a signature enemy combat skill for higher-tier & specialist enemy archetypes
 * (Elite, Regular Soldier, Assassin, Archer, Bomber, Giant Grappler, Axe Raider).
 */
export function pickEnemySkillForArchetype(
  archetype: string,
  distToHero: number,
  rng = Math.random,
): EnemySkillKind {
  switch (archetype) {
    case 'elite':
      if (distToHero <= 165) {
        return rng() < 0.55 ? 'WHIRLWIND' : 'GROUND_SLAM';
      }
      return 'GROUND_SLAM';
    case 'stubborn':
    case 'soldier':
      if (distToHero >= 70 && distToHero <= 230) return 'DASH_CLEAVE';
      return 'NONE';
    case 'sneaky':
      if (distToHero >= 115 && distToHero <= 340) return 'DAGGER_THROW';
      return 'NONE';
    case 'archer':
      if (distToHero >= 110 && distToHero <= 430) return 'ARROW_SHOT';
      return 'NONE';
    case 'bomber':
      if (distToHero >= 105 && distToHero <= 370) return 'BOMB_THROW';
      return 'NONE';
    case 'grappler':
      if (distToHero <= 155) return 'BEAR_HUG';
      return 'NONE';
    case 'overconfident':
      if (distToHero <= 135 && rng() < 0.45) return 'GROUND_SLAM';
      return 'NONE';
    default:
      return 'NONE';
  }
}

export function getWreckageFramesForKind(
  kind: EnvObjectKind,
  rng = Math.random,
): Array<{ frame: number; scale: number; textureKey?: string }> {
  switch (kind) {
    case 'table':
      return [
        { frame: 0, scale: 0.94 }, // Broken table top snapped in half
        { frame: 1, scale: 0.82 }, // Broken legs & wood planks pile
        { frame: 7, scale: 0.48 }, // Cracked porcelain bowl!
      ];
    case 'barrel_water':
    case 'barrel_empty':
      return [{ frame: 2, scale: 0.72 }]; // Smashed barrel staves & iron hoop
    case 'ceramic_jar':
      return [
        { frame: 3, scale: 0.68 }, // Cracked spilling wine jar
        { frame: 4, scale: 0.56 }, // Scattered ceramic shards
      ];
    case 'fruit_basket':
      return [
        { frame: rng() < 0.5 ? 5 : 6, scale: 0.66 }, // Overturned apple basket OR dumpling steamer!
      ];
    case 'silk_bolts':
    case 'grain_sack':
    case 'bean_sack':
      return [
        { frame: 6, scale: 0.82, textureKey: 'market_goods' }, // Burst sack, beans, flour & torn crimson silk!
      ];
    case 'fish_tub':
    case 'meat_stall':
      return [
        { frame: 7, scale: 0.84, textureKey: 'market_goods' }, // Floppy fish, shattered planks & cartoon meat bone!
      ];
    case 'spice_stall':
      return [
        { frame: 6, scale: 0.78, textureKey: 'market_goods' },
        { frame: 1, scale: 0.62 },
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
