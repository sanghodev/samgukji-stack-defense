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
  swayAmp: number;
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
 * Fixed-camera deep 2.5D ancient Chinese marketplace avenue leading back
 * to a distant fortress & castle gate (성문).
 *
 * Spatial depth cues:
 * - Distant castle gate & fortress walls with subtle atmospheric haze
 * - Receding perspective-angled left/right marketplace buildings & roofs
 * - Nonlinear perspective cobblestone floor converging toward the castle gate
 * - 3-tier receding overhead red lantern strings
 * - Perspective-scaled, Y-depth-sorted arena props
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
    this.buildDistantCastleGate();
    this.buildPlayableFloor();
    this.buildRecedingSideBuildings();
    this.buildDepthSortedProps();
    this.buildOverheadLanternTiers();
    this.buildAmbientPetals();
  }

  public update(deltaMs: number): void {
    this.elapsed += deltaMs * 0.001;

    for (const lantern of this.lanterns) {
      const sway = Math.sin(this.elapsed * 1.9 + lantern.phase);
      lantern.container.rotation = sway * 0.08;
      lantern.container.x = lantern.baseX + sway * lantern.swayAmp;
    }

    for (const banner of this.banners) {
      this.redrawBanner(banner);
    }
  }

  /**
   * Resolves smooth elliptical collision against arena props while keeping
   * the central avenue and rear castle gate plaza open and walkable.
   */
  public resolvePropCollisions(x: number, y: number, entityRadius: number): Point2D {
    let rx = x;
    let ry = y;

    for (const prop of this.props) {
      const dx = rx - prop.x;
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
      { y: 0, h: 30, color: 0x36679c },
      { y: 30, h: 28, color: 0x5284b5 },
      { y: 58, h: 26, color: 0x79a4c7 },
      { y: 84, h: 24, color: 0xb7c4ba },
      { y: 108, h: 24, color: 0xe7c896 },
      { y: 132, h: 46, color: 0xf4d7a0 },
    ];
    for (const band of skyBands) {
      sky.fillStyle(band.color, 1);
      sky.fillRect(0, band.y, GAME_WIDTH, band.h);
    }

    // Warm sun disc low in the sky
    sky.fillStyle(0xfff3c4, 0.45);
    sky.fillCircle(880, 82, 42);
    sky.fillStyle(0xfffbeb, 0.88);
    sky.fillCircle(880, 82, 22);

    // Crisp pixel clouds
    const drawCloud = (cx: number, cy: number, w: number, h: number) => {
      sky.fillStyle(0xfef3c7, 0.9);
      sky.fillRect(cx, cy, w, h);
      sky.fillRect(cx + 12, cy - 7, w - 24, 7);
      sky.fillRect(cx + 24, cy - 12, w - 48, 5);
      sky.fillStyle(0xfde68a, 0.65);
      sky.fillRect(cx + 6, cy + h - 3, w - 12, 3);
    };
    drawCloud(190, 42, 132, 13);
    drawCloud(500, 32, 118, 12);
    drawCloud(780, 46, 140, 13);
    drawCloud(1020, 36, 116, 12);

    // Distant layered Shan-Shui mountains
    const mtn = this.scene.add.graphics().setDepth(DEPTH_LAYERS.MOUNTAINS);
    mtn.fillStyle(0x638296, 1);
    this.fillPolygon(mtn, [
      [0, 158],
      [110, 102],
      [230, 128],
      [360, 84],
      [490, 124],
      [640, 92],
      [790, 126],
      [930, 86],
      [1080, 120],
      [1210, 96],
      [1280, 118],
      [1280, 195],
      [0, 195],
    ]);

    mtn.fillStyle(0x4c6a7d, 1);
    this.fillPolygon(mtn, [
      [0, 168],
      [160, 124],
      [300, 146],
      [440, 114],
      [580, 144],
      [720, 116],
      [870, 148],
      [1020, 118],
      [1160, 142],
      [1280, 126],
      [1280, 200],
      [0, 200],
    ]);
  }

  /**
   * Builds the distant fortress wall & grand Castle Gate (성문) far at the rear
   * of the marketplace avenue (y ≈ 130..228), complete with cherry blossom trees,
   * watchtowers, wooden gate doors, banners, and atmospheric depth haze.
   */
  private buildDistantCastleGate(): void {
    const fort = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FORTRESS);
    const gateBaseY = ARENA_BOUNDS.backY; // 228

    // Distant lush greenery & cherry blossom treetops peeking behind the fortress walls
    this.drawDistantSakuraCluster(fort, 370, 174, 0.85);
    this.drawDistantSakuraCluster(fort, 910, 174, 0.85);
    this.drawDistantSakuraCluster(fort, 455, 162, 0.65);
    this.drawDistantSakuraCluster(fort, 825, 162, 0.65);

    // Main distant stone fortress rampart wall spanning across the rear horizon
    const wallTopY = 166;
    const wallH = gateBaseY - wallTopY; // 62px tall in the distance
    fort.fillStyle(0x888176, 1);
    fort.fillRect(280, wallTopY, 720, wallH);

    // Subtle stone masonry lines
    fort.fillStyle(0x6c655c, 0.85);
    for (let y = wallTopY + 9; y < gateBaseY; y += 9) {
      fort.fillRect(280, y, 720, 1.5);
    }

    // Battlements (성가퀴) along top of the fortress wall
    for (let x = 286; x < 994; x += 22) {
      fort.fillStyle(0x9d968a, 1);
      fort.fillRect(x, wallTopY - 8, 14, 9);
      fort.fillStyle(0xc2bbb0, 1);
      fort.fillRect(x, wallTopY - 8, 14, 2);
    }

    // Flanking corner watchtowers (좌/우 망루)
    this.drawDistantWatchtower(fort, 412, wallTopY, 0.82);
    this.drawDistantWatchtower(fort, 868, wallTopY, 0.82);

    // Grand Central Castle Gatehouse (성문) — smaller & far in the distance!
    const cx = 640;
    const gateW = 156;
    const gateLeft = cx - gateW / 2;

    // Projecting stone gate bastion
    fort.fillStyle(0x9a9387, 1);
    fort.fillRect(gateLeft, wallTopY - 6, gateW, wallH + 6);
    fort.fillStyle(0x736c62, 1);
    fort.fillRect(gateLeft, wallTopY - 6, 8, wallH + 6);
    fort.fillRect(gateLeft + gateW - 8, wallTopY - 6, 8, wallH + 6);

    // Gate battlements
    for (let x = gateLeft + 4; x < gateLeft + gateW - 10; x += 18) {
      fort.fillStyle(0xb3aca0, 1);
      fort.fillRect(x, wallTopY - 13, 12, 8);
    }

    // Heavy wooden double castle gate doors (성문 목재 문짝)
    const doorW = 68;
    const doorH = 44;
    const doorLeft = cx - doorW / 2;
    const doorTop = gateBaseY - doorH;

    // Stone arch frame
    fort.fillStyle(0x5c554d, 1);
    fort.fillRect(doorLeft - 6, doorTop - 5, doorW + 12, doorH + 5);
    // Wooden double doors
    fort.fillStyle(0x6e3b1b, 1);
    fort.fillRect(doorLeft, doorTop, doorW, doorH);
    fort.fillStyle(0x854a24, 1);
    fort.fillRect(doorLeft + 3, doorTop + 3, doorW / 2 - 4, doorH - 5);
    fort.fillRect(cx + 1, doorTop + 3, doorW / 2 - 4, doorH - 5);
    // Center seam & bronze gate knockers/studs
    fort.fillStyle(0x3b1f0d, 1);
    fort.fillRect(cx - 1, doorTop, 2, doorH);
    fort.fillStyle(0xf59e0b, 1);
    fort.fillCircle(cx - 11, doorTop + 23, 3);
    fort.fillCircle(cx + 11, doorTop + 23, 3);
    // Subtle gold studs
    for (let sy = doorTop + 8; sy < gateBaseY - 4; sy += 10) {
      fort.fillRect(doorLeft + 6, sy, 2, 2);
      fort.fillRect(doorLeft + doorW - 8, sy, 2, 2);
    }

    // Upper Two-Tier Wooden Gatehouse Pavilion (성문 누각)
    const pavW = 112;
    const pavH = 26;
    const pavLeft = cx - pavW / 2;
    const pavTop = wallTopY - 6 - pavH;

    fort.fillStyle(0x7c2d12, 1);
    fort.fillRect(pavLeft, pavTop, pavW, pavH);
    fort.fillStyle(0x9a3412, 1);
    fort.fillRect(pavLeft + 6, pavTop + 3, pavW - 12, pavH - 6);
    // Warm lit gatehouse windows
    fort.fillStyle(0xfef08a, 0.85);
    fort.fillRect(cx - 32, pavTop + 8, 12, 10);
    fort.fillRect(cx - 6, pavTop + 8, 12, 10);
    fort.fillRect(cx + 20, pavTop + 8, 12, 10);

    // Sweeping dark-slate East Asian tiled roof on gatehouse
    fort.fillStyle(0x2a394e, 1);
    this.fillPolygon(fort, [
      [pavLeft - 18, pavTop + 4],
      [pavLeft + 8, pavTop - 16],
      [pavLeft + pavW - 8, pavTop - 16],
      [pavLeft + pavW + 18, pavTop + 4],
    ]);
    fort.fillStyle(0x3f526b, 1);
    fort.fillRect(pavLeft - 12, pavTop - 2, pavW + 24, 5);
    // Golden ridge beam & upturned roof tips
    fort.fillStyle(0xf59e0b, 1);
    fort.fillRect(pavLeft + 6, pavTop - 18, pavW - 12, 3);
    fort.fillRect(pavLeft - 21, pavTop + 1, 7, 4);
    fort.fillRect(pavLeft + pavW + 14, pavTop + 1, 7, 4);

    // Small golden plaque above the castle gate
    fort.fillStyle(0x451a03, 1);
    fort.fillRect(cx - 26, doorTop - 15, 52, 12);
    fort.lineStyle(1, 0xfbbf24, 1);
    fort.strokeRect(cx - 26, doorTop - 15, 52, 12);
    this.scene.add
      .text(cx, doorTop - 9, '長安門', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.FORTRESS + 2);

    // Animated crimson Shu war banners flanking the distant castle gate
    const bannerSpots = [
      { x: 540, y: 128, color: 0xc81e1e, trim: 0xfbbf24 },
      { x: 740, y: 128, color: 0xc81e1e, trim: 0xfbbf24 },
      { x: 468, y: 138, color: 0xd97706, trim: 0xfef08a },
      { x: 812, y: 138, color: 0xd97706, trim: 0xfef08a },
    ];
    bannerSpots.forEach((spot, i) => {
      const gfx = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FORTRESS + 1);
      const banner: WavingBanner = {
        gfx,
        x: spot.x,
        y: spot.y,
        width: 13,
        height: 22,
        color: spot.color,
        trimColor: spot.trim,
        phase: i * 1.2,
      };
      this.banners.push(banner);
      this.redrawBanner(banner);
    });

    // Subtle full-width warm atmospheric perspective mist to push the distant castle far back
    const haze = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FORTRESS_HAZE);
    haze.fillStyle(0xf6dfb8, 0.08);
    haze.fillRect(0, 118, GAME_WIDTH, 52);
    haze.fillStyle(0xf6dfb8, 0.13);
    haze.fillRect(0, 170, GAME_WIDTH, gateBaseY - 170);
  }

  private drawDistantSakuraCluster(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    scale: number,
  ): void {
    g.fillStyle(0x4d7c4a, 1);
    g.fillCircle(cx - 18 * scale, cy + 6 * scale, 18 * scale);
    g.fillCircle(cx + 18 * scale, cy + 8 * scale, 16 * scale);

    g.fillStyle(0xec6b99, 1);
    g.fillCircle(cx, cy - 6 * scale, 22 * scale);
    g.fillStyle(0xf497b8, 1);
    g.fillCircle(cx - 14 * scale, cy - 10 * scale, 16 * scale);
    g.fillCircle(cx + 14 * scale, cy - 8 * scale, 15 * scale);
    g.fillStyle(0xfce7f3, 0.85);
    g.fillCircle(cx - 6 * scale, cy - 16 * scale, 9 * scale);
  }

  private drawDistantWatchtower(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    baseY: number,
    scale: number,
  ): void {
    const w = Math.round(58 * scale);
    const h = Math.round(32 * scale);
    const x = Math.round(cx - w / 2);
    const y = Math.round(baseY - h);

    gfx.fillStyle(0x7c3f21, 1);
    gfx.fillRect(x + 6, y, w - 12, h);
    gfx.fillStyle(0xfef08a, 0.8);
    gfx.fillRect(cx - 8 * scale, y + 10 * scale, 6 * scale, 8 * scale);
    gfx.fillRect(cx + 2 * scale, y + 10 * scale, 6 * scale, 8 * scale);

    const roofW = Math.round(w * 1.28);
    const roofH = Math.round(18 * scale);
    const rx = Math.round(cx - roofW / 2);
    const ry = Math.round(y - roofH + 4);

    gfx.fillStyle(0x28364a, 1);
    gfx.fillTriangle(rx - 4, ry + roofH, cx, ry - 4, rx + roofW + 4, ry + roofH);
    gfx.fillStyle(0xf59e0b, 1);
    gfx.fillRect(cx - 12 * scale, ry + 1, 24 * scale, 3);
  }

  private redrawBanner(b: WavingBanner): void {
    const wave = Math.sin(this.elapsed * 3.4 + b.phase) * 2.5;
    b.gfx.clear();
    b.gfx.fillStyle(0x451a03, 1);
    b.gfx.fillRect(b.x - 1, b.y - 3, 2, b.height + 14);
    b.gfx.fillStyle(0xfbbf24, 1);
    b.gfx.fillRect(b.x - 2, b.y - 5, 4, 2);

    b.gfx.fillStyle(b.color, 1);
    b.gfx.beginPath();
    b.gfx.moveTo(b.x + 1, b.y);
    b.gfx.lineTo(b.x + 1 + b.width, b.y + 2 + wave * 0.5);
    b.gfx.lineTo(b.x + 1 + b.width - 2, b.y + b.height - 2 + wave);
    b.gfx.lineTo(b.x + 1, b.y + b.height);
    b.gfx.closePath();
    b.gfx.fillPath();

    b.gfx.fillStyle(b.trimColor, 1);
    b.gfx.fillRect(b.x + 4, b.y + 6, 4, 6);
  }

  /**
   * Builds the deep perspective-projected cobblestone marketplace street
   * stretching from the wide foreground all the way back to the distant castle gate.
   */
  private buildPlayableFloor(): void {
    const floor = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FLOOR);
    const { backY, frontY, backLeftX, backRightX, frontLeftX, frontRightX } = ARENA_BOUNDS;

    // Dark warm earthen backdrop beneath side buildings
    floor.fillStyle(0x3f3327, 1);
    floor.fillRect(0, backY - 2, GAME_WIDTH, GAME_HEIGHT - backY + 2);

    // Main sunlit sandstone plaza trapezoid
    floor.fillStyle(0xd9c49e, 1);
    this.fillPolygon(floor, [
      [backLeftX, backY],
      [backRightX, backY],
      [frontRightX, frontY],
      [frontLeftX, frontY],
    ]);

    // Central royal stone avenue runner leading straight to the distant castle gate
    floor.fillStyle(0xe2cfa9, 0.65);
    this.fillPolygon(floor, [
      [640 - 78, backY],
      [640 + 78, backY],
      [640 + 210, frontY],
      [640 - 210, frontY],
    ]);

    // Nonlinear perspective paving rows (dense near the distant gate, wide in foreground!)
    const rowCount = 16;
    const rowYs: number[] = [];
    for (let i = 0; i <= rowCount; i++) {
      const t = Math.pow(i / rowCount, 1.85);
      rowYs.push(Phaser.Math.Linear(backY, frontY, t));
    }

    for (let r = 0; r < rowCount; r++) {
      const y0 = rowYs[r];
      const y1 = rowYs[r + 1];
      const b0 = getHorizontalBoundsAtY(y0);
      const b1 = getHorizontalBoundsAtY(y1);

      if (r % 2 === 1) {
        floor.fillStyle(0xc8af86, 0.45);
        this.fillPolygon(floor, [
          [b0.left, y0],
          [b0.right, y0],
          [b1.right, y1],
          [b1.left, y1],
        ]);
      }
    }

    // Subtle sunlit distance fade near the far castle gate for extra atmospheric depth
    floor.fillStyle(0xf3dfc0, 0.2);
    this.fillPolygon(floor, [
      [backLeftX, backY],
      [backRightX, backY],
      [getHorizontalBoundsAtY(backY + 75).right, backY + 75],
      [getHorizontalBoundsAtY(backY + 75).left, backY + 75],
    ]);

    // Perspective stone paving lines (horizontal rows + converging radial seams)
    floor.lineStyle(1, 0x9b8461, 0.58);
    for (let r = 1; r < rowCount; r++) {
      const y = rowYs[r];
      const b = getHorizontalBoundsAtY(y);
      floor.lineBetween(b.left, y, b.right, y);
    }

    const colCount = 12;
    for (let c = 1; c < colCount; c++) {
      const ratio = c / colCount;
      const topX = Phaser.Math.Linear(backLeftX, backRightX, ratio);
      const botX = Phaser.Math.Linear(frontLeftX, frontRightX, ratio);
      floor.lineBetween(topX, backY, botX, frontY);
    }

    // Castle gate threshold stone steps at the rear edge (y = 228..240)
    const decals = this.scene.add.graphics().setDepth(DEPTH_LAYERS.FLOOR_DECALS);
    decals.fillStyle(0x9e9588, 1);
    decals.fillRect(640 - 66, backY, 132, 6);
    decals.fillStyle(0xbab1a3, 1);
    decals.fillRect(640 - 74, backY + 6, 148, 6);
    decals.fillStyle(0x4b3b2a, 0.25);
    decals.fillRect(backLeftX, backY, backRightX - backLeftX, 10);

    // Ornate central marketplace medallion (foreshortened 2.5D ellipse)
    const medX = 640;
    const medY = 492;
    decals.fillStyle(0xc5a87a, 0.88);
    decals.fillEllipse(medX, medY, 290, 108);
    decals.lineStyle(4, 0x9a7b4f, 0.85);
    decals.strokeEllipse(medX, medY, 290, 108);
    decals.lineStyle(2, 0xe8d5b0, 0.75);
    decals.strokeEllipse(medX, medY, 258, 94);
    decals.lineStyle(2, 0xa86432, 0.52);
    decals.strokeEllipse(medX, medY, 138, 50);

    // Side building cast shadows along the left & right curbs
    decals.fillStyle(0x2b2016, 0.22);
    this.fillPolygon(decals, [
      [backLeftX, backY],
      [backLeftX + 26, backY],
      [frontLeftX + 64, frontY],
      [frontLeftX, frontY],
    ]);
    this.fillPolygon(decals, [
      [backRightX - 26, backY],
      [backRightX, backY],
      [frontRightX, frontY],
      [frontRightX - 64, frontY],
    ]);

    // Raised tapering stone curbs framing the deep playable avenue
    floor.lineStyle(9, 0x7d7468, 1);
    floor.lineBetween(backLeftX - 4, backY, frontLeftX - 5, frontY);
    floor.lineBetween(backRightX + 4, backY, frontRightX + 5, frontY);
    floor.lineStyle(3, 0xbab0a0, 1);
    floor.lineBetween(backLeftX - 7, backY, frontLeftX - 9, frontY);
    floor.lineBetween(backRightX + 7, backY, frontRightX + 9, frontY);

    // Foreground bottom curb edge
    floor.fillStyle(0x746a5d, 1);
    floor.fillRect(0, frontY, GAME_WIDTH, 10);
    floor.fillStyle(0xa89f91, 1);
    floor.fillRect(0, frontY, GAME_WIDTH, 3);
    floor.fillStyle(0x2d241c, 1);
    floor.fillRect(0, frontY + 10, GAME_WIDTH, GAME_HEIGHT - (frontY + 10));

    // Scattered warm pixel pebbles & fallen blossom petals
    const specks: Array<[number, number, number]> = [
      [445, 298, 0xb89f78],
      [790, 304, 0xe6a1a1],
      [530, 355, 0xb89f78],
      [740, 388, 0xb89f78],
      [390, 445, 0xe6a1a1],
      [895, 456, 0xb0966e],
      [330, 585, 0xb0966e],
      [940, 610, 0xe6a1a1],
      [605, 635, 0xb0966e],
      [495, 540, 0xb0966e],
    ];
    for (const [sx, sy, col] of specks) {
      decals.fillStyle(col, 0.8);
      decals.fillRect(sx, sy, 4, 3);
    }
  }

  /**
   * Draws 3 receding perspective-projected marketplace shop bays on BOTH the
   * left and right flanks of the street, converging toward the distant castle gate.
   * This gives dramatic 3D corridor depth!
   */
  private buildRecedingSideBuildings(): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_LAYERS.SIDE_BUILDINGS_FRONT);

    // 3 depth segments from back (near castle gate) to front (near viewer)
    const segments: Array<{
      yBack: number;
      yFront: number;
      leftAwning: number;
      leftSign: string;
      rightAwning: number;
      rightSign: string;
      roofShade: number;
      wallShade: number;
    }> = [
      {
        yBack: 228,
        yFront: 326,
        leftAwning: 0x0f766e, // Teal Tea House
        leftSign: '茶',
        rightAwning: 0x1d4ed8, // Blue Armory
        rightSign: '武',
        roofShade: 0x33445c,
        wallShade: 0xdccbb0,
      },
      {
        yBack: 326,
        yFront: 476,
        leftAwning: 0xc81e1e, // Crimson Tavern
        leftSign: '酒',
        rightAwning: 0xb45309, // Amber Apothecary
        rightSign: '藥',
        roofShade: 0x2a394e,
        wallShade: 0xe6d6ba,
      },
      {
        yBack: 476,
        yFront: 692,
        leftAwning: 0x9333ea, // Silk & Cloth Shop
        leftSign: '布',
        rightAwning: 0xb91c1c, // Blacksmith / Forge
        rightSign: '鐵',
        roofShade: 0x223042,
        wallShade: 0xeddcc0,
      },
    ];

    for (const seg of segments) {
      this.drawPerspectiveSideShop(g, 'left', seg);
      this.drawPerspectiveSideShop(g, 'right', seg);
    }
  }

  private drawPerspectiveSideShop(
    g: Phaser.GameObjects.Graphics,
    side: 'left' | 'right',
    seg: {
      yBack: number;
      yFront: number;
      leftAwning: number;
      leftSign: string;
      rightAwning: number;
      rightSign: string;
      roofShade: number;
      wallShade: number;
    },
  ): void {
    const isLeft = side === 'left';
    const bBack = getHorizontalBoundsAtY(seg.yBack);
    const bFront = getHorizontalBoundsAtY(seg.yFront);

    // Street curb contact X at back & front of this shop bay
    const curbBackX = isLeft ? bBack.left - 8 : bBack.right + 8;
    const curbFrontX = isLeft ? bFront.left - 10 : bFront.right + 10;
    const outerX = isLeft ? 0 : GAME_WIDTH;

    // Perspective building wall height scales smoothly with depth
    const hBack = 86 * getPerspectiveScale(seg.yBack) * 1.18;
    const hFront = 112 * getPerspectiveScale(seg.yFront) * 1.18;

    const wallTopBackY = seg.yBack - hBack;
    const wallTopFrontY = seg.yFront - hFront;

    // 1. Solid outer building mass extending to screen edge
    g.fillStyle(seg.wallShade, 1);
    this.fillPolygon(g, [
      [outerX, wallTopBackY],
      [curbBackX, wallTopBackY],
      [curbFrontX, wallTopFrontY],
      [outerX, wallTopFrontY],
    ]);
    this.fillPolygon(g, [
      [outerX, wallTopFrontY],
      [curbFrontX, wallTopFrontY],
      [curbFrontX, seg.yFront],
      [outerX, seg.yFront],
    ]);
    // Main angled street-facing wall quad
    g.fillStyle(seg.wallShade, 1);
    this.fillPolygon(g, [
      [curbBackX, wallTopBackY],
      [curbFrontX, wallTopFrontY],
      [curbFrontX, seg.yFront],
      [curbBackX, seg.yBack],
    ]);

    // Lower wooden wainscot along the curb
    const wainBackY = seg.yBack - hBack * 0.30;
    const wainFrontY = seg.yFront - hFront * 0.30;
    g.fillStyle(0x6e4326, 1);
    this.fillPolygon(g, [
      [curbBackX, wainBackY],
      [curbFrontX, wainFrontY],
      [curbFrontX, seg.yFront],
      [curbBackX, seg.yBack],
    ]);

    // Warm glowing lattice window inset along the angled facade
    const winT0 = 0.16;
    const winT1 = 0.84;
    const wx0 = Phaser.Math.Linear(curbBackX, curbFrontX, winT0);
    const wx1 = Phaser.Math.Linear(curbBackX, curbFrontX, winT1);
    const wyTop0 =
      Phaser.Math.Linear(wallTopBackY, wallTopFrontY, winT0) +
      Phaser.Math.Linear(hBack, hFront, winT0) * 0.18;
    const wyTop1 =
      Phaser.Math.Linear(wallTopBackY, wallTopFrontY, winT1) +
      Phaser.Math.Linear(hBack, hFront, winT1) * 0.18;
    const wyBot0 = Phaser.Math.Linear(wainBackY, wainFrontY, winT0) - 4;
    const wyBot1 = Phaser.Math.Linear(wainBackY, wainFrontY, winT1) - 4;

    g.fillStyle(0x451a03, 1);
    this.fillPolygon(g, [
      [wx0, wyTop0],
      [wx1, wyTop1],
      [wx1, wyBot1],
      [wx0, wyBot0],
    ]);
    g.fillStyle(0xfde68a, 0.88);
    this.fillPolygon(g, [
      [wx0 + (isLeft ? 3 : -3), wyTop0 + 3],
      [wx1 + (isLeft ? -3 : 3), wyTop1 + 3],
      [wx1 + (isLeft ? -3 : 3), wyBot1 - 3],
      [wx0 + (isLeft ? 3 : -3), wyBot0 - 3],
    ]);

    // Red lacquered timber corner pillars
    g.lineStyle(6, 0x991b1b, 1);
    g.lineBetween(curbBackX, wallTopBackY, curbBackX, seg.yBack);
    g.lineBetween(curbFrontX, wallTopFrontY, curbFrontX, seg.yFront);

    // 2. Colorful striped cloth awning overhanging slightly into the street
    const awningColor = isLeft ? seg.leftAwning : seg.rightAwning;
    const awningOutBack = isLeft ? 18 : -18;
    const awningOutFront = isLeft ? 32 : -32;
    const awnTopBackY = seg.yBack - hBack * 0.56;
    const awnTopFrontY = seg.yFront - hFront * 0.56;
    const awnBotBackY = awnTopBackY + 12 * getPerspectiveScale(seg.yBack);
    const awnBotFrontY = awnTopFrontY + 15 * getPerspectiveScale(seg.yFront);

    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      const s0 = i / stripes;
      const s1 = (i + 1) / stripes;
      const xIn0 = Phaser.Math.Linear(curbBackX, curbFrontX, s0);
      const xIn1 = Phaser.Math.Linear(curbBackX, curbFrontX, s1);
      const xOut0 = xIn0 + Phaser.Math.Linear(awningOutBack, awningOutFront, s0);
      const xOut1 = xIn1 + Phaser.Math.Linear(awningOutBack, awningOutFront, s1);

      const yIn0 = Phaser.Math.Linear(awnTopBackY, awnTopFrontY, s0);
      const yIn1 = Phaser.Math.Linear(awnTopBackY, awnTopFrontY, s1);
      const yOut0 = Phaser.Math.Linear(awnBotBackY, awnBotFrontY, s0);
      const yOut1 = Phaser.Math.Linear(awnBotBackY, awnBotFrontY, s1);

      g.fillStyle(i % 2 === 0 ? awningColor : 0xfef3c7, 1);
      this.fillPolygon(g, [
        [xIn0, yIn0],
        [xIn1, yIn1],
        [xOut1, yOut1],
        [xOut0, yOut0],
      ]);
    }

    // 3. Sleeker perspective dark-slate tiled roof with crisp ridge dividers
    const eaveOutBack = isLeft ? 12 : -12;
    const eaveOutFront = isLeft ? 20 : -20;
    const ridgeBackY = wallTopBackY - 18 * getPerspectiveScale(seg.yBack);
    const ridgeFrontY = wallTopFrontY - 24 * getPerspectiveScale(seg.yFront);
    const roofOuterBackX = isLeft ? Math.max(0, curbBackX - 180) : Math.min(GAME_WIDTH, curbBackX + 180);
    const roofOuterFrontX = isLeft ? Math.max(0, curbFrontX - 240) : Math.min(GAME_WIDTH, curbFrontX + 240);

    g.fillStyle(seg.roofShade, 1);
    this.fillPolygon(g, [
      [roofOuterBackX, ridgeBackY],
      [curbBackX + eaveOutBack, wallTopBackY + 4],
      [curbFrontX + eaveOutFront, wallTopFrontY + 6],
      [roofOuterFrontX, ridgeFrontY],
    ]);
    // Crisp sunlit tile highlight & gold eave fascia
    g.lineStyle(3, 0xf59e0b, 0.92);
    g.lineBetween(
      curbBackX + eaveOutBack,
      wallTopBackY + 4,
      curbFrontX + eaveOutFront,
      wallTopFrontY + 6,
    );
    // Dividing gable ridge between adjacent shops
    g.lineStyle(2, 0x94a3b8, 0.65);
    g.lineBetween(curbBackX + eaveOutBack, wallTopBackY + 4, roofOuterBackX, ridgeBackY);
    g.lineBetween(curbFrontX + eaveOutFront, wallTopFrontY + 6, roofOuterFrontX, ridgeFrontY);
    // Subtle tiled roof rib lines
    g.lineStyle(1, 0x16202e, 0.55);
    for (let r = 1; r < 5; r++) {
      const rt = r / 5;
      const rx = Phaser.Math.Linear(curbBackX + eaveOutBack, curbFrontX + eaveOutFront, rt);
      const ry = Phaser.Math.Linear(wallTopBackY + 4, wallTopFrontY + 6, rt);
      const rOutX = Phaser.Math.Linear(roofOuterBackX, roofOuterFrontX, rt);
      const rOutY = Phaser.Math.Linear(ridgeBackY, ridgeFrontY, rt);
      g.lineBetween(rx, ry, rOutX, rOutY);
    }

    // 4. Hanging shop sign near the center of each shop bay
    const midY = (seg.yBack + seg.yFront) * 0.5;
    const midScale = getPerspectiveScale(midY);
    const signX =
      Phaser.Math.Linear(curbBackX, curbFrontX, 0.5) + (isLeft ? 18 : -18) * midScale;
    const signY = Phaser.Math.Linear(awnBotBackY, awnBotFrontY, 0.5) + 12 * midScale;
    const signSize = Math.round(22 * midScale);

    if (signSize >= 12) {
      g.fillStyle(0x451a03, 1);
      g.fillRect(signX - signSize / 2 - 2, signY - signSize / 2 - 2, signSize + 4, signSize + 4);
      g.fillStyle(awningColor, 1);
      g.fillRect(signX - signSize / 2, signY - signSize / 2, signSize, signSize);
      g.lineStyle(1, 0xfbbf24, 1);
      g.strokeRect(signX - signSize / 2, signY - signSize / 2, signSize, signSize);

      this.scene.add
        .text(signX, signY, isLeft ? seg.leftSign : seg.rightSign, {
          fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, serif',
          fontSize: `${Math.max(10, Math.round(13 * midScale))}px`,
          fontStyle: 'bold',
          color: '#fef08a',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_LAYERS.SIDE_BUILDINGS_FRONT + 2);
    }
  }

  private buildDepthSortedProps(): void {
    // Receding props lining the deep avenue flanks from the distant castle gate to foreground
    const layout: Array<{
      id: string;
      kind: PropKind;
      x: number;
      y: number;
      radius: number;
      destructible: boolean;
    }> = [
      // Distant stone lanterns flanking the castle gate entrance (small ~0.50x scale!)
      { id: 'gate_lantern_left', kind: 'stone_lantern', x: 526, y: 254, radius: 13, destructible: false },
      { id: 'gate_lantern_right', kind: 'stone_lantern', x: 754, y: 254, radius: 13, destructible: false },
      // Mid-avenue market stalls (~0.66x scale)
      { id: 'left_fruit_stall', kind: 'stall_fruit', x: 306, y: 368, radius: 28, destructible: true },
      { id: 'right_weapon_stall', kind: 'stall_weapons', x: 974, y: 368, radius: 28, destructible: true },
      // Foreground market clusters (~1.00x scale)
      { id: 'left_wine_jars', kind: 'wine_jars', x: 186, y: 562, radius: 22, destructible: true },
      { id: 'right_crate_stack', kind: 'crate_stack', x: 1094, y: 566, radius: 24, destructible: true },
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
        g.fillStyle(0x000000, 0.28);
        g.fillEllipse(0, 2, 34, 14);
        g.fillStyle(0x78716c, 1);
        g.fillRect(-10, -8, 20, 10);
        g.fillStyle(0xa8a29e, 1);
        g.fillRect(-6, -34, 12, 26);
        g.fillStyle(0x57534e, 1);
        g.fillRect(-11, -50, 22, 16);
        g.fillStyle(0xfef08a, 0.95);
        g.fillRect(-7, -46, 14, 10);
        g.fillStyle(0x44403c, 1);
        g.fillRect(-15, -56, 30, 6);
        g.fillRect(-9, -61, 18, 5);
        break;
      }
      case 'stall_fruit': {
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 4, 86, 28);
        g.fillStyle(0x78350f, 1);
        g.fillRect(-34, -26, 68, 28);
        g.fillStyle(0x92400e, 1);
        g.fillRect(-36, -30, 72, 8);
        g.fillStyle(0xfbbf24, 1);
        g.fillCircle(-18, -32, 7);
        g.fillStyle(0xf97316, 1);
        g.fillCircle(-12, -31, 6);
        g.fillStyle(0xef4444, 1);
        g.fillCircle(4, -32, 7);
        g.fillStyle(0x22c55e, 1);
        g.fillCircle(20, -32, 7);
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
        g.fillStyle(0x5c3317, 1);
        g.fillRect(-32, -16, 64, 18);
        g.fillStyle(0x78350f, 1);
        g.fillRect(-28, -54, 6, 40);
        g.fillRect(22, -54, 6, 40);
        g.fillRect(-30, -44, 60, 5);
        for (let sx = -18; sx <= 18; sx += 12) {
          g.fillStyle(0x92400e, 1);
          g.fillRect(sx - 1, -68, 3, 56);
          g.fillStyle(0xe2e8f0, 1);
          g.fillTriangle(sx - 3, -68, sx + 4, -68, sx + 0.5, -80);
          g.fillStyle(0xdc2626, 1);
          g.fillRect(sx - 3, -67, 7, 4);
        }
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

  /**
   * 3 receding tiers of strung red Chinese paper lanterns across the street
   * (far near castle gate, mid-avenue, foreground top) for strong 3D depth.
   */
  private buildOverheadLanternTiers(): void {
    const tiers = [
      {
        startX: 295,
        endX: 985,
        y: 174,
        sag: 14,
        scale: 0.48,
        count: 4,
        depth: DEPTH_LAYERS.OVERHEAD_LANTERNS - 20,
      },
      {
        startX: 0,
        endX: GAME_WIDTH,
        y: 112,
        sag: 24,
        scale: 0.74,
        count: 5,
        depth: DEPTH_LAYERS.OVERHEAD_LANTERNS - 10,
      },
      {
        startX: 0,
        endX: GAME_WIDTH,
        y: 26,
        sag: 30,
        scale: 1.02,
        count: 5,
        depth: DEPTH_LAYERS.OVERHEAD_LANTERNS,
      },
    ];

    tiers.forEach((tier, tierIdx) => {
      const rope = this.scene.add.graphics().setDepth(tier.depth - 1);
      rope.lineStyle(Math.max(1, 2 * tier.scale), 0x3b1f0e, 0.78);
      rope.beginPath();
      const span = tier.endX - tier.startX;
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        const rx = tier.startX + span * u;
        const ry = tier.y + Math.sin(u * Math.PI) * tier.sag;
        if (i === 0) rope.moveTo(rx, ry);
        else rope.lineTo(rx, ry);
      }
      rope.strokePath();

      for (let i = 0; i < tier.count; i++) {
        // Keep lanterns inside [0.22 .. 0.78] on the front tier so HUD corners stay clear
        const u =
          tierIdx === 2
            ? Phaser.Math.Linear(0.24, 0.76, i / (tier.count - 1))
            : Phaser.Math.Linear(0.18, 0.82, i / (tier.count - 1));
        const lx = tier.startX + span * u;
        const ly = tier.y + Math.sin(u * Math.PI) * tier.sag;

        const container = this.scene.add.container(lx, ly);
        container.setScale(tier.scale);
        container.setDepth(tier.depth);

        const g = this.scene.add.graphics();
        g.fillStyle(0xf97316, 0.2);
        g.fillCircle(0, 17, 21);
        g.fillStyle(0x451a03, 1);
        g.fillRect(-1, 0, 2, 7);
        g.fillStyle(0xdc2626, 1);
        g.fillEllipse(0, 16, 22, 17);
        g.fillStyle(0xfef08a, 0.55);
        g.fillEllipse(0, 16, 10, 13);
        g.fillStyle(0xfbbf24, 1);
        g.fillRect(-6, 6, 12, 3);
        g.fillRect(-6, 24, 12, 3);
        g.fillStyle(0xef4444, 1);
        g.fillRect(-1, 27, 2, 8);

        container.add(g);
        this.lanterns.push({
          container,
          baseX: lx,
          baseY: ly,
          phase: tierIdx * 1.4 + i * 0.85,
          swayAmp: 2.5 * tier.scale,
        });
      }
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
      scale: { start: 1.0, end: 0.65 },
      alpha: { start: 0.85, end: 0 },
      rotate: { min: 0, max: 360 },
      frequency: 420,
      quantity: 1,
    });
    this.petalEmitter.setDepth(DEPTH_LAYERS.AMBIENT_PARTICLES);
  }

  private fillPolygon(
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
}
