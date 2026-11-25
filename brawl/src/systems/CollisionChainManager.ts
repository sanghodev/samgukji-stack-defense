import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { MayhemTuning } from '../config/mayhemConfig';
import {
  computeChainImpulse,
  evaluateSlipTrigger,
  sweptCircleHit25D,
} from '../core/MayhemPhysics';
import { getDepthOrder, getPerspectiveScale } from '../core/Perspective';
import { Bandit } from '../entities/Bandit';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { SurfaceHazard } from '../entities/SurfaceHazard';
import { CombatAudioManager } from './CombatAudioManager';
import { CombatCoordinator } from './CombatCoordinator';
import { DebrisEffectManager } from './DebrisEffectManager';
import { HitStopSystem } from './HitStopSystem';
import { ScreenShakeSystem } from './ScreenShakeSystem';

export interface ChainCollisionDeps {
  scene: Phaser.Scene;
  tuning: MayhemTuning;
  coordinator: CombatCoordinator;
  audio: CombatAudioManager;
  debris: DebrisEffectManager;
  hitStop: HitStopSystem;
  screenShake: ScreenShakeSystem;
}

/**
 * Orchestrates all Step 3 emergent physical chain reactions:
 * - Thrown/rolling environmental objects -> Bandits
 * - Launched Bandit A -> Bandit B -> Bandit C domino chains
 * - Launched Bandits -> Barrels/Jars/Tables
 * - Thrown/rolling Objects -> Other Objects
 * - Running Bandits -> Water puddles / spilled food / banana peels
 */
export class CollisionChainManager {
  private readonly deps: ChainCollisionDeps;
  private readonly processedPairs = new Set<string>();

  constructor(deps: ChainCollisionDeps) {
    this.deps = deps;
  }

  public step(
    deltaMs: number,
    bandits: Bandit[],
    objects: EnvironmentalObject[],
    hazards: SurfaceHazard[],
  ): void {
    this.processedPairs.clear();
    const dtSec = Math.min(deltaMs, 50) * 0.001;

    // 1. Thrown / rolling objects hitting bandits
    this.resolveObjectVsBandits(objects, bandits);

    // 2. Thrown / rolling objects hitting other objects
    this.resolveObjectVsObjects(objects);

    // 3. Domino enemy-to-enemy knockback chains
    this.resolveBanditVsBandits(bandits);

    // 4. Launched bandits crashing into barrels / jars / tables
    this.resolveBanditVsObjects(bandits, objects);

    // 5. Running bandits slipping on water puddles / spilled food / banana peels
    this.resolveBanditVsHazards(dtSec, bandits, hazards);
  }

  private resolveObjectVsBandits(
    objects: EnvironmentalObject[],
    bandits: Bandit[],
  ): void {
    const { coordinator, audio, debris, hitStop, screenShake } = this.deps;

    for (const obj of objects) {
      if (!obj.isActiveProjectile) continue;

      for (const bandit of bandits) {
        if (!bandit.isVulnerable) continue;
        if (!obj.hitTracker.canHit(bandit.id)) continue;

        const hit = sweptCircleHit25D(
          obj.prevX,
          obj.prevY,
          obj.x,
          obj.y,
          obj.radius,
          bandit.x,
          bandit.y,
          bandit.collisionRadius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!hit.hit) continue;

        obj.hitTracker.recordHit(bandit.id);

        const speedFactor = Phaser.Math.Clamp(obj.speed / 360, 0.65, 1.45);
        const dmg = Math.round(obj.spec.impactDamage * speedFactor);
        const kb = obj.spec.knockbackForce * speedFactor;
        const launchVz = obj.spec.launchVz * speedFactor;

        const applied = bandit.takeHit(
          {
            damage: dmg,
            dirX: hit.nx,
            dirY: hit.ny,
            knockbackForce: kb,
            launchVz,
            isHeavy: obj.spec.kind === 'table' || obj.spec.rollable,
          },
          coordinator,
        );
        if (!applied) continue;

        // Material-specific synchronized impact feedback
        if (obj.spec.kind === 'table') {
          audio.playTableImpact();
          audio.playEnemyHurt(true);
          debris.spawn('WOOD_SPLINTERS', bandit.x, bandit.y, hit.nx, hit.ny);
          debris.spawn('HEAVY_IMPACT_SPARK', bandit.x, bandit.y, hit.nx, hit.ny);
          hitStop.trigger(45);
          screenShake.trigger(5.5, 110, hit.nx, hit.ny);
        } else if (obj.spec.rollable) {
          audio.playBarrelCollision();
          audio.playEnemyHurt(true);
          debris.spawn('DUST_CLOUD', bandit.x, bandit.y, hit.nx, hit.ny);
          hitStop.trigger(32);
          screenShake.trigger(4.0, 90, hit.nx, hit.ny);
        } else {
          audio.playBodyCollision();
          audio.playEnemyHurt(false);
          debris.spawn('HEAVY_IMPACT_SPARK', bandit.x, bandit.y, hit.nx, hit.ny);
          hitStop.trigger(28);
          screenShake.trigger(3.0, 75, hit.nx, hit.ny);
        }

        // Reduce object durability & energy; fragile objects break immediately
        const speedRetain = obj.spec.kind === 'table' ? 0.72 : 0.65;
        obj.onProjectileImpact(1, speedRetain);
        if (obj.isBroken) break;
      }
    }
  }

