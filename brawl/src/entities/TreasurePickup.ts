import Phaser from 'phaser';
import { getDepthOrder, getPerspectiveScale } from '../core/Perspective';

export class TreasurePickup {
  public readonly id: string;
  public readonly x: number;
  public readonly y: number;
  public readonly labelKr: string;
  public collected = false;

  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private bobPhase = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    x: number,
    y: number,
    labelKr = '보물 상자!',
  ) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.labelKr = labelKr;

    const shadow = scene.add.ellipse(0, 4, 36, 12, 0x1c120c, 0.42);
    this.ring = scene.add.graphics();
    this.ring.lineStyle(2.5, 0xfacc15, 0.85);
    this.ring.strokeEllipse(0, 4, 46, 18);

    this.sprite = scene.textures.exists('mayhem_props')
      ? scene.add.image(0, -24, 'mayhem_props', 6).setOrigin(0.5).setScale(0.60)
      : scene.add.image(0, -18, 'treasure_chest_icon').setOrigin(0.5);
    this.label = scene.add
      .text(0, -44, `✨ ${labelKr}`, {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#1c120c',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.container = scene.add.container(x, y, [shadow, this.ring, this.sprite, this.label]);
    this.syncVisuals();
  }

  public update(deltaMs: number): void {
    if (this.collected) return;
    this.bobPhase += deltaMs * 0.006;
    const dy = Math.sin(this.bobPhase) * 5;
    this.sprite.setY(-18 + dy);
    this.label.setY(-48 + dy * 0.6);
    this.ring.setAlpha(0.55 + Math.sin(this.bobPhase * 1.5) * 0.35);
    this.syncVisuals();
  }

  public isHeroInRange(hx: number, hy: number): boolean {
    if (this.collected) return false;
    const dx = hx - this.x;
    const dy = (hy - this.y) * 1.45;
    return Math.hypot(dx, dy) <= 56;
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y) + 8);
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
