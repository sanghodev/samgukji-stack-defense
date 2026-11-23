import Phaser from 'phaser';
import { generateStep4Sprites } from '../graphics/Step4SpriteFactory';
import { generateStep5Sprites } from '../graphics/Step5SpriteFactory';
import { generateStep6Sprites } from '../graphics/Step6SpriteFactory';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    // Stage 1 16-bit pixel-art ancient Chinese fortress courtyard arena background
    this.load.image('mayhem_arena_bg', '../assets/maps/mayhem_arena_bg.png');

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

    // High-craft 16-bit chibi pixel art sheets for Guan Yu, Zhang Fei, Huang Zhong
    this.load.spritesheet('guanyu_sheet', '../assets/sprites/guanyu_sheet.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('zhangfei_sheet', '../assets/sprites/zhangfei_sheet.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('huangzhong_sheet', '../assets/sprites/huangzhong_sheet.png', {
      frameWidth: 160,
      frameHeight: 160,
    });

    // Varied Bandits + comedic poses, legacy 4-type enemies, and Bandit Chief Boss
    this.load.spritesheet('bandits_varied', '../assets/sprites/bandits_varied.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('enemies_4types', '../assets/sprites/enemies_4types.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.spritesheet('boss_chief_sheet', '../assets/sprites/boss_chief_sheet.png', {
      frameWidth: 192,
      frameHeight: 192,
    });

    // 16-bit Interactive Marketplace Props, Persistent Wreckage & Comic Combat VFX sheets
    this.load.spritesheet('mayhem_props', '../assets/sprites/mayhem_props.png', {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.spritesheet('broken_wreckage', '../assets/sprites/broken_wreckage.png', {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.spritesheet('hero_special_poses', '../assets/sprites/hero_special_poses.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    this.load.image('guard_shield_vfx', '../assets/sprites/guard_shield_vfx.png');
    this.load.spritesheet('combat_vfx', '../assets/sprites/combat_vfx.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
  }

  public create(): void {
    this.generateParticleTextures();
    generateStep4Sprites(this);
    generateStep5Sprites(this);
    generateStep6Sprites(this);
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

    // Step 3 Debris textures (wood splinter, ceramic shard, water droplet, fruit piece)
    const wood = this.make.graphics({ x: 0, y: 0 }, false);
    wood.fillStyle(0xffffff, 1);
    wood.fillRect(0, 1, 10, 3);
    wood.generateTexture('debris_wood', 10, 5);
    wood.destroy();

    const ceramic = this.make.graphics({ x: 0, y: 0 }, false);
    ceramic.fillStyle(0xffffff, 1);
    ceramic.fillTriangle(0, 6, 4, 0, 7, 5);
    ceramic.generateTexture('debris_ceramic', 8, 7);
    ceramic.destroy();

    const water = this.make.graphics({ x: 0, y: 0 }, false);
    water.fillStyle(0xffffff, 1);
    water.fillCircle(3, 3, 3);
    water.generateTexture('debris_water', 6, 6);
    water.destroy();

    const fruit = this.make.graphics({ x: 0, y: 0 }, false);
    fruit.fillStyle(0xffffff, 1);
    fruit.fillCircle(4, 4, 4);
    fruit.generateTexture('debris_fruit', 8, 8);
    fruit.destroy();
  }
}
