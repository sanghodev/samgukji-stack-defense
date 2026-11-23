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
import { check25DMeleeHit } from '../core/CombatMath';
import { EventBus } from '../core/EventBus';
import { sweptCircleHit25D } from '../core/MayhemPhysics';
import { PartyManager } from '../core/PartyManager';
import {
  clampToArena,
  getDepthOrder,
  getHorizontalBoundsAtY,
  getPerspectiveScale,
} from '../core/Perspective';
import { Bandit } from '../entities/Bandit';
import { EnvironmentalObject } from '../entities/EnvironmentalObject';
import { Projectile } from '../entities/Projectile';
import { SurfaceHazard } from '../entities/SurfaceHazard';
import { ArrowFireRequest, Warrior } from '../entities/Warrior';
import { AIHeroController } from '../systems/AIHeroController';
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
import { HeroActionInput, MultiInputManager } from '../systems/MultiInputManager';
import { PartySetupOverlay } from '../systems/PartySetupOverlay';
import { ScreenShakeSystem } from '../systems/ScreenShakeSystem';
import { MarketplaceArena } from '../world/MarketplaceArena';

const HERO_SPAWN_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 580, y: 515 },
  { x: 700, y: 515 },
  { x: 520, y: 565 },
  { x: 760, y: 565 },
];

