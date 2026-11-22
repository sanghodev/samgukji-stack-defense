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
import { check25DMeleeHit } from '../core/CombatMath';
import { EventBus } from '../core/EventBus';
import { clampToArena, getHorizontalBoundsAtY, getPerspectiveScale } from '../core/Perspective';
import { Bandit } from '../entities/Bandit';
import { Warrior } from '../entities/Warrior';
import { CombatAudioManager } from '../systems/CombatAudioManager';
import { CombatCoordinator } from '../systems/CombatCoordinator';
import { CombatDebugPanel } from '../systems/CombatDebugPanel';
import { CombatHud } from '../systems/CombatHud';
import { DebugOverlay } from '../systems/DebugOverlay';
import { HitStopSystem } from '../systems/HitStopSystem';
import { ImpactVfxSystem } from '../systems/ImpactVfxSystem';
import { InputSystem } from '../systems/InputSystem';
import { SystemRegistry } from '../systems/ModuleRegistry';
import { ScreenShakeSystem } from '../systems/ScreenShakeSystem';
import { MarketplaceArena } from '../world/MarketplaceArena';

/**
 * Main fixed-camera 2.5D arena scene for Three Kingdoms Mayhem (삼국지 난장판).
 * Step 2: Combat Feel Lab — integrates responsive Z/X spear combat, 6 blue-uniformed
 * bandits, true 2.5D melee collision, hit-stop, screen shake, VFX, Web Audio, and F2 tuning panel.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private tuning!: CombatTuning;
  private systems!: SystemRegistry;
  private inputSystem!: InputSystem;
  private debugOverlay!: DebugOverlay;
  private combatDebugPanel!: CombatDebugPanel;
  private combatHud!: CombatHud;
  private hitStop!: HitStopSystem;
  private screenShake!: ScreenShakeSystem;
  private audio!: CombatAudioManager;
  private vfx!: ImpactVfxSystem;
  private coordinator!: CombatCoordinator;
  private arena!: MarketplaceArena;
  private player!: Warrior;

  private readonly bandits: Bandit[] = [];
  private nextBanditSeq = 1;
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
    this.systems = new SystemRegistry({ scene: this, events: this.eventsBus });

    // Register modular subsystems
    this.inputSystem = this.systems.register(new InputSystem());
    this.hitStop = this.systems.register(new HitStopSystem(this.tuning));
    this.screenShake = this.systems.register(new ScreenShakeSystem(this.tuning));
    this.audio = this.systems.register(new CombatAudioManager(this.tuning));
    this.vfx = this.systems.register(new ImpactVfxSystem());
    this.coordinator = this.systems.register(new CombatCoordinator());
    this.combatHud = this.systems.register(new CombatHud(() => this.resetTestRoom()));
    this.debugOverlay = this.systems.register(new DebugOverlay());
    this.combatDebugPanel = this.systems.register(
      new CombatDebugPanel(this.tuning, {
        onSpawnBandit: () => this.spawnSingleBandit(),
        onClearEnemies: () => this.clearAllBandits(),
        onResetRoom: () => this.resetTestRoom(),
        onTuningChanged: () => this.applyLiveTuning(),
      }),
    );

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

    // Debug visualization overlay (hitboxes & ground world positions)
    this.debugVisGfx = this.add.graphics().setDepth(DEPTH_LAYERS.HUD - 10);

    // Spawn initial 6 bandits across varied depth lanes
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

    // Always buffer player attack inputs even during Hit-Stop!
    this.player.bufferInput(input);

    // Always update screen shake, VFX particles, and arena ambience
    this.screenShake.update(time, delta);
    this.vfx.update(time, delta);
    this.arena.update(delta);

    // Decay combo hit display
    if (this.comboHits > 0) {
      this.comboDecayMs -= Math.min(delta, 50);
      if (this.comboDecayMs <= 0) {
        this.comboHits = 0;
      }
    }

    // Hit-stop pauses only combat/entity simulation (preserves input buffer, audio, camera shake)
    const frozenByHitStop = this.hitStop.step(delta);

    if (!frozenByHitStop) {
      this.coordinator.update(time, delta);

      // Update player
      this.player.update(delta, input, (x, y, r) =>
        this.arena.resolvePropCollisions(x, y, r),
      );

      // Resolve player active melee hitbox against bandits (true 2.5D ground space)
      this.resolvePlayerMeleeHits();

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
    }

    // Draw optional debug hitbox / ground position overlays
    this.renderDebugVisuals();

    // Update HUD & F3 debug readout
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

  private resolvePlayerMeleeHits(): void {
    const query = this.player.getActiveHitbox();
    const spec = this.player.currentAttack;
    if (!query || !spec) return;

    let hitCountThisFrame = 0;

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

      hitCountThisFrame += 1;
      this.comboHits += 1;
      this.comboDecayMs = 2200;

      // Synchronized impact VFX at actual point of contact
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

    if (hitCountThisFrame > 0) {
      // Synchronized audio, hit-stop, and controlled screen shake at exact contact moment
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

  private spawnInitialBandits(): void {
    // Spread bandits across rear, mid, and foreground depth lanes (never one flat row!)
    const presetSpots: Array<{ x: number; y: number }> = [
      { x: 470, y: 318 }, // Rear-left near castle gate
      { x: 810, y: 326 }, // Rear-right near castle gate
      { x: 375, y: 455 }, // Mid-left
      { x: 905, y: 468 }, // Mid-right
      { x: 430, y: 604 }, // Foreground-left
      { x: 850, y: 612 }, // Foreground-right
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
    // Pick a varied depth lane away from the player's exact spot
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

  private resetTestRoom(): void {
    this.clearAllBandits();
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

    if (this.tuning.showGroundPositions) {
      // Draw player logical ground footprint
      const pScale = getPerspectiveScale(this.player.y);
      this.debugVisGfx.lineStyle(2, 0x22c55e, 0.9);
      this.debugVisGfx.strokeEllipse(
        this.player.x,
        this.player.y,
        this.player.collisionRadius * 2 * pScale,
        this.player.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * pScale,
      );

      // Draw bandit ground footprints
      for (const b of this.bandits) {
        const bScale = getPerspectiveScale(b.y);
        this.debugVisGfx.lineStyle(2, b.isVulnerable ? 0x38bdf8 : 0x94a3b8, 0.85);
        this.debugVisGfx.strokeEllipse(
          b.x,
          b.y,
          b.collisionRadius * 2 * bScale,
          b.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * bScale,
        );
      }

      // Draw static arena prop footprints
      for (const prop of this.arena.props) {
        this.debugVisGfx.lineStyle(1.5, 0xfbbf24, 0.65);
        this.debugVisGfx.strokeEllipse(
          prop.x,
          prop.y,
          prop.radius * 2,
          prop.radius * 2 * 0.72,
        );
      }
    }

    if (this.tuning.showHitboxes) {
      const hb = this.player.getActiveHitbox();
      if (hb) {
        // Draw oriented 2.5D melee hitbox quad in world space
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
    this.player?.destroy();
    this.arena?.destroy();
    this.debugVisGfx?.destroy();
    this.systems?.destroy();
    this.eventsBus?.clear();
  }
}
