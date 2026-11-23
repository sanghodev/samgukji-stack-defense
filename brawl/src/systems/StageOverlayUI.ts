import { ALL_HERO_IDS, HERO_DATA, HeroId, SlotControlType } from '../config/heroConfig';
import { STAGE_1_INFO } from '../config/stage1Config';
import { TreasureDefinition, TreasureRarity } from '../config/treasureConfig';
import { PartyManager } from '../core/PartyManager';
import { PERMANENT_ABILITY_CATALOG, PersistentSaveData } from '../core/PersistentProgress';
import { RunScoreStats } from '../core/StageDirector';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface StageOverlayCallbacks {
  onStartStage: () => void;
  onIntroFinished: () => void;
  onTreasurePicked: (heroId: HeroId, treasureId: string) => void;
  onAllTreasuresResolved: () => void;
  onRetryStage: () => void;
  onOpenHeroChange: () => void;
  onReturnToMainMenu: () => void;
}

export interface HumanTreasureOffer {
  slotIndex: number;
  heroId: HeroId;
  choices: TreasureDefinition[];
}

export interface VictoryScreenData {
  stats: RunScoreStats;
  heroes: Array<{
    slotIndex: number;
    heroId: HeroId;
    control: SlotControlType;
    treasures: string[];
  }>;
  isNewBestScore: boolean;
  newlyUnlockedId: string | null;
  saveData: Readonly<PersistentSaveData>;
}

const RARITY_COLORS: Record<TreasureRarity, { bg: string; border: string; labelKr: string }> = {
  COMMON: { bg: '#1e293b', border: '#94a3b8', labelKr: '일반' },
  RARE: { bg: '#172554', border: '#38bdf8', labelKr: '희귀' },
  EPIC: { bg: '#3b0764', border: '#c084fc', labelKr: '영웅' },
  LEGENDARY: { bg: '#451a03', border: '#facc15', labelKr: '전설' },
};

function formatTimeMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Clean HTML arcade overlay system for Step 6:
 * Main Menu / Preparation, Skippable Story Intro, Wave/Boss HUD Bar,
 * Multi-Human Treasure Selection, Victory Screen, and Defeat Screen.
 */
export class StageOverlayUI implements IGameSystem {
  public readonly id = 'stage-overlay-ui';

  private readonly party: PartyManager;
  private readonly callbacks: StageOverlayCallbacks;

  private rootEl?: HTMLDivElement;
  private menuModalEl?: HTMLDivElement;
  private introBoxEl?: HTMLDivElement;
  private waveBannerEl?: HTMLDivElement;
  private bossBarEl?: HTMLDivElement;
  private bossHpFillEl?: HTMLDivElement;
  private bossHpTextEl?: HTMLDivElement;
  private bossPhaseTagEl?: HTMLSpanElement;
  private treasureModalEl?: HTMLDivElement;
  private resultModalEl?: HTMLDivElement;
  private scoreToastEl?: HTMLDivElement;

  private introLines: Array<{ speaker: string; color: string; text: string }> = [];
  private introIdx = 0;
  private introTimer?: number;
  private pendingOffers: HumanTreasureOffer[] = [];
  private waveBannerTimer?: number;
  private scoreToastTimer?: number;
  private keyListener?: (e: KeyboardEvent) => void;

  public isBlockingCombat = false;

  constructor(party: PartyManager, callbacks: StageOverlayCallbacks) {
    this.party = party;
    this.callbacks = callbacks;
  }

  public init(_ctx: SystemContext): void {
    const root = document.createElement('div');
    root.id = 'tkm-stage-overlay-root';
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2200',
      'font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
      'user-select:none',
    ].join(';');

    // 1. Top-center Wave / Boss Warning Banner
    const waveBanner = document.createElement('div');
    waveBanner.style.cssText = [
      'position:fixed',
      'top:82px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:linear-gradient(180deg, rgba(28,18,12,0.95), rgba(15,23,42,0.94))',
      'border:2px solid #facc15',
      'border-radius:10px',
      'padding:10px 26px',
      'text-align:center',
      'color:#fff',
      'box-shadow:0 10px 28px rgba(0,0,0,0.65)',
      'display:none',
      'min-width:340px',
    ].join(';');
    root.appendChild(waveBanner);
    this.waveBannerEl = waveBanner;

