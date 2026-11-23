import assert from 'node:assert/strict';
import test from 'node:test';
import {
  check25DMeleeHit,
  CombatHitTracker,
  stepAirbornePhysics,
} from '../src/core/CombatMath.ts';
import { createDefaultCombatTuning } from '../src/config/combatConfig.ts';
import { CombatCoordinator } from '../src/systems/CombatCoordinator.ts';
import { HitStopSystem } from '../src/systems/HitStopSystem.ts';

test('2.5D melee hit detection works across all 8 directions', () => {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1],
    [-Math.SQRT1_2, Math.SQRT1_2],
    [-1, 0],
    [-Math.SQRT1_2, -Math.SQRT1_2],
    [0, -1],
    [Math.SQRT1_2, -Math.SQRT1_2],
  ];

  const verticalRatio = 0.68;
  for (const [dx, dy] of dirs) {
    // Target placed 60 ground-space units directly in front of the attack
    const targetX = 640 + dx * 60;
    const targetY = 500 + dy * 60 * verticalRatio;

    const hitRes = check25DMeleeHit(
      {
        originX: 640,
        originY: 500,
        dirX: dx,
        dirY: dy,
        range: 92,
        halfWidth: 36,
        verticalRatio,
      },
      {
        id: 'b1',
        x: targetX,
        y: targetY,
        radius: 19,
        elevationZ: 0,
        vulnerable: true,
      },
    );
    assert.equal(hitRes.hit, true, `Expected hit for direction (${dx}, ${dy})`);

    // Target behind the attacker should NOT be hit
    const behindRes = check25DMeleeHit(
      {
        originX: 640,
        originY: 500,
        dirX: dx,
        dirY: dy,
        range: 92,
        halfWidth: 36,
        verticalRatio,
      },
      {
        id: 'b2',
        x: 640 - dx * 70,
        y: 500 - dy * 70 * verticalRatio,
        radius: 19,
        elevationZ: 0,
        vulnerable: true,
      },
    );
    assert.equal(behindRes.hit, false, `Should not hit behind for (${dx}, ${dy})`);
  }
});

test('2.5D depth-lane isolation prevents hitting enemies far on another depth lane', () => {
  const verticalRatio = 0.68;
  // Attacking right (+X), enemy is at same X+50 but 90px higher in depth Y
  const res = check25DMeleeHit(
    {
      originX: 640,
      originY: 500,
      dirX: 1,
      dirY: 0,
      range: 92,
      halfWidth: 36,
      verticalRatio,
    },
    {
      id: 'far_lane',
      x: 690,
      y: 410,
      radius: 19,
      elevationZ: 0,
      vulnerable: true,
    },
  );
  assert.equal(res.hit, false);
});

test('CombatHitTracker prevents duplicate hits per attack swing and resets on new swing', () => {
  const tracker = new CombatHitTracker();
  tracker.beginAttack();
  assert.equal(tracker.canHit('bandit_1'), true);
  assert.equal(tracker.recordHit('bandit_1'), true);
  assert.equal(tracker.canHit('bandit_1'), false);
  assert.equal(tracker.recordHit('bandit_1'), false);

  tracker.beginAttack();
  assert.equal(tracker.canHit('bandit_1'), true);
});

test('Airborne knockback physics launches, arcs under gravity, and triggers landing', () => {
  const body = {
    x: 640,
    y: 500,
    vx: 420,
    vy: 0,
    elevationZ: 4,
    vz: 320,
  };

  let peakZ = 0;
  let landedCount = 0;
  let landingImpact = 0;

  for (let i = 0; i < 80; i++) {
    const res = stepAirbornePhysics(body, 0.016, 1120, 7.5, 1.15);
    if (body.elevationZ > peakZ) peakZ = body.elevationZ;
    if (res.landed) {
      landedCount += 1;
      landingImpact = res.impactSpeed;
    }
  }

  assert.ok(peakZ > 35, `Expected noticeable launch arc, got peakZ=${peakZ}`);
  assert.equal(landedCount, 1, 'Expected exactly one landing event');
  assert.ok(landingImpact > 200, 'Expected measurable landing impact speed');
  assert.equal(body.elevationZ, 0);
  assert.ok(body.x > 750, 'Expected strong horizontal knockback displacement');
});

test('HitStopSystem scales with tuning and releases cleanly', () => {
  const tuning = createDefaultCombatTuning();
  tuning.hitStopScale = 1.0;
  const hs = new HitStopSystem(tuning);

  hs.trigger(55);
  assert.equal(hs.isActive, true);
  assert.equal(hs.step(30), true);
  assert.equal(hs.step(30), true); // finishes on this step
  assert.equal(hs.step(16), false);
  assert.equal(hs.isActive, false);
});

