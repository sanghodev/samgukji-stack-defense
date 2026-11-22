import Phaser from 'phaser';
import { DEPTH_LAYERS, GAME_HEIGHT, GAME_WIDTH } from '../config/arenaConfig';
import { Step4Tuning } from '../config/step4Config';
import { evaluateCameraGagEligibility } from '../core/FearAndGagMath';
import { CombatAudioManager } from './CombatAudioManager';
import { IGameSystem, SystemContext } from './ModuleRegistry';
import { ScreenShakeSystem } from './ScreenShakeSystem';

type GagPhase = 'IDLE' | 'APPROACH' | 'SPLAT' | 'SLIDE' | 'RELEASE';

/**
 * Reusable screen-space comedy overlay controller for rare camera-glass collisions.
 * Keeps the arena camera completely fixed and lets normal gameplay continue unobstructed
 * behind the brief slapstick face-squash and sliding squeak!
 */
export class CameraGagController implements IGameSystem {
  public readonly id = 'camera-gag';

  private scene?: Phaser.Scene;
  private readonly tuning: Step4Tuning;
  private readonly audio: CombatAudioManager;
  private readonly screenShake: ScreenShakeSystem;

  private overlay?: Phaser.GameObjects.Container;
  private faceSprite?: Phaser.GameObjects.Image;
  private splatLabel?: Phaser.GameObjects.Text;

  private phase: GagPhase = 'IDLE';
  private elapsedMs = 0;
  private totalDurationMs = 1120;
  private cooldownMs = 0;

  private startX = GAME_WIDTH / 2;
  private startY = GAME_HEIGHT / 2;
  private targetX = GAME_WIDTH / 2;
  private targetY = GAME_HEIGHT * 0.44;

  private splatTriggered = false;
  private squeakTriggered = false;
  private releaseTriggered = false;
  private onCompleteCb?: () => void;

  constructor(
    tuning: Step4Tuning,
    audio: CombatAudioManager,
    screenShake: ScreenShakeSystem,
  ) {
    this.tuning = tuning;
    this.audio = audio;
    this.screenShake = screenShake;
  }