    // 2. Boss HP Bar (top-center below hero cards)
    const bossBar = document.createElement('div');
    bossBar.style.cssText = [
      'position:fixed',
      'top:74px',
      'left:50%',
      'transform:translateX(-50%)',
      'width:460px',
      'max-width:84vw',
      'background:rgba(28,12,12,0.92)',
      'border:2px solid #ef4444',
      'border-radius:8px',
      'padding:6px 12px',
      'display:none',
      'box-shadow:0 6px 20px rgba(0,0,0,0.6)',
    ].join(';');
    bossBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px;font-weight:700;color:#fecaca;">
        <span>👹 산적 두목 (Bandit Chief) <span data-boss-phase style="margin-left:6px;padding:1px 6px;border-radius:4px;background:#7f1d1d;color:#fde047;font-size:10px;">PHASE B</span></span>
        <span data-boss-hp-txt style="font-family:Consolas,monospace;color:#fde047;">620 / 620</span>
      </div>
      <div style="width:100%;height:12px;background:#1f2937;border-radius:5px;overflow:hidden;border:1px solid #450a0a;">
        <div data-boss-hp-fill style="width:100%;height:100%;background:linear-gradient(90deg,#dc2626,#f97316,#facc15);transition:width 0.12s ease;"></div>
      </div>
    `;
    root.appendChild(bossBar);
    this.bossBarEl = bossBar;
    this.bossHpFillEl = bossBar.querySelector('[data-boss-hp-fill]') as HTMLDivElement;
    this.bossHpTextEl = bossBar.querySelector('[data-boss-hp-txt]') as HTMLDivElement;
    this.bossPhaseTagEl = bossBar.querySelector('[data-boss-phase]') as HTMLSpanElement;

    // 3. Compact Mayhem Score Toast (top-right under combo)
    const scoreToast = document.createElement('div');
    scoreToast.style.cssText = [
      'position:fixed',
      'top:114px',
      'right:18px',
      'background:rgba(15,23,42,0.88)',
      'border:1.5px solid #facc15',
      'border-radius:8px',
      'padding:5px 12px',
      'color:#fde047',
      'font-size:13px',
      'font-weight:800',
      'display:none',
      'box-shadow:0 4px 14px rgba(0,0,0,0.5)',
    ].join(';');
    root.appendChild(scoreToast);
    this.scoreToastEl = scoreToast;

    // 4. Short Story Intro Speech Box (bottom-center)
    const introBox = document.createElement('div');
    introBox.style.cssText = [
      'position:fixed',
      'bottom:54px',
      'left:50%',
      'transform:translateX(-50%)',
      'width:640px',
      'max-width:90vw',
      'background:rgba(15,23,42,0.95)',
      'border:2px solid #facc15',
      'border-radius:12px',
      'padding:14px 20px',
      'color:#f8fafc',
      'pointer-events:auto',
      'display:none',
      'box-shadow:0 12px 32px rgba(0,0,0,0.75)',
    ].join(';');
    root.appendChild(introBox);
    this.introBoxEl = introBox;

    // 5. Main Menu / Stage Preparation Modal
    const menuModal = document.createElement('div');
    menuModal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(9,13,22,0.68)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'pointer-events:auto',
    ].join(';');
    root.appendChild(menuModal);
    this.menuModalEl = menuModal;

    // 6. Treasure Selection Modal
    const treasureModal = document.createElement('div');
    treasureModal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(9,13,22,0.74)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'pointer-events:auto',
    ].join(';');
    root.appendChild(treasureModal);
    this.treasureModalEl = treasureModal;

    // 7. Victory / Defeat Result Modal
    const resultModal = document.createElement('div');
    resultModal.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(9,13,22,0.78)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'pointer-events:auto',
    ].join(';');
    root.appendChild(resultModal);
    this.resultModalEl = resultModal;

    document.body.appendChild(root);
    this.rootEl = root;

    this.keyListener = (e: KeyboardEvent) => {
      if (this.introBoxEl && this.introBoxEl.style.display !== 'none') {
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
          e.preventDefault();
          this.skipIntro();
        }
      }
    };
    window.addEventListener('keydown', this.keyListener);
  }

  // ==================== MAIN MENU / PREPARATION ====================

  public showMainMenu(saveData: Readonly<PersistentSaveData>): void {
    this.hideAllModals();
    if (!this.menuModalEl) return;
    this.isBlockingCombat = true;
    this.menuModalEl.style.display = 'flex';
    this.renderMainMenuContent(saveData);
  }

  private renderMainMenuContent(saveData: Readonly<PersistentSaveData>): void {
    if (!this.menuModalEl) return;
    const activeCount = this.party.activeHeroCount;
    const humanCount = this.party.humanPlayerCount;
    const aiCount = activeCount - humanCount;

    const recordHtml =
      saveData.totalClears > 0
        ? `<div style="font-size:11px;color:#cbd5e1;margin-top:4px;">🏆 최고 기록: <b style="color:#fde047;">${saveData.bestScore.toLocaleString()}점</b> · 최단 클리어: <b style="color:#7dd3fc;">${saveData.fastestClearMs ? formatTimeMs(saveData.fastestClearMs) : '-'}</b> · 클리어 ${saveData.totalClears}회</div>`
        : `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">장안성 외곽 장터를 습격한 산적 무리와 두목을 소탕하세요!</div>`;

