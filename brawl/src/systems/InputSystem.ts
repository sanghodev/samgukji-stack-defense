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
  /** True on the frame Skill 1 (V or 1) was pressed */
  specialPressed: boolean;
  /** True on the frame Skill 2 Elemental Art (B or 2) was pressed */
  skill2Pressed: boolean;
  /** True on the frame Skill 3 Emergency Escape Ultimate (N or 3) was pressed */
  skill3Pressed: boolean;
  /** True while Guard (C or Shift) is held */
  guardHeld: boolean;
  /** True on the frame Switch Hero (TAB) was pressed */
  switchHeroPressed: boolean;
  /** True on the frame Party Setup (P) was pressed */
  partySetupPressed: boolean;
  /** True on the frame the Combat Debug Panel toggle key (F2) was pressed */
  toggleCombatPanelPressed: boolean;
  /** True on the frame the HUD Debug overlay toggle key (F3) was pressed */
  toggleDebugPressed: boolean;
  /** True on the frame Pause (ESC) was pressed */
  pausePressed: boolean;
  /** True on the frame Mute (M) was pressed */
  mutePressed: boolean;
  /** True on the frame Restart (R) was pressed */
  restartPressed: boolean;
}

/**
 * Handles smooth 8-direction movement (WASD + Arrows) and dual ergonomic arcade layouts:
 * - Layout A: Z (Attack), X (Heavy), C/Shift (Guard), V/1, B/2, N/3 (3 Skills), SPACE (Throw)
 * - Layout B: J (Attack), K (Heavy), L (Guard), U, I, O (3 Skills), E/F (Throw)
 * Plus Hold-to-Combo cadence when holding Z or J, ESC (Pause), M (Mute), TAB, P, R, F2, F3.
 */
export class InputSystem implements IGameSystem {
  public readonly id = 'input';

  private holdAttackMs = 0;

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
    c: Phaser.Input.Keyboard.Key;
    shift: Phaser.Input.Keyboard.Key;
    v: Phaser.Input.Keyboard.Key;
    b: Phaser.Input.Keyboard.Key;
    n: Phaser.Input.Keyboard.Key;
    j: Phaser.Input.Keyboard.Key;
    k: Phaser.Input.Keyboard.Key;
    l: Phaser.Input.Keyboard.Key;
    u: Phaser.Input.Keyboard.Key;
    i: Phaser.Input.Keyboard.Key;
    o: Phaser.Input.Keyboard.Key;
    e: Phaser.Input.Keyboard.Key;
    f: Phaser.Input.Keyboard.Key;
    one: Phaser.Input.Keyboard.Key;
    two: Phaser.Input.Keyboard.Key;
    three: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    tab: Phaser.Input.Keyboard.Key;
    p: Phaser.Input.Keyboard.Key;
    m: Phaser.Input.Keyboard.Key;
    esc: Phaser.Input.Keyboard.Key;
    r: Phaser.Input.Keyboard.Key;
    f2: Phaser.Input.Keyboard.Key;
    f3: Phaser.Input.Keyboard.Key;
  };

  public init(ctx: SystemContext): void {
    const kb = ctx.scene.input.keyboard;
    if (!kb) return;

    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.TAB,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);

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
      c: kb.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      v: kb.addKey(Phaser.Input.Keyboard.KeyCodes.V),
      b: kb.addKey(Phaser.Input.Keyboard.KeyCodes.B),
      n: kb.addKey(Phaser.Input.Keyboard.KeyCodes.N),
      j: kb.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      k: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      l: kb.addKey(Phaser.Input.Keyboard.KeyCodes.L),
      u: kb.addKey(Phaser.Input.Keyboard.KeyCodes.U),
      i: kb.addKey(Phaser.Input.Keyboard.KeyCodes.I),
      o: kb.addKey(Phaser.Input.Keyboard.KeyCodes.O),
      e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      f: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: kb.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      tab: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
      p: kb.addKey(Phaser.Input.Keyboard.KeyCodes.P),
      m: kb.addKey(Phaser.Input.Keyboard.KeyCodes.M),
      esc: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      r: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      f2: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F2),
      f3: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F3),
    };
  }

  public resetKeys(): void {
    if (!this.keys) return;
    for (const k of Object.values(this.keys)) {
      k.reset();
    }
    this.holdAttackMs = 0;
  }

  public sample(deltaMs = 16.6): MoveInputState {
    if (!this.keys) {
      return {
        x: 0,
        y: 0,
        isMoving: false,
        lightAttackPressed: false,
        heavyAttackPressed: false,
        interactPressed: false,
        specialPressed: false,
        skill2Pressed: false,
        skill3Pressed: false,
        guardHeld: false,
        switchHeroPressed: false,
        partySetupPressed: false,
        toggleCombatPanelPressed: false,
        toggleDebugPressed: false,
        pausePressed: false,
        mutePressed: false,
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

    // Instant tap OR comfortable Hold-to-Combo on Z / J!
    const tapLight =
      Phaser.Input.Keyboard.JustDown(this.keys.z) ||
      Phaser.Input.Keyboard.JustDown(this.keys.j);
    const holdDown = this.keys.z.isDown || this.keys.j.isDown;
    let lightAttackPressed = tapLight;
    if (tapLight) {
      this.holdAttackMs = 175;
    } else if (holdDown) {
      this.holdAttackMs -= Math.min(deltaMs, 50);
      if (this.holdAttackMs <= 0) {
        this.holdAttackMs = 145;
        lightAttackPressed = true;
      }
    } else {
      this.holdAttackMs = 0;
    }

    return {
      x,
      y,
      isMoving: len > 0,
      lightAttackPressed,
      heavyAttackPressed:
        Phaser.Input.Keyboard.JustDown(this.keys.x) ||
        Phaser.Input.Keyboard.JustDown(this.keys.k),
      interactPressed:
        Phaser.Input.Keyboard.JustDown(this.keys.space) ||
        Phaser.Input.Keyboard.JustDown(this.keys.e) ||
        Phaser.Input.Keyboard.JustDown(this.keys.f),
      specialPressed:
        Phaser.Input.Keyboard.JustDown(this.keys.v) ||
        Phaser.Input.Keyboard.JustDown(this.keys.u) ||
        Phaser.Input.Keyboard.JustDown(this.keys.one),
      skill2Pressed:
        Phaser.Input.Keyboard.JustDown(this.keys.b) ||
        Phaser.Input.Keyboard.JustDown(this.keys.i) ||
        Phaser.Input.Keyboard.JustDown(this.keys.two),
      skill3Pressed:
        Phaser.Input.Keyboard.JustDown(this.keys.n) ||
        Phaser.Input.Keyboard.JustDown(this.keys.o) ||
        Phaser.Input.Keyboard.JustDown(this.keys.three),
      guardHeld: this.keys.c.isDown || this.keys.shift.isDown || this.keys.l.isDown,
      switchHeroPressed: Phaser.Input.Keyboard.JustDown(this.keys.tab),
      partySetupPressed: Phaser.Input.Keyboard.JustDown(this.keys.p),
      toggleCombatPanelPressed: Phaser.Input.Keyboard.JustDown(this.keys.f2),
      toggleDebugPressed: Phaser.Input.Keyboard.JustDown(this.keys.f3),
      pausePressed: Phaser.Input.Keyboard.JustDown(this.keys.esc),
      mutePressed: Phaser.Input.Keyboard.JustDown(this.keys.m),
      restartPressed: Phaser.Input.Keyboard.JustDown(this.keys.r),
    };
  }

  public destroy(): void {
    this.keys = undefined;
  }
}
