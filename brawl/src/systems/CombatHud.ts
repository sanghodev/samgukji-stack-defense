import Phaser from 'phaser';
import { DEPTH_LAYERS, GAME_HEIGHT, GAME_WIDTH } from '../config/arenaConfig';
import { HERO_PROFILES, HeroId } from '../config/step4Config';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface CombatHudSnapshot {
  heroId: HeroId;
  playerHp: number;
  playerMaxHp: number;
  playerDefeated: boolean;
  specialReadyRatio: number;
  enemiesActive: number;
  enemiesNeutralized: number;
  enemiesSurrendered: number;
  comboHits: number;
}

/**
 * Arcade HUD for Step 4:
 * - Active Hero HP bar & [V] Signature Special readiness gauge (맹장돌진 / 청룡선풍)
 * - Enemy neutralized/surrendered/remaining counter
 * - Combo hit counter & controls legend (including TAB switch & V special)
 */
export class CombatHud implements IGameSystem {
  public readonly id = 'combat-hud';

  private heroNameText?: Phaser.GameObjects.Text;
  private hpBarGfx?: Phaser.GameObjects.Graphics;
  private hpText?: Phaser.GameObjects.Text;
  private specialBarGfx?: Phaser.GameObjects.Graphics;
  private specialLabel?: Phaser.GameObjects.Text;
  private counterText?: Phaser.GameObjects.Text;
  private comboText?: Phaser.GameObjects.Text;
  private statusOverlay?: Phaser.GameObjects.Container;
  private statusTitle?: Phaser.GameObjects.Text;
  private statusSub?: Phaser.GameObjects.Text;
  private onRestart?: () => void;

  private lastComboShown = 0;
  private rejectFlashMs = 0;

  constructor(onRestart: () => void) {
    this.onRestart = onRestart;
  }

  public flashSpecialRejected(): void {
    this.rejectFlashMs = 240;
  }

  public init(ctx: SystemContext): void {
    const { scene } = ctx;

    // 1. Top-left Active Hero HP + [V] Special Ability panel
    const hpBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hpBg.fillStyle(0x1c120c, 0.86);
    hpBg.fillRoundedRect(14, 14, 258, 74, 7);
    hpBg.lineStyle(1.5, 0xfbbf24, 0.75);
    hpBg.strokeRoundedRect(14, 14, 258, 74, 7);

    this.heroNameText = scene.add
      .text(24, 20, '장비 (ZHANG FEI) · [TAB] 교대', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#c084fc',
      })
      .setDepth(DEPTH_LAYERS.HUD + 1);

