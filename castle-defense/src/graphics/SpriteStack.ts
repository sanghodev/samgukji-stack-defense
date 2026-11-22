import Phaser from 'phaser';

export interface SpriteStackConfig {
  textureKey: string;
  layerCount?: number;
  /** Vertical pixel spacing between consecutive slices (before scale). Default: 2 */
  layerSpacing?: number;
  /** Alias for layerSpacing. */
  sliceStep?: number;
  /** Uniform sprite scale. Default: 2 */
  scale?: number;
  /** Initial rotation in radians. Default: 0 */
  rotation?: number;
  /** Ground shadow ellipse dimensions (world pixels). Set 0 to disable. */
  shadowRadiusX?: number;
  shadowRadiusY?: number;
  shadowAlpha?: number;
  /** Optional base tint applied to all layers (0xffffff = none). */
  baseTint?: number;
  /** Subtle vertical shading (darker at bottom, brighter at top). Default: true */
  ambientOcclusion?: boolean;
}

/**
 * 2.5D Voxel Sprite-Stacking renderer for Phaser 3.
 * Stacks horizontal slice frames vertically along screen-Y with `layerSpacing`
 * while rotating every slice synchronously for smooth 360-degree 3D rotation,
 * ground shadow, Y-sorting, hit flash, and movement squash/bounce.
 */
export class SpriteStack extends Phaser.GameObjects.Container {
  public readonly textureKey: string;
  public readonly layerCount: number;

  private readonly slices: Phaser.GameObjects.Image[] = [];
  private readonly shadow?: Phaser.GameObjects.Ellipse;

  private layerSpacing: number;
  private stackScale: number;
  private stackRotation: number;
  private verticalOffset = 0;
  private squashX = 1;
  private squashY = 1;
  private baseTint: number;
  private readonly ambientOcclusion: boolean;

