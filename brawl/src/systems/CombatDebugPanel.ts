import { CombatTuning } from '../config/combatConfig';
import { EnvObjectKind, MayhemTuning } from '../config/mayhemConfig';
import { IGameSystem } from './ModuleRegistry';

export interface CombatDebugPanelActions {
  onSpawnBandit: () => void;
  onSpawnBanditGroup: () => void;
  onClearEnemies: () => void;
  onSpawnObject: (kind: EnvObjectKind) => void;
  onSpawnPuddle: () => void;
  onResetEnvironment: () => void;
  onClearDebris: () => void;
  onResetRoom: () => void;
  onTuningChanged: () => void;
}

/**
 * Toggleable developer tuning panel (F2) rendered as a lightweight HTML drawer
 * outside the normal gameplay UI so Step 2 combat & Step 3 mayhem physics can be tuned live.
 */
export class CombatDebugPanel implements IGameSystem {
  public readonly id = 'combat-debug-panel';

  private readonly tuning: CombatTuning;
  private readonly mayhem: MayhemTuning;
  private readonly actions: CombatDebugPanelActions;
  private root?: HTMLDivElement;
  private visible = false;

  constructor(
    tuning: CombatTuning,
    mayhem: MayhemTuning,
    actions: CombatDebugPanelActions,
  ) {
    this.tuning = tuning;
    this.mayhem = mayhem;
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
      'width: 306px',
      'max-height: calc(100vh - 24px)',
      'overflow-y: auto',
      'background: rgba(11, 16, 27, 0.94)',
      'color: #e2e8f0',
      'border: 1px solid rgba(251, 191, 36, 0.65)',
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
      '<strong style="color:#fde047;font-size:12px;">⚔ COMBAT & MAYHEM DEBUG [F2]</strong>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:13px;';
    closeBtn.onclick = () => this.setVisible(false);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ===== STEP 3 MAYHEM PHYSICS TUNING =====
    this.addSectionTitle(panel, 'MAYHEM PHYSICS (STEP 3)');

    this.addSlider(panel, 'Throw Force', 280, 900, 20, () => this.mayhem.objectThrowForce, (v) => {
      this.mayhem.objectThrowForce = v;
    }, (v) => `${Math.round(v)}`);

    this.addSlider(panel, 'Object Mass', 0.5, 2.5, 0.1, () => this.mayhem.objectMassMultiplier, (v) => {
      this.mayhem.objectMassMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Object Durability', 0.5, 3.0, 0.5, () => this.mayhem.objectDurabilityMultiplier, (v) => {
      this.mayhem.objectDurabilityMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Chain Transfer', 0.3, 1.3, 0.05, () => this.mayhem.knockbackTransferCoeff, (v) => {
      this.mayhem.knockbackTransferCoeff = v;
    }, (v) => `${v.toFixed(2)}`);

    this.addSlider(panel, 'Chain Energy Min', 60, 280, 10, () => this.mayhem.collisionEnergyThreshold, (v) => {
      this.mayhem.collisionEnergyThreshold = v;
    }, (v) => `${Math.round(v)}`);

    this.addSlider(panel, 'Max Chain Depth', 1, 8, 1, () => this.mayhem.maxChainDepth, (v) => {
      this.mayhem.maxChainDepth = Math.round(v);
    }, (v) => `${Math.round(v)}`);

    this.addSlider(panel, 'Surface Friction', 0.4, 2.2, 0.1, () => this.mayhem.surfaceFriction, (v) => {
      this.mayhem.surfaceFriction = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Slip Probability', 0, 1.0, 0.05, () => this.mayhem.slipProbability, (v) => {
      this.mayhem.slipProbability = v;
    }, (v) => `${Math.round(v * 100)}%`);

    this.addSlider(panel, 'Puddle Duration', 4000, 30000, 1000, () => this.mayhem.puddleDurationMs, (v) => {
      this.mayhem.puddleDurationMs = v;
    }, (v) => `${(v / 1000).toFixed(0)}s`);

    this.addSlider(panel, 'Particle Intensity', 0, 2.0, 0.1, () => this.mayhem.particleIntensity, (v) => {
      this.mayhem.particleIntensity = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Env SFX Volume', 0, 1.0, 0.05, () => this.mayhem.envSfxVolume, (v) => {
      this.mayhem.envSfxVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);

    // ===== STEP 2 COMBAT TUNING =====
    this.addSectionTitle(panel, 'COMBAT TUNING (STEP 2)');

    this.addSlider(panel, 'Player Damage', 0.4, 3.0, 0.1, () => this.tuning.playerDamageMultiplier, (v) => {
      this.tuning.playerDamageMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Attack Range', 0.6, 1.8, 0.05, () => this.tuning.attackRangeMultiplier, (v) => {
      this.tuning.attackRangeMultiplier = v;
    }, (v) => `${v.toFixed(2)}x`);

    this.addSlider(panel, 'Attack Speed', 0.5, 1.8, 0.05, () => this.tuning.attackSpeedMultiplier, (v) => {
      this.tuning.attackSpeedMultiplier = v;
    }, (v) => `${v.toFixed(2)}x`);

    this.addSlider(panel, 'Combo Window', 150, 700, 10, () => this.tuning.comboWindowMs, (v) => {
      this.tuning.comboWindowMs = v;
    }, (v) => `${Math.round(v)}ms`);

    this.addSlider(panel, 'Hit-Stop Scale', 0, 2.5, 0.1, () => this.tuning.hitStopScale, (v) => {
      this.tuning.hitStopScale = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Knockback Force', 0.4, 2.5, 0.1, () => this.tuning.knockbackMultiplier, (v) => {
      this.tuning.knockbackMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Enemy Health', 30, 300, 10, () => this.tuning.enemyMaxHp, (v) => {
      this.tuning.enemyMaxHp = v;
    }, (v) => `${Math.round(v)}`);

    this.addSlider(panel, 'Enemy Speed', 50, 240, 5, () => this.tuning.enemyMoveSpeed, (v) => {
      this.tuning.enemyMoveSpeed = v;
    }, (v) => `${Math.round(v)}`);

    this.addSlider(panel, 'Screen Shake', 0, 2.5, 0.1, () => this.tuning.screenShakeIntensity, (v) => {
      this.tuning.screenShakeIntensity = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addSlider(panel, 'Combat SFX Vol', 0, 1.0, 0.05, () => this.tuning.audioVolume, (v) => {
      this.tuning.audioVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);

    this.addSlider(panel, 'Enemy Count', 1, 15, 1, () => this.tuning.enemyCount, (v) => {
      this.tuning.enemyCount = Math.round(v);
    }, (v) => `${Math.round(v)}`);

    // ===== VISUALIZATION TOGGLES =====
    this.addSectionTitle(panel, 'DEBUG OVERLAYS');
    const togglesWrap = document.createElement('div');
    togglesWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
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
    this.addCheckbox(togglesWrap, 'Show World Coords', () => this.mayhem.showWorldCoords, (v) => {
      this.mayhem.showWorldCoords = v;
    });
    this.addCheckbox(togglesWrap, 'Show Chain Counters', () => this.mayhem.showChainCounters, (v) => {
      this.mayhem.showChainCounters = v;
    });
    panel.appendChild(togglesWrap);

    // ===== SPAWN & RESET BUTTONS =====
    this.addSectionTitle(panel, 'SPAWN & RESET TOOLS');
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;';

    btnRow.appendChild(this.makeButton('+ Table', '#92400e', () => this.actions.onSpawnObject('table')));
    btnRow.appendChild(this.makeButton('+ Water Barrel', '#0284c7', () => this.actions.onSpawnObject('barrel_water')));
    btnRow.appendChild(this.makeButton('+ Ceramic Jar', '#c2410c', () => this.actions.onSpawnObject('ceramic_jar')));
    btnRow.appendChild(this.makeButton('+ Fruit Basket', '#15803d', () => this.actions.onSpawnObject('fruit_basket')));
    btnRow.appendChild(this.makeButton('+ Puddle', '#0369a1', () => this.actions.onSpawnPuddle()));
    btnRow.appendChild(this.makeButton('+ 1 Bandit', '#1d4ed8', () => this.actions.onSpawnBandit()));
    btnRow.appendChild(this.makeButton('+ Group (5)', '#4338ca', () => this.actions.onSpawnBanditGroup()));
    btnRow.appendChild(this.makeButton('Clear Enemies', '#991b1b', () => this.actions.onClearEnemies()));
    btnRow.appendChild(this.makeButton('Reset Env', '#b45309', () => this.actions.onResetEnvironment()));
    btnRow.appendChild(this.makeButton('Clear Debris', '#475569', () => this.actions.onClearDebris()));

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
      'margin:8px 0 5px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);color:#fb923c;font-weight:bold;font-size:10px;letter-spacing:0.06em;';
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
    input.style.cssText = 'width:100%;accent-color:#fbbf24;cursor:pointer;';
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
    box.style.accentColor = '#fbbf24';
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
