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
