import Phaser from 'phaser';
import {
  DEPTH_LAYERS,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config/arenaConfig';
import { Point2D } from '../core/Perspective';

export type PropKind = 'stall_fruit' | 'stall_weapons' | 'crate_stack' | 'wine_jars' | 'stone_lantern';

export interface ArenaProp {
  readonly id: string;
  readonly kind: PropKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly destructible: boolean;
  readonly container: Phaser.GameObjects.Container;
}

interface BrazierGlow {
  outer: Phaser.GameObjects.Ellipse;
  inner: Phaser.GameObjects.Ellipse;
  baseX: number;
  baseY: number;
  phase: number;
}

/**
 * Fixed-camera 16-bit pixel-art ancient Chinese fortress courtyard arena
 * matching the signature vibrant comic art style:
 * - High-craft 1280x720 pixel art backdrop (cherry blossom tree, dragon flags,
 *   burning fortress wall, arched wooden gate, market tents, reflective muddy puddles)
 * - Animated flickering fire braziers flanking the gate
 * - Drifting pink cherry blossom petals & warm floating embers
 * - Non-blocking corner collision volumes aligned to perimeter crates & wagon
 */
export class MarketplaceArena {
  public readonly props: ArenaProp[] = [];

  private readonly scene: Phaser.Scene;
  private bgImage?: Phaser.GameObjects.Image;
  private readonly braziers: BrazierGlow[] = [];
  private petalEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private emberEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private elapsed = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.buildPixelArtBackground();
    this.buildPerimeterColliders();
    this.buildAnimatedBraziers();
    this.buildAmbientParticles();
  }

  private buildPixelArtBackground(): void {
    this.bgImage = this.scene.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'mayhem_arena_bg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(DEPTH_LAYERS.SKY);
  }

  /**
   * Invisible subtle corner collision bumpers matching the painted crates/wagon
   * at the extreme edges of the pixel-art courtyard so heroes never clip into
   * corner crates while keeping 92%+ of the courtyard wide open for combat!
   */
  private buildPerimeterColliders(): void {
    const bumpers: Array<{ id: string; kind: PropKind; x: number; y: number; r: number }> = [
      { id: 'bg_tent_left', kind: 'stall_fruit', x: 255, y: 232, r: 58 },
      { id: 'bg_crate_left_mid', kind: 'crate_stack', x: 54, y: 362, r: 52 },
      { id: 'bg_crate_bot_left', kind: 'crate_stack', x: 112, y: 676, r: 82 },
      { id: 'bg_wagon_right', kind: 'stall_weapons', x: 1218, y: 268, r: 64 },
      { id: 'bg_crate_bot_right', kind: 'crate_stack', x: 1185, y: 682, r: 76 },
    ];

    for (const b of bumpers) {
      const dummy = this.scene.add.container(b.x, b.y).setDepth(DEPTH_LAYERS.FLOOR);
      this.props.push({
        id: b.id,
        kind: b.kind,
        x: b.x,
        y: b.y,
        radius: b.r,
        destructible: false,
        container: dummy,
      });
    }
  }

  private buildAnimatedBraziers(): void {
    // Positions matching the two lit fire braziers flanking the fortress gate in mayhem_arena_bg.png
    const spots = [
      { x: 816, y: 152, phase: 0.0 },
      { x: 1072, y: 152, phase: 1.7 },
    ];

    for (const s of spots) {
      const outer = this.scene.add
        .ellipse(s.x, s.y, 44, 34, 0xf97316, 0.28)
        .setDepth(DEPTH_LAYERS.FLOOR_DECALS)
        .setBlendMode(Phaser.BlendModes.ADD);
      const inner = this.scene.add
        .ellipse(s.x, s.y - 2, 22, 18, 0xfef08a, 0.45)
        .setDepth(DEPTH_LAYERS.FLOOR_DECALS + 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.braziers.push({ outer, inner, baseX: s.x, baseY: s.y, phase: s.phase });
    }
  }

  private buildAmbientParticles(): void {
    // Lush pink cherry blossom petals drifting from the left sakura tree across the battlefield
    this.petalEmitter = this.scene.add.particles(0, 0, 'petal_particle', {
      x: { min: -20, max: 460 },
      y: { min: 10, max: 190 },
      lifespan: { min: 5200, max: 8200 },
      speedX: { min: 28, max: 68 },
      speedY: { min: 22, max: 52 },
      scale: { start: 1.05, end: 0.55 },
      alpha: { start: 0.92, end: 0.1 },
      rotate: { min: 0, max: 360 },
      frequency: 260,
      quantity: 1,
    });
    this.petalEmitter.setDepth(DEPTH_LAYERS.AMBIENT_PARTICLES);

    // Subtle rising fire embers behind the burning fortress wall
    this.emberEmitter = this.scene.add.particles(0, 0, 'spark_particle', {
      x: { min: 640, max: 1140 },
      y: { min: 45, max: 115 },
      lifespan: { min: 1400, max: 2400 },
      speedX: { min: 12, max: 36 },
      speedY: { min: -42, max: -16 },
      scale: { start: 1.1, end: 0.2 },
      alpha: { start: 0.75, end: 0 },
      tint: [0xf97316, 0xfacc15, 0xef4444],
      frequency: 240,
      quantity: 1,
    });
    this.emberEmitter.setDepth(DEPTH_LAYERS.FORTRESS_HAZE);
  }

  public update(deltaMs: number): void {
    this.elapsed += deltaMs * 0.001;

    for (const b of this.braziers) {
      const flicker = Math.sin(this.elapsed * 14 + b.phase) * 0.16 + Math.cos(this.elapsed * 23 + b.phase) * 0.08;
      b.outer.setScale(1 + flicker, 1 + flicker * 1.2);
      b.outer.setAlpha(0.26 + flicker * 0.4);
      b.inner.setScale(1 - flicker * 0.5, 1 + flicker * 0.9);
      b.inner.setY(b.baseY - 2 + flicker * 4);
    }
  }

  public resolvePropCollisions(x: number, y: number, entityRadius: number): Point2D {
    let rx = x;
    let ry = y;

    for (const prop of this.props) {
      const dx = rx - prop.x;
      const dy = (ry - prop.y) * 1.35;
      const minDist = entityRadius + prop.radius;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = minDist - dist;
        rx += (dx / dist) * push;
        ry += (dy / dist) * (push / 1.35);
      }
    }

    return { x: rx, y: ry };
  }

  public destroy(): void {
    this.bgImage?.destroy();
    this.petalEmitter?.destroy();
    this.emberEmitter?.destroy();
    for (const b of this.braziers) {
      b.outer.destroy();
      b.inner.destroy();
    }
    this.braziers.length = 0;
    for (const prop of this.props) {
      prop.container.destroy(true);
    }
    this.props.length = 0;
  }
}
