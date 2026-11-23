import { MoveInputState } from './InputSystem';
import { IGameSystem, SystemContext } from './ModuleRegistry';

/**
 * Unified hero control input contract shared identically by HumanInputController
 * (Keyboard / Gamepad) and AIHeroController.
 */
export interface HeroActionInput {
  x: number;
  y: number;
  isMoving: boolean;
  lightAttackPressed: boolean;
  heavyAttackPressed: boolean;
  specialPressed: boolean;
  interactPressed: boolean;
  guardHeld?: boolean;
}

export function createEmptyHeroInput(): HeroActionInput {
  return {
    x: 0,
    y: 0,
    isMoving: false,
    lightAttackPressed: false,
    heavyAttackPressed: false,
    specialPressed: false,
    interactPressed: false,
    guardHeld: false,
  };
}

export interface MultiInputCallbacks {
  onGamepadJoinRequested: (deviceId: string) => void;
  onGamepadDisconnected: (deviceId: string) => void;
}

/**
 * Manages independent local multiplayer input devices (1-4 humans):
 * - 'keyboard': Player 1 keyboard (WASD/Arrows + Z/X/V/SPACE)
 * - 'gamepad:0' .. 'gamepad:3': Standard HTML5 Gamepad API controllers
 * Supports stable device-to-slot ownership, Start-button join-in-progress,
 * safe disconnection handling, and simulated inputs for automated/F2 testing.
 */
export class MultiInputManager implements IGameSystem {
  public readonly id = 'multi-input';

  private readonly callbacks: MultiInputCallbacks;
  private readonly prevButtons = new Map<string, boolean[]>();
  private readonly simulatedInputs = new Map<string, HeroActionInput>();
  private readonly connectedGamepads = new Set<string>();
  private onConnectBound?: (e: GamepadEvent) => void;
  private onDisconnectBound?: (e: GamepadEvent) => void;

  constructor(callbacks: MultiInputCallbacks) {
    this.callbacks = callbacks;
  }

  public init(_ctx: SystemContext): void {
    if (typeof window === 'undefined') return;

    this.onConnectBound = (e: GamepadEvent) => {
      const devId = `gamepad:${e.gamepad.index}`;
      this.connectedGamepads.add(devId);
    };
    this.onDisconnectBound = (e: GamepadEvent) => {
      const devId = `gamepad:${e.gamepad.index}`;
      this.connectedGamepads.delete(devId);
      this.prevButtons.delete(devId);
      this.callbacks.onGamepadDisconnected(devId);
    };

    window.addEventListener('gamepadconnected', this.onConnectBound);
    window.addEventListener('gamepaddisconnected', this.onDisconnectBound);
  }

  public get connectedDeviceIds(): string[] {
    return ['keyboard', ...Array.from(this.connectedGamepads)];
  }

  /**
   * Injects a one-frame simulated input for a virtual device (used for 4P testing & F2 debug).
   */
  public setSimulatedInput(deviceId: string, input: HeroActionInput): void {
    this.simulatedInputs.set(deviceId, input);
  }

  public clearSimulatedInputs(): void {
    this.simulatedInputs.clear();
  }

  /**
   * Polls all connected gamepads for Start-button Join-in-Progress presses.
   */
  public pollJoinRequests(assignedDevices: Set<string>): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const devId = `gamepad:${pad.index}`;
      this.connectedGamepads.add(devId);

      const startDown = Boolean(pad.buttons[9]?.pressed);
      const prev = this.prevButtons.get(devId) ?? [];
      const wasStartDown = Boolean(prev[9]);

      if (startDown && !wasStartDown && !assignedDevices.has(devId)) {
        this.callbacks.onGamepadJoinRequested(devId);
      }
    }
  }

  /**
   * Samples independent input for a specific device ('keyboard' or 'gamepad:N').
   */
  public sampleDevice(
    deviceId: string,
    keyboardSample: MoveInputState,
  ): HeroActionInput {
    // Simulated virtual input takes priority if active (for testing)
    const sim = this.simulatedInputs.get(deviceId);
    if (sim) {
      this.simulatedInputs.delete(deviceId);
      return sim;
    }

    if (deviceId === 'keyboard') {
      return {
        x: keyboardSample.x,
        y: keyboardSample.y,
        isMoving: keyboardSample.isMoving,
        lightAttackPressed: keyboardSample.lightAttackPressed,
        heavyAttackPressed: keyboardSample.heavyAttackPressed,
        specialPressed: keyboardSample.specialPressed,
        interactPressed: keyboardSample.interactPressed,
        guardHeld: keyboardSample.guardHeld,
      };
    }

    if (deviceId.startsWith('gamepad:')) {
      const idx = parseInt(deviceId.slice('gamepad:'.length), 10);
      return this.sampleGamepad(idx, deviceId);
    }

    return createEmptyHeroInput();
  }

  private sampleGamepad(index: number, deviceId: string): HeroActionInput {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return createEmptyHeroInput();
    }
    const pad = navigator.getGamepads()[index];
    if (!pad || !pad.connected) {
      return createEmptyHeroInput();
    }

    const prev = this.prevButtons.get(deviceId) ?? [];
    const curButtons = pad.buttons.map((b) => Boolean(b?.pressed));
    this.prevButtons.set(deviceId, curButtons);

    const justPressed = (btnIdx: number): boolean =>
      Boolean(curButtons[btnIdx]) && !Boolean(prev[btnIdx]);

    // Left stick + D-pad 8-direction support with deadzone
    let rawX = pad.axes[0] ?? 0;
    let rawY = pad.axes[1] ?? 0;
    if (Math.hypot(rawX, rawY) < 0.24) {
      rawX = 0;
      rawY = 0;
    }
    if (curButtons[14]) rawX = -1; // D-pad Left
    if (curButtons[15]) rawX = 1;  // D-pad Right
    if (curButtons[12]) rawY = -1; // D-pad Up
    if (curButtons[13]) rawY = 1;  // D-pad Down

    const len = Math.hypot(rawX, rawY);
    const x = len > 0.1 ? rawX / len : 0;
    const y = len > 0.1 ? rawY / len : 0;

    return {
      x,
      y,
      isMoving: len > 0.1,
      lightAttackPressed: justPressed(0) || justPressed(2), // A or X
      heavyAttackPressed: justPressed(1), // B
      specialPressed: justPressed(3) || justPressed(5), // Y or RB
      interactPressed: justPressed(4), // LB
      guardHeld: Boolean(curButtons[6] || curButtons[7]), // LT or RT
    };
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.onConnectBound) {
        window.removeEventListener('gamepadconnected', this.onConnectBound);
      }
      if (this.onDisconnectBound) {
        window.removeEventListener('gamepaddisconnected', this.onDisconnectBound);
      }
    }
    this.prevButtons.clear();
    this.simulatedInputs.clear();
    this.connectedGamepads.clear();
  }
}