/**
 * Main fixed-camera 2.5D arena scene for Three Kingdoms Mayhem (삼국지 난장판).
 * Step 5: Four differentiated heroes (Zhao Yun, Guan Yu, Zhang Fei, Huang Zhong),
 * flexible 1-4 hero party setup (Solo to 4P), role-based AI cooperation,
 * 2.5D arrow projectiles, and local multiplayer with join-in-progress.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private tuning!: CombatTuning;
  private mayhemTuning!: MayhemTuning;
  private step4Tuning!: Step4Tuning;
  private step5Tuning!: Step5Tuning;
  private party!: PartyManager;

  private systems!: SystemRegistry;
  private inputSystem!: InputSystem;
  private multiInput!: MultiInputManager;
  private aiHeroCtrl!: AIHeroController;
  private partyOverlay!: PartySetupOverlay;
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

  private nextBanditSeq = 1;
  private nextObjectSeq = 1;
  private nextHazardSeq = 1;
  private nextProjectileSeq = 1;

  private enemiesDefeated = 0;
  private comboHits = 0;
  private comboDecayMs = 0;
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
    this.party = new PartyManager();
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
    this.hitStop = this.systems.register(new HitStopSystem(this.tuning));
    this.screenShake = this.systems.register(new ScreenShakeSystem(this.tuning));
    this.audio = this.systems.register(new CombatAudioManager(this.tuning, this.mayhemTuning));
    this.vfx = this.systems.register(new ImpactVfxSystem());
    this.debris = this.systems.register(new DebrisEffectManager(this.mayhemTuning));
    this.coordinator = this.systems.register(new CombatCoordinator());
    this.cameraGag = this.systems.register(
      new CameraGagController(this.step4Tuning, this.audio, this.screenShake),
    );
    this.partyOverlay = this.systems.register(
      new PartySetupOverlay(this.party, {
        onApplyParty: () => this.rebuildPartyAndEncounter(),
      }),
    );
    this.combatHud = this.systems.register(
      new CombatHud(
        () => this.resetTestRoom(),
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
          onResetRoom: () => this.resetTestRoom(),
          onTuningChanged: () => this.applyLiveTuning(),
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

    // Spawn active party heroes (1-4), environment, and balanced bandit squad
    this.rebuildPartyAndEncounter();

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

    if (kbInput.partySetupPressed) {
      this.partyOverlay.toggle();
      return;
    }

    // Pause combat simulation cleanly while Party Setup modal is open
    if (this.partyOverlay.isOpen) return;

    if (kbInput.restartPressed) {
      this.resetTestRoom();
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

    // Always update screen shake, camera gag, VFX, debris, and arena ambience
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
      this.updateProjectiles(delta);

      // Update environmental objects
      for (let i = this.envObjects.length - 1; i >= 0; i--) {
        const obj = this.envObjects[i];
        obj.update(delta, (x, y, r) => this.arena.resolvePropCollisions(x, y, r));
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

    // Update dynamic 1-to-4 Hero HUD
    const activeEnemies = this.bandits.filter((b) => !b.isNeutralized).length;
    const surrenderedCount = this.bandits.filter((b) => b.state === 'SURRENDERED').length;
    const allHumansDefeated =
      this.heroes.filter((h) => h.isHumanControlled).every((h) => h.isDefeated);

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
        })),
        allHumansDefeated,
        enemiesActive: activeEnemies,
        enemiesNeutralized: this.enemiesDefeated + surrenderedCount,
        enemiesSurrendered: surrenderedCount,
        comboHits: this.comboHits,
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

  private rebuildPartyAndEncounter(): void {
    this.clearAllHeroes();
    this.clearAllProjectiles();
    this.clearAllBandits();
    this.resetEnvironmentObjects();
    this.cameraGag.reset();
    this.hitStop.reset();
    this.screenShake.reset();
    this.coordinator.reset();
    this.aiHeroCtrl.clear();

    this.enemiesDefeated = 0;
    this.comboHits = 0;
    this.comboDecayMs = 0;

    // Spawn ONLY configured active slots (EMPTY slots remain strictly empty!)
    for (const slot of this.party.activeSlots) {
      if (!slot.heroId) continue;
      const pos = HERO_SPAWN_OFFSETS[slot.slotIndex % HERO_SPAWN_OFFSETS.length];
      this.spawnHero(slot.heroId, slot.slotIndex, slot.control, pos.x, pos.y);
    }

    // Balance bandit count & HP to active party size (1..4)
    const balance = getPartyBalanceProfile(this.heroes.length);
    this.tuning.enemyCount = balance.enemyCount;
    this.spawnBalancedBanditSquad(balance.enemyCount, balance.enemyHpMultiplier);
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
        onFootstep: (_h, heavy) =>
          heavy ? this.audio.playHeavyFootstep() : this.audio.playFootstep(),
        onAttackActiveStart: (h, attackType, ax, ay, dirX, dirY, range) => {
          if (h.heroId === 'guanyu') {
            this.audio.playGuandaoSweep();
          } else if (attackType === 'HEAVY' || attackType === 'LIGHT_3') {
            this.audio.playStrongWhoosh();
          } else {
            this.audio.playLightWhoosh();
          }
          this.vfx.spawnSpearTrail(ax, ay, dirX, dirY, attackType, range);
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
          this.broadcastFearWave(h.x, h.y, 320, 26);
        },
        onZhangFeiChargeSkid: (h) => {
          this.audio.playChargeSkid();
          this.debris.spawn('LANDING_DUST', h.x, h.y);
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
  }

  private handleDeviceDisconnected(deviceId: string): void {
    const res = this.party.releaseHumanDevice(deviceId);
    if (!res.success || !res.heroId || res.slotIndex === undefined) return;
    const existing = this.heroes.find((h) => h.heroId === res.heroId);
    existing?.setOwnership(res.slotIndex, 'AI');
    const heroName = HERO_DATA[res.heroId].displayName;
    this.partyOverlay.showToast(`🔌 ${deviceId} 연결 해제 → ${heroName} AI 동료로 안전 전환`);
  }

  private handleTabCycleHero(): void {
    const res = this.party.cycleHumanHero('keyboard');
    if (!res.success || !res.heroId) return;
    // Sync all hero badges
    for (const h of this.heroes) {
      const slot = this.party.getSlotByHero(h.heroId);
      if (slot) h.setOwnership(slot.slotIndex, slot.control);
    }
    this.partyOverlay.showToast(`⚔ P1 영웅 교대 → ${HERO_DATA[res.heroId].displayName}`);
  }

  // ==================== 4 HERO SPECIAL ABILITIES & PROJECTILES ====================

  private executeZhaoYunWhiteDragonStrike(
    hero: Warrior,
    _idx: number,
    isFinal: boolean,
  ): void {
    const dirX = Math.cos(hero.facingAngle);
    const dirY = Math.sin(hero.facingAngle);
    this.audio.playWhiteDragonStrike();
    this.vfx.spawnSpearTrail(
      hero.x,
      hero.y,
      dirX,
      dirY,
      isFinal ? 'LIGHT_3' : 'LIGHT_1',
      115,
    );

    const query = {
      originX: hero.x,
      originY: hero.y,
      dirX,
      dirY,
      range: 115 + this.step5Tuning.treasureMods.extraReach,
      halfWidth: 44,
      verticalRatio: PERSPECTIVE_CONFIG.verticalMoveRatio,
      backGrace: 18,
    };

    let hits = 0;
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      if (!check25DMeleeHit(query, bandit.getHurtbox()).hit) continue;

      const dmg = Math.round(
        (isFinal ? 26 : 14) *
          this.tuning.playerDamageMultiplier *
          this.step5Tuning.heroDamageMultiplier,
      );
      if (
        bandit.takeHit(
          {
            damage: dmg,
            dirX,
            dirY,
            knockbackForce: isFinal ? 420 : 120,
            launchVz: isFinal ? 250 : 0,
            isHeavy: isFinal,
          },
          this.coordinator,
        )
      ) {
        hits += 1;
        this.comboHits += 1;
        this.comboDecayMs = 2200;
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

    if (hits > 0 && isFinal) {
      this.audio.playComboFinisherImpact();
      this.hitStop.trigger(45);
      this.screenShake.trigger(5.5, 110, dirX, dirY);
      this.broadcastFearWave(hero.x, hero.y, 260, 20);
    }
  }

  private executeGuanYuCyclonePulse(hero: Warrior, isFinal: boolean): void {
    const radius = 148 * this.step5Tuning.treasureMods.cycloneRadiusMul;
    this.audio.playCycloneSpin();
    this.spawnShockwave(hero.x, hero.y, 0x22c55e, radius * 1.45);
    this.debris.spawn('DUST_CLOUD', hero.x, hero.y);

    let hits = 0;
    for (const bandit of this.bandits) {
      if (!bandit.isVulnerable) continue;
      const dx = bandit.x - hero.x;
      const dy = (bandit.y - hero.y) / PERSPECTIVE_CONFIG.verticalMoveRatio;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + bandit.collisionRadius) continue;

      const nx = dist > 0.1 ? dx / dist : 1;
      const ny = dist > 0.1 ? dy / dist : 0;
      const dmg = Math.round(
        (isFinal ? 28 : 16) *
          this.tuning.playerDamageMultiplier *
          this.step5Tuning.heroDamageMultiplier,
      );

      if (
        bandit.takeHit(
          {
            damage: dmg,
            dirX: nx,
            dirY: ny,
            knockbackForce: isFinal ? 460 : 185,
            launchVz: isFinal ? 275 : 0,
            isHeavy: isFinal,
          },
          this.coordinator,
        )
      ) {
        hits += 1;
        this.comboHits += 1;
        this.comboDecayMs = 2200;
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
    const count = 5 + Math.max(0, this.step5Tuning.treasureMods.extraSpreadArrows);
    const totalSpread = 0.72;

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
      knockbackForce: req.penetrating ? 330 : 155,
      launchVz: req.penetrating ? 175 : 0,
      penetrating: req.penetrating,
      maxRange: 560,
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
          this.step5Tuning.heroDamageMultiplier,
      );

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

      const loss =
        this.step4Tuning.chargeEnergyLossPerHit * (bandit.archetype === 'elite' ? 2.0 : 1.0);
      hero.consumeChargeEnergy(loss);
      this.broadcastFearWave(bandit.x, bandit.y, 260, 22);
      if (!hero.isChargeActive) break;
    }

    if (hitEnemy) {
      this.audio.playShoulderCollision();
      this.audio.playEnemyHurt(true);
      this.hitStop.trigger(44);
      this.screenShake.trigger(6.5, 125, hero.chargeDirX, hero.chargeDirY);
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
        this.step4Tuning.chargeKnockback * 1.15,
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
            this.step5Tuning.heroDamageMultiplier,
        ),
      );

      const applied = bandit.takeHit(
        {
          damage,
          dirX: query.dirX,
          dirY: query.dirY,
          knockbackForce: spec.knockbackForce * prof.knockbackMultiplier,
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
        if (thrown.spec.kind === 'table') this.audio.playHeavyTableThrow();
        else this.audio.playStrongWhoosh();
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
    for (const bandit of this.bandits) {
      if (bandit.coverObject === obj) bandit.onCoverDestroyed(this.coordinator);
    }
    this.broadcastFearWave(obj.x, obj.y, 220, 16);

    if (obj.spec.kind === 'table') {
      this.audio.playTableShatter();
      this.debris.spawn('WOOD_SPLINTERS', obj.x, obj.y, dirX, dirY);
      this.debris.spawn('DUST_CLOUD', obj.x, obj.y, dirX, dirY);
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
          this.audio.playEnemyDefeat();
          this.broadcastFearWave(b.x, b.y, 260, 18);
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
    this.rebuildPartyAndEncounter();
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
    this.rebuildPartyAndEncounter();
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
    this.clearAllObjects();
    this.clearAllHazards();
    this.arena?.destroy();
    this.debugVisGfx?.destroy();
    this.systems?.destroy();
    this.eventsBus?.clear();
  }
}
