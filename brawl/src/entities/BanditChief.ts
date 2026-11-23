import Phaser from 'phaser';
import { PERSPECTIVE_CONFIG } from '../config/arenaConfig';
import { CombatHitTracker } from '../core/CombatMath';
import {
  clampToArena,
  getDepthOrder,
  getDepthSpeedFactor,
  getPerspectiveScale,
  Point2D,
} from '../core/Perspective';

export type BossPhase = 'INTRO' | 'BASIC' | 'ENRAGED' | 'DEFEATED';

export type BossActionState =
  | 'INTRO_MARCH'
  | 'INTRO_SHOUT'
  | 'APPROACH'
  | 'CLUB_WINDUP'
  | 'CLUB_ACTIVE'
  | 'SLAM_WINDUP'
  | 'SLAM_ACTIVE'
  | 'RUSH_WINDUP'
  | 'RUSH_ACTIVE'
  | 'RALLY_SHOUT'
  | 'RECOVERY'
  | 'STAGGERED'
  | 'DEFEATED_LAUNCH'
  | 'DEFEATED_KO';

export interface BossCallbacks {
  onHeavyStep: (boss: BanditChief) => void;
  onRoar: (boss: BanditChief, textKr: string) => void;
  onClubSwing: (boss: BanditChief) => void;
  onGroundSlam: (boss: BanditChief, radius: number) => void;
  onRushStart: (boss: BanditChief) => void;
  onRallyBandits: (boss: BanditChief) => void;
  onEnraged: (boss: BanditChief) => void;
  onStaggered: (boss: BanditChief) => void;
  onHitHero: (heroId: string, damage: number, dirX: number, dirY: number, heavy: boolean) => void;
  onAccidentalBanditHit: (boss: BanditChief, radius: number, dirX: number, dirY: number) => void;
  onSmashEnvironment: (boss: BanditChief, radius: number) => void;
  onAttackDodged: () => void;
  onDefeated: (boss: BanditChief) => void;
}

export interface BossTargetHero {
  id: string;
  x: number;
  y: number;
  isDefeated: boolean;
}

const BOSS_FRAME = {
  IDLE: 0,
  WALK_A: 1,
  WALK_B: 2,
  WINDUP: 3,
  SLAM: 4,
  RUSH: 5,
  ROAR: 6,
  KO: 7,
} as const;

/**
 * Stage 1 Boss: 산적 두목 (Bandit Chief).
 * Powerful, hilarious, telegraphed arcade boss who smashes tables,
 * accidentally bonks his own bandits, and can be staggered by environmental impacts!
 */
export class BanditChief {
  public readonly id = 'boss_bandit_chief';
  public readonly nameKr = '산적 두목';
  public readonly collisionRadius = 42;
  public readonly container: Phaser.GameObjects.Container;
  public readonly hitTracker = new CombatHitTracker();

  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public vx = 0;
  public vy = 0;
  public elevationZ = 0;
  public vz = 0;

  public maxHp: number;
  public hp: number;
  public phase: BossPhase = 'INTRO';
  public state: BossActionState = 'INTRO_MARCH';
  public isEnraged = false;
  public facingDirX = 1;

  private readonly scene: Phaser.Scene;
  private readonly callbacks: BossCallbacks;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly rageAura: Phaser.GameObjects.Graphics;
  private readonly telegraphGfx: Phaser.GameObjects.Graphics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shoutText: Phaser.GameObjects.Text;

  private stateTimerMs = 0;
  private attackCooldownMs = 950;
  private rallyCooldownMs = 9500;
  private stepTimerMs = 0;
  private walkPhase = 0;
  private flashTimerMs = 0;
  private attackDirX = 0;
  private attackDirY = 1;
  private currentAttackHitAnyHero = false;
  private patternIndex = 0;
  private defeatTriggered = false;

