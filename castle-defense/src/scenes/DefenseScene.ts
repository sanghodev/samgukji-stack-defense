import Phaser from 'phaser';
import { Player, SlashAttackEvent } from '../entities/Player';
import { Bandit, BossSkillImpact, EnemyArchetype } from '../entities/Bandit';
import { Structure } from '../entities/Structure';
import { TreasureDrop, TreasureKind } from '../entities/TreasureDrop';

export interface DefenseHudState {
  castleHp: number;
  castleMaxHp: number;
  playerHp: number;
  playerMaxHp: number;
  playerLevel: number;
  playerFormName: string;
  playerExp: number;
  playerExpToNext: number;
  weaponTierName: string;
  skillTier: 1 | 2 | 3;
  skillDisplayName: string;
  speedLevel: number;
  blastLevel: number;
  skillReadyRatio: number;
  comboCount: number;
  bossName: string;
  bossHp: number;
  bossMaxHp: number;
  wave: number;
  maxWave: number;
  waveTotalEnemies: number;
  enemiesRemaining: number;
  gold: number;
  kills: number;
  promptText: string;
  isPaused: boolean;
  isGameOver: boolean;
  isVictory: boolean;
  playerRespawnSec: number;
}

const MAX_WAVES = 20;
const BARRICADE_REPAIR_COST = 30;
const CASTLE_HEAL_COST = 50;
const CASTLE_HEAL_AMOUNT = 100;

export class DefenseScene extends Phaser.Scene {
  private readonly worldWidth = 1280;
  private readonly worldHeight = 720;
  private readonly worldBounds = new Phaser.Geom.Rectangle(0, 0, 1280, 720);

  private castle!: Structure;
  private barricades: Structure[] = [];
  private player!: Player;
  private bandits: Bandit[] = [];
  private treasures: TreasureDrop[] = [];

  private wave = 0;
  private waveTotalEnemies = 0;
  private gold = 50;
  private kills = 0;
  private comboCount = 0;
  private comboDecayTimer = 0;
  private pendingSpawns = 0;
  private waveSpawnTimer?: Phaser.Time.TimerEvent;
  private waveTransitioning = false;
  private isPaused = false;
  private isGameOver = false;
  private isVictory = false;
  private playerRespawnTimer = 0;
  private hitstopTimer = 0;

  private repairKey!: Phaser.Input.Keyboard.Key;
  private healCastleKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;

  private hudSyncAccumulator = 0;

  constructor() {
    super('DefenseScene');
  }

  public create(): void {
    this.bandits = [];
    this.barricades = [];
    this.treasures = [];
    this.wave = 0;
    this.waveTotalEnemies = 0;
    this.gold = 50;
    this.kills = 0;
    this.comboCount = 0;
    this.comboDecayTimer = 0;
    this.pendingSpawns = 0;
    this.waveTransitioning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.isVictory = false;
    this.playerRespawnTimer = 0;
    this.hitstopTimer = 0;

    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight);

    // High-detail painted isometric fortress battlefield map (1280x720)
    this.add
      .image(this.worldWidth / 2, this.worldHeight / 2, 'fortress_battlefield')
      .setDisplaySize(this.worldWidth, this.worldHeight)
      .setDepth(-100);

    this.buildStructures();
    this.setupSakuraPetals();

    // Zhao Yun spawns in the sunlit sandy courtyard in front of the Castle Gate
    this.player = new Player(this, 575, 455, (atk) =>
      this.handlePlayerAttack(atk),
    );

