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
import { check25DMeleeHit } from '../core/CombatMath';
import { EventBus } from '../core/EventBus';
import { clampToArena, getHorizontalBoundsAtY, getPerspectiveScale } from '../core/Perspective';
import { Bandit } from '../entities/Bandit';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { SurfaceHazard } from '../entities/SurfaceHazard';
import { Warrior } from '../entities/Warrior';
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
 * Step 3: Mayhem Physics & Environmental Chaos — table pickup/throwing, domino
 * enemy-to-enemy knockback chains, rolling water barrels, ceramic jars, fruit baskets,
 * slippery puddles/food hazards, pooled debris, and material-specific Web Audio.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private tuning!: CombatTuning;
  private mayhemTuning!: MayhemTuning;
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
    this.systems = new SystemRegistry({ scene: this, events: this.eventsBus });

    // Register modular subsystems
    this.inputSystem = this.systems.register(new InputSystem());
    this.hitStop = this.systems.register(new HitStopSystem(this.tuning));
    this.screenShake = this.systems.register(new ScreenShakeSystem(this.tuning));
    this.audio = this.systems.register(new CombatAudioManager(this.tuning, this.mayhemTuning));
    this.vfx = this.systems.register(new ImpactVfxSystem());
    this.debris = this.systems.register(new DebrisEffectManager(this.mayhemTuning));
    this.coordinator = this.systems.register(new CombatCoordinator());
    this.combatHud = this.systems.register(new CombatHud(() => this.resetTestRoom()));
    this.debugOverlay = this.systems.register(new DebugOverlay());
    this.combatDebugPanel = this.systems.register(
      new CombatDebugPanel(this.tuning, this.mayhemTuning, {
        onSpawnBandit: () => this.spawnSingleBandit(),
        onSpawnBanditGroup: () => {
          for (let i = 0; i < 5; i++) this.spawnSingleBandit();
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

    // Build fixed-camera 2.5D ancient Chinese marketplace arena
    this.arena = new MarketplaceArena(this);

    // Spawn playable chibi Zhao Yun
    this.player = new Warrior(
      this,
      PLAYER_CONFIG.spawnX,
      PLAYER_CONFIG.spawnY,
      this.tuning,
      {
        onFootstep: () => this.audio.playFootstep(),
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

    // Populate Step 3 stage objects & initial 6 bandits
    this.spawnInitialEnvironment();
    this.spawnInitialBandits();

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

    // Handle SPACE interact (pick up nearest table/jar/basket OR throw carried object)
    if (input.interactPressed && !this.player.isDefeated) {
      this.handlePlayerInteract();
    }

    // Always buffer player attack inputs even during Hit-Stop
    this.player.bufferInput(input);

    // Always update screen shake, VFX particles, debris, hazards, and arena ambience
    this.screenShake.update(time, delta);
    this.vfx.update(time, delta);
    this.debris.update(time, delta);
    this.arena.update(delta);

    if (this.comboHits > 0) {
      this.comboDecayMs -= Math.min(delta, 50);
      if (this.comboDecayMs <= 0) {
        this.comboHits = 0;
      }
    }

    const frozenByHitStop = this.hitStop.step(delta);

    if (!frozenByHitStop) {
      this.coordinator.update(time, delta);

      // Update player
      this.player.update(delta, input, (x, y, r) =>
        this.arena.resolvePropCollisions(x, y, r),
      );

      // Show SPACE pickup prompt on nearest eligible object
      this.updatePickupPrompt();

      // Resolve player active melee hitbox against bandits & environmental objects
      this.resolvePlayerMeleeHits();

      // Update environmental objects
      for (let i = this.envObjects.length - 1; i >= 0; i--) {
        const obj = this.envObjects[i];
        obj.update(delta, (x, y, r) => this.arena.resolvePropCollisions(x, y, r));
        if (obj.readyForRemoval) {
          obj.destroy();
          this.envObjects.splice(i, 1);
        }
      }

      // Update bandits
      for (let i = this.bandits.length - 1; i >= 0; i--) {
        const bandit = this.bandits[i];
        bandit.update(
          delta,
          this.player.x,
          this.player.y,
          !this.player.isDefeated,
          this.coordinator,
          this.bandits,
          (x, y, r) => this.arena.resolvePropCollisions(x, y, r),
        );
        if (bandit.readyForRemoval) {
          this.coordinator.releaseAttackToken(bandit.id);
          bandit.destroy();
          this.bandits.splice(i, 1);
        }
      }

      // Update surface hazards
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const hz = this.hazards[i];
        hz.update(delta);
        if (hz.expired) {
          hz.destroy();
          this.hazards.splice(i, 1);
        }
      }

      // Run Step 3 emergent physical collisions (tables, barrels, domino chains, slipping!)
      this.chainManager.step(delta, this.bandits, this.envObjects, this.hazards);
    }

    this.renderDebugVisuals();

    const aliveCount = this.bandits.filter((b) => b.isAlive).length;
    this.combatHud.render(
      {
        playerHp: this.player.hp,
        playerMaxHp: this.player.maxHp,
        playerDefeated: this.player.isDefeated,
        enemiesAlive: aliveCount,
        enemiesDefeated: this.enemiesDefeated,
        comboHits: this.comboHits,
      },
      this,
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

    let hitEnemyCount = 0;

    // 1. Check hits against bandits
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!this.player.hitTracker.canHit(bandit.id)) continue;

      const result = check25DMeleeHit(query, bandit.getHurtbox());
      if (!result.hit) continue;

      this.player.hitTracker.recordHit(bandit.id);
      const damage = Math.max(
        1,
        Math.round(spec.baseDamage * this.tuning.playerDamageMultiplier),
      );

      const applied = bandit.takeHit(
        {
          damage,
          dirX: query.dirX,
          dirY: query.dirY,
          knockbackForce: spec.knockbackForce,
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

    // 2. Check spear strikes against environmental objects (barrels roll, jars shatter, baskets spill!)
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
        if (obj.spec.rollable) {
          this.audio.playBarrelCollision();
        } else {
          this.audio.playTableImpact();
        }
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

  /**
   * Stage object placement per Step 3 spec:
   * - 3 wooden tables
   * - 3 barrels (2 water-filled, 1 empty)
   * - 4 ceramic jars
   * - 2 fruit baskets
   * - 1 small starter puddle
   * Spread cleanly across foreground, mid, and background depths with open paths!
   */
  private spawnInitialEnvironment(): void {
    // 3 Wooden Tables (positioned near bandits for immediate pickup & throw fun)
    this.spawnObject('table', 515, 488);
    this.spawnObject('table', 775, 494);
    this.spawnObject('table', 640, 344);

    // 3 Barrels (2 water barrels + 1 empty barrel)
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
        onRollTick: () => {
          this.audio.playBarrelRoll();
        },
        onBroken: (o, dirX, dirY) => {
          this.handleObjectBroken(o, dirX, dirY);
        },
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
      // Drop a classic cartoon banana peel slightly ahead!
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

  private spawnInitialBandits(): void {
    const presetSpots: Array<{ x: number; y: number }> = [
      { x: 475, y: 318 },
      { x: 805, y: 326 },
      { x: 382, y: 458 },
      { x: 896, y: 468 },
      { x: 472, y: 586 },
      { x: 818, y: 594 },
    ];

    const count = Math.max(1, Math.round(this.tuning.enemyCount));
    for (let i = 0; i < count; i++) {
      if (i < presetSpots.length) {
        this.spawnBanditAt(presetSpots[i].x, presetSpots[i].y, i);
      } else {
        this.spawnSingleBandit();
      }
    }
  }

  private spawnSingleBandit(): void {
    const y = Phaser.Math.Between(ARENA_BOUNDS.backY + 45, ARENA_BOUNDS.frontY - 55);
    const bounds = getHorizontalBoundsAtY(y);
    const leftSide = Math.random() < 0.5;
    const x = leftSide
      ? Phaser.Math.Between(Math.round(bounds.left + 70), Math.round(bounds.left + 210))
      : Phaser.Math.Between(Math.round(bounds.right - 210), Math.round(bounds.right - 70));

    this.spawnBanditAt(x, y, this.bandits.length);
  }

  private spawnBanditAt(rawX: number, rawY: number, slotIndex: number): void {
    const clamped = clampToArena(rawX, rawY, 20);
    const id = `bandit_${this.nextBanditSeq++}`;

    const bandit = new Bandit(
      this,
      id,
      slotIndex,
      clamped.x,
      clamped.y,
      this.tuning,
      {
        onAttackWhoosh: () => this.audio.playEnemyWhoosh(),
        onHitPlayer: (damage, dirX, dirY) => {
          this.player.takeDamage(damage, dirX, dirY);
        },
        onLanded: (b, impactSpeed) => {
          const strong = impactSpeed > 150;
          this.audio.playKnockdownLanding();
          this.vfx.spawnLandingImpact(b.x, b.y, strong);
          if (strong) {
            this.screenShake.trigger(3.2, 75, 0, 1);
          }
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
          this.eventsBus.emit('combat:enemy_defeated', {
            enemyId: b.id,
            x: b.x,
            y: b.y,
          });
        },
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
    this.hitStop.reset();
    this.screenShake.reset();
    this.coordinator.reset();
    this.enemiesDefeated = 0;
    this.comboHits = 0;
    this.comboDecayMs = 0;
    this.player.reset(PLAYER_CONFIG.spawnX, PLAYER_CONFIG.spawnY);
    this.spawnInitialBandits();
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
      this.debugVisGfx.lineStyle(2, 0x22c55e, 0.9);
      this.debugVisGfx.strokeEllipse(
        this.player.x,
        this.player.y,
        this.player.collisionRadius * 2 * pScale,
        this.player.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * pScale,
      );

      for (const b of this.bandits) {
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