  private resolveObjectVsObjects(objects: EnvironmentalObject[]): void {
    const { audio, debris, screenShake } = this.deps;

    for (let i = 0; i < objects.length; i++) {
      const a = objects[i];
      if (!a.isActiveProjectile) continue;

      for (let j = 0; j < objects.length; j++) {
        if (i === j) continue;
        const b = objects[j];
        if (b.isBroken || b.state === 'CARRIED') continue;
        if (!a.hitTracker.canHit(b.id)) continue;

        const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (this.processedPairs.has(pairKey)) continue;

        const hit = sweptCircleHit25D(
          a.prevX,
          a.prevY,
          a.x,
          a.y,
          a.radius,
          b.x,
          b.y,
          b.radius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!hit.hit) continue;

        this.processedPairs.add(pairKey);
        a.hitTracker.recordHit(b.id);

        const impactForce = a.speed * a.mass;
        b.applyStrike(hit.nx, hit.ny, impactForce, 1, a.spec.kind === 'table');
        a.onProjectileImpact(1, 0.55);

        audio.playHeavyEnvImpact();
        debris.spawn('DUST_CLOUD', b.x, b.y, hit.nx, hit.ny);
        screenShake.trigger(4.2, 90, hit.nx, hit.ny);

        if (a.isBroken) break;
      }
    }
  }

  private resolveBanditVsBandits(bandits: Bandit[]): void {
    const { tuning, coordinator, audio, debris, hitStop, screenShake } = this.deps;

    for (let i = 0; i < bandits.length; i++) {
      const src = bandits[i];
      if (!src.isChainProjectile) continue;

      for (let j = 0; j < bandits.length; j++) {
        if (i === j) continue;
        const dst = bandits[j];
        if (!dst.isVulnerable || dst.chainCooldownMs > 0) continue;

        const pairKey = src.id < dst.id ? `${src.id}|${dst.id}` : `${dst.id}|${src.id}`;
        if (this.processedPairs.has(pairKey)) continue;

        const hit = sweptCircleHit25D(
          src.prevX,
          src.prevY,
          src.x,
          src.y,
          src.collisionRadius,
          dst.x,
          dst.y,
          dst.collisionRadius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!hit.hit) continue;

        const impulse = computeChainImpulse(
          src.vx,
          src.vy,
          src.mass,
          dst.mass,
          hit.nx,
          hit.ny,
          tuning.knockbackTransferCoeff,
          src.chainDepth,
          tuning.maxChainDepth,
          tuning.collisionEnergyThreshold,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!impulse.triggered) continue;

        const applied = dst.applyChainImpulse(
          impulse.tier,
          impulse.targetVx,
          impulse.targetVy,
          impulse.targetLaunchVz,
          impulse.damage,
          impulse.nextChainDepth,
          coordinator,
        );
        if (!applied) continue;

        this.processedPairs.add(pairKey);
        src.vx = impulse.sourceVx;
        src.vy = impulse.sourceVy;
        src.chainCooldownMs = 140;

        // Escalating bowling-pin domino feedback!
        audio.playChainReaction(impulse.nextChainDepth);
        audio.playEnemyHurt(impulse.tier === 'LAUNCHED' || impulse.tier === 'KNOCKDOWN');
        debris.spawn('HEAVY_IMPACT_SPARK', dst.x, dst.y, hit.nx, hit.ny);
        debris.spawn('DUST_CLOUD', dst.x, dst.y, hit.nx, hit.ny);

        if (impulse.tier === 'LAUNCHED' || impulse.tier === 'KNOCKDOWN') {
          hitStop.trigger(28);
          screenShake.trigger(
            Math.min(7.5, 3.2 + impulse.nextChainDepth * 1.1),
            85,
            hit.nx,
            hit.ny,
          );
        }

        if (tuning.showChainCounters) {
          this.spawnChainBadge(dst.x, dst.y, impulse.nextChainDepth);
        }
      }
    }
  }

