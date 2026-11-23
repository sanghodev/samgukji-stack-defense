import {
  ALL_HERO_IDS,
  HERO_DATA,
  HeroId,
  SlotControlType,
} from '../config/heroConfig';
import { PartyManager } from '../core/PartyManager';
import { IGameSystem } from './ModuleRegistry';

export interface PartySetupCallbacks {
  onApplyParty: () => void;
}

/**
 * Pre-stage & toggleable [P] Flexible Party Setup UI (1 to 4 active heroes).
 * Supports 1H+0AI (Solo), 1H+1..3AI, 2H+0..2AI, 3H+0..1AI, and 4H+0AI.
 * Unused slots remain strictly EMPTY.
 */
export class PartySetupOverlay implements IGameSystem {
  public readonly id = 'party-setup';

  private readonly party: PartyManager;
  private readonly callbacks: PartySetupCallbacks;
  private modal?: HTMLDivElement;
  private slotsContainer?: HTMLDivElement;
  private toastEl?: HTMLDivElement;
  private toastTimer?: number;
  private visible = false;

  constructor(party: PartyManager, callbacks: PartySetupCallbacks) {
    this.party = party;
    this.callbacks = callbacks;
  }

  public init(): void {
    if (typeof document === 'undefined') return;

    // 1. Lightweight non-blocking Join/Leave Toast Banner
    const toast = document.createElement('div');
    toast.style.cssText = [
      'position: fixed',
      'top: 64px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: rgba(15, 23, 42, 0.92)',
      'color: #fde047',
      'border: 1.5px solid #fbbf24',
      'border-radius: 999px',
      'padding: 7px 18px',
      'font-family: Malgun Gothic, Apple SD Gothic Neo, sans-serif',
      'font-size: 13px',
      'font-weight: bold',
      'z-index: 9998',
      'pointer-events: none',
      'display: none',
      'box-shadow: 0 6px 20px rgba(0,0,0,0.5)',
    ].join(';');
    document.body.appendChild(toast);
    this.toastEl = toast;

    // 2. Flexible Party Setup Modal (toggleable via [P] or HUD button)
    const modal = document.createElement('div');
    modal.id = 'party-setup-modal';
    modal.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(8, 11, 18, 0.78)',
      'display: none',
      'align-items: center',
      'justify-content: center',
      'z-index: 10000',
      'font-family: Malgun Gothic, Apple SD Gothic Neo, sans-serif',
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width: min(680px, 94vw)',
      'background: #141822',
      'border: 2px solid #fbbf24',
      'border-radius: 12px',
      'padding: 20px',
      'color: #f8fafc',
      'box-shadow: 0 18px 44px rgba(0,0,0,0.72)',
    ].join(';');

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h2 style="margin:0;font-size:20px;color:#fde047;">⚔ 파티 편성 (1~4인 자유 구성)</h2>
          <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">
            비어있음(EMPTY) 슬롯은 AI로 채워지지 않습니다. 솔로(1인)부터 로컬 4인 협동까지 자유롭게 설정하세요!
          </p>
        </div>
      </div>
    `;

    // Quick Presets Row
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;';
    const presets: Array<{ id: 'SOLO' | 'DUO_AI' | 'FULL_AI' | 'LOCAL_2P' | 'LOCAL_4P'; label: string }> = [
      { id: 'SOLO', label: '1P 솔로 (1H+0AI)' },
      { id: 'DUO_AI', label: '2인 협동 (1H+1AI)' },
      { id: 'FULL_AI', label: '4인 풀파티 (1H+3AI)' },
      { id: 'LOCAL_2P', label: '로컬 2P (2H+0AI)' },
      { id: 'LOCAL_4P', label: '로컬 4P (4H+0AI)' },
    ];
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.textContent = p.label;
      btn.style.cssText =
        'background:#1e293b;color:#e2e8f0;border:1px solid rgba(251,191,36,0.45);border-radius:6px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer;';
      btn.onclick = () => {
        this.party.setPreset(p.id);
        this.renderSlots();
      };
      presetRow.appendChild(btn);
    }
    card.appendChild(presetRow);

    // 4 Party Slots Grid
    const slotsContainer = document.createElement('div');
    slotsContainer.style.cssText =
      'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;';
    card.appendChild(slotsContainer);
    this.slotsContainer = slotsContainer;

    // Start / Apply Button
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const startBtn = document.createElement('button');
    startBtn.textContent = '전장 출격! (적용 & 시작)';
    startBtn.style.cssText =
      'background:#d97706;color:#ffffff;border:1.5px solid #fde047;border-radius:8px;padding:9px 20px;font-size:14px;font-weight:bold;cursor:pointer;';
    startBtn.onclick = () => {
      this.setVisible(false);
      this.callbacks.onApplyParty();
    };
    footer.appendChild(startBtn);
    card.appendChild(footer);

    modal.appendChild(card);
    document.body.appendChild(modal);
    this.modal = modal;
    this.renderSlots();
  }

  public get isOpen(): boolean {
    return this.visible;
  }

  public setVisible(show: boolean): void {
    this.visible = show;
    if (this.modal) {
      this.modal.style.display = show ? 'flex' : 'none';
      if (show) this.renderSlots();
    }
  }

  public toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  public showToast(message: string, durationMs = 2600): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.style.display = 'block';
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.toastEl) this.toastEl.style.display = 'none';
    }, durationMs);
  }

  private renderSlots(): void {
    if (!this.slotsContainer) return;
    this.slotsContainer.innerHTML = '';

    for (const slot of this.party.slots) {
      const box = document.createElement('div');
      const isActive = slot.control !== 'EMPTY' && slot.heroId !== null;
      const hero = slot.heroId ? HERO_DATA[slot.heroId] : null;
      box.style.cssText = [
        'background:#1b2232',
        `border:1.5px solid ${hero ? hero.accentColor : 'rgba(148,163,184,0.28)'}`,
        'border-radius:8px',
        'padding:10px',
      ].join(';');

      const title = document.createElement('div');
      title.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;font-weight:bold;';
      title.innerHTML = `
        <span>SLOT ${slot.slotIndex + 1} ${slot.control === 'HUMAN' ? `(${slot.deviceId === 'keyboard' ? '키보드' : slot.deviceId})` : ''}</span>
        <span style="color:${slot.control === 'HUMAN' ? '#38bdf8' : slot.control === 'AI' ? '#a78bfa' : '#64748b'};">${slot.control}</span>
      `;
      box.appendChild(title);

      // Control Type selector (HUMAN / AI / EMPTY)
      const ctrlRow = document.createElement('div');
      ctrlRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
      const modes: SlotControlType[] = ['HUMAN', 'AI', 'EMPTY'];
      for (const m of modes) {
        const b = document.createElement('button');
        b.textContent = m === 'HUMAN' ? '플레이어' : m === 'AI' ? 'AI 동료' : '비어있음';
        const selected = slot.control === m;
        b.style.cssText = [
          'flex:1',
          `background:${selected ? '#b45309' : '#0f172a'}`,
          `color:${selected ? '#ffffff' : '#94a3b8'}`,
          'border:1px solid rgba(148,163,184,0.3)',
          'border-radius:5px',
          'padding:4px 0',
          'font-size:11px',
          'cursor:pointer',
        ].join(';');
        b.onclick = () => {
          if (m === 'EMPTY') {
            this.party.setSlot(slot.slotIndex, 'EMPTY', null);
          } else {
            const targetHero =
              slot.heroId ?? this.party.getUnassignedHeroes()[0] ?? null;
            if (targetHero) {
              this.party.setSlot(slot.slotIndex, m, targetHero);
            }
          }
          this.renderSlots();
        };
        ctrlRow.appendChild(b);
      }
      box.appendChild(ctrlRow);

      // Hero selector buttons (only when not EMPTY)
      if (isActive) {
        const heroRow = document.createElement('div');
        heroRow.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;';
        for (const hId of ALL_HERO_IDS) {
          const hData = HERO_DATA[hId];
          const isCurrent = slot.heroId === hId;
          const usedElsewhere = this.party.slots.some(
            (other) =>
              other.slotIndex !== slot.slotIndex &&
              other.control !== 'EMPTY' &&
              other.heroId === hId,
          );
          const hb = document.createElement('button');
          hb.textContent = hData.displayName;
          hb.disabled = usedElsewhere;
          hb.style.cssText = [
            `background:${isCurrent ? hData.accentColor : '#0f172a'}`,
            `color:${isCurrent ? '#0f172a' : usedElsewhere ? '#475569' : '#e2e8f0'}`,
            'border:1px solid rgba(148,163,184,0.3)',
            'border-radius:5px',
            'padding:4px 0',
            'font-size:11px',
            'font-weight:bold',
            `cursor:${usedElsewhere ? 'not-allowed' : 'pointer'}`,
          ].join(';');
          hb.onclick = () => {
            this.party.setSlot(slot.slotIndex, slot.control, hId, slot.deviceId);
            this.renderSlots();
          };
          heroRow.appendChild(hb);
        }
        box.appendChild(heroRow);
      } else {
        const emptyHint = document.createElement('div');
        emptyHint.textContent = '비어 있는 슬롯 (출전 안 함)';
        emptyHint.style.cssText =
          'text-align:center;color:#64748b;font-size:11px;padding:6px 0;';
        box.appendChild(emptyHint);
      }

      this.slotsContainer.appendChild(box);
    }
  }

  public destroy(): void {
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.modal?.remove();
    this.toastEl?.remove();
    this.modal = undefined;
    this.toastEl = undefined;
  }
}
