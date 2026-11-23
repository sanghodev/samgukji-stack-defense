import Phaser from 'phaser';
import { DEPTH_LAYERS, PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { HazardKind } from '../config/mayhemConfig';
import { getPerspectiveScale } from '../core/Perspective';

/**
 * Reusable 2.5D slippery surface hazard (water puddle, spilled food, banana peel).
 * Drawn on the floor decal layer with 2.5D elliptical ground-space hit detection.
 */
export class SurfaceHazard {
  public readonly id: string;
  public readonly kind: HazardKind;
  public readonly x: number;
  public readonly y: number;
  public readonly radius: number;

  public remainingMs: number;
  public readonly maxDurationMs: number;
  public expired = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private ripplePhase = Math.random() * Math.PI * 2;

  constructor(
    scene: Phaser.Scene,
    id: string,
    kind: HazardKind,
    x: number,
    y: number,
    durationMs: number,
  ) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.radius = kind === 'water_puddle' ? 48 : kind === 'spilled_food' ? 38 : 22;
    this.remainingMs = durationMs;
    this.maxDurationMs = durationMs;

    this.gfx = scene.add.graphics();
    this.drawHazard(0);

    const scale = getPerspectiveScale(y);
    this.container = scene.add.container(x, y, [this.gfx]);
    this.container.setScale(scale);
    this.container.setDepth(DEPTH_LAYERS.FLOOR_DECALS + 4);
  }

  public containsPoint25D(px: number, py: number, actorRadius: number): boolean {
    if (this.expired) return false;
    const scale = getPerspectiveScale(this.y);
    const effR = this.radius * scale + actorRadius * 0.45;
    const dx = px - this.x;
    const dy = (py - this.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
    return dx * dx + dy * dy <= effR * effR;
  }

  public update(deltaMs: number): void {
    if (this.expired) return;
    this.remainingMs -= deltaMs;
    this.ripplePhase += deltaMs * 0.004;

    if (this.remainingMs <= 0) {
      this.expired = true;
      return;
    }

    if (this.kind === 'water_puddle') {
      this.drawHazard(Math.sin(this.ripplePhase));
    }

    // Smooth fade out during final 2 seconds
    if (this.remainingMs < 2000) {
      this.container.setAlpha(Math.max(0, this.remainingMs / 2000));
    }
  }

  private drawHazard(ripple: number): void {
    const g = this.gfx;
    g.clear();

    if (this.kind === 'water_puddle') {
      const rx = this.radius * 2;
      const ry = this.radius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * 0.82;
      // Soft wet mud rim matching courtyard pixel-art puddles
      g.fillStyle(0x452613, 0.34);
      g.fillEllipse(0, 1, rx * 1.12, ry * 1.14);
      g.fillEllipse(rx * 0.18, 2, rx * 0.56, ry * 0.62);
      // Sky-blue reflective water pool
      g.fillStyle(0x5b8bb5, 0.68);
      g.fillEllipse(0, 0, rx, ry);
      g.fillEllipse(rx * 0.17, 1, rx * 0.48, ry * 0.52);
      g.fillStyle(0x93c5fd, 0.58);
      g.fillEllipse(-4, -1, rx * 0.72, ry * 0.68);
      // Gentle animated water shimmer
      g.lineStyle(1.5, 0xe0f2fe, 0.55);
      g.strokeEllipse(
        ripple * 2.0,
        -1,
        rx * (0.44 + ripple * 0.03),
        ry * (0.38 + ripple * 0.03),
      );
      g.fillStyle(0xe0f2fe, 0.62);
      g.fillEllipse(-12, -5, 9, 3.5);
    } else if (this.kind === 'spilled_food') {
      // Colorful spilled peaches, juice puddle & yellow banana peels
      g.fillStyle(0xf97316, 0.42);
      g.fillEllipse(0, 0, 74, 42);
      g.fillStyle(0xfef08a, 0.75);
      g.fillEllipse(6, 4, 42, 22);
      // Decorative spilled fruit bits
      g.fillStyle(0xef4444, 1);
      g.fillCircle(-16, -4, 5);
      g.fillStyle(0xfacc15, 1);
      g.fillEllipse(12, -5, 12, 5);
      g.fillStyle(0x22c55e, 1);
      g.fillCircle(-4, 8, 4);
    } else {
      // Classic cartoon banana peel
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(0, 3, 28, 12);
      g.fillStyle(0xfacc15, 1);
      g.fillEllipse(-6, 0, 14, 7);
      g.fillEllipse(6, 1, 14, 7);
      g.fillTriangle(-4, 0, 4, 0, 0, -10);
      g.fillStyle(0x78350f, 1);
      g.fillRect(-2, -11, 4, 3);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
