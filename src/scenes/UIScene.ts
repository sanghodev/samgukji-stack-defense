import Phaser from 'phaser';
import type { DefenseHudState } from './DefenseScene';

interface BannerPayload {
  title: string;
  subtitle: string;
  color: string;
}

export class UIScene extends Phaser.Scene {
  private castleHpBar!: Phaser.GameObjects.Graphics;
  private castleHpText!: Phaser.GameObjects.Text;

  private waveText!: Phaser.GameObjects.Text;
  private waveProgressBar!: Phaser.GameObjects.Graphics;
  private enemiesText!: Phaser.GameObjects.Text;

  private killsText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private pauseIconText!: Phaser.GameObjects.Text;

  private playerHpBar!: Phaser.GameObjects.Graphics;
  private playerHpText!: Phaser.GameObjects.Text;
  private playerExpBar!: Phaser.GameObjects.Graphics;
  private playerLevelText!: Phaser.GameObjects.Text;
  private playerUpgradeText!: Phaser.GameObjects.Text;
  private skillNameText!: Phaser.GameObjects.Text;
  private skillBar!: Phaser.GameObjects.Graphics;
  private skillText!: Phaser.GameObjects.Text;

  private bossHudContainer!: Phaser.GameObjects.Container;
  private bossNameText!: Phaser.GameObjects.Text;
  private bossHpBar!: Phaser.GameObjects.Graphics;

  private comboContainer!: Phaser.GameObjects.Container;
  private comboCountText!: Phaser.GameObjects.Text;
  private lastComboShown = 0;

  private promptPill!: Phaser.GameObjects.Container;
  private promptLabel!: Phaser.GameObjects.Text;

  private bannerContainer!: Phaser.GameObjects.Container;
  private bannerTitle!: Phaser.GameObjects.Text;
  private bannerSubtitle!: Phaser.GameObjects.Text;

  private pauseOverlay!: Phaser.GameObjects.Container;
  private endOverlay!: Phaser.GameObjects.Container;
  private endTitle!: Phaser.GameObjects.Text;
  private endStats!: Phaser.GameObjects.Text;

  constructor() {
    super('UIScene');
  }

  public create(): void {
    this.buildTopLeftCastleHud();
    this.buildTopCenterWaveHud();
    this.buildTopRightStatsHud();
    this.buildBossAndComboHud();
    this.buildBottomHud();
    this.buildCenterBanner();
    this.buildPauseOverlay();
    this.buildEndOverlay();

    this.game.events.off('defense:hud', this.onHudUpdate, this);
    this.game.events.off('defense:banner', this.onBanner, this);
    this.game.events.on('defense:hud', this.onHudUpdate, this);
    this.game.events.on('defense:banner', this.onBanner, this);
  }

