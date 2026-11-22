import { CombatTuning } from '../config/combatConfig';
import { EnvObjectKind, MayhemTuning } from '../config/mayhemConfig';
import { BanditArchetype, Step4Tuning } from '../config/step4Config';
import { IGameSystem } from './ModuleRegistry';

export interface CombatDebugPanelActions {
  onSpawnBandit: (archetype?: BanditArchetype) => void;
  onSpawnBanditGroup: () => void;
  onClearEnemies: () => void;
  onSpawnObject: (kind: EnvObjectKind) => void;
  onSpawnPuddle: () => void;
  onResetEnvironment: () => void;
  onClearDebris: () => void;
  onTriggerChargeTest: () => void;
  onForceEnemyPanic: () => void;
  onPreviewCameraGag: () => void;
  onResetAiStates: () => void;
  onSwitchHero: () => void;
  onResetRoom: () => void;
  onTuningChanged: () => void;
}

/**
 * Toggleable developer tuning panel (F2) covering Step 2 Combat, Step 3 Mayhem,
 * and Step 4 Zhang Fei Charge, Comedic AI, and Camera-Glass Gag controls.
 */
export class CombatDebugPanel implements IGameSystem {
  public readonly id = 'combat-debug-panel';

  private readonly tuning: CombatTuning;
  private readonly mayhem: MayhemTuning;
  private readonly step4: Step4Tuning;
  private readonly actions: CombatDebugPanelActions;
  private root?: HTMLDivElement;
  private visible = false;

  constructor(
    tuning: CombatTuning,
    mayhem: MayhemTuning,
    step4: Step4Tuning,
    actions: CombatDebugPanelActions,
  ) {
    this.tuning = tuning;
    this.mayhem = mayhem;
    this.step4 = step4;
    this.actions = actions;
  }

