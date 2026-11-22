import Phaser from 'phaser';
import {
  ARENA_BOUNDS,
  DEPTH_LAYERS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PERSPECTIVE_CONFIG,
  PLAYER_CONFIG,
} from '../config/arenaConfig';
import { CombatTuning, createDefaultCombatTuning } from '../config/combatConfig';
import {
  createDefaultMayhemTuning,
  EnvObjectKind,
  HazardKind,
  MayhemTuning,
} from '../config/mayhemConfig';
import {
  BanditArchetype,
  createDefaultStep4Tuning,
  Step4Tuning,
} from '../config/step4Config';
import { check25DMeleeHit } from '../core/CombatMath';
import { EventBus } from '../core/EventBus';
import { sweptCircleHit25D } from '../core/MayhemPhysics';
import {
  clampToArena,
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
} from '../core/Perspective';
import { Bandit } from '../entities/Bandit';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { SurfaceHazard } from '../entities/SurfaceHazard';
import { Warrior } from '../entities/Warrior';
import { CameraGagController } from '../systems/CameraGagController';
import { CollisionChainManager } from '../systems/CollisionChainManager';
import { CombatAudioManager } from '../systems/CombatAudioManager';
import { CombatCoordinator } from '../systems/CombatCoordinator';
import { CombatDebugPanel } from '../systems/CombatDebugPanel';
import { CombatHud } from '../systems/CombatHud';
import { DebrisEffectManager } from '../systems/DebrisEffectManager';
import { DebugOverlay } from '../systems/DebugOverlay';
import { HitStopSystem } from '../systems/HitStopSystem';
import { ImpactVfxSystem } from '../systems/ImpactVfxSystem';
import { InputSystem } from '../systems/InputSystem';
import { SystemRegistry } from '../systems/ModuleRegistry';
import { ScreenShakeSystem } from '../systems/ScreenShakeSystem';
import { MarketplaceArena } from '../world/MarketplaceArena';