    const permHtml =
      saveData.unlockedPermanentAbilities.length > 0
        ? `<div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:#451a03;border:1px solid #f59e0b;color:#fde047;font-size:11px;">🔥 영구 해금 활성: ${saveData.unlockedPermanentAbilities
            .map((id) => PERMANENT_ABILITY_CATALOG.find((a) => a.id === id)?.nameKr ?? id)
            .join(', ')}</div>`
        : '';

    const slotsHtml = this.party.slots
      .map((slot, idx) => {
        const heroOptions = ALL_HERO_IDS.map((hid) => {
          const usedByOther = this.party.slots.some(
            (s) => s.slotIndex !== idx && s.control !== 'EMPTY' && s.heroId === hid,
          );
          const selected = slot.heroId === hid ? 'selected' : '';
          const disabled = usedByOther ? 'disabled' : '';
          return `<option value="${hid}" ${selected} ${disabled}>${HERO_DATA[hid].displayName} (${HERO_DATA[hid].specialName})</option>`;
        }).join('');

        const ctrlBtn = (mode: SlotControlType, label: string) => {
          const active = slot.control === mode;
          const bg = active
            ? mode === 'HUMAN'
              ? '#0284c7'
              : mode === 'AI'
                ? '#16a34a'
                : '#475569'
            : '#1e293b';
          return `<button data-slot-ctrl="${idx}:${mode}" style="flex:1;padding:4px 0;font-size:11px;font-weight:700;border-radius:5px;border:1px solid ${active ? '#facc15' : '#334155'};background:${bg};color:#fff;cursor:pointer;">${label}</button>`;
        };

        const accent = slot.heroId ? HERO_DATA[slot.heroId].accentColor : '#475569';
        return `
          <div style="background:#111827;border:1.5px solid ${accent};border-radius:8px;padding:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:800;color:${accent};">슬롯 ${idx + 1}</span>
              <span style="font-size:10px;color:#94a3b8;">${slot.control === 'HUMAN' ? (slot.deviceId === 'keyboard' ? '키보드' : slot.deviceId) : slot.control === 'AI' ? 'AI 동료' : '비어 있음'}</span>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:6px;">
              ${ctrlBtn('HUMAN', '플레이어')}
              ${ctrlBtn('AI', 'AI')}
              ${idx > 0 ? ctrlBtn('EMPTY', '비움') : ''}
            </div>
            ${
              slot.control !== 'EMPTY'
                ? `<select data-slot-hero="${idx}" style="width:100%;padding:4px 6px;border-radius:5px;background:#1e293b;color:#f8fafc;border:1px solid #475569;font-size:12px;">${heroOptions}</select>`
                : `<div style="font-size:11px;color:#64748b;text-align:center;padding:5px 0;">미참전 (비어 있음)</div>`
            }
          </div>
        `;
      })
      .join('');

