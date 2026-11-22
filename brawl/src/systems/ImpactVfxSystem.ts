import Phaser from 'phaser';
import { AttackType } from '../config/combatConfig';
import { getDepthOrder, getPerspectiveScale } from '../core/Perspective';
import { IGameSystem, SystemContext } from './ModuleRegistry';

interface PooledSprite {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  vx: number;
  vy: number;
  vz: number;
  z: number;
  lifeMs: number;
  maxLifeMs: number;
  startScale: number;
  endScale: number;
  spin: number;
  gravity: number;
}

/**
 * Reusable, object-pooled pixel-art combat VFX system.
 * Produces directional spear trails, crisp impact flashes, sparks,
 * heavy motion streaks, and knockdown landing dust without GC spikes.
 */
export class ImpactVfxSystem implements IGameSystem {
  public readonly id = 'impact-vfx';

  private scene?: Phaser.Scene;
  private readonly sparkPool: PooledSprite[] = [];
  private readonly dustPool: PooledSprite[] = [];

  public init(ctx: SystemContext): void {
    this.scene = ctx.scene;
    this.prewarmPool(this.sparkPool, 'spark_particle', 48);
    this.prewarmPool(this.dustPool, 'dust_puff', 32);
  }

  public update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) * 0.001;
    this.stepPool(this.sparkPool, dt, delta);
    this.stepPool(this.dustPool, dt, delta);
  }

  /**
   * Directional spear trail & motion streaks fired when an attack enters ACTIVE frames.
   */
  public spawnSpearTrail(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    attackType: AttackType,
    range: number,
  ): void {
    if (!this.scene) return;
    const scale = getPerspectiveScale(y);
    const angle = Math.atan2(dirY, dirX);
    const g = this.scene.add.graphics();
    g.setPosition(x, y - 24 * scale);
    g.setDepth(getDepthOrder(y) + 25);

    const visualRange = range * scale;

    if (attackType === 'HEAVY') {
      // Bold blue spear thrust lance + bright core + stylized speed motion streaks
      const ex = Math.cos(angle) * visualRange * 1.05;
      const ey = Math.sin(angle) * visualRange * 0.72;
      const sx = Math.cos(angle) * 14 * scale;
      const sy = Math.sin(angle) * 10 * scale;

      g.lineStyle(18 * scale, 0x0284c7, 0.52);
      g.lineBetween(sx, sy, ex, ey);
      g.lineStyle(9 * scale, 0x38bdf8, 0.88);
      g.lineBetween(sx, sy, ex, ey);
      g.lineStyle(4 * scale, 0xf0f9ff, 1);
      g.lineBetween(sx, sy, ex, ey);

      // Stylized parallel speed streaks
      const perpX = -Math.sin(angle);
      const perpY = Math.cos(angle) * 0.72;
      for (const side of [-1, 1]) {
        const ox = perpX * 18 * scale * side;
        const oy = perpY * 18 * scale * side;
        g.lineStyle(2.5 * scale, 0xbae6fd, 0.75);
        g.lineBetween(sx + ox, sy + oy, ex * 0.85 + ox, ey * 0.85 + oy);
      }

      // Dust kickback at feet from heavy lunge
      this.spawnDustBurst(x, y + 2, -dirX, -dirY, 5, scale);
    } else if (attackType === 'LIGHT_3') {
      // Larger cyan-blue finishing crescent arc + thrust beam
      const radius = visualRange * 0.82;
      g.lineStyle(13 * scale, 0x0ea5e9, 0.55);
      g.beginPath();
      g.arc(0, 0, radius, angle - 0.85, angle + 0.85, false);
      g.strokePath();

      g.lineStyle(6 * scale, 0x7dd3fc, 0.95);
      g.beginPath();
      g.arc(0, 0, radius, angle - 0.78, angle + 0.78, false);
      g.strokePath();

      const ex = Math.cos(angle) * visualRange;
      const ey = Math.sin(angle) * visualRange * 0.72;
      g.lineStyle(5 * scale, 0xe0f2fe, 0.9);
      g.lineBetween(0, 0, ex, ey);
    } else {
      // Crisp short blue spear slash arc (LIGHT_1 / LIGHT_2)
      const radius = visualRange * (attackType === 'LIGHT_2' ? 0.74 : 0.66);
      const sweep = attackType === 'LIGHT_2' ? 0.68 : 0.56;
      g.lineStyle(9 * scale, 0x0ea5e9, 0.5);
      g.beginPath();
      g.arc(0, 0, radius, angle - sweep, angle + sweep, false);
      g.strokePath();

      g.lineStyle(4 * scale, 0xbae6fd, 0.92);
      g.beginPath();
      g.arc(0, 0, radius, angle - sweep * 0.88, angle + sweep * 0.88, false);
      g.strokePath();
    }

    const duration = attackType === 'HEAVY' ? 170 : attackType === 'LIGHT_3' ? 145 : 105;
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: attackType === 'HEAVY' ? 1.15 : 1.08,
      scaleY: attackType === 'HEAVY' ? 1.15 : 1.08,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  /**
   * Synchronized contact flash + directional sparks + damage popup at the moment of impact.
   */
  public spawnHitImpact(
    x: number,
    y: number,
    elevationZ: number,
    dirX: number,
    dirY: number,
    attackType: AttackType,
    damage: number,
  ): void {
    if (!this.scene) return;
    const scale = getPerspectiveScale(y);
    const impactY = y - (26 + elevationZ) * scale;
    const depth = getDepthOrder(y) + 40;

    // 1. Crisp impact flash / starburst
    const flash = this.scene.add.graphics();
    flash.setPosition(x, impactY);
    flash.setDepth(depth);

    if (attackType === 'HEAVY') {
      // Large white/yellow starburst + shock ring
      flash.fillStyle(0xfef08a, 0.92);
      this.drawStarburst(flash, 34 * scale, 13 * scale, 8);
      flash.fillStyle(0xffffff, 1);
      flash.fillCircle(0, 0, 14 * scale);
      flash.lineStyle(3 * scale, 0x38bdf8, 0.9);
      flash.strokeCircle(0, 0, 26 * scale);
    } else if (attackType === 'LIGHT_3') {
      flash.fillStyle(0xbae6fd, 0.9);
      this.drawStarburst(flash, 25 * scale, 10 * scale, 6);
      flash.fillStyle(0xffffff, 1);
      flash.fillCircle(0, 0, 10 * scale);
    } else {
      flash.fillStyle(0xffffff, 0.95);
      this.drawStarburst(flash, 16 * scale, 6 * scale, 4);
    }

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: attackType === 'HEAVY' ? 1.45 : 1.25,
      duration: attackType === 'HEAVY' ? 160 : 105,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    // 2. Pooled directional sparks
    const sparkCount = attackType === 'HEAVY' ? 12 : attackType === 'LIGHT_3' ? 8 : 5;
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < sparkCount; i++) {
      const spread = (Math.random() - 0.5) * (attackType === 'HEAVY' ? 1.5 : 1.2);
      const ang = baseAngle + spread;
      const spd =
        (attackType === 'HEAVY' ? 280 : attackType === 'LIGHT_3' ? 210 : 150) *
        (0.65 + Math.random() * 0.65);
      const tint =
        attackType === 'HEAVY'
          ? i % 2 === 0
            ? 0xfef08a
            : 0xffffff
          : i % 2 === 0
            ? 0x7dd3fc
            : 0xffffff;

      this.acquireParticle(this.sparkPool, {
        x,
        y: impactY,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.7,
        vz: 80 + Math.random() * 140,
        lifeMs: attackType === 'HEAVY' ? 260 : 180,
        startScale: (attackType === 'HEAVY' ? 1.45 : 1.0) * scale,
        endScale: 0.2 * scale,
        depth: depth + 1,
        tint,
        gravity: 520,
      });
    }

    if (attackType === 'HEAVY') {
      this.spawnDustBurst(x, y + 2, dirX, dirY, 7, scale);
    }

    // 3. Punchy floating damage number
    const color =
      attackType === 'HEAVY'
        ? '#fde047'
        : attackType === 'LIGHT_3'
          ? '#7dd3fc'
          : '#ffffff';
    const fontSize = attackType === 'HEAVY' ? 22 : attackType === 'LIGHT_3' ? 18 : 15;
    const dmgText = this.scene.add
      .text(x + Phaser.Math.Between(-8, 8), impactY - 14 * scale, `${damage}`, {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color,
        stroke: '#1c120c',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(depth + 5);

    this.scene.tweens.add({
      targets: dmgText,
      y: dmgText.y - 26 * scale,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    });
  }

  /**
   * Visible cobblestone dust ring when a launched enemy slams onto the ground.
   */
  public spawnLandingImpact(x: number, y: number, strong = true): void {
    if (!this.scene) return;
    const scale = getPerspectiveScale(y);
    const count = strong ? 8 : 4;

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const spd = (strong ? 95 : 55) * (0.7 + Math.random() * 0.5) * scale;
      this.acquireParticle(this.dustPool, {
        x: x + Math.cos(ang) * 8 * scale,
        y: y + Math.sin(ang) * 4 * scale,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.45,
        vz: 35 + Math.random() * 35,
        lifeMs: strong ? 340 : 220,
        startScale: (strong ? 0.9 : 0.6) * scale,
        endScale: (strong ? 1.5 : 1.0) * scale,
        depth: getDepthOrder(y) - 1,
        tint: 0xf2e3c6,
        gravity: 160,
      });
    }
  }

  public spawnPlayerHitFlash(x: number, y: number): void {
    if (!this.scene) return;
    const scale = getPerspectiveScale(y);
    const flash = this.scene.add.graphics();
    flash.setPosition(x, y - 28 * scale);
    flash.setDepth(getDepthOrder(y) + 40);
    flash.fillStyle(0xf87171, 0.85);
    this.drawStarburst(flash, 22 * scale, 8 * scale, 6);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.3,
      duration: 140,
      onComplete: () => flash.destroy(),
    });
  }

  private spawnDustBurst(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    count: number,
    scale: number,
  ): void {
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < count; i++) {
      const ang = baseAngle + (Math.random() - 0.5) * 1.4;
      const spd = (75 + Math.random() * 75) * scale;
      this.acquireParticle(this.dustPool, {
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.55,
        vz: 28 + Math.random() * 32,
        lifeMs: 280,
        startScale: 0.75 * scale,
        endScale: 1.35 * scale,
        depth: getDepthOrder(y) - 1,
        tint: 0xf2e3c6,
        gravity: 120,
      });
    }
  }

  private drawStarburst(
    g: Phaser.GameObjects.Graphics,
    outerR: number,
    innerR: number,
    points: number,
  ): void {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const ang = (i * Math.PI) / points;
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
  }

  private prewarmPool(pool: PooledSprite[], textureKey: string, count: number): void {
    if (!this.scene || !this.scene.textures.exists(textureKey)) return;
    for (let i = 0; i < count; i++) {
      const sprite = this.scene.add.image(-999, -999, textureKey);
      sprite.setVisible(false);
      pool.push({
        sprite,
        active: false,
        vx: 0,
        vy: 0,
        vz: 0,
        z: 0,
        lifeMs: 0,
        maxLifeMs: 1,
        startScale: 1,
        endScale: 0.5,
        spin: 0,
        gravity: 0,
      });
    }
  }

  private acquireParticle(
    pool: PooledSprite[],
    cfg: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      vz: number;
      lifeMs: number;
      startScale: number;
      endScale: number;
      depth: number;
      tint: number;
      gravity: number;
    },
  ): void {
    const item = pool.find((p) => !p.active);
    if (!item) return;
    item.active = true;
    item.vx = cfg.vx;
    item.vy = cfg.vy;
    item.vz = cfg.vz;
    item.z = 0;
    item.lifeMs = cfg.lifeMs;
    item.maxLifeMs = cfg.lifeMs;
    item.startScale = cfg.startScale;
    item.endScale = cfg.endScale;
    item.spin = (Math.random() - 0.5) * 8;
    item.gravity = cfg.gravity;

    item.sprite.setPosition(cfg.x, cfg.y);
    item.sprite.setScale(cfg.startScale);
    item.sprite.setAlpha(0.95);
    item.sprite.setTint(cfg.tint);
    item.sprite.setDepth(cfg.depth);
    item.sprite.setVisible(true);
  }

  private stepPool(pool: PooledSprite[], dt: number, deltaMs: number): void {
    for (const p of pool) {
      if (!p.active) continue;
      p.lifeMs -= deltaMs;
      if (p.lifeMs <= 0) {
        p.active = false;
        p.sprite.setVisible(false);
        continue;
      }

      p.vz -= p.gravity * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += (p.vy - p.vz) * dt;
      p.sprite.rotation += p.spin * dt;

      const t = 1 - p.lifeMs / p.maxLifeMs;
      const s = Phaser.Math.Linear(p.startScale, p.endScale, t);
      p.sprite.setScale(s);
      p.sprite.setAlpha(1 - t);
    }
  }

  public destroy(): void {
    for (const p of this.sparkPool) p.sprite.destroy();
    for (const p of this.dustPool) p.sprite.destroy();
    this.sparkPool.length = 0;
    this.dustPool.length = 0;
    this.scene = undefined;
  }
}
