import Phaser from 'phaser';
import { DEPTH_LAYERS } from '../config/arenaConfig';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface DebugReadout {
  fps: number;
  x: number;
  y: number;
  depthRatio: number;
  scale: number;
  facing: string;
  speed: number;
}

/**
 * Compact, readable debug HUD showing FPS and the player's 2.5D world state.
 */
export class DebugOverlay implements IGameSystem {
  public readonly id = 'debug-overlay';

  private container?: Phaser.GameObjects.Container;
  private text?: Phaser.GameObjects.Text;
  private visible = true;

  public init(ctx: SystemContext): void {
    const { scene } = ctx;

    const bg = scene.add.graphics();
    bg.fillStyle(0x0b101b, 0.78);
    bg.fillRoundedRect(0, 0, 232, 92, 6);
    bg.lineStyle(1, 0xfbbf24, 0.55);
    bg.strokeRoundedRect(0, 0, 232, 92, 6);

    this.text = scene.add.text(10, 8, '', {
      fontFamily: 'Consolas, Menlo, monospace',
      fontSize: '12px',
      color: '#e2e8f0',
      lineSpacing: 4,
    });

    this.container = scene.add.container(14, 14, [bg, this.text]);
    this.container.setDepth(DEPTH_LAYERS.DEBUG);
    this.container.setScrollFactor(0);
  }

  public toggle(): boolean {
    this.visible = !this.visible;
    this.container?.setVisible(this.visible);
    return this.visible;
  }

  public render(info: DebugReadout): void {
    if (!this.visible || !this.text) return;

    this.text.setText([
      `FPS   : ${Math.round(info.fps).toString().padStart(3, ' ')}   DIR: ${info.facing}`,
      `WORLD : (${info.x.toFixed(1)}, ${info.y.toFixed(1)})`,
      `DEPTH : ${(info.depthRatio * 100).toFixed(0)}%   SCALE: ${info.scale.toFixed(2)}x`,
      `SPEED : ${Math.round(info.speed)} px/s  [F3 Hide]`,
    ]);
  }

  public destroy(): void {
    this.container?.destroy(true);
    this.container = undefined;
    this.text = undefined;
  }
}