    this.menuModalEl.innerHTML = `
      <div style="width:740px;max-width:94vw;background:linear-gradient(180deg,#1c120c,#0f172a);border:2.5px solid #facc15;border-radius:14px;padding:20px 24px;color:#f8fafc;box-shadow:0 20px 55px rgba(0,0,0,0.85);">
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:12px;letter-spacing:2px;color:#f59e0b;font-weight:800;">THREE KINGDOMS MAYHEM · 삼국지 난장판</div>
          <div style="font-size:28px;font-weight:900;color:#fef08a;text-shadow:0 3px 0 #7c2d12;margin-top:2px;">${STAGE_1_INFO.titleKr}</div>
          ${recordHtml}
          ${permHtml}
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:12px;">
          <button data-preset="SOLO" style="padding:5px 10px;border-radius:6px;border:1px solid #64748b;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:700;cursor:pointer;">1인 솔로 (AI 없음)</button>
          <button data-preset="DUO_AI" style="padding:5px 10px;border-radius:6px;border:1px solid #64748b;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:700;cursor:pointer;">2인 협동 (1P+1AI)</button>
          <button data-preset="FULL_AI" style="padding:5px 10px;border-radius:6px;border:1px solid #facc15;background:#1e293b;color:#fde047;font-size:11px;font-weight:700;cursor:pointer;">4인 풀파티 (1P+3AI)</button>
          <button data-preset="LOCAL_2P" style="padding:5px 10px;border-radius:6px;border:1px solid #38bdf8;background:#1e293b;color:#7dd3fc;font-size:11px;font-weight:700;cursor:pointer;">로컬 2P (AI 없음)</button>
          <button data-preset="LOCAL_4P" style="padding:5px 10px;border-radius:6px;border:1px solid #c084fc;background:#1e293b;color:#e9d5ff;font-size:11px;font-weight:700;cursor:pointer;">로컬 4P 전원</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
          ${slotsHtml}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,0.8);border:1px solid #334155;border-radius:8px;padding:8px 14px;margin-bottom:14px;font-size:12px;color:#cbd5e1;">
          <span>현재 출진 인원: <b style="color:#fde047;">총 ${activeCount}명</b> (플레이어 ${humanCount} · AI 동료 ${aiCount})</span>
          <span style="font-size:11px;color:#94a3b8;">WASD 이동 · Z/X 공격 · C 방어 · V/B/N 스킬3종(N:위기탈출!) · SPACE 던지기</span>
        </div>

        <div style="text-align:center;">
          <button data-start-stage style="padding:11px 38px;border-radius:10px;border:2px solid #fef08a;background:linear-gradient(180deg,#d97706,#b45309);color:#fff;font-size:17px;font-weight:900;cursor:pointer;box-shadow:0 6px 20px rgba(217,119,6,0.45);">
            ⚔ 출진! 제1장 시작
          </button>
        </div>
      </div>
    `;