  /** 상단 좌측: 촉(蜀) 문양 방패 + CASTLE HP 바 */
  private buildTopLeftCastleHud(): void {
    const g = this.add.graphics();

    // CASTLE HP crimson banner tab
    g.fillStyle(0x7f1d1d, 0.95);
    g.fillRoundedRect(82, 14, 186, 24, 6);
    g.lineStyle(2, 0xf59e0b, 0.95);
    g.strokeRoundedRect(82, 14, 186, 24, 6);

    // HP bar outer bronze frame
    g.fillStyle(0x3b2314, 0.95);
    g.fillRoundedRect(76, 40, 260, 26, 7);
    g.lineStyle(2, 0xd97706, 0.95);
    g.strokeRoundedRect(76, 40, 260, 26, 7);

    this.add.text(106, 18, 'CASTLE HP', {
      fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#fef3c7',
      stroke: '#2a0a0a',
      strokeThickness: 3,
    });

    this.castleHpBar = this.add.graphics();
    this.castleHpText = this.add
      .text(208, 53, '600 / 600', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Shu (蜀) Shield Crest Emblem
    const shield = this.add.graphics();
    // Outer metallic silver-gold shield polygon
    shield.fillStyle(0xd6d3d1, 1);
    shield.lineStyle(3, 0x44403c, 1);
    shield.beginPath();
    shield.moveTo(18, 14);
    shield.lineTo(54, 8);
    shield.lineTo(90, 14);
    shield.lineTo(86, 56);
    shield.lineTo(54, 78);
    shield.lineTo(22, 56);
    shield.closePath();
    shield.fillPath();
    shield.strokePath();

    // Inner crimson shield field
    shield.fillStyle(0x991b1b, 1);
    shield.lineStyle(2, 0xfbbf24, 1);
    shield.beginPath();
    shield.moveTo(25, 20);
    shield.lineTo(54, 15);
    shield.lineTo(83, 20);
    shield.lineTo(79, 52);
    shield.lineTo(54, 70);
    shield.lineTo(29, 52);
    shield.closePath();
    shield.fillPath();
    shield.strokePath();

    this.add
      .text(54, 42, '蜀', {
        fontFamily: 'Malgun Gothic, Batang, serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#3b0a0a',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
  }

  /** 상단 중앙: WAVE 1 / 20 + 웨이브 게이지 + ENEMIES LEFT */
  private buildTopCenterWaveHud(): void {
    const cx = 640;
    const g = this.add.graphics();

    // Wave scroll header
    g.fillStyle(0x7f1d1d, 0.96);
    g.fillRoundedRect(cx - 98, 12, 196, 28, 8);
    g.lineStyle(2, 0xfbbf24, 0.95);
    g.strokeRoundedRect(cx - 98, 12, 196, 28, 8);

    // Wave progress bar frame
    g.fillStyle(0x3b2314, 0.95);
    g.fillRoundedRect(cx - 132, 42, 264, 24, 7);
    g.lineStyle(2, 0xd97706, 0.95);
    g.strokeRoundedRect(cx - 132, 42, 264, 24, 7);

    // Skull badge on left of progress bar
    g.fillStyle(0x451a03, 1);
    g.fillCircle(cx - 132, 54, 17);
    g.lineStyle(2.5, 0xfbbf24, 1);
    g.strokeCircle(cx - 132, 54, 17);

    // Simple crisp pixel skull icon
    g.fillStyle(0xfef3c7, 1);
    g.fillCircle(cx - 132, 51, 7);
    g.fillRect(cx - 136, 56, 8, 5);
    g.fillStyle(0x1c1917, 1);
    g.fillCircle(cx - 135, 51, 2);
    g.fillCircle(cx - 129, 51, 2);

    this.waveText = this.add
      .text(cx, 26, 'WAVE 1 / 20', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fef3c7',
        stroke: '#2a0a0a',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.waveProgressBar = this.add.graphics();

    this.enemiesText = this.add
      .text(cx, 78, 'ENEMIES LEFT: 0', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#090b10',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
  }

  /** 상단 우측: 처치 수, 골드(코인), 일시정지 버튼 */
  private buildTopRightStatsHud(): void {
    const g = this.add.graphics();

    // Kills pill
    g.fillStyle(0x3b2314, 0.94);
    g.fillRoundedRect(942, 16, 122, 42, 8);
    g.lineStyle(2, 0xd97706, 0.95);
    g.strokeRoundedRect(942, 16, 122, 42, 8);

    // Crossed swords icon
    g.lineStyle(3, 0xe2e8f0, 1);
    g.lineBetween(956, 26, 976, 46);
    g.lineBetween(976, 26, 956, 46);
    g.lineStyle(2, 0xfbbf24, 1);
    g.lineBetween(957, 42, 963, 47);
    g.lineBetween(975, 42, 969, 47);

    this.killsText = this.add
      .text(1050, 37, '0', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(1, 0.5);

    // Gold coin pill
    g.fillStyle(0x3b2314, 0.94);
    g.fillRoundedRect(1074, 16, 128, 42, 8);
    g.lineStyle(2, 0xd97706, 0.95);
    g.strokeRoundedRect(1074, 16, 128, 42, 8);

    // Golden coin icon
    g.fillStyle(0xfbbf24, 1);
    g.fillCircle(1096, 37, 11);
    g.lineStyle(2, 0x92400e, 1);
    g.strokeCircle(1096, 37, 11);
    g.fillStyle(0xfef08a, 1);
    g.fillRect(1093, 34, 6, 6);

    this.goldText = this.add
      .text(1188, 37, '50', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(1, 0.5);

    // Pause button (||)
    const pauseBg = this.add
      .rectangle(1236, 37, 46, 42, 0x991b1b)
      .setStrokeStyle(2.5, 0xfbbf24)
      .setInteractive({ useHandCursor: true });

    this.pauseIconText = this.add
      .text(1236, 37, 'II', {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#fef3c7',
      })
      .setOrigin(0.5);

    pauseBg.on('pointerover', () => pauseBg.setFillStyle(0xb91c1c));
    pauseBg.on('pointerout', () => pauseBg.setFillStyle(0x991b1b));
    pauseBg.on('pointerdown', () => {
      this.game.events.emit('defense:togglePause');
    });
  }

  private buildBossAndComboHud(): void {
    // Boss HP Bar (shown cleanly below ENEMIES LEFT when a Boss is active)
    const bBg = this.add.graphics();
    bBg.fillStyle(0x2a0a0a, 0.92);
    bBg.fillRoundedRect(-175, -16, 350, 34, 8);
    bBg.lineStyle(2, 0xf97316, 0.95);
    bBg.strokeRoundedRect(-175, -16, 350, 34, 8);

    this.bossNameText = this.add
      .text(-164, -13, '☠ 산적 대장 Lv.2', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fde047',
      });
    this.bossHpBar = this.add.graphics();

    this.bossHudContainer = this.add.container(640, 108, [
      bBg,
      this.bossHpBar,
      this.bossNameText,
    ]);
    this.bossHudContainer.setVisible(false);

    // Stylish Hit Combo Counter (right side below gold/kills)
    this.comboCountText = this.add
      .text(0, 0, '0 COMBO!', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#67e8f9',
        stroke: '#090b10',
        strokeThickness: 6,
      })
      .setOrigin(1, 0.5);

    this.comboContainer = this.add.container(1248, 106, [this.comboCountText]);
    this.comboContainer.setVisible(false);
  }

  private buildBottomHud(): void {
    const bar = this.add.graphics();
    bar.fillStyle(0x1f140d, 0.88);
    bar.fillRoundedRect(18, 636, 560, 70, 8);
    bar.lineStyle(2, 0xb45309, 0.92);
    bar.strokeRoundedRect(18, 636, 560, 70, 8);

    // Zhao Yun Level + Weapon Tier
    this.playerLevelText = this.add.text(34, 643, 'LV.1 조운 · 일반 창', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#fde047',
    });

    // Treasure upgrade summary (Attack Speed + Combo Blast)
    this.playerUpgradeText = this.add.text(320, 643, '창속 Lv.1 · 폭발 Lv.1', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#6ee7b7',
    });

    this.playerHpBar = this.add.graphics();
    this.playerHpText = this.add.text(228, 661, '200 / 200', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#f8fafc',
    });

    // EXP bar under HP bar
    this.playerExpBar = this.add.graphics();

    // E Skill: Evolves with upgrades (청룡 회오리 -> ★ 질풍 쌍룡참 -> ✦ 청룡승천파)
    this.skillNameText = this.add.text(320, 662, '청룡 회오리 [E]', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#22d3ee',
    });
    this.skillBar = this.add.graphics();
    this.skillText = this.add.text(508, 680, 'READY', {
      fontFamily: 'Malgun Gothic, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#67e8f9',
    });

    // Controls legend
    const controlsBg = this.add.graphics();
    controlsBg.fillStyle(0x1f140d, 0.8);
    controlsBg.fillRoundedRect(592, 666, 670, 34, 8);
    controlsBg.lineStyle(1.5, 0x92400e, 0.8);
    controlsBg.strokeRoundedRect(592, 666, 670, 34, 8);

    this.add
      .text(
        927,
        683,
        'WASD 이동 · 좌클릭 3단 콤보폭발 · Space 점프(+클릭 강하) · 우클릭/Q 방어 · E 회전베기 · Shift 대시 · F 수리',
        {
          fontFamily: 'Malgun Gothic, sans-serif',
          fontSize: '11.5px',
          color: '#fef3c7',
        },
      )
      .setOrigin(0.5);

    // Contextual interaction prompt pill
    const pillBg = this.add.graphics();
    pillBg.fillStyle(0x1f140d, 0.94);
    pillBg.fillRoundedRect(-150, -18, 300, 36, 18);
    pillBg.lineStyle(2, 0xfbbf24, 0.95);
    pillBg.strokeRoundedRect(-150, -18, 300, 36, 18);

    this.promptLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5);

    this.promptPill = this.add.container(640, 622, [pillBg, this.promptLabel]);
    this.promptPill.setVisible(false);
  }