test('CombatCoordinator staggers concurrent enemy attacks', () => {
  const coord = new CombatCoordinator();
  assert.equal(coord.requestAttackToken('bandit_1'), true);
  assert.equal(coord.requestAttackToken('bandit_2'), false);
  coord.releaseAttackToken('bandit_1');
  // Still staggered until cooldown elapses
  assert.equal(coord.requestAttackToken('bandit_2'), false);
  for (let i = 0; i < 15; i++) {
    coord.update(i * 50, 50);
  }
  assert.equal(coord.requestAttackToken('bandit_2'), true);
});

// ==================== STEP 3 MAYHEM PHYSICS TESTS ====================
import {
  computeChainImpulse,
  evaluateSlipTrigger,
  sweptCircleHit25D,
} from '../src/core/MayhemPhysics.ts';

test('Swept 2.5D collision prevents fast thrown table from tunneling through a bandit', () => {
  // Table moves 180px in a single fast step from x=400 to x=580, passing right over bandit at x=490
  const hit = sweptCircleHit25D(400, 500, 580, 500, 26, 490, 500, 19, 0.68);
  assert.equal(hit.hit, true);
  assert.ok(hit.t > 0.3 && hit.t < 0.7);
});

test('Swept 2.5D collision respects depth lanes (no hit on unrelated Y depth)', () => {
  // Table flies along y=500, bandit stands at y=390 (far behind on another depth lane)
  const hit = sweptCircleHit25D(400, 500, 580, 500, 26, 490, 390, 19, 0.68);
  assert.equal(hit.hit, false);
});

test('Domino chain impulse propagates Bandit A -> B -> C and stops cleanly at maxChainDepth', () => {
  const step1 = computeChainImpulse(460, 0, 1.0, 1.0, 1, 0, 0.82, 0, 3, 130, 0.68);
  assert.equal(step1.triggered, true);
  assert.equal(step1.tier, 'LAUNCHED');
  assert.equal(step1.nextChainDepth, 1);
  assert.ok(step1.targetVx > 330);
  assert.ok(step1.sourceVx < 460);

  // Bandit B now hits Bandit C
  const step2 = computeChainImpulse(step1.targetVx, step1.targetVy, 1.0, 1.0, 1, 0, 0.82, step1.nextChainDepth, 3, 130, 0.68);
  assert.equal(step2.triggered, true);
  assert.equal(step2.nextChainDepth, 2);
  assert.ok(step2.tier === 'KNOCKDOWN' || step2.tier === 'LAUNCHED');

  // At maxChainDepth, propagation MUST terminate to prevent infinite loops
  const blocked = computeChainImpulse(500, 0, 1.0, 1.0, 1, 0, 0.82, 3, 3, 130, 0.68);
  assert.equal(blocked.triggered, false);
  assert.equal(blocked.tier, 'NONE');
});

test('Surface hazard slipping requires running speed and is bounded', () => {
  // Standing or slow walk should NEVER slip
  assert.equal(evaluateSlipTrigger(0, 0.8, 0.016, 0.0), false);
  assert.equal(evaluateSlipTrigger(45, 0.8, 0.016, 0.0), false);
  // Running fast across a puddle triggers slip deterministically on low roll
  assert.equal(evaluateSlipTrigger(140, 0.8, 0.016, 0.01), true);
  // High roll does not slip
  assert.equal(evaluateSlipTrigger(140, 0.8, 0.016, 0.99), false);
});

// ==================== STEP 4 FEAR, TRIP & CAMERA GAG TESTS ====================
import {
  classifyFearState,
  computeFearGain,
  evaluateCameraGagEligibility,
  evaluateRunningTrip,
} from '../src/core/FearAndGagMath.ts';

test('Fear state classification applies hysteresis to prevent rapid flickering', () => {
  // Panic threshold = 50 -> crossing 52 enters PANICKING
  const s1 = classifyFearState(52, 'FRIGHTENED', 50);
  assert.equal(s1, 'PANICKING');

  // Slight drop to 47 stays PANICKING due to hysteresis band (50 - 6 = 44)
  const s2 = classifyFearState(47, 'PANICKING', 50);
  assert.equal(s2, 'PANICKING');

  // Dropping below hysteresis band (42) cleanly transitions back to FRIGHTENED
  const s3 = classifyFearState(42, 'PANICKING', 50);
  assert.equal(s3, 'FRIGHTENED');
});

test('Cowardly bandits gain significantly more fear than Elite bandits from the same event', () => {
  const cowardGain = computeFearGain(30, 1.85, 1.0, 22);
  const eliteGain = computeFearGain(30, 0.22, 1.0, 95);
  assert.ok(cowardGain > eliteGain * 10, `Expected cowardGain (${cowardGain}) >> eliteGain (${eliteGain})`);
});

test('Running trip never trips idle bandits and triggers for frantic/clumsy runners', () => {
  assert.equal(evaluateRunningTrip(0, true, false, 2.3, 0.5, 0.016, 0.0), false);
  assert.equal(evaluateRunningTrip(150, true, true, 2.3, 0.5, 0.05, 0.005), true);
  assert.equal(evaluateRunningTrip(150, true, true, 2.3, 0.5, 0.05, 0.99), false);
});

