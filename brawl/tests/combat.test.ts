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

  assert.ok(solo.maxSimultaneousEnemies >= 6 && solo.maxSimultaneousEnemies <= 8);
  assert.ok(duo.maxSimultaneousEnemies >= 9 && duo.maxSimultaneousEnemies <= 12);
  assert.ok(trio.maxSimultaneousEnemies >= 12 && trio.maxSimultaneousEnemies <= 16);
  assert.ok(quad.maxSimultaneousEnemies >= 16 && quad.maxSimultaneousEnemies <= 20);
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




