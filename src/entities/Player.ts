import Phaser from 'phaser';

export interface SlashAttackEvent {
  x: number;
  y: number;
  angle: number;
  range: number;
  halfArcRad: number;
  damage: number;
  knockback: number;
  isWhirlwind: boolean;
  isComboExplosion?: boolean;
  isCrit?: boolean;
  hitstopMs?: number;
  label?: string;
}

export const WEAPON_TIERS = [
  '일반 창',
  '강화 장창',
  '영웅 청룡창',
  '전설 용담창',
] as const;

const ACTION_FRAME = {
  COMBO_1: 0,
  COMBO_2: 1,
  COMBO_3: 2,
  WHIRLWIND: 3,
  GUARD: 4,
  JUMP_RISE: 5,
  AIR_STRIKE: 6,
  DASH: 7,
} as const;

export type DamageBlockResult = 'hit' | 'guard' | 'perfect_guard' | 'invuln';

/**
 * Zhao Yun (조운) player entity:
 * - Idle/Move: 8-direction spritesheet (`zhaoyun_8dir`)
 * - Actions: 8-pose action spritesheet (`zhaoyun_actions`) for
 *   3-hit Combo (Click), Jump + Air Plunge (Space + Click),
 *   Guard / Perfect Guard (Right-Click / Q), 360° Whirlwind (E), and Dash (Shift).
 */
export class Player {
  public readonly scene: Phaser.Scene;
  public readonly visual: Phaser.GameObjects.Container;
  public readonly collisionRadius = 18;

  public x: number;
  public y: number;
  public hp = 200;
  public maxHp = 200;
  public facingAngle = Math.PI / 2;
  public isGuarding = false;

  // RPG Progression & Treasure Upgrades
  public level = 1;
  public exp = 0;
  public expToNext = 90;
  public speedLevel = 1;
  public blastLevel = 1;
  public weaponTier = 0; // 0..3 (일반 -> 강화 -> 영웅 -> 전설)

  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly guardAura: Phaser.GameObjects.Graphics;
  private readonly dirScale = 0.72;
  private readonly actionScale = 0.64;
  private readonly runScale = 0.64;

  // Smooth inertia movement & Jump (pseudo-3D Z-axis)
  private readonly maxMoveSpeed = 265;
  private readonly accelRate = 1850;
  private readonly turnAccelRate = 2950;
  private readonly brakeDecelRate = 2150;
  private moveVx = 0;
  private moveVy = 0;
  private wasMovingInput = false;
  private runFrameFloat = 0;
  private lastRunFrameIdx = -1;
  private idleBreathTime = 0;
  private lastRunFlipX = false;

  private jumpZ = 0;
  private jumpVz = 0;
  private isAirPlunging = false;

  // 3-Hit Combo state
  private comboStep = 0; // 0, 1, 2
  private comboResetTimer = 0;
  private attackCooldownTimer = 0;
  private attackPoseTimer = 0;
  private currentAttackFrame: number = ACTION_FRAME.COMBO_1;
  private slashSwingDir = 1;

  // Guard / Perfect Guard state
  private guardElapsedMs = 0;

  // Whirlwind (E) state
  private readonly whirlwindCooldownMs = 3200;
  private readonly whirlwindSpinDurationMs = 300;
  private whirlwindCooldownTimer = 0;
  private whirlwindSpinTimer = 0;

  // Dash (Shift) state
  private readonly dashCooldownMs = 1500;
  private readonly dashDurationMs = 175;
  private readonly dashSpeed = 620;
  private dashCooldownTimer = 0;
  private dashActiveTimer = 0;
  private dashDirX = 1;
  private dashDirY = 0;

  private walkPhase = 0;
  private invulnTimer = 0;
  private regenDelayTimer = 0;
  private knockbackVx = 0;
  private knockbackVy = 0;
  private flashTimer?: Phaser.Time.TimerEvent;
  private prevLeftDown = false;