test('Camera-glass gag enforces foreground trajectory, threshold, cooldown, and single-active limit', () => {
  const base = {
    enabled: true,
    isAnyGagActive: false,
    cooldownRemainingMs: 0,
    enemyEligible: true,
    launchSpeed: 480,
    launchThreshold: 340,
    vy: 180,
    gagChance: 0.3,
    roll01: 0.1,
  };
  assert.equal(evaluateCameraGagEligibility(base), true);
  // Blocked when launched away from viewer (vy < 0)
  assert.equal(evaluateCameraGagEligibility({ ...base, vy: -120 }), false);
  // Blocked when another gag is already active
  assert.equal(evaluateCameraGagEligibility({ ...base, isAnyGagActive: true }), false);
  // Blocked during cooldown
  assert.equal(evaluateCameraGagEligibility({ ...base, cooldownRemainingMs: 1200 }), false);
  // Blocked when disabled in settings
  assert.equal(evaluateCameraGagEligibility({ ...base, enabled: false }), false);
});

// ==================== STEP 5 FLEXIBLE PARTY & MULTIPLAYER TESTS ====================
import { getPartyBalanceProfile } from '../src/config/heroConfig.ts';
import { PartyManager } from '../src/core/PartyManager.ts';

test('Flexible PartyManager supports 1H+0AI Solo with unused slots strictly EMPTY', () => {
  const pm = new PartyManager();
  pm.setPreset('SOLO');
  assert.equal(pm.activeHeroCount, 1);
  assert.equal(pm.humanPlayerCount, 1);
  assert.equal(pm.aiSlots.length, 0);
  assert.equal(pm.slots[1].control, 'EMPTY');
  assert.equal(pm.slots[2].control, 'EMPTY');
  assert.equal(pm.slots[3].control, 'EMPTY');
});

test('Flexible PartyManager supports 2H+0AI, 3H+1AI, and 4H+0AI without duplicate heroes', () => {
  const pm = new PartyManager();
  pm.setPreset('LOCAL_2P');
  assert.equal(pm.activeHeroCount, 2);
  assert.equal(pm.humanPlayerCount, 2);
  assert.equal(pm.aiSlots.length, 0);

  // Duplicate hero assignment must be rejected
  assert.equal(pm.setSlot(2, 'HUMAN', 'zhaoyun', 'gamepad:1'), false);

  // Valid 3H + 1AI setup
  assert.equal(pm.setSlot(2, 'HUMAN', 'guanyu', 'gamepad:1'), true);
  assert.equal(pm.setSlot(3, 'AI', 'huangzhong'), true);
  assert.equal(pm.activeHeroCount, 4);
  assert.equal(pm.humanPlayerCount, 3);
  assert.equal(pm.aiSlots.length, 1);

  pm.setPreset('LOCAL_4P');
  assert.equal(pm.humanPlayerCount, 4);
  assert.equal(pm.aiSlots.length, 0);
});

test('Join-in-progress spawns into EMPTY slot in Solo and takes over AI in Full Party, disconnect returns to AI', () => {
  const solo = new PartyManager();
  solo.setPreset('SOLO');
  const joinedNew = solo.joinHuman('gamepad:0', 'zhangfei');
  assert.equal(joinedNew.success, true);
  assert.equal(joinedNew.mode, 'SPAWNED_NEW');
  assert.equal(solo.activeHeroCount, 2);
  assert.equal(solo.humanPlayerCount, 2);

  // Disconnect safely returns Zhang Fei to AI without removing the hero
  const left = solo.releaseHumanDevice('gamepad:0');
  assert.equal(left.success, true);
  assert.equal(left.mode, 'RETURNED_TO_AI');
  assert.equal(solo.activeHeroCount, 2);
  assert.equal(solo.humanPlayerCount, 1);
  assert.equal(solo.aiSlots.length, 1);

  // Joining again seamlessly takes over AI Zhang Fei
  const rejoin = solo.joinHuman('gamepad:0', 'zhangfei');
  assert.equal(rejoin.success, true);
  assert.equal(rejoin.mode, 'TOOK_OVER_AI');
  assert.equal(solo.humanPlayerCount, 2);
});

test('Party balance profile scales enemy count and HP smoothly from 1 to 4 heroes', () => {
  const p1 = getPartyBalanceProfile(1);
  const p2 = getPartyBalanceProfile(2);
  const p3 = getPartyBalanceProfile(3);
  const p4 = getPartyBalanceProfile(4);
  assert.ok(p1.enemyCount < p2.enemyCount && p2.enemyCount < p3.enemyCount && p3.enemyCount < p4.enemyCount);
  assert.ok(p1.enemyHpMultiplier < p4.enemyHpMultiplier);
});

