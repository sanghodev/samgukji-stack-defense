import Phaser from 'phaser';
import { MayhemTuning } from '../config/mayhemConfig';
import { getDepthOrder, getPerspectiveScale } from '../core/Perspective';
import { IGameSystem, SystemContext } from './ModuleRegistry';

export type DebrisPreset =
  | 'WOOD_SPLINTERS'
  | 'CERAMIC_SHARDS'
  | 'DUST_CLOUD'
  | 'WATER_SPLASH'
  | 'FRUIT_SCATTER'
  | 'HEAVY_IMPACT_SPARK'
  | 'LANDING_DUST';

interface PooledDebris {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  spin: number;
  lifeMs: number;
  maxLifeMs: number;
  bounces: number;
  baseScale: number;
  fadeOut: boolean;
}

/**
 * Pooled pixel-art particle & debris preset manager.
 * Keeps decorative fragments lightweight & capped for steady 60 FPS during chaotic chains.
 */
export class DebrisEffectManager implements IGameSystem {
  public readonly id = 'debris-effects';

  private scene?: Phaser.Scene;
  private readonly tuning: MayhemTuning;
  private readonly pool: PooledDebris[] = [];
  private readonly maxPoolSize = 110;

  constructor(tuning: MayhemTuning) {
    this.tuning = tuning;
  }

  public init(ctx: SystemContext): void {
    this.scene = ctx.scene;
    for (let i = 0; i < this.maxPoolSize; i++) {
      const sprite = ctx.scene.add.image(-999, -999, 'debris_wood');
      sprite.setVisible(false);
      this.pool.push({
        sprite,
        active: false,
        x: -999,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 780,
        spin: 0,
        lifeMs: 0,
        maxLifeMs: 1,
        bounces: 0,
        baseScale: 1,
        fadeOut: true,
      });
    }
  }

  public spawn(
    preset: DebrisPreset,
    x: number,
    y: number,
    dirX = 0,
    dirY = 0,
  ): void {
    if (!this.scene || this.tuning.particleIntensity <= 0.05) return;

    const scale = getPerspectiveScale(y);
    const intensity = Phaser.Math.Clamp(this.tuning.particleIntensity, 0.2, 2.0);
    const baseAngle = Math.hypot(dirX, dirY) > 0.05 ? Math.atan2(dirY, dirX) : 0;
    const hasDir = Math.hypot(dirX, dirY) > 0.05;

    switch (preset) {
      case 'WOOD_SPLINTERS': {
        const count = Math.round(12 * intensity);
        for (let i = 0; i < count; i++) {
          const ang = hasDir ? baseAngle + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
          const spd = (110 + Math.random() * 190) * scale;
          this.acquire('debris_wood', {
            x,
            y,
            z: 10 + Math.random() * 18,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.65,
            vz: 160 + Math.random() * 170,
            gravity: 860,
            spin: (Math.random() - 0.5) * 18,
            lifeMs: 750 + Math.random() * 450,
            bounces: 1,
            scale: (0.85 + Math.random() * 0.55) * scale,
            tint: i % 2 === 0 ? 0xd97706 : 0x92400e,
          });
        }
        break;
      }

      case 'CERAMIC_SHARDS': {
        const count = Math.round(11 * intensity);
        for (let i = 0; i < count; i++) {
          const ang = hasDir ? baseAngle + (Math.random() - 0.5) * 2.5 : Math.random() * Math.PI * 2;
          const spd = (95 + Math.random() * 170) * scale;
          this.acquire('debris_ceramic', {
            x,
            y,
            z: 8 + Math.random() * 14,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.65,
            vz: 150 + Math.random() * 150,
            gravity: 920,
            spin: (Math.random() - 0.5) * 22,
            lifeMs: 650 + Math.random() * 350,
            bounces: 1,
            scale: (0.8 + Math.random() * 0.45) * scale,
            tint: i % 3 === 0 ? 0xfdba74 : 0xc2410c,
          });
        }
        break;
      }

      case 'WATER_SPLASH': {
        const count = Math.round(14 * intensity);
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = (70 + Math.random() * 155) * scale;
          this.acquire('debris_water', {
            x,
            y,
            z: 6 + Math.random() * 12,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.6,
            vz: 150 + Math.random() * 150,
            gravity: 780,
            spin: 0,
            lifeMs: 420 + Math.random() * 240,
            bounces: 0,
            scale: (0.8 + Math.random() * 0.6) * scale,
            tint: i % 2 === 0 ? 0x38bdf8 : 0xe0f2fe,
          });
        }
        break;
      }

      case 'FRUIT_SCATTER': {
        const colors = [0xef4444, 0xf97316, 0xfacc15, 0x22c55e];
        const count = Math.round(10 * intensity);
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = (80 + Math.random() * 150) * scale;
          this.acquire('debris_fruit', {
            x,
            y,
            z: 10 + Math.random() * 12,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.65,
            vz: 140 + Math.random() * 145,
            gravity: 760,
            spin: (Math.random() - 0.5) * 14,
            lifeMs: 1100 + Math.random() * 600,
            bounces: 2,
            scale: (0.9 + Math.random() * 0.35) * scale,
            tint: colors[i % colors.length],
          });
        }
        break;
      }

