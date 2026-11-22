import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    // 8-direction chibi Zhao Yun spritesheet (E, SE, S, SW, W, NW, N, NE)
    this.load.spritesheet('zhaoyun_8dir', '../assets/sprites/zhaoyun_8dir.png', {
      frameWidth: 128,
      frameHeight: 128,
    });
    // 4-frame Zhao Yun running stride spritesheet
    this.load.spritesheet('zhaoyun_run', '../assets/sprites/zhaoyun_run.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    // 8-pose Zhao Yun combat action spritesheet (combo 1-3, heavy windup & thrust)
    this.load.spritesheet('zhaoyun_actions', '../assets/sprites/zhaoyun_actions.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    // 4-type 2-head-tall enemy spritesheet (frame 0 = blue-uniformed bandit)
    this.load.spritesheet('enemies_4types', '../assets/sprites/enemies_4types.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
  }

  public create(): void {
    this.generateParticleTextures();
    this.scene.start('BrawlScene');
  }

  private generateParticleTextures(): void {
    // Soft sandstone footstep / landing dust puff
    const dust = this.make.graphics({ x: 0, y: 0 }, false);
    dust.fillStyle(0xf2e3c6, 0.9);
    dust.fillCircle(6, 6, 6);
    dust.fillStyle(0xfffbeb, 0.7);
    dust.fillCircle(5, 5, 3);
    dust.generateTexture('dust_puff', 12, 12);
    dust.destroy();

    // Crisp pixel-art combat spark
    const spark = this.make.graphics({ x: 0, y: 0 }, false);
    spark.fillStyle(0xffffff, 1);
    spark.fillRect(0, 1, 6, 2);
    spark.fillRect(2, 0, 2, 4);
    spark.generateTexture('spark_particle', 6, 4);
    spark.destroy();

    // Warm pink/peach marketplace blossom petal
    const petal = this.make.graphics({ x: 0, y: 0 }, false);
    petal.fillStyle(0xf9a8d4, 1);
    petal.fillEllipse(4, 3, 7, 4);
    petal.fillStyle(0xfce7f3, 1);
    petal.fillRect(3, 2, 2, 1);
    petal.generateTexture('petal_particle', 8, 6);
    petal.destroy();
  }
}
