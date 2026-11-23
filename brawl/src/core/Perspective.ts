import Phaser from 'phaser';
import { ARENA_BOUNDS, DEPTH_LAYERS, PERSPECTIVE_CONFIG } from '../config/arenaConfig';

export interface HorizontalBounds {
  left: number;
  right: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Normalized depth ratio in [0, 1], where 0 is the far rear near the castle gate
 * and 1 is the front edge closest to the viewer.
 */
export function getDepthRatio(y: number): number {
  const span = ARENA_BOUNDS.frontY - ARENA_BOUNDS.backY;
  if (span <= 0) return 0.5;
  return Phaser.Math.Clamp((y - ARENA_BOUNDS.backY) / span, 0, 1);
}

/**
 * Perspective scale factor for sprites & shadows at a given world Y.
 * Uses a gentle perspective curve so distant shrinkage feels natural and deep.
 */
export function getPerspectiveScale(y: number): number {
  const t = getDepthRatio(y);
  return Phaser.Math.Linear(PERSPECTIVE_CONFIG.minScale, PERSPECTIVE_CONFIG.maxScale, t);
}

/**
 * Perspective speed factor so moving across the distant castle plaza covers
 * realistic 3D distance compared to the foreground.
 */
export function getDepthSpeedFactor(y: number): number {
  const t = getDepthRatio(y);
  return Phaser.Math.Linear(
    PERSPECTIVE_CONFIG.minSpeedFactor,
    PERSPECTIVE_CONFIG.maxSpeedFactor,
    t,
  );
}

/**
 * Left and right playable X limits at a given Y along the deep perspective trapezoid.
 */
export function getHorizontalBoundsAtY(y: number): HorizontalBounds {
  const t = getDepthRatio(y);
  return {
    left: Phaser.Math.Linear(ARENA_BOUNDS.backLeftX, ARENA_BOUNDS.frontLeftX, t),
    right: Phaser.Math.Linear(ARENA_BOUNDS.backRightX, ARENA_BOUNDS.frontRightX, t),
  };
}

/**
 * Clamps a world position (with footprint radius) strictly inside the playable trapezoid.
 */
export function clampToArena(x: number, y: number, radius: number): Point2D {
  const clampedY = Phaser.Math.Clamp(
    y,
    ARENA_BOUNDS.backY + radius * 0.4,
    ARENA_BOUNDS.frontY - radius * 0.4,
  );
  const scale = getPerspectiveScale(clampedY);
  const scaledRadius = radius * scale;
  const bounds = getHorizontalBoundsAtY(clampedY);

  const clampedX = Phaser.Math.Clamp(
    x,
    bounds.left + scaledRadius,
    bounds.right - scaledRadius,
  );

  return { x: clampedX, y: clampedY };
}

/**
 * Computes Phaser display depth from world Y so entities closer to the bottom
 * always render in front of entities further back.
 */
export function getDepthOrder(y: number): number {
  return DEPTH_LAYERS.ENTITY_BASE + y;
}