    // Bind events
    this.menuModalEl.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        const p = btn.dataset.preset as 'SOLO' | 'DUO_AI' | 'FULL_AI' | 'LOCAL_2P' | 'LOCAL_4P';
        this.party.setPreset(p);
        this.renderMainMenuContent(saveData);
      };
    });

    this.menuModalEl.querySelectorAll<HTMLButtonElement>('[data-slot-ctrl]').forEach((btn) => {
      btn.onclick = () => {
        const [idxStr, mode] = (btn.dataset.slotCtrl ?? '').split(':');
        const idx = Number(idxStr);
        const ctrl = mode as SlotControlType;
        if (ctrl === 'EMPTY') {
          this.party.setSlot(idx, 'EMPTY', null);
        } else {
          const cur = this.party.slots[idx].heroId ?? this.party.getUnassignedHeroes()[0] ?? null;
          if (cur) this.party.setSlot(idx, ctrl, cur);
        }
        this.renderMainMenuContent(saveData);
      };
    });

    this.menuModalEl.querySelectorAll<HTMLSelectElement>('[data-slot-hero]').forEach((sel) => {
      sel.onchange = () => {
        const idx = Number(sel.dataset.slotHero);
        const heroId = sel.value as HeroId;
        const curCtrl = this.party.slots[idx].control;
        this.party.setSlot(idx, curCtrl === 'EMPTY' ? 'AI' : curCtrl, heroId);
        this.renderMainMenuContent(saveData);
      };
    });

    const startBtn = this.menuModalEl.querySelector<HTMLButtonElement>('[data-start-stage]');
    if (startBtn) {
      startBtn.onclick = () => {
        this.hideAllModals();
        this.callbacks.onStartStage();
      };
    }
  }

  // ==================== SHORT SKIPPABLE STORY INTRO ====================

  public startStoryIntro(activeHeroIds: HeroId[]): void {
    this.hideAllModals();
    if (!this.introBoxEl) {
      this.callbacks.onIntroFinished();
      return;
    }

    this.isBlockingCombat = true;
    const heroSet = new Set(activeHeroIds);
    this.introLines = [
      {
        speaker: '마을 주민',
        color: '#fde047',
        text: '큰일 났어요! 산적들이 장안성 외곽 장터를 습격했어요!',
      },
    ];

    if (heroSet.has('zhangfei')) {
      this.introLines.push({
        speaker: '장비',
        color: '#c084fc',
        text: '뭐라고?! 이놈들, 테이블째로 혼쭐을 내주마!',
      });
    }
    if (heroSet.has('guanyu')) {
      this.introLines.push({
        speaker: '관우',
        color: '#4ade80',
        text: '흥, 감히 백성들을 괴롭히다니. 청룡언월도로 단숨에 쓸어버리겠다.',
      });
    }
    if (heroSet.has('huangzhong')) {
      this.introLines.push({
        speaker: '황충',
        color: '#facc15',
        text: '하하! 노장의 활솜씨를 똑똑히 보여주지!',
      });
    }
    if (heroSet.has('zhaoyun')) {
      this.introLines.push({
        speaker: '조운',
        color: '#38bdf8',
        text: '모두 조심하십시오. 제가 앞장서서 산적들을 제압하겠습니다!',
      });
    }

    // Keep intro crisp (max 3 lines, ~6 seconds total)
    this.introLines = this.introLines.slice(0, 3);
    this.introIdx = 0;
    this.introBoxEl.style.display = 'block';
    this.renderCurrentIntroLine();
  }

  private renderCurrentIntroLine(): void {
    if (!this.introBoxEl) return;
    const line = this.introLines[this.introIdx];
    if (!line) {
      this.skipIntro();
      return;
    }
    this.introBoxEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:14px;font-weight:900;color:${line.color};">💬 ${line.speaker}</span>
        <button data-skip-intro style="padding:3px 10px;border-radius:6px;border:1px solid #64748b;background:#1e293b;color:#cbd5e1;font-size:11px;cursor:pointer;">건너뛰기 (SPACE)</button>
      </div>
      <div style="font-size:16px;font-weight:700;line-height:1.45;color:#f8fafc;">"${line.text}"</div>
    `;
    const skipBtn = this.introBoxEl.querySelector<HTMLButtonElement>('[data-skip-intro]');
    if (skipBtn) skipBtn.onclick = () => this.skipIntro();

    window.clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => {
      this.introIdx += 1;
      if (this.introIdx >= this.introLines.length) {
        this.skipIntro();
      } else {
        this.renderCurrentIntroLine();
      }
    }, 2200);
  }

  public skipIntro(): void {
    window.clearTimeout(this.introTimer);
    if (this.introBoxEl) this.introBoxEl.style.display = 'none';
    this.isBlockingCombat = false;
    this.callbacks.onIntroFinished();
  }

  // ==================== WAVE BANNER, BOSS BAR & SCORE TOAST ====================

  public showWaveBanner(titleKr: string, subtitleKr: string, isWarning = false): void {
    if (!this.waveBannerEl) return;
    this.waveBannerEl.style.borderColor = isWarning ? '#ef4444' : '#facc15';
    this.waveBannerEl.innerHTML = `
      <div style="font-size:19px;font-weight:900;color:${isWarning ? '#fca5a5' : '#fef08a'};">${titleKr}</div>
      <div style="font-size:12px;color:#e2e8f0;margin-top:3px;">${subtitleKr}</div>
    `;
    this.waveBannerEl.style.display = 'block';
    window.clearTimeout(this.waveBannerTimer);
    this.waveBannerTimer = window.setTimeout(() => {
      if (this.waveBannerEl) this.waveBannerEl.style.display = 'none';
    }, 2400);
  }

  public updateBossBar(visible: boolean, hp: number, maxHp: number, isEnraged: boolean): void {
    if (!this.bossBarEl || !this.bossHpFillEl || !this.bossHpTextEl || !this.bossPhaseTagEl) return;
    if (!visible) {
      this.bossBarEl.style.display = 'none';
      return;
    }
    this.bossBarEl.style.display = 'block';
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.bossHpFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.bossHpTextEl.textContent = `${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`;
    this.bossPhaseTagEl.textContent = isEnraged ? '🔥 광분 (ENRAGED)' : '전투 중';
    this.bossPhaseTagEl.style.background = isEnraged ? '#dc2626' : '#7f1d1d';
  }

  public showScoreToast(textKr: string): void {
    if (!this.scoreToastEl) return;
    this.scoreToastEl.textContent = textKr;
    this.scoreToastEl.style.display = 'block';
    window.clearTimeout(this.scoreToastTimer);
    this.scoreToastTimer = window.setTimeout(() => {
      if (this.scoreToastEl) this.scoreToastEl.style.display = 'none';
    }, 1500);
  }

  // ==================== TREASURE SELECTION MODAL ====================

  public openTreasureSelection(offers: HumanTreasureOffer[]): void {
    if (!this.treasureModalEl || offers.length === 0) {
      this.callbacks.onAllTreasuresResolved();
      return;
    }
    this.pendingOffers = [...offers];
    this.isBlockingCombat = true;
    this.treasureModalEl.style.display = 'flex';
    this.renderNextTreasureOffer();
  }

  private renderNextTreasureOffer(): void {
    if (!this.treasureModalEl) return;
    const offer = this.pendingOffers[0];
    if (!offer) {
      this.treasureModalEl.style.display = 'none';
      this.isBlockingCombat = false;
      this.callbacks.onAllTreasuresResolved();
      return;
    }

    const hero = HERO_DATA[offer.heroId];
    const cardsHtml = offer.choices
      .map((tr) => {
        const rc = RARITY_COLORS[tr.rarity];
        return `
          <button data-pick-treasure="${tr.id}" style="flex:1;text-align:left;background:${rc.bg};border:2px solid ${rc.border};border-radius:10px;padding:14px;color:#f8fafc;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:transform 0.1s;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:28px;">${tr.icon}</span>
              <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(0,0,0,0.45);border:1px solid ${rc.border};color:${rc.border};">${rc.labelKr}${tr.tier > 0 ? ` · ${tr.tier}단계` : ''}</span>
            </div>
            <div style="font-size:16px;font-weight:900;color:#fef08a;">${tr.nameKr}</div>
            <div style="font-size:12px;line-height:1.45;color:#e2e8f0;flex:1;">${tr.shortEffectKr}</div>
            <div style="font-size:11px;font-weight:700;color:#7dd3fc;background:rgba(15,23,42,0.7);padding:5px 8px;border-radius:6px;">${tr.comparisonKr}</div>
          </button>
        `;
      })
      .join('');

    this.treasureModalEl.innerHTML = `
      <div style="width:740px;max-width:94vw;background:linear-gradient(180deg,#1c120c,#0f172a);border:2.5px solid #facc15;border-radius:14px;padding:18px 22px;color:#fff;box-shadow:0 20px 55px rgba(0,0,0,0.85);">
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:800;color:${hero.accentColor};">P${offer.slotIndex + 1} · ${hero.displayName} (${hero.roleLabelKr})</div>
          <div style="font-size:24px;font-weight:900;color:#fef08a;">✨ 보물 획득! 능력을 선택하세요</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;">AI 동료는 전투에 최적화된 보물을 자동으로 선택합니다.</div>
        </div>
        <div style="display:flex;gap:12px;">
          ${cardsHtml}
        </div>
      </div>
    `;

    this.treasureModalEl.querySelectorAll<HTMLButtonElement>('[data-pick-treasure]').forEach((btn) => {
      btn.onclick = () => {
        const tid = btn.dataset.pickTreasure!;
        this.pendingOffers.shift();
        this.callbacks.onTreasurePicked(offer.heroId, tid);
        this.renderNextTreasureOffer();
      };
    });
  }

  // ==================== VICTORY & DEFEAT SCREENS ====================

  public showVictoryScreen(data: VictoryScreenData): void {
    this.hideAllModals();
    if (!this.resultModalEl) return;
    this.isBlockingCombat = true;
    this.resultModalEl.style.display = 'flex';

    const heroListHtml = data.heroes
      .map((h) => {
        const p = HERO_DATA[h.heroId];
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;background:#1e293b;border:1px solid ${p.accentColor};font-size:12px;"><b style="color:${p.accentColor};">[${h.control === 'HUMAN' ? `P${h.slotIndex + 1}` : 'AI'}] ${p.displayName}</b> <span style="color:#94a3b8;font-size:11px;">보물 ${h.treasures.length}개</span></span>`;
      })
      .join(' ');

    const unlockBanner = data.newlyUnlockedId
      ? `<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:#451a03;border:1.5px solid #f59e0b;color:#fef08a;font-size:12px;font-weight:700;">🔥 신규 영구 능력 해금! [${PERMANENT_ABILITY_CATALOG.find((a) => a.id === data.newlyUnlockedId)?.nameKr ?? data.newlyUnlockedId}]</div>`
      : '';

    this.resultModalEl.innerHTML = `
      <div style="width:620px;max-width:94vw;background:linear-gradient(180deg,#2a1608,#0f172a);border:3px solid #facc15;border-radius:16px;padding:22px 26px;color:#f8fafc;box-shadow:0 24px 60px rgba(0,0,0,0.9);text-align:center;">
        <div style="font-size:12px;letter-spacing:2px;color:#f59e0b;font-weight:800;">STAGE 1 COMPLETE</div>
        <div style="font-size:32px;font-weight:900;color:#fef08a;text-shadow:0 3px 0 #7c2d12;margin:2px 0 8px;">🏆 제1장 클리어!</div>
        <div style="margin-bottom:12px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">${heroListHtml}</div>

        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;text-align:left;background:rgba(15,23,42,0.82);border:1px solid #334155;border-radius:10px;padding:12px 16px;font-size:13px;">
          <div>총점: <b style="color:#fde047;">${data.stats.totalScore.toLocaleString()}점</b> ${data.isNewBestScore ? '<span style="color:#4ade80;font-size:11px;">NEW!</span>' : ''}</div>
          <div>클리어 시간: <b style="color:#7dd3fc;">${formatTimeMs(data.stats.clearTimeMs)}</b></div>
          <div>제압 / 항복: <b style="color:#f8fafc;">${data.stats.enemiesDefeated} / ${data.stats.enemiesSurrendered}명</b></div>
          <div>최고 콤보: <b style="color:#38bdf8;">${data.stats.highestCombo} HIT</b></div>
          <div>최장 연쇄 충돌: <b style="color:#c084fc;">${data.stats.longestChain}연쇄</b></div>
          <div>파괴한 기물: <b style="color:#fb923c;">${data.stats.objectsDestroyed}개</b></div>
        </div>

        <div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(30,41,59,0.85);border:1px solid #475569;font-size:12px;color:#fde047;">
          🌟 베스트 모먼트: ${data.stats.bestMomentKr}
        </div>
        ${unlockBanner}

        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
          <button data-res-retry style="padding:9px 18px;border-radius:8px;border:1.5px solid #fef08a;background:#b45309;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">🔄 다시 도전</button>
          <button data-res-hero style="padding:9px 16px;border-radius:8px;border:1px solid #38bdf8;background:#0369a1;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">⚔ 영웅 변경</button>
          <button data-res-menu style="padding:9px 16px;border-radius:8px;border:1px solid #64748b;background:#334155;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">🏠 메인 메뉴</button>
          <button disabled title="다음 장은 추후 업데이트 예정입니다" style="padding:9px 16px;border-radius:8px;border:1px dashed #475569;background:#1e293b;color:#64748b;font-size:13px;font-weight:700;cursor:not-allowed;">🔒 다음 장 — 준비 중</button>
        </div>
      </div>
    `;

    this.bindResultButtons();
  }

  public showDefeatScreen(stats: RunScoreStats): void {
    this.hideAllModals();
    if (!this.resultModalEl) return;
    this.isBlockingCombat = true;
    this.resultModalEl.style.display = 'flex';

    this.resultModalEl.innerHTML = `
      <div style="width:480px;max-width:92vw;background:linear-gradient(180deg,#2a0d0d,#0f172a);border:2.5px solid #ef4444;border-radius:14px;padding:22px 26px;color:#f8fafc;box-shadow:0 20px 55px rgba(0,0,0,0.9);text-align:center;">
        <div style="font-size:30px;font-weight:900;color:#fca5a5;margin-bottom:6px;">💀 전원 쓰러짐...</div>
        <div style="font-size:13px;color:#cbd5e1;margin-bottom:14px;">산적들의 공세를 막아내지 못했습니다. 다시 도전해 보세요!</div>
        <div style="background:rgba(15,23,42,0.8);border:1px solid #334155;border-radius:8px;padding:10px;font-size:13px;margin-bottom:16px;">
          점수 <b style="color:#fde047;">${stats.totalScore.toLocaleString()}점</b> · 제압 <b>${stats.enemiesDefeated}명</b> · 최고 콤보 <b>${stats.highestCombo} HIT</b>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button data-res-retry style="padding:9px 20px;border-radius:8px;border:1.5px solid #fef08a;background:#b45309;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">🔄 다시 도전</button>
          <button data-res-hero style="padding:9px 16px;border-radius:8px;border:1px solid #38bdf8;background:#0369a1;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">⚔ 영웅 변경</button>
          <button data-res-menu style="padding:9px 16px;border-radius:8px;border:1px solid #64748b;background:#334155;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">🏠 메인 메뉴</button>
        </div>
      </div>
    `;

    this.bindResultButtons();
  }

  private bindResultButtons(): void {
    if (!this.resultModalEl) return;
    const retry = this.resultModalEl.querySelector<HTMLButtonElement>('[data-res-retry]');
    const hero = this.resultModalEl.querySelector<HTMLButtonElement>('[data-res-hero]');
    const menu = this.resultModalEl.querySelector<HTMLButtonElement>('[data-res-menu]');
    if (retry) {
      retry.onclick = () => {
        this.hideAllModals();
        this.callbacks.onRetryStage();
      };
    }
    if (hero) {
      hero.onclick = () => {
        this.hideAllModals();
        this.callbacks.onOpenHeroChange();
      };
    }
    if (menu) {
      menu.onclick = () => {
        this.hideAllModals();
        this.callbacks.onReturnToMainMenu();
      };
    }
  }

  public hideAllModals(): void {
    window.clearTimeout(this.introTimer);
    if (this.menuModalEl) this.menuModalEl.style.display = 'none';
    if (this.introBoxEl) this.introBoxEl.style.display = 'none';
    if (this.treasureModalEl) this.treasureModalEl.style.display = 'none';
    if (this.resultModalEl) this.resultModalEl.style.display = 'none';
    this.isBlockingCombat = false;
  }

  public destroy(): void {
    window.clearTimeout(this.introTimer);
    window.clearTimeout(this.waveBannerTimer);
    window.clearTimeout(this.scoreToastTimer);
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = undefined;
    }
    this.rootEl?.remove();
    this.rootEl = undefined;
  }
}
