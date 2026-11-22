export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * Fixed-camera deep 2.5D marketplace avenue geometry.
 * Strong perspective trapezoid stretching from a wide foreground plaza
 * all the way back to the distant fortress gate (성문).
 */
export const ARENA_BOUNDS = {
  /** Far rear playable edge directly in front of the distant castle gate */
  backY: 228,
  /** Front playable edge closest to the viewer */
  frontY: 692,
  /** Narrower X boundaries at the far rear (backY) for strong spatial depth */
  backLeftX: 356,
  backRightX: 924,
  /** Wide X boundaries at the foreground (frontY) */
  frontLeftX: 28,
  frontRightX: 1252,
  /** One-point perspective vanishing point above the distant castle gate */
  vanishingX: 640,
  vanishingY: 118,
} as const;

/**
 * Strong 2.5D perspective scaling so moving toward the distant castle gate
 * creates an unmistakable sense of deep space.
 */
export const PERSPECTIVE_CONFIG = {
  /** Character scale at the far rear near the castle gate (backY) */
  minScale: 0.46,
  /** Character scale at the foreground closest to the viewer (frontY) */
  maxScale: 1.22,
  /** Screen-space movement speed multiplier at back vs front */
  minSpeedFactor: 0.56,
  maxSpeedFactor: 1.12,
  /** Foreshortening ratio for depth (up/down) movement relative to horizontal */
  verticalMoveRatio: 0.68,
} as const;

export const DEPTH_LAYERS = {
  SKY: 0,
  MOUNTAINS: 5,
  FORTRESS: 10,
  FORTRESS_HAZE: 15,
  SIDE_BUILDINGS_BACK: 22,
  FLOOR: 30,
  FLOOR_DECALS: 40,
  SIDE_BUILDINGS_FRONT: 45,
  /** Base depth added to entity/prop Y coordinate for automatic 2.5D depth sorting */
  ENTITY_BASE: 100,
  OVERHEAD_LANTERNS: 900,
  AMBIENT_PARTICLES: 920,
  HUD: 1000,
  DEBUG: 1100,
} as const;

export const PLAYER_CONFIG = {
  spawnX: 640,
  spawnY: 515,
  baseMoveSpeed: 300,
  accelRate: 2500,
  decelRate: 2700,
  collisionRadius: 20,
} as const;
