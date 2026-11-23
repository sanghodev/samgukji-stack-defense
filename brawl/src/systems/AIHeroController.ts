import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { Step5Tuning } from '../config/heroConfig';
import { Bandit } from '../entities/Bandit';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { Warrior } from '../entities/Warrior';
import { createEmptyHeroInput, HeroActionInput } from './MultiInputManager';

export interface AiHeroMemory {
  targetBanditId: string | null;
  goalX: number;
  goalY: number;
  decisionCooldownMs: number;
  actionCooldownMs: number;
}

/**
 * Role-differentiated AI companion controller for all 4 Three Kingdoms heroes.
 * Outputs the exact same HeroActionInput as human players (zero cheats, identical hitboxes/cooldowns)
 * while respecting Player Priority and configurable PASSIVE / BALANCED / AGGRESSIVE modes.
 */
export class AIHeroController {
  private readonly memories = new Map<string, AiHeroMemory>();
  private readonly tuning: Step5Tuning;

  constructor(tuning: Step5Tuning) {
    this.tuning = tuning;
  }

  public getMemory(heroId: string): AiHeroMemory | undefined {
    return this.memories.get(heroId);
  }

  public computeInput(
    hero: Warrior,
    deltaMs: number,
    allHeroes: Warrior[],
    bandits: Bandit[],
    envObjects: EnvironmentalObject[],
  ): HeroActionInput {
    const out = createEmptyHeroInput();
    if (this.tuning.aiDisabled || hero.isDefeated) {
      return out;
    }

    let mem = this.memories.get(hero.heroId);
    if (!mem) {
      mem = {
        targetBanditId: null,
        goalX: hero.x,
        goalY: hero.y,
        decisionCooldownMs: 0,
        actionCooldownMs: 350,
      };
      this.memories.set(hero.heroId, mem);
    }

    mem.decisionCooldownMs = Math.max(0, mem.decisionCooldownMs - deltaMs);
    mem.actionCooldownMs = Math.max(0, mem.actionCooldownMs - deltaMs);

    const activeBandits = bandits.filter(
      (b) => !b.isNeutralized && b.state !== 'CAMERA_GAGGED',
    );
    if (activeBandits.length === 0) {
      // Gently stay near human leader in formation when no active threats remain
      const leader = allHeroes.find((h) => h.isHumanControlled && !h.isDefeated);
      if (leader && leader !== hero) {
        const dx = leader.x + (hero.slotIndex - 1.5) * 65 - hero.x;
        const dy = leader.y - hero.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 45) {
          out.x = dx / dist;
          out.y = dy / dist;
          out.isMoving = true;
        }
      }
      return out;
    }

    // Aggression pacing multipliers (keeps human player as the star!)
    const paceMul =
      this.tuning.aiAggression === 'PASSIVE'
        ? 1.7
        : this.tuning.aiAggression === 'AGGRESSIVE'
          ? 0.72
          : 1.05;

    // Pick role-appropriate target periodically (avoids thrashing every frame)
    let target = activeBandits.find((b) => b.id === mem.targetBanditId);
    if (!target || mem.decisionCooldownMs <= 0) {
      target = this.selectTargetForRole(hero, activeBandits, allHeroes);
      mem.targetBanditId = target ? target.id : null;
      mem.decisionCooldownMs = 320 + Math.random() * 220;
    }
    if (!target) return out;

