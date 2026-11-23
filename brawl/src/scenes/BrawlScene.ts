import Phaser from 'phaser';
import {
  ARENA_BOUNDS,
  DEPTH_LAYERS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PERSPECTIVE_CONFIG,
} from '../config/arenaConfig';
import { CombatTuning, createDefaultCombatTuning } from '../config/combatConfig';
import {
  createDefaultStep5Tuning,
  getPartyBalanceProfile,
  HERO_DATA,
  HeroId,
  Step5Tuning,
} from '../config/heroConfig';
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
import {
  STAGE_1_WAVES,
  STAGE1_SPAWN_POINTS,
} from '../config/stage1Config';
import {
  rollTreasureChoices,
  TREASURE_BY_ID,
} from '../config/treasureConfig';
import { check25DMeleeHit } from '../core/CombatMath';
import { EventBus } from '../core/EventBus';
import { sweptCircleHit25D } from '../core/MayhemPhysics';
import { PartyManager } from '../core/PartyManager';
import { PersistentProgressStore } from '../core/PersistentProgress';
import {
  clampToArena,
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
} from '../core/Perspective';
import { StageDirector, StageStepResult } from '../core/StageDirector';
import { Bandit } from '../entities/Bandit';
import { BanditChief } from '../entities/BanditChief';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { Projectile } from '../entities/Projectile';
import { SurfaceHazard } from '../entities/SurfaceHazard';
import { TreasurePickup } from '../entities/TreasurePickup';
import { ArrowFireRequest, Warrior } from '../entities/Warrior';
import { createDefaultPolishSettings, PolishSettings } from '../config/polishConfig';
import { AIHeroController } from '../systems/AIHeroController';
import { CameraGagController } from '../systems/CameraGagController';
import { CollisionChainManager } from '../systems/CollisionChainManager';
import { CombatAudioManager } from '../systems/CombatAudioManager';
import { CombatCoordinator } from '../systems/CombatCoordinator';
import { CombatDebugPanel, QualityTestSceneId } from '../systems/CombatDebugPanel';
import { CombatHud } from '../systems/CombatHud';
import { DebrisEffectManager } from '../systems/DebrisEffectManager';
import { DebugOverlay } from '../systems/DebugOverlay';
import { HitStopSystem } from '../systems/HitStopSystem';
import { ImpactVfxSystem } from '../systems/ImpactVfxSystem';
import { InputSystem } from '../systems/InputSystem';
import { SystemRegistry } from '../systems/ModuleRegistry';
import { HeroActionInput, MultiInputManager } from '../systems/MultiInputManager';
import { PartySetupOverlay } from '../systems/PartySetupOverlay';
import { PerformanceMonitor } from '../systems/PerformanceMonitor';
import { ScreenShakeSystem } from '../systems/ScreenShakeSystem';
import { HumanTreasureOffer, StageOverlayUI } from '../systems/StageOverlayUI';
import { MarketplaceArena } from '../world/MarketplaceArena';

const HERO_SPAWN_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 540, y: 540 }, // Zhao Yun (front center-left)
  { x: 350, y: 425 }, // Guan Yu (mid-left)
  { x: 785, y: 430 }, // Zhang Fei (mid-right)
  { x: 255, y: 555 }, // Huang Zhong (rear-left archer vantage)
];