  private resolveBanditVsObjects(
    bandits: Bandit[],
    objects: EnvironmentalObject[],
  ): void {
    const { audio, debris, screenShake } = this.deps;

    for (const bandit of bandits) {
      if (!bandit.isChainProjectile) continue;

      for (const obj of objects) {
        if (obj.isBroken || obj.state === 'CARRIED') continue;
        const pairKey = `${bandit.id}|${obj.id}`;
        if (this.processedPairs.has(pairKey)) continue;

        const hit = sweptCircleHit25D(
          bandit.prevX,
          bandit.prevY,
          bandit.x,
          bandit.y,
          bandit.collisionRadius,
          obj.x,
          obj.y,
          obj.radius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!hit.hit) continue;

        this.processedPairs.add(pairKey);
        const speed = bandit.groundSpeed;
        const heavyCrash = speed >= 240;

        // Bandit crashes into barrel/jar/table -> knocks it rolling or shatters it!
        obj.applyStrike(
          hit.nx,
          hit.ny,
          speed * 1.15,
          heavyCrash ? 2 : 1,
          heavyCrash,
        );

        bandit.vx *= 0.4;
        bandit.vy *= 0.4;

        if (obj.spec.rollable && !obj.isBroken) {
          audio.playBarrelCollision();
        } else if (!obj.isBroken) {
          audio.playBodyCollision();
        }
        debris.spawn('DUST_CLOUD', obj.x, obj.y, hit.nx, hit.ny);
        screenShake.trigger(3.6, 80, hit.nx, hit.ny);
      }
    }
  }

  private resolveBanditVsHazards(
    dtSec: number,
    bandits: Bandit[],
    hazards: SurfaceHazard[],
  ): void {
    const { tuning, coordinator, audio, debris } = this.deps;

    for (const hazard of hazards) {
      if (hazard.expired) continue;

      for (const bandit of bandits) {
        if (!bandit.canSlipNow) continue;
        if (!hazard.containsPoint25D(bandit.x, bandit.y, bandit.collisionRadius)) continue;

        const slipped = evaluateSlipTrigger(
          bandit.groundSpeed,
          tuning.slipProbability,
          dtSec,
          Math.random(),
        );
        if (!slipped) continue;

        if (bandit.triggerSlip(coordinator)) {
          audio.playSlip();
          if (hazard.kind === 'water_puddle') {
            audio.playWaterSplash();
            debris.spawn('WATER_SPLASH', bandit.x, bandit.y);
          } else {
            debris.spawn('DUST_CLOUD', bandit.x, bandit.y);
          }
        }
      }
    }
  }

  private spawnChainBadge(x: number, y: number, chainDepth: number): void {
    if (chainDepth < 2) return;
    const scale = getPerspectiveScale(y);
    const label = `×${chainDepth}!`;
    const txt = this.deps.scene.add
      .text(x, y - 52 * scale, label, {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: `${Math.min(24, 15 + chainDepth * 2)}px`,
        fontStyle: 'bold',
        color: chainDepth >= 3 ? '#facc15' : '#fb923c',
        stroke: '#1c120c',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(getDepthOrder(y) + 60);

    this.deps.scene.tweens.add({
      targets: txt,
      y: txt.y - 30 * scale,
      alpha: 0,
      scale: 1.15,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    });
  }
}
