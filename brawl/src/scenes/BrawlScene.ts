import Phaser from 'phaser';

export class BrawlScene extends Phaser.Scene {
  constructor() {
    super('BrawlScene');
  }

  public create(): void {
    const bg = this.add.image(640, 360, 'fortress_battlefield');
    bg.setDisplaySize(1280, 720);
    bg.setTint(0x665544);

    this.add
      .sprite(640, 390, 'zhaoyun_8dir', 0)
      .setScale(1.15);

    this.add
      .text(640, 220, '삼국지: 난장 (BRAWL)', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '44px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#1c120c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(640, 278, '새 게임 작업 준비 완료 — 게임 방식이 곧 구현됩니다', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '20px',
        color: '#e2e8f0',
        stroke: '#0f172a',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
  }
}
