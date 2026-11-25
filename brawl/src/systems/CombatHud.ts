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
  skill2ReadyRatio?: number;
  skill3ReadyRatio?: number;
  isLowHpEmergency?: boolean;
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
  isMuted?: boolean;
  hideBottomHint?: boolean;
  suppressBuiltInDefeat?: boolean;
}

interface HeroCardNodes {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  spBar: Phaser.GameObjects.Graphics;
  s1Text: Phaser.GameObjects.Text;
  s2Text: Phaser.GameObjects.Text;
  s3Text: Phaser.GameObjects.Text;
}

/**
 * Dynamic 1-to-4 Hero Party HUD:
 * Renders compact HP & 3-Skill ([V], [B], [N] Emergency Escape) cards ONLY for active heroes!
 */
export class CombatHud implements IGameSystem {
  public readonly id = 'combat-hud';

  private readonly heroCards: HeroCardNodes[] = [];
  private counterText?: Phaser.GameObjects.Text;
  private muteBtnText?: Phaser.GameObjects.Text;
  private comboText?: Phaser.GameObjects.Text;
  private bottomHintContainer?: Phaser.GameObjects.Container;
  private statusOverlay?: Phaser.GameObjects.Container;
  private statusTitle?: Phaser.GameObjects.Text;
  private statusSub?: Phaser.GameObjects.Text;
  private readonly onRestart: () => void;
  private readonly onOpenPartySetup: () => void;
  private readonly onTogglePause?: () => void;
  private readonly onToggleMute?: () => void;

  private lastComboShown = 0;
  private rejectFlashMs = 0;

  constructor(
    onRestart: () => void,
    onOpenPartySetup: () => void,
    onTogglePause?: () => void,
    onToggleMute?: () => void,
  ) {
    this.onRestart = onRestart;
    this.onOpenPartySetup = onOpenPartySetup;
    this.onTogglePause = onTogglePause;
    this.onToggleMute = onToggleMute;
  }

  public flashSpecialRejected(): void {
    this.rejectFlashMs = 240;
  }