    this.hpBarGfx = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD + 1);
    this.hpText = scene.add
      .text(262, 20, '130 / 130', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH_LAYERS.HUD + 2);

    this.specialBarGfx = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD + 1);
    this.specialLabel = scene.add
      .text(24, 62, '[V] 맹장돌진 READY', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setDepth(DEPTH_LAYERS.HUD + 2);

    // 2. Top-center Enemy Counter pill
    const pillW = 296;
    const pillX = GAME_WIDTH / 2 - pillW / 2;
    const pillBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    pillBg.fillStyle(0x1c120c, 0.82);
    pillBg.fillRoundedRect(pillX, 14, pillW, 38, 7);
    pillBg.lineStyle(1.5, 0xfbbf24, 0.65);
    pillBg.strokeRoundedRect(pillX, 14, pillW, 38, 7);

    this.counterText = scene.add
      .text(GAME_WIDTH / 2, 33, '제압: 0  |  항복: 0  |  남은 산적: 12', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 3. Top-right Arcade Title
    const badgeW = 256;
    const bx = GAME_WIDTH - badgeW - 14;
    const titleBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    titleBg.fillStyle(0x1c120c, 0.8);
    titleBg.fillRoundedRect(bx, 14, badgeW, 44, 6);
    titleBg.lineStyle(1.5, 0xfbbf24, 0.7);
    titleBg.strokeRoundedRect(bx, 14, badgeW, 44, 6);

    scene.add
      .text(bx + badgeW / 2, 29, '삼국지 난장판', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    scene.add
      .text(bx + badgeW / 2, 47, 'STEP 4 · ZHANG FEI & CHAOS AI', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '10px',
        color: '#c084fc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 4. Combo Hit Counter
    this.comboText = scene.add
      .text(GAME_WIDTH - 24, 72, '', {
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

    // 5. Bottom-right controls legend
    const hintW = 684;
    const hintX = GAME_WIDTH - hintW - 14;
    const hintBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hintBg.fillStyle(0x0b101b, 0.8);
    hintBg.fillRoundedRect(hintX, GAME_HEIGHT - 34, hintW, 24, 5);
    hintBg.lineStyle(1, 0x94a3b8, 0.35);
    hintBg.strokeRoundedRect(hintX, GAME_HEIGHT - 34, hintW, 24, 5);

    scene.add
      .text(
        hintX + hintW / 2,
        GAME_HEIGHT - 22,
        'WASD/방향키: 이동 · Z: 3연격 · X: 강공격 · V: 필살기(돌진) · SPACE: 잡기/던지기 · TAB: 영웅교대 · F2: 디버그',
        {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
          fontSize: '11px',
          color: '#e2e8f0',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 6. Center Status Banner
    const dim = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.45);
    const card = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 168, 0x1c120c, 0.94);
    card.setStrokeStyle(2, 0xfbbf24, 0.9);

    this.statusTitle = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#fde047',
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
    btnBg.on('pointerdown', () => this.onRestart?.());

    this.statusOverlay = scene.add
      .container(0, 0, [dim, card, this.statusTitle, this.statusSub, btnBg, btnText])
      .setDepth(DEPTH_LAYERS.HUD + 20)
      .setVisible(false);
  }

  public render(snap: CombatHudSnapshot, scene: Phaser.Scene, deltaMs: number): void {
    const prof = HERO_PROFILES[snap.heroId];
    if (this.rejectFlashMs > 0) {
      this.rejectFlashMs = Math.max(0, this.rejectFlashMs - deltaMs);
    }

    this.heroNameText?.setText(`${prof.displayName} (${prof.engName}) · [TAB]`);
    this.heroNameText?.setColor(prof.accentColor);

    // HP bar
    if (this.hpBarGfx && this.hpText) {
      const ratio = Phaser.Math.Clamp(snap.playerHp / Math.max(1, snap.playerMaxHp), 0, 1);
      this.hpBarGfx.clear();
      this.hpBarGfx.fillStyle(0x0f172a, 1);
      this.hpBarGfx.fillRoundedRect(24, 39, 238, 14, 4);
      if (ratio > 0) {
        const fillW = Math.max(6, Math.round(238 * ratio));
        const barCol = ratio > 0.3 ? 0x22c55e : 0xef4444;
        this.hpBarGfx.fillStyle(barCol, 1);
        this.hpBarGfx.fillRoundedRect(24, 39, fillW, 14, 4);
        this.hpBarGfx.fillStyle(0xffffff, 0.28);
        this.hpBarGfx.fillRoundedRect(24, 39, fillW, 5, 3);
      }
      this.hpText.setText(`${snap.playerHp} / ${snap.playerMaxHp}`);
    }

    // [V] Special Ability bar
    if (this.specialBarGfx && this.specialLabel) {
      const ready = snap.specialReadyRatio >= 1;
      const barCol =
        this.rejectFlashMs > 0
          ? 0xef4444
          : ready
            ? snap.heroId === 'zhangfei'
              ? 0xa855f7
              : 0x0ea5e9
            : 0x475569;

      this.specialBarGfx.clear();
      this.specialBarGfx.fillStyle(0x0f172a, 1);
      this.specialBarGfx.fillRoundedRect(142, 62, 120, 12, 3);
      if (snap.specialReadyRatio > 0) {
        this.specialBarGfx.fillStyle(barCol, 1);
        this.specialBarGfx.fillRoundedRect(
          142,
          62,
          Math.max(4, Math.round(120 * snap.specialReadyRatio)),
          12,
          3,
        );
      }

      this.specialLabel.setText(
        ready
          ? `[V] ${prof.specialName} READY!`
          : `[V] ${prof.specialName} ${Math.round(snap.specialReadyRatio * 100)}%`,
      );
      this.specialLabel.setColor(
        this.rejectFlashMs > 0 ? '#f87171' : ready ? '#fde047' : '#94a3b8',
      );
    }

    // Counter
    this.counterText?.setText(
      `제압: ${snap.enemiesNeutralized}  |  항복: ${snap.enemiesSurrendered}  |  산적: ${snap.enemiesActive}`,
    );

    // Combo
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

    if (this.statusOverlay && this.statusTitle && this.statusSub) {
      if (snap.playerDefeated) {
        this.statusOverlay.setVisible(true);
        this.statusTitle.setText(`${prof.displayName} 쓰러짐!`);
        this.statusTitle.setColor('#ef4444');
        this.statusSub.setText(`제압한 산적: ${snap.enemiesNeutralized}명  ·  R 키로 즉시 재시작`);
      } else {
        this.statusOverlay.setVisible(false);
      }
    }
  }

  public destroy(): void {
    this.statusOverlay?.destroy(true);
    this.heroNameText?.destroy();
    this.hpBarGfx?.destroy();
    this.hpText?.destroy();
    this.specialBarGfx?.destroy();
    this.specialLabel?.destroy();
    this.counterText?.destroy();
    this.comboText?.destroy();
  }
}