/**
 * Main fixed-camera 2.5D arena scene for Three Kingdoms Mayhem (삼국지 난장판).
 * Step 7: Arcade Quality Polish — Hero-colored weapon trails, priority/capped hit-stop,
 * directional camera shake + impact flash, multi-bus audio mixer with dynamic ducking &
 * voice budget, A/B Combat Feel Presets, PerformanceMonitor, Accessibility, and Test Scenes A-H.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private tuning!: CombatTuning;
  private mayhemTuning!: MayhemTuning;
  private step4Tuning!: Step4Tuning;
  private step5Tuning!: Step5Tuning;
  private polishSettings!: PolishSettings;
  private perfMonitor!: PerformanceMonitor;
  private party!: PartyManager;
  private stageDirector!: StageDirector;
  private progressStore!: PersistentProgressStore;

  private systems!: SystemRegistry;
  private inputSystem!: InputSystem;
  private multiInput!: MultiInputManager;
  private aiHeroCtrl!: AIHeroController;
  private partyOverlay!: PartySetupOverlay;
  private stageOverlay!: StageOverlayUI;
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

  private readonly heroes: Warrior[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly bandits: Bandit[] = [];
  private readonly envObjects: EnvironmentalObject[] = [];
  private readonly hazards: SurfaceHazard[] = [];
  private readonly treasurePickups: TreasurePickup[] = [];
  private boss: BanditChief | null = null;

  private nextBanditSeq = 1;
  private nextObjectSeq = 1;
  private nextHazardSeq = 1;
  private nextProjectileSeq = 1;
  private nextTreasureSeq = 1;

  private enemiesDefeated = 0;
  private comboHits = 0;
  private comboDecayMs = 0;
  private lastComboMilestone = 0;
  private debugVisGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('BrawlScene');
  }

  public create(): void {
    // Strictly stationary fixed camera
    this.cameras.main.setViewport(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    this.eventsBus = new EventBus();
    this.tuning = createDefaultCombatTuning();
    this.mayhemTuning = createDefaultMayhemTuning();
    this.step4Tuning = createDefaultStep4Tuning();
    this.step5Tuning = createDefaultStep5Tuning();
    this.polishSettings = createDefaultPolishSettings();
    this.perfMonitor = new PerformanceMonitor(120);
    this.party = new PartyManager();
    this.progressStore = new PersistentProgressStore();
    this.stageDirector = new StageDirector(
      this.party.humanPlayerCount,
      this.party.aiSlots.length,
    );
    this.systems = new SystemRegistry({ scene: this, events: this.eventsBus });

    // Register modular subsystems
    this.inputSystem = this.systems.register(new InputSystem());
    this.multiInput = this.systems.register(
      new MultiInputManager({
        onGamepadJoinRequested: (deviceId) => this.handleJoinInProgress(deviceId),
        onGamepadDisconnected: (deviceId) => this.handleDeviceDisconnected(deviceId),
      }),
    );
    this.aiHeroCtrl = new AIHeroController(this.step5Tuning);
    this.hitStop = this.systems.register(new HitStopSystem(this.tuning, this.polishSettings));
    this.screenShake = this.systems.register(
      new ScreenShakeSystem(this.tuning, this.polishSettings),
    );
    this.audio = this.systems.register(
      new CombatAudioManager(this.tuning, this.mayhemTuning, this.polishSettings),
    );
    this.vfx = this.systems.register(new ImpactVfxSystem());
    this.debris = this.systems.register(new DebrisEffectManager(this.mayhemTuning));
    this.coordinator = this.systems.register(new CombatCoordinator());
    this.cameraGag = this.systems.register(
      new CameraGagController(this.step4Tuning, this.audio, this.screenShake),
    );
    this.partyOverlay = this.systems.register(
      new PartySetupOverlay(this.party, {
        onApplyParty: () => this.rebuildPartyAndRestartStage(),
      }),
    );
    this.stageOverlay = this.systems.register(
      new StageOverlayUI(this.party, {
        onStartStage: () => this.startStage1Run(true),
        onIntroFinished: () => this.beginWave1AfterIntro(),
        onTreasurePicked: (heroId, treasureId) => this.applyTreasureToHero(heroId, treasureId),
        onAllTreasuresResolved: () => {
          const res = this.stageDirector.finishTreasureReward();
          this.handleStageStepResult(res);
        },
        onRetryStage: () => this.startStage1Run(false),
        onOpenHeroChange: () => {
          this.stageOverlay.showMainMenu(this.progressStore.snapshot);
        },
        onReturnToMainMenu: () => this.openMainMenu(),
      }),
    );
    this.combatHud = this.systems.register(
      new CombatHud(
        () => this.startStage1Run(false),
        () => this.partyOverlay.toggle(),
      ),
    );
    this.debugOverlay = this.systems.register(new DebugOverlay());
    this.combatDebugPanel = this.systems.register(
      new CombatDebugPanel(
        this.tuning,
        this.mayhemTuning,
        this.step4Tuning,
        this.step5Tuning,
        this.polishSettings,
        {
          onSpawnBandit: (arch) => this.spawnSingleBandit(arch),
          onSpawnBanditGroup: () => {
            const pool: BanditArchetype[] = ['coward', 'clumsy', 'overconfident', 'sneaky', 'stubborn'];
            for (let i = 0; i < 5; i++) this.spawnSingleBandit(pool[i % pool.length]);
          },
          onClearEnemies: () => this.clearAllBandits(),
          onSpawnObject: (kind) => this.spawnObjectNearPrimaryHero(kind),
          onSpawnPuddle: () => {
            const p = this.getPrimaryHumanHero();
            if (p) {
              this.spawnHazard(
                'water_puddle',
                p.x + Math.cos(p.facingAngle) * 70,
                p.y + Math.sin(p.facingAngle) * 48,
              );
            }
          },
          onResetEnvironment: () => this.resetEnvironmentObjects(),
          onClearDebris: () => {
            this.debris.clearAll();
            this.clearAllHazards();
          },
          onTriggerSpecial: (heroId) => this.debugTriggerHeroSpecial(heroId),
          onForceEnemyPanic: () => {
            for (const b of this.bandits) b.forcePanic(this.coordinator);
          },
          onPreviewCameraGag: () => this.cameraGag.forcePreview(),
          onResetAiStates: () => {
            for (const b of this.bandits) b.resetAiState(this.coordinator);
          },
          onSwitchHero: () => this.handleTabCycleHero(),
          onOpenPartySetup: () => this.partyOverlay.toggle(),
          onForceAiToHuman: () => {
            const simDev = `gamepad:${this.party.humanPlayerCount}`;
            this.handleJoinInProgress(simDev);
          },
          onForceHumanToAi: () => {
            const extraHuman = this.party.humanSlots.find((s) => s.deviceId !== 'keyboard');
            if (extraHuman?.deviceId) {
              this.handleDeviceDisconnected(extraHuman.deviceId);
            } else {
              this.partyOverlay.showToast('P1 키보드는 유지됩니다 (추가 플레이어 없음)');
            }
          },
          onSimulateGamepadDisconnect: () => {
            const padSlot = this.party.humanSlots.find((s) => s.deviceId?.startsWith('gamepad:'));
            if (padSlot?.deviceId) {
              this.handleDeviceDisconnected(padSlot.deviceId);
            } else {
              this.partyOverlay.showToast('연결된 게임패드 슬롯이 없습니다');
            }
          },
          onTestFourPlayerInputs: () => this.debugSimulateFourPlayerBurst(),
          onResetHeroPositions: () => {
            this.heroes.forEach((h, idx) => {
              const spot = HERO_SPAWN_OFFSETS[idx % HERO_SPAWN_OFFSETS.length];
              h.reset(spot.x, spot.y);
            });
          },
          onResetSpecialCooldowns: () => {
            for (const h of this.heroes) h.specialCooldownMs = 0;
          },
          onResetRoom: () => this.startStage1Run(false),
          onTuningChanged: () => this.applyLiveTuning(),
          // Step 6 Debug Actions
          onJumpToWave: (waveIndex) => {
            this.stageOverlay.hideAllModals();
            this.clearAllBandits();
            this.clearBoss();
            const res = this.stageDirector.jumpToWave(waveIndex);
            this.handleStageStepResult(res);
          },
          onSpawnBoss: () => {
            this.stageOverlay.hideAllModals();
            this.spawnBossChief();
          },
          onDamageBoss: (pct) => {
            if (this.boss && this.boss.isAlive) {
              this.boss.applyHit(Math.round(this.boss.maxHp * pct), 0, -1, 200, false);
            }
          },
          onForceBossEnraged: () => {
            if (this.boss && this.boss.isAlive) {
              this.boss.forcePhase('ENRAGED');
            }
          },
          onGrantNextTreasure: () => {
            const h = this.getPrimaryHumanHero();
            if (!h) return;
            const choices = rollTreasureChoices(h.heroId, h.acquiredTreasures, this.stageDirector.rng);
            if (choices[0]) {
              this.applyTreasureToHero(h.heroId, choices[0].id);
            }
          },
          onOpenTreasureSelection: () => this.openTreasureRewardModal(),
          onResetTemporaryUpgrades: () => {
            for (const h of this.heroes) h.resetTreasures();
            this.partyOverlay.showToast('임시 보물 업그레이드 초기화 완료');
          },
          onForceVictory: () => {
            const res = this.stageDirector.triggerVictory();
            this.handleStageStepResult(res);
          },
          onForceDefeat: () => {
            const res = this.stageDirector.triggerDefeat();
            this.handleStageStepResult(res);
          },
          onReturnMainMenu: () => this.openMainMenu(),
          onRunQualityTest: (id) => this.runQualityTestScene(id),
          onPresetApplied: (label) => this.partyOverlay.showToast(`🎛 ${label}`),
        },
      ),
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
    this.debugVisGfx = this.add.graphics().setDepth(DEPTH_LAYERS.HUD - 10);

    // Prepare arena backdrop & heroes, then present the Stage 1 Main Menu (or jump into combat if ?autostart=1)
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (params?.get('autostart') === '1') {
      this.startStage1Run(false);
    } else {
      this.openMainMenu();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  public update(time: number, delta: number): void {
    const kbInput = this.inputSystem.sample();

    if (kbInput.toggleDebugPressed) {
      const visible = this.debugOverlay.toggle();
      this.eventsBus.emit('debug:toggled', { visible });
    }

    if (kbInput.toggleCombatPanelPressed) {
      const visible = this.combatDebugPanel.toggle();
      this.eventsBus.emit('combat:panel_toggled', { visible });
    }

    if (kbInput.partySetupPressed && !this.stageOverlay.isBlockingCombat) {
      this.partyOverlay.toggle();
      return;
    }

    // Always animate ambient marketplace petals & adaptive BGM even during pauses
    this.arena.update(delta);
    this.audio.updateAdaptiveBgm(delta);

    // Pause combat simulation cleanly while Party Setup or Stage Modals (Menu/Intro/Treasure/Victory/Defeat) are open
    if (this.partyOverlay.isOpen || this.stageOverlay.isBlockingCombat) return;

    if (kbInput.restartPressed) {
      this.startStage1Run(false);
      return;
    }

    if (kbInput.switchHeroPressed) {
      this.handleTabCycleHero();
    }

    // Poll Gamepad Start buttons for Join-in-Progress!
    const assignedDevices = new Set(
      this.party.humanSlots.map((s) => s.deviceId).filter((d): d is string => Boolean(d)),
    );
    this.multiInput.pollJoinRequests(assignedDevices);

    // Gather unified inputs (Human Keyboard/Gamepad OR AIHeroController) for each active hero
    const heroInputs = new Map<HeroId, HeroActionInput>();
    for (const hero of this.heroes) {
      const slot = this.party.getSlotByHero(hero.heroId);
      let actionInput: HeroActionInput;
      if (slot && slot.control === 'HUMAN' && slot.deviceId) {
        actionInput = this.multiInput.sampleDevice(slot.deviceId, kbInput);
      } else {
        actionInput = this.aiHeroCtrl.computeInput(
          hero,
          delta,
          this.heroes,
          this.bandits,
          this.envObjects,
        );
      }
      heroInputs.set(hero.heroId, actionInput);
      hero.bufferInput(actionInput);
    }

    // Always update screen shake, camera gag, VFX, and debris
    this.screenShake.update(time, delta);
    this.cameraGag.update(time, delta);
    this.vfx.update(time, delta);
    this.debris.update(time, delta);

    if (this.comboHits > 0) {
      this.comboDecayMs -= Math.min(delta, 50);
      if (this.comboDecayMs <= 0) {
        this.comboHits = 0;
        this.lastComboMilestone = 0;
      }
    }

    const frozenByHitStop = this.hitStop.step(delta);

    if (!frozenByHitStop) {
      this.coordinator.update(time, delta);

      // Step StageDirector state machine (waves, boss warning, anti-stall, victory/defeat)
      const activeNonNeutralized = this.bandits.filter((b) => !b.isNeutralized).length;
      const aliveHeroes = this.heroes.filter((h) => !h.isDefeated);
      const stageRes = this.stageDirector.step({
        deltaMs: delta,
        activeNonNeutralizedEnemies: activeNonNeutralized,
        activeBossAlive: this.boss ? this.boss.isAlive : false,
        bossSpawned: this.boss !== null,
        aliveHeroCount: aliveHeroes.length,
        heroPositions: aliveHeroes.map((h) => ({ x: h.x, y: h.y })),
      });
      this.handleStageStepResult(stageRes);
      if (this.stageOverlay.isBlockingCombat) return;

      // Update all active heroes (1..4)
      for (const hero of this.heroes) {
        const inp = heroInputs.get(hero.heroId);
        if (!inp) continue;

        if (inp.specialPressed && !hero.isDefeated) {
          hero.triggerSpecial(inp);
        }
        if (inp.interactPressed && !hero.isDefeated) {
          this.handleHeroInteract(hero);
        }

        hero.update(delta, inp, this.heroes, (x, y, r) =>
          this.arena.resolvePropCollisions(x, y, r),
        );

        this.resolveHeroMeleeHits(hero);
        if (hero.isChargeActive) {
          this.resolveZhangFeiChargeCollisions(hero);
        }
      }

      this.updatePickupPrompts();
      this.updateTreasurePickups(delta);
      this.updateProjectiles(delta);

      // Update environmental objects + thrown object impact vs Boss!
      for (let i = this.envObjects.length - 1; i >= 0; i--) {
        const obj = this.envObjects[i];
        obj.update(delta, (x, y, r) => this.arena.resolvePropCollisions(x, y, r));
        if (
          this.boss &&
          this.boss.isAlive &&
          !obj.isBroken &&
          (obj.state === 'THROWN' || obj.state === 'ROLLING')
        ) {
          const d = Math.hypot(
            obj.x - this.boss.x,
            (obj.y - this.boss.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
          );
          if (d <= obj.radius + this.boss.collisionRadius + 8) {
            const nx = (this.boss.x - obj.x) / (Math.hypot(this.boss.x - obj.x, this.boss.y - obj.y) || 1);
            const ny = (this.boss.y - obj.y) / (Math.hypot(this.boss.x - obj.x, this.boss.y - obj.y) || 1);
            const dmg = obj.spec.kind === 'table' ? 48 : 34;
            this.damageBoss(dmg, nx, ny, 480, true);
            obj.applyStrike(-nx, -ny, 260, 3, true);
          }
        }
        if (obj.readyForRemoval) {
          obj.destroy();
          this.envObjects.splice(i, 1);
        }
      }

      // Update bandits (each targets nearest alive hero!)
      for (let i = this.bandits.length - 1; i >= 0; i--) {
        const bandit = this.bandits[i];
        const targetHero = this.findNearestAliveHero(bandit.x, bandit.y);
        bandit.update(
          delta,
          targetHero ? targetHero.x : 640,
          targetHero ? targetHero.y : 515,
          targetHero !== null,
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

      // Update Bandit Chief Boss
      if (this.boss) {
        this.boss.update(
          delta,
          this.heroes.map((h) => ({ id: h.id, x: h.x, y: h.y, isDefeated: h.isDefeated })),
          (x, y, r) => this.arena.resolvePropCollisions(x, y, r),
        );
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

      this.chainManager.step(delta, this.bandits, this.envObjects, this.hazards);
    }

    this.renderDebugVisuals();

    // Update Boss HP bar & F2 Debug Status
    this.stageOverlay.updateBossBar(
      Boolean(this.boss && this.boss.isAlive),
      this.boss?.hp ?? 0,
      this.boss?.maxHp ?? 1,
      Boolean(this.boss?.isEnraged),
    );

    const activeEnemies = this.bandits.filter((b) => !b.isNeutralized).length + (this.boss?.isAlive ? 1 : 0);
    const surrenderedCount = this.bandits.filter((b) => b.state === 'SURRENDERED').length;
    const allDefeated = this.heroes.every((h) => h.isDefeated);

    this.perfMonitor.recordFrame(delta);
    const perfSnap = this.perfMonitor.getSnapshot({
      activeEnemies,
      activeProjectiles: this.projectiles.length,
      activeParticles: this.vfx.activeParticleCount,
      activeAudioVoices: this.audio.activeVoiceCount,
    });
    this.combatDebugPanel.updatePerfStatus(
      `FPS:${perfSnap.avgFps.toFixed(0)} | P50:${perfSnap.medianFrameMs.toFixed(1)}ms | P95:${perfSnap.p95FrameMs.toFixed(1)}ms | Max:${perfSnap.maxSpikeMs.toFixed(0)}ms | Fx:${perfSnap.activeParticles} | Vox:${perfSnap.activeAudioVoices}`,
    );

    this.combatDebugPanel.updateStageStatus(
      `STATE: ${this.stageDirector.state} | W${this.stageDirector.waveIndex + 1}/5 | Queue:${this.stageDirector.remainingSpawnsInWave} | Active:${activeEnemies} | Score:${this.stageDirector.stats.totalScore}`,
    );

    this.combatHud.render(
      {
        heroes: this.heroes.map((h) => ({
          slotIndex: h.slotIndex,
          heroId: h.heroId,
          control: h.controlType,
          hp: h.hp,
          maxHp: h.maxHp,
          specialReadyRatio: h.specialReadyRatio,
          isDefeated: h.isDefeated,
          treasureCount: h.acquiredTreasures.length,
        })),
        allHumansDefeated: allDefeated,
        enemiesActive: activeEnemies,
        enemiesNeutralized: this.enemiesDefeated + surrenderedCount,
        enemiesSurrendered: surrenderedCount,
        comboHits: this.comboHits,
        waveNumber: this.stageDirector.waveIndex + 1,
        totalWaves: this.stageDirector.totalWaves,
        score: this.stageDirector.stats.totalScore,
        suppressBuiltInDefeat: true,
      },
      this,
      delta,
    );

    const primary = this.getPrimaryHumanHero() ?? this.heroes[0];
    if (primary) {
      this.debugOverlay.render({
        fps: this.game.loop.actualFps,
        x: primary.x,
        y: primary.y,
        depthRatio: primary.depthRatio,
        scale: primary.currentScale,
        facing: primary.facingLabel,
        speed: primary.speed,
      });
    }
  }

  // ==================== PARTY & MULTIPLAYER LIFECYCLE ====================

  // ==================== STEP 6 STAGE 1 FLOW & LIFECYCLE ====================

  private openMainMenu(): void {
    this.resetWorldEntitiesOnly();
    this.stageDirector.resetForNewRun(
      this.party.humanPlayerCount,
      this.party.aiSlots.length,
    );
    this.audio.setMusicIntensity('CALM');
    this.stageOverlay.updateBossBar(false, 0, 1, false);
    this.spawnActivePartyHeroes();
    this.stageOverlay.showMainMenu(this.progressStore.snapshot);
  }

  private rebuildPartyAndRestartStage(): void {
    this.startStage1Run(false);
  }

  private startStage1Run(withIntro: boolean): void {
    this.resetWorldEntitiesOnly();
    this.stageDirector.resetForNewRun(
      this.party.humanPlayerCount,
      this.party.aiSlots.length,
      Date.now(),
    );
    this.spawnActivePartyHeroes();
    this.stageOverlay.updateBossBar(false, 0, 1, false);
    this.audio.playStageOpen();

    if (withIntro) {
      this.stageDirector.startIntro();
      this.stageOverlay.startStoryIntro(this.heroes.map((h) => h.heroId));
    } else {
      this.beginWave1AfterIntro();
    }
  }

  private beginWave1AfterIntro(): void {
    const res = this.stageDirector.finishIntroAndBeginStage();
    this.handleStageStepResult(res);
  }

  private resetWorldEntitiesOnly(): void {
    this.clearAllHeroes();
    this.clearAllProjectiles();
    this.clearAllBandits();
    this.clearBoss();
    this.clearTreasurePickups();
    this.resetEnvironmentObjects();
    this.cameraGag.reset();
    this.hitStop.reset();
    this.screenShake.reset();
    this.coordinator.reset();
    this.aiHeroCtrl.clear();

    this.enemiesDefeated = 0;
    this.comboHits = 0;
    this.comboDecayMs = 0;
    this.lastComboMilestone = 0;
  }

  private spawnActivePartyHeroes(): void {
    for (const slot of this.party.activeSlots) {
      if (!slot.heroId) continue;
      const pos = HERO_SPAWN_OFFSETS[slot.slotIndex % HERO_SPAWN_OFFSETS.length];
      this.spawnHero(slot.heroId, slot.slotIndex, slot.control, pos.x, pos.y);
    }
  }

  private handleStageStepResult(res: StageStepResult): void {
    if (res.waveBanner) {
      const isBoss = res.waveBanner.waveNumber === 5;
      this.stageOverlay.showWaveBanner(res.waveBanner.titleKr, res.waveBanner.subtitleKr, isBoss);
      if (isBoss) {
        this.audio.playBossEntrance();
      } else {
        this.audio.playWaveWarning();
      }
      this.audio.setMusicIntensity(this.stageDirector.currentWave.musicIntensity);
    }

    if (res.refreshEnvWaveIndex !== undefined) {
      const wave = STAGE_1_WAVES[res.refreshEnvWaveIndex];
      if (wave?.envRefreshProps) {
        for (const p of wave.envRefreshProps) {
          if (this.envObjects.length < 18) {
            this.spawnObject(p.kind, p.x, p.y);
          }
        }
      }
    }

    if (res.spawns.length > 0) {
      const prevHp = this.tuning.enemyMaxHp;
      for (const s of res.spawns) {
        this.tuning.enemyMaxHp = Math.round(100 * s.hpMultiplier);
        this.spawnBanditAt(s.spawnPoint.x, s.spawnPoint.y, this.bandits.length, s.archetype);
        if (s.archetype === 'elite') {
          this.audio.playEliteEntrance();
          this.stageOverlay.showScoreToast('⚔ 정예 산적 출현!');
        }
      }
      this.tuning.enemyMaxHp = prevHp;
    }

    if (res.shouldFlushHidingBandits) {
      for (const b of this.bandits) {
        b.flushFromCoverOrFlee(this.coordinator);
      }
    }

    if (res.shouldSpawnBoss) {
      this.spawnBossChief();
    }

    if (res.stateChangedTo === 'WAVE_CLEARED') {
      // Simple cooperative revival + small heal between waves!
      for (const h of this.heroes) {
        if (h.isDefeated) {
          h.revive(0.55);
          this.stageOverlay.showScoreToast(`✨ ${h.profile.displayName} 부활!`);
        } else {
          h.heal(18);
        }
      }
      this.stageOverlay.showWaveBanner('WAVE 클리어!', '잠시 후 다음 공세가 시작됩니다!', false);
    } else if (res.stateChangedTo === 'BOSS_WARNING') {
      this.audio.playBossEntrance();
      this.stageOverlay.showWaveBanner(
        '⚠️ 경고 — 산적 두목 등장!',
        '장안문 성문에서 거대한 몽둥이 소리가 울립니다!',
        true,
      );
      this.screenShake.trigger(7, 320);
    } else if (res.stateChangedTo === 'TREASURE_REWARD') {
      this.openTreasureRewardModal();
    } else if (res.stateChangedTo === 'VICTORY') {
      this.handleStageVictory();
    } else if (res.stateChangedTo === 'DEFEAT') {
      this.handleStageDefeat();
    }
  }

  private spawnBossChief(): void {
    this.clearBoss();
    const gate = STAGE1_SPAWN_POINTS.FORTRESS_GATE;
    const bossHp = this.stageDirector.difficulty.bossHp;

    this.boss = new BanditChief(this, gate.x, gate.y, bossHp, {
      onHeavyStep: (b) => {
        this.audio.playHeavyFootstep();
        this.debris.spawn('DUST_CLOUD', b.x, b.y);
        this.screenShake.trigger(3.2, 85);
      },
      onRoar: (b) => {
        this.audio.playBossRoar();
        this.spawnShockwave(b.x, b.y, 0xef4444, 160);
        this.screenShake.trigger(6.5, 180);
      },
      onClubSwing: () => this.audio.playStrongWhoosh(),
      onGroundSlam: (b, radius) => {
        this.audio.playBossHeavySlam();
        this.spawnShockwave(b.x, b.y, 0xf97316, radius * 1.15);
        this.debris.spawn('DUST_CLOUD', b.x, b.y);
        this.screenShake.trigger(8.5, 220, 0, 1);
      },
      onRushStart: (b) => {
        this.audio.playChargeRush();
        this.debris.spawn('DUST_CLOUD', b.x, b.y);
      },
      onRallyBandits: (b) => {
        this.audio.playBossRoar();
        this.spawnShockwave(b.x, b.y, 0xfacc15, 180);
        // Spawn up to 2 cheering escort bandits if battlefield isn't crowded
        const active = this.bandits.filter((x) => !x.isNeutralized).length;
        if (active < 6) {
          this.spawnBanditAt(STAGE1_SPAWN_POINTS.LEFT_ALLEY_REAR.x, STAGE1_SPAWN_POINTS.LEFT_ALLEY_REAR.y, this.bandits.length, 'coward');
          this.spawnBanditAt(STAGE1_SPAWN_POINTS.RIGHT_ALLEY_REAR.x, STAGE1_SPAWN_POINTS.RIGHT_ALLEY_REAR.y, this.bandits.length, 'clumsy');
        }
      },
      onEnraged: (b) => {
        this.audio.playBossRoar();
        this.spawnShockwave(b.x, b.y, 0xef4444, 220);
        this.screenShake.trigger(8.0, 260);
        this.stageOverlay.showWaveBanner('🔥 산적 두목 광분!', '공격이 더욱 거세집니다! 사물로 기절시키세요!', true);
        // Cowardly bandits panic when the boss rages!
        this.broadcastFearWave(b.x, b.y, 500, 45);
      },
      onStaggered: (b) => {
        this.audio.playBossStagger();
        this.hitStop.trigger(55);
        this.screenShake.trigger(7.0, 160);
        this.stageOverlay.showScoreToast('💫 보스 그로기! (+200점)');
        this.stageDirector.addScoreEvent(null, 200);
        this.spawnShockwave(b.x, b.y, 0xfde047, 130);
      },
      onHitHero: (heroId, dmg, dx, dy) => {
        const h = this.heroes.find((x) => x.id === heroId);
        h?.takeDamage(dmg, dx, dy);
      },
      onAccidentalBanditHit: (b, radius, dx, dy) => {
        // Hilarious: Boss accidentally bonks his own nearby bandits!
        for (const bandit of this.bandits) {
          if (!bandit.isVulnerable) continue;
          const dist = Math.hypot(
            bandit.x - b.x,
            (bandit.y - b.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
          );
          if (dist <= radius) {
            const nx = dx || (bandit.x - b.x) / (dist || 1);
            const ny = dy || (bandit.y - b.y) / (dist || 1);
            bandit.takeHit(
              { damage: 14, dirX: nx, dirY: ny, knockbackForce: 340, launchVz: 210, isHeavy: true },
              this.coordinator,
            );
          }
        }
      },
      onSmashEnvironment: (b, radius) => {
        for (const obj of this.envObjects) {
          if (obj.isBroken || obj.state === 'CARRIED') continue;
          const dist = Math.hypot(
            obj.x - b.x,
            (obj.y - b.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
          );
          if (dist <= radius + obj.radius) {
            const nx = (obj.x - b.x) / (dist || 1);
            const ny = (obj.y - b.y) / (dist || 1);
            obj.applyStrike(nx, ny, 380, 3, true);
          }
        }
      },
      onAttackDodged: () => {
        this.stageDirector.recordBossAttackDodged();
        this.stageOverlay.showScoreToast('⚡ 보스 공격 회피! (+150점)');
      },
      onDefeated: (b) => {
        this.audio.playBossDefeat();
        this.hitStop.trigger(95);
        this.screenShake.trigger(11, 320);
        this.spawnShockwave(b.x, b.y, 0xfacc15, 260);
        this.stageDirector.recordEnemyDefeated(false, true);
        // Nearby surviving bandits comically surrender!
        for (const bandit of this.bandits) {
          bandit.forceSurrender(this.coordinator);
        }
        this.time.delayedCall(900, () => {
          const res = this.stageDirector.triggerVictory();
          this.handleStageStepResult(res);
        });
      },
    });
  }

  private damageBoss(
    damage: number,
    dirX: number,
    dirY: number,
    knockbackForce: number,
    isEnvHeavy: boolean,
  ): boolean {
    if (!this.boss || !this.boss.isAlive) return false;
    const permMul = 1 + this.progressStore.getPermanentDamageBonus();
    const finalDmg = Math.round(damage * permMul);
    const res = this.boss.applyHit(finalDmg, dirX, dirY, knockbackForce, isEnvHeavy);
    if (res.appliedDamage <= 0) return false;

    this.registerComboHit();
    this.vfx.spawnHitImpact(
      this.boss.x,
      this.boss.y,
      this.boss.elevationZ + 20,
      dirX,
      dirY,
      isEnvHeavy ? 'HEAVY' : 'LIGHT_2',
      res.appliedDamage,
    );
    if (res.defeated) {
      this.audio.playBossDefeat();
      this.hitStop.trigger(85);
      this.screenShake.trigger(10, 260);
    } else {
      this.audio.playHeavyImpact();
    }
    return true;
  }

  private openTreasureRewardModal(): void {
    this.audio.playTreasurePickup();

    // AI heroes auto-pick their next best hero evolution upgrade silently & smartly!
    const humanOffers: HumanTreasureOffer[] = [];
    for (const h of this.heroes) {
      const choices = rollTreasureChoices(h.heroId, h.acquiredTreasures, this.stageDirector.rng);
      if (choices.length === 0) continue;

      if (h.isHumanControlled) {
        humanOffers.push({
          slotIndex: h.slotIndex,
          heroId: h.heroId,
          choices,
        });
      } else {
        // AI picks its hero-specific evolution tier first (choices[0])
        h.addTreasure(choices[0].id);
      }
    }

    this.stageOverlay.openTreasureSelection(humanOffers);
  }

  private applyTreasureToHero(heroId: HeroId, treasureId: string): void {
    const hero = this.heroes.find((h) => h.heroId === heroId);
    const def = TREASURE_BY_ID.get(treasureId);
    if (!hero || !def) return;
    hero.addTreasure(treasureId);
    this.audio.playUpgradeConfirm();
    this.spawnShockwave(hero.x, hero.y, hero.profile.accentHex, 130);
    this.stageOverlay.showScoreToast(`✨ ${hero.profile.displayName}: ${def.nameKr} 획득!`);
  }

  private spawnTreasureDrop(x: number, y: number, labelKr = '보물 상자!'): void {
    const clamped = clampToArena(x, y, 28);
    const drop = new TreasurePickup(
      this,
      `treasure_${this.nextTreasureSeq++}`,
      clamped.x,
      clamped.y,
      labelKr,
    );
    this.treasurePickups.push(drop);
  }

  private updateTreasurePickups(deltaMs: number): void {
    for (let i = this.treasurePickups.length - 1; i >= 0; i--) {
      const drop = this.treasurePickups[i];
      drop.update(deltaMs);
      for (const h of this.heroes) {
        if (h.isDefeated || !h.isHumanControlled) continue;
        if (drop.isHeroInRange(h.x, h.y)) {
          drop.collected = true;
          this.audio.playTreasurePickup();
          const choices = rollTreasureChoices(h.heroId, h.acquiredTreasures, this.stageDirector.rng);
          if (choices[0]) {
            this.applyTreasureToHero(h.heroId, choices[0].id);
          }
          drop.destroy();
          this.treasurePickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private handleStageVictory(): void {
    this.clearAllProjectiles();
    this.audio.setMusicIntensity('VICTORY');
    this.audio.playVictoryFanfare();
    const rec = this.progressStore.recordStage1Victory(
      this.stageDirector.stats.totalScore,
      this.stageDirector.stats.clearTimeMs,
    );
    this.stageOverlay.updateBossBar(false, 0, 1, false);
    this.stageOverlay.showVictoryScreen({
      stats: { ...this.stageDirector.stats },
      heroes: this.heroes.map((h) => ({
        slotIndex: h.slotIndex,
        heroId: h.heroId,
        control: h.controlType,
        treasures: [...h.acquiredTreasures],
      })),
      isNewBestScore: rec.isNewBestScore,
      newlyUnlockedId: rec.newlyUnlockedId,
      saveData: this.progressStore.snapshot,
    });
  }

  private handleStageDefeat(): void {
    this.clearAllProjectiles();
    this.audio.setMusicIntensity('DEFEAT');
    this.audio.playDefeatSting();
    this.stageOverlay.updateBossBar(false, 0, 1, false);
    this.stageOverlay.showDefeatScreen({ ...this.stageDirector.stats });
  }

  private registerComboHit(): void {
    this.comboHits += 1;
    this.comboDecayMs = 2400;
    this.stageDirector.recordCombo(this.comboHits);
    const milestones = [10, 20, 30, 50];
    for (const m of milestones) {
      if (this.comboHits >= m && this.lastComboMilestone < m) {
        this.lastComboMilestone = m;
        this.audio.playComboMilestone();
        this.stageDirector.addScoreEvent(null, m * 15);
        this.stageOverlay.showScoreToast(
          m >= 30 ? `🔥 난장판!! ${m}연속 콤보!` : `⚡ ${m}연속 콤보! (+${m * 15}점)`,
        );
      }
    }
  }

  private spawnHero(
    heroId: HeroId,
    slotIndex: number,
    control: 'HUMAN' | 'AI' | 'EMPTY',
    x: number,
    y: number,
  ): Warrior {
    const hero = new Warrior(
      this,
      heroId,
      slotIndex,
      control,
      x,
      y,
      this.tuning,
      this.step4Tuning,
      this.step5Tuning,
      {
        onFootstep: (h, heavy) => {
          if (heavy) {
            this.audio.playHeavyFootstep();
            if (h.isChargeActive) {
              this.vfx.spawnChargeFlameTrail(h.x, h.y, h.chargeDirX, h.chargeDirY);
            }
          } else {
            this.audio.playFootstep();
          }
        },
        onAttackActiveStart: (h, attackType, ax, ay, dirX, dirY, range) => {
          if (h.heroId === 'guanyu') {
            this.audio.playGuandaoSweep();
            // Guan Yu Tier 4 Treasure: Green wind projectile on heavy attacks!
            if (attackType === 'HEAVY' && h.heroMods.heavyWindProjectile) {
              this.spawnGuanYuWindBlade(h, ax, ay, dirX, dirY);
            }
          } else if (attackType === 'HEAVY' || attackType === 'LIGHT_3') {
            this.audio.playStrongWhoosh();
          } else {
            this.audio.playLightWhoosh();
          }
          this.vfx.spawnSpearTrail(ax, ay, dirX, dirY, attackType, range, h.heroId);
          // Zhao Yun Tier 3 Treasure: Blue spear afterimage visual burst!
          if (h.heroId === 'zhaoyun' && h.heroMods.afterimageTrail) {
            this.spawnShockwave(ax + dirX * 32, ay + dirY * 18, 0x38bdf8, 68);
          }
        },
        onFireArrow: (req) => this.spawnArrowProjectile(req),
        onZhangFeiRoar: (h) => {
          this.audio.playZhangFeiRoar();
          this.debris.spawn('DUST_CLOUD', h.x, h.y);
          this.spawnShockwave(h.x, h.y, 0xc084fc, 110);
          this.screenShake.trigger(4.5, 140);
          this.broadcastFearWave(h.x, h.y, 360, 34);
        },
        onZhangFeiChargeRush: (h) => {
          this.audio.playChargeRush();
          this.debris.spawn('DUST_CLOUD', h.x, h.y, -h.chargeDirX, -h.chargeDirY);
          this.vfx.spawnChargeFlameTrail(h.x, h.y, h.chargeDirX, h.chargeDirY);
          this.broadcastFearWave(h.x, h.y, 320, 26);
        },
        onZhangFeiChargeSkid: (h) => {
          this.audio.playChargeSkid();
          this.debris.spawn('LANDING_DUST', h.x, h.y);
          // Zhang Fei Tier 5 Treasure: Giant final shockwave at end of Rampaging Charge!
          if (h.heroMods.chargeFinalShockwave) {
            this.executeZhangFeiFinalShockwave(h);
          }
        },
        onWhiteDragonStrike: (h, idx, isFinal) =>
          this.executeZhaoYunWhiteDragonStrike(h, idx, isFinal),
        onGuanYuCyclonePulse: (h, isFinal) =>
          this.executeGuanYuCyclonePulse(h, isFinal),
        onHuangZhongBurst: (h) => this.executeHuangZhongArrowBurst(h),
        onSpecialCooldownRejected: (h) => {
          if (h.isHumanControlled) this.combatHud.flashSpecialRejected();
        },
        onHeroHurt: (h) => {
          this.audio.playPlayerHurt();
          this.vfx.spawnPlayerHitFlash(h.x, h.y);
          if (h.isHumanControlled) {
            this.screenShake.trigger(5.0, 110);
            this.comboHits = 0;
            this.lastComboMilestone = 0;
          }
        },
        onHeroDefeated: () => {
          this.screenShake.trigger(7.5, 200);
        },
      },
    );
    this.heroes.push(hero);
    return hero;
  }

  private handleJoinInProgress(deviceId: string): void {
    const res = this.party.joinHuman(deviceId);
    if (!res.success || !res.heroId || res.slotIndex === undefined) {
      this.partyOverlay.showToast(res.reason ?? '파티가 가득 찼습니다 (최대 4인)');
      return;
    }

    const heroName = HERO_DATA[res.heroId].displayName;
    if (res.mode === 'TOOK_OVER_AI') {
      const existing = this.heroes.find((h) => h.heroId === res.heroId);
      existing?.setOwnership(res.slotIndex, 'HUMAN');
      this.partyOverlay.showToast(`🎮 P${res.slotIndex + 1} 난입! (${heroName} AI → 플레이어 전환)`);
    } else if (res.mode === 'SPAWNED_NEW') {
      const pos = HERO_SPAWN_OFFSETS[res.slotIndex % HERO_SPAWN_OFFSETS.length];
      this.spawnHero(res.heroId, res.slotIndex, 'HUMAN', pos.x, pos.y);
      this.partyOverlay.showToast(`🎮 P${res.slotIndex + 1} 신규 합류! (${heroName} 참전)`);
    }
    this.stageDirector.updatePartySize(this.party.humanPlayerCount, this.party.aiSlots.length);
  }

  private handleDeviceDisconnected(deviceId: string): void {
    const res = this.party.releaseHumanDevice(deviceId);
    if (!res.success || !res.heroId || res.slotIndex === undefined) return;
    const existing = this.heroes.find((h) => h.heroId === res.heroId);
    existing?.setOwnership(res.slotIndex, 'AI');
    const heroName = HERO_DATA[res.heroId].displayName;
    this.partyOverlay.showToast(`🔌 ${deviceId} 연결 해제 → ${heroName} AI 동료로 안전 전환`);
    this.stageDirector.updatePartySize(this.party.humanPlayerCount, this.party.aiSlots.length);
  }

  private handleTabCycleHero(): void {
    const res = this.party.cycleHumanHero('keyboard');
    if (!res.success || !res.heroId) return;
    for (const h of this.heroes) {
      const slot = this.party.getSlotByHero(h.heroId);
      if (slot) h.setOwnership(slot.slotIndex, slot.control);
    }
    this.partyOverlay.showToast(`⚔ P1 영웅 교대 → ${HERO_DATA[res.heroId].displayName}`);
  }

  // ==================== 4 HERO SPECIAL ABILITIES & PROJECTILES ====================

  private spawnGuanYuWindBlade(
    hero: Warrior,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
  ): void {
    const dmg = Math.round(
      28 *
        this.tuning.playerDamageMultiplier *
        hero.profile.damageMultiplier *
        hero.heroMods.damageMultiplier *
        this.step5Tuning.heroDamageMultiplier,
    );
    const proj = new Projectile(this, {
      id: `wind_${this.nextProjectileSeq++}`,
      ownerHeroId: hero.id,
      x: x + dirX * 26,
      y: y + dirY * 16,
      dirX,
      dirY,
      speed: 580,
      damage: dmg,
      knockbackForce: 340 * hero.heroMods.knockbackMultiplier,
      launchVz: 165,
      penetrating: true,
      maxRange: 440,
      radius: 22,
      textureKey: 'wind_blade_projectile',
    });
    this.projectiles.push(proj);
  }

  private executeZhangFeiFinalShockwave(hero: Warrior): void {
    const radius = 195;
    this.audio.playBossHeavySlam();
    this.spawnShockwave(hero.x, hero.y, 0xc084fc, radius * 1.15);
    this.screenShake.trigger(8.0, 190);
    this.broadcastFearWave(hero.x, hero.y, 380, 35);

    const dmg = Math.round(
      34 *
        this.tuning.playerDamageMultiplier *
        hero.heroMods.damageMultiplier *
        this.step5Tuning.heroDamageMultiplier,
    );
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      const dx = bandit.x - hero.x;
      const dy = (bandit.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const d = Math.hypot(dx, dy);
      if (d <= radius + bandit.collisionRadius) {
        const nx = d > 0.1 ? dx / d : 1;
        const ny = d > 0.1 ? dy / d : 0;
        bandit.takeHit(
          {
            damage: dmg,
            dirX: nx,
            dirY: ny,
            knockbackForce: 520 * hero.heroMods.knockbackMultiplier,
            launchVz: 310,
            isHeavy: true,
          },
          this.coordinator,
        );
      }
    }
    if (this.boss && this.boss.isAlive) {
      const dx = this.boss.x - hero.x;
      const dy = (this.boss.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const d = Math.hypot(dx, dy);
      if (d <= radius + this.boss.collisionRadius) {
        this.damageBoss(dmg, dx / (d || 1), dy / (d || 1), 490, true);
      }
    }
  }

  private executeZhaoYunWhiteDragonStrike(
    hero: Warrior,
    _idx: number,
    isFinal: boolean,
  ): void {
    const dirX = Math.cos(hero.facingAngle);
    const dirY = Math.sin(hero.facingAngle);
    this.audio.playWhiteDragonStrike();
    const reach = 115 + this.step5Tuning.treasureMods.extraReach + hero.heroMods.extraReach;
    this.vfx.spawnSpearTrail(
      hero.x,
      hero.y,
      dirX,
      dirY,
      isFinal ? 'LIGHT_3' : 'LIGHT_1',
      reach,
    );

    const query = {
      originX: hero.x,
      originY: hero.y,
      dirX,
      dirY,
      range: reach,
      halfWidth: 44 * hero.heroMods.attackArcMultiplier,
      verticalRatio: PERSPECTIVE_CONFIG.verticalMoveRatio,
      backGrace: 18,
    };

    const dmg = Math.round(
      (isFinal ? 26 : 14) *
        this.tuning.playerDamageMultiplier *
        hero.heroMods.damageMultiplier *
        this.step5Tuning.heroDamageMultiplier,
    );

    let hits = 0;
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!check25DMeleeHit(query, bandit.getHurtbox()).hit) continue;

      if (
        bandit.takeHit(
          {
            damage: dmg,
            dirX,
            dirY,
            knockbackForce: (isFinal ? 420 : 120) * hero.heroMods.knockbackMultiplier,
            launchVz: isFinal ? 250 : 0,
            isHeavy: isFinal,
          },
          this.coordinator,
        )
      ) {
        hits += 1;
        this.registerComboHit();
        this.vfx.spawnHitImpact(
          bandit.x,
          bandit.y,
          bandit.elevationZ,
          dirX,
          dirY,
          isFinal ? 'LIGHT_3' : 'LIGHT_1',
          dmg,
        );
      }
    }

    if (this.boss && this.boss.isAlive) {
      const d = Math.hypot(
        this.boss.x - hero.x,
        (this.boss.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (d <= reach + this.boss.collisionRadius) {
        if (this.damageBoss(dmg, dirX, dirY, isFinal ? 360 : 120, false)) {
          hits += 1;
        }
      }
    }

    if (hits >= 3) this.stageDirector.recordMultiHit(hits);
    if (hits > 0 && isFinal) {
      this.audio.playComboFinisherImpact();
      this.hitStop.trigger(45);
      this.screenShake.trigger(5.5, 110, dirX, dirY);
      this.broadcastFearWave(hero.x, hero.y, 260, 20);
    }
  }

  private executeGuanYuCyclonePulse(hero: Warrior, isFinal: boolean): void {
    const radius =
      148 *
      this.step5Tuning.treasureMods.cycloneRadiusMul *
      hero.heroMods.cycloneRadiusMultiplier;
    this.audio.playCycloneSpin();
    this.spawnShockwave(hero.x, hero.y, 0x22c55e, radius * 1.45);
    this.debris.spawn('DUST_CLOUD', hero.x, hero.y);
    if (this.textures.exists('combat_vfx')) {
      const s = getPerspectiveScale(hero.y);
      for (const ang of [0, Math.PI]) {
        const arc = this.add
          .image(hero.x, hero.y - 26 * s, 'combat_vfx', 1)
          .setOrigin(0.2, 0.5)
          .setRotation(ang)
          .setScale((isFinal ? 1.1 : 0.85) * s)
          .setDepth(getDepthOrder(hero.y) + 25);
        this.tweens.add({
          targets: arc,
          rotation: ang + Math.PI * 1.25,
          alpha: 0,
          duration: 210,
          ease: 'Quad.easeOut',
          onComplete: () => arc.destroy(),
        });
      }
    }

    const dmg = Math.round(
      (isFinal ? 28 : 16) *
        this.tuning.playerDamageMultiplier *
        hero.heroMods.damageMultiplier *
        this.step5Tuning.heroDamageMultiplier,
    );

    let hits = 0;
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      const dx = bandit.x - hero.x;
      const dy = (bandit.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + bandit.collisionRadius) continue;

      const nx = dist > 0.1 ? dx / dist : 1;
      const ny = dist > 0.1 ? dy / dist : 0;

      if (
        bandit.takeHit(
          {
            damage: dmg,
            dirX: nx,
            dirY: ny,
            knockbackForce: (isFinal ? 460 : 185) * hero.heroMods.knockbackMultiplier,
            launchVz: isFinal ? 275 : 0,
            isHeavy: isFinal,
          },
          this.coordinator,
        )
      ) {
        hits += 1;
        this.registerComboHit();
        this.vfx.spawnHitImpact(
          bandit.x,
          bandit.y,
          bandit.elevationZ,
          nx,
          ny,
          isFinal ? 'HEAVY' : 'LIGHT_2',
          dmg,
        );
      }
    }

    if (this.boss && this.boss.isAlive) {
      const dx = this.boss.x - hero.x;
      const dy = (this.boss.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius + this.boss.collisionRadius) {
        if (this.damageBoss(dmg, dx / (dist || 1), dy / (dist || 1), isFinal ? 420 : 160, false)) {
          hits += 1;
        }
      }
    }

    if (hits >= 3) this.stageDirector.recordMultiHit(hits);
    if (hits > 0 && isFinal) {
      this.audio.playHeavyImpact();
      this.hitStop.trigger(52);
      this.screenShake.trigger(6.5, 130);
      this.broadcastFearWave(hero.x, hero.y, 290, 24);
    }
  }

  private executeHuangZhongArrowBurst(hero: Warrior): void {
    this.audio.playArrowBurst();
    const baseAngle = hero.facingAngle;
    const count =
      5 +
      Math.max(0, this.step5Tuning.treasureMods.extraSpreadArrows) +
      hero.heroMods.burstExtraArrows;
    const totalSpread = count >= 9 ? Math.PI * 1.45 : 0.78;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      const ang = baseAngle + t * totalSpread;
      this.spawnArrowProjectile({
        hero,
        x: hero.x + Math.cos(ang) * 24,
        y: hero.y + Math.sin(ang) * 16,
        dirX: Math.cos(ang),
        dirY: Math.sin(ang),
        penetrating: true,
        isBurst: true,
      });
    }
  }

  private spawnArrowProjectile(req: ArrowFireRequest): void {
    if (!req.isBurst) {
      this.audio.playBowRelease();
    }
    const baseDmg = req.penetrating ? 30 : 18;
    const dmg = Math.round(
      baseDmg *
        this.tuning.playerDamageMultiplier *
        req.hero.heroMods.damageMultiplier *
        this.step5Tuning.heroDamageMultiplier,
    );
    const proj = new Projectile(this, {
      id: `arrow_${this.nextProjectileSeq++}`,
      ownerHeroId: req.hero.id,
      x: req.x,
      y: req.y,
      dirX: req.dirX,
      dirY: req.dirY,
      speed: req.penetrating ? 760 : 660,
      damage: dmg,
      knockbackForce: (req.penetrating ? 330 : 155) * req.hero.heroMods.knockbackMultiplier,
      launchVz: req.penetrating ? 175 : 0,
      penetrating: req.penetrating,
      maxRange: 580,
      radius: req.penetrating ? 14 : 11,
      tint: req.penetrating ? 0xfde047 : undefined,
    });
    this.projectiles.push(proj);
  }

  private updateProjectiles(deltaMs: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.update(deltaMs);
      if (proj.readyForRemoval) {
        proj.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      // Swept 2.5D collision vs Bandits
      for (const bandit of this.bandits) {
        if (!bandit.isVulnerable) continue;
        if (!proj.hitTracker.canHit(bandit.id)) continue;

        const hit = sweptCircleHit25D(
          proj.prevX,
          proj.prevY,
          proj.x,
          proj.y,
          proj.radius,
          bandit.x,
          bandit.y,
          bandit.collisionRadius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (!hit.hit) continue;

        proj.hitTracker.recordHit(bandit.id);
        const applied = bandit.takeHit(
          {
            damage: proj.damage,
            dirX: proj.dirX,
            dirY: proj.dirY,
            knockbackForce: proj.knockbackForce,
            launchVz: proj.launchVz,
            isHeavy: proj.penetrating,
          },
          this.coordinator,
        );
        if (!applied) continue;

        this.comboHits += 1;
        this.comboDecayMs = 2200;
        this.audio.playArrowHit();
        this.audio.playEnemyHurt(proj.penetrating);
        this.vfx.spawnHitImpact(
          bandit.x,
          bandit.y,
          bandit.elevationZ,
          proj.dirX,
          proj.dirY,
          proj.penetrating ? 'LIGHT_3' : 'LIGHT_1',
          proj.damage,
        );

        if (!proj.penetrating) {
          proj.readyForRemoval = true;
          break;
        }
      }

      // Swept 2.5D collision vs Bandit Chief Boss!
      if (!proj.readyForRemoval && this.boss && this.boss.isAlive && proj.hitTracker.canHit(this.boss.id)) {
        const hit = sweptCircleHit25D(
          proj.prevX,
          proj.prevY,
          proj.x,
          proj.y,
          proj.radius,
          this.boss.x,
          this.boss.y,
          this.boss.collisionRadius,
          PERSPECTIVE_CONFIG.verticalMoveRatio,
        );
        if (hit.hit) {
          proj.hitTracker.recordHit(this.boss.id);
          this.damageBoss(proj.damage, proj.dirX, proj.dirY, proj.knockbackForce, false);
          this.audio.playArrowHit();
          if (!proj.penetrating) {
            proj.readyForRemoval = true;
          }
        }
      }

      // Swept 2.5D collision vs Environmental Objects (arrows shatter jars & knock barrels!)
      if (!proj.readyForRemoval) {
        for (const obj of this.envObjects) {
          if (obj.isBroken || obj.state === 'CARRIED') continue;
          if (!proj.hitTracker.canHit(obj.id)) continue;

          const hit = sweptCircleHit25D(
            proj.prevX,
            proj.prevY,
            proj.x,
            proj.y,
            proj.radius,
            obj.x,
            obj.y,
            obj.radius,
            PERSPECTIVE_CONFIG.verticalMoveRatio,
          );
          if (!hit.hit) continue;

          proj.hitTracker.recordHit(obj.id);
          obj.applyStrike(proj.dirX, proj.dirY, proj.knockbackForce, 1, proj.penetrating);
          this.audio.playArrowHit();
          if (!proj.penetrating) {
            proj.readyForRemoval = true;
            break;
          }
        }
      }

      // Optional Friendly Fire (default OFF so Huang Zhong never hits allies!)
      if (!proj.readyForRemoval && this.step5Tuning.friendlyFire) {
        for (const ally of this.heroes) {
          if (ally.id === proj.ownerHeroId || ally.isDefeated) continue;
          if (!proj.hitTracker.canHit(ally.id)) continue;
          const hit = sweptCircleHit25D(
            proj.prevX,
            proj.prevY,
            proj.x,
            proj.y,
            proj.radius,
            ally.x,
            ally.y,
            ally.collisionRadius,
            PERSPECTIVE_CONFIG.verticalMoveRatio,
          );
          if (hit.hit) {
            proj.hitTracker.recordHit(ally.id);
            ally.takeDamage(Math.round(proj.damage * 0.4), proj.dirX, proj.dirY);
            if (!proj.penetrating) {
              proj.readyForRemoval = true;
              break;
            }
          }
        }
      }

      if (proj.readyForRemoval) {
        proj.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private resolveZhangFeiChargeCollisions(hero: Warrior): void {
    const chargeRadius = 32;
    let hitEnemy = false;

    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!hero.chargeHitTracker.canHit(bandit.id)) continue;

      const hit = sweptCircleHit25D(
        hero.prevX,
        hero.prevY,
        hero.x,
        hero.y,
        chargeRadius,
        bandit.x,
        bandit.y,
        bandit.collisionRadius,
        PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (!hit.hit) continue;

      hero.chargeHitTracker.recordHit(bandit.id);
      const dirX = hero.chargeDirX * 0.72 + hit.nx * 0.28;
      const dirY = hero.chargeDirY * 0.72 + hit.ny * 0.28;
      const dmg = Math.round(
        this.step4Tuning.chargeDamage *
          this.tuning.playerDamageMultiplier *
          hero.heroMods.damageMultiplier *
          this.step5Tuning.heroDamageMultiplier,
      );

      const applied = bandit.takeHit(
        {
          damage: dmg,
          dirX,
          dirY,
          knockbackForce: this.step4Tuning.chargeKnockback * hero.heroMods.knockbackMultiplier,
          launchVz: this.step4Tuning.chargeLaunchVz,
          isHeavy: true,
        },
        this.coordinator,
      );
      if (!applied) continue;

      hitEnemy = true;
      this.registerComboHit();
      this.vfx.spawnHitImpact(bandit.x, bandit.y, bandit.elevationZ, dirX, dirY, 'HEAVY', dmg);
      this.debris.spawn('HEAVY_IMPACT_SPARK', bandit.x, bandit.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', bandit.x, bandit.y, dirX, dirY);

      const loss =
        this.step4Tuning.chargeEnergyLossPerHit * (bandit.archetype === 'elite' ? 2.0 : 1.0);
      hero.consumeChargeEnergy(loss);
      this.broadcastFearWave(bandit.x, bandit.y, 260, 22);
      if (!hero.isChargeActive) break;
    }

    // Zhang Fei Charge vs Bandit Chief Boss!
    if (
      hero.isChargeActive &&
      this.boss &&
      this.boss.isAlive &&
      hero.chargeHitTracker.canHit(this.boss.id)
    ) {
      const hit = sweptCircleHit25D(
        hero.prevX,
        hero.prevY,
        hero.x,
        hero.y,
        chargeRadius,
        this.boss.x,
        this.boss.y,
        this.boss.collisionRadius,
        PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (hit.hit) {
        hero.chargeHitTracker.recordHit(this.boss.id);
        const dmg = Math.round(
          this.step4Tuning.chargeDamage *
            1.25 *
            this.tuning.playerDamageMultiplier *
            hero.heroMods.damageMultiplier *
            this.step5Tuning.heroDamageMultiplier,
        );
        this.damageBoss(
          dmg,
          hero.chargeDirX,
          hero.chargeDirY,
          this.step4Tuning.chargeKnockback * hero.heroMods.knockbackMultiplier,
          true,
        );
        hitEnemy = true;
        hero.consumeChargeEnergy(42);
      }
    }

    if (hitEnemy) {
      this.audio.playShoulderCollision();
      this.audio.playEnemyHurt(true);
      this.audio.duckMusic(280);
      this.hitStop.trigger(this.polishSettings.heavyHitStopMs, 'HEAVY');
      this.screenShake.trigger(6.5, 125, hero.chargeDirX, hero.chargeDirY);
      this.screenShake.triggerImpactFlash(0xe9d5ff, 0.14, 48);
    }

    if (!hero.isChargeActive) return;

    for (const obj of this.envObjects) {
      if (obj.isBroken || obj.state === 'CARRIED') continue;
      if (!hero.chargeHitTracker.canHit(obj.id)) continue;

      const hit = sweptCircleHit25D(
        hero.prevX,
        hero.prevY,
        hero.x,
        hero.y,
        chargeRadius,
        obj.x,
        obj.y,
        obj.radius,
        PERSPECTIVE_CONFIG.verticalMoveRatio,
      );
      if (!hit.hit) continue;

      hero.chargeHitTracker.recordHit(obj.id);
      obj.applyStrike(
        hero.chargeDirX,
        hero.chargeDirY,
        this.step4Tuning.chargeKnockback * 1.15 * hero.heroMods.knockbackMultiplier,
        2,
        true,
      );
      this.audio.playHeavyEnvImpact();
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y, hit.nx, hit.ny);
      this.screenShake.trigger(5.0, 95, hero.chargeDirX, hero.chargeDirY);
      hero.consumeChargeEnergy(obj.spec.kind === 'table' ? 38 : 16);
      if (!hero.isChargeActive) break;
    }
  }

  private resolveHeroMeleeHits(hero: Warrior): void {
    const query = hero.getActiveHitbox();
    const spec = hero.currentAttack;
    if (!query || !spec) return;

    const prof = hero.profile;
    let hitEnemyCount = 0;

    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!hero.hitTracker.canHit(bandit.id)) continue;

      const result = check25DMeleeHit(query, bandit.getHurtbox());
      if (!result.hit) continue;

      hero.hitTracker.recordHit(bandit.id);
      const damage = Math.max(
        1,
        Math.round(
          spec.baseDamage *
            this.tuning.playerDamageMultiplier *
            prof.damageMultiplier *
            hero.heroMods.damageMultiplier *
            this.step5Tuning.heroDamageMultiplier,
        ),
      );

      const applied = bandit.takeHit(
        {
          damage,
          dirX: query.dirX,
          dirY: query.dirY,
          knockbackForce:
            spec.knockbackForce * prof.knockbackMultiplier * hero.heroMods.knockbackMultiplier,
          launchVz: spec.launchVz,
          isHeavy: spec.isHeavy,
        },
        this.coordinator,
      );
      if (!applied) continue;

      hitEnemyCount += 1;
      this.registerComboHit();

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
    }

    // Hero Melee vs Bandit Chief Boss!
    if (this.boss && this.boss.isAlive && hero.hitTracker.canHit(this.boss.id)) {
      const bossHit = check25DMeleeHit(query, {
        id: this.boss.id,
        x: this.boss.x,
        y: this.boss.y,
        radius: this.boss.collisionRadius,
        elevationZ: this.boss.elevationZ,
        vulnerable: true,
      });
      if (bossHit.hit) {
        hero.hitTracker.recordHit(this.boss.id);
        const damage = Math.max(
          1,
          Math.round(
            spec.baseDamage *
              this.tuning.playerDamageMultiplier *
              prof.damageMultiplier *
              hero.heroMods.damageMultiplier *
              this.step5Tuning.heroDamageMultiplier,
          ),
        );
        if (
          this.damageBoss(
            damage,
            query.dirX,
            query.dirY,
            spec.knockbackForce * prof.knockbackMultiplier * hero.heroMods.knockbackMultiplier,
            false,
          )
        ) {
          hitEnemyCount += 1;
        }
      }
    }

    if (hitEnemyCount >= 3) {
      this.stageDirector.recordMultiHit(hitEnemyCount);
    }

    for (const obj of this.envObjects) {
      if (obj.isBroken || obj.state === 'CARRIED') continue;
      if (!hero.hitTracker.canHit(obj.id)) continue;

      const res = check25DMeleeHit(query, {
        id: obj.id,
        x: obj.x,
        y: obj.y,
        radius: obj.radius,
        elevationZ: obj.elevationZ,
        vulnerable: true,
      });
      if (!res.hit) continue;

      hero.hitTracker.recordHit(obj.id);
      obj.applyStrike(
        query.dirX,
        query.dirY,
        spec.knockbackForce * 1.1,
        spec.isHeavy || spec.isFinisher ? 2 : 1,
        spec.isHeavy || spec.isFinisher,
      );
      if (!obj.isBroken) {
        if (obj.spec.rollable) this.audio.playBarrelCollision();
        else this.audio.playTableImpact();
        this.debris.spawn('DUST_CLOUD', obj.x, obj.y, query.dirX, query.dirY);
      }
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

      if (hero.isHumanControlled) {
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
  }

  // ==================== INTERACTION, ENVIRONMENT & BANDITS ====================

  private handleHeroInteract(hero: Warrior): void {
    if (hero.isCarrying) {
      const thrown = hero.throwCarriedObject(this.mayhemTuning.objectThrowForce);
      if (thrown) {
        if (thrown.spec.kind === 'table') {
          this.audio.playHeavyTableThrow();
          this.stageDirector.recordTableThrown();
        } else {
          this.audio.playStrongWhoosh();
        }
      }
      return;
    }

    const nearest = this.findNearestPickupableFor(hero);
    if (nearest && hero.pickUpObject(nearest)) {
      this.audio.playWoodPickup();
      if (nearest.spec.kind === 'table') this.audio.playWoodCreak();
    }
  }

  private findNearestPickupableFor(hero: Warrior): EnvironmentalObject | null {
    let best: EnvironmentalObject | null = null;
    let bestDistSq = Infinity;
    const grabReach = 68;

    for (const obj of this.envObjects) {
      if (!obj.canBePickedUp) continue;
      const dx = obj.x - hero.x;
      const dy = (obj.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const distSq = dx * dx + dy * dy;
      const maxReach = grabReach + obj.radius;
      if (distSq <= maxReach * maxReach && distSq < bestDistSq) {
        bestDistSq = distSq;
        best = obj;
      }
    }
    return best;
  }

  private updatePickupPrompts(): void {
    const highlighted = new Set<EnvironmentalObject>();
    for (const h of this.heroes) {
      if (!h.isHumanControlled || h.isCarrying || h.isDefeated) continue;
      const near = this.findNearestPickupableFor(h);
      if (near) highlighted.add(near);
    }
    for (const obj of this.envObjects) {
      obj.setPickupPromptVisible(highlighted.has(obj));
    }
  }

  private spawnShockwave(x: number, y: number, colorHex: number, width: number): void {
    const scale = getPerspectiveScale(y);
    const g = this.add.graphics().setPosition(x, y - 20 * scale).setDepth(getDepthOrder(y) + 30);
    g.lineStyle(5 * scale, colorHex, 0.9);
    g.strokeEllipse(0, 0, width * scale, width * 0.65 * scale);
    this.tweens.add({
      targets: g,
      scale: 1.55,
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

  private spawnInitialEnvironment(): void {
    this.spawnObject('table', 490, 488);
    this.spawnObject('table', 790, 494);
    this.spawnObject('table', 640, 344);
    this.spawnObject('barrel_water', 436, 378);
    this.spawnObject('barrel_water', 848, 384);
    this.spawnObject('barrel_empty', 340, 566);
    this.spawnObject('ceramic_jar', 575, 294);
    this.spawnObject('ceramic_jar', 705, 294);
    this.spawnObject('ceramic_jar', 288, 456);
    this.spawnObject('ceramic_jar', 988, 462);
    this.spawnObject('fruit_basket', 385, 616);
    this.spawnObject('fruit_basket', 918, 608);
    this.spawnHazard('water_puddle', 640, 412);
  }

  private spawnObject(kind: EnvObjectKind, x: number, y: number): EnvironmentalObject {
    const id = `env_${kind}_${this.nextObjectSeq++}`;
    const obj = new EnvironmentalObject(this, id, kind, x, y, this.mayhemTuning, {
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
    });
    this.envObjects.push(obj);
    return obj;
  }

  private spawnObjectNearPrimaryHero(kind: EnvObjectKind): void {
    const h = this.getPrimaryHumanHero() ?? this.heroes[0];
    if (!h) return;
    this.spawnObject(
      kind,
      h.x + Math.cos(h.facingAngle) * 72,
      h.y + Math.sin(h.facingAngle) * 52,
    );
  }

  private handleObjectBroken(obj: EnvironmentalObject, dirX: number, dirY: number): void {
    this.stageDirector.recordObjectDestroyed(obj.spec.kind === 'table');
    for (const bandit of this.bandits) {
      if (bandit.coverObject === obj) bandit.onCoverDestroyed(this.coordinator);
    }
    this.broadcastFearWave(obj.x, obj.y, 220, 16);

    if (obj.spec.kind === 'table') {
      this.audio.playTableShatter();
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y, dirX, dirY);
      this.vfx.spawnFlyingBowls(obj.x, obj.y, dirX, dirY);
      this.screenShake.trigger(6.0, 120, dirX, dirY);
    } else if (obj.spec.rollable) {
      this.audio.playBarrelBreak(obj.spec.containsWater);
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      if (obj.spec.containsWater) {
        this.debris.spawn('WATER_SPLASH', obj.x, obj.y);
        this.spawnHazard('water_puddle', obj.x, obj.y);
      } else {
        this.debris.spawn('DUST_CLOUD', obj.x, obj.y);
      }
      this.screenShake.trigger(4.8, 100, dirX, dirY);
    } else if (obj.spec.material === 'ceramic') {
      this.audio.playCeramicBreak();
      this.debris.spawn('CERAMIC_SHARDS', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y);
      this.screenShake.trigger(2.8, 70, dirX, dirY);
    } else if (obj.spec.spillsFood) {
      this.audio.playTableImpact();
      this.debris.spawn('FRUIT_SCATTER', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      this.spawnHazard('spilled_food', obj.x, obj.y);
      this.spawnHazard('banana_peel', obj.x + (dirX || 1) * 34, obj.y + (dirY || 0.2) * 20);
      this.screenShake.trigger(3.0, 75, dirX, dirY);
    }
  }

  private spawnHazard(kind: HazardKind, rawX: number, rawY: number): SurfaceHazard {
    const clamped = clampToArena(rawX, rawY, 32);
    const hz = new SurfaceHazard(
      this,
      `hazard_${kind}_${this.nextHazardSeq++}`,
      kind,
      clamped.x,
      clamped.y,
      this.mayhemTuning.puddleDurationMs,
    );
    this.hazards.push(hz);
    return hz;
  }

  private spawnBalancedBanditSquad(count: number, hpMul: number): void {
    const roster: Array<{ arch: BanditArchetype; x: number; y: number }> = [
      { arch: 'coward', x: 470, y: 312 },
      { arch: 'clumsy', x: 560, y: 396 },
      { arch: 'overconfident', x: 390, y: 468 },
      { arch: 'stubborn', x: 892, y: 476 },
      { arch: 'coward', x: 810, y: 318 },
      { arch: 'sneaky', x: 486, y: 548 },
      { arch: 'elite', x: 720, y: 334 },
      { arch: 'clumsy', x: 724, y: 404 },
      { arch: 'overconfident', x: 355, y: 598 },
      { arch: 'sneaky', x: 792, y: 554 },
      { arch: 'stubborn', x: 930, y: 596 },
      { arch: 'stubborn', x: 565, y: 626 },
      { arch: 'coward', x: 410, y: 330 },
      { arch: 'clumsy', x: 860, y: 345 },
      { arch: 'elite', x: 640, y: 295 },
    ];

    const prevEnemyHp = this.tuning.enemyMaxHp;
    this.tuning.enemyMaxHp = Math.round(100 * hpMul);
    for (let i = 0; i < count; i++) {
      if (i < roster.length) {
        this.spawnBanditAt(roster[i].x, roster[i].y, i, roster[i].arch);
      } else {
        this.spawnSingleBandit();
      }
    }
    this.tuning.enemyMaxHp = prevEnemyHp;
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
          const victim = this.findNearestAliveHero(bandit.x, bandit.y);
          victim?.takeDamage(damage, dirX, dirY);
        },
        onLanded: (b, impactSpeed) => {
          const strong = impactSpeed > 150;
          this.audio.playKnockdownLanding();
          this.vfx.spawnLandingImpact(b.x, b.y, strong);
          if (strong) this.screenShake.trigger(3.0, 70, 0, 1);
        },
        onDefeated: (b) => {
          this.enemiesDefeated += 1;
          this.stageDirector.recordEnemyDefeated(b.archetype === 'elite', false);
          this.audio.playEnemyDefeat();
          this.broadcastFearWave(b.x, b.y, 260, 18);
          if (b.archetype === 'elite') {
            this.spawnTreasureDrop(b.x, b.y, '정예 보물 상자!');
            this.stageOverlay.showScoreToast('🏆 정예 산적 제압! 보물 드롭!');
          }
        },
        onPanic: () => this.audio.playBanditPanicSqueal(),
        onTrip: (b) => {
          this.audio.playStumble();
          this.debris.spawn('DUST_CLOUD', b.x, b.y);
        },
        onHide: () => this.audio.playHideRustle(),
        onPeek: () => this.audio.playPeekChirp(),
        onSurrender: () => {
          this.stageDirector.recordEnemySurrendered();
          this.audio.playSurrenderVoice();
        },
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

  // ==================== HELPERS & DEBUG TOOLS ====================

  private getPrimaryHumanHero(): Warrior | undefined {
    return this.heroes.find((h) => h.isHumanControlled && !h.isDefeated) ?? this.heroes[0];
  }

  private findNearestAliveHero(x: number, y: number): Warrior | null {
    let best: Warrior | null = null;
    let bestDistSq = Infinity;
    for (const h of this.heroes) {
      if (h.isDefeated) continue;
      const dx = h.x - x;
      const dy = (h.y - y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = h;
      }
    }
    return best;
  }

  private debugTriggerHeroSpecial(heroId?: HeroId): void {
    const hero = heroId
      ? this.heroes.find((h) => h.heroId === heroId)
      : this.getPrimaryHumanHero();
    if (!hero) {
      this.partyOverlay.showToast(`${heroId ?? ''} 영웅이 현재 파티에 없습니다 (P로 추가)`);
      return;
    }
    hero.triggerSpecial(
      {
        x: Math.cos(hero.facingAngle),
        y: Math.sin(hero.facingAngle),
        isMoving: false,
        lightAttackPressed: false,
        heavyAttackPressed: false,
        specialPressed: true,
        interactPressed: false,
      },
      true,
    );
  }

  private debugSimulateFourPlayerBurst(): void {
    this.party.setPreset('LOCAL_4P');
    this.stageOverlay.hideAllModals();
    this.startStage1Run(false);
    // Inject simultaneous independent inputs for all 4 human players!
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
    ];
    this.party.humanSlots.forEach((slot, idx) => {
      if (!slot.deviceId) return;
      this.multiInput.setSimulatedInput(slot.deviceId, {
        x: dirs[idx][0],
        y: dirs[idx][1],
        isMoving: true,
        lightAttackPressed: false,
        heavyAttackPressed: false,
        specialPressed: true,
        interactPressed: false,
      });
    });
    this.partyOverlay.showToast('🎮 4인 동시 필살기 입력 시뮬레이션 실행!');
  }

  /**
   * Step 7 Reusable Quality Test Scenarios (TEST A through TEST H) triggered from F2 lab.
   */
  private runQualityTestScene(id: QualityTestSceneId): void {
    this.stageOverlay.hideAllModals();
    this.perfMonitor.reset();

    switch (id) {
      case 'A': {
        // TEST A — SINGLE HIT: 1 Zhao Yun vs 1 Bandit
        this.party.setPreset('SOLO');
        this.resetWorldEntitiesOnly();
        this.stageDirector.resetForNewRun(1, 0, 1001);
        this.stageDirector.state = 'WAVE_ACTIVE';
        this.spawnActivePartyHeroes();
        this.spawnBanditAt(690, 515, 0, 'stubborn');
        this.partyOverlay.showToast('🧪 TEST A: 조운 vs 산적 1명 (단타/강공격 비교)');
        break;
      }
      case 'B': {
        // TEST B — GROUP KNOCKBACK: Zhang Fei charges into 6 Bandits
        this.party.setSlot(0, 'HUMAN', 'zhangfei', 'keyboard');
        this.party.setSlot(1, 'EMPTY', null);
        this.party.setSlot(2, 'EMPTY', null);
        this.party.setSlot(3, 'EMPTY', null);
        this.resetWorldEntitiesOnly();
        this.stageDirector.resetForNewRun(1, 0, 1002);
        this.stageDirector.state = 'WAVE_ACTIVE';
        this.spawnActivePartyHeroes();
        const zf = this.heroes[0];
        if (zf) zf.reset(380, 500);
        for (let i = 0; i < 6; i++) {
          this.spawnBanditAt(540 + i * 54, 492 + (i % 2) * 18, i, i % 2 === 0 ? 'clumsy' : 'coward');
        }
        this.partyOverlay.showToast('🧪 TEST B: 장비 돌진 vs 산적 6명 (V 키로 연쇄 충돌 테스트!)');
        break;
      }
      case 'C': {
        // TEST C — TABLE DESTRUCTION: Table + 3 Bandits + Ceramic Jars
        this.party.setPreset('SOLO');
        this.resetWorldEntitiesOnly();
        this.stageDirector.resetForNewRun(1, 0, 1003);
        this.stageDirector.state = 'WAVE_ACTIVE';
        this.spawnActivePartyHeroes();
        this.spawnObject('table', 635, 515);
        this.spawnObject('ceramic_jar', 760, 500);
        this.spawnObject('ceramic_jar', 785, 530);
        this.spawnBanditAt(730, 505, 0, 'coward');
        this.spawnBanditAt(765, 520, 1, 'clumsy');
        this.spawnBanditAt(800, 510, 2, 'overconfident');
        this.partyOverlay.showToast('🧪 TEST C: 테이블 투척 + 항아리 파괴 (SPACE로 집어 던지세요!)');
        break;
      }
      case 'D': {
        // TEST D — CAMERA GAG
        this.cameraGag.forcePreview();
        this.audio.duckMusic(900);
        this.screenShake.triggerImpactFlash(0xfef08a, 0.14, 55);
        this.partyOverlay.showToast('🧪 TEST D: 카메라 유리창 충돌 개그 프리뷰');
        break;
      }
      case 'E': {
        // TEST E — COWARDLY BANDIT: panic, fleeing, tripping, hiding, peeking
        this.party.setPreset('SOLO');
        this.resetWorldEntitiesOnly();
        this.stageDirector.resetForNewRun(1, 0, 1005);
        this.stageDirector.state = 'WAVE_ACTIVE';
        this.spawnActivePartyHeroes();
        this.spawnObject('barrel_water', 740, 440);
        this.spawnObject('table', 460, 460);
        for (let i = 0; i < 4; i++) {
          this.spawnBanditAt(540 + i * 70, 460, i, 'coward');
        }
        for (const b of this.bandits) b.forcePanic(this.coordinator);
        this.partyOverlay.showToast('🧪 TEST E: 겁쟁이 산적 도주·넘어짐·숨기·빼꼼 테스트');
        break;
      }
      case 'F': {
        // TEST F — FOUR-HERO CHAOS
        this.party.setPreset('FULL_AI');
        this.startStage1Run(false);
        const res = this.stageDirector.jumpToWave(2);
        this.handleStageStepResult(res);
        this.partyOverlay.showToast('🧪 TEST F: 4인 영웅 + 다수 산적 난전 부하 테스트');
        break;
      }
      case 'G': {
        // TEST G — BOSS BATTLE
        this.party.setPreset('FULL_AI');
        this.resetWorldEntitiesOnly();
        this.stageDirector.resetForNewRun(1, 3, 1007);
        this.stageDirector.waveIndex = 4;
        this.stageDirector.state = 'BOSS_ACTIVE';
        this.spawnActivePartyHeroes();
        this.spawnBossChief();
        this.audio.setMusicIntensity('BOSS');
        this.partyOverlay.showToast('🧪 TEST G: 산적 두목 보스전 즉시 시작');
        break;
      }
      case 'H': {
        // TEST H — RESTART STABILITY (5 rapid consecutive resets)
        for (let i = 0; i < 5; i++) {
          this.startStage1Run(false);
        }
        this.partyOverlay.showToast('🧪 TEST H: 5회 연속 즉시 재시작 완료 (누수/중복 리스너 없음)');
        break;
      }
    }
  }

  private clearAllHeroes(): void {
    for (const h of this.heroes) h.destroy();
    this.heroes.length = 0;
  }

  private clearAllProjectiles(): void {
    for (const p of this.projectiles) p.destroy();
    this.projectiles.length = 0;
  }

  private clearAllBandits(): void {
    for (const b of this.bandits) {
      this.coordinator.releaseAttackToken(b.id);
      b.destroy();
    }
    this.bandits.length = 0;
  }

  private clearBoss(): void {
    if (this.boss) {
      this.boss.destroy();
      this.boss = null;
    }
  }

  private clearTreasurePickups(): void {
    for (const t of this.treasurePickups) t.destroy();
    this.treasurePickups.length = 0;
  }

  private clearAllObjects(): void {
    for (const h of this.heroes) h.carriedObject = null;
    for (const o of this.envObjects) o.destroy();
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
    this.startStage1Run(false);
    this.eventsBus.emit('combat:restart', {});
  }

  private applyLiveTuning(): void {
    this.audio.syncVolume();
    for (const b of this.bandits) b.syncMaxHpFromTuning();
  }

  private renderDebugVisuals(): void {
    this.debugVisGfx.clear();

    if (this.step5Tuning.showProjectiles) {
      for (const p of this.projectiles) {
        const s = getPerspectiveScale(p.y);
        this.debugVisGfx.lineStyle(2, 0xfacc15, 0.95);
        this.debugVisGfx.strokeEllipse(
          p.x,
          p.y,
          p.radius * 2 * s,
          p.radius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * s,
        );
      }
    }

    if (this.step5Tuning.showAiGoals) {
      for (const h of this.heroes) {
        if (h.isHumanControlled) continue;
        const mem = this.aiHeroCtrl.getMemory(h.heroId);
        if (!mem) continue;
        this.debugVisGfx.lineStyle(1.5, h.profile.accentHex, 0.75);
        this.debugVisGfx.lineBetween(h.x, h.y, mem.goalX, mem.goalY);
        this.debugVisGfx.strokeCircle(mem.goalX, mem.goalY, 8);
      }
    }

    if (this.mayhemTuning.showActorShapes || this.tuning.showGroundPositions) {
      for (const h of this.heroes) {
        const s = getPerspectiveScale(h.y);
        this.debugVisGfx.lineStyle(2, h.profile.accentHex, 0.9);
        this.debugVisGfx.strokeEllipse(
          h.x,
          h.y,
          h.collisionRadius * 2 * s,
          h.collisionRadius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * s,
        );
      }
    }

    if (this.mayhemTuning.showObjectShapes) {
      for (const obj of this.envObjects) {
        const s = getPerspectiveScale(obj.y);
        this.debugVisGfx.lineStyle(2, 0xfbbf24, 0.85);
        this.debugVisGfx.strokeEllipse(
          obj.x,
          obj.y,
          obj.radius * 2 * s,
          obj.radius * 2 * PERSPECTIVE_CONFIG.verticalMoveRatio * s,
        );
      }
    }

    if (this.tuning.showHitboxes) {
      for (const h of this.heroes) {
        const hb = h.getActiveHitbox();
        if (!hb) continue;
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

        this.debugVisGfx.fillStyle(h.profile.accentHex, 0.22);
        this.debugVisGfx.lineStyle(2, h.profile.accentHex, 0.95);
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
    this.clearAllHeroes();
    this.clearAllProjectiles();
    this.clearAllBandits();
    this.clearBoss();
    this.clearTreasurePickups();
    this.clearAllObjects();
    this.clearAllHazards();
    this.arena?.destroy();
    this.debugVisGfx?.destroy();
    this.systems?.destroy();
    this.eventsBus?.clear();
  }
}
