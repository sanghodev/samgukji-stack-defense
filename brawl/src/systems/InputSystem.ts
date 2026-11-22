import Phaser from 'phaser';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface MoveInputState {
  /** Normalized horizontal axis in [-1, 1] */
  x: number;
  /** Normalized vertical axis in [-1, 1] */
  y: number;
  /** True if any directional key is held */
  isMoving: boolean;
  /** True on the frame the debug toggle key (F3) was pressed */
  toggleDebugPressed: boolean;
}

/**
 * Handles smooth 8-direction movement input via WASD and Arrow keys.
 */
export class InputSystem implements IGameSystem {
  public readonly id = 'input';

  private keys?: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    f3: Phaser.Input.Keyboard.Key;
  };

  public init(ctx: SystemContext): void {
    const kb = ctx.scene.input.keyboard;
    if (!kb) return;

    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      f3: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F3),
    };
  }

  public sample(): MoveInputState {
    if (!this.keys) {
      return { x: 0, y: 0, isMoving: false, toggleDebugPressed: false };
    }

    let rawX = 0;
    let rawY = 0;

    if (this.keys.a.isDown || this.keys.left.isDown) rawX -= 1;
    if (this.keys.d.isDown || this.keys.right.isDown) rawX += 1;
    if (this.keys.w.isDown || this.keys.up.isDown) rawY -= 1;
    if (this.keys.s.isDown || this.keys.down.isDown) rawY += 1;

    const len = Math.hypot(rawX, rawY);
    const x = len > 0 ? rawX / len : 0;
    const y = len > 0 ? rawY / len : 0;

    return {
      x,
      y,
      isMoving: len > 0,
      toggleDebugPressed: Phaser.Input.Keyboard.JustDown(this.keys.f3),
    };
  }

  public destroy(): void {
    this.keys = undefined;
  }
}
