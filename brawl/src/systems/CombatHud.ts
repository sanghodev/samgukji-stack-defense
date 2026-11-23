import Phaser from 'phaser';
import { DEPTH_LAYERS, GAME_HEIGHT, GAME_WIDTH } from '../config/arenaConfig';
import { HERO_DATA, HeroId, SlotControlType } from '../config/heroConfig';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface HeroHudCardData {
  slotIndex: number;
  heroId: HeroId;
  control: SlotControlType;
  hp: number;
  maxHp: number;
  specialReadyRatio: number;
  isDefeated: boolean;
  treasureCount?: number;
}

export interface CombatHudSnapshot {
  heroes: HeroHudCardData[];
  allHumansDefeated: boolean;
  enemiesActive: number;
  enemiesNeutralized: number;
  enemiesSurrendered: number;
  comboHits: number;
  waveNumber?: number;
  totalWaves?: number;
  score?: number;
  suppressBuiltInDefeat?: boolean;
}

interface HeroCardNodes {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  spBar: Phaser.GameObjects.Graphics;
  spText: Phaser.GameObjects.Text;
}

/**
 * Dynamic 1-to-4 Hero Party HUD for Step 5:
 * Renders compact HP & [V] Special cards ONLY for active heroes (unused slots remain hidden!).
 */
export class CombatHud implements IGameSystem {
  public readonly id = 'combat-hud';

  private readonly heroCards: HeroCardNodes[] = [];
  private counterText?: Phaser.GameObjects.Text;
  private comboText?: Phaser.GameObjects.Text;
  private statusOverlay?: Phaser.GameObjects.Container;
  private statusTitle?: Phaser.GameObjects.Text;
  private statusSub?: Phaser.GameObjects.Text;
  private readonly onRestart: () => void;
  private readonly onOpenPartySetup: () => void;

  private lastComboShown = 0;
  private rejectFlashMs = 0;

  constructor(onRestart: () => void, onOpenPartySetup: () => void) {
    this.onRestart = onRestart;
    this.onOpenPartySetup = onOpenPartySetup;
  }

  public flashSpecialRejected(): void {
    this.rejectFlashMs = 240;
  }

  public init(ctx: SystemContext): void {
    const { scene } = ctx;

    // 1. Pre-create 4 compact Hero Party Cards along top-left (only active heroes are shown!)
    const cardW = 196;
    const cardH = 56;
    for (let i = 0; i < 4; i++) {
      const cx = 12 + i * (cardW + 8);
      const cy = 12;
      const bg = scene.add.graphics();
      const nameText = scene.add.text(8, 5, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
      });
      const hpBar = scene.add.graphics();
      const hpText = scene.add
        .text(cardW - 8, 5, '', {
          fontFamily: 'Consolas, Menlo, monospace',
          fontSize: '10px',
          color: '#e2e8f0',
        })
        .setOrigin(1, 0);
      const spBar = scene.add.graphics();
      const spText = scene.add.text(8, 38, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fde047',
      });

      const container = scene.add
        .container(cx, cy, [bg, nameText, hpBar, hpText, spBar, spText])
        .setDepth(DEPTH_LAYERS.HUD)
        .setVisible(false);