  public init(ctx: SystemContext): void {
    const { scene } = ctx;

    // 1. Pre-create 4 compact Hero Party Cards along top-left (only active heroes are shown!)
    const cardW = 212;
    const cardH = 66;
    for (let i = 0; i < 4; i++) {
      const cx = 12 + i * (cardW + 8);
      const cy = 10;
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
      const s1Text = scene.add.text(10, 36, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#fde047',
      });
      const s2Text = scene.add.text(78, 36, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#7dd3fc',
      });
      const s3Text = scene.add.text(146, 36, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#fb923c',
      });

      const container = scene.add
        .container(cx, cy, [bg, nameText, hpBar, hpText, spBar, s1Text, s2Text, s3Text])
        .setDepth(DEPTH_LAYERS.HUD)
        .setVisible(false);

      this.heroCards.push({ container, bg, nameText, hpBar, hpText, spBar, s1Text, s2Text, s3Text });
    }
    void cardH;

    // 2. Top-right Stage Score + Quick Arcade Controls (Party [P] · Mute [M] · Pause [ESC])
    const badgeW = 264;
    const bx = GAME_WIDTH - badgeW - 12;
    const titleBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    titleBg.fillStyle(0x1c120c, 0.88);
    titleBg.fillRoundedRect(bx, 10, badgeW, 56, 6);
    titleBg.lineStyle(1.5, 0xfbbf24, 0.76);
    titleBg.strokeRoundedRect(bx, 10, badgeW, 56, 6);

    this.counterText = scene.add
      .text(bx + badgeW / 2, 22, 'W1/5 · 0점 · 적:0', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    const makeHudBtn = (
      centerX: number,
      width: number,
      label: string,
      color: string,
      onClick: () => void,
    ): Phaser.GameObjects.Text => {
      const rect = scene.add
        .rectangle(centerX, 48, width, 22, 0x1e293b, 0.95)
        .setStrokeStyle(1, 0xfbbf24, 0.78)
        .setDepth(DEPTH_LAYERS.HUD + 1)
        .setInteractive({ useHandCursor: true });
      const txt = scene.add
        .text(centerX, 48, label, {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
          fontSize: '10.5px',
          fontStyle: 'bold',
          color,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_LAYERS.HUD + 2);
      rect.on('pointerover', () => rect.setFillStyle(0x334155));
      rect.on('pointerout', () => rect.setFillStyle(0x1e293b));
      rect.on('pointerdown', () => onClick());
      return txt;
    };

    makeHudBtn(bx + 62, 108, '⚔ 파티 (P)', '#fde047', () => this.onOpenPartySetup());
    this.muteBtnText = makeHudBtn(bx + 144, 44, '🔊', '#7dd3fc', () => this.onToggleMute?.());
    makeHudBtn(bx + 214, 82, '⏸ 메뉴 (ESC)', '#f8fafc', () => this.onTogglePause?.());

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

    // 4. Bottom-right controls legend (auto-hides when mobile touch pad is active)
    const hintW = 948;
    const hintX = GAME_WIDTH - hintW - 12;
    const hintBg = scene.add.graphics();
    hintBg.fillStyle(0x0b101b, 0.86);
    hintBg.fillRoundedRect(hintX, GAME_HEIGHT - 32, hintW, 24, 5);
    hintBg.lineStyle(1, 0x94a3b8, 0.35);
    hintBg.strokeRoundedRect(hintX, GAME_HEIGHT - 32, hintW, 24, 5);

    const hintTxt = scene.add
      .text(
        hintX + hintW / 2,
        GAME_HEIGHT - 20,
        'WASD/방향키: 이동 · Z(J): 연타 · X(K): 강타 · C(L): 방어 · V/B/N(1·2·3): 스킬3종(N:위기탈출!) · SPACE: 던지기 · TAB: 교대 · ESC: 일시정지',
        {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
          fontSize: '10.5px',
          color: '#e2e8f0',
        },
      )
      .setOrigin(0.5);

    this.bottomHintContainer = scene.add
      .container(0, 0, [hintBg, hintTxt])
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

    const cardW = 212;
    const cardH = 66;
    const nowPulse = Math.floor(performance.now() / 220) % 2 === 0;

    for (let i = 0; i < 4; i++) {
      const node = this.heroCards[i];
      const data = snap.heroes[i];
      if (!data) {
        node.container.setVisible(false);
        continue;
      }

      const prof = HERO_DATA[data.heroId];
      const s1Ratio = data.specialReadyRatio;
      const s2Ratio = data.skill2ReadyRatio ?? 1;
      const s3Ratio = data.skill3ReadyRatio ?? 1;
      const emergencyReady = Boolean(data.isLowHpEmergency && s3Ratio >= 1);

      node.container.setVisible(true);

      node.bg.clear();
      node.bg.fillStyle(0x141822, data.isDefeated ? 0.55 : 0.88);
      node.bg.fillRoundedRect(0, 0, cardW, cardH, 6);
      const borderCol = emergencyReady && nowPulse ? 0xfacc15 : prof.accentHex;
      node.bg.lineStyle(
        emergencyReady ? 2.5 : data.control === 'HUMAN' ? 2 : 1,
        borderCol,
        emergencyReady ? 1 : data.control === 'HUMAN' ? 0.92 : 0.5,
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
      node.hpBar.fillRoundedRect(8, 21, cardW - 16, 10, 3);
      if (hpRatio > 0) {
        node.hpBar.fillStyle(hpRatio > 0.35 ? 0x22c55e : 0xef4444, 1);
        node.hpBar.fillRoundedRect(8, 21, Math.max(4, Math.round((cardW - 16) * hpRatio)), 10, 3);
      }

      // 3-Skill compact gauge row ([V] Skill 1 · [B] Skill 2 · [N] Emergency Escape Ultimate!)
      node.spBar.clear();
      const segW = 62;
      const drawSeg = (x: number, ratio: number, readyHex: number, isEmerg = false) => {
        node.spBar.fillStyle(0x0f172a, 1);
        node.spBar.fillRoundedRect(x, 51, segW, 8, 2);
        if (ratio > 0) {
          const col =
            this.rejectFlashMs > 0 && data.control === 'HUMAN' && ratio < 1
              ? 0xef4444
              : ratio >= 1
                ? isEmerg && nowPulse
                  ? 0xffffff
                  : readyHex
                : 0x475569;
          node.spBar.fillStyle(col, 1);
          node.spBar.fillRoundedRect(x, 51, Math.max(3, Math.round(segW * ratio)), 8, 2);
        }
      };

      const elColor =
        prof.skill2Element === 'WATER'
          ? 0x38bdf8
          : prof.skill2Element === 'THUNDER'
            ? 0x4ade80
            : 0xf97316;
      drawSeg(8, s1Ratio, prof.accentHex, false);
      drawSeg(75, s2Ratio, elColor, false);
      drawSeg(142, s3Ratio, 0xfacc15, emergencyReady);

      const s2Icon =
        prof.skill2Element === 'WATER'
          ? '💧'
          : prof.skill2Element === 'THUNDER'
            ? '⚡'
            : '🔥';
      const s3Icon = prof.skill3Element === 'SOLAR' ? '☀' : s2Icon;

      node.s1Text.setText(`[V]${prof.specialName.slice(0, 3)}`);
      node.s1Text.setColor(s1Ratio >= 1 ? '#fde047' : '#64748b');

      node.s2Text.setText(`[B]${s2Icon}${prof.skill2Name.slice(0, 2)}`);
      node.s2Text.setColor(s2Ratio >= 1 ? '#7dd3fc' : '#64748b');

      node.s3Text.setText(emergencyReady ? `[N]${s3Icon}탈출!` : `[N]${s3Icon}극오의`);
      node.s3Text.setColor(
        emergencyReady && nowPulse ? '#ffffff' : s3Ratio >= 1 ? '#facc15' : '#64748b',
      );
    }

    const waveStr = snap.waveNumber ? `W${snap.waveNumber}/${snap.totalWaves ?? 5} · ` : '';
    const scoreStr = snap.score !== undefined ? `${snap.score.toLocaleString()}점 · ` : '';
    this.counterText?.setText(`${waveStr}${scoreStr}적:${snap.enemiesActive}`);
    if (this.muteBtnText) {
      this.muteBtnText.setText(snap.isMuted ? '🔇' : '🔊');
      this.muteBtnText.setColor(snap.isMuted ? '#94a3b8' : '#7dd3fc');
    }
    this.bottomHintContainer?.setVisible(!snap.hideBottomHint);

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
    this.bottomHintContainer?.destroy(true);
    for (const c of this.heroCards) c.container.destroy(true);
    this.heroCards.length = 0;
    this.counterText?.destroy();
    this.muteBtnText?.destroy();
    this.comboText?.destroy();
  }
}