    const kb = this.input.keyboard!;
    this.repairKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.healCastleKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.H);
    this.restartKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.pauseKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.escKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.cameras.main.centerOn(this.worldWidth / 2, this.worldHeight / 2);

    this.game.events.off('defense:restart', this.restartMatch, this);
    this.game.events.off('defense:togglePause', this.togglePause, this);
    this.game.events.on('defense:restart', this.restartMatch, this);
    this.game.events.on('defense:togglePause', this.togglePause, this);

    this.emitHudState();
    this.scheduleNextWave(1400);
  }

  public update(_time: number, delta: number): void {
    const dtMs = Math.min(delta, 50);

    // Pause toggle via P or ESC
    if (
      !this.isGameOver &&
      !this.isVictory &&
      (Phaser.Input.Keyboard.JustDown(this.pauseKey) ||
        Phaser.Input.Keyboard.JustDown(this.escKey))
    ) {
      this.togglePause();
    }

    if (this.isPaused) {
      return;
    }

    if (this.isGameOver || this.isVictory) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.restartMatch();
      }
      return;
    }

    // 40ms Hitstop freeze on melee impact for crisp combat feel
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dtMs);
      return;
    }

    // Player update or respawn countdown
    if (this.playerRespawnTimer > 0) {
      this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - dtMs);
      if (this.playerRespawnTimer <= 0) {
        this.respawnPlayer();
      }
    } else {
      this.player.update(dtMs, this.worldBounds, (nx, ny, r) =>
        this.resolvePlayerObstacles(nx, ny, r),
      );
      this.handleRepairInteractions();
    }

    // Decay hit combo counter after 2.6s without hitting
    if (this.comboDecayTimer > 0) {
      this.comboDecayTimer = Math.max(0, this.comboDecayTimer - dtMs);
      if (this.comboDecayTimer <= 0) {
        this.comboCount = 0;
      }
    }

    // Update & collect glowing battlefield treasures
    for (let i = this.treasures.length - 1; i >= 0; i--) {
      const tr = this.treasures[i];
      const picked = tr.update(dtMs, this.player.x, this.player.y);
      if (picked) {
        this.applyTreasure(tr);
        tr.destroy();
        this.treasures.splice(i, 1);
      } else if (tr.expired) {
        tr.destroy();
        this.treasures.splice(i, 1);
      }
    }

    // Update bandits & remove dead ones
    for (let i = this.bandits.length - 1; i >= 0; i--) {
      const bandit = this.bandits[i];
      if (bandit.isDead) {
        bandit.destroy();
        this.bandits.splice(i, 1);
        continue;
      }

      bandit.update(
        dtMs,
        this.player,
        this.castle,
        this.barricades,
        this.bandits,
        (structure, damage) => this.handleStructureDamaged(structure, damage),
        (damage, kx, ky) => this.handlePlayerDamaged(damage, kx, ky),
        (impact) => this.handleBossSkillImpact(impact),
        (sx, sy, text) => this.spawnFloatingText(sx, sy, text, '#fb923c'),
      );
    }

    // Check wave completion
    if (
      !this.waveTransitioning &&
      this.wave > 0 &&
      this.pendingSpawns === 0 &&
      this.bandits.length === 0
    ) {
      this.onWaveCleared();
    }

    this.hudSyncAccumulator += dtMs;
    if (this.hudSyncAccumulator >= 65) {
      this.hudSyncAccumulator = 0;
      this.emitHudState();
    }
  }

  private togglePause(): void {
    if (this.isGameOver || this.isVictory) return;
    this.isPaused = !this.isPaused;
    this.time.paused = this.isPaused;
    this.tweens.timeScale = this.isPaused ? 0 : 1;
    this.emitHudState();
  }

  private buildStructures(): void {
    // Grand Wooden Castle Gate aligned directly onto the painted fortress gate
    this.castle = new Structure(this, {
      kind: 'castle',
      x: 685,
      y: 350,
      maxHp: 600,
      collisionRadius: 56,
      rotation: 0,
      usePaintedBackdrop: true,
    });

    // 4 Destructible Wooden Barricades guarding the courtyard & stone stairs
    const barricadeSpots = [
      { x: 355, y: 315, rot: -0.48 }, // Upper-left stairs approach
      { x: 420, y: 525, rot: 0.46 },  // Lower-left stairs approach
      { x: 815, y: 558, rot: -0.42 }, // Lower-right stone bridge approach
      { x: 585, y: 382, rot: 0.42 },  // Inner courtyard gate defense
    ];

    for (const spot of barricadeSpots) {
      const barricade = new Structure(this, {
        kind: 'barricade',
        x: spot.x,
        y: spot.y,
        maxHp: 180,
        collisionRadius: 28,
        rotation: spot.rot,
      });
      this.barricades.push(barricade);
    }
  }

  private setupSakuraPetals(): void {
    const emitter = this.add.particles(0, 0, 'sakura_petal', {
      x: { min: 0, max: this.worldWidth },
      y: { min: -20, max: this.worldHeight * 0.7 },
      lifespan: { min: 5200, max: 8500 },
      speedX: { min: 14, max: 36 },
      speedY: { min: 12, max: 28 },
      rotate: { min: 0, max: 360 },
      scale: { start: 1.15, end: 0.6 },
      alpha: { start: 0.88, end: 0 },
      frequency: 240,
      quantity: 1,
    });
    emitter.setDepth(9500);
  }

  private resolvePlayerObstacles(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number } {
    let rx = x;
    let ry = y;

    // Collide smoothly with the painted stone fortress walls & corner bastions
    const obstacles: Array<{ x: number; y: number; r: number }> = [
      { x: this.castle.x, y: this.castle.y, r: this.castle.collisionRadius },
      { x: 520, y: 245, r: 78 },
      { x: 640, y: 265, r: 72 },
      { x: 785, y: 335, r: 76 },
      { x: 925, y: 405, r: 84 },
      { x: 1085, y: 350, r: 105 },
    ];

    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      const dx = rx - ob.x;
      const dy = ry - ob.y;
      const dist = Math.hypot(dx, dy);
      const minDist = ob.r + radius;
      if (dist > 0.001 && dist < minDist) {
        const push = minDist - dist;
        rx += (dx / dist) * push;
        ry += (dy / dist) * push;
      }
    }

    return { x: rx, y: ry };
  }

  private handlePlayerAttack(atk: SlashAttackEvent): void {
    let hitCount = 0;

    for (let i = 0; i < this.bandits.length; i++) {
      const bandit = this.bandits[i];
      if (bandit.isDead) continue;

      const dx = bandit.x - atk.x;
      const dy = bandit.y - atk.y;
      const dist = Math.hypot(dx, dy);
      if (dist > atk.range + bandit.collisionRadius) continue;

      if (!atk.isWhirlwind) {
        const angleToBandit = Math.atan2(dy, dx);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(angleToBandit - atk.angle));
        if (diff > atk.halfArcRad) continue;
      }

      const dirX = dist > 0.01 ? dx / dist : Math.cos(atk.angle);
      const dirY = dist > 0.01 ? dy / dist : Math.sin(atk.angle);
      const killed = bandit.takeDamage(
        atk.damage,
        dirX * atk.knockback,
        dirY * atk.knockback,
      );

      hitCount++;
      this.comboCount += 1;
      this.comboDecayTimer = 2600;

      this.spawnHitSparks(
        bandit.x,
        bandit.y - 20,
        atk.isComboExplosion ? 0xfde047 : atk.isWhirlwind ? 0x22d3ee : 0x67e8f9,
        atk.isComboExplosion ? 12 : 7,
      );
      this.spawnDamagePopup(
        bandit.x,
        bandit.y - 42,
        atk.isCrit ? `${atk.damage}!` : `${atk.damage}`,
        atk.isComboExplosion ? '#fde047' : atk.isCrit ? '#fbbf24' : '#67e8f9',
        atk.isCrit || atk.isComboExplosion,
      );

      if (killed) {
        this.onBanditKilled(bandit);
      }
    }

    if (hitCount > 0) {
      // Crisp hitstop & camera shake scaled by impact weight
      this.hitstopTimer = atk.hitstopMs ?? 40;
      this.cameras.main.shake(
        atk.isComboExplosion ? 170 : atk.isWhirlwind ? 130 : 75,
        atk.isComboExplosion ? 0.008 : atk.isWhirlwind ? 0.0055 : 0.003,
      );
      if (atk.label) {
        this.spawnFloatingText(this.player.x, this.player.y - 72, atk.label, '#fde047');
      }
      this.emitHudState();
    }
  }

  private onBanditKilled(bandit: Bandit): void {
    this.kills += 1;
    this.gold += bandit.goldReward;

    const expRes = this.player.gainExp(bandit.expReward);
    if (expRes.leveledUp) {
      this.cameras.main.shake(180, 0.006);
      if (expRes.evolvedWeapon) {
        this.game.events.emit('defense:banner', {
          title: `무기 진화! ${this.player.weaponTierName}`,
          subtitle: `조운 LV.${expRes.newLevel} · 공격 범위 & 위력 대폭 상승!`,
          color: '#67e8f9',
        });
      }
    }

    this.spawnHitSparks(bandit.x, bandit.y - 16, 0xfbbf24, bandit.isBoss ? 22 : 10);
    this.spawnFloatingText(
      bandit.x,
      bandit.y - 58,
      `+${bandit.goldReward}G`,
      '#fde047',
    );

    // Treasure Drops! Boss drops a celebratory shower of all 3 treasures!
    if (bandit.isBoss) {
      this.spawnTreasure(bandit.x, bandit.y, 'speed_jade');
      this.spawnTreasure(bandit.x, bandit.y, 'dragon_orb');
      this.spawnTreasure(bandit.x, bandit.y, 'gold_chest');
    } else {
      const dropChance = bandit.archetype === 'grunt' ? 0.14 : 0.28;
      if (Math.random() < dropChance) {
        const roll = Math.random();
        const kind: TreasureKind =
          roll < 0.36 ? 'speed_jade' : roll < 0.72 ? 'dragon_orb' : 'gold_chest';
        this.spawnTreasure(bandit.x, bandit.y, kind);
      }
    }
  }

  private spawnTreasure(x: number, y: number, kind: TreasureKind): void {
    const cx = Phaser.Math.Clamp(x, 60, this.worldWidth - 60);
    const cy = Phaser.Math.Clamp(y, 120, this.worldHeight - 50);
    this.treasures.push(new TreasureDrop(this, cx, cy, kind));
  }

  private applyTreasure(tr: TreasureDrop): void {
    this.spawnHitSparks(this.player.x, this.player.y - 24, tr.meta.glowColor, 18);
    this.spawnFloatingText(
      this.player.x,
      this.player.y - 76,
      tr.meta.label,
      tr.meta.textColor,
    );
    this.cameras.main.shake(110, 0.004);

    let evolvedSkill = false;
    if (tr.kind === 'speed_jade') {
      evolvedSkill = this.player.upgradeAttackSpeed().evolvedSkill;
    } else if (tr.kind === 'dragon_orb') {
      evolvedSkill = this.player.upgradeComboBlast().evolvedSkill;
    } else {
      this.gold += 60;
      this.player.heal(45);
      this.player.triggerUpgradeForce(0xfbbf24, 0xfef08a);
      this.player.gainExp(55);
    }

    if (evolvedSkill) {
      this.game.events.emit('defense:banner', {
        title: `스킬 진화! ${this.player.skillDisplayName}`,
        subtitle: 'E 스킬의 모션과 이펙트가 한 단계 진화했습니다!',
        color: this.player.skillTier === 3 ? '#fde047' : '#6ee7b7',
      });
    }

    this.emitHudState();
  }

  private handleBossSkillImpact(impact: BossSkillImpact): void {
    // Fiery seismic shockwave graphics
    const g = this.add.graphics();
    g.setPosition(impact.x, impact.y);
    g.setDepth(impact.y + 42);
    g.lineStyle(14, 0xdc2626, 0.72);
    g.strokeCircle(0, 0, impact.radius * 0.72);
    g.lineStyle(6, 0xf97316, 0.95);
    g.strokeCircle(0, 0, impact.radius * 0.92);
    g.lineStyle(3, 0xfde047, 1);
    g.strokeCircle(0, 0, impact.radius * 0.52);

    this.tweens.add({
      targets: g,
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });

    this.cameras.main.shake(170, 0.0085);
    this.spawnHitSparks(impact.x, impact.y - 12, 0xf97316, 16);

    // Damage Zhao Yun if inside radius
    const dPlayer = Phaser.Math.Distance.Between(
      impact.x,
      impact.y,
      this.player.x,
      this.player.y,
    );
    if (dPlayer <= impact.radius + this.player.collisionRadius) {
      const ang = Phaser.Math.Angle.Between(impact.x, impact.y, this.player.x, this.player.y);
      this.handlePlayerDamaged(
        impact.damage,
        Math.cos(ang) * impact.knockback,
        Math.sin(ang) * impact.knockback,
      );
    }

    // Damage nearby barricades or castle gate
    for (let i = 0; i < this.barricades.length; i++) {
      const b = this.barricades[i];
      if (b.isDestroyed) continue;
      if (Phaser.Math.Distance.Between(impact.x, impact.y, b.x, b.y) <= impact.radius + b.collisionRadius) {
        this.handleStructureDamaged(b, Math.round(impact.damage * 0.8));
      }
    }
    if (
      Phaser.Math.Distance.Between(impact.x, impact.y, this.castle.x, this.castle.y) <=
      impact.radius + this.castle.collisionRadius
    ) {
      this.handleStructureDamaged(this.castle, Math.round(impact.damage * 0.6));
    }
  }

  private handleStructureDamaged(structure: Structure, damage: number): void {
    if (this.isGameOver || this.isVictory) return;

    const destroyed = structure.takeDamage(damage);
    this.spawnWoodSplinters(structure.x, structure.y - 18, destroyed ? 14 : 5);

    if (structure.kind === 'castle') {
      this.cameras.main.shake(90, 0.004);
      if (destroyed) {
        this.triggerGameOver();
      }
    } else if (destroyed) {
      this.spawnFloatingText(
        structure.x,
        structure.y - 44,
        '바리케이드 파괴!',
        '#f87171',
      );
    }

    this.emitHudState();
  }

  private handlePlayerDamaged(damage: number, kx: number, ky: number): void {
    if (this.isGameOver || this.isVictory || this.playerRespawnTimer > 0) return;

    const result = this.player.takeDamage(damage, kx, ky);
    if (result === 'invuln') return;

    if (result === 'perfect_guard') {
      this.spawnHitSparks(this.player.x, this.player.y - 24, 0xfde047, 12);
      this.spawnFloatingText(this.player.x, this.player.y - 62, 'PERFECT GUARD!', '#fde047');
      this.cameras.main.shake(90, 0.004);
      this.emitHudState();
      return;
    }

    if (result === 'guard') {
      this.spawnHitSparks(this.player.x, this.player.y - 24, 0x38bdf8, 8);
      this.spawnFloatingText(this.player.x, this.player.y - 54, 'GUARD!', '#7dd3fc');
      this.emitHudState();
      return;
    }

    this.spawnHitSparks(this.player.x, this.player.y - 16, 0xf87171, 5);

    if (this.player.hp <= 0) {
      this.playerRespawnTimer = 2500;
      this.player.setVisible(false);
      this.spawnFloatingText(
        this.player.x,
        this.player.y - 40,
        '조운 후퇴! (2.5초 후 복귀)',
        '#fca5a5',
      );
    }

    this.emitHudState();
  }

  private respawnPlayer(): void {
    const rx = 575;
    const ry = 455;
    this.player.hp = this.player.maxHp;
    this.player.setVisible(true);
    this.player.setPosition(rx, ry);
    this.player.flashHit(160, 0x22d3ee);
    this.spawnFloatingText(rx, ry - 48, '조운 복귀!', '#67e8f9');
    this.emitHudState();
  }

  private handleRepairInteractions(): void {
    if (Phaser.Input.Keyboard.JustDown(this.repairKey)) {
      const target = this.findNearestRepairableBarricade(98);
      if (target && this.gold >= BARRICADE_REPAIR_COST) {
        this.gold -= BARRICADE_REPAIR_COST;
        target.repair(target.maxHp);
        this.spawnHitSparks(target.x, target.y - 18, 0xfde047, 10);
        this.spawnFloatingText(target.x, target.y - 46, '바리케이드 수리!', '#fde047');
        this.emitHudState();
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.healCastleKey)) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        this.castle.x,
        this.castle.y,
      );
      if (
        dist <= 150 &&
        this.castle.hp < this.castle.maxHp &&
        this.gold >= CASTLE_HEAL_COST
      ) {
        this.gold -= CASTLE_HEAL_COST;
        this.castle.repair(CASTLE_HEAL_AMOUNT);
        this.spawnHitSparks(this.castle.x, this.castle.y - 40, 0x4ade80, 12);
        this.spawnFloatingText(
          this.castle.x,
          this.castle.y - 78,
          `성채 보수 +${CASTLE_HEAL_AMOUNT}`,
          '#4ade80',
        );
        this.emitHudState();
      }
    }
  }

  private findNearestRepairableBarricade(maxDist: number): Structure | null {
    let best: Structure | null = null;
    let bestDist = maxDist;
    for (let i = 0; i < this.barricades.length; i++) {
      const b = this.barricades[i];
      if (!b.isDestroyed && b.hp >= b.maxHp) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y);
      if (d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    return best;
  }

  private computePromptText(): string {
    if (this.playerRespawnTimer > 0) return '';

    const nearBarricade = this.findNearestRepairableBarricade(98);
    if (nearBarricade) {
      const label = nearBarricade.isDestroyed ? '바리케이드 재건' : '바리케이드 수리';
      return this.gold >= BARRICADE_REPAIR_COST
        ? `[F] ${label} (${BARRICADE_REPAIR_COST}G)`
        : `${label}에 ${BARRICADE_REPAIR_COST}G 필요`;
    }

    const distCastle = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.castle.x,
      this.castle.y,
    );
    if (distCastle <= 150 && this.castle.hp < this.castle.maxHp) {
      return this.gold >= CASTLE_HEAL_COST
        ? `[H] 성채 보수 +${CASTLE_HEAL_AMOUNT}HP (${CASTLE_HEAL_COST}G)`
        : `성채 보수에 ${CASTLE_HEAL_COST}G 필요`;
    }

    return '';
  }

  private scheduleNextWave(delayMs: number): void {
    this.waveTransitioning = true;
    this.time.delayedCall(delayMs, () => {
      if (this.isGameOver || this.isVictory) return;
      this.startWave(this.wave + 1);
    });
  }

  private startWave(waveNum: number): void {
    this.wave = waveNum;
    this.waveTransitioning = false;

    const isBossWave = waveNum % 2 === 0;
    const totalCount = 7 + waveNum * 4 + (isBossWave ? 1 : 0);
    const intervalMs = Math.max(360, 1150 - waveNum * 45);

    this.waveTotalEnemies = totalCount;
    this.pendingSpawns = totalCount;
    let spawned = 0;

    this.game.events.emit('defense:banner', {
      title: isBossWave
        ? `⚠ WAVE ${waveNum} · 산적 대장 출현!`
        : `WAVE ${waveNum} / ${MAX_WAVES}`,
      subtitle: isBossWave
        ? '대장의 대지 강타와 맹돌진을 점프·방어로 막아내세요!'
        : waveNum === 1
          ? '졸개·방패병·척후병이 돌계단을 타고 몰려옵니다!'
          : '더 높은 레벨의 산적 부대가 진격합니다!',
      color: isBossWave ? '#fb923c' : '#fde047',
    });

    this.emitHudState();

    this.waveSpawnTimer?.remove(false);
    this.waveSpawnTimer = this.time.addEvent({
      delay: intervalMs,
      repeat: totalCount - 1,
      callback: () => {
        if (this.isGameOver || this.isVictory) return;
        spawned++;
        this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);

        let archetype: EnemyArchetype = 'grunt';
        if (isBossWave && spawned === Math.ceil(totalCount * 0.55)) {
          archetype = 'boss';
        } else {
          const r = Math.random();
          if (r < 0.24) archetype = 'shield';
          else if (r < 0.46) archetype = 'raider';
          else archetype = 'grunt';
        }

        const baseLv = Math.max(1, waveNum + (archetype === 'boss' ? 1 : 0));
        const level =
          archetype === 'boss'
            ? baseLv
            : Math.max(1, baseLv + Phaser.Math.Between(-1, 0));

        this.spawnBanditAtEdge(archetype, level);
        this.emitHudState();
      },
    });
  }

  private spawnBanditAtEdge(archetype: EnemyArchetype, level: number): void {
    // Spawn along the 3 natural road/staircase entrances on the painted battlefield
    const lane = archetype === 'boss' ? 1 : Phaser.Math.Between(0, 2);
    const jitterX = Phaser.Math.Between(-34, 34);
    const jitterY = Phaser.Math.Between(-24, 24);

    let x = 110;
    let y = 640;

    switch (lane) {
      case 0: // Upper-left mountain pass -> down upper-left stone stairs
        x = 95 + jitterX;
        y = 78 + jitterY;
        break;
      case 1: // Lower-left road -> up lower-left stone stairs
        x = 135 + jitterX;
        y = 655 + jitterY;
        break;
      default: // Lower-right road -> across lower-right stone bridge
        x = 1125 + jitterX;
        y = 650 + jitterY;
        break;
    }

    const bandit = new Bandit(this, {
      x,
      y,
      wave: this.wave,
      archetype,
      level,
    });
    this.bandits.push(bandit);
  }

  private onWaveCleared(): void {
    this.waveTransitioning = true;

    if (this.wave >= MAX_WAVES) {
      this.isVictory = true;
      this.emitHudState();
      return;
    }

    const bonus = 35 + this.wave * 15;
    this.gold += bonus;
    this.player.heal(60);

    this.game.events.emit('defense:banner', {
      title: `WAVE ${this.wave} CLEAR!`,
      subtitle: `보상 +${bonus}G · 바리케이드를 정비하세요`,
      color: '#4ade80',
    });

    this.emitHudState();
    this.scheduleNextWave(3400);
  }

  private triggerGameOver(): void {
    this.isGameOver = true;
    this.waveSpawnTimer?.remove(false);
    this.cameras.main.shake(260, 0.01);
    this.emitHudState();
  }

  private restartMatch(): void {
    this.isPaused = false;
    this.time.paused = false;
    this.tweens.timeScale = 1;
    this.waveSpawnTimer?.remove(false);
    this.scene.restart();
  }

  private spawnHitSparks(x: number, y: number, tint: number, count: number): void {
    const emitter = this.add.particles(x, y, 'spark_particle', {
      speed: { min: 55, max: 175 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.35, end: 0 },
      lifespan: { min: 140, max: 280 },
      tint,
      emitting: false,
    });
    emitter.setDepth(9200);
    emitter.explode(count);
    this.time.delayedCall(320, () => emitter.destroy());
  }

  private spawnWoodSplinters(x: number, y: number, count: number): void {
    const emitter = this.add.particles(x, y, 'wood_splinter', {
      speed: { min: 45, max: 140 },
      angle: { min: 0, max: 360 },
      rotate: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0.4 },
      lifespan: { min: 220, max: 420 },
      emitting: false,
    });
    emitter.setDepth(9200);
    emitter.explode(count);
    this.time.delayedCall(460, () => emitter.destroy());
  }

  /** Punchy `150!` / `320!` style floating damage popup with scale bounce. */
  private spawnDamagePopup(
    x: number,
    y: number,
    text: string,
    color: string,
    isBig = false,
  ): void {
    const label = this.add
      .text(x + Phaser.Math.Between(-10, 10), y, text, {
        fontFamily: 'Malgun Gothic, Arial Black, sans-serif',
        fontSize: isBig ? '25px' : '20px',
        fontStyle: 'bold',
        color,
        stroke: '#090b10',
        strokeThickness: isBig ? 6 : 5,
      })
      .setOrigin(0.5)
      .setScale(0.55)
      .setDepth(9650);

    this.tweens.chain({
      targets: label,
      tweens: [
        { scale: isBig ? 1.38 : 1.22, y: y - 16, duration: 95, ease: 'Back.easeOut' },
        { scale: 1.0, y: y - 38, alpha: 0, duration: 500, ease: 'Cubic.easeOut' },
      ],
      onComplete: () => label.destroy(),
    });
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'Malgun Gothic, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        stroke: '#090b10',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(9600);

    this.tweens.add({
      targets: label,
      y: y - 28,
      alpha: 0,
      duration: 680,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private emitHudState(): void {
    const activeBoss = this.bandits.find((b) => b.isBoss && !b.isDead);
    const state: DefenseHudState = {
      castleHp: Math.ceil(this.castle.hp),
      castleMaxHp: this.castle.maxHp,
      playerHp: Math.ceil(this.player.hp),
      playerMaxHp: this.player.maxHp,
      playerLevel: this.player.level,
      playerFormName: this.player.formDisplayName,
      playerExp: Math.floor(this.player.exp),
      playerExpToNext: this.player.expToNext,
      weaponTierName: this.player.weaponTierName,
      skillTier: this.player.skillTier,
      skillDisplayName: this.player.skillDisplayName,
      speedLevel: this.player.speedLevel,
      blastLevel: this.player.blastLevel,
      skillReadyRatio: this.player.skillCooldownRatio,
      comboCount: this.comboCount,
      bossName: activeBoss ? activeBoss.displayName : '',
      bossHp: activeBoss ? Math.ceil(activeBoss.hp) : 0,
      bossMaxHp: activeBoss ? activeBoss.maxHp : 0,
      wave: Math.max(1, this.wave),
      maxWave: MAX_WAVES,
      waveTotalEnemies: Math.max(1, this.waveTotalEnemies),
      enemiesRemaining: this.bandits.length + this.pendingSpawns,
      gold: this.gold,
      kills: this.kills,
      promptText: this.computePromptText(),
      isPaused: this.isPaused,
      isGameOver: this.isGameOver,
      isVictory: this.isVictory,
      playerRespawnSec: Math.ceil(this.playerRespawnTimer / 100) / 10,
    };
    this.game.events.emit('defense:hud', state);
  }
}