  constructor(
    scene: Phaser.Scene,
    spawnX: number,
    spawnY: number,
    maxHp: number,
    callbacks: BossCallbacks,
  ) {
    this.scene = scene;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.callbacks = callbacks;

    this.shadow = scene.add.ellipse(0, 6, 94, 28, 0x1c120c, 0.48);
    this.rageAura = scene.add.graphics().setVisible(false);
    this.telegraphGfx = scene.add.graphics().setVisible(false);

    this.sprite = scene.add.sprite(0, 10, 'boss_chief_sheet', BOSS_FRAME.IDLE);
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(0.90);

    this.shoutText = scene.add
      .text(0, -148, '', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fef08a',
        backgroundColor: 'rgba(127, 29, 29, 0.88)',
        padding: { x: 8, y: 4 },
        stroke: '#1c120c',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.container = scene.add.container(this.x, this.y, [
      this.shadow,
      this.rageAura,
      this.telegraphGfx,
      this.sprite,
      this.shoutText,
    ]);

    this.syncVisuals();
  }

  public get isAlive(): boolean {
    return this.phase !== 'DEFEATED' && this.hp > 0;
  }

  public get hpRatio(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }

  public forcePhase(target: 'BASIC' | 'ENRAGED'): void {
    if (!this.isAlive) return;
    if (target === 'ENRAGED') {
      this.hp = Math.min(this.hp, Math.round(this.maxHp * 0.38));
      this.enterEnraged();
    } else {
      this.phase = 'BASIC';
      this.isEnraged = false;
      this.rageAura.setVisible(false);
      this.state = 'APPROACH';
    }
  }

  public applyHit(
    damage: number,
    dirX: number,
    dirY: number,
    knockbackForce: number,
    isEnvironmentalHeavy = false,
  ): { appliedDamage: number; staggered: boolean; defeated: boolean } {
    if (!this.isAlive) {
      return { appliedDamage: 0, staggered: false, defeated: false };
    }

    const appliedDamage = Math.max(1, Math.round(damage));
    this.hp = Math.max(0, this.hp - appliedDamage);
    this.flashTimerMs = 110;

    // Slight recoil even when super-armored
    this.vx += dirX * knockbackForce * (isEnvironmentalHeavy ? 0.45 : 0.14);
    this.vy += dirY * knockbackForce * (isEnvironmentalHeavy ? 0.25 : 0.08);

    // Check Boss Defeat
    if (this.hp <= 0) {
      this.phase = 'DEFEATED';
      this.state = 'DEFEATED_LAUNCH';
      this.stateTimerMs = 0;
      this.telegraphGfx.setVisible(false);
      this.rageAura.setVisible(false);
      this.vx = (dirX || -this.facingDirX) * 420;
      this.vy = (dirY || -0.25) * 160;
      this.vz = 390;
      this.showShout('으아아악!! 내 몽둥이가~!!', 2200);
      return { appliedDamage, staggered: true, defeated: true };
    }

    // Check Phase C Enrage threshold (<= 40% HP)
    if (!this.isEnraged && this.hp <= this.maxHp * 0.4) {
      this.enterEnraged();
    }

    // Boss can be staggered by strong environmental hits (thrown tables/barrels) or massive force!
    let staggered = false;
    if (
      (isEnvironmentalHeavy || knockbackForce >= 460) &&
      this.state !== 'STAGGERED' &&
      this.state !== 'INTRO_MARCH' &&
      this.state !== 'INTRO_SHOUT'
    ) {
      staggered = true;
      this.state = 'STAGGERED';
      this.stateTimerMs = 0;
      this.telegraphGfx.setVisible(false);
      this.showShout('어이쿠!! 테이블이 왜 날아와?!', 1100);
      this.callbacks.onStaggered(this);
    }

    return { appliedDamage, staggered, defeated: false };
  }

  public update(
    deltaMs: number,
    heroes: readonly BossTargetHero[],
    resolveProps: (x: number, y: number, r: number) => Point2D,
  ): void {
    const dt = Math.min(deltaMs, 50) * 0.001;
    this.prevX = this.x;
    this.prevY = this.y;
    this.stateTimerMs += Math.min(deltaMs, 50);

    if (this.flashTimerMs > 0) {
      this.flashTimerMs = Math.max(0, this.flashTimerMs - deltaMs);
    }
    if (this.attackCooldownMs > 0) {
      this.attackCooldownMs = Math.max(0, this.attackCooldownMs - deltaMs);
    }
    if (this.rallyCooldownMs > 0) {
      this.rallyCooldownMs = Math.max(0, this.rallyCooldownMs - deltaMs);
    }

    // Friction on residual velocity
    this.vx *= Math.pow(0.08, dt);
    this.vy *= Math.pow(0.08, dt);

    const target = this.pickNearestHero(heroes);

    switch (this.state) {
      case 'INTRO_MARCH': {
        this.y += 120 * dt;
        this.walkPhase += dt * 7;
        this.stepTimerMs += deltaMs;
        if (this.stepTimerMs >= 320) {
          this.stepTimerMs = 0;
          this.callbacks.onHeavyStep(this);
        }
        this.sprite.setFrame(Math.floor(this.walkPhase) % 2 === 0 ? BOSS_FRAME.WALK_A : BOSS_FRAME.WALK_B);
        if (this.y >= 340 || this.stateTimerMs >= 1100) {
          this.state = 'INTRO_SHOUT';
          this.stateTimerMs = 0;
          this.sprite.setFrame(BOSS_FRAME.ROAR);
          this.showShout('감히 내 구역에서 난장판을 쳐?! 다 밟아주마!', 1600);
          this.callbacks.onRoar(this, '감히 내 구역에서 난장판을 쳐?!');
        }
        break;
      }

      case 'INTRO_SHOUT': {
        this.sprite.setFrame(BOSS_FRAME.ROAR);
        if (this.stateTimerMs >= 1150) {
          this.phase = 'BASIC';
          this.state = 'APPROACH';
          this.stateTimerMs = 0;
          this.attackCooldownMs = 650;
        }
        break;
      }

      case 'APPROACH': {
        if (!target) {
          this.sprite.setFrame(BOSS_FRAME.IDLE);
          break;
        }
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy * 1.35);
        this.facingDirX = dx >= 0 ? 1 : -1;

        const moveSpeed = (this.isEnraged ? 168 : 132) * getDepthSpeedFactor(this.y);
        if (dist > 95) {
          const nx = dx / (Math.hypot(dx, dy) || 1);
          const ny = dy / (Math.hypot(dx, dy) || 1);
          this.x += nx * moveSpeed * dt;
          this.y += ny * moveSpeed * PERSPECTIVE_CONFIG.verticalMoveRatio * dt;
          this.walkPhase += dt * (this.isEnraged ? 9 : 7);
          this.sprite.setFrame(Math.floor(this.walkPhase) % 2 === 0 ? BOSS_FRAME.WALK_A : BOSS_FRAME.WALK_B);
          this.stepTimerMs += deltaMs;
          if (this.stepTimerMs >= 380) {
            this.stepTimerMs = 0;
            this.callbacks.onHeavyStep(this);
          }
          // Boss smashes crates/jars just by stomping through
          this.callbacks.onSmashEnvironment(this, 56);
        } else {
          this.sprite.setFrame(BOSS_FRAME.IDLE);
        }

        if (this.attackCooldownMs <= 0) {
          this.chooseNextAttack(target, dist);
        }
        break;
      }

      case 'CLUB_WINDUP': {
        this.sprite.setFrame(BOSS_FRAME.WINDUP);
        this.drawTelegraphCircle(this.attackDirX * 72, this.attackDirY * 32, 96, 0xef4444);
        const dur = this.isEnraged ? 480 : 620;
        if (this.stateTimerMs >= dur) {
          this.state = 'CLUB_ACTIVE';
          this.stateTimerMs = 0;
          this.currentAttackHitAnyHero = false;
          this.hitTracker.beginAttack();
          this.telegraphGfx.setVisible(false);
          this.sprite.setFrame(BOSS_FRAME.SLAM);
          this.callbacks.onClubSwing(this);
          this.callbacks.onSmashEnvironment(this, 128);
          this.callbacks.onAccidentalBanditHit(this, 120, this.attackDirX, this.attackDirY);
          this.checkMeleeHits(heroes, 126, 22, true);
        }
        break;
      }

      case 'CLUB_ACTIVE': {
        this.sprite.setFrame(BOSS_FRAME.SLAM);
        this.checkMeleeHits(heroes, 126, 22, true);
        if (this.stateTimerMs >= 210) {
          if (!this.currentAttackHitAnyHero) this.callbacks.onAttackDodged();
          this.enterRecovery(this.isEnraged ? 420 : 620);
        }
        break;
      }

      case 'SLAM_WINDUP': {
        this.sprite.setFrame(BOSS_FRAME.WINDUP);
        const radius = this.isEnraged ? 175 : 150;
        this.drawTelegraphCircle(0, 0, radius, 0xf97316);
        const dur = this.isEnraged ? 600 : 760;
        if (this.stateTimerMs >= dur) {
          this.state = 'SLAM_ACTIVE';
          this.stateTimerMs = 0;
          this.currentAttackHitAnyHero = false;
          this.hitTracker.beginAttack();
          this.telegraphGfx.setVisible(false);
          this.sprite.setFrame(BOSS_FRAME.SLAM);
          this.callbacks.onGroundSlam(this, radius);
          this.callbacks.onSmashEnvironment(this, radius);
          this.callbacks.onAccidentalBanditHit(this, radius, 0, 0);
          this.checkSlamHits(heroes, radius, this.isEnraged ? 28 : 24);
        }
        break;
      }

      case 'SLAM_ACTIVE': {
        this.sprite.setFrame(BOSS_FRAME.SLAM);
        if (this.stateTimerMs >= 260) {
          if (!this.currentAttackHitAnyHero) this.callbacks.onAttackDodged();
          this.enterRecovery(this.isEnraged ? 520 : 760);
        }
        break;
      }

      case 'RUSH_WINDUP': {
        this.sprite.setFrame(BOSS_FRAME.ROAR);
        this.drawTelegraphLine(this.attackDirX * 260, this.attackDirY * 140, 0xef4444);
        const dur = this.isEnraged ? 500 : 660;
        if (this.stateTimerMs >= dur) {
          this.state = 'RUSH_ACTIVE';
          this.stateTimerMs = 0;
          this.currentAttackHitAnyHero = false;
          this.hitTracker.beginAttack();
          this.telegraphGfx.setVisible(false);
          this.callbacks.onRushStart(this);
        }
        break;
      }

      case 'RUSH_ACTIVE': {
        this.sprite.setFrame(BOSS_FRAME.RUSH);
        const rushSpeed = this.isEnraged ? 520 : 440;
        this.x += this.attackDirX * rushSpeed * dt;
        this.y += this.attackDirY * rushSpeed * PERSPECTIVE_CONFIG.verticalMoveRatio * dt;
        this.callbacks.onSmashEnvironment(this, 82);
        this.callbacks.onAccidentalBanditHit(this, 82, this.attackDirX, this.attackDirY);
        this.checkSlamHits(heroes, 76, 20);
        if (this.stateTimerMs >= (this.isEnraged ? 580 : 520)) {
          if (!this.currentAttackHitAnyHero) this.callbacks.onAttackDodged();
          this.enterRecovery(this.isEnraged ? 560 : 780);
        }
        break;
      }

      case 'RALLY_SHOUT': {
        this.sprite.setFrame(BOSS_FRAME.ROAR);
        if (this.stateTimerMs >= 720) {
          this.enterRecovery(420);
        }
        break;
      }

      case 'RECOVERY': {
        this.sprite.setFrame(BOSS_FRAME.IDLE);
        if (this.stateTimerMs >= 520) {
          this.state = 'APPROACH';
          this.stateTimerMs = 0;
          this.attackCooldownMs = this.isEnraged ? 480 : 820;
        }
        break;
      }

      case 'STAGGERED': {
        this.sprite.setFrame(BOSS_FRAME.KO);
        if (this.stateTimerMs >= 1150) {
          this.state = 'APPROACH';
          this.stateTimerMs = 0;
          this.attackCooldownMs = 600;
        }
        break;
      }

      case 'DEFEATED_LAUNCH': {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.elevationZ += this.vz * dt;
        this.vz -= 1100 * dt;
        this.sprite.setFrame(BOSS_FRAME.KO);
        if (this.elevationZ <= 0) {
          this.elevationZ = 0;
          this.vz = 0;
          this.vx = 0;
          this.vy = 0;
          this.state = 'DEFEATED_KO';
          this.stateTimerMs = 0;
          if (!this.defeatTriggered) {
            this.defeatTriggered = true;
            this.callbacks.onDefeated(this);
          }
        }
        break;
      }

      case 'DEFEATED_KO': {
        this.sprite.setFrame(BOSS_FRAME.KO);
        break;
      }
    }

    // Apply residual knockback + arena clamping
    if (this.state !== 'DEFEATED_KO') {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const clamped = clampToArena(this.x, this.y, 38);
      this.x = clamped.x;
      this.y = clamped.y;
      if (this.state !== 'RUSH_ACTIVE' && this.state !== 'DEFEATED_LAUNCH') {
        const resolved = resolveProps(this.x, this.y, this.collisionRadius);
        this.x = resolved.x;
        this.y = resolved.y;
      }
    }

    this.syncVisuals();
  }