// ==================== STEP 6 — STAGE 1, TREASURE EVOLUTION & PERSISTENCE TESTS ====================
import { getStageDifficultyProfile, SeededRng } from '../src/config/stage1Config.ts';
import { computeHeroModifiers, rollTreasureChoices } from '../src/config/treasureConfig.ts';
import { PersistentProgressStore } from '../src/core/PersistentProgress.ts';
import { StageDirector } from '../src/core/StageDirector.ts';

test('StageDirector completes full 5-wave progression to Boss Victory without double-triggering', () => {
  const dir = new StageDirector(1, 0, 4242); // Solo 1H+0AI
  assert.equal(dir.state, 'PREPARATION');
  dir.startIntro();
  assert.equal(dir.state, 'INTRO');

  const w1Start = dir.finishIntroAndBeginStage();
  assert.equal(w1Start.stateChangedTo, 'WAVE_START');
  assert.equal(dir.waveIndex, 0);

  // Step through waves 1..4
  for (let expectedWave = 0; expectedWave < 4; expectedWave++) {
    assert.equal(dir.waveIndex, expectedWave);
    // Advance WAVE_START -> WAVE_ACTIVE
    for (let i = 0; i < 20; i++) {
      dir.step({
        deltaMs: 100,
        activeNonNeutralizedEnemies: 0,
        activeBossAlive: false,
        bossSpawned: false,
        aliveHeroCount: 1,
        heroPositions: [{ x: 640, y: 520 }],
      });
      if (dir.state === 'WAVE_ACTIVE') break;
    }
    assert.equal(dir.state, 'WAVE_ACTIVE');

    // Drain all spawns in this wave
    let totalSpawned = 0;
    for (let i = 0; i < 200; i++) {
      const r = dir.step({
        deltaMs: 100,
        activeNonNeutralizedEnemies: 0,
        activeBossAlive: false,
        bossSpawned: false,
        aliveHeroCount: 1,
        heroPositions: [{ x: 640, y: 520 }],
      });
      totalSpawned += r.spawns.length;
      if (dir.state === 'WAVE_CLEARED') break;
    }
    assert.ok(totalSpawned >= 4, `Wave ${expectedWave + 1} should spawn bandits`);
    assert.equal(dir.state, 'WAVE_CLEARED');

    // Advance WAVE_CLEARED -> either TREASURE_REWARD or next WAVE_START
    for (let i = 0; i < 20; i++) {
      dir.step({
        deltaMs: 100,
        activeNonNeutralizedEnemies: 0,
        activeBossAlive: false,
        bossSpawned: false,
        aliveHeroCount: 1,
        heroPositions: [{ x: 640, y: 520 }],
      });
      if (dir.state !== 'WAVE_CLEARED') break;
    }
    if (dir.state === 'TREASURE_REWARD') {
      dir.finishTreasureReward();
    }
  }

  // Now on Wave 5 (Boss Wave)
  assert.equal(dir.waveIndex, 4);
  let bossSpawnRequested = false;
  for (let i = 0; i < 50; i++) {
    const r = dir.step({
      deltaMs: 100,
      activeNonNeutralizedEnemies: 0,
      activeBossAlive: false,
      bossSpawned: false,
      aliveHeroCount: 1,
      heroPositions: [{ x: 640, y: 520 }],
    });
    if (r.shouldSpawnBoss) bossSpawnRequested = true;
    if (dir.state === 'BOSS_ACTIVE') break;
  }
  assert.equal(bossSpawnRequested, true);
  assert.equal(dir.state, 'BOSS_ACTIVE');

  // Boss defeated -> VICTORY
  const win = dir.step({
    deltaMs: 100,
    activeNonNeutralizedEnemies: 2,
    activeBossAlive: false,
    bossSpawned: true,
    aliveHeroCount: 1,
    heroPositions: [{ x: 640, y: 520 }],
  });
  assert.equal(win.stateChangedTo, 'VICTORY');
  assert.equal(dir.state, 'VICTORY');

  // Victory must never trigger twice
  const winAgain = dir.triggerVictory();
  assert.equal(winAgain.stateChangedTo, undefined);
});

test('StageDirector anti-stall flushes hiding bandits and triggers DEFEAT when all heroes fall', () => {
  const dir = new StageDirector(1, 0, 1001);
  dir.finishIntroAndBeginStage();
  dir.remainingSpawnsInWave = 0;
  // Transition to WAVE_ACTIVE
  for (let i = 0; i < 20; i++) {
    dir.step({
      deltaMs: 100,
      activeNonNeutralizedEnemies: 1,
      activeBossAlive: false,
      bossSpawned: false,
      aliveHeroCount: 1,
      heroPositions: [{ x: 640, y: 520 }],
    });
  }
  dir.remainingSpawnsInWave = 0;

  let flushed = false;
  for (let i = 0; i < 60; i++) {
    const r = dir.step({
      deltaMs: 100,
      activeNonNeutralizedEnemies: 1,
      activeBossAlive: false,
      bossSpawned: false,
      aliveHeroCount: 1,
      heroPositions: [{ x: 640, y: 520 }],
    });
    if (r.shouldFlushHidingBandits) {
      flushed = true;
      break;
    }
  }
  assert.equal(flushed, true, 'Anti-stall should flush hiding bandits after 5s');

  // All heroes defeated -> DEFEAT
  const loss = dir.step({
    deltaMs: 100,
    activeNonNeutralizedEnemies: 1,
    activeBossAlive: false,
    bossSpawned: false,
    aliveHeroCount: 0,
    heroPositions: [],
  });
  assert.equal(loss.stateChangedTo, 'DEFEAT');
  assert.equal(dir.state, 'DEFEAT');
});

