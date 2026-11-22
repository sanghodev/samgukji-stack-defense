import Phaser from 'phaser';
import {
  ARENA_BOUNDS,
  DEPTH_LAYERS,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config/arenaConfig';
import {
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';

export type PropKind = 'stall_fruit' | 'stall_weapons' | 'crate_stack' | 'wine_jars' | 'stone_lantern';

export interface ArenaProp {
  readonly id: string;
  readonly kind: PropKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly destructible: boolean;
  readonly container: Phaser.GameObjects.Container;
}

interface SwayingLantern {
  container: Phaser.GameObjects.Container;
  baseX: number;
  baseY: number;
  phase: number;
}

interface WavingBanner {
  gfx: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  trimColor: number;
  phase: number;
}

/**
 * Fixed-camera 16-bit pixel-art ancient Chinese marketplace arena.
 * Features layered distant mountains, fortress walls, colorful market storefronts,
 * a large perspective-projected cobblestone playable floor, and depth-sorted props.
 */
export class MarketplaceArena {
  public readonly props: ArenaProp[] = [];

  private readonly scene: Phaser.Scene;
  private readonly lanterns: SwayingLantern[] = [];
  private readonly banners: WavingBanner[] = [];
  private petalEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private elapsed = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.buildSkyAndMountains();
    this.buildDistantFortress();
    this.buildMarketplaceBuildings();
    this.buildPlayableFloor();
    this.buildDepthSortedProps();
    this.buildOverheadLanterns();
    this.buildAmbientPetals();
  }

  public update(deltaMs: number): void {
    this.elapsed += deltaMs * 0.001;

    // Gentle sway on overhead red paper lanterns
    for (const lantern of this.lanterns) {
      const sway = Math.sin(this.elapsed * 1.9 + lantern.phase);
      lantern.container.rotation = sway * 0.085;
      lantern.container.x = lantern.baseX + sway * 2.5;
    }

    // Gentle flutter on distant fortress banners
    for (const banner of this.banners) {
      this.redrawBanner(banner);
    }
  }

  /**
   * Resolves smooth circular collision against arena props while keeping
   * the central and rear marketplace floor open and walkable.
   */
  public resolvePropCollisions(x: number, y: number, entityRadius: number): Point2D {
    let rx = x;
    let ry = y;

    for (const prop of this.props) {
      const dx = rx - prop.x;
      // Slightly compress Y delta for 2.5D elliptical footprints
      const dy = (ry - prop.y) * 1.35;
      const minDist = entityRadius + prop.radius;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = minDist - dist;
        rx += (dx / dist) * push;
        ry += (dy / dist) * (push / 1.35);
      }
    }

    return { x: rx, y: ry };
  }

  public destroy(): void {
    this.petalEmitter?.destroy();
    for (const prop of this.props) {
      prop.container.destroy(true);
    }
    this.props.length = 0;
  }

  private buildSkyAndMountains(): void {
    const sky = this.scene.add.graphics().setDepth(DEPTH_LAYERS.SKY);

    // 16-bit stepped golden-afternoon sky gradient
    const skyBands: Array<{ y: number; h: number; color: number }> = [
      { y: 0, h: 36, color: 0x3b6ea5 },
      { y: 36, h: 34, color: 0x5688ba },
      { y: 70, h: 32, color: 0x7ba5c7 },
      { y: 102, h: 28, color: 0xb7c2b9 },
      { y: 130, h: 26, color: 0xe8c796 },
      { y: 156, h: 40, color: 0xf4d399 },
    ];
    for (const band of skyBands) {
      sky.fillStyle(band.color, 1);
      sky.fillRect(0, band.y, GAME_WIDTH, band.h);
    }

    // Warm sun disc behind clouds
    sky.fillStyle(0xfff3c4, 0.55);
    sky.fillCircle(960, 86, 44);
    sky.fillStyle(0xfffbeb, 0.9);
    sky.fillCircle(960, 86, 26);

    // Crisp pixel clouds
    const drawCloud = (cx: number, cy: number, w: number, h: number) => {
      sky.fillStyle(0xfef3c7, 0.92);
      sky.fillRect(cx, cy, w, h);
      sky.fillRect(cx + 14, cy - 8, w - 28, 8);
      sky.fillRect(cx + 28, cy - 14, w - 56, 6);
      sky.fillStyle(0xfde68a, 0.7);
      sky.fillRect(cx + 6, cy + h - 4, w - 12, 4);
    };
    drawCloud(110, 44, 148, 16);
    drawCloud(410, 62, 118, 14);
    drawCloud(740, 38, 162, 16);
    drawCloud(1050, 56, 134, 14);

    // Layered distant Shan-Shui (산수) mountains
    const mtn = this.scene.add.graphics().setDepth(DEPTH_LAYERS.MOUNTAINS);
    mtn.fillStyle(0x55758a, 1);
    this.fillMountainRange(mtn, [
      [0, 175],
      [90, 118],
      [190, 142],
      [310, 96],
      [440, 138],
      [560, 112],
      [680, 146],
      [810, 100],
      [940, 134],
      [1080, 108],
      [1200, 136],
      [1280, 122],
      [1280, 200],
      [0, 200],
    ]);

    mtn.fillStyle(0x416073, 1);
    this.fillMountainRange(mtn, [
      [0, 185],
      [140, 138],
      [260, 160],
      [400, 126],
      [520, 158],
      [650, 134],
      [780, 162],
      [910, 132],
      [1050, 156],
      [1190, 132],
      [1280, 152],
      [1280, 210],
      [0, 210],
    ]);
  }

  private fillMountainRange(
    gfx: Phaser.GameObjects.Graphics,
    points: Array<[number, number]>,
  ): void {
    gfx.beginPath();
    gfx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      gfx.lineTo(points[i][0], points[i][1]);
    }
    gfx.closePath();
    gfx.fillPath();
  }

  private buildDistantFortress(): void {
    const fort = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FORTRESS);

    // Distant stone fortress wall across the horizon
    const wallY = 148;
    const wallH = 54;
    fort.fillStyle(0x7c766d, 1);
    fort.fillRect(0, wallY, GAME_WIDTH, wallH);

    // Stone masonry courses
    fort.fillStyle(0x635d55, 1);
    for (let y = wallY + 8; y < wallY + wallH; y += 10) {
      fort.fillRect(0, y, GAME_WIDTH, 2);
    }

    // Battlements (성가퀴)
    fort.fillStyle(0x948d82, 1);
    for (let x = 0; x < GAME_WIDTH; x += 28) {
      fort.fillRect(x, wallY - 10, 18, 12);
      fort.fillStyle(0xb5aea2, 1);
      fort.fillRect(x, wallY - 10, 18, 3);
      fort.fillStyle(0x948d82, 1);
    }

    // Distant twin watchtowers (left, center-keep, right)
    this.drawWatchtower(fort, 210, 148, 1.0);
    this.drawWatchtower(fort, 640, 142, 1.28);
    this.drawWatchtower(fort, 1070, 148, 1.0);

    // Animated war banners along the fortress wall
    const bannerSpots = [
      { x: 140, y: 112, color: 0xc81e1e, trim: 0xfbbf24 },
      { x: 315, y: 116, color: 0xd97706, trim: 0xfef08a },
      { x: 550, y: 106, color: 0xc81e1e, trim: 0xfbbf24 },
      { x: 730, y: 106, color: 0xc81e1e, trim: 0xfbbf24 },
      { x: 965, y: 116, color: 0xd97706, trim: 0xfef08a },
      { x: 1140, y: 112, color: 0xc81e1e, trim: 0xfbbf24 },
    ];
    bannerSpots.forEach((spot, i) => {
      const gfx = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FORTRESS + 1);
      const banner: WavingBanner = {
        gfx,
        x: spot.x,
        y: spot.y,
        width: 16,
        height: 28,
        color: spot.color,
        trimColor: spot.trim,
        phase: i * 1.15,
      };
      this.banners.push(banner);
      this.redrawBanner(banner);
    });
  }

  private drawWatchtower(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    baseY: number,
    scale: number,
  ): void {
    const w = Math.round(76 * scale);
    const h = Math.round(40 * scale);
    const x = Math.round(cx - w / 2);
    const y = Math.round(baseY - h);

    // Timber upper tower walls
    gfx.fillStyle(0x7c3f21, 1);
    gfx.fillRect(x + 8, y, w - 16, h);
    gfx.fillStyle(0x9a3412, 1);
    gfx.fillRect(x + 12, y + 4, w - 24, h - 8);

    // Warm lit tower windows
    gfx.fillStyle(0xfef08a, 0.85);
    gfx.fillRect(cx - 12 * scale, y + 12 * scale, 8 * scale, 10 * scale);
    gfx.fillRect(cx + 4 * scale, y + 12 * scale, 8 * scale, 10 * scale);

    // Curved East Asian tiled roof (기와지붕)
    const roofW = Math.round(w * 1.24);
    const roofH = Math.round(24 * scale);
    const rx = Math.round(cx - roofW / 2);
    const ry = Math.round(y - roofH + 6);

    gfx.fillStyle(0x28364a, 1);
    gfx.fillTriangle(
      rx - 6,
      ry + roofH,
      cx,
      ry - 4,
      rx + roofW + 6,
      ry + roofH,
    );
    gfx.fillStyle(0x3b4d66, 1);
    gfx.fillRect(rx + 6, ry + roofH - 8, roofW - 12, 8);

    // Golden ridge beam & upturned eaves
    gfx.fillStyle(0xf59e0b, 1);
    gfx.fillRect(cx - 18 * scale, ry + 2, 36 * scale, 4);
    gfx.fillRect(rx - 6, ry + roofH - 4, 8, 4);
    gfx.fillRect(rx + roofW - 2, ry + roofH - 4, 8, 4);
  }

  private redrawBanner(b: WavingBanner): void {
    const wave = Math.sin(this.elapsed * 3.4 + b.phase) * 3;
    b.gfx.clear();
    // Wooden flagpole
    b.gfx.fillStyle(0x451a03, 1);
    b.gfx.fillRect(b.x - 1, b.y - 4, 3, b.height + 16);
    b.gfx.fillStyle(0xfbbf24, 1);
    b.gfx.fillRect(b.x - 2, b.y - 6, 5, 3);

    // Pennant cloth
    b.gfx.fillStyle(b.color, 1);
    b.gfx.beginPath();
    b.gfx.moveTo(b.x + 2, b.y);
    b.gfx.lineTo(b.x + 2 + b.width, b.y + 3 + wave * 0.5);
    b.gfx.lineTo(b.x + 2 + b.width - 3, b.y + b.height - 2 + wave);
    b.gfx.lineTo(b.x + 2, b.y + b.height);
    b.gfx.closePath();
    b.gfx.fillPath();

    // Gold emblem stripe
    b.gfx.fillStyle(b.trimColor, 1);
    b.gfx.fillRect(b.x + 6, b.y + 8, 5, 8);
  }

  private buildMarketplaceBuildings(): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_LAYERS.BUILDINGS);
    const groundEdgeY = ARENA_BOUNDS.backY; // 282

    // Sunlit distant street & lower fortress courtyard visible through the central archway and gaps
    g.fillStyle(0xb59b75, 1);
    g.fillRect(0, 198, GAME_WIDTH, groundEdgeY - 198);
    g.fillStyle(0x9a8465, 1);
    g.fillRect(0, 198, GAME_WIDTH, 22);
    // Perspective street leading into the distant fortress gate through the central archway
    g.fillStyle(0xcbb38b, 1);
    g.beginPath();
    g.moveTo(575, 200);
    g.lineTo(705, 200);
    g.lineTo(765, groundEdgeY - 12);
    g.lineTo(515, groundEdgeY - 12);
    g.closePath();
    g.fillPath();

    // Rear stone foundation curb behind the playable floor
    g.fillStyle(0x6b6257, 1);
    g.fillRect(0, groundEdgeY - 12, GAME_WIDTH, 14);
    g.fillStyle(0x9c9182, 1);
    g.fillRect(0, groundEdgeY - 12, GAME_WIDTH, 3);

    // Left Marketplace Shops (주막 Tavern & 찻집 Tea House)
    this.drawShopBuilding(g, 38, groundEdgeY - 12, 232, 108, {
      wallColor: 0xe7d6b9,
      roofColor: 0x2b3b52,
      awningColor: 0xc81e1e,
      awningStripe: 0xfef3c7,
      signText: '酒',
      signBg: 0x991b1b,
    });
    this.drawShopBuilding(g, 286, groundEdgeY - 12, 212, 98, {
      wallColor: 0xdfd0b2,
      roofColor: 0x334155,
      awningColor: 0x0f766e,
      awningStripe: 0xfef3c7,
      signText: '茶',
      signBg: 0x115e59,
    });

    // Right Marketplace Shops (무기 Armory & 약방 Apothecary)
    this.drawShopBuilding(g, 782, groundEdgeY - 12, 212, 98, {
      wallColor: 0xdfd0b2,
      roofColor: 0x334155,
      awningColor: 0x1d4ed8,
      awningStripe: 0xe0f2fe,
      signText: '武',
      signBg: 0x1e3a8a,
    });
    this.drawShopBuilding(g, 1010, groundEdgeY - 12, 232, 108, {
      wallColor: 0xe7d6b9,
      roofColor: 0x2b3b52,
      awningColor: 0xb45309,
      awningStripe: 0xfef3c7,
      signText: '藥',
      signBg: 0x92400e,
    });

    // Central Ceremonial Market Archway (장안 패루 / Paifang Gate)
    this.drawCentralArchway(g, 640, groundEdgeY - 10);
  }

  private drawShopBuilding(
    g: Phaser.GameObjects.Graphics,
    x: number,
    baseY: number,
    w: number,
    h: number,
    style: {
      wallColor: number;
      roofColor: number;
      awningColor: number;
      awningStripe: number;
      signText: string;
      signBg: number;
    },
  ): void {
    const topY = baseY - h;

    // Plaster wall & wooden lower wainscot
    g.fillStyle(style.wallColor, 1);
    g.fillRect(x + 6, topY + 26, w - 12, h - 26);
    g.fillStyle(0x6e4326, 1);
    g.fillRect(x + 6, baseY - 26, w - 12, 26);

    // Red timber pillars & horizontal lintel
    g.fillStyle(0x991b1b, 1);
    g.fillRect(x + 6, topY + 24, 10, h - 24);
    g.fillRect(x + w - 16, topY + 24, 10, h - 24);
    g.fillRect(x + Math.round(w / 2) - 4, topY + 24, 8, h - 24);
    g.fillStyle(0x7c2d12, 1);
    g.fillRect(x + 4, topY + 24, w - 8, 8);

    // Warm glowing lattice windows
    const winW = Math.round((w - 52) / 2);
    const winY = topY + 40;
    const drawWindow = (wx: number) => {
      g.fillStyle(0x451a03, 1);
      g.fillRect(wx, winY, winW, 30);
      g.fillStyle(0xfde68a, 0.85);
      g.fillRect(wx + 3, winY + 3, winW - 6, 24);
      // Lattice bars
      g.fillStyle(0x78350f, 1);
      g.fillRect(wx + Math.round(winW / 2) - 1, winY + 3, 2, 24);
      g.fillRect(wx + 3, winY + 14, winW - 6, 2);
    };
    drawWindow(x + 20);
    drawWindow(x + w - 20 - winW);

    // Striped cloth market awning
    const awningY = topY + 64;
    const stripeCount = 8;
    const stripeW = (w - 16) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      g.fillStyle(i % 2 === 0 ? style.awningColor : style.awningStripe, 1);
      g.fillRect(x + 8 + i * stripeW, awningY, Math.ceil(stripeW), 14);
    }
    g.fillStyle(0x1f2937, 0.3);
    g.fillRect(x + 8, awningY + 14, w - 16, 4);

    // Curved tiled roof
    g.fillStyle(style.roofColor, 1);
    g.fillRect(x - 6, topY + 8, w + 12, 20);
    g.fillRect(x + 4, topY, w - 8, 12);
    // Roof tile ribs
    g.fillStyle(0x1e293b, 0.55);
    for (let rx = x; rx < x + w; rx += 12) {
      g.fillRect(rx, topY + 8, 2, 20);
    }
    // Golden ridge & upturned corners
    g.fillStyle(0xf59e0b, 1);
    g.fillRect(x + 6, topY - 2, w - 12, 4);
    g.fillRect(x - 10, topY + 20, 8, 6);
    g.fillRect(x + w + 2, topY + 20, 8, 6);

    // Hanging shop signboard
    const signX = x + Math.round(w / 2);
    const signY = topY + 46;
    g.fillStyle(0x451a03, 1);
    g.fillRect(signX - 15, signY - 15, 30, 30);
    g.fillStyle(style.signBg, 1);
    g.fillRect(signX - 13, signY - 13, 26, 26);
    g.lineStyle(1, 0xfbbf24, 1);
    g.strokeRect(signX - 13, signY - 13, 26, 26);

    this.scene.add
      .text(signX, signY, style.signText, {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fef08a',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.BUILDINGS + 2);
  }

  private drawCentralArchway(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    baseY: number,
  ): void {
    const span = 236;
    const leftX = cx - span / 2;
    const rightX = cx + span / 2;
    const h = 114;
    const topY = baseY - h;

    // Stone pedestals
    g.fillStyle(0xa8a29e, 1);
    g.fillRect(leftX - 10, baseY - 16, 26, 16);
    g.fillRect(rightX - 16, baseY - 16, 26, 16);
    g.fillStyle(0x78716c, 1);
    g.fillRect(leftX - 10, baseY - 4, 26, 4);
    g.fillRect(rightX - 16, baseY - 4, 26, 4);

    // Crimson lacquered columns
    g.fillStyle(0xb91c1c, 1);
    g.fillRect(leftX - 4, topY + 24, 14, h - 40);
    g.fillRect(rightX - 10, topY + 24, 14, h - 40);
    g.fillStyle(0xef4444, 0.5);
    g.fillRect(leftX - 2, topY + 24, 4, h - 40);
    g.fillRect(rightX - 8, topY + 24, 4, h - 40);

    // Ornate crossbeam & gold trim
    g.fillStyle(0x991b1b, 1);
    g.fillRect(leftX - 16, topY + 22, span + 32, 18);
    g.fillStyle(0xf59e0b, 1);
    g.fillRect(leftX - 16, topY + 22, span + 32, 3);
    g.fillRect(leftX - 16, topY + 37, span + 32, 3);

    // Sweeping archway tiled roof
    g.fillStyle(0x1e3a5f, 1);
    g.fillRect(leftX - 26, topY + 8, span + 52, 14);
    g.fillRect(leftX - 12, topY, span + 24, 10);
    g.fillStyle(0xfbbf24, 1);
    g.fillRect(leftX - 10, topY - 3, span + 20, 4);
    g.fillRect(leftX - 30, topY + 14, 10, 6);
    g.fillRect(rightX + 20, topY + 14, 10, 6);

    // Center golden market plaque
    g.fillStyle(0x451a03, 1);
    g.fillRect(cx - 56, topY + 19, 112, 24);
    g.lineStyle(2, 0xfbbf24, 1);
    g.strokeRect(cx - 56, topY + 19, 112, 24);

    this.scene.add
      .text(cx, topY + 31, '長安 시장', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.BUILDINGS + 3);
  }

  private buildPlayableFloor(): void {
    const floor = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FLOOR);
    const { backY, frontY, backLeftX, backRightX, frontLeftX, frontRightX } = ARENA_BOUNDS;

    // Outer earthen marketplace apron outside the playable curb
    floor.fillStyle(0x524536, 1);
    floor.fillRect(0, backY - 2, GAME_WIDTH, GAME_HEIGHT - backY + 2);

    // Warm sunlit cobblestone trapezoid (the playable arena floor)
    floor.fillStyle(0xd8c39e, 1);
    floor.beginPath();
    floor.moveTo(backLeftX, backY);
    floor.lineTo(backRightX, backY);
    floor.lineTo(frontRightX, frontY);
    floor.lineTo(frontLeftX, frontY);
    floor.closePath();
    floor.fillPath();

    // Subtle alternating depth strips to enhance perspective readability
    const rowCount = 12;
    const rowYs: number[] = [];
    for (let i = 0; i <= rowCount; i++) {
      // Nonlinear spacing so closer tiles look larger than distant tiles
      const t = Math.pow(i / rowCount, 1.32);
      rowYs.push(Phaser.Math.Linear(backY, frontY, t));
    }

    for (let r = 0; r < rowCount; r++) {
      const y0 = rowYs[r];
      const y1 = rowYs[r + 1];
      const b0 = getHorizontalBoundsAtY(y0);
      const b1 = getHorizontalBoundsAtY(y1);

      if (r % 2 === 1) {
        floor.fillStyle(0xcbb38b, 0.55);
        floor.beginPath();
        floor.moveTo(b0.left, y0);
        floor.lineTo(b0.right, y0);
        floor.lineTo(b1.right, y1);
        floor.lineTo(b1.left, y1);
        floor.closePath();
        floor.fillPath();
      }
    }

    // Perspective stone paving lines (horizontal rows + converging radial seams)
    floor.lineStyle(1, 0x9b8461, 0.6);
    for (let r = 1; r < rowCount; r++) {
      const y = rowYs[r];
      const b = getHorizontalBoundsAtY(y);
      floor.lineBetween(b.left, y, b.right, y);
    }

    const colCount = 14;
    for (let c = 1; c < colCount; c++) {
      const ratio = c / colCount;
      const topX = Phaser.Math.Linear(backLeftX, backRightX, ratio);
      const botX = Phaser.Math.Linear(frontLeftX, frontRightX, ratio);
      floor.lineBetween(topX, backY, botX, frontY);
    }

    // Soft ambient shadow cast by the rear buildings onto the rear plaza edge
    floor.fillStyle(0x3a2d20, 0.24);
    floor.fillRect(backLeftX, backY, backRightX - backLeftX, 16);

    // Ornate central marketplace medallion (foreshortened 2.5D ellipse)
    const decals = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FLOOR_DECALS);
    const medX = 640;
    const medY = 468;
    decals.fillStyle(0xc5a87a, 0.9);
    decals.fillEllipse(medX, medY, 270, 114);
    decals.lineStyle(4, 0x9a7b4f, 0.85);
    decals.strokeEllipse(medX, medY, 270, 114);
    decals.lineStyle(2, 0xe8d5b0, 0.75);
    decals.strokeEllipse(medX, medY, 240, 100);
    decals.lineStyle(2, 0xa86432, 0.5);
    decals.strokeEllipse(medX, medY, 130, 54);

    // Raised stone curb borders framing the playable trapezoid
    // Left curb
    floor.lineStyle(10, 0x7d7468, 1);
    floor.lineBetween(backLeftX - 5, backY, frontLeftX - 5, frontY);
    floor.lineStyle(3, 0xb8afa0, 1);
    floor.lineBetween(backLeftX - 8, backY, frontLeftX - 8, frontY);

    // Right curb
    floor.lineStyle(10, 0x7d7468, 1);
    floor.lineBetween(backRightX + 5, backY, frontRightX + 5, frontY);
    floor.lineStyle(3, 0xb8afa0, 1);
    floor.lineBetween(backRightX + 8, backY, frontRightX + 8, frontY);

    // Front foreground stone edge trim
    floor.fillStyle(0x786e61, 1);
    floor.fillRect(frontLeftX - 10, frontY, frontRightX - frontLeftX + 20, 12);
    floor.fillStyle(0xa89f91, 1);
    floor.fillRect(frontLeftX - 10, frontY, frontRightX - frontLeftX + 20, 3);
    floor.fillStyle(0x3b3228, 1);
    floor.fillRect(0, frontY + 12, GAME_WIDTH, GAME_HEIGHT - (frontY + 12));

    // Scattered warm pixel pebbles & fallen market petals for texture
    const specks: Array<[number, number, number]> = [
      [295, 332, 0xb89f78],
      [412, 385, 0xe6a1a1],
      [530, 310, 0xb89f78],
      [770, 336, 0xb89f78],
      [940, 392, 0xe6a1a1],
      [330, 560, 0xb0966e],
      [885, 588, 0xb0966e],
      [610, 622, 0xe6a1a1],
      [478, 512, 0xb0966e],
      [795, 490, 0xb0966e],
    ];
    for (const [sx, sy, col] of specks) {
      decals.fillStyle(col, 0.8);
      decals.fillRect(sx, sy, 4, 3);
    }
  }

  private buildDepthSortedProps(): void {
    // Positioned along the perimeter & side flanks so the entire center and
    // rear floor remain wide open while letting the player test 2.5D depth sorting!
    const layout: Array<{
      id: string;
      kind: PropKind;
      x: number;
      y: number;
      radius: number;
      destructible: boolean;
    }> = [
      { id: 'rear_lantern_left', kind: 'stone_lantern', x: 500, y: 304, radius: 14, destructible: false },
      { id: 'rear_lantern_right', kind: 'stone_lantern', x: 780, y: 304, radius: 14, destructible: false },
      { id: 'left_fruit_stall', kind: 'stall_fruit', x: 184, y: 404, radius: 34, destructible: true },
      { id: 'right_weapon_stall', kind: 'stall_weapons', x: 1096, y: 404, radius: 34, destructible: true },
      { id: 'left_wine_jars', kind: 'wine_jars', x: 162, y: 558, radius: 22, destructible: true },
      { id: 'right_crate_stack', kind: 'crate_stack', x: 1122, y: 562, radius: 24, destructible: true },
    ];

    for (const spec of layout) {
      const container = this.createPropVisual(spec.kind);
      const scale = getPerspectiveScale(spec.y);
      container.setPosition(spec.x, spec.y);
      container.setScale(scale);
      container.setDepth(getDepthOrder(spec.y));

      this.props.push({
        ...spec,
        container,
      });
    }
  }

  private createPropVisual(kind: PropKind): Phaser.GameObjects.Container {
    const container = this.scene.add.container(0, 0);
    const g = this.scene.add.graphics();

    switch (kind) {
      case 'stone_lantern': {
        // Ground shadow
        g.fillStyle(0x000000, 0.28);
        g.fillEllipse(0, 2, 34, 14);
        // Stone pedestal & shaft
        g.fillStyle(0x78716c, 1);
        g.fillRect(-10, -8, 20, 10);
        g.fillStyle(0xa8a29e, 1);
        g.fillRect(-6, -34, 12, 26);
        // Lantern firebox
        g.fillStyle(0x57534e, 1);
        g.fillRect(-11, -50, 22, 16);
        g.fillStyle(0xfef08a, 0.95);
        g.fillRect(-7, -46, 14, 10);
        // Tiled cap
        g.fillStyle(0x44403c, 1);
        g.fillRect(-15, -56, 30, 6);
        g.fillRect(-9, -61, 18, 5);
        break;
      }
      case 'stall_fruit': {
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 4, 86, 28);
        // Wooden counter
        g.fillStyle(0x78350f, 1);
        g.fillRect(-34, -26, 68, 28);
        g.fillStyle(0x92400e, 1);
        g.fillRect(-36, -30, 72, 8);
        // Colorful baskets of peaches, oranges, and greens
        g.fillStyle(0xfbbf24, 1);
        g.fillCircle(-18, -32, 7);
        g.fillStyle(0xf97316, 1);
        g.fillCircle(-12, -31, 6);
        g.fillStyle(0xef4444, 1);
        g.fillCircle(4, -32, 7);
        g.fillStyle(0x22c55e, 1);
        g.fillCircle(20, -32, 7);
        // Poles & bright red-cream canopy
        g.fillStyle(0x451a03, 1);
        g.fillRect(-32, -74, 5, 48);
        g.fillRect(27, -74, 5, 48);
        for (let i = 0; i < 6; i++) {
          g.fillStyle(i % 2 === 0 ? 0xdc2626 : 0xfef3c7, 1);
          g.fillRect(-38 + i * 13, -82, 13, 16);
        }
        break;
      }
      case 'stall_weapons': {
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 4, 84, 28);
        // Timber weapon rack base
        g.fillStyle(0x5c3317, 1);
        g.fillRect(-32, -16, 64, 18);
        g.fillStyle(0x78350f, 1);
        g.fillRect(-28, -54, 6, 40);
        g.fillRect(22, -54, 6, 40);
        g.fillRect(-30, -44, 60, 5);
        // Spears & halberds resting upright
        for (let sx = -18; sx <= 18; sx += 12) {
          g.fillStyle(0x92400e, 1);
          g.fillRect(sx - 1, -68, 3, 56);
          g.fillStyle(0xe2e8f0, 1);
          g.fillTriangle(sx - 3, -68, sx + 4, -68, sx + 0.5, -80);
          g.fillStyle(0xdc2626, 1);
          g.fillRect(sx - 3, -67, 7, 4);
        }
        // Small blue-gold awning
        for (let i = 0; i < 6; i++) {
          g.fillStyle(i % 2 === 0 ? 0x1d4ed8 : 0xe0f2fe, 1);
          g.fillRect(-36 + i * 12, -88, 12, 12);
        }
        break;
      }
      case 'wine_jars': {
        g.fillStyle(0x000000, 0.28);
        g.fillEllipse(0, 3, 58, 20);
        const drawJar = (jx: number, jy: number, r: number) => {
          g.fillStyle(0x9a3412, 1);
          g.fillCircle(jx, jy - r, r);
          g.fillStyle(0xc2410c, 1);
          g.fillCircle(jx - 2, jy - r - 2, r * 0.65);
          // Red cloth seal on top
          g.fillStyle(0xdc2626, 1);
          g.fillRect(jx - 6, jy - r * 2 - 2, 12, 5);
          g.fillStyle(0xfef08a, 1);
          g.fillRect(jx - 5, jy - r * 2 + 3, 10, 2);
        };
        drawJar(-12, 0, 13);
        drawJar(13, 2, 12);
        drawJar(0, -14, 10);
        break;
      }
      case 'crate_stack': {
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 4, 62, 22);
        const drawCrate = (cx: number, cy: number, size: number) => {
          g.fillStyle(0x92400e, 1);
          g.fillRect(cx - size / 2, cy - size, size, size);
          g.lineStyle(2, 0x451a03, 1);
          g.strokeRect(cx - size / 2, cy - size, size, size);
          g.lineBetween(cx - size / 2, cy - size, cx + size / 2, cy);
          g.fillStyle(0xb45309, 1);
          g.fillRect(cx - size / 2 + 3, cy - size + 3, size - 6, 4);
        };
        drawCrate(-12, 2, 26);
        drawCrate(14, 4, 24);
        drawCrate(1, -20, 22);
        break;
      }
    }

    container.add(g);
    return container;
  }

  private buildOverheadLanterns(): void {
    // Festive string of swaying red lanterns across the top of the arena
    const rope = this.scene.add.graphics().setDepth(DEPTH_LAYERS.OVERHEAD_LANTERNS - 1);
    rope.lineStyle(2, 0x3b1f0e, 0.85);
    rope.beginPath();
    rope.moveTo(0, 32);
    for (let x = 0; x <= GAME_WIDTH; x += 64) {
      const sag = Math.sin((x / GAME_WIDTH) * Math.PI) * 34;
      rope.lineTo(x, 32 + sag);
    }
    rope.strokePath();

    const lanternXs = [295, 465, 640, 815, 985];
    lanternXs.forEach((lx, idx) => {
      const sag = Math.sin((lx / GAME_WIDTH) * Math.PI) * 34;
      const ly = 32 + sag;
      const container = this.scene.add.container(lx, ly);
      container.setDepth(DEPTH_LAYERS.OVERHEAD_LANTERNS);

      const g = this.scene.add.graphics();
      // Warm soft glow
      g.fillStyle(0xf97316, 0.22);
      g.fillCircle(0, 18, 22);
      // Hanging cord
      g.fillStyle(0x451a03, 1);
      g.fillRect(-1, 0, 2, 7);
      // Red lantern body
      g.fillStyle(0xdc2626, 1);
      g.fillEllipse(0, 17, 22, 18);
      g.fillStyle(0xfef08a, 0.55);
      g.fillEllipse(0, 17, 10, 14);
      // Gold caps & tassel
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(-6, 6, 12, 3);
      g.fillRect(-6, 25, 12, 3);
      g.fillStyle(0xef4444, 1);
      g.fillRect(-1, 28, 2, 8);

      container.add(g);
      this.lanterns.push({
        container,
        baseX: lx,
        baseY: ly,
        phase: idx * 0.9,
      });
    });
  }

  private buildAmbientPetals(): void {
    if (!this.scene.textures.exists('petal_particle')) return;

    this.petalEmitter = this.scene.add.particles(0, 0, 'petal_particle', {
      x: { min: 0, max: GAME_WIDTH },
      y: -10,
      lifespan: { min: 6500, max: 10500 },
      speedX: { min: -28, max: -8 },
      speedY: { min: 22, max: 44 },
      scale: { start: 1.0, end: 0.7 },
      alpha: { start: 0.85, end: 0 },
      rotate: { min: 0, max: 360 },
      frequency: 420,
      quantity: 1,
    });
    this.petalEmitter.setDepth(DEPTH_LAYERS.AMBIENT_PARTICLES);
  }
}
