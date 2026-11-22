import Phaser from 'phaser';
import { Player } from './Player';
import { Structure } from './Structure';

export type EnemyArchetype = 'grunt' | 'shield' | 'raider' | 'boss';

export interface BanditConfig {
  x: number;
  y: number;
  wave: number;
  archetype: EnemyArchetype;
  level: number;
}

export interface BossSkillImpact {
  kind: 'slam' | 'charge';
  x: number;
  y: number;
  radius: number;
  damage: number;
  knockback: number;
}

const ARCHETYPE_FRAME: Record<EnemyArchetype, number> = {
  grunt: 0,
  shield: 1,
  raider: 2,
  boss: 3,
};

const ARCHETYPE_NAME: Record<EnemyArchetype, string> = {
  grunt: '산적',
  shield: '방패병',
  raider: '척후병',
  boss: '산적 대장',
};

/**
 * 2-head chibi enemy & boss entity rendered with `enemies_4types`.
 * Supports 4 distinct archetypes, visible enemy levels, crowd separation,
 * knockback physics, and telegraphed Boss Skills (Ground Slam & Warlord Charge).
 */
export class Bandit {
  public readonly scene: Phaser.Scene;
  public readonly archetype: EnemyArchetype;
  public readonly level: number;
  public readonly displayName: string;
  public readonly isBoss: boolean;
  public readonly collisionRadius: number;
  public readonly goldReward: number;
  public readonly expReward: number;

  public x: number;
  public y: number;
  public hp: number;
  public maxHp: number;
  public isDead = false;

  private readonly visual: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bossAura?: Phaser.GameObjects.Arc;
  private readonly baseScale: number;

  private readonly moveSpeed: number;
  private readonly attackDamage: number;
  private readonly attackCooldownMs: number;
  private readonly attackRange: number;
  private readonly kbResist: number;

  private facingAngle = 0;
  private attackTimer = 0;
  private hitStunTimer = 0;
  private walkPhase = Math.random() * Math.PI * 2;
  private knockbackVx = 0;
  private knockbackVy = 0;
  private flashTimer?: Phaser.Time.TimerEvent;