test('Party-size difficulty scaling covers 1H+0AI through 4H+0AI smoothly', () => {
  const solo = getStageDifficultyProfile(1, 0);
  const duo = getStageDifficultyProfile(2, 0);
  const trio = getStageDifficultyProfile(2, 1);
  const quad = getStageDifficultyProfile(4, 0);

  assert.ok(solo.maxSimultaneousEnemies >= 20 && solo.maxSimultaneousEnemies <= 26);
  assert.ok(duo.maxSimultaneousEnemies >= 28 && duo.maxSimultaneousEnemies <= 36);
  assert.ok(trio.maxSimultaneousEnemies >= 38 && trio.maxSimultaneousEnemies <= 46);
  assert.ok(quad.maxSimultaneousEnemies >= 48 && quad.maxSimultaneousEnemies <= 56);
  assert.ok(solo.bossHp < duo.bossHp && duo.bossHp < trio.bossHp && trio.bossHp < quad.bossHp);
});

test('5-Tier Hero Treasure Evolution stacks predictably with safety clamps for all 4 heroes', () => {
  // Huang Zhong full 5-tier evolution
  const hzMods = computeHeroModifiers(['hz_t1', 'hz_t2', 'hz_t3', 'hz_t4', 'hz_t5']);
  assert.equal(hzMods.extraProjectileCount, 2); // 1 base + 2 = 3 arrows max
  assert.equal(hzMods.arrowSpreadWide, true);
  assert.equal(hzMods.piercingBasicArrows, true);
  assert.equal(hzMods.burstExtraArrows, 6);
  assert.ok(hzMods.attackSpeedMultiplier > 1.2);

  // Guan Yu full 5-tier evolution
  const gyMods = computeHeroModifiers(['gy_t1', 'gy_t2', 'gy_t3', 'gy_t4', 'gy_t5']);
  assert.equal(gyMods.heavyWindProjectile, true);
  assert.ok(gyMods.cycloneRadiusMultiplier >= 1.35);
  assert.equal(gyMods.comboExtraHit, 1);

  // Zhang Fei full 5-tier evolution
  const zfMods = computeHeroModifiers(['zf_t1', 'zf_t2', 'zf_t3', 'zf_t4', 'zf_t5']);
  assert.equal(zfMods.chargeFinalShockwave, true);
  assert.ok(zfMods.chargeDistanceMultiplier >= 1.35);
  assert.ok(zfMods.throwPowerMultiplier >= 1.45);

  // Zhao Yun roller always prioritizes next evolution tier
  const rng = new SeededRng(999);
  const c1 = rollTreasureChoices('zhaoyun', [], rng);
  assert.equal(c1.length, 3);
  assert.equal(c1[0].id, 'zy_t1');
  const c2 = rollTreasureChoices('zhaoyun', ['zy_t1'], rng);
  assert.equal(c2[0].id, 'zy_t2');
});

test('PersistentProgressStore handles corrupted storage gracefully and separates permanent unlocks', () => {
  const mem = new Map<string, string>();
  mem.set('tkm_stage1_progress_v1', '{CORRUPTED_JSON!!!');
  const fakeStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };

  const store = new PersistentProgressStore(fakeStorage);
  assert.equal(store.snapshot.bestScore, 0);
  assert.equal(store.snapshot.totalClears, 0);

  const res = store.recordStage1Victory(5400, 185000);
  assert.equal(res.isNewBestScore, true);
  assert.equal(res.newlyUnlockedId, 'fire_ember');
  assert.equal(store.hasPermanentAbility('fire_ember'), true);
  assert.ok(store.getPermanentDamageBonus() > 0 && store.getPermanentDamageBonus() <= 0.05);

  // Reloading from storage preserves best score and permanent unlock
  const reloaded = new PersistentProgressStore(fakeStorage);
  assert.equal(reloaded.snapshot.bestScore, 5400);
  assert.equal(reloaded.snapshot.fastestClearMs, 185000);
  assert.equal(reloaded.hasPermanentAbility('fire_ember'), true);
});