/**
 * Main fixed-camera 2.5D arena scene for Three Kingdoms Mayhem (삼국지 난장판).
 * Step 4: Zhang Fei Bulldozer Charge (맹장돌진), 6 reactive comedic bandit personalities,
 * fear/panic/fleeing/tripping/hiding/peeking/surrendering, and rare screen-glass camera gags.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private tuning!: CombatTuning;
  private mayhemTuning!: MayhemTuning;
  private step4Tuning!: Step4Tuning;
  private systems!: SystemRegistry;
  private inputSystem!: InputSystem;
  private debugOverlay!: DebugOverlay;
  private combatDebugPanel!: CombatDebugPanel;
  private combatHud!: CombatHud;
  private hitStop!: HitStopSystem;
  private screenShake!: ScreenShakeSystem;
  private audio!: CombatAudioManager;
  private vfx!: ImpactVfxSystem;
  private debris!: DebrisEffectManager;
  private coordinator!: CombatCoordinator;
  private chainManager!: CollisionChainManager;
  private cameraGag!: CameraGagController;
  private arena!: MarketplaceArena;
  private player!: Warrior;

  private readonly bandits: Bandit[] = [];
  private readonly envObjects: EnvironmentalObject[] = [];
  private readonly hazards: SurfaceHazard[] = [];
  private nextBanditSeq = 1;
  private nextObjectSeq = 1;
  private nextHazardSeq = 1;

  private enemiesDefeated = 0;
  private comboHits = 0;
  private comboDecayMs = 0;
  private debugVisGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('BrawlScene');
  }

  public create(): void {
    // Strictly stationary fixed camera (not a scrolling game)
    this.cameras.main.setViewport(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    this.eventsBus = new EventBus();
    this.tuning = createDefaultCombatTuning();
    this.mayhemTuning = createDefaultMayhemTuning();
    this.step4Tuning = createDefaultStep4Tuning();
    this.systems = new SystemRegistry({ scene: this, events: this.eventsBus });

    // Register modular subsystems
    this.inputSystem = this.systems.register(new InputSystem());
    this.hitStop = this.systems.register(new HitStopSystem(this.tuning));
    this.screenShake = this.systems.register(new ScreenShakeSystem(this.tuning));
    this.audio = this.systems.register(new CombatAudioManager(this.tuning, this.mayhemTuning));
    this.vfx = this.systems.register(new ImpactVfxSystem());
    this.debris = this.systems.register(new DebrisEffectManager(this.mayhemTuning));
    this.coordinator = this.systems.register(new CombatCoordinator());
    this.cameraGag = this.systems.register(
      new CameraGagController(this.step4Tuning, this.audio, this.screenShake),
    );
    this.combatHud = this.systems.register(new CombatHud(() => this.resetTestRoom()));
    this.debugOverlay = this.systems.register(new DebugOverlay());
    this.combatDebugPanel = this.systems.register(
      new CombatDebugPanel(this.tuning, this.mayhemTuning, this.step4Tuning, {
        onSpawnBandit: (arch) => this.spawnSingleBandit(arch),
        onSpawnBanditGroup: () => {
          const pool: BanditArchetype[] = ['coward', 'clumsy', 'overconfident', 'sneaky', 'stubborn'];
          for (let i = 0; i < 5; i++) this.spawnSingleBandit(pool[i % pool.length]);
        },
        onClearEnemies: () => this.clearAllBandits(),
        onSpawnObject: (kind) => this.spawnObjectNearPlayer(kind),
        onSpawnPuddle: () =>
          this.spawnHazard(
            'water_puddle',
            this.player.x + Math.cos(this.player.facingAngle) * 70,
            this.player.y + Math.sin(this.player.facingAngle) * 48,
          ),
        onResetEnvironment: () => this.resetEnvironmentObjects(),
        onClearDebris: () => {
          this.debris.clearAll();
          this.clearAllHazards();
        },
        onTriggerChargeTest: () => {
          this.player.switchHero('zhangfei');
          this.player.triggerSpecial(this.inputSystem.sample(), true);
        },
        onForceEnemyPanic: () => {
          for (const b of this.bandits) b.forcePanic(this.coordinator);
        },
        onPreviewCameraGag: () => this.cameraGag.forcePreview(),
        onResetAiStates: () => {
          for (const b of this.bandits) b.resetAiState(this.coordinator);
        },
        onSwitchHero: () => this.player.switchHero(),
        onResetRoom: () => this.resetTestRoom(),
        onTuningChanged: () => this.applyLiveTuning(),
      }),
    );

    this.chainManager = new CollisionChainManager({
      scene: this,
      tuning: this.mayhemTuning,
      coordinator: this.coordinator,
      audio: this.audio,
      debris: this.debris,
      hitStop: this.hitStop,
      screenShake: this.screenShake,
    });

    this.arena = new MarketplaceArena(this);

    // Step 4 starts with Zhang Fei (장비) selected; press TAB anytime to switch to Zhao Yun!
    this.player = new Warrior(
      this,
      PLAYER_CONFIG.spawnX,
      PLAYER_CONFIG.spawnY,
      'zhangfei',
      this.tuning,
      this.step4Tuning,
      {
        onFootstep: (heavy) =>
          heavy ? this.audio.playHeavyFootstep() : this.audio.playFootstep(),
        onAttackActiveStart: (attackType, x, y, dirX, dirY, range) => {
          if (attackType === 'HEAVY' || attackType === 'LIGHT_3') {
            this.audio.playStrongWhoosh();
          } else {
            this.audio.playLightWhoosh();
          }
          this.vfx.spawnSpearTrail(x, y, dirX, dirY, attackType, range);
          this.eventsBus.emit('combat:player_attack_start', {
            attackType,
            x,
            y,
            dirX,
            dirY,
          });
        },
        onZhangFeiRoar: (x, y) => {
          this.audio.playZhangFeiRoar();
          this.debris.spawn('DUST_CLOUD', x, y);
          this.spawnRoarShockwave(x, y);
          this.screenShake.trigger(4.5, 140);
          // Nearby cowardly/nervous bandits witness Zhang Fei's terrifying roar!
          this.broadcastFearWave(x, y, 360, 34);
        },
        onZhangFeiChargeRush: (x, y, dirX, dirY) => {
          this.audio.playChargeRush();
          this.debris.spawn('DUST_CLOUD', x, y, -dirX, -dirY);
          this.broadcastFearWave(x, y, 320, 26);
        },
        onZhangFeiChargeSkid: (x, y) => {
          this.audio.playChargeSkid();
          this.debris.spawn('LANDING_DUST', x, y);
        },
        onZhaoYunWhirlwind: (x, y) => {
          this.audio.playStrongWhoosh();
          this.executeZhaoYunWhirlwind(x, y);
        },
        onSpecialCooldownRejected: () => {
          this.combatHud.flashSpecialRejected();
        },
        onPlayerHurt: (damage, hp, maxHp) => {
          this.audio.playPlayerHurt();
          this.vfx.spawnPlayerHitFlash(this.player.x, this.player.y);
          this.screenShake.trigger(5.5, 115);
          this.comboHits = 0;
          this.eventsBus.emit('combat:player_hurt', {
            damage,
            hp,
            maxHp,
            x: this.player.x,
            y: this.player.y,
          });
        },
        onPlayerDefeated: () => {
          this.screenShake.trigger(8, 220);
          this.eventsBus.emit('combat:player_defeated', {
            x: this.player.x,
            y: this.player.y,
          });
        },
      },
    );

    this.debugVisGfx = this.add.graphics().setDepth(DEPTH_LAYERS.HUD - 10);

    this.spawnInitialEnvironment();
    this.spawnStep4BanditSquad();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  public update(time: number, delta: number): void {
    const input = this.inputSystem.sample();

    if (input.toggleDebugPressed) {
      const visible = this.debugOverlay.toggle();
      this.eventsBus.emit('debug:toggled', { visible });
    }

    if (input.toggleCombatPanelPressed) {
      const visible = this.combatDebugPanel.toggle();
      this.eventsBus.emit('combat:panel_toggled', { visible });
    }

    if (input.restartPressed) {
      this.resetTestRoom();
      return;
    }

    if (input.switchHeroPressed && !this.player.isDefeated) {
      this.player.switchHero();
    }

    if (input.specialPressed && !this.player.isDefeated) {
      this.player.triggerSpecial(input);
    }

    if (input.interactPressed && !this.player.isDefeated) {
      this.handlePlayerInteract();
    }

    this.player.bufferInput(input);

    // Always update screen shake, camera gag overlay, VFX, debris, and arena ambience
    this.screenShake.update(time, delta);
    this.cameraGag.update(time, delta);
    this.vfx.update(time, delta);
    this.debris.update(time, delta);
    this.arena.update(delta);

    if (this.comboHits > 0) {
      this.comboDecayMs -= Math.min(delta, 50);
      if (this.comboDecayMs <= 0) this.comboHits = 0;
    }

    const frozenByHitStop = this.hitStop.step(delta);

    if (!frozenByHitStop) {
      this.coordinator.update(time, delta);

      this.player.update(delta, input, (x, y, r) =>
        this.arena.resolvePropCollisions(x, y, r),
      );

      this.updatePickupPrompt();
      this.resolvePlayerMeleeHits();
      this.resolveZhangFeiChargeCollisions();

      for (let i = this.envObjects.length - 1; i >= 0; i--) {
        const obj = this.envObjects[i];
        obj.update(delta, (x, y, r) => this.arena.resolvePropCollisions(x, y, r));
        if (obj.readyForRemoval) {
          obj.destroy();
          this.envObjects.splice(i, 1);
        }
      }

      for (let i = this.bandits.length - 1; i >= 0; i--) {
        const bandit = this.bandits[i];
        bandit.update(
          delta,
          this.player.x,
          this.player.y,
          !this.player.isDefeated,
          this.coordinator,
          this.bandits,
          this.envObjects,
          (x, y, r) => this.arena.resolvePropCollisions(x, y, r),
        );
        if (bandit.readyForRemoval) {
          this.coordinator.releaseAttackToken(bandit.id);
          bandit.destroy();
          this.bandits.splice(i, 1);
        }
      }

      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const hz = this.hazards[i];
        hz.update(delta);
        if (hz.expired) {
          hz.destroy();
          this.hazards.splice(i, 1);
        }
      }

      this.chainManager.step(delta, this.bandits, this.envObjects, this.hazards);
    }

    this.renderDebugVisuals();

    const activeEnemies = this.bandits.filter((b) => !b.isNeutralized).length;
    const surrenderedCount = this.bandits.filter((b) => b.state === 'SURRENDERED').length;

    this.combatHud.render(
      {
        heroId: this.player.heroId,
        playerHp: this.player.hp,
        playerMaxHp: this.player.maxHp,
        playerDefeated: this.player.isDefeated,
        specialReadyRatio: this.player.specialReadyRatio,
        enemiesActive: activeEnemies,
        enemiesNeutralized: this.enemiesDefeated + surrenderedCount,
        enemiesSurrendered: surrenderedCount,
        comboHits: this.comboHits,
      },
      this,
      delta,
    );

    this.debugOverlay.render({
      fps: this.game.loop.actualFps,
      x: this.player.x,
      y: this.player.y,
      depthRatio: this.player.depthRatio,
      scale: this.player.currentScale,
      facing: this.player.facingLabel,
      speed: this.player.speed,
    });
  }

  /**
   * Swept 2.5D Bulldozer Charge collisions for Zhang Fei's 맹장돌진!
   * Bowls through multiple bandits (connecting into STEP 3 domino chains) and smashes props.
   */
  private resolveZhangFeiChargeCollisions(): void {
    if (!this.player.isChargeActive) return;

    const chargeRadius = 32;
    let hitEnemy = false;

    // 1. Charge vs Bandits
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!this.player.chargeHitTracker.canHit(bandit.id)) continue;

      const hit = sweptCircleHit25D(
        this.player.prevX,
        this.player.prevY,
        this.player.x,
        this.player.y,
        chargeRadius,
        bandit.x,
        bandit.y,
        bandit.collisionRadius,
        PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (!hit.hit) continue;

      this.player.chargeHitTracker.recordHit(bandit.id);

      // Blend charge direction + slight lateral bowling deflection
      const dirX = this.player.chargeDirX * 0.72 + hit.nx * 0.28;
      const dirY = this.player.chargeDirY * 0.72 + hit.ny * 0.28;
      const dmg = Math.round(this.step4Tuning.chargeDamage * this.tuning.playerDamageMultiplier);

      const applied = bandit.takeHit(
        {
          damage: dmg,
          dirX,
          dirY,
          knockbackForce: this.step4Tuning.chargeKnockback,
          launchVz: this.step4Tuning.chargeLaunchVz,
          isHeavy: true,
        },
        this.coordinator,
      );
      if (!applied) continue;

      hitEnemy = true;
      this.comboHits += 1;
      this.comboDecayMs = 2400;

      this.vfx.spawnHitImpact(bandit.x, bandit.y, bandit.elevationZ, dirX, dirY, 'HEAVY', dmg);
      this.debris.spawn('HEAVY_IMPACT_SPARK', bandit.x, bandit.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', bandit.x, bandit.y, dirX, dirY);

      // Drain charge energy per bandit plowed through (Elites drain more!)
      const loss =
        this.step4Tuning.chargeEnergyLossPerHit * (bandit.archetype === 'elite' ? 2.0 : 1.0);
      this.player.consumeChargeEnergy(loss);

      // Witnesses panic when seeing friends launched flying!
      this.broadcastFearWave(bandit.x, bandit.y, 260, 22);

      if (!this.player.isChargeActive) break;
    }

    if (hitEnemy) {
      this.audio.playShoulderCollision();
      this.audio.playEnemyHurt(true);
      this.hitStop.trigger(48);
      this.screenShake.trigger(7.0, 130, this.player.chargeDirX, this.player.chargeDirY);
    }

    // 2. Charge vs Environmental Objects (smashes jars, barrels, lightweight tables!)
    if (!this.player.isChargeActive) return;

    for (const obj of this.envObjects) {
      if (obj.isBroken || obj.state === 'CARRIED') continue;
      if (!this.player.chargeHitTracker.canHit(obj.id)) continue;

      const hit = sweptCircleHit25D(
        this.player.prevX,
        this.player.prevY,
        this.player.x,
        this.player.y,
        chargeRadius,
        obj.x,
        obj.y,
        obj.radius,
        PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (!hit.hit) continue;

      this.player.chargeHitTracker.recordHit(obj.id);
      obj.applyStrike(
        this.player.chargeDirX,
        this.player.chargeDirY,
        this.step4Tuning.chargeKnockback * 1.15,
        2,
        true,
      );

      this.audio.playHeavyEnvImpact();
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y, hit.nx, hit.ny);
      this.screenShake.trigger(5.2, 100, this.player.chargeDirX, this.player.chargeDirY);

      // Heavy tables drain more charge energy
      const energyCost = obj.spec.kind === 'table' ? 38 : 16;
      this.player.consumeChargeEnergy(energyCost);
      if (!this.player.isChargeActive) break;
    }
  }

  private executeZhaoYunWhirlwind(x: number, y: number): void {
    const scale = getPerspectiveScale(y);
    const ring = this.add.graphics().setPosition(x, y - 20 * scale).setDepth(getDepthOrder(y) + 30);
    ring.lineStyle(10 * scale, 0x38bdf8, 0.85);
    ring.strokeEllipse(0, 0, 210 * scale, 140 * scale);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 1.25,
      duration: 240,
      onComplete: () => ring.destroy(),
    });

    let hits = 0;
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      const dx = bandit.x - x;
      const dy = (bandit.y - y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const dist = Math.hypot(dx, dy);
      if (dist > 135) continue;

      const nx = dist > 0.1 ? dx / dist : 1;
      const ny = dist > 0.1 ? dy / dist : 0;
      const dmg = Math.round(36 * this.tuning.playerDamageMultiplier);
      if (
        bandit.takeHit(
          {
            damage: dmg,
            dirX: nx,
            dirY: ny,
            knockbackForce: 430,
            launchVz: 260,
            isHeavy: true,
          },
          this.coordinator,
        )
      ) {
        hits += 1;
        this.comboHits += 1;
        this.comboDecayMs = 2200;
        this.vfx.spawnHitImpact(bandit.x, bandit.y, bandit.elevationZ, nx, ny, 'LIGHT_3', dmg);
      }
    }

    if (hits > 0) {
      this.audio.playComboFinisherImpact();
      this.hitStop.trigger(50);
      this.screenShake.trigger(6.0, 120);
      this.broadcastFearWave(x, y, 280, 24);
    }
  }

  private spawnRoarShockwave(x: number, y: number): void {
    const scale = getPerspectiveScale(y);
    const g = this.add.graphics().setPosition(x, y - 22 * scale).setDepth(getDepthOrder(y) + 30);
    g.lineStyle(5 * scale, 0xc084fc, 0.9);
    g.strokeEllipse(0, 0, 110 * scale, 70 * scale);
    g.lineStyle(3 * scale, 0xfde047, 0.95);
    g.strokeEllipse(0, 0, 74 * scale, 48 * scale);

    this.tweens.add({
      targets: g,
      scale: 2.3,
      alpha: 0,
      duration: 240,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private broadcastFearWave(
    originX: number,
    originY: number,
    radius: number,
    baseAmount: number,
  ): void {
    const rSq = radius * radius;
    for (const bandit of this.bandits) {
      if (bandit.isNeutralized) continue;
      const dx = bandit.x - originX;
      const dy = (bandit.y - originY) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const distSq = dx * dx + dy * dy;
      if (distSq <= rSq) {
        const falloff = 1 - Math.sqrt(distSq) / (radius * 1.25);
        bandit.addFear(baseAmount * Math.max(0.35, falloff), this.coordinator);
      }
    }
  }

  private handlePlayerInteract(): void {
    if (this.player.isCarrying) {
      const thrown = this.player.throwCarriedObject(this.mayhemTuning.objectThrowForce);
      if (thrown) {
        if (thrown.spec.kind === 'table') {
          this.audio.playHeavyTableThrow();
        } else {
          this.audio.playStrongWhoosh();
        }
      }
      return;
    }

    const nearest = this.findNearestPickupable();
    if (nearest && this.player.pickUpObject(nearest)) {
      this.audio.playWoodPickup();
      if (nearest.spec.kind === 'table') {
        this.audio.playWoodCreak();
      }
    }
  }

  private findNearestPickupable(): EnvironmentalObject | null {
    let best: EnvironmentalObject | null = null;
    let bestDistSq = Infinity;
    const grabReach = 68;

    for (const obj of this.envObjects) {
      if (!obj.canBePickedUp) continue;
      const dx = obj.x - this.player.x;
      const dy = (obj.y - this.player.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const distSq = dx * dx + dy * dy;
      const maxReach = grabReach + obj.radius;
      if (distSq <= maxReach * maxReach && distSq < bestDistSq) {
        bestDistSq = distSq;
        best = obj;
      }
    }
    return best;
  }

  private updatePickupPrompt(): void {
    const nearest = this.player.isCarrying ? null : this.findNearestPickupable();
    for (const obj of this.envObjects) {
      obj.setPickupPromptVisible(obj === nearest);
    }
  }

  private resolvePlayerMeleeHits(): void {
    const query = this.player.getActiveHitbox();
    const spec = this.player.currentAttack;
    if (!query || !spec) return;

    const heroMul = this.player.profile;
    let hitEnemyCount = 0;

    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!this.player.hitTracker.canHit(bandit.id)) continue;

      const result = check25DMeleeHit(query, bandit.getHurtbox());
      if (!result.hit) continue;

      this.player.hitTracker.recordHit(bandit.id);
      const damage = Math.max(
        1,
        Math.round(
          spec.baseDamage *
            this.tuning.playerDamageMultiplier *
            heroMul.damageMultiplier,
        ),
      );

      const applied = bandit.takeHit(
        {
          damage,
          dirX: query.dirX,
          dirY: query.dirY,
          knockbackForce: spec.knockbackForce * heroMul.knockbackMultiplier,
          launchVz: spec.launchVz,
          isHeavy: spec.isHeavy,
        },
        this.coordinator,
      );
      if (!applied) continue;

      hitEnemyCount += 1;
      this.comboHits += 1;
      this.comboDecayMs = 2200;

      this.vfx.spawnHitImpact(
        bandit.x,
        bandit.y,
        bandit.elevationZ,
        query.dirX,
        query.dirY,
        spec.type,
        damage,
      );

      if (spec.isHeavy || spec.isFinisher) {
        this.broadcastFearWave(bandit.x, bandit.y, 240, 18);
      }

      this.eventsBus.emit('combat:hit', {
        attackerId: this.player.id,
        targetId: bandit.id,
        attackType: spec.type,
        damage,
        x: bandit.x,
        y: bandit.y,
        dirX: query.dirX,
        dirY: query.dirY,
      });
    }

    for (const obj of this.envObjects) {
      if (obj.isBroken || obj.state === 'CARRIED') continue;
      if (!this.player.hitTracker.canHit(obj.id)) continue;

      const res = check25DMeleeHit(query, {
        id: obj.id,
        x: obj.x,
        y: obj.y,
        radius: obj.radius,
        elevationZ: obj.elevationZ,
        vulnerable: true,
      });
      if (!res.hit) continue;

      this.player.hitTracker.recordHit(obj.id);
      const durLoss = spec.isHeavy || spec.isFinisher ? 2 : 1;
      obj.applyStrike(
        query.dirX,
        query.dirY,
        spec.knockbackForce * 1.1,
        durLoss,
        spec.isHeavy || spec.isFinisher,
      );

      if (!obj.isBroken) {
        if (obj.spec.rollable) this.audio.playBarrelCollision();
        else this.audio.playTableImpact();
        this.debris.spawn('DUST_CLOUD', obj.x, obj.y, query.dirX, query.dirY);
      }
      this.hitStop.trigger(spec.isHeavy ? 42 : 20);
      this.screenShake.trigger(spec.isHeavy ? 5 : 2.2, 80, query.dirX, query.dirY);
    }

    if (hitEnemyCount > 0) {
      if (spec.isHeavy) {
        this.audio.playHeavyImpact();
        this.audio.playEnemyHurt(true);
      } else if (spec.isFinisher) {
        this.audio.playComboFinisherImpact();
        this.audio.playEnemyHurt(true);
      } else {
        this.audio.playLightImpact();
        this.audio.playEnemyHurt(false);
      }

      this.hitStop.trigger(spec.hitStopMs);
      if (spec.shakeIntensity > 0) {
        this.screenShake.trigger(
          spec.shakeIntensity,
          spec.shakeDurationMs,
          query.dirX,
          query.dirY,
        );
      }
    }
  }

  private spawnInitialEnvironment(): void {
    // 3 Wooden Tables (also serve as valid cover spots!)
    this.spawnObject('table', 515, 488);
    this.spawnObject('table', 775, 494);
    this.spawnObject('table', 640, 344);

    // 3 Barrels (2 water-filled, 1 empty — also valid cover!)
    this.spawnObject('barrel_water', 442, 378);
    this.spawnObject('barrel_water', 845, 384);
    this.spawnObject('barrel_empty', 340, 566);

    // 4 Ceramic Jars
    this.spawnObject('ceramic_jar', 575, 294);
    this.spawnObject('ceramic_jar', 705, 294);
    this.spawnObject('ceramic_jar', 288, 456);
    this.spawnObject('ceramic_jar', 988, 462);

    // 2 Fruit Baskets
    this.spawnObject('fruit_basket', 385, 616);
    this.spawnObject('fruit_basket', 918, 608);

    // 1 Starter Water Puddle
    this.spawnHazard('water_puddle', 640, 412);
  }

  private spawnObject(kind: EnvObjectKind, x: number, y: number): EnvironmentalObject {
    const id = `env_${kind}_${this.nextObjectSeq++}`;
    const obj = new EnvironmentalObject(
      this,
      id,
      kind,
      x,
      y,
      this.mayhemTuning,
      {
        onWallHit: (o) => {
          this.audio.playHeavyEnvImpact();
          this.debris.spawn('DUST_CLOUD', o.x, o.y);
          this.screenShake.trigger(3.8, 80);
        },
        onLanded: (o, impactSpeed) => {
          if (impactSpeed > 110) {
            this.audio.playFallThud();
            this.debris.spawn('LANDING_DUST', o.x, o.y);
          }
        },
        onRollTick: () => this.audio.playBarrelRoll(),
        onBroken: (o, dirX, dirY) => this.handleObjectBroken(o, dirX, dirY),
      },
    );
    this.envObjects.push(obj);
    return obj;
  }

  private spawnObjectNearPlayer(kind: EnvObjectKind): void {
    const x = this.player.x + Math.cos(this.player.facingAngle) * 72;
    const y = this.player.y + Math.sin(this.player.facingAngle) * 52;
    this.spawnObject(kind, x, y);
  }

  private handleObjectBroken(
    obj: EnvironmentalObject,
    dirX: number,
    dirY: number,
  ): void {
    // Notify any bandit hiding behind this destroyed cover!
    for (const bandit of this.bandits) {
      if (bandit.coverObject === obj) {
        bandit.onCoverDestroyed(this.coordinator);
      }
    }

    // Loud destruction spooks nearby cowards!
    this.broadcastFearWave(obj.x, obj.y, 220, 16);

    if (obj.spec.kind === 'table') {
      this.audio.playTableShatter();
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y, dirX, dirY);
      this.screenShake.trigger(6.5, 130, dirX, dirY);
    } else if (obj.spec.rollable) {
      this.audio.playBarrelBreak(obj.spec.containsWater);
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      if (obj.spec.containsWater) {
        this.debris.spawn('WATER_SPLASH', obj.x, obj.y);
        this.spawnHazard('water_puddle', obj.x, obj.y);
      } else {
        this.debris.spawn('DUST_CLOUD', obj.x, obj.y);
      }
      this.screenShake.trigger(5.0, 105, dirX, dirY);
    } else if (obj.spec.material === 'ceramic') {
      this.audio.playCeramicBreak();
      this.debris.spawn('CERAMIC_SHARDS', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y);
      this.screenShake.trigger(3.0, 75, dirX, dirY);
    } else if (obj.spec.spillsFood) {
      this.audio.playTableImpact();
      this.debris.spawn('FRUIT_SCATTER', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      this.spawnHazard('spilled_food', obj.x, obj.y);
      this.spawnHazard(
        'banana_peel',
        obj.x + (dirX || 1) * 34,
        obj.y + (dirY || 0.2) * 20,
      );
      this.screenShake.trigger(3.2, 80, dirX, dirY);
    }
  }

  private spawnHazard(kind: HazardKind, rawX: number, rawY: number): SurfaceHazard {
    const clamped = clampToArena(rawX, rawY, 32);
    const id = `hazard_${kind}_${this.nextHazardSeq++}`;
    const hz = new SurfaceHazard(
      this,
      id,
      kind,
      clamped.x,
      clamped.y,
      this.mayhemTuning.puddleDurationMs,
    );
    this.hazards.push(hz);
    return hz;
  }

  /**
   * Step 4 Test Scenario Squad (12 bandits across all 6 personalities):
   * - 2 Cowards, 2 Clumsy, 2 Overconfident, 2 Sneaky, 3 Stubborn, 1 Elite!
   */
  private spawnStep4BanditSquad(): void {
    const squad: Array<{ arch: BanditArchetype; x: number; y: number }> = [
      { arch: 'coward', x: 470, y: 312 },
      { arch: 'coward', x: 810, y: 318 },
      { arch: 'clumsy', x: 560, y: 396 },
      { arch: 'clumsy', x: 724, y: 404 },
      { arch: 'overconfident', x: 390, y: 468 },
      { arch: 'overconfident', x: 892, y: 476 },
      { arch: 'sneaky', x: 486, y: 548 },
      { arch: 'sneaky', x: 792, y: 554 },
      { arch: 'stubborn', x: 355, y: 598 },
      { arch: 'stubborn', x: 930, y: 596 },
      { arch: 'stubborn', x: 565, y: 626 },
      { arch: 'elite', x: 720, y: 334 },
    ];

    squad.forEach((entry, idx) => {
      this.spawnBanditAt(entry.x, entry.y, idx, entry.arch);
    });
  }

  private spawnSingleBandit(archetype?: BanditArchetype): void {
    const y = Phaser.Math.Between(ARENA_BOUNDS.backY + 45, ARENA_BOUNDS.frontY - 55);
    const bounds = getHorizontalBoundsAtY(y);
    const leftSide = Math.random() < 0.5;
    const x = leftSide
      ? Phaser.Math.Between(Math.round(bounds.left + 70), Math.round(bounds.left + 220))
      : Phaser.Math.Between(Math.round(bounds.right - 220), Math.round(bounds.right - 70));

    const pool: BanditArchetype[] = ['coward', 'clumsy', 'overconfident', 'sneaky', 'stubborn'];
    const arch = archetype ?? pool[this.nextBanditSeq % pool.length];
    this.spawnBanditAt(x, y, this.bandits.length, arch);
  }

  private spawnBanditAt(
    rawX: number,
    rawY: number,
    slotIndex: number,
    archetype: BanditArchetype,
  ): void {
    const clamped = clampToArena(rawX, rawY, 20);
    const id = `bandit_${this.nextBanditSeq++}`;

    const bandit = new Bandit(
      this,
      id,
      slotIndex,
      archetype,
      clamped.x,
      clamped.y,
      this.tuning,
      this.step4Tuning,
      {
        onAttackWhoosh: () => this.audio.playEnemyWhoosh(),
        onHitPlayer: (damage, dirX, dirY) => {
          this.player.takeDamage(damage, dirX, dirY);
        },
        onLanded: (b, impactSpeed) => {
          const strong = impactSpeed > 150;
          this.audio.playKnockdownLanding();
          this.vfx.spawnLandingImpact(b.x, b.y, strong);
          if (strong) this.screenShake.trigger(3.2, 75, 0, 1);
          this.eventsBus.emit('combat:enemy_landed', {
            enemyId: b.id,
            x: b.x,
            y: b.y,
            impactSpeed,
          });
        },
        onDefeated: (b) => {
          this.enemiesDefeated += 1;
          this.audio.playEnemyDefeat();
          this.broadcastFearWave(b.x, b.y, 260, 18);
          this.eventsBus.emit('combat:enemy_defeated', {
            enemyId: b.id,
            x: b.x,
            y: b.y,
          });
        },
        onPanic: () => this.audio.playBanditPanicSqueal(),
        onTrip: (b) => {
          this.audio.playStumble();
          this.debris.spawn('DUST_CLOUD', b.x, b.y);
        },
        onHide: () => this.audio.playHideRustle(),
        onPeek: () => this.audio.playPeekChirp(),
        onSurrender: () => this.audio.playSurrenderVoice(),
        onTryCameraGag: (b, launchSpeed, vy) =>
          this.cameraGag.tryTrigger(
            b.x,
            b.y,
            launchSpeed,
            vy,
            b.spec.cameraGagEligible,
            () => b.resolveAfterCameraGag(),
          ),
      },
    );

    this.bandits.push(bandit);
  }

  private clearAllBandits(): void {
    for (const bandit of this.bandits) {
      this.coordinator.releaseAttackToken(bandit.id);
      bandit.destroy();
    }
    this.bandits.length = 0;
  }

  private clearAllObjects(): void {
    this.player.carriedObject = null;
    for (const obj of this.envObjects) obj.destroy();
    this.envObjects.length = 0;
  }

  private clearAllHazards(): void {
    for (const hz of this.hazards) hz.destroy();
    this.hazards.length = 0;
  }

  private resetEnvironmentObjects(): void {
    this.clearAllObjects();
    this.clearAllHazards();
    this.debris.clearAll();
    this.spawnInitialEnvironment();
  }

  private resetTestRoom(): void {
    this.clearAllBandits();
    this.resetEnvironmentObjects();
    this.cameraGag.reset();
    this.hitStop.reset();
    this.screenShake.reset();
    this.coordinator.reset();
    this.enemiesDefeated = 0;
    this.comboHits = 0;
    this.comboDecayMs = 0;
    this.player.reset(PLAYER_CONFIG.spawnX, PLAYER_CONFIG.spawnY);
    this.spawnStep4BanditSquad();
    this.eventsBus.emit('combat:restart', {});
  }

  private applyLiveTuning(): void {
    this.audio.syncVolume();
    for (const bandit of this.bandits) {
      bandit.syncMaxHpFromTuning();
    }
  }

  private renderDebugVisuals(): void {
    this.debugVisGfx.clear();

    const showActors = this.tuning.showGroundPositions || this.mayhemTuning.showActorShapes;
    if (showActors) {
      const pScale = getPerspectiveScale(this.player.y);
      this.debugVisGfx.lineStyle(2, this.player.isChargeActive ? 0xc084fc : 0x22c55e, 0.9);
      this.debugVisGfx.strokeEllipse(
        this.player.x,
        this.player.y,
        this.player.collisionRadius * 2 * pScale,
        this.player.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * pScale,
      );

      for (const b of this.bandits) {
        if (b.state === 'CAMERA_GAGGED') continue;
        const bScale = getPerspectiveScale(b.y);
        this.debugVisGfx.lineStyle(2, b.isChainProjectile ? 0xf97316 : 0x38bdf8, 0.85);
        this.debugVisGfx.strokeEllipse(
          b.x,
          b.y,
          b.collisionRadius * 2 * bScale,
          b.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * bScale,
        );
      }
    }

    if (this.mayhemTuning.showObjectShapes) {
      for (const obj of this.envObjects) {
        const oScale = getPerspectiveScale(obj.y);
        this.debugVisGfx.lineStyle(2, obj.isActiveProjectile ? 0xef4444 : 0xfbbf24, 0.9);
        this.debugVisGfx.strokeEllipse(
          obj.x,
          obj.y,
          obj.radius * 2 * oScale,
          obj.radius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * oScale,
        );
      }
      for (const hz of this.hazards) {
        const hScale = getPerspectiveScale(hz.y);
        this.debugVisGfx.lineStyle(1.5, 0x38bdf8, 0.8);
        this.debugVisGfx.strokeEllipse(
          hz.x,
          hz.y,
          hz.radius * 2 * hScale,
          hz.radius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * hScale,
        );
      }
    }

    if (this.mayhemTuning.showVelocityVectors) {
      this.debugVisGfx.lineStyle(2, 0xf97316, 0.9);
      for (const b of this.bandits) {
        if (Math.hypot(b.vx, b.vy) > 15) {
          this.debugVisGfx.lineBetween(b.x, b.y, b.x + b.vx * 0.25, b.y + b.vy * 0.25);
        }
      }
      this.debugVisGfx.lineStyle(2, 0xfef08a, 0.95);
      for (const obj of this.envObjects) {
        if (Math.hypot(obj.vx, obj.vy) > 15) {
          this.debugVisGfx.lineBetween(obj.x, obj.y, obj.x + obj.vx * 0.25, obj.y + obj.vy * 0.25);
        }
      }
    }

    if (this.tuning.showHitboxes) {
      const hb = this.player.getActiveHitbox();
      if (hb) {
        const fx = hb.dirX;
        const fy = hb.dirY;
        const lx = -fy;
        const ly = fx;
        const vRatio = hb.verticalRatio;
        const back = -(hb.backGrace ?? 10);

        const toWorld = (f: number, l: number): [number, number] => [
          hb.originX + fx * f + lx * l,
          hb.originY + (fy * f + ly * l) * vRatio,
        ];

        const p0 = toWorld(back, -hb.halfWidth);
        const p1 = toWorld(hb.range, -hb.halfWidth);
        const p2 = toWorld(hb.range, hb.halfWidth);
        const p3 = toWorld(back, hb.halfWidth);

        this.debugVisGfx.fillStyle(0x38bdf8, 0.25);
        this.debugVisGfx.lineStyle(2, 0x7dd3fc, 0.95);
        this.debugVisGfx.beginPath();
        this.debugVisGfx.moveTo(p0[0], p0[1]);
        this.debugVisGfx.lineTo(p1[0], p1[1]);
        this.debugVisGfx.lineTo(p2[0], p2[1]);
        this.debugVisGfx.lineTo(p3[0], p3[1]);
        this.debugVisGfx.closePath();
        this.debugVisGfx.fillPath();
        this.debugVisGfx.strokePath();
      }
    }
  }

  private handleShutdown(): void {
    this.clearAllBandits();
    this.clearAllObjects();
    this.clearAllHazards();
    this.player?.destroy();
    this.arena?.destroy();
    this.debugVisGfx?.destroy();
    this.systems?.destroy();
    this.eventsBus?.clear();
  }
}