      this.heroCards.push({ container, bg, nameText, hpBar, hpText, spBar, spText });
    }

    // 2. Top-right Party Setup button + Title + Counter
    const badgeW = 244;
    const bx = GAME_WIDTH - badgeW - 12;
    const titleBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    titleBg.fillStyle(0x1c120c, 0.84);
    titleBg.fillRoundedRect(bx, 12, badgeW, 56, 6);
    titleBg.lineStyle(1.5, 0xfbbf24, 0.72);
    titleBg.strokeRoundedRect(bx, 12, badgeW, 56, 6);

    this.counterText = scene.add
      .text(bx + badgeW / 2, 24, '제압: 0 | 항복: 0 | 산적: 12', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    const partyBtn = scene.add
      .rectangle(bx + badgeW / 2, 50, 186, 22, 0x1e293b, 0.95)
      .setStrokeStyle(1, 0xfbbf24, 0.8)
      .setDepth(DEPTH_LAYERS.HUD + 1)
      .setInteractive({ useHandCursor: true });
    const partyBtnTxt = scene.add
      .text(bx + badgeW / 2, 50, '⚔ 파티 편성 1~4인 (P)', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 2);

    partyBtn.on('pointerover', () => partyBtn.setFillStyle(0x334155));
    partyBtn.on('pointerout', () => partyBtn.setFillStyle(0x1e293b));
    partyBtn.on('pointerdown', () => this.onOpenPartySetup());
    void partyBtnTxt;

    // 3. Combo Hit Counter
    this.comboText = scene.add
      .text(GAME_WIDTH - 20, 76, '', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#7dd3fc',
        stroke: '#1c120c',
        strokeThickness: 5,
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH_LAYERS.HUD + 2)
      .setVisible(false);

    // 4. Bottom-right controls legend
    const hintW = 810;
    const hintX = GAME_WIDTH - hintW - 12;
    const hintBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hintBg.fillStyle(0x0b101b, 0.84);
    hintBg.fillRoundedRect(hintX, GAME_HEIGHT - 32, hintW, 24, 5);
    hintBg.lineStyle(1, 0x94a3b8, 0.35);
    hintBg.strokeRoundedRect(hintX, GAME_HEIGHT - 32, hintW, 24, 5);

    scene.add
      .text(
        hintX + hintW / 2,
        GAME_HEIGHT - 20,
        'WASD: 이동 · Z: 콤보 · X: 강공격 · C/Shift: 방어 · V: 필살기 · SPACE: 잡기/던지기 · TAB: 교대 · P: 파티(1~4인) · F2: 디버그',
        {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
          fontSize: '10.5px',
          color: '#e2e8f0',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 5. Center Defeat Banner
    const dim = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.45);
    const card = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 168, 0x1c120c, 0.94);
    card.setStrokeStyle(2, 0xfbbf24, 0.9);

    this.statusTitle = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '전원 쓰러짐!', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#ef4444',
      })
      .setOrigin(0.5);

    this.statusSub = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 2, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '14px',
        color: '#e2e8f0',
      })
      .setOrigin(0.5);

    const btnBg = scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 46, 170, 36, 0xb45309, 1)
      .setStrokeStyle(1.5, 0xfde047, 0.9)
      .setInteractive({ useHandCursor: true });
    const btnText = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 46, '다시 시작 (R)', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    btnBg.on('pointerover', () => btnBg.setFillStyle(0xd97706));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0xb45309));
    btnBg.on('pointerdown', () => this.onRestart());

    this.statusOverlay = scene.add
      .container(0, 0, [dim, card, this.statusTitle, this.statusSub, btnBg, btnText])
      .setDepth(DEPTH_LAYERS.HUD + 20)
      .setVisible(false);
  }

  public render(snap: CombatHudSnapshot, scene: Phaser.Scene, deltaMs: number): void {
    if (this.rejectFlashMs > 0) {
      this.rejectFlashMs = Math.max(0, this.rejectFlashMs - deltaMs);
    }

    const cardW = 196;
    const cardH = 56;

    for (let i = 0; i < 4; i++) {
      const node = this.heroCards[i];
      const data = snap.heroes[i];
      if (!data) {
        node.container.setVisible(false);
        continue;
      }

      const prof = HERO_DATA[data.heroId];
      node.container.setVisible(true);

      node.bg.clear();
      node.bg.fillStyle(0x141822, data.isDefeated ? 0.55 : 0.86);
      node.bg.fillRoundedRect(0, 0, cardW, cardH, 6);
      node.bg.lineStyle(
        data.control === 'HUMAN' ? 2 : 1,
        prof.accentHex,
        data.control === 'HUMAN' ? 0.92 : 0.5,
      );
      node.bg.strokeRoundedRect(0, 0, cardW, cardH, 6);

      const tag = data.control === 'HUMAN' ? `P${data.slotIndex + 1}` : 'AI';
      const trBadge = data.treasureCount && data.treasureCount > 0 ? ` ★${data.treasureCount}` : '';
      node.nameText.setText(`[${tag}] ${prof.displayName}${trBadge}`);
      node.nameText.setColor(prof.accentColor);
      node.hpText.setText(`${data.hp}/${data.maxHp}`);

      // HP bar
      const hpRatio = Phaser.Math.Clamp(data.hp / Math.max(1, data.maxHp), 0, 1);
      node.hpBar.clear();
      node.hpBar.fillStyle(0x0f172a, 1);
      node.hpBar.fillRoundedRect(8, 22, cardW - 16, 11, 3);
      if (hpRatio > 0) {
        node.hpBar.fillStyle(hpRatio > 0.3 ? 0x22c55e : 0xef4444, 1);
        node.hpBar.fillRoundedRect(8, 22, Math.max(4, Math.round((cardW - 16) * hpRatio)), 11, 3);
      }

      // Special bar
      const spReady = data.specialReadyRatio >= 1;
      node.spBar.clear();
      node.spBar.fillStyle(0x0f172a, 1);
      node.spBar.fillRoundedRect(98, 40, cardW - 106, 9, 3);
      if (data.specialReadyRatio > 0) {
        const spCol = this.rejectFlashMs > 0 && data.control === 'HUMAN' ? 0xef4444 : spReady ? prof.accentHex : 0x475569;
        node.spBar.fillStyle(spCol, 1);
        node.spBar.fillRoundedRect(
          98,
          40,
          Math.max(3, Math.round((cardW - 106) * data.specialReadyRatio)),
          9,
          3,
        );
      }
      node.spText.setText(spReady ? `${prof.specialName} OK` : prof.specialName);
      node.spText.setColor(spReady ? '#fde047' : '#94a3b8');
    }

    const waveStr = snap.waveNumber ? `W${snap.waveNumber}/${snap.totalWaves ?? 5} · ` : '';
    const scoreStr = snap.score !== undefined ? `${snap.score.toLocaleString()}점 · ` : '';
    this.counterText?.setText(`${waveStr}${scoreStr}적:${snap.enemiesActive}`);

    if (this.comboText) {
      if (snap.comboHits >= 2) {
        this.comboText.setVisible(true);
        this.comboText.setText(`${snap.comboHits} HIT!`);
        this.comboText.setColor(snap.comboHits >= 5 ? '#fde047' : '#7dd3fc');
        if (snap.comboHits > this.lastComboShown) {
          scene.tweens.killTweensOf(this.comboText);
          this.comboText.setScale(1.25);
          scene.tweens.add({
            targets: this.comboText,
            scale: 1,
            duration: 120,
            ease: 'Back.easeOut',
          });
        }
      } else {
        this.comboText.setVisible(false);
      }
      this.lastComboShown = snap.comboHits;
    }

    if (this.statusOverlay && this.statusSub) {
      const showOld = snap.allHumansDefeated && !snap.suppressBuiltInDefeat;
      this.statusOverlay.setVisible(showOld);
      if (showOld) {
        this.statusSub.setText(`제압한 산적: ${snap.enemiesNeutralized}명 · R 키로 즉시 재시작`);
      }
    }
  }

  public destroy(): void {
    this.statusOverlay?.destroy(true);
    for (const c of this.heroCards) c.container.destroy(true);
    this.heroCards.length = 0;
    this.counterText?.destroy();
    this.comboText?.destroy();
  }
}
