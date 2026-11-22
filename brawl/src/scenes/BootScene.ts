import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    this.load.image('fortress_battlefield', '../assets/maps/fortress_battlefield.jpg');

    this.load.spritesheet('zhaoyun_8dir', '../assets/sprites/zhaoyun_8dir.png', {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.spritesheet('zhaoyun_actions', '../assets/sprites/zhaoyun_actions.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('zhaoyun_run', '../assets/sprites/zhaoyun_run.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('enemies_4types', '../assets/sprites/enemies_4types.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
  }

  public create(): void {
    this.scene.start('BrawlScene');
  }
}
