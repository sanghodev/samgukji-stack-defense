import Phaser from 'phaser';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface MoveInputState {
  /** Normalized horizontal axis in [-1, 1] */
  x: number;
  /** Normalized vertical axis in [-1, 1] */
  y: number;
  /** True if any directional key is held */
  isMoving: boolean;
  /** True on the frame the Basic Attack key (Z) was pressed */
  lightAttackPressed: boolean;
  /** True on the frame the Heavy Attack key (X) was pressed */
  heavyAttackPressed: boolean;
  /** True on the frame Interact / Pick up / Throw (SPACE) was pressed */
  interactPressed: boolean;
  /** True on the frame Special Ability (V) was pressed */
  specialPressed: boolean;
  /** True on the frame Switch Hero (TAB) was pressed */
  switchHeroPressed: boolean;
  /** True on the frame the Combat Debug Panel toggle key (F2) was pressed */
  toggleCombatPanelPressed: boolean;
  /** True on the frame the HUD Debug overlay toggle key (F3) was pressed */
  toggleDebugPressed: boolean;
  /** True on the frame Restart (R) was pressed */
  restartPressed: boolean;
}

/**
 * Handles smooth 8-direction movement (WASD + Arrows) and responsive combat/mayhem/special inputs
 * (Z, X, V, SPACE, TAB, F2, F3, R).
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
    z: Phaser.Input.Keyboard.Key;
    x: Phaser.Input.Keyboard.Key;
    v: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    tab: Phaser.Input.Keyboard.Key;
    r: Phaser.Input.Keyboard.Key;
    f2: Phaser.Input.Keyboard.Key;
    f3: Phaser.Input.Keyboard.Key;
  };

  public init(ctx: SystemContext): void {
    const kb = ctx.scene.input.keyboard;
    if (!kb) return;

    kb.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
    kb.addCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      z: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      x: kb.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      v: kb.addKey(Phaser.Input.Keyboard.KeyCodes.V),
      space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      tab: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
      r: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      f2: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F2),
      f3: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F3),
    };
  }

  public sample(): MoveInputState {
    if (!this.keys) {
      return {
        x: 0,
        y: 0,
        isMoving: false,
        lightAttackPressed: false,
        heavyAttackPressed: false,
        interactPressed: false,
        specialPressed: false,
        switchHeroPressed: false,
        toggleCombatPanelPressed: false,
        toggleDebugPressed: false,
        restartPressed: false,
      };
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
      lightAttackPressed: Phaser.Input.Keyboard.JustDown(this.keys.z),
      heavyAttackPressed: Phaser.Input.Keyboard.JustDown(this.keys.x),
      interactPressed: Phaser.Input.Keyboard.JustDown(this.keys.space),
      specialPressed: Phaser.Input.Keyboard.JustDown(this.keys.v),
      switchHeroPressed: Phaser.Input.Keyboard.JustDown(this.keys.tab),
      toggleCombatPanelPressed: Phaser.Input.Keyboard.JustDown(this.keys.f2),
      toggleDebugPressed: Phaser.Input.Keyboard.JustDown(this.keys.f3),
      restartPressed: Phaser.Input.Keyboard.JustDown(this.keys.r),
    };
  }

  public destroy(): void {
    this.keys = undefined;
  }
}
