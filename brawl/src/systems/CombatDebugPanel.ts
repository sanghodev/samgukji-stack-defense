import { CombatTuning } from '../config/combatConfig';
import { AiAggressionMode, HeroId, Step5Tuning } from '../config/heroConfig';
import { EnvObjectKind, MayhemTuning } from '../config/mayhemConfig';
import {
  applyCombatFeelPreset,
  applyImportedTuningJson,
  PolishSettings,
  serializeTuningJson,
} from '../config/polishConfig';
import { BanditArchetype, Step4Tuning } from '../config/step4Config';
import { IGameSystem } from './ModuleRegistry';

export type QualityTestSceneId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface CombatDebugPanelActions {
  onSpawnBandit: (archetype?: BanditArchetype) => void;
  onSpawnBanditGroup: () => void;
  onClearEnemies: () => void;
  onSpawnObject: (kind: EnvObjectKind) => void;
  onSpawnPuddle: () => void;
  onResetEnvironment: () => void;
  onClearDebris: () => void;
  onTriggerSpecial: (heroId?: HeroId) => void;
  onForceEnemyPanic: () => void;
  onPreviewCameraGag: () => void;
  onResetAiStates: () => void;
  onSwitchHero: () => void;
  onOpenPartySetup: () => void;
  onForceAiToHuman: () => void;
  onForceHumanToAi: () => void;
  onSimulateGamepadDisconnect: () => void;
  onTestFourPlayerInputs: () => void;
  onResetHeroPositions: () => void;
  onResetSpecialCooldowns: () => void;
  onResetRoom: () => void;
  onTuningChanged: () => void;
  // Step 6 Stage, Boss & Treasure Tools
  onJumpToWave?: (waveIndex: number) => void;
  onSpawnBoss?: () => void;
  onDamageBoss?: (pct: number) => void;
  onForceBossEnraged?: () => void;
  onGrantNextTreasure?: () => void;
  onOpenTreasureSelection?: () => void;
  onResetTemporaryUpgrades?: () => void;
  onForceVictory?: () => void;
  onForceDefeat?: () => void;
  onReturnMainMenu?: () => void;
  // Step 7 Quality Test Scenes A-H & Preset Notifications
  onRunQualityTest?: (id: QualityTestSceneId) => void;
  onPresetApplied?: (label: string) => void;
}

/**
 * Toggleable developer tuning panel (F2) covering Step 2-7:
 * A/B Feel Presets / Performance Profiler / Audio Buses / Accessibility /
 * Quality Test Scenes A-H / Stage Director / Boss / Treasure / Multiplayer.
 */
export class CombatDebugPanel implements IGameSystem {
  public readonly id = 'combat-debug-panel';

  private readonly tuning: CombatTuning;
  private readonly mayhem: MayhemTuning;
  private readonly step4: Step4Tuning;
  private readonly step5: Step5Tuning;
  private readonly polish: PolishSettings;
  private readonly actions: CombatDebugPanelActions;
  private root?: HTMLDivElement;
  private stageStatusEl?: HTMLDivElement;
  private perfStatusEl?: HTMLDivElement;
  private visible = false;

  constructor(
    tuning: CombatTuning,
    mayhem: MayhemTuning,
    step4: Step4Tuning,
    step5: Step5Tuning,
    polish: PolishSettings,
    actions: CombatDebugPanelActions,
  ) {
    this.tuning = tuning;
    this.mayhem = mayhem;
    this.step4 = step4;
    this.step5 = step5;
    this.polish = polish;
    this.actions = actions;
  }

  public updateStageStatus(text: string): void {
    if (this.stageStatusEl && this.visible) {
      this.stageStatusEl.textContent = text;
    }
  }

  public updatePerfStatus(text: string): void {
    if (this.perfStatusEl && this.visible) {
      this.perfStatusEl.textContent = text;
    }
  }