  public init(): void {
    if (typeof document === 'undefined') return;

    const panel = document.createElement('div');
    panel.id = 'combat-debug-panel';
    panel.style.cssText = [
      'position: fixed',
      'top: 12px',
      'right: 12px',
      'width: 316px',
      'max-height: calc(100vh - 24px)',
      'overflow-y: auto',
      'background: rgba(11, 16, 27, 0.94)',
      'color: #e2e8f0',
      'border: 1px solid rgba(192, 132, 252, 0.72)',
      'border-radius: 8px',
      'padding: 12px',
      'font-family: Consolas, Menlo, monospace',
      'font-size: 11px',
      'z-index: 9999',
      'box-shadow: 0 10px 28px rgba(0,0,0,0.65)',
      'display: none',
      'user-select: none',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(148,163,184,0.25);';
    header.innerHTML =
      '<strong style="color:#fde047;font-size:12px;">⚔ MAYHEM DEV PANEL [F2]</strong>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:13px;';
    closeBtn.onclick = () => this.setVisible(false);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ===== STEP 4: QUICK ACTIONS =====
    this.addSectionTitle(panel, 'STEP 4 QUICK ACTIONS');
    const s4Btns = document.createElement('div');
    s4Btns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px;';
    s4Btns.appendChild(this.makeButton('Switch Hero [TAB]', '#7e22ce', () => this.actions.onSwitchHero()));
    s4Btns.appendChild(this.makeButton('⚡ Test Charge [V]', '#9333ea', () => this.actions.onTriggerChargeTest()));
    s4Btns.appendChild(this.makeButton('😱 Force Panic', '#0284c7', () => this.actions.onForceEnemyPanic()));
    s4Btns.appendChild(this.makeButton('💥 Camera Gag', '#db2777', () => this.actions.onPreviewCameraGag()));
    s4Btns.appendChild(this.makeButton('+ Coward', '#0369a1', () => this.actions.onSpawnBandit('coward')));
    s4Btns.appendChild(this.makeButton('+ Clumsy', '#c2410c', () => this.actions.onSpawnBandit('clumsy')));
    s4Btns.appendChild(this.makeButton('+ Stubborn', '#991b1b', () => this.actions.onSpawnBandit('stubborn')));
    s4Btns.appendChild(this.makeButton('+ Elite', '#b45309', () => this.actions.onSpawnBandit('elite')));
    s4Btns.appendChild(this.makeButton('+ Cover Table', '#78350f', () => this.actions.onSpawnObject('table')));
    s4Btns.appendChild(this.makeButton('Reset AI States', '#475569', () => this.actions.onResetAiStates()));
    panel.appendChild(s4Btns);

    // ===== STEP 4: ZHANG FEI CHARGE =====
    this.addSectionTitle(panel, 'ZHANG FEI CHARGE (맹장돌진)');
    this.addSlider(panel, 'Charge Speed', 420, 960, 20, () => this.step4.chargeMaxSpeed, (v) => {
      this.step4.chargeMaxSpeed = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Charge Accel', 1200, 4200, 100, () => this.step4.chargeAcceleration, (v) => {
      this.step4.chargeAcceleration = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Charge Distance', 220, 760, 20, () => this.step4.chargeMaxDistance, (v) => {
      this.step4.chargeMaxDistance = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Charge Impulse', 280, 820, 20, () => this.step4.chargeKnockback, (v) => {
      this.step4.chargeKnockback = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Energy Loss/Hit', 5, 55, 1, () => this.step4.chargeEnergyLossPerHit, (v) => {
      this.step4.chargeEnergyLossPerHit = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Charge Recovery', 100, 520, 20, () => this.step4.chargeRecoveryMs, (v) => {
      this.step4.chargeRecoveryMs = v;
    }, (v) => `${Math.round(v)}ms`);
    this.addSlider(panel, 'Charge Cooldown', 500, 8000, 250, () => this.step4.chargeCooldownMs, (v) => {
      this.step4.chargeCooldownMs = v;
    }, (v) => `${(v / 1000).toFixed(1)}s`);
    this.addCheckbox(panel, 'Disable Charge Cooldown', () => this.step4.chargeNoCooldown, (v) => {
      this.step4.chargeNoCooldown = v;
    });

    // ===== STEP 4: ENEMY AI & FEAR =====
    this.addSectionTitle(panel, 'COMEDIC ENEMY AI & FEAR');
    this.addSlider(panel, 'Enemy Courage', 0.3, 2.0, 0.1, () => this.step4.enemyCourageMultiplier, (v) => {
      this.step4.enemyCourageMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Fear Gain', 0.2, 2.5, 0.1, () => this.step4.fearGainMultiplier, (v) => {
      this.step4.fearGainMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Panic Thresh Offset', -25, 25, 2, () => this.step4.panicThresholdOffset, (v) => {
      this.step4.panicThresholdOffset = v;
    }, (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`);
    this.addSlider(panel, 'Fleeing Speed', 0.6, 1.8, 0.05, () => this.step4.fleeSpeedMultiplier, (v) => {
      this.step4.fleeSpeedMultiplier = v;
    }, (v) => `${v.toFixed(2)}x`);
    this.addSlider(panel, 'Trip Probability', 0, 1.0, 0.05, () => this.step4.tripProbability, (v) => {
      this.step4.tripProbability = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Hiding Preference', 0, 1.8, 0.1, () => this.step4.hidingPreference, (v) => {
      this.step4.hidingPreference = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Peek Interval', 600, 3500, 100, () => this.step4.peekIntervalMs, (v) => {
      this.step4.peekIntervalMs = v;
    }, (v) => `${(v / 1000).toFixed(1)}s`);
    this.addSlider(panel, 'Surrender Offset', -25, 25, 2, () => this.step4.surrenderThresholdOffset, (v) => {
      this.step4.surrenderThresholdOffset = v;
    }, (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}`);

    // ===== STEP 4: CAMERA-GLASS GAG =====
    this.addSectionTitle(panel, 'CAMERA-GLASS GAG');
    this.addCheckbox(panel, 'Enable Camera Gag', () => this.step4.cameraGagEnabled, (v) => {
      this.step4.cameraGagEnabled = v;
    });
    this.addSlider(panel, 'Launch Threshold', 200, 560, 20, () => this.step4.cameraGagLaunchThreshold, (v) => {
      this.step4.cameraGagLaunchThreshold = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Gag Frequency', 0.05, 1.0, 0.05, () => this.step4.cameraGagChance, (v) => {
      this.step4.cameraGagChance = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Gag Duration', 750, 1600, 50, () => this.step4.cameraGagDurationMs, (v) => {
      this.step4.cameraGagDurationMs = v;
    }, (v) => `${Math.round(v)}ms`);
    this.addSlider(panel, 'Global Cooldown', 1500, 15000, 500, () => this.step4.cameraGagCooldownMs, (v) => {
      this.step4.cameraGagCooldownMs = v;
    }, (v) => `${(v / 1000).toFixed(1)}s`);
    this.addSlider(panel, 'Splat Volume', 0, 1.4, 0.1, () => this.step4.cameraGagSplatVolume, (v) => {
      this.step4.cameraGagSplatVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Squeak Volume', 0, 1.4, 0.1, () => this.step4.cameraGagSqueakVolume, (v) => {
      this.step4.cameraGagSqueakVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);

    // ===== STEP 3 MAYHEM & STEP 2 COMBAT =====
    this.addSectionTitle(panel, 'MAYHEM & COMBAT (STEP 2-3)');
    this.addSlider(panel, 'Throw Force', 280, 900, 20, () => this.mayhem.objectThrowForce, (v) => {
      this.mayhem.objectThrowForce = v;
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Chain Transfer', 0.3, 1.3, 0.05, () => this.mayhem.knockbackTransferCoeff, (v) => {
      this.mayhem.knockbackTransferCoeff = v;
    }, (v) => `${v.toFixed(2)}`);
    this.addSlider(panel, 'Slip Probability', 0, 1.0, 0.05, () => this.mayhem.slipProbability, (v) => {
      this.mayhem.slipProbability = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Player Damage', 0.4, 3.0, 0.1, () => this.tuning.playerDamageMultiplier, (v) => {
      this.tuning.playerDamageMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Hit-Stop Scale', 0, 2.5, 0.1, () => this.tuning.hitStopScale, (v) => {
      this.tuning.hitStopScale = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Screen Shake', 0, 2.5, 0.1, () => this.tuning.screenShakeIntensity, (v) => {
      this.tuning.screenShakeIntensity = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Combat SFX Vol', 0, 1.0, 0.05, () => this.tuning.audioVolume, (v) => {
      this.tuning.audioVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Env SFX Volume', 0, 1.0, 0.05, () => this.mayhem.envSfxVolume, (v) => {
      this.mayhem.envSfxVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);

    // ===== OVERLAYS & ROOM TOOLS =====
    this.addSectionTitle(panel, 'DEBUG OVERLAYS & ROOM');
    const togglesWrap = document.createElement('div');
    togglesWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px;';
    this.addCheckbox(togglesWrap, 'Show AI State & Fear', () => this.step4.showAiDebug, (v) => {
      this.step4.showAiDebug = v;
    });
    this.addCheckbox(togglesWrap, 'Enable Screen Shake', () => this.tuning.screenShakeEnabled, (v) => {
      this.tuning.screenShakeEnabled = v;
    });
    this.addCheckbox(togglesWrap, 'Show Attack Hitboxes', () => this.tuning.showHitboxes, (v) => {
      this.tuning.showHitboxes = v;
    });
    this.addCheckbox(togglesWrap, 'Show Object Collisions', () => this.mayhem.showObjectShapes, (v) => {
      this.mayhem.showObjectShapes = v;
    });
    this.addCheckbox(togglesWrap, 'Show Actor Collisions', () => this.mayhem.showActorShapes, (v) => {
      this.mayhem.showActorShapes = v;
      this.tuning.showGroundPositions = v;
    });
    this.addCheckbox(togglesWrap, 'Show Velocity Vectors', () => this.mayhem.showVelocityVectors, (v) => {
      this.mayhem.showVelocityVectors = v;
    });
    panel.appendChild(togglesWrap);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;';
    btnRow.appendChild(this.makeButton('+ Water Barrel', '#0284c7', () => this.actions.onSpawnObject('barrel_water')));
    btnRow.appendChild(this.makeButton('+ Ceramic Jar', '#c2410c', () => this.actions.onSpawnObject('ceramic_jar')));
    btnRow.appendChild(this.makeButton('+ Puddle', '#0369a1', () => this.actions.onSpawnPuddle()));
    btnRow.appendChild(this.makeButton('+ Group (5)', '#4338ca', () => this.actions.onSpawnBanditGroup()));
    btnRow.appendChild(this.makeButton('Clear Enemies', '#991b1b', () => this.actions.onClearEnemies()));
    btnRow.appendChild(this.makeButton('Reset Env', '#b45309', () => this.actions.onResetEnvironment()));
    const resetBtn = this.makeButton('Reset Test Room (R)', '#d97706', () => this.actions.onResetRoom());
    resetBtn.style.gridColumn = 'span 2';
    btnRow.appendChild(resetBtn);
    panel.appendChild(btnRow);

    document.body.appendChild(panel);
    this.root = panel;
  }

  public toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  public setVisible(show: boolean): void {
    this.visible = show;
    if (this.root) {
      this.root.style.display = show ? 'block' : 'none';
    }
  }

  private addSectionTitle(parent: HTMLElement, text: string): void {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'margin:8px 0 5px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);color:#c084fc;font-weight:bold;font-size:10px;letter-spacing:0.06em;';
    parent.appendChild(el);
  }

  private addSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    getter: () => number,
    setter: (val: number) => void,
    format: (val: number) => string,
  ): void {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:5px;';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:1px;';
    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    const valEl = document.createElement('span');
    valEl.style.color = '#7dd3fc';
    valEl.textContent = format(getter());
    top.appendChild(nameEl);
    top.appendChild(valEl);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(getter());
    input.style.cssText = 'width:100%;accent-color:#c084fc;cursor:pointer;';
    input.oninput = () => {
      const num = parseFloat(input.value);
      setter(num);
      valEl.textContent = format(num);
      this.actions.onTuningChanged();
    };
    input.onkeydown = (e) => {
      if (e.key === 'F2') return;
      e.stopPropagation();
    };

    row.appendChild(top);
    row.appendChild(input);
    parent.appendChild(row);
  }

  private addCheckbox(
    parent: HTMLElement,
    label: string,
    getter: () => boolean,
    setter: (val: boolean) => void,
  ): void {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = getter();
    box.style.accentColor = '#c084fc';
    box.onchange = () => {
      setter(box.checked);
      this.actions.onTuningChanged();
      box.blur();
    };
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(box);
    wrap.appendChild(span);
    parent.appendChild(wrap);
  }

  private makeButton(label: string, bg: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      `background:${bg}`,
      'color:#ffffff',
      'border:1px solid rgba(255,255,255,0.2)',
      'border-radius:5px',
      'padding:5px 6px',
      'font-family:Consolas, Menlo, monospace',
      'font-size:10px',
      'font-weight:bold',
      'cursor:pointer',
    ].join(';');
    btn.onclick = () => {
      onClick();
      btn.blur();
    };
    return btn;
  }

  public destroy(): void {
    this.root?.remove();
    this.root = undefined;
  }
}
