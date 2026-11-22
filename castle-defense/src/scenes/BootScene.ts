import Phaser from 'phaser';

interface StackAssetSpec {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  layers: number;
  /** true로 변경하면 public/assets/stacks/*.png를 직접 로드합니다 (1줄 교체). */
  useExternalPng: boolean;
}

const STACK_SPECS: StackAssetSpec[] = [
  {
    key: 'castle_gate_stack',
    path: '../assets/stacks/castle_gate_stack.png',
    frameWidth: 64,
    frameHeight: 64,
    layers: 24,
    useExternalPng: false,
  },
  {
    key: 'barricade_stack',
    path: '../assets/stacks/barricade_stack.png',
    frameWidth: 32,
    frameHeight: 32,
    layers: 10,
    useExternalPng: false,
  },
  {
    key: 'sakura_tree_stack',
    path: '../assets/stacks/sakura_tree_stack.png',
    frameWidth: 40,
    frameHeight: 40,
    layers: 18,
    useExternalPng: false,
  },
  {
    key: 'zhaoyun_stack',
    path: '../assets/stacks/zhaoyun_stack.png',
    frameWidth: 24,
    frameHeight: 24,
    layers: 14,
    useExternalPng: false,
  },
  {
    key: 'bandit_stack',
    path: '../assets/stacks/bandit_stack.png',
    frameWidth: 20,
    frameHeight: 20,
    layers: 12,
    useExternalPng: false,
  },
];

