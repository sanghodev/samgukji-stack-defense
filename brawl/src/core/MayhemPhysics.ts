export type ChainReactionTier = 'NONE' | 'STAGGER' | 'PUSHED' | 'KNOCKDOWN' | 'LAUNCHED';

export interface SweptHitResult {
  hit: boolean;
  /** Closest normalized t along segment [0, 1] */
  t: number;
  /** Normalized impact direction in ground space from A -> B */
  nx: number;
  ny: number;
}

/**
 * Swept 2.5D circle-vs-circle collision test.
 * Prevents fast-moving thrown tables, rolling barrels, or flying bandits from
 * tunneling through targets while strictly respecting 2.5D depth lanes.
 */
export function sweptCircleHit25D(
  prevX: number,
  prevY: number,
  currX: number,
  currY: number,
  radiusA: number,
  targetX: number,
  targetY: number,
  radiusB: number,
  verticalRatio: number,
): SweptHitResult {
  const invY = verticalRatio > 0 ? 1 / verticalRatio : 1;

  // Transform into isotropic ground space
  const ax0 = prevX;
  const ay0 = prevY * invY;
  const ax1 = currX;
  const ay1 = currY * invY;
  const bx = targetX;
  const by = targetY * invY;

  const segX = ax1 - ax0;
  const segY = ay1 - ay0;
  const segLenSq = segX * segX + segY * segY;

  let t = 0;
  if (segLenSq > 0.0001) {
    t = ((bx - ax0) * segX + (by - ay0) * segY) / segLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const closestX = ax0 + segX * t;
  const closestY = ay0 + segY * t;
  const dx = bx - closestX;
  const dy = by - closestY;
  const combinedR = radiusA + radiusB;
  const distSq = dx * dx + dy * dy;

  if (distSq > combinedR * combinedR) {
    return { hit: false, t, nx: 0, ny: 0 };
  }

  const dist = Math.sqrt(distSq);
  if (dist > 0.001) {
    return { hit: true, t, nx: dx / dist, ny: dy / dist };
  }

  // Fallback to travel direction if centers overlap identically
  const moveLen = Math.sqrt(segLenSq) || 1;
  return { hit: true, t, nx: segX / moveLen, ny: segY / moveLen };
}

export interface ChainImpulseResult {
  triggered: boolean;
  tier: ChainReactionTier;
  /** Resulting velocity transferred to target B */
  targetVx: number;
  targetVy: number;
  targetLaunchVz: number;
  /** Remaining velocity on source A after transferring momentum */
  sourceVx: number;
  sourceVy: number;
  /** Damage inflicted on target B by the collision */
  damage: number;
  nextChainDepth: number;
}

/**
 * Deterministic arcade domino knockback transfer for enemy-to-enemy collisions.
 * Enforces maxChainDepth and energy thresholds to prevent infinite loops.
 */
export function computeChainImpulse(
  sourceVx: number,
  sourceVy: number,
  sourceMass: number,
  targetMass: number,
  impactNx: number,
  impactNy: number,
  transferCoeff: number,
  currentChainDepth: number,
  maxChainDepth: number,
  energyThreshold: number,
  verticalRatio: number,
): ChainImpulseResult {
  const noOp: ChainImpulseResult = {
    triggered: false,
    tier: 'NONE',
    targetVx: 0,
    targetVy: 0,
    targetLaunchVz: 0,
    sourceVx,
    sourceVy,
    damage: 0,
    nextChainDepth: currentChainDepth,
  };

  if (currentChainDepth >= maxChainDepth) {
    return noOp;
  }

  // Convert source velocity into isotropic ground speed
  const invY = verticalRatio > 0 ? 1 / verticalRatio : 1;
  const gVx = sourceVx;
  const gVy = sourceVy * invY;
  const speed = Math.hypot(gVx, gVy);
  const energy = speed * Math.max(0.5, sourceMass);

  if (energy < energyThreshold) {
    return noOp;
  }

  const massRatio = Math.min(1.6, Math.max(0.5, sourceMass / Math.max(0.5, targetMass)));
  const transferredSpeed = Math.min(620, speed * transferCoeff * massRatio);

  // Blend travel direction with collision normal for crisp bowling-pin deflection
  const travelNx = gVx / (speed || 1);
  const travelNy = gVy / (speed || 1);
  const blendX = travelNx * 0.55 + impactNx * 0.45;
  const blendY = travelNy * 0.55 + impactNy * 0.45;
  const bLen = Math.hypot(blendX, blendY) || 1;
  const dirX = blendX / bLen;
  const dirY = blendY / bLen;

  let tier: ChainReactionTier = 'STAGGER';
  let launchVz = 0;
  let damage = 6;

  if (transferredSpeed >= 330) {
    tier = 'LAUNCHED';
    launchVz = 230;
    damage = 16;
  } else if (transferredSpeed >= 220) {
    tier = 'KNOCKDOWN';
    launchVz = 145;
    damage = 12;
  } else if (transferredSpeed >= 145) {
    tier = 'PUSHED';
    launchVz = 0;
    damage = 8;
  }

  // Source loses kinetic energy upon impact
  const retain = Math.max(0.22, 1 - transferCoeff * 0.65);

  return {
    triggered: true,
    tier,
    targetVx: dirX * transferredSpeed,
    targetVy: dirY * transferredSpeed * verticalRatio,
    targetLaunchVz: launchVz,
    sourceVx: sourceVx * retain,
    sourceVy: sourceVy * retain,
    damage,
    nextChainDepth: currentChainDepth + 1,
  };
}

/**
 * Speed-coupled surface hazard slip evaluator.
 * Standing or walking very slowly never triggers unfair slips;
 * running fast across a puddle or banana peel reliably triggers a comedic slip.
 */
export function evaluateSlipTrigger(
  moveSpeed: number,
  baseSlipProbability: number,
  dtSec: number,
  roll01: number,
): boolean {
  if (moveSpeed < 65 || baseSlipProbability <= 0) {
    return false;
  }
  const speedFactor = Math.min(1.35, (moveSpeed - 55) / 110);
  // Convert per-second probability into frame-rate-independent step probability
  const rate = Math.min(0.98, baseSlipProbability * speedFactor);
  const stepChance = 1 - Math.pow(1 - rate, Math.min(0.1, dtSec) * 4.5);
  return roll01 < stepChance;
}