  public init(ctx: SystemContext): void {
    this.scene = ctx.scene;

    this.faceSprite = ctx.scene.add.image(0, 0, 'bandit_splat_face');
    this.faceSprite.setOrigin(0.5);

    this.splatLabel = ctx.scene.add
      .text(0, -118, '철퍽!!', {
        fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#fde047',
        stroke: '#1c120c',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.overlay = ctx.scene.add
      .container(GAME_WIDTH / 2, GAME_HEIGHT / 2, [this.faceSprite, this.splatLabel])
      .setDepth(DEPTH_LAYERS.HUD + 15)
      .setScrollFactor(0)
      .setVisible(false);
  }

  public get isActive(): boolean {
    return this.phase !== 'IDLE';
  }

  public get cooldownRemaining(): number {
    return this.cooldownMs;
  }

  /**
   * Attempts to trigger the rare camera-glass gag on an exceptional foreground launch.
   * Returns true if triggered (caller should temporarily hide the world bandit until onComplete).
   */
  public tryTrigger(
    fromX: number,
    fromY: number,
    launchSpeed: number,
    vy: number,
    enemyEligible: boolean,
    onComplete: () => void,
  ): boolean {
    const eligible = evaluateCameraGagEligibility({
      enabled: this.tuning.cameraGagEnabled,
      isAnyGagActive: this.isActive,
      cooldownRemainingMs: this.cooldownMs,
      enemyEligible,
      launchSpeed,
      launchThreshold: this.tuning.cameraGagLaunchThreshold,
      vy,
      gagChance: this.tuning.cameraGagChance,
      roll01: Math.random(),
    });
    if (!eligible) return false;

    this.startGag(fromX, fromY, onComplete);
    return true;
  }

  /**
   * Developer preview trigger from the F2 debug panel.
   */
  public forcePreview(): void {
    if (this.isActive) return;
    this.startGag(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.65);
  }

  private startGag(fromX: number, fromY: number, onComplete?: () => void): void {
    if (!this.overlay || !this.faceSprite || !this.splatLabel) return;

    this.phase = 'APPROACH';
    this.elapsedMs = 0;
    this.totalDurationMs = Math.max(700, this.tuning.cameraGagDurationMs);
    this.cooldownMs = this.tuning.cameraGagCooldownMs;

    this.startX = Phaser.Math.Clamp(fromX, 220, GAME_WIDTH - 220);
    this.startY = Phaser.Math.Clamp(fromY, 240, GAME_HEIGHT - 120);
    this.targetX = Phaser.Math.Clamp(
      fromX + Phaser.Math.Between(-90, 90),
      320,
      GAME_WIDTH - 320,
    );
    this.targetY = GAME_HEIGHT * 0.42;

    this.splatTriggered = false;
    this.squeakTriggered = false;
    this.releaseTriggered = false;
    this.onCompleteCb = onComplete;

    this.overlay.setPosition(this.startX, this.startY);
    this.overlay.setAlpha(1);
    this.overlay.setVisible(true);
    this.faceSprite.setScale(0.32, 0.32);
    this.faceSprite.setRotation(0);
    this.splatLabel.setVisible(false);

    this.audio.playCameraWhoosh();
  }

  public update(_time: number, delta: number): void {
    const dtMs = Math.min(delta, 50);

    if (this.cooldownMs > 0) {
      this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    }

    if (this.phase === 'IDLE' || !this.overlay || !this.faceSprite || !this.splatLabel) {
      return;
    }

    this.elapsedMs += dtMs;
    const progress = this.elapsedMs / this.totalDurationMs;

    if (progress < 0.16) {
      // A-D: Rapid zoom toward the viewer
      const t = progress / 0.16;
      const ease = t * t;
      this.overlay.setPosition(
        Phaser.Math.Linear(this.startX, this.targetX, ease),
        Phaser.Math.Linear(this.startY, this.targetY, ease),
      );
      const s = Phaser.Math.Linear(0.32, 1.3, ease);
      this.faceSprite.setScale(s, s);
      this.faceSprite.setRotation(Math.sin(t * 14) * 0.12);
    } else if (progress < 0.36) {
      // E-H: Face slams invisible camera glass & squashes wide!
      if (!this.splatTriggered) {
        this.splatTriggered = true;
        this.phase = 'SPLAT';
        this.audio.playCameraSplat(this.tuning.cameraGagSplatVolume);
        this.screenShake.trigger(5.5, 110, 0, 1);
        this.splatLabel.setVisible(true);
        this.splatLabel.setScale(1.3);
      }

      const t = (progress - 0.16) / 0.2;
      const wobble = Math.sin(t * Math.PI * 3) * (1 - t) * 0.12;
      this.overlay.setPosition(this.targetX, this.targetY);
      this.faceSprite.setScale(1.44 + wobble, 0.78 - wobble * 0.6);
      this.faceSprite.setRotation(wobble * 0.4);
      this.splatLabel.setScale(Phaser.Math.Linear(1.28, 1.0, t));
    } else if (progress < 0.92) {
      // I-J: Slowly slides down the glass with rubbery squeak!
      if (!this.squeakTriggered) {
        this.squeakTriggered = true;
        this.phase = 'SLIDE';
        this.audio.playCameraSqueak(this.tuning.cameraGagSqueakVolume);
        this.splatLabel.setVisible(false);
      }

      const t = (progress - 0.36) / 0.56;
      const slideY = Phaser.Math.Linear(this.targetY, GAME_HEIGHT + 120, Math.pow(t, 1.35));
      const squeakJitter = Math.sin(t * 28) * 3.5;
      this.overlay.setPosition(this.targetX + squeakJitter, slideY);
      // Elongates slightly vertically as cheeks drag down the glass
      this.faceSprite.setScale(
        Phaser.Math.Linear(1.34, 1.08, t),
        Phaser.Math.Linear(0.84, 1.24, t),
      );
      this.faceSprite.setRotation(Math.sin(t * 16) * 0.05);
    } else if (progress < 1.0) {
      // K: Drops cleanly below the visible screen
      if (!this.releaseTriggered) {
        this.releaseTriggered = true;
        this.phase = 'RELEASE';
        this.audio.playCameraRelease();
      }
      const t = (progress - 0.92) / 0.08;
      this.overlay.setAlpha(1 - t);
    } else {
      // L: Complete & restore unobstructed screen
      this.finishGag();
    }
  }

  public reset(): void {
    if (this.isActive) {
      this.finishGag();
    }
    this.cooldownMs = 0;
  }

  private finishGag(): void {
    this.phase = 'IDLE';
    this.overlay?.setVisible(false);
    this.splatLabel?.setVisible(false);
    const cb = this.onCompleteCb;
    this.onCompleteCb = undefined;
    cb?.();
  }

  public destroy(): void {
    this.overlay?.destroy(true);
    this.overlay = undefined;
    this.faceSprite = undefined;
    this.splatLabel = undefined;
    this.onCompleteCb = undefined;
  }
}