test('Mayhem scoring deduplicates chain collision IDs and SeededRng varies runs cleanly', () => {
  const dir = new StageDirector(1, 3, 777);
  assert.equal(dir.recordChainCollision('chain_evt_1', 3), true);
  assert.equal(dir.recordChainCollision('chain_evt_1', 3), false); // Duplicate rejected!
  assert.equal(dir.stats.longestChain, 3);
  assert.equal(dir.stats.totalScore, 225);

  const rngA = new SeededRng(101);
  const rngB = new SeededRng(202);
  const seqA = [rngA.int(1, 100), rngA.int(1, 100), rngA.int(1, 100)];
  const seqB = [rngB.int(1, 100), rngB.int(1, 100), rngB.int(1, 100)];
  assert.notDeepEqual(seqA, seqB);
});

// ==================== STEP 7 — ARCADE POLISH, A/B PRESETS & PERFORMANCE TESTS ====================
import { createDefaultMayhemTuning } from '../src/config/mayhemConfig.ts';
import {
  applyCombatFeelPreset,
  applyImportedTuningJson,
  createDefaultPolishSettings,
  IMPACT_REACTION_PROFILES,
  serializeTuningJson,
} from '../src/config/polishConfig.ts';
import { createDefaultStep4Tuning } from '../src/config/step4Config.ts';
import { PerformanceMonitor } from '../src/systems/PerformanceMonitor.ts';

test('HitStopSystem enforces priority and maxHitStopCapMs so simultaneous hits never freeze', () => {
  const combat = createDefaultCombatTuning();
  const polish = createDefaultPolishSettings();
  polish.maxHitStopCapMs = 80;
  const hs = new HitStopSystem(combat, polish);

  hs.trigger(30, 'LIGHT');
  assert.equal(hs.remaining, 30);
  hs.trigger(150, 'ENV_MAJOR'); // Exceeds cap -> clamped cleanly to 80ms!
  assert.equal(hs.remaining, 80);
  // Lower priority light hit must not overwrite active ENV_MAJOR
  hs.trigger(25, 'LIGHT');
  assert.equal(hs.remaining, 80);
});

test('A/B Combat Feel Presets switch cleanly and JSON Export/Import round-trips safely', () => {
  const combat = createDefaultCombatTuning();
  const mayhem = createDefaultMayhemTuning();
  const step4 = createDefaultStep4Tuning();
  const polish = createDefaultPolishSettings();

  applyCombatFeelPreset('ARCADE_CLASSIC', combat, mayhem, step4, polish);
  assert.equal(polish.activePreset, 'ARCADE_CLASSIC');
  assert.ok(combat.hitStopScale < 1.0 && polish.maxShakeCap <= 8);

  applyCombatFeelPreset('MAXIMUM_MAYHEM', combat, mayhem, step4, polish);
  assert.equal(polish.activePreset, 'MAXIMUM_MAYHEM');
  assert.ok(combat.hitStopScale > 1.0 && combat.knockbackMultiplier > 1.0);

  const json = serializeTuningJson(combat, mayhem, step4, polish);
  const combat2 = createDefaultCombatTuning();
  const mayhem2 = createDefaultMayhemTuning();
  const step4_2 = createDefaultStep4Tuning();
  const polish2 = createDefaultPolishSettings();
  assert.equal(applyImportedTuningJson(json, combat2, mayhem2, step4_2, polish2), true);
  assert.equal(polish2.maxHitStopCapMs, polish.maxHitStopCapMs);
  assert.equal(combat2.knockbackMultiplier, combat.knockbackMultiplier);

  // Corrupted JSON is rejected cleanly without throwing
  assert.equal(applyImportedTuningJson('{broken', combat2, mayhem2, step4_2, polish2), false);
});

test('PerformanceMonitor accurately computes P50, P95, max spike, and long-frame counts', () => {
  const pm = new PerformanceMonitor(60);
  for (let i = 0; i < 58; i++) pm.recordFrame(16.6);
  pm.recordFrame(28.0);
  pm.recordFrame(42.0);

  const snap = pm.getSnapshot({
    activeEnemies: 15,
    activeProjectiles: 8,
    activeParticles: 24,
    activeAudioVoices: 10,
  });
  assert.ok(snap.medianFrameMs >= 16.5 && snap.medianFrameMs <= 16.7);
  assert.ok(snap.p95FrameMs >= 16.6);
  assert.equal(snap.maxSpikeMs, 42.0);
  assert.equal(snap.longFrameCount, 2);
  assert.equal(snap.activeAudioVoices, 10);
});

test('Impact Reaction Profiles scale bounce, squash, and tumble monotonically from LIGHT to EXTREME', () => {
  assert.ok(
    IMPACT_REACTION_PROFILES.LIGHT.bounceRestitution <
      IMPACT_REACTION_PROFILES.MEDIUM.bounceRestitution &&
      IMPACT_REACTION_PROFILES.MEDIUM.bounceRestitution <
        IMPACT_REACTION_PROFILES.STRONG.bounceRestitution &&
      IMPACT_REACTION_PROFILES.STRONG.bounceRestitution <
        IMPACT_REACTION_PROFILES.EXTREME.bounceRestitution,
  );
  assert.ok(IMPACT_REACTION_PROFILES.LIGHT.tumbleSpinMul < IMPACT_REACTION_PROFILES.EXTREME.tumbleSpinMul);
});