  private chooseNextAttack(target: BossTargetHero, dist: number): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    this.attackDirX = dx / len;
    this.attackDirY = dy / len;
    this.facingDirX = this.attackDirX >= 0 ? 1 : -1;

    if (this.rallyCooldownMs <= 0) {
      this.rallyCooldownMs = this.isEnraged ? 11000 : 14000;
      this.state = 'RALLY_SHOUT';
      this.stateTimerMs = 0;
      this.showShout('이놈들아! 두목님이 간다! 모여라!', 1300);
      this.callbacks.onRallyBandits(this);
      return;
    }

    this.patternIndex = (this.patternIndex + 1) % 3;
    if (dist > 220 || this.patternIndex === 2) {
      this.state = 'RUSH_WINDUP';
      this.showShout('돌격이다!!', 650);
    } else if (this.patternIndex === 1) {
      this.state = 'SLAM_WINDUP';
      this.showShout('납작하게 만들어주마!', 750);
    } else {
      this.state = 'CLUB_WINDUP';
    }
    this.stateTimerMs = 0;
  }

  private enterEnraged(): void {
    this.isEnraged = true;
    this.phase = 'ENRAGED';
    this.rageAura.setVisible(true);
    this.showShout('으아아!! 진짜 화났다!! 다 박살내주마!!', 1700);
    this.callbacks.onEnraged(this);
  }

  private enterRecovery(ms: number): void {
    this.state = 'RECOVERY';
    this.stateTimerMs = 0;
    this.attackCooldownMs = ms;
  }

  private checkMeleeHits(
    heroes: readonly BossTargetHero[],
    radius: number,
    damage: number,
    heavy: boolean,
  ): void {
    const cx = this.x + this.attackDirX * 64;
    const cy = this.y + this.attackDirY * 28;
    for (const h of heroes) {
      if (h.isDefeated) continue;
      if (!this.hitTracker.canHit(h.id)) continue;
      const d = Math.hypot(h.x - cx, (h.y - cy) * 1.45);
      if (d <= radius) {
        this.hitTracker.recordHit(h.id);
        this.currentAttackHitAnyHero = true;
        this.callbacks.onHitHero(h.id, damage, this.attackDirX, this.attackDirY, heavy);
      }
    }
  }

  private checkSlamHits(
    heroes: readonly BossTargetHero[],
    radius: number,
    damage: number,
  ): void {
    for (const h of heroes) {
      if (h.isDefeated) continue;
      if (!this.hitTracker.canHit(h.id)) continue;
      const d = Math.hypot(h.x - this.x, (h.y - this.y) * 1.45);
      if (d <= radius) {
        this.hitTracker.recordHit(h.id);
        this.currentAttackHitAnyHero = true;
        const dx = h.x - this.x;
        const dy = h.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        this.callbacks.onHitHero(h.id, damage, dx / len, dy / len, true);
      }
    }
  }

  private pickNearestHero(heroes: readonly BossTargetHero[]): BossTargetHero | null {
    let best: BossTargetHero | null = null;
    let bestDist = Infinity;
    for (const h of heroes) {
      if (h.isDefeated) continue;
      const d = Math.hypot(h.x - this.x, h.y - this.y);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    return best;
  }

  private showShout(_msg: string, _durationMs: number): void {
    // Visual telegraphs & boss animations speak clearly without overhead Korean text clutter
    this.shoutText.setVisible(false);
  }

  private drawTelegraphCircle(ox: number, oy: number, radius: number, color: number): void {
    this.telegraphGfx.clear().setVisible(true);
    this.telegraphGfx.fillStyle(color, 0.22);
    this.telegraphGfx.fillEllipse(ox, oy + 4, radius * 2, radius * 1.2);
    this.telegraphGfx.lineStyle(3, color, 0.85);
    this.telegraphGfx.strokeEllipse(ox, oy + 4, radius * 2, radius * 1.2);
  }

  private drawTelegraphLine(tx: number, ty: number, color: number): void {
    this.telegraphGfx.clear().setVisible(true);
    this.telegraphGfx.lineStyle(26, color, 0.24);
    this.telegraphGfx.lineBetween(0, 0, tx, ty);
    this.telegraphGfx.lineStyle(3, color, 0.85);
    this.telegraphGfx.lineBetween(0, 0, tx, ty);
  }

  private syncVisuals(): void {
    const scale = getPerspectiveScale(this.y);
    this.container.setPosition(this.x, this.y);
    this.container.setScale(scale);
    this.container.setDepth(getDepthOrder(this.y) + 2);
    this.sprite.setY(10 - this.elevationZ);
    this.sprite.setFlipX(this.facingDirX < 0);

    if (this.flashTimerMs > 0) {
      this.sprite.setTintFill(0xffffff);
    } else if (this.isEnraged) {
      this.sprite.setTint(0xfca5a5);
    } else {
      this.sprite.clearTint();
    }

    if (this.isEnraged && this.isAlive) {
      this.rageAura.clear();
      const pulse = 0.45 + Math.sin(this.stateTimerMs * 0.015) * 0.25;
      this.rageAura.lineStyle(4, 0xef4444, pulse);
      this.rageAura.strokeEllipse(0, 6, 118, 42);
    }
  }

  public destroy(): void {
    this.container.destroy(true);
  }
}
