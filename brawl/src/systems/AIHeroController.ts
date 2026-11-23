import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { Step5Tuning } from '../config/heroConfig';
import { Bandit } from '../entities/Bandit';
import type { BanditChief } from '../entities/BanditChief';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { Warrior } from '../entities/Warrior';
import { createEmptyHeroInput, HeroActionInput } from './MultiInputManager';

export interface AiHeroMemory {
  targetBanditId: string | null;
  targetObjectId: string | null;
  goalX: number;
  goalY: number;
  decisionCooldownMs: number;
  actionCooldownMs: number;
  pickupCooldownMs: number;
  guardHoldMs: number;
}

interface AiCombatTarget {
  id: string;
  x: number;
  y: number;
  isBoss: boolean;
}

/**
 * Role-differentiated AI companion controller for all 4 Three Kingdoms heroes.
 * Outputs the exact same HeroActionInput as human players (zero cheats, identical hitboxes/cooldowns)
 * while respecting Player Priority, active object lifting/throwing, smart Boss guarding,
 * and configurable PASSIVE / BALANCED / AGGRESSIVE modes.
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
    boss: BanditChief | null = null,
  ): HeroActionInput {
    const out = createEmptyHeroInput();
    if (this.tuning.aiDisabled || hero.isDefeated) {
      return out;
    }

    let mem = this.memories.get(hero.heroId);
    if (!mem) {
      mem = {
        targetBanditId: null,
        targetObjectId: null,
        goalX: hero.x,
        goalY: hero.y,
        decisionCooldownMs: 0,
        actionCooldownMs: 350,
        pickupCooldownMs: 1200 + Math.random() * 1400,
        guardHoldMs: 0,
      };
      this.memories.set(hero.heroId, mem);
    }

    mem.decisionCooldownMs = Math.max(0, mem.decisionCooldownMs - deltaMs);
    mem.actionCooldownMs = Math.max(0, mem.actionCooldownMs - deltaMs);
    mem.pickupCooldownMs = Math.max(0, mem.pickupCooldownMs - deltaMs);
    mem.guardHoldMs = Math.max(0, mem.guardHoldMs - deltaMs);

    // If dizzy or knocked down: fire Skill 3 Emergency Escape Ultimate if ready (especially at low HP!), else mash out!
    if (hero.bodyState === 'DIZZY' || hero.bodyState === 'KNOCKDOWN') {
      if (hero.skill3ReadyRatio >= 1 && (hero.isLowHpEmergency || hero.bodyState === 'DIZZY')) {
        out.skill3Pressed = true;
        mem.actionCooldownMs = 600;
        return out;
      }
      if (mem.actionCooldownMs <= 0) {
        out.lightAttackPressed = true;
        mem.actionCooldownMs = 340;
      }
      return out;
    }

    const activeBandits = bandits.filter(
      (b) => !b.isNeutralized && b.state !== 'CAMERA_GAGGED',
    );
    const bossAlive = Boolean(boss && boss.isAlive);

    if (activeBandits.length === 0 && !bossAlive) {
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

    // Smart Defensive Guard against telegraphed Boss Slams/Clubs/Rushes or bandit swarm swings!
    if (!hero.isCarrying && !hero.isAttacking && !hero.isCharging) {
      const imminentDanger = this.isImminentHeavyThreat(hero, activeBandits, boss);
      if (imminentDanger) {
        mem.guardHoldMs = Math.max(mem.guardHoldMs, 380);
      }
      if (mem.guardHoldMs > 0) {
        out.guardHeld = true;
        return out;
      }
    }

    // Aggression pacing multipliers (keeps human player as the star!)
    const paceMul =
      this.tuning.aiAggression === 'PASSIVE'
        ? 1.7
        : this.tuning.aiAggression === 'AGGRESSIVE'
          ? 0.72
          : 1.05;

    // Pick role-appropriate target (including Boss Chief!)
    let target: AiCombatTarget | undefined;
    if (activeBandits.length > 0) {
      let banditTarget = activeBandits.find((b) => b.id === mem.targetBanditId);
      if (!banditTarget || mem.decisionCooldownMs <= 0) {
        banditTarget = this.selectTargetForRole(hero, activeBandits, allHeroes);
        mem.targetBanditId = banditTarget ? banditTarget.id : null;
        mem.decisionCooldownMs = 320 + Math.random() * 220;
      }
      if (banditTarget) {
        target = { id: banditTarget.id, x: banditTarget.x, y: banditTarget.y, isBoss: false };
      }
    }
    if (bossAlive && boss) {
      const distBoss = Math.hypot(
        boss.x - hero.x,
        (boss.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (!target || distBoss < 240 || hero.isCarrying) {
        target = { id: boss.id, x: boss.x, y: boss.y, isBoss: true };
      }
    }
    if (!target) return out;

    const dx = target.x - hero.x;
    const dy = (target.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
    const dist = Math.hypot(dx, dy) || 0.001;
    const dirX = dx / dist;
    const dirY = dy / dist;

    // Count nearby enemies around hero & around target for crowd-control / special decisions
    let nearbyHeroCount = 0;
    let clusterAroundTarget = target.isBoss ? 2 : 0;
    for (const b of activeBandits) {
      const dh = Math.hypot(b.x - hero.x, (b.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      if (dh < 145) nearbyHeroCount += 1;
      const dtTarget = Math.hypot(b.x - target.x, (b.y - target.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      if (dtTarget < 120) clusterAroundTarget += 1;
    }

    // 0A. Emergency Escape Skill 3 Ultimate when critically low HP or heavily surrounded!
    if (
      hero.skill3ReadyRatio >= 1 &&
      !hero.isCarrying &&
      ((hero.isLowHpEmergency && (nearbyHeroCount >= 1 || bossAlive)) || nearbyHeroCount >= 6) &&
      mem.actionCooldownMs <= 0
    ) {
      hero.setFacingToward(dirX, dirY);
      out.skill3Pressed = true;
      mem.actionCooldownMs = 1100 * paceMul;
      return out;
    }

    // 0B. Elemental Skill 2 Art when facing a dense cluster or Boss!
    if (
      hero.skill2ReadyRatio >= 1 &&
      !hero.isCarrying &&
      !hero.isAttacking &&
      !hero.isCharging &&
      this.tuning.aiAggression !== 'PASSIVE' &&
      (nearbyHeroCount >= 3 || clusterAroundTarget >= 3 || (target.isBoss && dist < 240)) &&
      mem.actionCooldownMs <= 0
    ) {
      hero.setFacingToward(dirX, dirY);
      out.skill2Pressed = true;
      mem.actionCooldownMs = 980 * paceMul;
      return out;
    }

    // 1. If AI is already carrying a lifted table/jar/basket, stride into throw range & hurl it!
    if (hero.isCarrying) {
      mem.targetObjectId = null;
      hero.setFacingToward(dirX, dirY);
      if (dist > 280) {
        out.x = dirX;
        out.y = dirY;
        out.isMoving = true;
      } else if (mem.actionCooldownMs <= 0) {
        out.interactPressed = true;
        mem.actionCooldownMs = 580 * paceMul;
        mem.pickupCooldownMs =
          hero.heroId === 'zhangfei' ? 3200 : hero.heroId === 'huangzhong' ? 6800 : 4800;
      }
      mem.goalX = target.x;
      mem.goalY = target.y;
      return out;
    }

    // 2. Active AI Object Seeking & Pickup (All heroes can grab tables/jars/baskets with Player Priority!)
    if (
      mem.pickupCooldownMs <= 0 &&
      !hero.isAttacking &&
      !hero.isCharging &&
      this.tuning.aiAggression !== 'PASSIVE'
    ) {
      let targetObj = mem.targetObjectId
        ? envObjects.find((o) => o.id === mem.targetObjectId && o.canBePickedUp)
        : undefined;

      if (!targetObj) {
        targetObj = this.findSafePickupObjectForAi(hero, envObjects, allHeroes, bossAlive);
        mem.targetObjectId = targetObj ? targetObj.id : null;
      }

      if (targetObj) {
        // Double-check a human player didn't just walk right up to it
        const humanClaimed = allHeroes.some(
          (h) =>
            h.isHumanControlled &&
            !h.isDefeated &&
            Math.hypot(targetObj.x - h.x, (targetObj.y - h.y) / PERSPECTIVE_CONFIG.verticalMoveRatio) < 92,
        );
        if (humanClaimed) {
          mem.targetObjectId = null;
        } else {
          const odx = targetObj.x - hero.x;
          const ody = (targetObj.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
          const odist = Math.hypot(odx, ody) || 0.001;
          mem.goalX = targetObj.x;
          mem.goalY = targetObj.y;

          if (odist <= 64 + targetObj.radius) {
            hero.setFacingToward(odx / odist, ody / odist);
            out.interactPressed = true;
            mem.actionCooldownMs = 260;
            mem.targetObjectId = null;
            return out;
          } else if (odist < 260) {
            out.x = odx / odist;
            out.y = ody / odist;
            out.isMoving = true;
            return out;
          } else {
            mem.targetObjectId = null;
          }
        }
      }
    }

    // 3. Role-specific combat behavior
    switch (hero.profile.role) {
      case 'ranged': {
        // HUANG ZHONG: Maintain safe kiting range (170..300) & fire arrows / Thousand Arrow Burst
        const idealMin = 170;
        const idealMax = 300;
        if (dist < idealMin) {
          out.x = -dirX;
          out.y = -dirY;
          out.isMoving = true;
        } else if (dist > idealMax) {
          out.x = dirX;
          out.y = dirY;
          out.isMoving = true;
        } else {
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
        // ZHANG FEI: Line up dense clusters for Bulldozer Charge, or smash with heavy swings!
        const meleeReach = target.isBoss ? 102 : 82;
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
        const meleeReach = target.isBoss ? 116 : 104;
        if (
          hero.specialReadyRatio >= 1 &&
          (nearbyHeroCount >= 3 || (target.isBoss && dist < 140)) &&
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
            if ((nearbyHeroCount >= 2 || target.isBoss) && Math.random() < 0.4) {
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
        const meleeReach = target.isBoss ? 98 : 82;
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

  private isImminentHeavyThreat(
    hero: Warrior,
    bandits: Bandit[],
    boss: BanditChief | null,
  ): boolean {
    if (boss && boss.isAlive) {
      const d = Math.hypot(
        boss.x - hero.x,
        (boss.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (boss.state === 'SLAM_WINDUP' && d < 195) return true;
      if ((boss.state === 'CLUB_WINDUP' || boss.state === 'RUSH_WINDUP') && d < 145) return true;
    }

    let nearbyWindingBandits = 0;
    for (const b of bandits) {
      if (b.state !== 'ATTACK_WINDUP') continue;
      const d = Math.hypot(b.x - hero.x, (b.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio);
      if (d < 92) {
        if (b.archetype === 'elite') return true;
        nearbyWindingBandits += 1;
      }
    }
    return nearbyWindingBandits >= 2;
  }

  private findSafePickupObjectForAi(
    hero: Warrior,
    envObjects: EnvironmentalObject[],
    allHeroes: Warrior[],
    bossAlive: boolean,
  ): EnvironmentalObject | undefined {
    // Zhang Fei loves grabbing tables most; Zhao Yun & Guan Yu also grab nearby tables/jars/baskets!
    const maxSeekDist =
      hero.heroId === 'zhangfei' ? 235 : hero.heroId === 'huangzhong' ? 120 : 185;

    // Limit simultaneous AI carriers to at most 2 so combat stays lively and varied
    const currentAiCarriers = allHeroes.filter((h) => !h.isHumanControlled && h.isCarrying).length;
    if (currentAiCarriers >= 2) return undefined;

    let best: EnvironmentalObject | undefined;
    let bestScore = -Infinity;

    for (const obj of envObjects) {
      if (!obj.canBePickedUp) continue;
      // Don't compete with another AI targeting this exact object
      let otherAiClaimed = false;
      for (const [hid, m] of this.memories.entries()) {
        if (hid !== hero.heroId && m.targetObjectId === obj.id) {
          otherAiClaimed = true;
          break;
        }
      }
      if (otherAiClaimed) continue;

      const dSelf = Math.hypot(
        obj.x - hero.x,
        (obj.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (dSelf > maxSeekDist) continue;

      // Player Priority: never snatch a prop right next to a human player!
      const humanNear = allHeroes.some(
        (h) =>
          h.isHumanControlled &&
          !h.isDefeated &&
          Math.hypot(obj.x - h.x, (obj.y - h.y) / PERSPECTIVE_CONFIG.verticalMoveRatio) < 105,
      );
      if (humanNear) continue;

      let score = -dSelf;
      if (obj.spec.kind === 'table') score += bossAlive ? 95 : 55;
      else if (obj.spec.kind === 'ceramic_jar') score += 25;
      else if (obj.spec.kind === 'fruit_basket') score += 20;

      if (score > bestScore) {
        bestScore = score;
        best = obj;
      }
    }

    return best;
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
        score += (1 - b.hp / Math.max(1, b.maxHp)) * 85;
      } else if (hero.profile.role === 'crowd_control' || hero.profile.role === 'initiator') {
        if (b.archetype === 'elite') score += 65;
        let neighbors = 0;
        for (const o of bandits) {
          if (o !== b && Math.hypot(o.x - b.x, o.y - b.y) < 110) neighbors += 1;
        }
        score += neighbors * 45;
      } else if (hero.profile.role === 'ranged') {
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