// ==================== HERO GUARD, KNOCKDOWN, DIZZY, POWER-UP & WRECKAGE TESTS ====================
import {
  getHeroSpecialPoseFrames,
  getPowerUpVisualTier,
  getWreckageFramesForKind,
  pickEnemySkillForArchetype,
  resolveHeroIncomingHit,
} from '../src/core/HeroDefenseMath.ts';

test('Guarding blocks 75% damage, prevents knockdown/dizzy, and preserves player combo', () => {
  const res = resolveHeroIncomingHit({
    baseDamage: 28,
    isGuarding: true,
    isInvulnerable: false,
    isSuperArmored: false,
    isDefeated: false,
    consecutiveHits: 3,
    opts: { heavy: true, causesDizzy: true, dizzyDurationMs: 2200 },
  });
  assert.equal(res.outcome, 'GUARDED');
  assert.equal(res.finalDamage, 7);
  assert.equal(res.launchVz, 0);
  assert.equal(res.dizzyMs, 0);
  assert.equal(res.resetComboCounter, false);
});

test('Unguarded Boss Slam inflicts DIZZY launch and 3rd consecutive normal hit causes KNOCKDOWN', () => {
  const bossSlam = resolveHeroIncomingHit({
    baseDamage: 24,
    isGuarding: false,
    isInvulnerable: false,
    isSuperArmored: false,
    isDefeated: false,
    consecutiveHits: 1,
    opts: { heavy: true, causesDizzy: true, launchVz: 270, dizzyDurationMs: 2100 },
  });
  assert.equal(bossSlam.outcome, 'DIZZY');
  assert.equal(bossSlam.finalDamage, 24);
  assert.equal(bossSlam.launchVz, 270);
  assert.equal(bossSlam.dizzyMs, 2100);

  const thirdHit = resolveHeroIncomingHit({
    baseDamage: 10,
    isGuarding: false,
    isInvulnerable: false,
    isSuperArmored: false,
    isDefeated: false,
    consecutiveHits: 3,
  });
  assert.equal(thirdHit.outcome, 'KNOCKDOWN');
  assert.ok(thirdHit.launchVz > 200);
});

test('Treasure Power-Up visual tiers, special pose frames, and wreckage frame mappings are well-defined', () => {
  assert.equal(getPowerUpVisualTier(0), 0);
  assert.equal(getPowerUpVisualTier(1), 1);
  assert.equal(getPowerUpVisualTier(3), 2);
  assert.equal(getPowerUpVisualTier(5), 3);

  assert.deepEqual(getHeroSpecialPoseFrames('zhaoyun'), { carryFrame: 0, koFrame: 4 });
  assert.deepEqual(getHeroSpecialPoseFrames('guanyu'), { carryFrame: 1, koFrame: 5 });
  assert.deepEqual(getHeroSpecialPoseFrames('zhangfei'), { carryFrame: 2, koFrame: 6 });
  assert.deepEqual(getHeroSpecialPoseFrames('huangzhong'), { carryFrame: 3, koFrame: 7 });

  assert.equal(getWreckageFramesForKind('table').length, 3);
  assert.equal(getWreckageFramesForKind('ceramic_jar').length, 2);
  assert.equal(getWreckageFramesForKind('barrel_water')[0].frame, 2);
  assert.equal(getWreckageFramesForKind('fruit_basket', () => 0.2)[0].frame, 5);
  assert.equal(getWreckageFramesForKind('fruit_basket', () => 0.8)[0].frame, 6);
});

test('Higher-tier bandit archetypes select distinct combat skills by range while cowards stay basic', () => {
  assert.equal(pickEnemySkillForArchetype('elite', 120, () => 0.2), 'WHIRLWIND');
  assert.equal(pickEnemySkillForArchetype('elite', 120, () => 0.8), 'GROUND_SLAM');
  assert.equal(pickEnemySkillForArchetype('elite', 240, () => 0.2), 'GROUND_SLAM');
  assert.equal(pickEnemySkillForArchetype('stubborn', 150), 'DASH_CLEAVE');
  assert.equal(pickEnemySkillForArchetype('stubborn', 40), 'NONE');
  assert.equal(pickEnemySkillForArchetype('sneaky', 210), 'DAGGER_THROW');
  assert.equal(pickEnemySkillForArchetype('sneaky', 70), 'NONE');
  assert.equal(pickEnemySkillForArchetype('overconfident', 110, () => 0.1), 'GROUND_SLAM');
  assert.equal(pickEnemySkillForArchetype('coward', 100, () => 0.1), 'NONE');
});

import { HERO_DATA, ALL_HERO_IDS } from '../src/config/heroConfig.ts';

