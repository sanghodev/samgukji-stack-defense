export interface MeleeHitboxQuery {
  originX: number;
  originY: number;
  /** Normalized 2D attack direction */
  dirX: number;
  dirY: number;
  /** Logical forward reach along attack direction */
  range: number;
  /** Logical half-width perpendicular to attack direction */
  halfWidth: number;
  /** Y-axis foreshortening ratio (matches PERSPECTIVE_CONFIG.verticalMoveRatio) */
  verticalRatio: number;
  /** Optional minimum backward reach (small grace behind origin) */
  backGrace?: number;
}

export interface MeleeTargetHurtbox {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Height above ground; targets too high in the air can be ignored if needed */
  elevationZ: number;
  vulnerable: boolean;
}

export interface MeleeHitResult {
  hit: boolean;
  forwardDist: number;
  lateralDist: number;
}

/**
 * True 2.5D ground-space melee collision check.
 * Converts world-space (dx, dy) into isotropically scaled ground space by
 * compensating for the three-quarter camera's vertical foreshortening, then
 * tests projection along the attack's forward and lateral axes.
 *
 * This guarantees:
 * - Attacks work identically in all 8 directions (including toward/away from viewer).
 * - Targets on different depth lanes are only hit when genuinely within reach.
 */
export function check25DMeleeHit(
  query: MeleeHitboxQuery,
  target: MeleeTargetHurtbox,
): MeleeHitResult {
  if (!target.vulnerable) {
    return { hit: false, forwardDist: 0, lateralDist: 0 };
  }

  // Compensate for 2.5D vertical foreshortening so depth-axis reach matches horizontal reach
  const invY = query.verticalRatio > 0 ? 1 / query.verticalRatio : 1;
  const dx = target.x - query.originX;
  const dy = (target.y - query.originY) * invY;

  // Normalize attack direction in ground space
  const dirLen = Math.hypot(query.dirX, query.dirY) || 1;
  const fx = query.dirX / dirLen;
  const fy = query.dirY / dirLen;

  // Project onto forward and lateral axes
  const forwardDist = dx * fx + dy * fy;
  const lateralDist = Math.abs(-dx * fy + dy * fx);

  const minForward = -(query.backGrace ?? 10) - target.radius * 0.5;
  const maxForward = query.range + target.radius;
  const maxLateral = query.halfWidth + target.radius;

  const hit =
    forwardDist >= minForward &&
    forwardDist <= maxForward &&
    lateralDist <= maxLateral;

  return { hit, forwardDist, lateralDist };
}

/**
 * Prevents the same enemy from being struck multiple times by a single attack swing.
 */
export class CombatHitTracker {
  private attackId = 0;
  private readonly hitIds = new Set<string>();

  public beginAttack(): number {
    this.attackId += 1;
    this.hitIds.clear();
    return this.attackId;
  }

  public canHit(targetId: string): boolean {
    return !this.hitIds.has(targetId);
  }

  public recordHit(targetId: string): boolean {
    if (this.hitIds.has(targetId)) {
      return false;
    }
    this.hitIds.add(targetId);
    return true;
  }

  public get currentAttackId(): number {
    return this.attackId;
  }

  public clear(): void {
    this.hitIds.clear();
  }
}

export interface AirborneBodyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  elevationZ: number;
  vz: number;
}

export interface AirborneStepResult {
  landed: boolean;
  impactSpeed: number;
}

/**
 * Frame-rate-independent 2.5D knockback + gravity physics step.
 * Keeps ground (x, y) strictly separated from temporary airborne height (elevationZ).
 */
export function stepAirbornePhysics(
  body: AirborneBodyState,
  dtSec: number,
  gravity: number,
  groundFriction: number,
  airDrag: number,
): AirborneStepResult {
  const dt = Math.max(0, Math.min(dtSec, 0.05));
  const wasAirborne = body.elevationZ > 0 || body.vz > 0;

  // Integrate ground velocity
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  // Apply damping (less drag while flying through the air, stronger friction on the ground)
  const drag = wasAirborne ? airDrag : groundFriction;
  const damp = Math.exp(-drag * dt);
  body.vx *= damp;
  body.vy *= damp;
  if (Math.abs(body.vx) < 2) body.vx = 0;
  if (Math.abs(body.vy) < 2) body.vy = 0;

  let landed = false;
  let impactSpeed = 0;

  if (wasAirborne) {
    body.vz -= gravity * dt;
    body.elevationZ += body.vz * dt;

    if (body.elevationZ <= 0) {
      impactSpeed = Math.abs(body.vz);
      body.elevationZ = 0;
      body.vz = 0;
      // Bleed off some horizontal slide upon slamming into the ground
      body.vx *= 0.45;
      body.vy *= 0.45;
      landed = true;
    }
  }

  return { landed, impactSpeed };
}