      case 'DUST_CLOUD':
      case 'LANDING_DUST': {
        const count = Math.round((preset === 'DUST_CLOUD' ? 8 : 6) * intensity);
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const spd = (55 + Math.random() * 75) * scale;
          this.acquire('dust_puff', {
            x,
            y,
            z: 2,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.5,
            vz: 30 + Math.random() * 35,
            gravity: 140,
            spin: (Math.random() - 0.5) * 5,
            lifeMs: 360 + Math.random() * 160,
            bounces: 0,
            scale: (0.85 + Math.random() * 0.5) * scale,
            tint: 0xf2e3c6,
          });
        }
        break;
      }

      case 'HEAVY_IMPACT_SPARK': {
        const count = Math.round(10 * intensity);
        for (let i = 0; i < count; i++) {
          const ang = hasDir ? baseAngle + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
          const spd = (170 + Math.random() * 190) * scale;
          this.acquire('spark_particle', {
            x,
            y,
            z: 18,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd * 0.65,
            vz: 90 + Math.random() * 120,
            gravity: 540,
            spin: (Math.random() - 0.5) * 15,
            lifeMs: 240 + Math.random() * 120,
            bounces: 0,
            scale: (1.15 + Math.random() * 0.45) * scale,
            tint: i % 2 === 0 ? 0xfef08a : 0xffffff,
          });
        }
        break;
      }
    }
  }

  public clearAll(): void {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.setVisible(false);
    }
  }

  public update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) * 0.001;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.lifeMs -= delta;
      if (p.lifeMs <= 0) {
        p.active = false;
        p.sprite.setVisible(false);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.gravity * dt;
      p.z += p.vz * dt;

      if (p.z <= 0) {
        p.z = 0;
        if (p.bounces > 0 && Math.abs(p.vz) > 65) {
          p.vz = Math.abs(p.vz) * 0.42;
          p.vx *= 0.62;
          p.vy *= 0.62;
          p.bounces -= 1;
        } else {
          p.vz = 0;
          p.vx *= Math.exp(-9 * dt);
          p.vy *= Math.exp(-9 * dt);
          p.spin *= 0.8;
        }
      }

      p.sprite.setPosition(p.x, p.y - p.z);
      p.sprite.setDepth(getDepthOrder(p.y) + 2);
      p.sprite.rotation += p.spin * dt;

      const fadeRatio = Math.min(1, p.lifeMs / Math.min(260, p.maxLifeMs));
      p.sprite.setAlpha(fadeRatio);
    }
  }

  private acquire(
    textureKey: string,
    cfg: {
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      gravity: number;
      spin: number;
      lifeMs: number;
      bounces: number;
      scale: number;
      tint: number;
    },
  ): void {
    if (!this.scene || !this.scene.textures.exists(textureKey)) return;
    const slot = this.pool.find((p) => !p.active);
    if (!slot) return;

    slot.active = true;
    slot.x = cfg.x;
    slot.y = cfg.y;
    slot.z = cfg.z;
    slot.vx = cfg.vx;
    slot.vy = cfg.vy;
    slot.vz = cfg.vz;
    slot.gravity = cfg.gravity;
    slot.spin = cfg.spin;
    slot.lifeMs = cfg.lifeMs;
    slot.maxLifeMs = cfg.lifeMs;
    slot.bounces = cfg.bounces;
    slot.baseScale = cfg.scale;

    slot.sprite.setTexture(textureKey);
    slot.sprite.setPosition(cfg.x, cfg.y - cfg.z);
    slot.sprite.setScale(cfg.scale);
    slot.sprite.setTint(cfg.tint);
    slot.sprite.setAlpha(1);
    slot.sprite.setDepth(getDepthOrder(cfg.y) + 2);
    slot.sprite.setVisible(true);
  }

  public destroy(): void {
    for (const p of this.pool) p.sprite.destroy();
    this.pool.length = 0;
    this.scene = undefined;
  }
}