  // Boss Skill State Machine
  private skillCooldownTimer = 3400;
  private activeSkill: 'none' | 'slam_windup' | 'charge_windup' | 'charging' = 'none';
  private skillStateTimer = 0;
  private skillTargetAngle = 0;
  private chargeHitPlayer = false;
  private readonly telegraph: Phaser.GameObjects.Graphics;

  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly levelLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, config: BanditConfig) {
    this.scene = scene;
    this.x = config.x;
    this.y = config.y;
    this.archetype = config.archetype;
    this.level = config.level;
    this.isBoss = config.archetype === 'boss';
    this.displayName = `${ARCHETYPE_NAME[config.archetype]} Lv.${config.level}`;

    const lvScale = 1 + (config.level - 1) * 0.22;

    switch (this.archetype) {
      case 'grunt':
        this.maxHp = Math.round(250 * lvScale);
        this.moveSpeed = Phaser.Math.Between(92, 112);
        this.attackDamage = Math.round(10 * (1 + (config.level - 1) * 0.14));
        this.attackCooldownMs = 920;
        this.attackRange = 24;
        this.collisionRadius = 15;
        this.kbResist = 1.0;
        this.baseScale = 0.52;
        this.goldReward = 12 + config.level * 2;
        this.expReward = 18 + config.level * 4;
        break;
      case 'shield':
        this.maxHp = Math.round(520 * lvScale);
        this.moveSpeed = Phaser.Math.Between(74, 88);
        this.attackDamage = Math.round(16 * (1 + (config.level - 1) * 0.15));
        this.attackCooldownMs = 1100;
        this.attackRange = 26;
        this.collisionRadius = 18;
        this.kbResist = 0.48;
        this.baseScale = 0.58;
        this.goldReward = 24 + config.level * 3;
        this.expReward = 34 + config.level * 6;
        break;
      case 'raider':
        this.maxHp = Math.round(210 * lvScale);
        this.moveSpeed = Phaser.Math.Between(142, 166);
        this.attackDamage = Math.round(13 * (1 + (config.level - 1) * 0.14));
        this.attackCooldownMs = 640;
        this.attackRange = 22;
        this.collisionRadius = 14;
        this.kbResist = 1.15;
        this.baseScale = 0.52;
        this.goldReward = 20 + config.level * 3;
        this.expReward = 28 + config.level * 5;
        break;
      case 'boss':
        this.maxHp = Math.round(1950 * lvScale);
        this.moveSpeed = 84;
        this.attackDamage = Math.round(28 * (1 + (config.level - 1) * 0.15));
        this.attackCooldownMs = 1150;
        this.attackRange = 36;
        this.collisionRadius = 26;
        this.kbResist = 0.18;
        this.baseScale = 0.84;
        this.goldReward = 120 + config.level * 25;
        this.expReward = 160 + config.level * 30;
        break;
    }

    this.hp = this.maxHp;

    this.shadow = scene.add.ellipse(
      0,
      2,
      this.isBoss ? 66 : 38,
      this.isBoss ? 26 : 16,
      0x090b10,
      0.38,
    );

    const children: Phaser.GameObjects.GameObject[] = [this.shadow];

    if (this.isBoss) {
      this.bossAura = scene.add.circle(0, 2, 42, 0xdc2626, 0.18);
      this.bossAura.setStrokeStyle(2.5, 0xf97316, 0.8);
      this.bossAura.setScale(1, 0.52);
      children.push(this.bossAura);
    }

    this.sprite = scene.add.sprite(
      0,
      6,
      'enemies_4types',
      ARCHETYPE_FRAME[this.archetype],
    );
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setScale(this.baseScale);
    children.push(this.sprite);

    this.visual = scene.add.container(this.x, this.y, children);
    this.visual.setDepth(this.y);

    this.telegraph = scene.add.graphics();
    this.telegraph.setDepth(4);

    this.hpBar = scene.add.graphics();
    this.hpBar.setDepth(8500);

    const tagColor = this.isBoss
      ? '#fde047'
      : this.archetype === 'shield'
        ? '#cbd5e1'
        : this.archetype === 'raider'
          ? '#fca5a5'
          : '#e2e8f0';

    this.levelLabel = scene.add
      .text(this.x, this.y - this.getOverheadY() - 12, this.isBoss ? this.displayName : `Lv.${this.level}`, {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: this.isBoss ? '13px' : '11px',
        fontStyle: 'bold',
        color: tagColor,
        stroke: '#090b10',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(8501);
  }

  public update(
    dtMs: number,
    player: Player,
    castle: Structure,
    barricades: Structure[],
    allBandits: Bandit[],
    onStructureDamaged: (structure: Structure, damage: number) => void,
    onPlayerDamaged: (damage: number, kx: number, ky: number) => void,
    onBossSkillImpact: (impact: BossSkillImpact) => void,
    onBossShout: (x: number, y: number, text: string) => void,
  ): void {
    if (this.isDead) return;

    const dt = dtMs / 1000;
    if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dtMs);
    if (this.hitStunTimer > 0) this.hitStunTimer = Math.max(0, this.hitStunTimer - dtMs);
    if (this.bossAura) {
      const p = 1 + Math.sin(this.scene.time.now * 0.006) * 0.08;
      this.bossAura.setScale(p, p * 0.52);
    }

    // Handle active Boss Skill state machine
    if (this.isBoss && this.updateBossSkill(dtMs, dt, player, castle, barricades, onBossSkillImpact, onBossShout)) {
      this.syncVisuals(dt, false);
      return;
    }

    const target = this.selectTarget(player, castle, barricades);
    let vx = 0;
    let vy = 0;
    let isMoving = false;

    if (this.hitStunTimer <= 0 && target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const stopDist = target.radius + this.collisionRadius + this.attackRange;
      this.facingAngle = Math.atan2(dy, dx);

      // Boss decides to unleash a skill periodically
      if (this.isBoss && this.skillCooldownTimer <= 0 && dist < 260) {
        this.startBossSkill(player, target, dist, onBossShout);
        this.syncVisuals(dt, false);
        return;
      }

      if (dist > stopDist) {
        vx = (dx / (dist || 1)) * this.moveSpeed;
        vy = (dy / (dist || 1)) * this.moveSpeed;
        isMoving = true;
      } else if (this.attackTimer <= 0) {
        this.performAttack(target, onStructureDamaged, onPlayerDamaged);
      }
    }

    if (this.isBoss && this.skillCooldownTimer > 0) {
      this.skillCooldownTimer = Math.max(0, this.skillCooldownTimer - dtMs);
    }

    // Crowd separation
    let sepX = 0;
    let sepY = 0;
    const sepRadius = this.collisionRadius * 2.1;
    for (let i = 0; i < allBandits.length; i++) {
      const other = allBandits[i];
      if (other === this || other.isDead) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > 0.01 && dSq < sepRadius * sepRadius) {
        const d = Math.sqrt(dSq);
        const push = (sepRadius - d) / sepRadius;
        sepX += (dx / d) * push * 95;
        sepY += (dy / d) * push * 95;
      }
    }

    this.x += (vx + sepX + this.knockbackVx) * dt;
    this.y += (vy + sepY + this.knockbackVy) * dt;

    this.pushOutOfStructure(castle);
    for (let i = 0; i < barricades.length; i++) {
      if (!barricades[i].isDestroyed) {
        this.pushOutOfStructure(barricades[i]);
      }
    }

    // Knockback damping
    const damp = Math.exp(-8.5 * dt);
    this.knockbackVx *= damp;
    this.knockbackVy *= damp;
    if (Math.hypot(this.knockbackVx, this.knockbackVy) < 5) {
      this.knockbackVx = 0;
      this.knockbackVy = 0;
    }

    this.syncVisuals(dt, isMoving);
  }

  public takeDamage(amount: number, knockbackVx: number, knockbackVy: number): boolean {
    if (this.isDead) return false;

    this.hp = Math.max(0, this.hp - amount);
    this.flashHit(80, 0xffffff);

    this.knockbackVx += knockbackVx * this.kbResist;
    this.knockbackVy += knockbackVy * this.kbResist;
    if (!this.isBoss || this.activeSkill === 'none') {
      this.hitStunTimer = this.isBoss ? 55 : this.archetype === 'shield' ? 110 : 175;
    }

    if (this.hp <= 0) {
      this.isDead = true;
      this.telegraph.clear();
      this.hpBar.clear();
      this.levelLabel.setVisible(false);
      return true;
    }

    this.redrawHpBar();
    return false;
  }

  private flashHit(durationMs: number, color: number): void {
    this.sprite.setTintFill(color);
    if (this.flashTimer) this.flashTimer.remove(false);
    this.flashTimer = this.scene.time.delayedCall(durationMs, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
  }

  private startBossSkill(
    player: Player,
    target: { x: number; y: number },
    dist: number,
    onBossShout: (x: number, y: number, text: string) => void,
  ): void {
    this.skillCooldownTimer = 5200;
    this.chargeHitPlayer = false;

    // Close range -> Ground Slam; mid range -> Warlord Charge!
    if (dist < 135 || Math.random() < 0.5) {
      this.activeSkill = 'slam_windup';
      this.skillStateTimer = 850;
      this.flashHit(140, 0xf97316);
      onBossShout(this.x, this.y - 108, '대지 강타!!');
    } else {
      this.activeSkill = 'charge_windup';
      this.skillStateTimer = 760;
      this.skillTargetAngle = Phaser.Math.Angle.Between(
        this.x,
        this.y,
        player.hp > 0 ? player.x : target.x,
        player.hp > 0 ? player.y : target.y,
      );
      this.facingAngle = this.skillTargetAngle;
      this.flashHit(140, 0xef4444);
      onBossShout(this.x, this.y - 108, '맹돌진!!');
    }
  }

  private updateBossSkill(
    dtMs: number,
    dt: number,
    player: Player,
    castle: Structure,
    barricades: Structure[],
    onBossSkillImpact: (impact: BossSkillImpact) => void,
    _onBossShout: (x: number, y: number, text: string) => void,
  ): boolean {
    if (this.activeSkill === 'none') return false;

    this.skillStateTimer -= dtMs;
    this.telegraph.clear();

    if (this.activeSkill === 'slam_windup') {
      const progress = Phaser.Math.Clamp(1 - this.skillStateTimer / 850, 0, 1);
      const radius = 132;
      // Expanding red-orange danger telegraph ring
      this.telegraph.lineStyle(3, 0xef4444, 0.9);
      this.telegraph.strokeCircle(this.x, this.y, radius);
      this.telegraph.fillStyle(0xf97316, 0.16 + progress * 0.2);
      this.telegraph.fillCircle(this.x, this.y, radius * progress);

      // Boss rises slightly before slamming down
      this.sprite.y = 6 - Math.sin(progress * Math.PI) * 28;

      if (this.skillStateTimer <= 0) {
        this.sprite.y = 6;
        this.activeSkill = 'none';
        onBossSkillImpact({
          kind: 'slam',
          x: this.x,
          y: this.y,
          radius,
          damage: Math.round(this.attackDamage * 1.65),
          knockback: 420,
        });
      }
      return true;
    }

    if (this.activeSkill === 'charge_windup') {
      const len = 250;
      const ex = this.x + Math.cos(this.skillTargetAngle) * len;
      const ey = this.y + Math.sin(this.skillTargetAngle) * len;
      this.telegraph.lineStyle(34, 0xef4444, 0.25);
      this.telegraph.lineBetween(this.x, this.y, ex, ey);
      this.telegraph.lineStyle(3, 0xfde047, 0.85);
      this.telegraph.lineBetween(this.x, this.y, ex, ey);

      if (this.skillStateTimer <= 0) {
        this.activeSkill = 'charging';
        this.skillStateTimer = 460;
      }
      return true;
    }

    if (this.activeSkill === 'charging') {
      const chargeSpeed = 520;
      this.x = Phaser.Math.Clamp(
        this.x + Math.cos(this.skillTargetAngle) * chargeSpeed * dt,
        40,
        1240,
      );
      this.y = Phaser.Math.Clamp(
        this.y + Math.sin(this.skillTargetAngle) * chargeSpeed * dt,
        90,
        680,
      );

      // Blazing trail during charge
      if (Math.random() < 0.7) {
        const ring = this.scene.add.circle(this.x, this.y - 18, 22, 0xf97316, 0.35);
        ring.setDepth(this.y - 2);
        this.scene.tweens.add({
          targets: ring,
          alpha: 0,
          scale: 0.3,
          duration: 200,
          onComplete: () => ring.destroy(),
        });
      }

      // Check collision with player during charge
      if (
        !this.chargeHitPlayer &&
        Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y) < 52
      ) {
        this.chargeHitPlayer = true;
        onBossSkillImpact({
          kind: 'charge',
          x: this.x,
          y: this.y,
          radius: 62,
          damage: Math.round(this.attackDamage * 1.4),
          knockback: 460,
        });
      }

      this.pushOutOfStructure(castle);
      for (let i = 0; i < barricades.length; i++) {
        if (!barricades[i].isDestroyed) {
          this.pushOutOfStructure(barricades[i]);
        }
      }

      if (this.skillStateTimer <= 0) {
        this.activeSkill = 'none';
      }
      return true;
    }

    return false;
  }

  private syncVisuals(dt: number, isMoving: boolean): void {
    const facingLeft = Math.cos(this.facingAngle) < -0.05;
    this.sprite.setFlipX(facingLeft);

    const kbSpeed = Math.hypot(this.knockbackVx, this.knockbackVy);
    if (this.activeSkill !== 'slam_windup') {
      if (kbSpeed > 35) {
        this.sprite.y = 6 - Math.min(14, kbSpeed * 0.032);
        this.sprite.rotation = facingLeft ? 0.14 : -0.14;
      } else if (isMoving) {
        this.walkPhase += dt * (this.archetype === 'raider' ? 14 : this.isBoss ? 8 : 11);
        const tilt = Math.sin(this.walkPhase) * 0.08;
        this.sprite.rotation = tilt;
        this.sprite.y = 6 - Math.abs(Math.sin(this.walkPhase)) * 2.5;
      } else {
        this.sprite.rotation = Phaser.Math.Linear(this.sprite.rotation, 0, 0.25);
        this.sprite.y = Phaser.Math.Linear(this.sprite.y, 6, 0.25);
      }
    }

    this.visual.setPosition(this.x, this.y);
    this.visual.setDepth(this.y);
    this.levelLabel.setPosition(this.x, this.y - this.getOverheadY() - 11);
    this.redrawHpBar();
  }

  private selectTarget(
    player: Player,
    castle: Structure,
    barricades: Structure[],
  ): { kind: 'player' | 'structure'; x: number; y: number; radius: number; structure?: Structure } | null {
    // Raiders aggressively hunt Zhao Yun from farther away
    const aggroRange = this.archetype === 'raider' ? 230 : this.isBoss ? 190 : 140;
    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (player.hp > 0 && distToPlayer < aggroRange) {
      return {
        kind: 'player',
        x: player.x,
        y: player.y,
        radius: player.collisionRadius,
      };
    }

    // Attack any intact barricade close to the bandit or blocking its route
    let closestBarricade: Structure | null = null;
    let closestBarricadeDist = Infinity;
    const distToCastle = Phaser.Math.Distance.Between(this.x, this.y, castle.x, castle.y);

    for (let i = 0; i < barricades.length; i++) {
      const b = barricades[i];
      if (b.isDestroyed) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y);
      if (d < 135 && d < distToCastle + 40 && d < closestBarricadeDist) {
        closestBarricade = b;
        closestBarricadeDist = d;
      }
    }

    if (closestBarricade) {
      return {
        kind: 'structure',
        x: closestBarricade.x,
        y: closestBarricade.y,
        radius: closestBarricade.collisionRadius,
        structure: closestBarricade,
      };
    }

    if (!castle.isDestroyed) {
      return {
        kind: 'structure',
        x: castle.x,
        y: castle.y,
        radius: castle.collisionRadius,
        structure: castle,
      };
    }

    return null;
  }

  private performAttack(
    target: { kind: 'player' | 'structure'; x: number; y: number; radius: number; structure?: Structure },
    onStructureDamaged: (structure: Structure, damage: number) => void,
    onPlayerDamaged: (damage: number, kx: number, ky: number) => void,
  ): void {
    this.attackTimer = this.attackCooldownMs;

    const lx = Math.cos(this.facingAngle) * 7;
    const ly = Math.sin(this.facingAngle) * 7;
    this.visual.setPosition(this.x + lx, this.y + ly);

    if (target.kind === 'player') {
      const kx = Math.cos(this.facingAngle) * (this.isBoss ? 280 : 180);
      const ky = Math.sin(this.facingAngle) * (this.isBoss ? 280 : 180);
      onPlayerDamaged(this.attackDamage, kx, ky);
    } else if (target.structure) {
      onStructureDamaged(target.structure, this.attackDamage);
    }
  }

  private pushOutOfStructure(structure: Structure): void {
    const dx = this.x - structure.x;
    const dy = this.y - structure.y;
    const dist = Math.hypot(dx, dy);
    const minDist = structure.collisionRadius + this.collisionRadius;
    if (dist > 0.001 && dist < minDist) {
      const overlap = minDist - dist;
      this.x += (dx / dist) * overlap;
      this.y += (dy / dist) * overlap;
    }
  }

  private getOverheadY(): number {
    return this.isBoss ? 106 : 68;
  }

  private redrawHpBar(): void {
    this.hpBar.clear();
    if (this.isDead) return;
    if (!this.isBoss && this.hp >= this.maxHp) return;

    const w = this.isBoss ? 64 : this.archetype === 'shield' ? 38 : 30;
    const h = this.isBoss ? 6 : 4;
    const bx = this.x - w / 2;
    const by = this.y - this.getOverheadY();
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);

    this.hpBar.fillStyle(0x090b10, 0.88);
    this.hpBar.fillRect(bx - 1, by - 1, w + 2, h + 2);
    this.hpBar.fillStyle(
      this.isBoss ? 0xf97316 : this.archetype === 'shield' ? 0xf59e0b : 0xef4444,
      1,
    );
    this.hpBar.fillRect(bx, by, Math.round(w * ratio), h);
  }

  public destroy(): void {
    if (this.flashTimer) this.flashTimer.remove(false);
    this.telegraph.destroy();
    this.hpBar.destroy();
    this.levelLabel.destroy();
    this.visual.destroy();
  }
}