/**
 * Generates crisp procedural horizontal-slice spritesheets on boot so the game
 * runs immediately without external PNGs. Swap any asset to a MagicaVoxel PNG
 * by placing it in public/assets/stacks/ and setting `useExternalPng: true`.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    // High-detail isometric Three Kingdoms fortress battlefield background
    this.load.image('fortress_battlefield', '../assets/maps/fortress_battlefield.jpg');

    // 8-direction Zhao Yun character spritesheet (idle/walk)
    this.load.spritesheet('zhaoyun_8dir', '../assets/sprites/zhaoyun_8dir.png', {
      frameWidth: 128,
      frameHeight: 128,
    });
    // 8-pose Zhao Yun action spritesheet (combo 1-3, whirlwind, guard, jump, air strike, dash)
    this.load.spritesheet('zhaoyun_actions', '../assets/sprites/zhaoyun_actions.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    // 4-frame Zhao Yun running cycle spritesheet
    this.load.spritesheet('zhaoyun_run', '../assets/sprites/zhaoyun_run.png', {
      frameWidth: 160,
      frameHeight: 160,
    });
    // 4-type 2-head chibi enemy & boss spritesheet (grunt, shield, raider, boss)
    this.load.spritesheet('enemies_4types', '../assets/sprites/enemies_4types.png', {
      frameWidth: 160,
      frameHeight: 160,
    });

    for (const spec of STACK_SPECS) {
      if (spec.useExternalPng) {
        this.load.spritesheet(spec.key, spec.path, {
          frameWidth: spec.frameWidth,
          frameHeight: spec.frameHeight,
        });
      }
    }
  }

  public create(): void {
    for (const spec of STACK_SPECS) {
      if (this.textures.exists(spec.key)) {
        continue;
      }
      this.generateProceduralStack(spec);
    }

    this.generateParticleTextures();

    this.scene.start('DefenseScene');
    this.scene.launch('UIScene');
  }

  private generateProceduralStack(spec: StackAssetSpec): void {
    const { key, frameWidth: fw, frameHeight: fh, layers } = spec;
    const canvas = document.createElement('canvas');
    canvas.width = fw * layers;
    canvas.height = fh;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    for (let z = 0; z < layers; z++) {
      ctx.save();
      ctx.translate(z * fw, 0);

      switch (key) {
        case 'castle_gate_stack':
          this.drawCastleGateSlice(ctx, fw, fh, z);
          break;
        case 'barricade_stack':
          this.drawBarricadeSlice(ctx, fw, fh, z);
          break;
        case 'sakura_tree_stack':
          this.drawSakuraTreeSlice(ctx, fw, fh, z);
          break;
        case 'zhaoyun_stack':
          this.drawZhaoYunSlice(ctx, fw, fh, z);
          break;
        case 'bandit_stack':
          this.drawBanditSlice(ctx, fw, fh, z);
          break;
      }

      ctx.restore();
    }

    const sourceImage = canvas as unknown as HTMLImageElement;
    this.textures.addSpriteSheet(key, sourceImage, {
      frameWidth: fw,
      frameHeight: fh,
    });
  }

  /**
   * 중앙 성채/성문 (64x64, 24층)
   * 회색 성벽, 나무 성문, 기와지붕, 붉은 깃발(蜀 깃발 스타일)
   */
  private drawCastleGateSlice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    z: number,
  ): void {
    const cx = w / 2;
    const cy = h / 2;

    if (z <= 2) {
      // Wide stone foundation plinth & front steps
      this.fillRect(ctx, 5, 11, 54, 42, '#7c858e');
      this.strokeRect(ctx, 5, 11, 54, 42, '#3b424c');
      this.fillRect(ctx, 21, 51, 22, 5 - z, '#a1aab3');
      return;
    }

    if (z <= 10) {
      // Main gray stone fortress walls + flanking corner bastions
      this.fillRect(ctx, 8, 14, 48, 36, '#8f98a2');
      this.strokeRect(ctx, 8, 14, 48, 36, '#434b56');

      // Stone masonry accents
      this.fillRect(ctx, 6, 12, 13, 13, '#7e8893');
      this.fillRect(ctx, 45, 12, 13, 13, '#7e8893');
      this.fillRect(ctx, 6, 39, 13, 13, '#7e8893');
      this.fillRect(ctx, 45, 39, 13, 13, '#7e8893');

      // South wooden double gate with bronze/gold studs
      const archInset = z >= 8 ? (z - 7) * 2 : 0;
      const gateW = 18 - archInset * 2;
      const gateX = cx - gateW / 2;
      this.fillRect(ctx, gateX, 46, gateW, 6, '#5c3317');
      this.fillRect(ctx, gateX + 1, 47, gateW - 2, 4, '#7c4520');
      // Gate center seam
      this.fillRect(ctx, cx - 1, 47, 2, 5, '#3b1f0d');
      if (z === 5 || z === 7) {
        this.fillRect(ctx, gateX + 3, 50, 2, 2, '#f59e0b');
        this.fillRect(ctx, gateX + gateW - 5, 50, 2, 2, '#f59e0b');
      }
      // Stone gateway pillars
      this.fillRect(ctx, gateX - 2, 46, 2, 6, '#525b66');
      this.fillRect(ctx, gateX + gateW, 46, 2, 6, '#525b66');
      return;
    }

    if (z <= 13) {
      // Battlements (성가퀴) & warm wooden upper gatehouse walls
      this.fillRect(ctx, 7, 13, 50, 38, '#9ca6b0');
      this.fillRect(ctx, 13, 18, 38, 28, '#854d27');
      this.strokeRect(ctx, 13, 18, 38, 28, '#5c3317');

      if (z >= 12) {
        for (let x = 7; x <= 53; x += 7) {
          this.fillRect(ctx, x, 12, 4, 3, '#cbd5e1');
          this.fillRect(ctx, x, 49, 4, 3, '#cbd5e1');
        }
      }
      // Flanking red banners rising from left/right watchtowers
      this.fillRect(ctx, 10, 44, 2, 2, '#5c3317');
      this.fillRect(ctx, 52, 44, 2, 2, '#5c3317');
      return;
    }

    if (z <= 19) {
      // Sweeping dark-slate East Asian tiled roof (기와지붕)
      const t = z - 14; // 0..5
      const insetX = Math.floor(t * 2.8);
      const insetY = Math.floor(t * 2.2);
      const rx = 6 + insetX;
      const ry = 11 + insetY;
      const rw = w - rx * 2;
      const rh = h - ry * 2;

      if (rw > 6 && rh > 6) {
        const tileColor = z % 2 === 0 ? '#475569' : '#334155';
        this.fillRect(ctx, rx, ry, rw, rh, tileColor);
        this.strokeRect(ctx, rx, ry, rw, rh, '#1e293b');

        // Roof ridge & upturned eaves accents
        if (t <= 1) {
          this.fillRect(ctx, rx - 1, ry - 1, 3, 3, '#cbd5e1');
          this.fillRect(ctx, rx + rw - 2, ry - 1, 3, 3, '#cbd5e1');
          this.fillRect(ctx, rx - 1, ry + rh - 2, 3, 3, '#cbd5e1');
          this.fillRect(ctx, rx + rw - 2, ry + rh - 2, 3, 3, '#cbd5e1');
        }
      }

      // Crimson side flags (붉은 깃발)
      if (z >= 15 && z <= 18) {
        this.fillRect(ctx, 9, 43, 2, 2, '#78350f');
        this.fillRect(ctx, 11, 42, 6, 4, '#dc2626');
        this.fillRect(ctx, 13, 43, 2, 2, '#fbbf24');

        this.fillRect(ctx, 51, 43, 2, 2, '#78350f');
        this.fillRect(ctx, 53, 42, 6, 4, '#dc2626');
        this.fillRect(ctx, 55, 43, 2, 2, '#fbbf24');
      }
      return;
    }

    if (z <= 20) {
      // Main roof ridge beam (용마루)
      this.fillRect(ctx, 19, cy - 2, 26, 4, '#cbd5e1');
      this.fillRect(ctx, 17, cy - 3, 4, 6, '#f59e0b');
      this.fillRect(ctx, 43, cy - 3, 4, 6, '#f59e0b');
      return;
    }

    // Central crimson flag & golden finial (layers 21..23)
    this.fillRect(ctx, cx - 1, cy - 1, 2, 2, '#fde047');
    this.fillRect(ctx, cx + 1, cy - 3, 9, 5, '#dc2626');
    if (z === 22) {
      this.fillRect(ctx, cx + 3, cy - 2, 4, 3, '#fbbf24');
    }
  }

  /**
   * 나무 바리케이드 (32x32, 10층)
   * 성문 앞 방어 목책
   */
  private drawBarricadeSlice(
    ctx: CanvasRenderingContext2D,
    _w: number,
    _h: number,
    z: number,
  ): void {
    if (z <= 1) {
      // Heavy timber base & diagonal braces
      this.fillRect(ctx, 3, 12, 26, 8, '#5c3a21');
      this.fillRect(ctx, 6, 9, 4, 14, '#472b16');
      this.fillRect(ctx, 22, 9, 4, 14, '#472b16');
      return;
    }

    if (z <= 6) {
      // Vertical wooden palisade logs + horizontal binding beam
      this.fillRect(ctx, 3, 13, 26, 6, '#7c4d2b');
      for (let x = 4; x <= 26; x += 4) {
        this.fillRect(ctx, x, 12, 3, 8, x % 8 === 0 ? '#925e36' : '#6e4222');
      }
      if (z === 4) {
        this.fillRect(ctx, 3, 14, 26, 4, '#d6b47c');
      }
      return;
    }

    // Sharpened wooden defensive tips (layers 7..9)
    const tipInset = z - 7;
    for (let x = 4; x <= 26; x += 4) {
      const tipColor = z === 9 ? '#d6d3d1' : '#a16c40';
      this.fillRect(
        ctx,
        x + Math.min(1, tipInset),
        13 + Math.floor(tipInset / 2),
        Math.max(1, 3 - tipInset),
        Math.max(2, 6 - tipInset * 2),
        tipColor,
      );
    }
  }

  /**
   * 벚꽃나무 (40x40, 18층)
   * 갈색 기둥 + 풍성한 분홍 벚꽃 잎
   */
  private drawSakuraTreeSlice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    z: number,
  ): void {
    const cx = w / 2;
    const cy = h / 2;

    if (z <= 2) {
      this.fillCircle(ctx, cx, cy, 5 - z * 0.5, '#4a2c1d');
      this.fillRect(ctx, cx - 6 + z, cy - 1, 12 - z * 2, 3, '#3b2114');
      this.fillRect(ctx, cx - 1, cy - 6 + z, 3, 12 - z * 2, '#3b2114');
      return;
    }

    if (z <= 7) {
      const leanX = Math.round((z - 3) * 0.35);
      this.fillCircle(ctx, cx + leanX, cy, 3.2, '#5c3826');
      this.fillCircle(ctx, cx + leanX - 0.5, cy - 0.5, 2, '#734832');
      return;
    }

    // Pink sakura blossom canopy (layers 8..17)
    const t = (z - 8) / 9;
    const baseR = Math.sin(t * Math.PI * 0.88 + 0.25) * 12.5 + 3.5;

    const lobes = [
      { ox: 0, oy: 0, r: baseR * 0.85, c: '#f48fb1' },
      { ox: -baseR * 0.45, oy: -baseR * 0.25, r: baseR * 0.58, c: '#f8bbd0' },
      { ox: baseR * 0.48, oy: -baseR * 0.15, r: baseR * 0.56, c: '#ec6090' },
      { ox: -baseR * 0.2, oy: baseR * 0.42, r: baseR * 0.54, c: '#f06292' },
      { ox: baseR * 0.28, oy: baseR * 0.38, r: baseR * 0.5, c: '#f8bbd0' },
    ];

    for (const lobe of lobes) {
      const jitterX = Math.sin(z * 1.7 + lobe.ox) * 1.2;
      const jitterY = Math.cos(z * 1.3 + lobe.oy) * 1.2;
      this.fillCircle(ctx, cx + lobe.ox + jitterX, cy + lobe.oy + jitterY, lobe.r, lobe.c);
    }

    if (z >= 12) {
      this.fillCircle(ctx, cx - 3, cy - 3, Math.max(2, baseR * 0.36), '#fce4ec');
      this.fillCircle(ctx, cx + 4, cy - 2, Math.max(1.5, baseR * 0.26), '#fff1f5');
    }
  }

  /**
   * 조운 1P (24x24, 14층)
   * 은청색 갑옷, 흰/파란 망토, 붉은 투구 깃털, 창을 든 형태 (정면 = +X)
   */
  private drawZhaoYunSlice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    z: number,
  ): void {
    const cx = Math.floor(w / 2) - 2;
    const cy = Math.floor(h / 2);

    if (z <= 1) {
      // Silver-trimmed boots
      this.fillRect(ctx, cx - 2, cy - 4, 4, 3, '#1e293b');
      this.fillRect(ctx, cx - 2, cy + 1, 4, 3, '#1e293b');
      return;
    }

    if (z <= 4) {
      // Silver-blue armor skirt & flowing white/blue cape behind (-X)
      this.fillRect(ctx, cx - 3, cy - 4, 6, 8, '#2563eb');
      this.fillRect(ctx, cx - 2, cy - 3, 5, 6, '#e2e8f0');
      const capeBack = Math.max(0, 4 - z);
      this.fillRect(ctx, cx - 6 - capeBack, cy - 3, 3 + capeBack, 6, '#f8fafc');
      this.fillRect(ctx, cx - 6 - capeBack, cy - 2, 2, 4, '#3b82f6');
      return;
    }

    if (z <= 8) {
      // Silver-blue breastplate, gold belt trim, broad pauldrons
      this.fillRect(ctx, cx - 3, cy - 5, 6, 10, '#cbd5e1');
      this.fillRect(ctx, cx - 2, cy - 4, 5, 8, '#f1f5f9');
      this.fillRect(ctx, cx + 1, cy - 3, 2, 6, '#38bdf8');
      this.fillRect(ctx, cx - 5, cy - 4, 2, 8, '#eff6ff');

      // Dragon Spear held forward (+X) with red tassel & gleaming silver-cyan tip
      if (z === 6 || z === 7) {
        this.fillRect(ctx, cx - 3, cy + 3, 13, 2, '#78350f');
        // Red tassel below spearhead
        this.fillRect(ctx, cx + 8, cy + 4, 2, 3, '#dc2626');
        // Spearhead
        this.fillRect(ctx, cx + 9, cy + 2, 5, 4, '#38bdf8');
        this.fillRect(ctx, cx + 13, cy + 3, 2, 2, '#f0f9ff');
      }
      return;
    }

    if (z <= 11) {
      // Face + winged silver helmet + golden forehead crest
      this.fillCircle(ctx, cx, cy, 3.6, '#fed7aa');
      this.fillRect(ctx, cx - 4, cy - 4, 5, 8, '#e2e8f0');
      if (z === 11) {
        this.fillCircle(ctx, cx, cy, 3.8, '#f8fafc');
        // Gold forehead ornament
        this.fillRect(ctx, cx + 2, cy - 2, 2, 4, '#fbbf24');
      }
      return;
    }

    // Iconic crimson-red helmet plume crest (붉은 투구 깃털, layers 12..13)
    const plumeShift = z - 12;
    this.fillRect(ctx, cx - 3 - plumeShift * 2, cy - 2, 6, 4, '#dc2626');
    this.fillRect(ctx, cx - 6 - plumeShift * 2, cy - 1, 4, 3, '#ef4444');
  }

  /**
   * 산적 적군 (20x20, 12층)
   * 어두운 남색/갈색 복장 + 몽둥이/칼 (정면 = +X)
   */
  private drawBanditSlice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    z: number,
  ): void {
    const cx = Math.floor(w / 2) - 1;
    const cy = Math.floor(h / 2);

    if (z <= 1) {
      // Dark boots
      this.fillRect(ctx, cx - 2, cy - 3, 3, 2, '#111827');
      this.fillRect(ctx, cx - 2, cy + 1, 3, 2, '#111827');
      return;
    }

    if (z <= 5) {
      // Dark navy & brown rugged tunic + leather belt
      this.fillRect(ctx, cx - 3, cy - 4, 6, 8, '#1e293b');
      this.fillRect(ctx, cx - 2, cy - 3, 5, 6, '#334155');
      if (z === 4) {
        this.fillRect(ctx, cx - 3, cy - 4, 6, 8, '#78350f');
      }
      return;
    }

    if (z <= 8) {
      // Broad shoulders + wooden club / iron blade held forward (+X)
      this.fillRect(ctx, cx - 3, cy - 5, 5, 10, '#334155');
      this.fillRect(ctx, cx - 2, cy - 3, 4, 6, '#78350f');
      if (z === 6 || z === 7) {
        // Wooden club / curved blade
        this.fillRect(ctx, cx + 2, cy + 2, 6, 2, '#92400e');
        this.fillRect(ctx, cx + 6, cy + 1, 4, 3, '#cbd5e1');
      }
      return;
    }

    // Head + dark navy headband & topknot (layers 9..11)
    this.fillCircle(ctx, cx, cy, 3.2, '#e6b89c');
    if (z === 10) {
      this.fillCircle(ctx, cx, cy, 3.4, '#1e293b');
      this.fillRect(ctx, cx - 6, cy - 1, 3, 2, '#3b82f6');
    } else if (z === 11) {
      this.fillCircle(ctx, cx, cy, 2.3, '#1f2937');
    }
  }

  private generateParticleTextures(): void {
    const petal = this.make.graphics({ x: 0, y: 0 }, false);
    petal.fillStyle(0xf9a8d4, 1);
    petal.fillEllipse(3, 2, 6, 4);
    petal.fillStyle(0xfce7f3, 1);
    petal.fillRect(2, 1, 2, 1);
    petal.generateTexture('sakura_petal', 6, 4);
    petal.destroy();

    const spark = this.make.graphics({ x: 0, y: 0 }, false);
    spark.fillStyle(0xffffff, 1);
    spark.fillRect(0, 0, 4, 4);
    spark.generateTexture('spark_particle', 4, 4);
    spark.destroy();

    const wood = this.make.graphics({ x: 0, y: 0 }, false);
    wood.fillStyle(0x92400e, 1);
    wood.fillRect(0, 0, 6, 2);
    wood.generateTexture('wood_splinter', 6, 2);
    wood.destroy();

    const dust = this.make.graphics({ x: 0, y: 0 }, false);
    dust.fillStyle(0xefe2c6, 0.9);
    dust.fillCircle(5, 5, 5);
    dust.generateTexture('dust_puff', 10, 10);
    dust.destroy();

    // Treasure 1: 질풍의 옥패 (Emerald Jade Pendant - Attack Speed UP)
    const jade = this.make.graphics({ x: 0, y: 0 }, false);
    jade.fillStyle(0x064e3b, 1);
    jade.fillCircle(14, 14, 11);
    jade.fillStyle(0x34d399, 1);
    jade.fillCircle(14, 14, 9);
    jade.fillStyle(0xa7f3d0, 1);
    jade.fillCircle(11, 11, 3);
    jade.fillStyle(0x064e3b, 1);
    jade.fillCircle(14, 14, 3);
    jade.fillStyle(0xef4444, 1);
    jade.fillRect(12, 22, 4, 6);
    jade.generateTexture('treasure_jade', 28, 30);
    jade.destroy();

    // Treasure 2: 청룡의 보주 (Azure Dragon Pearl - Combo Explosion UP)
    const orb = this.make.graphics({ x: 0, y: 0 }, false);
    orb.fillStyle(0x0c4a6e, 1);
    orb.fillCircle(14, 14, 11);
    orb.fillStyle(0x0ea5e9, 1);
    orb.fillCircle(14, 14, 9);
    orb.fillStyle(0x7dd3fc, 1);
    orb.fillCircle(12, 11, 5);
    orb.fillStyle(0xffffff, 1);
    orb.fillCircle(10, 9, 2.5);
    orb.lineStyle(2, 0xfbbf24, 1);
    orb.strokeCircle(14, 14, 11);
    orb.generateTexture('treasure_orb', 28, 28);
    orb.destroy();

    // Treasure 3: 황금 보물 상자 (Golden Treasure Chest - Gold + EXP + Heal)
    const chest = this.make.graphics({ x: 0, y: 0 }, false);
    chest.fillStyle(0x451a03, 1);
    chest.fillRoundedRect(2, 6, 24, 18, 3);
    chest.fillStyle(0xb45309, 1);
    chest.fillRoundedRect(4, 8, 20, 14, 2);
    chest.fillStyle(0xfbbf24, 1);
    chest.fillRect(4, 13, 20, 3);
    chest.fillRect(12, 11, 4, 7);
    chest.fillStyle(0xfef08a, 1);
    chest.fillRect(13, 13, 2, 3);
    chest.generateTexture('treasure_chest', 28, 26);
    chest.destroy();
  }

  private fillRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private strokeRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(x) + 0.5,
      Math.round(y) + 0.5,
      Math.round(w) - 1,
      Math.round(h) - 1,
    );
  }

  private fillCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  }
}