  private readonly keys: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    e: Phaser.Input.Keyboard.Key;
    q: Phaser.Input.Keyboard.Key;
    shift: Phaser.Input.Keyboard.Key;
    j: Phaser.Input.Keyboard.Key;
  };

  private readonly aimIndicator: Phaser.GameObjects.Graphics;
  private readonly onAttack: (event: SlashAttackEvent) => void;
  private pointerHasMoved = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onAttack: (event: SlashAttackEvent) => void,
  ) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.onAttack = onAttack;

    this.shadow = scene.add.ellipse(0, 2, 44, 20, 0x090b10, 0.36);
    this.sprite = scene.add.sprite(0, 6, 'zhaoyun_8dir', 2);
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(this.dirScale);

    this.guardAura = scene.add.graphics();
    this.visual = scene.add.container(x, y, [
      this.shadow,
      this.sprite,
      this.guardAura,
    ]);
    this.visual.setDepth(y);

    this.aimIndicator = scene.add.graphics();
    this.aimIndicator.setDepth(5);

    const kb = scene.input.keyboard!;
    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      q: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      j: kb.addKey(Phaser.Input.Keyboard.KeyCodes.J),
    };

    scene.input.on('pointermove', () => {
      this.pointerHasMoved = true;
    });
  }

  public get skillCooldownRatio(): number {
    return Phaser.Math.Clamp(
      1 - this.whirlwindCooldownTimer / this.whirlwindCooldownMs,
      0,
      1,
    );
  }

  public get weaponTierName(): string {
    return WEAPON_TIERS[Math.min(this.weaponTier, WEAPON_TIERS.length - 1)];
  }

  public get attackSpeedMultiplier(): number {
    return 1 + (this.speedLevel - 1) * 0.14 + (this.level - 1) * 0.04;
  }

  public get damageMultiplier(): number {
    return 1 + (this.level - 1) * 0.14 + (this.blastLevel - 1) * 0.12 + this.weaponTier * 0.1;
  }

  /** Grants EXP and triggers flashy Level-Up burst + weapon evolution when threshold is met. */
  public gainExp(amount: number): { leveledUp: boolean; newLevel: number; evolvedWeapon: boolean } {
    this.exp += amount;
    let leveledUp = false;
    let evolvedWeapon = false;

    while (this.exp >= this.expToNext) {
      this.exp -= this.expToNext;
      this.level += 1;
      this.expToNext = Math.round(90 + (this.level - 1) * 55);
      this.maxHp += 25;
      this.hp = Math.min(this.maxHp, this.hp + 75);
      leveledUp = true;

      const nextTier = Math.min(3, Math.floor((this.level - 1) / 2));
      if (nextTier > this.weaponTier) {
        this.weaponTier = nextTier;
        evolvedWeapon = true;
      }

      this.triggerLevelUpBurst();
    }

    return { leveledUp, newLevel: this.level, evolvedWeapon };
  }

  public upgradeAttackSpeed(): void {
    this.speedLevel = Math.min(9, this.speedLevel + 1);
    this.flashHit(140, 0x6ee7b7);
  }

  public upgradeComboBlast(): void {
    this.blastLevel = Math.min(9, this.blastLevel + 1);
    this.flashHit(140, 0x38bdf8);
  }

  private triggerLevelUpBurst(): void {
    this.flashHit(220, 0xfde047);

    // Towering golden-cyan pillar of light
    const beam = this.scene.add.rectangle(this.x, this.y - 140, 56, 300, 0xfde047, 0.52);
    beam.setDepth(this.y + 60);
    this.scene.tweens.add({
      targets: beam,
      scaleX: 2.2,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => beam.destroy(),
    });

    // Expanding shockwave ring
    const ring = this.scene.add.graphics();
    ring.setPosition(this.x, this.y - 12);
    ring.setDepth(this.y + 55);
    ring.lineStyle(10, 0xfbbf24, 0.9);
    ring.strokeCircle(0, 0, 75);
    ring.lineStyle(4, 0x67e8f9, 0.95);
    ring.strokeCircle(0, 0, 52);

    this.scene.tweens.add({
      targets: ring,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Knockback nearby enemies on level up!
    this.onAttack({
      x: this.x,
      y: this.y,
      angle: this.facingAngle,
      range: 175,
      halfArcRad: Math.PI,
      damage: Math.round(140 * this.damageMultiplier),
      knockback: 540,
      isWhirlwind: true,
      isComboExplosion: true,
      hitstopMs: 45,
      label: `LEVEL UP! LV.${this.level}`,
    });
  }

  public get isAirborne(): boolean {
    return this.jumpZ > 1;
  }

  public flashHit(durationMs = 80, color = 0xffffff): void {
    this.sprite.setTintFill(color);
    if (this.flashTimer) {
      this.flashTimer.remove(false);
    }
    this.flashTimer = this.scene.time.delayedCall(durationMs, () => {
      if (this.sprite.active) {
        this.sprite.clearTint();
      }
    });
  }

  public setVisible(visible: boolean): void {
    this.visual.setVisible(visible);
    this.aimIndicator.setVisible(visible);
  }

  public setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.visual.setPosition(x, y);
    this.visual.setDepth(y);
  }

  public update(
    dtMs: number,
    worldBounds: Phaser.Geom.Rectangle,
    resolveObstacles: (x: number, y: number, radius: number) => { x: number; y: number },
  ): void {
    const dt = dtMs / 1000;

    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dtMs);
    }
    if (this.attackPoseTimer > 0) {
      this.attackPoseTimer = Math.max(0, this.attackPoseTimer - dtMs);
    }
    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dtMs);
      if (this.comboResetTimer <= 0) {
        this.comboStep = 0;
      }
    }
    if (this.whirlwindCooldownTimer > 0) {
      this.whirlwindCooldownTimer = Math.max(0, this.whirlwindCooldownTimer - dtMs);
    }
    if (this.whirlwindSpinTimer > 0) {
      this.whirlwindSpinTimer = Math.max(0, this.whirlwindSpinTimer - dtMs);
    }
    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dtMs);
    }
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dtMs);
    }

    // Gentle HP regen when out of combat
    if (this.regenDelayTimer > 0) {
      this.regenDelayTimer -= dtMs;
    } else if (this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 9 * dt);
    }

    // 360-degree movement input
    let ix = 0;
    let iy = 0;
    if (this.keys.a.isDown || this.keys.left.isDown) ix -= 1;
    if (this.keys.d.isDown || this.keys.right.isDown) ix += 1;
    if (this.keys.w.isDown || this.keys.up.isDown) iy -= 1;
    if (this.keys.s.isDown || this.keys.down.isDown) iy += 1;

    const inputLen = Math.hypot(ix, iy);
    if (inputLen > 0) {
      ix /= inputLen;
      iy /= inputLen;
    }

    // Facing angle from mouse cursor (or movement direction before mouse moves)
    const pointer = this.scene.input.activePointer;
    if (this.pointerHasMoved && pointer) {
      const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.facingAngle = Phaser.Math.Angle.Between(
        this.x,
        this.y,
        worldPoint.x,
        worldPoint.y,
      );
    } else if (inputLen > 0) {
      this.facingAngle = Math.atan2(iy, ix);
    }

    const leftNow = !!(pointer && pointer.isDown && pointer.leftButtonDown());
    const leftJustPressed = leftNow && !this.prevLeftDown;
    this.prevLeftDown = leftNow;

    // 1. Guard / Defense (Right-click hold or Q hold, on ground, not spinning/dashing)
    const wantGuard =
      !this.isAirborne &&
      this.whirlwindSpinTimer <= 0 &&
      this.dashActiveTimer <= 0 &&
      (this.keys.q.isDown || (pointer && pointer.isDown && pointer.rightButtonDown()));

    if (wantGuard) {
      if (!this.isGuarding) {
        this.isGuarding = true;
        this.guardElapsedMs = 0;
      } else {
        this.guardElapsedMs += dtMs;
      }
    } else {
      this.isGuarding = false;
      this.guardElapsedMs = 0;
    }

    // 2. Jump (Space)
    if (
      Phaser.Input.Keyboard.JustDown(this.keys.space) &&
      !this.isAirborne &&
      this.dashActiveTimer <= 0
    ) {
      this.jumpVz = 430;
      this.jumpZ = 2;
      this.isGuarding = false;
      this.isAirPlunging = false;
    }

    // 3. Dash / Dodge (Shift)
    if (
      Phaser.Input.Keyboard.JustDown(this.keys.shift) &&
      this.dashCooldownTimer <= 0 &&
      this.dashActiveTimer <= 0
    ) {
      const dirAngle = inputLen > 0 ? Math.atan2(iy, ix) : this.facingAngle;
      this.dashDirX = Math.cos(dirAngle);
      this.dashDirY = Math.sin(dirAngle);
      this.dashActiveTimer = this.dashDurationMs;
      this.dashCooldownTimer = this.dashCooldownMs;
      this.invulnTimer = Math.max(this.invulnTimer, this.dashDurationMs + 60);
      this.isGuarding = false;
    }

    // 4. Whirlwind Skill (E)
    if (
      Phaser.Input.Keyboard.JustDown(this.keys.e) &&
      this.whirlwindCooldownTimer <= 0 &&
      this.dashActiveTimer <= 0
    ) {
      this.isGuarding = false;
      this.performWhirlwindSlash();
    }

    // 5. Attack: Air Plunge Strike if airborne, else 3-Hit Combo (Left Click or J)
    const triggerAttack =
      leftJustPressed ||
      Phaser.Input.Keyboard.JustDown(this.keys.j) ||
      (leftNow && this.attackCooldownTimer <= 0 && !this.isAirborne);

    if (
      triggerAttack &&
      !this.isGuarding &&
      this.whirlwindSpinTimer <= 0 &&
      this.dashActiveTimer <= 0
    ) {
      if (this.isAirborne && !this.isAirPlunging) {
        this.startAirPlunge();
      } else if (!this.isAirborne && this.attackCooldownTimer <= 0) {
        this.performComboAttack();
      }
    }

    // Integrate Jump Z-axis physics
    if (this.jumpZ > 0 || this.jumpVz !== 0) {
      const gravity = this.isAirPlunging ? 2600 : 1280;
      this.jumpZ += this.jumpVz * dt;
      this.jumpVz -= gravity * dt;

      if (this.jumpZ <= 0) {
        this.jumpZ = 0;
        this.jumpVz = 0;
        if (this.isAirPlunging) {
          this.isAirPlunging = false;
          this.triggerAirPlungeImpact();
        }
      }
    }

    // Integrate XY velocity with smooth acceleration, snappy turn-around & natural braking
    let vx = 0;
    let vy = 0;
    if (this.dashActiveTimer > 0) {
      this.dashActiveTimer = Math.max(0, this.dashActiveTimer - dtMs);
      this.moveVx = this.dashDirX * this.dashSpeed * 0.45;
      this.moveVy = this.dashDirY * this.dashSpeed * 0.45;
      vx = this.dashDirX * this.dashSpeed;
      vy = this.dashDirY * this.dashSpeed;
      if (Math.random() < 0.65) {
        this.spawnDashAfterimage();
      }
    } else {
      const speedMult = this.isGuarding ? 0.35 : this.attackPoseTimer > 0 ? 0.45 : 1;
      const targetVx = ix * this.maxMoveSpeed * speedMult;
      const targetVy = iy * this.maxMoveSpeed * speedMult;

      if (inputLen > 0) {
        const diffX = targetVx - this.moveVx;
        const diffY = targetVy - this.moveVy;
        const diffLen = Math.hypot(diffX, diffY);
        // Faster counter-acceleration when reversing direction so turning feels crisp
        const dot = this.moveVx * targetVx + this.moveVy * targetVy;
        const rate = dot < 0 ? this.turnAccelRate : this.accelRate;
        const maxStep = rate * dt;

        if (diffLen <= maxStep) {
          this.moveVx = targetVx;
          this.moveVy = targetVy;
        } else if (diffLen > 0.001) {
          this.moveVx += (diffX / diffLen) * maxStep;
          this.moveVy += (diffY / diffLen) * maxStep;
        }
      } else {
        // Natural braking deceleration when releasing movement keys
        const curSpeed = Math.hypot(this.moveVx, this.moveVy);
        if (this.wasMovingInput && curSpeed > 165 && !this.isAirborne) {
          this.spawnFootDust(this.x, this.y + 2, 3);
        }
        const brakeStep = this.brakeDecelRate * dt;
        if (curSpeed <= brakeStep) {
          this.moveVx = 0;
          this.moveVy = 0;
        } else {
          const nextSpeed = curSpeed - brakeStep;
          this.moveVx = (this.moveVx / curSpeed) * nextSpeed;
          this.moveVy = (this.moveVy / curSpeed) * nextSpeed;
        }
      }

      this.wasMovingInput = inputLen > 0;
      vx = this.moveVx + this.knockbackVx;
      vy = this.moveVy + this.knockbackVy;
    }

    const damp = Math.exp(-10 * dt);
    this.knockbackVx *= damp;
    this.knockbackVy *= damp;
    if (Math.hypot(this.knockbackVx, this.knockbackVy) < 4) {
      this.knockbackVx = 0;
      this.knockbackVy = 0;
    }

    const nextX = Phaser.Math.Clamp(
      this.x + vx * dt,
      worldBounds.left + 32,
      worldBounds.right - 32,
    );
    const nextY = Phaser.Math.Clamp(
      this.y + vy * dt,
      worldBounds.top + 32,
      worldBounds.bottom - 32,
    );

    const resolved = resolveObstacles(nextX, nextY, this.collisionRadius);
    this.x = resolved.x;
    this.y = resolved.y;

    this.updateSpritePresentation(dt);
    this.drawAimIndicator();
    this.drawGuardAura();
  }

  public takeDamage(
    amount: number,
    knockbackX: number,
    knockbackY: number,
  ): DamageBlockResult {
    if (this.invulnTimer > 0 || this.whirlwindSpinTimer > 0 || this.jumpZ > 24) {
      return 'invuln';
    }

    // Check Guard / Perfect Guard
    if (this.isGuarding) {
      const isPerfect = this.guardElapsedMs <= 240;
      if (isPerfect) {
        this.flashHit(110, 0xfde047);
        this.spawnPerfectGuardShockwave();
        this.onAttack({
          x: this.x,
          y: this.y,
          angle: this.facingAngle,
          range: 120,
          halfArcRad: Math.PI,
          damage: 90,
          knockback: 520,
          isWhirlwind: true,
          label: 'PERFECT GUARD!',
        });
        return 'perfect_guard';
      }

      const reduced = Math.max(1, Math.round(amount * 0.2));
      this.hp = Math.max(0, this.hp - reduced);
      this.invulnTimer = 260;
      this.knockbackVx += knockbackX * 0.3;
      this.knockbackVy += knockbackY * 0.3;
      this.flashHit(80, 0x7dd3fc);
      return 'guard';
    }

    this.hp = Math.max(0, this.hp - amount);
    this.invulnTimer = 380;
    this.regenDelayTimer = 4000;
    this.knockbackVx += knockbackX;
    this.knockbackVy += knockbackY;
    this.flashHit(80, 0xffffff);
    return 'hit';
  }

  public heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  private updateSpritePresentation(dt: number): void {
    const facingLeft = Math.cos(this.facingAngle) < -0.05;
    const speed = Math.hypot(this.moveVx, this.moveVy);
    const isRunning = speed > 28;

    let usingActionSheet = false;
    let targetActionFrame: number = ACTION_FRAME.COMBO_1;
    let flipX = facingLeft;

    if (this.whirlwindSpinTimer > 0) {
      usingActionSheet = true;
      targetActionFrame = ACTION_FRAME.WHIRLWIND;
      flipX = Math.floor(this.whirlwindSpinTimer / 55) % 2 === 0;
    } else if (this.dashActiveTimer > 0) {
      usingActionSheet = true;
      targetActionFrame = ACTION_FRAME.DASH;
      flipX = this.dashDirX < -0.05;
    } else if (this.isAirborne) {
      usingActionSheet = true;
      targetActionFrame =
        this.isAirPlunging || this.jumpVz < -40
          ? ACTION_FRAME.AIR_STRIKE
          : ACTION_FRAME.JUMP_RISE;
    } else if (this.isGuarding) {
      usingActionSheet = true;
      targetActionFrame = ACTION_FRAME.GUARD;
    } else if (this.attackPoseTimer > 0) {
      usingActionSheet = true;
      targetActionFrame = this.currentAttackFrame;
    }

    if (usingActionSheet) {
      if (this.sprite.texture.key !== 'zhaoyun_actions') {
        this.sprite.setTexture('zhaoyun_actions', targetActionFrame);
      } else {
        this.sprite.setFrame(targetActionFrame);
      }
      this.sprite.setFlipX(flipX);
      this.sprite.setScale(this.actionScale);
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.3);
      this.lastRunFrameIdx = -1;
    } else if (isRunning) {
      // Smooth speed-coupled 4-frame running stride animation (`zhaoyun_run`)
      const speedRatio = Phaser.Math.Clamp(speed / this.maxMoveSpeed, 0.25, 1.15);
      this.runFrameFloat = (this.runFrameFloat + dt * 11.5 * speedRatio) % 4;
      const frameIdx = Math.floor(this.runFrameFloat);

      if (Math.abs(this.moveVx) > 12) {
        this.lastRunFlipX = this.moveVx < 0;
      } else {
        this.lastRunFlipX = facingLeft;
      }

      if (this.sprite.texture.key !== 'zhaoyun_run') {
        this.sprite.setTexture('zhaoyun_run', frameIdx);
      } else {
        this.sprite.setFrame(frameIdx);
      }
      this.sprite.setFlipX(this.lastRunFlipX);
      this.sprite.setScale(this.runScale);

      // Subtle organic forward lean into the run (no cartoonish hopping!)
      const targetLean = Phaser.Math.Clamp(
        (this.moveVx / this.maxMoveSpeed) * 0.085,
        -0.085,
        0.085,
      );
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, targetLean, 0.22);
      this.sprite.y = 6;

      // Kick up soft footstep dust on ground-contact stride frames (0 & 2)
      if (frameIdx !== this.lastRunFrameIdx) {
        if ((frameIdx === 0 || frameIdx === 2) && speed > 110) {
          const dustOffsetX = this.lastRunFlipX ? 10 : -10;
          this.spawnFootDust(this.x + dustOffsetX, this.y + 2, 1);
        }
        this.lastRunFrameIdx = frameIdx;
      }
    } else {
      // Calm 8-direction standing pose with subtle natural breathing
      const dirFrame = this.angleTo8DirFrame(this.facingAngle);
      if (this.sprite.texture.key !== 'zhaoyun_8dir') {
        this.sprite.setTexture('zhaoyun_8dir', dirFrame);
      } else {
        this.sprite.setFrame(dirFrame);
      }
      this.sprite.setFlipX(false);
      this.lastRunFrameIdx = -1;

      this.idleBreathTime += dt * 3.2;
      const breath = Math.sin(this.idleBreathTime) * 0.018;
      this.sprite.setScale(
        Phaser.Math.Linear(this.sprite.scaleX, this.dirScale * (1 - breath * 0.5), 0.22),
        Phaser.Math.Linear(this.sprite.scaleY, this.dirScale * (1 + breath), 0.22),
      );
      this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.25);
      this.sprite.y = Phaser.Math.Linear(this.sprite.y, 6, 0.25);
    }

    // Apply Z-axis jump elevation & ground shadow scaling
    if (this.jumpZ > 0) {
      this.sprite.y = 6 - this.jumpZ;
      const shScale = Phaser.Math.Clamp(1 - this.jumpZ * 0.006, 0.45, 1);
      this.shadow.setScale(shScale, shScale);
    } else if (usingActionSheet) {
      this.sprite.y = 6;
      this.shadow.setScale(1, 1);
    } else {
      this.shadow.setScale(1, 1);
    }

    // Subtle forward lunge offset during combo strikes
    let lungeX = 0;
    let lungeY = 0;
    if (this.attackPoseTimer > 0 && !this.isAirborne) {
      const t = this.attackPoseTimer / 220;
      const lungeDist = this.currentAttackFrame === ACTION_FRAME.COMBO_3 ? 13 : 8;
      lungeX = Math.cos(this.facingAngle) * lungeDist * t;
      lungeY = Math.sin(this.facingAngle) * lungeDist * t;
    }

    this.visual.setPosition(this.x + lungeX, this.y + lungeY);
    this.visual.setDepth(this.y);
  }

  private spawnFootDust(x: number, y: number, count: number): void {
    const emitter = this.scene.add.particles(x, y, 'dust_puff', {
      speed: { min: 15, max: 48 },
      angle: { min: 180, max: 360 },
      scale: { start: 0.75, end: 0.1 },
      alpha: { start: 0.6, end: 0 },
      lifespan: { min: 200, max: 340 },
      emitting: false,
    });
    emitter.setDepth(y - 2);
    emitter.explode(count);
    this.scene.time.delayedCall(380, () => emitter.destroy());
  }

  private performComboAttack(): void {
    const step = this.comboStep; // 0 -> Combo 1, 1 -> Combo 2, 2 -> Combo 3 (Combo Explosion!)
    this.comboStep = (this.comboStep + 1) % 3;
    this.comboResetTimer = 760;
    this.slashSwingDir *= -1;

    const spd = this.attackSpeedMultiplier;
    const dmgMult = this.damageMultiplier;
    const critChance = Math.min(0.45, 0.12 + (this.level - 1) * 0.04 + (this.blastLevel - 1) * 0.03);
    const isCrit = Math.random() < critChance;
    const critMult = isCrit ? 1.45 : 1;

    if (step === 0) {
      // Combo 1: Rapid Spear Thrust
      this.currentAttackFrame = ACTION_FRAME.COMBO_1;
      this.attackCooldownTimer = Math.max(125, Math.round(240 / spd));
      this.attackPoseTimer = Math.max(120, Math.round(200 / spd));
      const range = 116 + this.weaponTier * 8;
      this.spawnThrustEffect(this.facingAngle, range);
      this.onAttack({
        x: this.x,
        y: this.y,
        angle: this.facingAngle,
        range,
        halfArcRad: Phaser.Math.DegToRad(50),
        damage: Math.round(Phaser.Math.Between(135, 155) * dmgMult * critMult),
        knockback: 265,
        isWhirlwind: false,
        isCrit,
        hitstopMs: isCrit ? 48 : 34,
      });
    } else if (step === 1) {
      // Combo 2: Wide Upward Diagonal Slash
      this.currentAttackFrame = ACTION_FRAME.COMBO_2;
      this.attackCooldownTimer = Math.max(135, Math.round(260 / spd));
      this.attackPoseTimer = Math.max(130, Math.round(215 / spd));
      const range = 120 + this.weaponTier * 10;
      const halfArc = Phaser.Math.DegToRad(78);
      this.spawnAzureSlashEffect(this.facingAngle, range, halfArc, this.slashSwingDir);
      this.onAttack({
        x: this.x,
        y: this.y,
        angle: this.facingAngle,
        range,
        halfArcRad: halfArc,
        damage: Math.round(Phaser.Math.Between(160, 185) * dmgMult * critMult),
        knockback: 335,
        isWhirlwind: false,
        isCrit,
        hitstopMs: isCrit ? 52 : 38,
      });
    } else {
      // Combo 3: AZURE DRAGON COMBO EXPLOSION (청룡 콤보 폭발!)
      this.currentAttackFrame = ACTION_FRAME.COMBO_3;
      this.attackCooldownTimer = Math.max(195, Math.round(350 / spd));
      this.attackPoseTimer = Math.max(165, Math.round(255 / spd));
      this.comboResetTimer = 0;

      const blastRange = 138 + (this.blastLevel - 1) * 14 + this.weaponTier * 12;
      const blastX = this.x + Math.cos(this.facingAngle) * 42;
      const blastY = this.y + Math.sin(this.facingAngle) * 42;

      this.spawnAzureSlashEffect(
        this.facingAngle,
        blastRange,
        Phaser.Math.DegToRad(95),
        this.slashSwingDir,
        true,
      );
      this.spawnComboExplosionEffect(blastX, blastY, blastRange);

      this.onAttack({
        x: blastX,
        y: blastY,
        angle: this.facingAngle,
        range: blastRange,
        halfArcRad: Math.PI, // Full AoE explosion in front!
        damage: Math.round(
          Phaser.Math.Between(240, 285) *
            dmgMult *
            (1 + (this.blastLevel - 1) * 0.16) *
            (isCrit ? 1.45 : 1),
        ),
        knockback: 540,
        isWhirlwind: true,
        isComboExplosion: true,
        isCrit: true,
        hitstopMs: 58,
        label: this.blastLevel >= 3 ? '청룡 대폭발!!' : '콤보 폭발!',
      });
    }
  }

  /** Flashy multi-layered Azure Dragon Combo Explosion with radial lightning & slash streaks! */
  private spawnComboExplosionEffect(x: number, y: number, radius: number): void {
    const g = this.scene.add.graphics();
    g.setPosition(x, y - 16);
    g.setDepth(y + 52);

    const goldAccent = this.weaponTier >= 2 || this.blastLevel >= 2;

    // Outer cyan-blue shockwave ring
    g.lineStyle(16, 0x0284c7, 0.55);
    g.strokeCircle(0, 0, radius * 0.68);
    g.lineStyle(8, 0x22d3ee, 0.95);
    g.strokeCircle(0, 0, radius * 0.8);
    g.lineStyle(4, goldAccent ? 0xfde047 : 0xffffff, 1);
    g.strokeCircle(0, 0, radius * 0.52);

    // Jagged radial lightning bolts & anime impact slash lines
    const boltCount = 6 + Math.min(6, this.blastLevel);
    for (let i = 0; i < boltCount; i++) {
      const a = (i / boltCount) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.18, 0.18);
      const midR = radius * 0.52;
      const endR = radius * 1.05;
      const perp = a + Math.PI / 2;
      const jag = Phaser.Math.Between(-14, 14);
      const mx = Math.cos(a) * midR + Math.cos(perp) * jag;
      const my = Math.sin(a) * midR + Math.sin(perp) * jag;
      const ex = Math.cos(a) * endR;
      const ey = Math.sin(a) * endR;

      g.lineStyle(4, goldAccent && i % 2 === 0 ? 0xfde047 : 0x67e8f9, 0.95);
      g.lineBetween(0, 0, mx, my);
      g.lineBetween(mx, my, ex, ey);
      g.lineStyle(2, 0xffffff, 1);
      g.lineBetween(0, 0, mx, my);
    }

    this.scene.tweens.add({
      targets: g,
      scaleX: 1.32,
      scaleY: 1.32,
      alpha: 0,
      rotation: 0.25,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private startAirPlunge(): void {
    this.isAirPlunging = true;
    this.jumpVz = Math.min(this.jumpVz, -420);
  }

  private triggerAirPlungeImpact(): void {
    const range = 132 + (this.blastLevel - 1) * 10;
    this.spawnPlungeShockwave(range);
    this.onAttack({
      x: this.x,
      y: this.y,
      angle: this.facingAngle,
      range,
      halfArcRad: Math.PI,
      damage: Math.round(Phaser.Math.Between(210, 245) * this.damageMultiplier),
      knockback: 470,
      isWhirlwind: true,
      isComboExplosion: true,
      hitstopMs: 52,
      label: '강하 강타!',
    });
  }

  private performWhirlwindSlash(): void {
    this.whirlwindCooldownTimer = Math.max(1800, Math.round(this.whirlwindCooldownMs / (1 + (this.speedLevel - 1) * 0.08)));
    this.whirlwindSpinTimer = this.whirlwindSpinDurationMs;
    this.flashHit(100, 0x67e8f9);

    const range = 144 + this.weaponTier * 12;
    const damage = Math.round(Phaser.Math.Between(250, 295) * this.damageMultiplier);
    this.spawnWhirlwindEffect(range);

    this.onAttack({
      x: this.x,
      y: this.y,
      angle: this.facingAngle,
      range,
      halfArcRad: Math.PI,
      damage,
      knockback: 520,
      isWhirlwind: true,
      isComboExplosion: true,
      isCrit: true,
      hitstopMs: 55,
      label: '청룡 회오리!',
    });
  }

  private angleTo8DirFrame(radians: number): number {
    const wrapped = Phaser.Math.Angle.Wrap(radians);
    const sector = Math.round((wrapped / (Math.PI * 2)) * 8);
    return ((sector % 8) + 8) % 8;
  }

  private spawnThrustEffect(angle: number, range: number): void {
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y - 24);
    g.setDepth(this.y + 40);

    const endX = Math.cos(angle) * range;
    const endY = Math.sin(angle) * range;
    const startX = Math.cos(angle) * 20;
    const startY = Math.sin(angle) * 20;

    g.lineStyle(14, 0x06b6d4, 0.55);
    g.lineBetween(startX, startY, endX, endY);
    g.lineStyle(6, 0x67e8f9, 0.95);
    g.lineBetween(startX, startY, endX * 1.05, endY * 1.05);
    g.lineStyle(3, 0xffffff, 1);
    g.lineBetween(startX, startY, endX * 1.08, endY * 1.08);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 160,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private spawnAzureSlashEffect(
    angle: number,
    range: number,
    halfArc: number,
    swingDir: number,
    isFinisher = false,
  ): void {
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y - 22);
    g.setDepth(this.y + 40);

    const startA = angle - halfArc;
    const endA = angle + halfArc;

    g.lineStyle(isFinisher ? 24 : 18, isFinisher ? 0x0284c7 : 0x06b6d4, 0.58);
    g.beginPath();
    g.arc(0, 0, range * 0.74, startA, endA, false);
    g.strokePath();

    g.lineStyle(isFinisher ? 13 : 10, 0x22d3ee, 0.92);
    g.beginPath();
    g.arc(0, 0, range * 0.82, startA + 0.08, endA - 0.08, false);
    g.strokePath();

    g.lineStyle(5, 0xecfeff, 1);
    g.beginPath();
    g.arc(0, 0, range * 0.87, startA + 0.14, endA - 0.14, false);
    g.strokePath();

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: isFinisher ? 1.24 : 1.16,
      scaleY: isFinisher ? 1.24 : 1.16,
      rotation: swingDir * 0.28,
      duration: isFinisher ? 220 : 185,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private spawnWhirlwindEffect(range: number): void {
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y - 22);
    g.setDepth(this.y + 45);

    g.lineStyle(16, 0x06b6d4, 0.52);
    g.strokeCircle(0, 0, range * 0.76);
    g.lineStyle(8, 0x22d3ee, 0.92);
    g.strokeCircle(0, 0, range * 0.88);
    g.lineStyle(4, 0xecfeff, 0.98);
    g.beginPath();
    g.arc(0, 0, range * 0.64, 0, Math.PI * 1.55, false);
    g.strokePath();

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.24,
      scaleY: 1.24,
      rotation: Math.PI * 1.15,
      duration: 270,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private spawnPlungeShockwave(range: number): void {
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y);
    g.setDepth(this.y + 35);

    g.lineStyle(12, 0x38bdf8, 0.75);
    g.strokeEllipse(0, 0, range * 1.6, range * 0.9);
    g.lineStyle(4, 0xfef08a, 0.95);
    g.strokeEllipse(0, 0, range * 1.2, range * 0.68);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 240,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private spawnPerfectGuardShockwave(): void {
    const g = this.scene.add.graphics();
    g.setPosition(this.x, this.y - 20);
    g.setDepth(this.y + 48);

    g.lineStyle(10, 0xfbbf24, 0.85);
    g.strokeCircle(0, 0, 75);
    g.lineStyle(4, 0xffffff, 1);
    g.strokeCircle(0, 0, 58);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  private spawnDashAfterimage(): void {
    const ring = this.scene.add.circle(this.x, this.y - 18, 18, 0x38bdf8, 0.34);
    ring.setDepth(this.y - 2);
    this.scene.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 0.35,
      duration: 190,
      onComplete: () => ring.destroy(),
    });
  }

  private drawGuardAura(): void {
    this.guardAura.clear();
    if (!this.isGuarding) return;

    const isPerfectWindow = this.guardElapsedMs <= 240;
    const color = isPerfectWindow ? 0xfde047 : 0x38bdf8;
    const dirX = Math.cos(this.facingAngle) >= 0 ? 1 : -1;

    this.guardAura.lineStyle(5, color, 0.85);
    this.guardAura.beginPath();
    this.guardAura.arc(
      dirX * 16,
      -26,
      36,
      dirX > 0 ? -Math.PI * 0.42 : Math.PI * 0.58,
      dirX > 0 ? Math.PI * 0.42 : Math.PI * 1.42,
      false,
    );
    this.guardAura.strokePath();
  }

  private drawAimIndicator(): void {
    this.aimIndicator.clear();
    const dist = 36;
    const ax = this.x + Math.cos(this.facingAngle) * dist;
    const ay = this.y + Math.sin(this.facingAngle) * dist;

    this.aimIndicator.lineStyle(2, 0x22d3ee, 0.55);
    this.aimIndicator.beginPath();
    this.aimIndicator.arc(
      this.x,
      this.y + 2,
      26,
      this.facingAngle - 0.45,
      this.facingAngle + 0.45,
      false,
    );
    this.aimIndicator.strokePath();

    this.aimIndicator.fillStyle(0x67e8f9, 0.85);
    this.aimIndicator.fillCircle(ax, ay + 2, 3);
  }

  public destroy(): void {
    if (this.flashTimer) {
      this.flashTimer.remove(false);
    }
    this.aimIndicator.destroy();
    this.visual.destroy();
  }
}
