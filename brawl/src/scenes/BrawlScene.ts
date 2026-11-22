import Phaser from 'phaser';
import {
  DEPTH_LAYERS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PLAYER_CONFIG,
} from '../config/arenaConfig';
import { EventBus } from '../core/EventBus';
import { Warrior } from '../entities/Warrior';
import { DebugOverlay } from '../systems/DebugOverlay';
import { InputSystem } from '../systems/InputSystem';
import { SystemRegistry } from '../systems/ModuleRegistry';
import { MarketplaceArena } from '../world/MarketplaceArena';

/**
 * Main fixed-camera 2.5D arena scene for Three Kingdoms Mayhem (삼국지 난장판).
 * Coordinates the marketplace arena, player movement, perspective scaling,
 * depth sorting, debug overlay, and modular system registry.
 */
export class BrawlScene extends Phaser.Scene {
  private eventsBus!: EventBus;
  private systems!: SystemRegistry;
  private inputSystem!: InputSystem;
  private debugOverlay!: DebugOverlay;
  private arena!: MarketplaceArena;
  private player!: Warrior;

  constructor() {
    super('BrawlScene');
  }

  public create(): void {
    // Strictly stationary fixed camera (not a scrolling game)
    this.cameras.main.setViewport(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    this.eventsBus = new EventBus();
    this.systems = new SystemRegistry({ scene: this, events: this.eventsBus });

    // Register core foundation systems (future combat, AI, destructibles, audio, multiplayer plug in here)
    this.inputSystem = this.systems.register(new InputSystem());
    this.debugOverlay = this.systems.register(new DebugOverlay());

    // Build fixed-camera ancient Chinese marketplace arena
    this.arena = new MarketplaceArena(this);

    // Spawn playable chibi Zhao Yun in the center of the marketplace plaza
    this.player = new Warrior(this, PLAYER_CONFIG.spawnX, PLAYER_CONFIG.spawnY);

    this.createMinimalHud();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  public update(time: number, delta: number): void {
    const input = this.inputSystem.sample();

    if (input.toggleDebugPressed) {
      const visible = this.debugOverlay.toggle();
      this.eventsBus.emit('debug:toggled', { visible });
    }

    // Update arena ambience (lanterns, banners)
    this.arena.update(delta);

    // Update player 8-direction movement, perspective scaling, depth sorting, and boundaries
    this.player.update(delta, input, (x, y, r) =>
      this.arena.resolvePropCollisions(x, y, r),
    );

    // Update any registered modular subsystems
    this.systems.update(time, delta);

    // Emit player movement state for future camera-less systems (AI targeting, multiplayer sync)
    if (input.isMoving) {
      this.eventsBus.emit('player:moved', {
        x: this.player.x,
        y: this.player.y,
        vx: this.player.vx,
        vy: this.player.vy,
        facing: this.player.facingLabel,
      });
    }

    // Update debug overlay
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

  private createMinimalHud(): void {
    // Subtle top-right arcade title badge
    const badgeW = 248;
    const badgeH = 44;
    const bx = GAME_WIDTH - badgeW - 14;
    const by = 14;

    const bg = this.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    bg.fillStyle(0x1c120c, 0.78);
    bg.fillRoundedRect(bx, by, badgeW, badgeH, 6);
    bg.lineStyle(1.5, 0xfbbf24, 0.7);
    bg.strokeRoundedRect(bx, by, badgeW, badgeH, 6);

    this.add
      .text(bx + badgeW / 2, by + 15, '삼국지 난장판', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fde047',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    this.add
      .text(bx + badgeW / 2, by + 33, 'THREE KINGDOMS MAYHEM', {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: '10px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);

    // Subtle bottom-right movement hint pill
    const hintBg = this.add.graphics().setDepth(DEPTH_LAYERS.HUD);
    hintBg.fillStyle(0x0b101b, 0.72);
    hintBg.fillRoundedRect(GAME_WIDTH - 284, GAME_HEIGHT - 34, 270, 24, 5);
    hintBg.lineStyle(1, 0x94a3b8, 0.35);
    hintBg.strokeRoundedRect(GAME_WIDTH - 284, GAME_HEIGHT - 34, 270, 24, 5);

    this.add
      .text(GAME_WIDTH - 149, GAME_HEIGHT - 22, 'WASD / 방향키: 8방향 이동 · F3: 디버그', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '11px',
        color: '#e2e8f0',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_LAYERS.HUD + 1);
  }

  private handleShutdown(): void {
    this.player?.destroy();
    this.arena?.destroy();
    this.systems?.destroy();
    this.eventsBus?.clear();
  }
}