test('All 4 heroes define 3 unique signature skills including elemental emergency escape ultimates', () => {
  const seenSkillNames = new Set<string>();
  for (const id of ALL_HERO_IDS) {
    const spec = HERO_DATA[id];
    assert.ok(spec.specialName.length > 0);
    assert.ok(spec.skill2Name.length > 0 && spec.skill2CooldownMs >= 6000);
    assert.ok(spec.skill3Name.length > 0 && spec.skill3CooldownMs >= 12000);
    seenSkillNames.add(spec.specialName);
    seenSkillNames.add(spec.skill2Name);
    seenSkillNames.add(spec.skill3Name);
  }
  assert.equal(seenSkillNames.size, 12, 'All 4 heroes x 3 skills = 12 distinct skill names');
  assert.equal(HERO_DATA.zhaoyun.skill3Element, 'WATER');
  assert.equal(HERO_DATA.guanyu.skill3Element, 'THUNDER');
  assert.equal(HERO_DATA.zhangfei.skill3Element, 'FIRE');
  assert.equal(HERO_DATA.huangzhong.skill3Element, 'SOLAR');
});

import { ENV_OBJECT_SPECS } from '../src/config/mayhemConfig.ts';
import { BANDIT_ARCHETYPES } from '../src/config/step4Config.ts';

test('All 11 street-market goods and 10 diverse enemy archetypes (archer, bomber, grappler, soldier) are configured properly', () => {
  const newGoods = ['silk_bolts', 'fish_tub', 'meat_stall', 'grain_sack', 'bean_sack', 'spice_stall'] as const;
  assert.equal(Object.keys(ENV_OBJECT_SPECS).length, 11);
  for (const kind of newGoods) {
    const spec = ENV_OBJECT_SPECS[kind];
    assert.ok(spec && spec.label.length > 0 && spec.durability >= 1);
    const wreck = getWreckageFramesForKind(kind);
    assert.ok(wreck.length >= 1);
    assert.equal(wreck[0].textureKey, 'market_goods');
  }
  assert.equal(ENV_OBJECT_SPECS.fish_tub.containsWater, true);
  assert.equal(ENV_OBJECT_SPECS.bean_sack.spillsFood, true);
  assert.equal(ENV_OBJECT_SPECS.silk_bolts.material, 'cloth');
  assert.equal(ENV_OBJECT_SPECS.grain_sack.material, 'sack');

  assert.equal(Object.keys(BANDIT_ARCHETYPES).length, 10);
  assert.equal(pickEnemySkillForArchetype('archer', 240), 'ARROW_SHOT');
  assert.equal(pickEnemySkillForArchetype('archer', 70), 'NONE');
  assert.equal(pickEnemySkillForArchetype('bomber', 220), 'BOMB_THROW');
  assert.equal(pickEnemySkillForArchetype('bomber', 60), 'NONE');
  assert.equal(pickEnemySkillForArchetype('grappler', 90), 'BEAR_HUG');
  assert.equal(pickEnemySkillForArchetype('grappler', 250), 'NONE');
  assert.equal(pickEnemySkillForArchetype('soldier', 150), 'DASH_CLEAVE');
});

import { evaluateHealthDrop, HEALTH_PICKUP_SPECS } from '../src/core/HeroDefenseMath.ts';

test('Health recovery drops enforce cap, cooldown, mercy scaling, and most enemies do not surrender', () => {
  assert.equal(Object.keys(HEALTH_PICKUP_SPECS).length, 3);
  // Respects simultaneous floor cap (2) and cooldown (8.5s)
  assert.equal(
    evaluateHealthDrop({ source: 'PROP_FOOD', avgPartyHpRatio: 0.2, activeHealCount: 2, msSinceLastDrop: 20000 }, () => 0.01),
    null,
  );
  assert.equal(
    evaluateHealthDrop({ source: 'PROP_FOOD', avgPartyHpRatio: 0.2, activeHealCount: 0, msSinceLastDrop: 4000 }, () => 0.01),
    null,
  );
  // Drops a potion when eligible and roll succeeds
  const dropped = evaluateHealthDrop(
    { source: 'PROP_FOOD', avgPartyHpRatio: 0.35, activeHealCount: 0, msSinceLastDrop: 12000 },
    () => 0.05,
  );
  assert.ok(dropped === 'steamed_bun' || dropped === 'red_potion' || dropped === 'golden_elixir');

  // Rebalanced surrender: only coward can surrender (>= 96), all other 9 archetypes never surrender (101)
  assert.ok(BANDIT_ARCHETYPES.coward.surrenderThreshold >= 95);
  for (const key of ['overconfident', 'clumsy', 'sneaky', 'stubborn', 'elite', 'archer', 'bomber', 'grappler', 'soldier'] as const) {
    assert.ok(BANDIT_ARCHETYPES[key].surrenderThreshold > 100, `${key} should not surrender during regular waves`);
  }
});