  public init(): void {
    if (typeof document === 'undefined') return;

    const panel = document.createElement('div');
    panel.id = 'combat-debug-panel';
    panel.style.cssText = [
      'position: fixed',
      'top: 12px',
      'right: 12px',
      'width: 332px',
      'max-height: calc(100vh - 24px)',
      'overflow-y: auto',
      'background: rgba(11, 16, 27, 0.95)',
      'color: #e2e8f0',
      'border: 1px solid rgba(56, 189, 248, 0.72)',
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
      '<strong style="color:#fde047;font-size:12px;">⚔ STEP 7 ARCADE POLISH LAB [F2]</strong>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:13px;';
    closeBtn.onclick = () => this.setVisible(false);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ===== STEP 7: A/B PRESETS, PERFORMANCE, AUDIO BUSES & TEST SCENES =====
    this.addSectionTitle(panel, 'A/B COMBAT FEEL & PERFORMANCE (STEP 7)');

    const perfLine = document.createElement('div');
    perfLine.style.cssText =
      'background:#0f172a;border:1px solid #1e3a8a;border-radius:5px;padding:5px 7px;margin-bottom:6px;color:#4ade80;font-size:10px;line-height:1.45;';
    perfLine.textContent = 'FPS: 60 | P50: 16.7ms | P95: 16.7ms';
    panel.appendChild(perfLine);
    this.perfStatusEl = perfLine;

    const abRow = document.createElement('div');
    abRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px;';
    abRow.appendChild(
      this.makeButton('A: ARCADE CLASSIC', '#0369a1', () => {
        applyCombatFeelPreset('ARCADE_CLASSIC', this.tuning, this.mayhem, this.step4, this.polish);
        this.actions.onTuningChanged();
        this.actions.onPresetApplied?.('Preset A: ARCADE CLASSIC 적용');
      }),
    );
    abRow.appendChild(
      this.makeButton('B: MAX MAYHEM', '#b45309', () => {
        applyCombatFeelPreset('MAXIMUM_MAYHEM', this.tuning, this.mayhem, this.step4, this.polish);
        this.actions.onTuningChanged();
        this.actions.onPresetApplied?.('Preset B: MAXIMUM MAYHEM 적용');
      }),
    );
    panel.appendChild(abRow);

    // Accessibility & Audio Bus Controls
    this.addCheckbox(panel, 'Reduce Motion (접근성)', () => this.polish.reduceMotion, (v) => {
      this.polish.reduceMotion = v;
      this.actions.onTuningChanged();
    });
    this.addSlider(panel, 'Master Volume', 0, 1.3, 0.05, () => this.polish.masterVolume, (v) => {
      this.polish.masterVolume = v;
      this.actions.onTuningChanged();
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Music Volume', 0, 1.2, 0.05, () => this.polish.musicVolume, (v) => {
      this.polish.musicVolume = v;
      this.actions.onTuningChanged();
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Music Ducking', 0, 0.85, 0.05, () => this.polish.musicDuckingAmount, (v) => {
      this.polish.musicDuckingAmount = v;
      this.actions.onTuningChanged();
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Max Audio Voices', 8, 32, 2, () => this.polish.maxAudioVoices, (v) => {
      this.polish.maxAudioVoices = v;
      this.actions.onTuningChanged();
    }, (v) => `${Math.round(v)}`);
    this.addSlider(panel, 'Max Hit-Stop Cap (ms)', 40, 130, 5, () => this.polish.maxHitStopCapMs, (v) => {
      this.polish.maxHitStopCapMs = v;
      this.actions.onTuningChanged();
    }, (v) => `${Math.round(v)}ms`);

    // JSON Export / Import
    const ioRow = document.createElement('div');
    ioRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:6px 0;';
    ioRow.appendChild(
      this.makeButton('📋 Export JSON', '#334155', () => {
        const json = serializeTuningJson(this.tuning, this.mayhem, this.step4, this.polish);
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(json);
        }
        window.prompt('Step 7 Tuning JSON (복사하세요):', json);
      }),
    );
    ioRow.appendChild(
      this.makeButton('📥 Import JSON', '#334155', () => {
        const raw = window.prompt('Step 7 Tuning JSON을 붙여넣으세요:');
        if (!raw) return;
        const ok = applyImportedTuningJson(raw, this.tuning, this.mayhem, this.step4, this.polish);
        this.actions.onTuningChanged();
        this.actions.onPresetApplied?.(ok ? 'JSON 튜닝 불러오기 완료!' : 'JSON 형식이 올바르지 않습니다');
      }),
    );
    panel.appendChild(ioRow);

    // Quality Test Scenes A-H
    const testRow = document.createElement('div');
    testRow.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:8px;';
    const tests: Array<[QualityTestSceneId, string]> = [
      ['A', 'A:단타'],
      ['B', 'B:돌진6'],
      ['C', 'C:테이블'],
      ['D', 'D:유리창'],
      ['E', 'E:겁쟁이'],
      ['F', 'F:4인난전'],
      ['G', 'G:보스전'],
      ['H', 'H:5회재시작'],
    ];
    for (const [id, label] of tests) {
      testRow.appendChild(
        this.makeButton(label, '#1e293b', () => this.actions.onRunQualityTest?.(id)),
      );
    }
    panel.appendChild(testRow);

    // ===== STEP 6: STAGE 1, BOSS & TREASURE TOOLS =====
    this.addSectionTitle(panel, 'STAGE 1 DIRECTOR, BOSS & TREASURE (STEP 6)');

    const statusLine = document.createElement('div');
    statusLine.style.cssText =
      'background:#0f172a;border:1px solid #334155;border-radius:5px;padding:5px 7px;margin-bottom:6px;color:#7dd3fc;font-size:10px;line-height:1.4;';
    statusLine.textContent = 'STATE: PREPARATION';
    panel.appendChild(statusLine);
    this.stageStatusEl = statusLine;

    const waveRow = document.createElement('div');
    waveRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-bottom:6px;';
    for (let w = 0; w < 5; w++) {
      waveRow.appendChild(
        this.makeButton(`W${w + 1}`, w === 4 ? '#991b1b' : '#1e3a8a', () =>
          this.actions.onJumpToWave?.(w),
        ),
      );
    }
    panel.appendChild(waveRow);

    const s6Btns = document.createElement('div');
    s6Btns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;';
    s6Btns.appendChild(this.makeButton('Spawn Elite', '#b45309', () => this.actions.onSpawnBandit('elite')));
    s6Btns.appendChild(this.makeButton('Spawn Boss', '#991b1b', () => this.actions.onSpawnBoss?.()));
    s6Btns.appendChild(this.makeButton('Boss HP -35%', '#7f1d1d', () => this.actions.onDamageBoss?.(0.35)));
    s6Btns.appendChild(this.makeButton('Boss Enraged!', '#dc2626', () => this.actions.onForceBossEnraged?.()));
    s6Btns.appendChild(this.makeButton('Grant Treasure', '#ca8a04', () => this.actions.onGrantNextTreasure?.()));
    s6Btns.appendChild(this.makeButton('Treasure Modal', '#d97706', () => this.actions.onOpenTreasureSelection?.()));
    s6Btns.appendChild(this.makeButton('Reset Upgrades', '#475569', () => this.actions.onResetTemporaryUpgrades?.()));
    s6Btns.appendChild(this.makeButton('Main Menu', '#334155', () => this.actions.onReturnMainMenu?.()));
    s6Btns.appendChild(this.makeButton('Force Victory', '#15803d', () => this.actions.onForceVictory?.()));
    s6Btns.appendChild(this.makeButton('Force Defeat', '#7f1d1d', () => this.actions.onForceDefeat?.()));
    panel.appendChild(s6Btns);

    // ===== STEP 5: PARTY, AI & LOCAL MULTIPLAYER =====
    this.addSectionTitle(panel, 'PARTY, AI & MULTIPLAYER (STEP 5)');

    const s5Btns = document.createElement('div');
    s5Btns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;';
    const partyBtn = this.makeButton('⚔ Party Setup (1~4P) [P]', '#d97706', () => this.actions.onOpenPartySetup());
    partyBtn.style.gridColumn = 'span 2';
    s5Btns.appendChild(partyBtn);

    s5Btns.appendChild(this.makeButton('AI → Human Join', '#0284c7', () => this.actions.onForceAiToHuman()));
    s5Btns.appendChild(this.makeButton('Human → AI Leave', '#475569', () => this.actions.onForceHumanToAi()));
    s5Btns.appendChild(this.makeButton('Sim Pad Disconnect', '#991b1b', () => this.actions.onSimulateGamepadDisconnect()));
    s5Btns.appendChild(this.makeButton('Test 4P Inputs', '#15803d', () => this.actions.onTestFourPlayerInputs()));
    s5Btns.appendChild(this.makeButton('Reset Hero Pos', '#334155', () => this.actions.onResetHeroPositions()));
    s5Btns.appendChild(this.makeButton('Reset Cooldowns', '#7e22ce', () => this.actions.onResetSpecialCooldowns()));
    panel.appendChild(s5Btns);

    // Test Each Hero Special
    const spRow = document.createElement('div');
    spRow.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:8px;';
    spRow.appendChild(this.makeButton('조운 V', '#0284c7', () => this.actions.onTriggerSpecial('zhaoyun')));
    spRow.appendChild(this.makeButton('관우 V', '#16a34a', () => this.actions.onTriggerSpecial('guanyu')));
    spRow.appendChild(this.makeButton('장비 V', '#9333ea', () => this.actions.onTriggerSpecial('zhangfei')));
    spRow.appendChild(this.makeButton('황충 V', '#ca8a04', () => this.actions.onTriggerSpecial('huangzhong')));
    panel.appendChild(spRow);

    // AI Aggression selector
    const aggRow = document.createElement('div');
    aggRow.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';
    const modes: AiAggressionMode[] = ['PASSIVE', 'BALANCED', 'AGGRESSIVE'];
    const modeBtns: HTMLButtonElement[] = [];
    for (const m of modes) {
      const b = this.makeButton(m, m === this.step5.aiAggression ? '#b45309' : '#1e293b', () => {
        this.step5.aiAggression = m;
        modeBtns.forEach((btn, idx) => {
          btn.style.background = modes[idx] === m ? '#b45309' : '#1e293b';
        });
        this.actions.onTuningChanged();
      });
      b.style.flex = '1';
      modeBtns.push(b);
      aggRow.appendChild(b);
    }
    panel.appendChild(aggRow);

    this.addCheckbox(panel, 'Disable AI Companions', () => this.step5.aiDisabled, (v) => {
      this.step5.aiDisabled = v;
    });
    this.addCheckbox(panel, 'Friendly Fire (Co-op Default OFF)', () => this.step5.friendlyFire, (v) => {
      this.step5.friendlyFire = v;
    });
    this.addCheckbox(panel, 'Show Projectile Collisions', () => this.step5.showProjectiles, (v) => {
      this.step5.showProjectiles = v;
    });
    this.addCheckbox(panel, 'Show AI Target & Goals', () => this.step5.showAiGoals, (v) => {
      this.step5.showAiGoals = v;
    });

    // Treasure Hook Modifiers (Step 5 Preview)
    this.addSectionTitle(panel, 'TREASURE HOOK MODIFIERS');
    this.addSlider(panel, 'Hero Damage Mul', 0.5, 2.5, 0.1, () => this.step5.heroDamageMultiplier, (v) => {
      this.step5.heroDamageMultiplier = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Hero Attack Speed', 0.6, 1.8, 0.05, () => this.step5.heroAttackSpeedMultiplier, (v) => {
      this.step5.heroAttackSpeedMultiplier = v;
    }, (v) => `${v.toFixed(2)}x`);
    this.addSlider(panel, 'Huang Zhong +Arrows', 0, 4, 2, () => this.step5.treasureMods.extraSpreadArrows, (v) => {
      this.step5.treasureMods.extraSpreadArrows = Math.round(v);
    }, (v) => `+${Math.round(v)}`);
    this.addSlider(panel, 'Guan Yu Cyclone Size', 0.8, 1.8, 0.1, () => this.step5.treasureMods.cycloneRadiusMul, (v) => {
      this.step5.treasureMods.cycloneRadiusMul = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Zhao Yun +Strikes', 0, 3, 1, () => this.step5.treasureMods.extraStrikes, (v) => {
      this.step5.treasureMods.extraStrikes = Math.round(v);
    }, (v) => `+${Math.round(v)}`);

    // ===== STEP 4 QUICK ACTIONS =====
    this.addSectionTitle(panel, 'STEP 4 AI, CHARGE & CAMERA GAG');
    const s4Btns = document.createElement('div');
    s4Btns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px;';
    s4Btns.appendChild(this.makeButton('Switch Hero [TAB]', '#7e22ce', () => this.actions.onSwitchHero()));
    s4Btns.appendChild(this.makeButton('💥 Camera Gag', '#db2777', () => this.actions.onPreviewCameraGag()));
    s4Btns.appendChild(this.makeButton('😱 Force Panic', '#0284c7', () => this.actions.onForceEnemyPanic()));
    s4Btns.appendChild(this.makeButton('Reset AI States', '#475569', () => this.actions.onResetAiStates()));
    s4Btns.appendChild(this.makeButton('+ Coward', '#0369a1', () => this.actions.onSpawnBandit('coward')));
    s4Btns.appendChild(this.makeButton('+ Elite', '#b45309', () => this.actions.onSpawnBandit('elite')));
    panel.appendChild(s4Btns);

    this.addCheckbox(panel, 'Disable Special Cooldowns', () => this.step4.chargeNoCooldown, (v) => {
      this.step4.chargeNoCooldown = v;
    });
    this.addCheckbox(panel, 'Show Enemy AI State & Fear', () => this.step4.showAiDebug, (v) => {
      this.step4.showAiDebug = v;
    });
    this.addCheckbox(panel, 'Enable Camera Gag', () => this.step4.cameraGagEnabled, (v) => {
      this.step4.cameraGagEnabled = v;
    });

    // ===== STEP 2-3 TUNING & AUDIO =====
    this.addSectionTitle(panel, 'COMBAT, MAYHEM & AUDIO');
    this.addSlider(panel, 'Combat SFX Vol', 0, 1.0, 0.05, () => this.tuning.audioVolume, (v) => {
      this.tuning.audioVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Env SFX Volume', 0, 1.0, 0.05, () => this.mayhem.envSfxVolume, (v) => {
      this.mayhem.envSfxVolume = v;
    }, (v) => `${Math.round(v * 100)}%`);
    this.addSlider(panel, 'Screen Shake', 0, 2.5, 0.1, () => this.tuning.screenShakeIntensity, (v) => {
      this.tuning.screenShakeIntensity = v;
    }, (v) => `${v.toFixed(1)}x`);
    this.addSlider(panel, 'Hit-Stop Scale', 0, 2.5, 0.1, () => this.tuning.hitStopScale, (v) => {
      this.tuning.hitStopScale = v;
    }, (v) => `${v.toFixed(1)}x`);

    this.addCheckbox(panel, 'Show Attack Hitboxes', () => this.tuning.showHitboxes, (v) => {
      this.tuning.showHitboxes = v;
    });
    this.addCheckbox(panel, 'Show Object & Actor Shapes', () => this.mayhem.showObjectShapes, (v) => {
      this.mayhem.showObjectShapes = v;
      this.mayhem.showActorShapes = v;
    });

    // ===== ROOM TOOLS =====
    this.addSectionTitle(panel, 'ARENA SPAWN & RESET');
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;';
    btnRow.appendChild(this.makeButton('+ Table', '#92400e', () => this.actions.onSpawnObject('table')));
    btnRow.appendChild(this.makeButton('+ Water Barrel', '#0284c7', () => this.actions.onSpawnObject('barrel_water')));
    btnRow.appendChild(this.makeButton('+ Group (5)', '#4338ca', () => this.actions.onSpawnBanditGroup()));
    btnRow.appendChild(this.makeButton('Clear Enemies', '#991b1b', () => this.actions.onClearEnemies()));
    btnRow.appendChild(this.makeButton('Reset Env', '#b45309', () => this.actions.onResetEnvironment()));
    btnRow.appendChild(this.makeButton('Reset Room (R)', '#d97706', () => this.actions.onResetRoom()));
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
      'margin:8px 0 5px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);color:#38bdf8;font-weight:bold;font-size:10px;letter-spacing:0.06em;';
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
    input.style.cssText = 'width:100%;accent-color:#38bdf8;cursor:pointer;';
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
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = getter();
    box.style.accentColor = '#38bdf8';
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