    const dx = target.x - hero.x;
    const dy = (target.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
    const dist = Math.hypot(dx, dy) || 0.001;
    const dirX = dx / dist;
    const dirY = dy / dist;

    // Count nearby enemies around hero & around target for crowd-control / special decisions
    let nearbyHeroCount = 0;
    let clusterAroundTarget = 0;
    for (const b of activeBandits) {
      const dh = Math.hypot(b.x - hero.x, (b.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      if (dh < 145) nearbyHeroCount += 1;
      const dt = Math.hypot(b.x - target.x, (b.y - target.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      if (dt < 120) clusterAroundTarget += 1;
    }

    // If carrying an object (e.g. Zhang Fei grabbed a table), face target and throw!
    if (hero.isCarrying) {
      out.x = dirX;
      out.y = dirY;
      out.isMoving = true;
      if (dist < 320 && mem.actionCooldownMs <= 0) {
        out.interactPressed = true;
        mem.actionCooldownMs = 600 * paceMul;
      }
      return out;
    }

    // Role-specific combat behavior
    switch (hero.profile.role) {
      case 'ranged': {
        // HUANG ZHONG: Maintain safe kiting range (185..310) & fire arrows / Thousand Arrow Burst
        const idealMin = 170;
        const idealMax = 300;
        if (dist < idealMin) {
          // Backpedal away while staying inside arena
          out.x = -dirX;
          out.y = -dirY;
          out.isMoving = true;
        } else if (dist > idealMax) {
          out.x = dirX;
          out.y = dirY;
          out.isMoving = true;
        } else {
          // Aim toward target and loose arrows!
          hero.setFacingToward(dirX, dirY);
          if (mem.actionCooldownMs <= 0) {
            if (hero.specialReadyRatio >= 1 && clusterAroundTarget >= 2 && this.tuning.aiAggression !== 'PASSIVE') {
              out.specialPressed = true;
              mem.actionCooldownMs = 950 * paceMul;
            } else if (Math.random() < 0.25) {
              out.heavyAttackPressed = true;
              mem.actionCooldownMs = 680 * paceMul;
            } else {
              out.lightAttackPressed = true;
              mem.actionCooldownMs = 460 * paceMul;
            }
          }
        }
        mem.goalX = hero.x + out.x * 80;
        mem.goalY = hero.y + out.y * 55;
        break;
      }

      case 'initiator': {
        // ZHANG FEI: Line up dense clusters for Bulldozer Charge, or smash with heavy swings / tables!
        const meleeReach = 82;
        if (
          hero.specialReadyRatio >= 1 &&
          clusterAroundTarget >= 2 &&
          dist >= 115 &&
          dist <= 340 &&
          mem.actionCooldownMs <= 0 &&
          this.tuning.aiAggression !== 'PASSIVE'
        ) {
          hero.setFacingToward(dirX, dirY);
          out.specialPressed = true;
          mem.actionCooldownMs = 1100 * paceMul;
          break;
        }

        // Occasionally pick up a nearby table ONLY if no human player is close to it (Player Priority!)
        if (mem.actionCooldownMs <= 0 && Math.random() < 0.03) {
          const table = envObjects.find((o) => {
            if (o.spec.kind !== 'table' || !o.canBePickedUp) return false;
            const dSelf = Math.hypot(o.x - hero.x, o.y - hero.y);
            if (dSelf > 64) return false;
            const humanNear = allHeroes.some(
              (h) => h.isHumanControlled && Math.hypot(o.x - h.x, o.y - h.y) < 120,
            );
            return !humanNear;
          });
          if (table) {
            out.interactPressed = true;
            mem.actionCooldownMs = 350;
            break;
          }
        }

        if (dist > meleeReach) {
          out.x = dirX;
          out.y = dirY;
          out.isMoving = true;
        } else {
          hero.setFacingToward(dirX, dirY);
          if (mem.actionCooldownMs <= 0) {
            if (Math.random() < 0.38) {
              out.heavyAttackPressed = true;
              mem.actionCooldownMs = 740 * paceMul;
            } else {
              out.lightAttackPressed = true;
              mem.actionCooldownMs = 380 * paceMul;
            }
          }
        }
        mem.goalX = target.x;
        mem.goalY = target.y;
        break;
      }

      case 'crowd_control': {
        // GUAN YU: Sweeping guandao arcs & Azure Dragon Cyclone when surrounded!
        const meleeReach = 104;
        if (
          hero.specialReadyRatio >= 1 &&
          nearbyHeroCount >= 3 &&
          mem.actionCooldownMs <= 0 &&
          this.tuning.aiAggression !== 'PASSIVE'
        ) {
          out.specialPressed = true;
          mem.actionCooldownMs = 1100 * paceMul;
          break;
        }

        if (dist > meleeReach) {
          out.x = dirX;
          out.y = dirY;
          out.isMoving = true;
        } else {
          hero.setFacingToward(dirX, dirY);
          if (mem.actionCooldownMs <= 0) {
            if (nearbyHeroCount >= 2 && Math.random() < 0.4) {
              out.heavyAttackPressed = true;
              mem.actionCooldownMs = 680 * paceMul;
            } else {
              out.lightAttackPressed = true;
              mem.actionCooldownMs = 420 * paceMul;
            }
          }
        }
        mem.goalX = target.x;
        mem.goalY = target.y;
        break;
      }

      case 'striker':
      default: {
        // ZHAO YUN: Fast striker closing in on isolated/weakened enemies + White Dragon Rush!
        const meleeReach = 82;
        if (
          hero.specialReadyRatio >= 1 &&
          dist >= 95 &&
          dist <= 260 &&
          clusterAroundTarget >= 2 &&
          mem.actionCooldownMs <= 0 &&
          this.tuning.aiAggression !== 'PASSIVE'
        ) {
          hero.setFacingToward(dirX, dirY);
          out.specialPressed = true;
          mem.actionCooldownMs = 950 * paceMul;
          break;
        }

        if (dist > meleeReach) {
          out.x = dirX;
          out.y = dirY;
          out.isMoving = true;
        } else {
          hero.setFacingToward(dirX, dirY);
          if (mem.actionCooldownMs <= 0) {
            if (Math.random() < 0.22) {
              out.heavyAttackPressed = true;
              mem.actionCooldownMs = 620 * paceMul;
            } else {
              out.lightAttackPressed = true;
              mem.actionCooldownMs = 290 * paceMul;
            }
          }
        }
        mem.goalX = target.x;
        mem.goalY = target.y;
        break;
      }
    }

    return out;
  }

  private selectTargetForRole(
    hero: Warrior,
    bandits: Bandit[],
    allHeroes: Warrior[],
  ): Bandit | undefined {
    const humanHeroes = allHeroes.filter((h) => h.isHumanControlled && !h.isDefeated);
    let best: Bandit | undefined;
    let bestScore = -Infinity;

    for (const b of bandits) {
      const dHero = Math.hypot(b.x - hero.x, (b.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      let score = -dHero * 0.6;

      // Player Priority: slightly deprioritize bandits right in front of an attacking human!
      for (const h of humanHeroes) {
        const dHuman = Math.hypot(b.x - h.x, (b.y - h.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
        if (dHuman < 85 && h.isAttacking) {
          score -= 110;
        }
      }

      if (hero.profile.role === 'striker') {
        // Zhao Yun prefers weakened or isolated bandits
        score += (1 - b.hp / Math.max(1, b.maxHp)) * 85;
      } else if (hero.profile.role === 'crowd_control' || hero.profile.role === 'initiator') {
        // Guan Yu & Zhang Fei prefer dense clusters & elites
        if (b.archetype === 'elite') score += 65;
        let neighbors = 0;
        for (const o of bandits) {
          if (o !== b && Math.hypot(o.x - b.x, o.y - b.y) < 110) neighbors += 1;
        }
        score += neighbors * 45;
      } else if (hero.profile.role === 'ranged') {
        // Huang Zhong prefers mid-to-far threats and fleeing cowards
        if (b.state === 'FLEE') score += 70;
        if (dHero > 140 && dHero < 360) score += 60;
      }

      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }

    return best;
  }

  public clear(): void {
    this.memories.clear();
  }
}
