export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * Fixed-camera 2.5D marketplace arena geometry.
 * The playable floor is a wide trapezoid: narrower in the rear (distance)
 * and wider in the front (closer to the viewer).
 */
export const ARENA_BOUNDS = {
  /** Rear playable floor boundary (right in front of the market storefronts) */
  backY: 282,
  /** Front playable floor boundary (closest to the viewer) */
  frontY: 682,
  /** Left/right X boundaries at the rear edge (backY) */
  backLeftX: 168,
  backRightX: 1112,
  /** Left/right X boundaries at the front edge (frontY) */
  frontLeftX: 48,
  frontRightX: 1232,
  /** Horizon vanishing point used for perspective tile & curb lines */
  vanishingX: 640,
  vanishingY: 110,
} as const;

/**
 * Perspective scaling and movement feel tuned for a classic 16-bit
 * three-quarter beat-'em-up camera.
 */
export const PERSPECTIVE_CONFIG = {
  /** Character scale at the rear of the arena (backY) */
  minScale: 0.68,
  /** Character scale at the front of the arena (frontY) */
  maxScale: 1.14,
  /** Horizontal speed multiplier at back vs front for natural 2.5D depth feel */
  minSpeedFactor: 0.78,
  maxSpeedFactor: 1.06,
  /** Foreshortening ratio for depth (up/down) movement relative to horizontal */
  verticalMoveRatio: 0.72,
} as const;

export const DEPTH_LAYERS = {
  SKY: 0,
  MOUNTAINS: 5,
  FORTRESS: 10,
  BUILDINGS: 20,
  FLOOR: 30,
  FLOOR_DECALS: 40,
  /** Base depth added to entity/prop Y coordinate for automatic 2.5D depth sorting */
  ENTITY_BASE: 100,
  OVERHEAD_LANTERNS: 900,
  AMBIENT_PARTICLES: 920,
  HUD: 1000,
  DEBUG: 1100,
} as const;

export const PLAYER_CONFIG = {
  spawnX: 640,
  spawnY: 500,
  baseMoveSpeed: 290,
  accelRate: 2400,
  decelRate: 2600,
  collisionRadius: 20,
} as const;
