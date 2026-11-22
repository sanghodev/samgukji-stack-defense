import Phaser from 'phaser';
import { DEPTH_LAYERS, GAME_HEIGHT, GAME_WIDTH } from '../config/arenaConfig';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export interface CombatHudSnapshot {
  playerHp: number;
  playerMaxHp: number;
  playerDefeated: boolean;
  enemiesAlive: number;
  enemiesDefeated: number;
  comboHits: number;
}

/**
 * Minimal arcade HUD for the Step 2 Combat Feel Lab:
 * - Player health bar
 * - Enemy defeat & remaining counter
 * - Combo hit counter
 * - Restart prompt when defeated or room cleared
 */
export class CombatHud implements IGameSystem {
  public readonly id = 'combat-hud';

  private hpBarGfx?: Phaser.GameObjects.Graphics;
  private hpText?: Phaser.GameObjects.Text;
  private counterText?: Phaser.GameObjects.Text;
  private comboText?: Phaser.GameObjects.Text;
  private statusOverlay?: Phaser.GameObjects.Container;
  private statusTitle?: Phaser.GameObjects.Text;
  private statusSub?: Phaser.GameObjects.Text;
  private onRestart?: () => void;

  private lastComboShown = 0;

  constructor(onRestart: () => void) {
    this.onRestart = onRestart;
  }

  public init(ctx: SystemContext): void {
    const { scene } = ctx;

    // 1. Top-left Player HP bar panel
    const hpBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hpBg.fillStyle(0x1c120c, 0.84);
    hpBg.fillRoundedRect(14, 14, 244, 52, 7);
    hpBg.lineStyle(1.5, 0xfbbf24, 0.72);
    hpBg.strokeRoundedRect(14, 14, 244, 52, 7);

    scene.add
      .text(24, 21, '조운 (ZHAO YUN)', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setDepth(DEPTH_LAYERS.HUD + 1);

    this.hpBarGfx = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD + 1);
    this.hpText = scene.add
      .text(246, 21, '100 / 100', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH_LAYERS.HUD + 2);

    // 2. Top-center Enemy Defeat Counter pill
    const pillW = 248;
    const pillX = GAME_WIDTH / 2 - pillW / 2;
    const pillBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    pillBg.fillStyle(0x1c120c, 0.82);
    pillBg.fillRoundedRect(pillX, 14, pillW, 38, 7);
    pillBg.lineStyle(1.5, 0xfbbf24, 0.65);
    pillBg.strokeRoundedRect(pillX, 14, pillW, 38, 7);

    this.counterText = scene.add
      .text(GAME_WIDTH / 2, 33, '처치: 0   |   산적: 6', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 3. Top-right Arcade Title & Restart button
    const badgeW = 248;
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
      .text(bx + badgeW / 2, 47, 'STEP 3 · MAYHEM PHYSICS', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '10px',
        color: '#fb923c',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 4. Combo Hit Counter (top-right below title)
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
    const hintW = 556;
    const hintX = GAME_WIDTH - hintW - 14;
    const hintBg = scene.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hintBg.fillStyle(0x0b101b, 0.78);
    hintBg.fillRoundedRect(hintX, GAME_HEIGHT - 34, hintW, 24, 5);
    hintBg.lineStyle(1, 0x94a3b8, 0.35);
    hintBg.strokeRoundedRect(hintX, GAME_HEIGHT - 34, hintW, 24, 5);

    scene.add
      .text(
        hintX + hintW / 2,
        GAME_HEIGHT - 22,
        'WASD/방향키: 이동 · Z: 3연격 · X: 강공격 · SPACE: 잡기/던지기 · R: 재시작 · F2: 디버그패널',
        {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
          fontSize: '11px',
          color: '#e2e8f0',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // 6. Center Status Banner (Defeated / Room Cleared)
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

  public render(snap: CombatHudSnapshot, scene: Phaser.Scene): void {
    // Player HP bar
    if (this.hpBarGfx && this.hpText) {
      const ratio = Phaser.Math.Clamp(snap.playerHp / Math.max(1, snap.playerMaxHp), 0, 1);
      this.hpBarGfx.clear();
      this.hpBarGfx.fillStyle(0x0f172a, 1);
      this.hpBarGfx.fillRoundedRect(24, 41, 224, 15, 4);
      if (ratio > 0) {
        const fillW = Math.max(6, Math.round(224 * ratio));
        const barCol = ratio > 0.3 ? 0x22c55e : 0xef4444;
        this.hpBarGfx.fillStyle(barCol, 1);
        this.hpBarGfx.fillRoundedRect(24, 41, fillW, 15, 4);
        this.hpBarGfx.fillStyle(0xffffff, 0.28);
        this.hpBarGfx.fillRoundedRect(24, 41, fillW, 5, 3);
      }
      this.hpText.setText(`${snap.playerHp} / ${snap.playerMaxHp}`);
    }

    // Enemy counter
    this.counterText?.setText(
      `처치: ${snap.enemiesDefeated}   |   남은 산적: ${snap.enemiesAlive}`,
    );

    // Combo hit counter
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

    // Defeat overlay
    if (this.statusOverlay && this.statusTitle && this.statusSub) {
      if (snap.playerDefeated) {
        this.statusOverlay.setVisible(true);
        this.statusTitle.setText('조운 쓰러짐!');
        this.statusTitle.setColor('#ef4444');
        this.statusSub.setText(`처치한 산적: ${snap.enemiesDefeated}명  ·  R 키로 즉시 재시작`);
      } else {
        this.statusOverlay.setVisible(false);
      }
    }
  }

  public destroy(): void {
    this.statusOverlay?.destroy(true);
    this.hpBarGfx?.destroy();
    this.hpText?.destroy();
    this.counterText?.destroy();
    this.comboText?.destroy();
  }
}
