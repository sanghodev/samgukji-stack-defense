import { HeroActionInput } from './MultiInputManager';
import { IGameSystem, SystemContext } from './ModuleRegistry';

/**
 * Auto-detecting responsive Virtual Arcade Touch Pad for Mobile & Tablet play.
 * - Stays 100% hidden on desktop mouse/keyboard so PC screens have zero extra UI clutter.
 * - Automatically activates the moment a real `touchstart` event occurs (or via manual toggle in Pause menu).
 * - Multi-touch safe: left-thumb 8-direction floating/anchored stick + right-thumb arcade buttons.
 */
export class TouchControlsOverlay implements IGameSystem {
  public readonly id = 'touch-controls';

  private rootEl?: HTMLDivElement;
  private stickBaseEl?: HTMLDivElement;
  private stickKnobEl?: HTMLDivElement;

  private enabled = false;
  private suppressedByModal = false;

  // Virtual stick multi-touch state
  private stickTouchId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private moveX = 0;
  private moveY = 0;

  // Virtual button states
  private attackHeld = false;
  private holdComboTimerMs = 0;
  private guardHeld = false;

  // Edge-triggered presses latched until next sample()
  private latchedLight = false;
  private latchedHeavy = false;
  private latchedInteract = false;
  private latchedSkill1 = false;
  private latchedSkill2 = false;
  private latchedSkill3 = false;