  private flashTimer?: Phaser.Time.TimerEvent;
  private isFlashing = false;
  private visibleLayers: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: SpriteStackConfig,
  ) {
    super(scene, x, y);

    this.textureKey = config.textureKey;
    this.layerSpacing = config.layerSpacing ?? config.sliceStep ?? 2;
    this.stackScale = config.scale ?? 2;
    this.stackRotation = config.rotation ?? 0;
    this.baseTint = config.baseTint ?? 0xffffff;
    this.ambientOcclusion = config.ambientOcclusion ?? true;

    const texture = scene.textures.get(this.textureKey);
    const totalFrames = Math.max(1, texture.frameTotal - 1); // exclude __BASE
    this.layerCount = config.layerCount ?? totalFrames;
    this.visibleLayers = this.layerCount;

    // Ground circular/elliptical shadow
    const sRx = config.shadowRadiusX ?? 16;
    const sRy = config.shadowRadiusY ?? 10;
    if (sRx > 0 && sRy > 0) {
      this.shadow = scene.add.ellipse(
        0,
        3,
        sRx * 2,
        sRy * 2,
        0x090b10,
        config.shadowAlpha ?? 0.34,
      );
      this.add(this.shadow);
    }

    // Stack horizontal slice frames from bottom (0) to top (layerCount - 1)
    for (let i = 0; i < this.layerCount; i++) {
      const img = scene.add.image(0, 0, this.textureKey, i);
      img.setOrigin(0.5, 0.5);
      img.setScale(this.stackScale);
      img.setRotation(this.stackRotation);
      this.slices.push(img);
      this.add(img);
    }

    this.layoutSlices();
    this.applyShading();

    scene.add.existing(this);
    this.syncDepth();
  }

  /** Rotate all stacked slices synchronously in radians (360-degree rotation). */
  public setStackRotation(radians: number): this {
    this.stackRotation = radians;
    for (let i = 0; i < this.slices.length; i++) {
      this.slices[i].rotation = radians;
    }
    return this;
  }

  /** Smoothly interpolate stack rotation toward target radians. */
  public lerpStackRotation(targetRadians: number, factor: number): this {
    const diff = Phaser.Math.Angle.Wrap(targetRadians - this.stackRotation);
    return this.setStackRotation(this.stackRotation + diff * factor);
  }

  public getStackRotation(): number {
    return this.stackRotation;
  }

  /** Adjust uniform scale and slice spacing. */
  public setStackScale(scale: number): this {
    this.stackScale = scale;
    this.layoutSlices();
    return this;
  }

  /**
   * Apply a lively squash-and-bounce motion while moving.
   * Pass `intensity = 0` to smoothly return to resting pose.
   */
  public setMoveBounce(phase: number, intensity = 1): this {
    if (intensity <= 0.001) {
      this.squashX = Phaser.Math.Linear(this.squashX, 1, 0.25);
      this.squashY = Phaser.Math.Linear(this.squashY, 1, 0.25);
      this.verticalOffset = Phaser.Math.Linear(this.verticalOffset, 0, 0.25);
    } else {
      const hop = Math.abs(Math.sin(phase));
      const squashWave = Math.cos(phase * 2); // +1 at ground contact, -1 at apex
      this.verticalOffset = -hop * 5.2 * intensity;
      this.squashX = 1 + squashWave * 0.065 * intensity;
      this.squashY = 1 - squashWave * 0.055 * intensity;
    }

    this.layoutSlices();
    this.updateShadowScale();
    return this;
  }

  /**
   * Shift all slices vertically (negative = upward hop/bob)
   * without moving the ground shadow.
   */
  public setVerticalOffset(offsetY: number): this {
    this.verticalOffset = offsetY;
    this.squashX = 1;
    this.squashY = 1;
    this.layoutSlices();
    this.updateShadowScale();
    return this;
  }

  /** Control how many bottom-up layers are visible (for damaged/collapsed structures). */
  public setVisibleLayerRatio(ratio: number): this {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    this.visibleLayers = Math.max(0, Math.round(this.layerCount * clamped));
    for (let i = 0; i < this.slices.length; i++) {
      this.slices[i].setVisible(i < this.visibleLayers);
    }
    return this;
  }

  /** Change base tint (e.g. elite enemies or damaged state). */
  public setBaseTint(tint: number): this {
    this.baseTint = tint;
    if (!this.isFlashing) {
      this.applyShading();
    }
    return this;
  }

  /** Flash all layers white for 0.08s (80ms) on hit, then restore shading. */
  public flashHit(durationMs = 80, flashColor = 0xffffff): void {
    this.isFlashing = true;
    for (let i = 0; i < this.slices.length; i++) {
      this.slices[i].setTintFill(flashColor);
    }

    if (this.flashTimer) {
      this.flashTimer.remove(false);
    }

    this.flashTimer = this.scene.time.delayedCall(durationMs, () => {
      this.isFlashing = false;
      if (this.active) {
        this.applyShading();
      }
    });
  }

  /** Total screen height of the rendered stack. */
  public getStackHeight(): number {
    return this.layerCount * this.layerSpacing * this.stackScale;
  }

  /** Automatic Y-Sorting using setDepth(this.y). */
  public syncDepth(offset = 0): this {
    this.setDepth(this.y + offset);
    return this;
  }

  public override setPosition(
    x?: number,
    y?: number,
    z?: number,
    w?: number,
  ): this {
    super.setPosition(x, y, z, w);
    this.setDepth(this.y);
    return this;
  }

  private layoutSlices(): void {
    const step = this.layerSpacing * this.stackScale * this.squashY;
    const sx = this.stackScale * this.squashX;
    const sy = this.stackScale * this.squashY;

    for (let i = 0; i < this.slices.length; i++) {
      const slice = this.slices[i];
      slice.y = -i * step + this.verticalOffset;
      slice.setScale(sx, sy);
    }
  }

  private updateShadowScale(): void {
    if (!this.shadow) return;
    const lift = Math.max(0, -this.verticalOffset);
    const shrink = Phaser.Math.Clamp(1 - lift * 0.018, 0.65, 1);
    this.shadow.setScale(shrink * this.squashX, shrink);
  }

  private applyShading(): void {
    const baseR = (this.baseTint >> 16) & 0xff;
    const baseG = (this.baseTint >> 8) & 0xff;
    const baseB = this.baseTint & 0xff;

    for (let i = 0; i < this.slices.length; i++) {
      const slice = this.slices[i];
      slice.clearTint();

      if (!this.ambientOcclusion && this.baseTint === 0xffffff) {
        continue;
      }

      const t = this.layerCount > 1 ? i / (this.layerCount - 1) : 1;
      const ao = this.ambientOcclusion ? 0.8 + 0.2 * t : 1;
      const r = Math.min(255, Math.round(baseR * ao));
      const g = Math.min(255, Math.round(baseG * ao));
      const b = Math.min(255, Math.round(baseB * ao));
      slice.setTint((r << 16) | (g << 8) | b);
    }
  }

  public override destroy(fromScene?: boolean): void {
    if (this.flashTimer) {
      this.flashTimer.remove(false);
      this.flashTimer = undefined;
    }
    super.destroy(fromScene);
  }
}