  private buildCenterBanner(): void {
    this.bannerTitle = this.add
      .text(0, -14, '', {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: '42px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#090b10',
        strokeThickness: 7,
      })
      .setOrigin(0.5);

    this.bannerSubtitle = this.add
      .text(0, 26, '', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#090b10',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.bannerContainer = this.add.container(640, 155, [
      this.bannerTitle,
      this.bannerSubtitle,
    ]);
    this.bannerContainer.setAlpha(0);
  }

  private buildPauseOverlay(): void {
    const dim = this.add.rectangle(640, 360, 1280, 720, 0x05070c, 0.6);
    const card = this.add.graphics();
    card.fillStyle(0x1f140d, 0.96);
    card.fillRoundedRect(460, 235, 360, 240, 14);
    card.lineStyle(2.5, 0xfbbf24, 0.95);
    card.strokeRoundedRect(460, 235, 360, 240, 14);

    const title = this.add
      .text(640, 290, '일시정지', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5);

    const resumeBtn = this.add
      .rectangle(640, 360, 200, 44, 0x15803d)
      .setStrokeStyle(2, 0x86efac)
      .setInteractive({ useHandCursor: true });
    const resumeLbl = this.add
      .text(640, 360, '계속하기 (ESC)', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    resumeBtn.on('pointerdown', () => this.game.events.emit('defense:togglePause'));

    const restartBtn = this.add
      .rectangle(640, 420, 200, 42, 0x991b1b)
      .setStrokeStyle(2, 0xfca5a5)
      .setInteractive({ useHandCursor: true });
    const restartLbl = this.add
      .text(640, 420, '처음부터 다시', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    restartBtn.on('pointerdown', () => this.game.events.emit('defense:restart'));

    this.pauseOverlay = this.add.container(0, 0, [
      dim,
      card,
      title,
      resumeBtn,
      resumeLbl,
      restartBtn,
      restartLbl,
    ]);
    this.pauseOverlay.setVisible(false);
    this.pauseOverlay.setDepth(90);
  }

  private buildEndOverlay(): void {
    const dim = this.add.rectangle(640, 360, 1280, 720, 0x05070c, 0.72);
    const card = this.add.graphics();
    card.fillStyle(0x1f140d, 0.96);
    card.fillRoundedRect(410, 210, 460, 290, 14);
    card.lineStyle(2.5, 0xfbbf24, 0.95);
    card.strokeRoundedRect(410, 210, 460, 290, 14);

    this.endTitle = this.add
      .text(640, 272, '성채 함락!', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '42px',
        fontStyle: 'bold',
        color: '#ef4444',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.endStats = this.add
      .text(640, 344, '', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '18px',
        color: '#fef3c7',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5);

    const btnBg = this.add
      .rectangle(640, 434, 210, 46, 0xb45309)
      .setStrokeStyle(2, 0xfde047)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add
      .text(640, 434, '다시 도전 (R)', {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    btnBg.on('pointerover', () => btnBg.setFillStyle(0xd97706));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0xb45309));
    btnBg.on('pointerdown', () => this.game.events.emit('defense:restart'));

    this.endOverlay = this.add.container(0, 0, [
      dim,
      card,
      this.endTitle,
      this.endStats,
      btnBg,
      btnText,
    ]);
    this.endOverlay.setVisible(false);
    this.endOverlay.setDepth(100);
  }

  private onHudUpdate(state: DefenseHudState): void {
    // 1. Castle HP Bar (crimson gradient style)
    const cRatio = Phaser.Math.Clamp(state.castleHp / state.castleMaxHp, 0, 1);
    const barX = 84;
    const barY = 44;
    const barW = 246;
    const barH = 18;
    this.castleHpBar.clear();
    this.castleHpBar.fillStyle(0x1c120c, 1);
    this.castleHpBar.fillRoundedRect(barX, barY, barW, barH, 4);
    if (cRatio > 0) {
      const fillW = Math.max(6, Math.round(barW * cRatio));
      this.castleHpBar.fillStyle(cRatio > 0.25 ? 0xdc2626 : 0xef4444, 1);
      this.castleHpBar.fillRoundedRect(barX, barY, fillW, barH, 4);
      this.castleHpBar.fillStyle(0xf87171, 0.45);
      this.castleHpBar.fillRoundedRect(barX, barY, fillW, 6, 3);
    }
    this.castleHpText.setText(`${state.castleHp} / ${state.castleMaxHp}`);

    // 2. Wave & Enemies Left Bar
    this.waveText.setText(`WAVE ${state.wave} / ${state.maxWave}`);
    this.enemiesText.setText(`ENEMIES LEFT: ${state.enemiesRemaining}`);

    const eRatio = Phaser.Math.Clamp(
      state.enemiesRemaining / Math.max(1, state.waveTotalEnemies),
      0,
      1,
    );
    const wBarX = 640 - 110;
    const wBarY = 47;
    const wBarW = 236;
    const wBarH = 14;
    this.waveProgressBar.clear();
    this.waveProgressBar.fillStyle(0x1c120c, 1);
    this.waveProgressBar.fillRoundedRect(wBarX, wBarY, wBarW, wBarH, 4);
    if (eRatio > 0) {
      const fillW = Math.max(6, Math.round(wBarW * eRatio));
      this.waveProgressBar.fillStyle(0xf59e0b, 1);
      this.waveProgressBar.fillRoundedRect(wBarX, wBarY, fillW, wBarH, 4);
      this.waveProgressBar.fillStyle(0xfde047, 0.5);
      this.waveProgressBar.fillRoundedRect(wBarX, wBarY, fillW, 5, 3);
    }

    // 3. Top-right kills, gold, pause icon
    this.killsText.setText(`${state.kills}`);
    this.goldText.setText(`${state.gold}`);
    this.pauseIconText.setText(state.isPaused ? '▶' : 'II');

    // 4. Boss HP Bar & Combo Counter
    if (state.bossMaxHp > 0 && state.bossHp > 0) {
      this.bossHudContainer.setVisible(true);
      this.bossNameText.setText(`☠ ${state.bossName}   (${state.bossHp} / ${state.bossMaxHp})`);
      const bRatio = Phaser.Math.Clamp(state.bossHp / state.bossMaxHp, 0, 1);
      this.bossHpBar.clear();
      this.bossHpBar.fillStyle(0x1c120c, 1);
      this.bossHpBar.fillRoundedRect(-164, 3, 328, 10, 3);
      this.bossHpBar.fillStyle(0xf97316, 1);
      this.bossHpBar.fillRoundedRect(-164, 3, Math.max(4, Math.round(328 * bRatio)), 10, 3);
    } else {
      this.bossHudContainer.setVisible(false);
    }

    if (state.comboCount >= 2) {
      this.comboContainer.setVisible(true);
      this.comboCountText.setText(`${state.comboCount} COMBO!`);
      const cCol =
        state.comboCount >= 20
          ? '#fb923c'
          : state.comboCount >= 10
            ? '#fde047'
            : '#67e8f9';
      this.comboCountText.setColor(cCol);
      if (state.comboCount > this.lastComboShown) {
        this.tweens.killTweensOf(this.comboContainer);
        this.comboContainer.setScale(1.26);
        this.tweens.add({
          targets: this.comboContainer,
          scale: 1,
          duration: 140,
          ease: 'Back.easeOut',
        });
      }
    } else {
      this.comboContainer.setVisible(false);
    }
    this.lastComboShown = state.comboCount;

    // 5. Bottom Zhao Yun Level, Transformed Form, Weapon, HP, EXP & E-Skill
    this.playerLevelText.setText(
      `LV.${state.playerLevel} ${state.playerFormName} · ${state.weaponTierName}`,
    );
    this.playerUpgradeText.setText(`창속 Lv.${state.speedLevel} · 폭발 Lv.${state.blastLevel}`);

    const pRatio = Phaser.Math.Clamp(state.playerHp / state.playerMaxHp, 0, 1);
    this.playerHpBar.clear();
    this.playerHpBar.fillStyle(0x1c120c, 1);
    this.playerHpBar.fillRoundedRect(34, 665, 184, 12, 3);
    if (pRatio > 0) {
      this.playerHpBar.fillStyle(0x38bdf8, 1);
      this.playerHpBar.fillRoundedRect(34, 665, Math.round(184 * pRatio), 12, 3);
    }
    this.playerHpText.setText(
      state.playerRespawnSec > 0
        ? `복귀 ${state.playerRespawnSec.toFixed(1)}s`
        : `${state.playerHp} / ${state.playerMaxHp}`,
    );

    const expRatio = Phaser.Math.Clamp(
      state.playerExp / Math.max(1, state.playerExpToNext),
      0,
      1,
    );
    this.playerExpBar.clear();
    this.playerExpBar.fillStyle(0x1c120c, 1);
    this.playerExpBar.fillRoundedRect(34, 684, 256, 8, 3);
    if (expRatio > 0) {
      this.playerExpBar.fillStyle(0xfbbf24, 1);
      this.playerExpBar.fillRoundedRect(34, 684, Math.max(4, Math.round(256 * expRatio)), 8, 3);
    }

    this.skillNameText.setText(state.skillDisplayName);
    this.skillNameText.setColor(
      state.skillTier === 3
        ? '#fde047'
        : state.skillTier === 2
          ? '#6ee7b7'
          : '#22d3ee',
    );

    const skillBarColor =
      state.skillReadyRatio < 1
        ? 0x475569
        : state.skillTier === 3
          ? 0xfbbf24
          : state.skillTier === 2
            ? 0x10b981
            : 0x22d3ee;

    this.skillBar.clear();
    this.skillBar.fillStyle(0x1c120c, 1);
    this.skillBar.fillRoundedRect(320, 682, 178, 12, 3);
    this.skillBar.fillStyle(skillBarColor, 1);
    this.skillBar.fillRoundedRect(
      320,
      682,
      Math.round(178 * state.skillReadyRatio),
      12,
      3,
    );
    this.skillText.setText(
      state.skillReadyRatio >= 1
        ? 'READY'
        : `${Math.round(state.skillReadyRatio * 100)}%`,
    );

    // Contextual repair prompt
    if (state.promptText && !state.isGameOver && !state.isVictory && !state.isPaused) {
      this.promptLabel.setText(state.promptText);
      this.promptPill.setVisible(true);
    } else {
      this.promptPill.setVisible(false);
    }

    // Overlays
    this.pauseOverlay.setVisible(state.isPaused && !state.isGameOver && !state.isVictory);

    const ended = state.isGameOver || state.isVictory;
    this.endOverlay.setVisible(ended);
    if (ended) {
      this.endTitle.setText(state.isVictory ? '촉 성채 수호 성공!' : '성채 함락!');
      this.endTitle.setColor(state.isVictory ? '#fde047' : '#ef4444');
      this.endStats.setText(
        `도달 웨이브: WAVE ${state.wave} / ${state.maxWave}\n처치한 산적: ${state.kills}명  |  보유 골드: ${state.gold}G`,
      );
    }
  }

  private onBanner(payload: BannerPayload): void {
    this.tweens.killTweensOf(this.bannerContainer);
    this.bannerTitle.setText(payload.title);
    this.bannerTitle.setColor(payload.color);
    this.bannerSubtitle.setText(payload.subtitle);

    this.bannerContainer.setPosition(640, 175);
    this.bannerContainer.setAlpha(0);

    this.tweens.chain({
      targets: this.bannerContainer,
      tweens: [
        { alpha: 1, y: 150, duration: 240, ease: 'Cubic.easeOut' },
        { alpha: 1, duration: 1450 },
        { alpha: 0, y: 130, duration: 340, ease: 'Cubic.easeIn' },
      ],
    });
  }
}