  private onFirstTouchBound?: () => void;

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public init(_ctx: SystemContext): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const root = document.createElement('div');
    root.id = 'tkm-touch-controls';
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2100',
      'display:none',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
      'font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
    ].join(';');

    // 1. Left-side Virtual Joystick Zone
    const leftZone = document.createElement('div');
    leftZone.style.cssText = [
      'position:absolute',
      'left:0',
      'bottom:0',
      'width:44vw',
      'height:58vh',
      'pointer-events:auto',
      'touch-action:none',
    ].join(';');

    const stickBase = document.createElement('div');
    stickBase.style.cssText = [
      'position:absolute',
      'left:32px',
      'bottom:34px',
      'width:118px',
      'height:118px',
      'border-radius:50%',
      'background:radial-gradient(circle, rgba(30,41,59,0.58) 0%, rgba(15,23,42,0.78) 100%)',
      'border:2px solid rgba(250,204,21,0.55)',
      'box-shadow:0 6px 20px rgba(0,0,0,0.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'pointer-events:none',
    ].join(';');

    const stickKnob = document.createElement('div');
    stickKnob.style.cssText = [
      'width:50px',
      'height:50px',
      'border-radius:50%',
      'background:radial-gradient(circle at 35% 35%, #fef08a, #d97706)',
      'border:2px solid #fffbeb',
      'box-shadow:0 4px 12px rgba(0,0,0,0.55)',
      'transform:translate(0px, 0px)',
    ].join(';');

    stickBase.appendChild(stickKnob);
    leftZone.appendChild(stickBase);
    root.appendChild(leftZone);
    this.stickBaseEl = stickBase;
    this.stickKnobEl = stickKnob;

    const maxRadius = 42;
    const updateStickFromTouch = (clientX: number, clientY: number) => {
      const dx = clientX - this.stickOriginX;
      const dy = clientY - this.stickOriginY;
      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(maxRadius, dist);
      const nx = dist > 4 ? dx / dist : 0;
      const ny = dist > 4 ? dy / dist : 0;
      if (dist > 8) {
        this.moveX = nx;
        this.moveY = ny;
      } else {
        this.moveX = 0;
        this.moveY = 0;
      }
      if (this.stickKnobEl) {
        this.stickKnobEl.style.transform = `translate(${(nx * clampedDist).toFixed(1)}px, ${(ny * clampedDist).toFixed(1)}px)`;
      }
    };

    leftZone.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        if (this.stickTouchId !== null) return;
        const t = e.changedTouches[0];
        if (!t) return;
        this.stickTouchId = t.identifier;
        const rect = stickBase.getBoundingClientRect();
        this.stickOriginX = rect.left + rect.width / 2;
        this.stickOriginY = rect.top + rect.height / 2;
        updateStickFromTouch(t.clientX, t.clientY);
      },
      { passive: false },
    );

    leftZone.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.stickTouchId) {
            updateStickFromTouch(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false },
    );

    const endStick = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.stickTouchId) {
          this.stickTouchId = null;
          this.moveX = 0;
          this.moveY = 0;
          if (this.stickKnobEl) {
            this.stickKnobEl.style.transform = 'translate(0px, 0px)';
          }
          break;
        }
      }
    };
    leftZone.addEventListener('touchend', endStick, { passive: false });
    leftZone.addEventListener('touchcancel', endStick, { passive: false });

    // 2. Right-side Arcade Action Cluster
    const rightCluster = document.createElement('div');
    rightCluster.style.cssText = [
      'position:absolute',
      'right:18px',
      'bottom:22px',
      'width:248px',
      'height:196px',
      'pointer-events:none',
    ].join(';');

    const makeArcadeBtn = (opts: {
      label: string;
      sub: string;
      right: number;
      bottom: number;
      size: number;
      bg: string;
      border: string;
      onPress: () => void;
      onRelease?: () => void;
    }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'position:absolute',
        `right:${opts.right}px`,
        `bottom:${opts.bottom}px`,
        `width:${opts.size}px`,
        `height:${opts.size}px`,
        'border-radius:50%',
        `background:${opts.bg}`,
        `border:2px solid ${opts.border}`,
        'color:#ffffff',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'box-shadow:0 5px 14px rgba(0,0,0,0.55)',
        'pointer-events:auto',
        'touch-action:none',
        'padding:0',
      ].join(';');
      btn.innerHTML = `<span style="font-size:${opts.size >= 68 ? 15 : 11}px;font-weight:900;line-height:1.05;">${opts.label}</span><span style="font-size:9px;opacity:0.88;margin-top:1px;">${opts.sub}</span>`;

      const press = (e: Event) => {
        e.preventDefault();
        btn.style.transform = 'scale(0.92)';
        opts.onPress();
      };
      const release = (e: Event) => {
        e.preventDefault();
        btn.style.transform = 'scale(1)';
        opts.onRelease?.();
      };

      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
      rightCluster.appendChild(btn);
    };

    // Main Giant Attack Button (Holdable!)
    makeArcadeBtn({
      label: '공격',
      sub: '연타',
      right: 6,
      bottom: 8,
      size: 76,
      bg: 'radial-gradient(circle at 35% 30%, #ef4444, #991b1b)',
      border: '#fecaca',
      onPress: () => {
        this.latchedLight = true;
        this.attackHeld = true;
        this.holdComboTimerMs = 165;
      },
      onRelease: () => {
        this.attackHeld = false;
      },
    });

    // Heavy Smash Button
    makeArcadeBtn({
      label: '강공격',
      sub: '날리기',
      right: 92,
      bottom: 6,
      size: 58,
      bg: 'radial-gradient(circle at 35% 30%, #f97316, #9a3412)',
      border: '#fed7aa',
      onPress: () => {
        this.latchedHeavy = true;
      },
    });

    // Interact / Pickup & Throw Table Button
    makeArcadeBtn({
      label: '들기',
      sub: '던지기',
      right: 158,
      bottom: 12,
      size: 54,
      bg: 'radial-gradient(circle at 35% 30%, #0ea5e9, #0369a1)',
      border: '#bae6fd',
      onPress: () => {
        this.latchedInteract = true;
      },
    });

    // Guard (Holdable!)
    makeArcadeBtn({
      label: '방어',
      sub: '유지',
      right: 96,
      bottom: 72,
      size: 52,
      bg: 'radial-gradient(circle at 35% 30%, #64748b, #1e293b)',
      border: '#cbd5e1',
      onPress: () => {
        this.guardHeld = true;
      },
      onRelease: () => {
        this.guardHeld = false;
      },
    });

    // 3 Signature Elemental Skills arc along top of right cluster!
    makeArcadeBtn({
      label: '스킬1',
      sub: '특수기',
      right: 156,
      bottom: 78,
      size: 46,
      bg: 'radial-gradient(circle at 35% 30%, #3b82f6, #1d4ed8)',
      border: '#93c5fd',
      onPress: () => {
        this.latchedSkill1 = true;
      },
    });

    makeArcadeBtn({
      label: '스킬2',
      sub: '속성기',
      right: 84,
      bottom: 132,
      size: 46,
      bg: 'radial-gradient(circle at 35% 30%, #8b5cf6, #5b21b6)',
      border: '#ddd6fe',
      onPress: () => {
        this.latchedSkill2 = true;
      },
    });

    makeArcadeBtn({
      label: '극오의',
      sub: '위기탈출!',
      right: 12,
      bottom: 98,
      size: 56,
      bg: 'radial-gradient(circle at 35% 30%, #eab308, #a16207)',
      border: '#fef08a',
      onPress: () => {
        this.latchedSkill3 = true;
      },
    });

    root.appendChild(rightCluster);
    document.body.appendChild(root);
    this.rootEl = root;

    // Auto-enable ONLY when an actual touch event hits the screen
    this.onFirstTouchBound = () => {
      if (!this.enabled) {
        this.setEnabled(true);
      }
    };
    window.addEventListener('touchstart', this.onFirstTouchBound, { passive: true });
  }

  public setEnabled(enable: boolean): void {
    this.enabled = enable;
    if (!enable) {
      this.resetInputState();
    }
    this.syncVisibility();
  }

  public toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public setSuppressedByModal(suppressed: boolean): void {
    if (this.suppressedByModal === suppressed) return;
    this.suppressedByModal = suppressed;
    if (suppressed) {
      this.resetInputState();
    }
    this.syncVisibility();
  }

  private resetInputState(): void {
    this.stickTouchId = null;
    this.moveX = 0;
    this.moveY = 0;
    this.attackHeld = false;
    this.guardHeld = false;
    this.latchedLight = false;
    this.latchedHeavy = false;
    this.latchedInteract = false;
    this.latchedSkill1 = false;
    this.latchedSkill2 = false;
    this.latchedSkill3 = false;
    if (this.stickKnobEl) {
      this.stickKnobEl.style.transform = 'translate(0px, 0px)';
    }
  }

  private syncVisibility(): void {
    if (!this.rootEl) return;
    const show = this.enabled && !this.suppressedByModal;
    this.rootEl.style.display = show ? 'block' : 'none';
  }

  public sample(deltaMs: number): HeroActionInput | null {
    if (!this.enabled || this.suppressedByModal) return null;

    if (this.attackHeld) {
      this.holdComboTimerMs -= Math.min(deltaMs, 50);
      if (this.holdComboTimerMs <= 0) {
        this.holdComboTimerMs = 145;
        this.latchedLight = true;
      }
    }

    const out: HeroActionInput = {
      x: this.moveX,
      y: this.moveY,
      isMoving: Math.hypot(this.moveX, this.moveY) > 0.1,
      lightAttackPressed: this.latchedLight,
      heavyAttackPressed: this.latchedHeavy,
      interactPressed: this.latchedInteract,
      specialPressed: this.latchedSkill1,
      skill2Pressed: this.latchedSkill2,
      skill3Pressed: this.latchedSkill3,
      guardHeld: this.guardHeld,
    };

    this.latchedLight = false;
    this.latchedHeavy = false;
    this.latchedInteract = false;
    this.latchedSkill1 = false;
    this.latchedSkill2 = false;
    this.latchedSkill3 = false;

    return out;
  }

  public destroy(): void {
    if (typeof window !== 'undefined' && this.onFirstTouchBound) {
      window.removeEventListener('touchstart', this.onFirstTouchBound);
    }
    this.rootEl?.remove();
    this.rootEl = undefined;
  }
}
