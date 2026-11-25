import { CombatTuning } from '../config/combatConfig';
import { MayhemTuning } from '../config/mayhemConfig';
import { PolishSettings } from '../config/polishConfig';
import { IAudioSystem, SystemContext } from './ModuleRegistry';

type SoundChannel =
  | 'light_whoosh'
  | 'strong_whoosh'
  | 'light_impact'
  | 'finisher_impact'
  | 'heavy_impact'
  | 'enemy_hurt'
  | 'knockdown_land'
  | 'footstep'
  | 'enemy_whoosh'
  | 'player_hurt'
  | 'enemy_defeat'
  | 'wood_pickup'
  | 'wood_creak'
  | 'table_throw'
  | 'table_impact'
  | 'table_shatter'
  | 'barrel_roll'
  | 'barrel_hit'
  | 'barrel_break'
  | 'ceramic_break'
  | 'water_splash'
  | 'slip'
  | 'fall_thud'
  | 'body_collision'
  | 'chain_reaction'
  | 'heavy_env_impact'
  | 'zf_roar'
  | 'zf_heavy_step'
  | 'zf_charge_rush'
  | 'zf_shoulder_hit'
  | 'zf_skid'
  | 'bandit_panic'
  | 'bandit_stumble'
  | 'bandit_hide'
  | 'bandit_peek'
  | 'bandit_surrender'
  | 'cam_whoosh'
  | 'cam_splat'
  | 'cam_squeak'
  | 'cam_release'
  | 'gy_sweep'
  | 'gy_cyclone'
  | 'hz_bow'
  | 'hz_arrow_hit'
  | 'hz_burst'
  | 'zy_dragon_strike'
  | 'stage_open'
  | 'wave_warning'
  | 'elite_entrance'
  | 'boss_entrance'
  | 'boss_slam'
  | 'boss_roar'
  | 'boss_stagger'
  | 'boss_defeat'
  | 'treasure_pickup'
  | 'upgrade_confirm'
  | 'combo_milestone'
  | 'victory_fanfare'
  | 'defeat_sting'
  | 'guard_block'
  | 'hero_dizzy'
  | 'power_up_burst'
  | 'wreckage_kick';

/**
 * Procedural Web Audio API combat & environmental chaos sound engine.
 * Step 7: Multi-bus mixer (Master, Combat, Environment, Voices, Music, UI),
 * dynamic compression (zero clipping), music ducking on heavy impacts,
 * active voice budgeting, per-channel cooldown throttling, and pitch variation.
 */
export class CombatAudioManager implements IAudioSystem {
  public readonly id = 'audio';

  private readonly tuning: CombatTuning;
  private readonly mayhemTuning?: MayhemTuning;
  private readonly polish?: PolishSettings;
  private ctx?: AudioContext;
  private masterGain?: GainNode;
  private combatGain?: GainNode;
  private envGain?: GainNode;
  private voiceGain?: GainNode;
  private musicGain?: GainNode;
  private uiGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private noiseBuffer?: AudioBuffer;
  private readonly lastPlayedAt = new Map<SoundChannel, number>();
  private unlockBound?: () => void;
  private activeVoices = 0;
  private duckUntilTime = 0;
  private muted = false;
  private static readonly MUTE_STORAGE_KEY = 'tkm_audio_muted_v1';

  constructor(
    tuning: CombatTuning,
    mayhemTuning?: MayhemTuning,
    polish?: PolishSettings,
  ) {
    this.tuning = tuning;
    this.mayhemTuning = mayhemTuning;
    this.polish = polish;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        this.muted = window.localStorage.getItem(CombatAudioManager.MUTE_STORAGE_KEY) === '1';
      }
    } catch {
      this.muted = false;
    }
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CombatAudioManager.MUTE_STORAGE_KEY, muted ? '1' : '0');
      }
    } catch {
      // Ignore storage quota / privacy mode errors
    }
    this.syncVolume();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public get activeVoiceCount(): number {
    return this.activeVoices;
  }

  public init(_ctx: SystemContext): void {
    this.unlockBound = () => this.ensureUnlocked();
    window.addEventListener('keydown', this.unlockBound, { passive: true });
    window.addEventListener('pointerdown', this.unlockBound, { passive: true });
  }

  public ensureUnlocked(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.compressor);

      this.combatGain = this.ctx.createGain();
      this.combatGain.connect(this.masterGain);

      this.envGain = this.ctx.createGain();
      this.envGain.connect(this.masterGain);

      this.voiceGain = this.ctx.createGain();
      this.voiceGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);

      this.uiGain = this.ctx.createGain();
      this.uiGain.connect(this.masterGain);

      this.compressor.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      this.syncVolume();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /**
   * Briefly ducks BGM during heavy impacts, camera-glass splat, or boss defeat
   * so punchy combat transients cut cleanly through the mix.
   */
  public duckMusic(durationMs = 320): void {
    if (!this.ctx || !this.musicGain || this.muted) return;
    const duckDepth = this.polish?.musicDuckingAmount ?? 0.55;
    if (duckDepth <= 0.02) return;
    const now = this.ctx.currentTime;
    const baseMusic = this.polish?.musicVolume ?? 0.55;
    const ducked = Math.max(0.04, baseMusic * (1 - duckDepth));
    this.duckUntilTime = Math.max(this.duckUntilTime, now + durationMs * 0.001);
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(ducked, now, 0.012);
    this.musicGain.gain.setTargetAtTime(baseMusic, this.duckUntilTime, 0.08);
  }

  public syncVolume(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const master = this.muted ? 0 : Math.max(0, Math.min(1.5, this.polish?.masterVolume ?? 1.0));
    const combat = Math.max(0, Math.min(1.5, (this.polish?.combatVolume ?? 1.0) * this.tuning.audioVolume));
    const env = Math.max(
      0,
      Math.min(
        1.5,
        (this.polish?.envVolume ?? 1.0) * (this.mayhemTuning?.envSfxVolume ?? this.tuning.audioVolume),
      ),
    );
    const voice = Math.max(0, Math.min(1.5, this.polish?.voiceVolume ?? 0.85));
    const music = Math.max(0, Math.min(1.5, this.polish?.musicVolume ?? 0.55));
    const ui = Math.max(0, Math.min(1.5, this.polish?.uiVolume ?? 0.85));

    this.masterGain?.gain.setTargetAtTime(master, now, 0.015);
    this.combatGain?.gain.setTargetAtTime(combat, now, 0.015);
    this.envGain?.gain.setTargetAtTime(env, now, 0.015);
    this.voiceGain?.gain.setTargetAtTime(voice, now, 0.015);
    if (now >= this.duckUntilTime) {
      this.musicGain?.gain.setTargetAtTime(music, now, 0.025);
    }
    this.uiGain?.gain.setTargetAtTime(ui, now, 0.015);
  }

  // ==================== STEP 2 COMBAT SOUNDS ====================

  public playLightWhoosh(): void {
    const dest = this.beginPlay('light_whoosh', 45, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.09);
    this.playFilteredNoise(dest, now, 0.095, 1600 * pitch, 650 * pitch, 2.2, 0.28);
    this.playTone(dest, now, 'triangle', 520 * pitch, 210 * pitch, 0.07, 0.1);
  }

  public playStrongWhoosh(): void {
    const dest = this.beginPlay('strong_whoosh', 70, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.07);
    this.playFilteredNoise(dest, now, 0.18, 1200 * pitch, 320 * pitch, 1.8, 0.44);
    this.playTone(dest, now, 'sawtooth', 360 * pitch, 110 * pitch, 0.14, 0.14);
  }

  public playLightImpact(): void {
    const dest = this.beginPlay('light_impact', 30, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.08);
    this.playFilteredNoise(dest, now, 0.045, 2400 * pitch, 900 * pitch, 1.2, 0.45);
    this.playTone(dest, now, 'triangle', 220 * pitch, 72 * pitch, 0.075, 0.42);
  }

  public playComboFinisherImpact(): void {
    const dest = this.beginPlay('finisher_impact', 40, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.07);
    this.playFilteredNoise(dest, now, 0.07, 3200 * pitch, 700 * pitch, 1.4, 0.56);
    this.playTone(dest, now, 'sine', 190 * pitch, 48 * pitch, 0.14, 0.62);
    this.playTone(dest, now + 0.008, 'triangle', 740 * pitch, 380 * pitch, 0.09, 0.18);
  }

  public playHeavyImpact(): void {
    const dest = this.beginPlay('heavy_impact', 45, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.06);
    this.playFilteredNoise(dest, now, 0.11, 3600 * pitch, 500 * pitch, 1.1, 0.72);
    this.playTone(dest, now, 'sine', 160 * pitch, 36 * pitch, 0.21, 0.85);
    this.playTone(dest, now, 'sawtooth', 260 * pitch, 68 * pitch, 0.12, 0.28);
    this.playTone(dest, now + 0.01, 'triangle', 920 * pitch, 460 * pitch, 0.13, 0.22);
  }

  public playEnemyHurt(heavy = false): void {
    const dest = this.beginPlay('enemy_hurt', 45, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.12);
    if (heavy) {
      this.playTone(dest, now + 0.015, 'square', 560 * pitch, 210 * pitch, 0.16, 0.16);
      this.playTone(dest, now + 0.02, 'triangle', 420 * pitch, 160 * pitch, 0.17, 0.2);
    } else {
      this.playTone(dest, now + 0.01, 'square', 380 * pitch, 230 * pitch, 0.08, 0.12);
    }
  }

  public playKnockdownLanding(): void {
    const dest = this.beginPlay('knockdown_land', 50, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.08);
    this.playTone(dest, now, 'sine', 125 * pitch, 42 * pitch, 0.13, 0.52);
    this.playFilteredNoise(dest, now, 0.085, 850 * pitch, 280 * pitch, 1.1, 0.3);
  }

  public playFootstep(): void {
    const dest = this.beginPlay('footstep', 135, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.12);
    this.playFilteredNoise(dest, now, 0.032, 950 * pitch, 420 * pitch, 1.8, 0.1);
  }

  public playEnemyWhoosh(): void {
    const dest = this.beginPlay('enemy_whoosh', 90, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.1);
    this.playFilteredNoise(dest, now, 0.11, 780 * pitch, 260 * pitch, 1.6, 0.22);
  }

  public playPlayerHurt(): void {
    const dest = this.beginPlay('player_hurt', 110, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.06);
    this.playTone(dest, now, 'sawtooth', 190 * pitch, 65 * pitch, 0.14, 0.45);
    this.playTone(dest, now, 'square', 620 * pitch, 290 * pitch, 0.08, 0.18);
    this.playFilteredNoise(dest, now, 0.06, 1800, 600, 1.5, 0.25);
  }

  public playEnemyDefeat(): void {
    const dest = this.beginPlay('enemy_defeat', 70, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'triangle', 523.25, 523.25, 0.075, 0.24);
    this.playTone(dest, now + 0.065, 'triangle', 659.25, 659.25, 0.08, 0.26);
    this.playTone(dest, now + 0.13, 'triangle', 783.99, 1046.5, 0.14, 0.28);
  }

  // ==================== STEP 3 ENVIRONMENTAL CHAOS SOUNDS ====================

  public playWoodPickup(): void {
    const dest = this.beginPlay('wood_pickup', 70, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    this.playTone(dest, now, 'triangle', 165 * p, 275 * p, 0.09, 0.36);
    this.playFilteredNoise(dest, now + 0.015, 0.06, 900 * p, 450 * p, 2.5, 0.22);
  }

  public playWoodCreak(): void {
    const dest = this.beginPlay('wood_creak', 120, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    this.playTone(dest, now, 'sawtooth', 240 * p, 195 * p, 0.11, 0.12);
  }

  public playHeavyTableThrow(): void {
    const dest = this.beginPlay('table_throw', 80, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.07);
    this.playFilteredNoise(dest, now, 0.2, 950 * p, 220 * p, 1.4, 0.5);
    this.playTone(dest, now, 'triangle', 260 * p, 92 * p, 0.16, 0.34);
  }

  public playTableImpact(): void {
    const dest = this.beginPlay('table_impact', 40, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.07);
    // Layered woody crack + heavy body thump
    this.playFilteredNoise(dest, now, 0.09, 2100 * p, 420 * p, 1.3, 0.65);
    this.playTone(dest, now, 'sine', 155 * p, 42 * p, 0.18, 0.78);
    this.playTone(dest, now + 0.01, 'square', 310 * p, 120 * p, 0.08, 0.2);
  }

  public playTableShatter(): void {
    const dest = this.beginPlay('table_shatter', 60, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.06);
    // Multi-layered wood splintering explosion
    this.playTone(dest, now, 'sine', 140 * p, 34 * p, 0.22, 0.85);
    this.playFilteredNoise(dest, now, 0.16, 2600 * p, 380 * p, 1.0, 0.78);
    this.playFilteredNoise(dest, now + 0.045, 0.12, 1800 * p, 520 * p, 1.6, 0.45);
    this.playTone(dest, now + 0.02, 'sawtooth', 420 * p, 110 * p, 0.1, 0.22);
  }

  public playBarrelRoll(): void {
    const dest = this.beginPlay('barrel_roll', 160, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    this.playTone(dest, now, 'triangle', 105 * p, 82 * p, 0.12, 0.24);
    this.playFilteredNoise(dest, now, 0.1, 420 * p, 220 * p, 2.0, 0.16);
  }

  public playBarrelCollision(): void {
    const dest = this.beginPlay('barrel_hit', 50, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    // Hollow wooden drum thud
    this.playTone(dest, now, 'sine', 190 * p, 64 * p, 0.15, 0.62);
    this.playFilteredNoise(dest, now, 0.07, 1100 * p, 350 * p, 1.5, 0.4);
  }

  public playBarrelBreak(hasWater: boolean): void {
    const dest = this.beginPlay('barrel_break', 60, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.07);
    this.playTone(dest, now, 'sine', 150 * p, 40 * p, 0.19, 0.72);
    this.playFilteredNoise(dest, now, 0.14, 2100 * p, 420 * p, 1.2, 0.65);
    if (hasWater) {
      this.playWaterSplash();
    }
  }

  public playCeramicBreak(): void {
    const dest = this.beginPlay('ceramic_break', 50, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    // Crisp high-frequency porcelain/terracotta shatter (distinct from wood!)
    this.playFilteredNoise(dest, now, 0.11, 5200 * p, 1800 * p, 1.8, 0.62);
    this.playTone(dest, now, 'triangle', 1850 * p, 920 * p, 0.07, 0.26);
    this.playTone(dest, now + 0.025, 'sine', 2400 * p, 1450 * p, 0.06, 0.22);
    this.playTone(dest, now + 0.055, 'triangle', 1420 * p, 780 * p, 0.06, 0.16);
  }

  public playWaterSplash(): void {
    const dest = this.beginPlay('water_splash', 60, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.09);
    // Lush sweeping liquid splash
    this.playFilteredNoise(dest, now + 0.01, 0.24, 2400 * p, 480 * p, 0.9, 0.56);
    this.playTone(dest, now + 0.02, 'sine', 380 * p, 640 * p, 0.08, 0.16);
    this.playTone(dest, now + 0.08, 'sine', 520 * p, 260 * p, 0.12, 0.14);
  }

  public playSlip(): void {
    const dest = this.beginPlay('slip', 90, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    // Classic hilarious cartoon rising-then-falling slide whistle!
    this.playTone(dest, now, 'sine', 340 * p, 1180 * p, 0.14, 0.34);
    this.playTone(dest, now + 0.13, 'triangle', 1120 * p, 240 * p, 0.13, 0.24);
  }

  public playFallThud(): void {
    const dest = this.beginPlay('fall_thud', 60, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    this.playTone(dest, now, 'sine', 115 * p, 38 * p, 0.15, 0.56);
    this.playFilteredNoise(dest, now, 0.08, 650 * p, 240 * p, 1.2, 0.28);
  }

  public playBodyCollision(): void {
    const dest = this.beginPlay('body_collision', 40, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.09);
    this.playTone(dest, now, 'sine', 180 * p, 58 * p, 0.11, 0.58);
    this.playFilteredNoise(dest, now, 0.055, 1400 * p, 480 * p, 1.3, 0.38);
  }

  public playChainReaction(chainDepth: number): void {
    const dest = this.beginPlay('chain_reaction', 45, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // Escalating bowling-pin pitch per chain step!
    const stepMul = 1 + Math.min(4, Math.max(0, chainDepth - 1)) * 0.16;
    this.playTone(dest, now, 'sine', 165 * stepMul, 52 * stepMul, 0.13, 0.62);
    this.playTone(dest, now + 0.01, 'triangle', 440 * stepMul, 660 * stepMul, 0.09, 0.24);
    this.playFilteredNoise(dest, now, 0.07, 1900 * stepMul, 520, 1.2, 0.42);
  }

  public playHeavyEnvImpact(): void {
    const dest = this.beginPlay('heavy_env_impact', 60, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.06);
    this.playTone(dest, now, 'sine', 135 * p, 34 * p, 0.22, 0.85);
    this.playFilteredNoise(dest, now, 0.14, 2400 * p, 360 * p, 1.0, 0.68);
  }

  // ==================== STEP 4 ZHANG FEI, COMEDIC AI & CAMERA GAG SOUNDS ====================

  public playZhangFeiRoar(): void {
    const dest = this.beginPlay('zf_roar', 220, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.05);
    // Deep booming war-cry growl!
    this.playTone(dest, now, 'sawtooth', 145 * p, 82 * p, 0.28, 0.42);
    this.playTone(dest, now, 'sine', 110 * p, 58 * p, 0.3, 0.65);
    this.playFilteredNoise(dest, now, 0.24, 620 * p, 240 * p, 1.8, 0.45);
  }

  public playHeavyFootstep(): void {
    const dest = this.beginPlay('zf_heavy_step', 120, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.09);
    this.playTone(dest, now, 'sine', 95 * p, 38 * p, 0.08, 0.34);
    this.playFilteredNoise(dest, now, 0.045, 580 * p, 220 * p, 1.4, 0.18);
  }

  public playChargeRush(): void {
    const dest = this.beginPlay('zf_charge_rush', 140, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playFilteredNoise(dest, now, 0.28, 920, 260, 1.1, 0.48);
    this.playTone(dest, now, 'triangle', 180, 95, 0.22, 0.3);
  }

  public playShoulderCollision(): void {
    const dest = this.beginPlay('zf_shoulder_hit', 45, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.07);
    // Massive bowling-ball bulldozer slam!
    this.playTone(dest, now, 'sine', 150 * p, 32 * p, 0.22, 0.9);
    this.playTone(dest, now, 'sawtooth', 240 * p, 64 * p, 0.12, 0.32);
    this.playFilteredNoise(dest, now, 0.12, 2800 * p, 420 * p, 1.0, 0.68);
  }

  public playChargeSkid(): void {
    const dest = this.beginPlay('zf_skid', 150, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playFilteredNoise(dest, now, 0.2, 1100, 320, 1.5, 0.35);
    this.playTone(dest, now + 0.04, 'sine', 110, 44, 0.12, 0.36);
  }

  public playBanditPanicSqueal(): void {
    // Heavily throttled so 15 bandits don't scream simultaneously!
    const dest = this.beginPlay('bandit_panic', 620, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.14);
    this.playTone(dest, now, 'triangle', 520 * p, 860 * p, 0.11, 0.18);
    this.playTone(dest, now + 0.09, 'square', 820 * p, 560 * p, 0.08, 0.1);
  }

  public playStumble(): void {
    const dest = this.beginPlay('bandit_stumble', 180, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    this.playTone(dest, now, 'triangle', 480 * p, 180 * p, 0.12, 0.22);
    this.playTone(dest, now + 0.1, 'sine', 130 * p, 48 * p, 0.11, 0.38);
  }

  public playHideRustle(): void {
    const dest = this.beginPlay('bandit_hide', 260, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playFilteredNoise(dest, now, 0.09, 1300, 500, 1.8, 0.18);
  }

  public playPeekChirp(): void {
    const dest = this.beginPlay('bandit_peek', 420, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.12);
    this.playTone(dest, now, 'sine', 420 * p, 640 * p, 0.075, 0.14);
  }

  public playSurrenderVoice(): void {
    const dest = this.beginPlay('bandit_surrender', 360, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.1);
    // Comedic defeated descending "으앙~"
    this.playTone(dest, now, 'triangle', 620 * p, 390 * p, 0.13, 0.2);
    this.playTone(dest, now + 0.12, 'triangle', 390 * p, 280 * p, 0.15, 0.16);
  }

  public playCameraWhoosh(): void {
    const dest = this.beginPlay('cam_whoosh', 200, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // Fast rising Doppler zoom toward camera!
    this.playFilteredNoise(dest, now, 0.17, 420, 2600, 1.3, 0.55);
    this.playTone(dest, now, 'sine', 240, 760, 0.16, 0.22);
  }

  public playCameraSplat(volumeMul = 1.0): void {
    const dest = this.beginPlay('cam_splat', 200, 'env');
    if (!dest || volumeMul <= 0.01) return;
    const now = this.ctx!.currentTime;
    const v = Math.min(1.4, volumeMul);

    // Briefly duck combat bus to highlight the hilarious SPLAT!
    if (this.combatGain) {
      const cur = Math.max(0.05, this.tuning.audioVolume);
      this.combatGain.gain.setTargetAtTime(cur * 0.35, now, 0.01);
      this.combatGain.gain.setTargetAtTime(cur, now + 0.75, 0.12);
    }

    // Wet comedic face-on-glass SPLAT!
    this.playTone(dest, now, 'sine', 210, 52, 0.16, 0.78 * v);
    this.playFilteredNoise(dest, now, 0.12, 1900, 320, 0.9, 0.72 * v);
    this.playTone(dest, now + 0.015, 'triangle', 540, 140, 0.1, 0.32 * v);
  }

  public playCameraSqueak(volumeMul = 1.0): void {
    const dest = this.beginPlay('cam_squeak', 200, 'env');
    if (!dest || volumeMul <= 0.01) return;
    const now = this.ctx!.currentTime;
    const v = Math.min(1.4, volumeMul);
    // Long rubbery glass-sliding SQUEEEAAAK!
    this.playTone(dest, now, 'sine', 1380, 920, 0.24, 0.22 * v);
    this.playTone(dest, now + 0.22, 'sine', 1120, 720, 0.28, 0.2 * v);
    this.playTone(dest, now + 0.44, 'triangle', 840, 520, 0.18, 0.14 * v);
  }

  public playCameraRelease(): void {
    const dest = this.beginPlay('cam_release', 200, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'sine', 260, 120, 0.09, 0.26);
  }

  // ==================== STEP 5 HERO-SPECIFIC SOUNDS ====================

  public playGuandaoSweep(): void {
    const dest = this.beginPlay('gy_sweep', 70, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.07);
    // Broad heavy crescent blade wind sweep
    this.playFilteredNoise(dest, now, 0.19, 820 * p, 240 * p, 1.4, 0.52);
    this.playTone(dest, now, 'triangle', 290 * p, 115 * p, 0.15, 0.28);
  }

  public playCycloneSpin(): void {
    const dest = this.beginPlay('gy_cyclone', 140, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // Deep dragon-wind spinning blade cyclone!
    this.playFilteredNoise(dest, now, 0.34, 1400, 320, 1.1, 0.62);
    this.playTone(dest, now, 'sawtooth', 220, 440, 0.18, 0.22);
    this.playTone(dest, now + 0.16, 'triangle', 440, 140, 0.2, 0.32);
  }

  public playBowRelease(): void {
    const dest = this.beginPlay('hz_bow', 55, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.09);
    // Crisp bowstring twang + arrow whistle!
    this.playTone(dest, now, 'triangle', 540 * p, 190 * p, 0.08, 0.28);
    this.playFilteredNoise(dest, now + 0.01, 0.09, 3200 * p, 1400 * p, 2.6, 0.26);
  }

  public playArrowHit(): void {
    const dest = this.beginPlay('hz_arrow_hit', 35, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.09);
    // Snappy piercing thwip-thunk!
    this.playFilteredNoise(dest, now, 0.045, 2900 * p, 1100 * p, 1.8, 0.42);
    this.playTone(dest, now, 'sine', 280 * p, 95 * p, 0.065, 0.36);
  }

  public playArrowBurst(): void {
    const dest = this.beginPlay('hz_burst', 140, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // Multi-arrow rapid volley fanfare!
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.045;
      this.playTone(dest, t, 'triangle', 620 + i * 90, 220, 0.075, 0.26);
      this.playFilteredNoise(dest, t, 0.08, 3600, 1500, 2.2, 0.24);
    }
  }

  public playWhiteDragonStrike(): void {
    const dest = this.beginPlay('zy_dragon_strike', 55, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    this.playFilteredNoise(dest, now, 0.09, 2800 * p, 900 * p, 1.8, 0.44);
    this.playTone(dest, now, 'triangle', 760 * p, 340 * p, 0.09, 0.26);
  }

  // ==================== STEP 6 STAGE, BOSS, TREASURE & ADAPTIVE BGM ====================

  private musicIntensity: 'CALM' | 'WAVE_LIGHT' | 'WAVE_INTENSE' | 'BOSS' | 'VICTORY' | 'DEFEAT' = 'CALM';
  private bgmStepTimerMs = 0;
  private bgmStepIndex = 0;

  public setMusicIntensity(
    intensity: 'CALM' | 'WAVE_LIGHT' | 'WAVE_INTENSE' | 'BOSS' | 'VICTORY' | 'DEFEAT',
  ): void {
    if (this.musicIntensity !== intensity) {
      this.musicIntensity = intensity;
      this.bgmStepTimerMs = 0;
      this.bgmStepIndex = 0;
    }
  }

  public updateAdaptiveBgm(deltaMs: number): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.musicGain) return;
    if (this.tuning.audioVolume <= 0.001) return;
    if (
      this.musicIntensity === 'CALM' ||
      this.musicIntensity === 'VICTORY' ||
      this.musicIntensity === 'DEFEAT'
    ) {
      return;
    }

    const stepMs =
      this.musicIntensity === 'BOSS'
        ? 185
        : this.musicIntensity === 'WAVE_INTENSE'
          ? 220
          : 270;

    this.bgmStepTimerMs += Math.min(deltaMs, 60);
    if (this.bgmStepTimerMs < stepMs) return;
    this.bgmStepTimerMs -= stepMs;

    const now = this.ctx.currentTime;
    const scale =
      this.musicIntensity === 'BOSS'
        ? [110, 130.8, 146.8, 164.8, 196, 146.8, 130.8, 110]
        : [146.8, 164.8, 196, 220, 293.7, 220, 196, 164.8];
    const freq = scale[this.bgmStepIndex % scale.length];
    const accent = this.bgmStepIndex % 4 === 0;

    this.playTone(
      this.musicGain,
      now,
      this.musicIntensity === 'BOSS' ? 'sawtooth' : 'triangle',
      freq,
      freq * 0.98,
      stepMs * 0.00075,
      accent ? 0.08 : 0.05,
    );

    if (accent || (this.musicIntensity !== 'WAVE_LIGHT' && this.bgmStepIndex % 2 === 0)) {
      this.playTone(this.musicGain, now, 'sine', accent ? 105 : 150, 42, 0.08, accent ? 0.1 : 0.06);
    }

    this.bgmStepIndex = (this.bgmStepIndex + 1) % 16;
  }

  public playStageOpen(): void {
    const dest = this.beginPlay('stage_open', 250, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // War drum + pentatonic gong
    this.playTone(dest, now, 'sine', 130, 44, 0.28, 0.55);
    this.playTone(dest, now + 0.08, 'triangle', 392, 587.3, 0.26, 0.28);
    this.playFilteredNoise(dest, now + 0.08, 0.22, 1800, 600, 1.2, 0.25);
  }

  public playWaveWarning(): void {
    const dest = this.beginPlay('wave_warning', 250, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'triangle', 293.7, 392, 0.14, 0.28);
    this.playTone(dest, now + 0.12, 'triangle', 392, 587.3, 0.18, 0.32);
  }

  public playEliteEntrance(): void {
    const dest = this.beginPlay('elite_entrance', 300, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'sawtooth', 165, 82, 0.24, 0.36);
    this.playTone(dest, now + 0.06, 'triangle', 880, 440, 0.22, 0.24);
  }

  public playBossEntrance(): void {
    const dest = this.beginPlay('boss_entrance', 400, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.18;
      this.playTone(dest, t, 'sine', 120 - i * 10, 34, 0.22, 0.65);
    }
    this.playTone(dest, now + 0.42, 'sawtooth', 140, 65, 0.35, 0.42);
  }

  public playBossHeavySlam(): void {
    const dest = this.beginPlay('boss_slam', 120, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'sine', 135, 28, 0.34, 0.85);
    this.playFilteredNoise(dest, now, 0.22, 1400, 240, 0.9, 0.68);
  }

  public playBossRoar(): void {
    const dest = this.beginPlay('boss_roar', 300, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'sawtooth', 190, 78, 0.38, 0.45);
    this.playFilteredNoise(dest, now, 0.34, 900, 320, 1.5, 0.36);
  }

  public playBossStagger(): void {
    const dest = this.beginPlay('boss_stagger', 200, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'triangle', 520, 180, 0.18, 0.42);
    this.playTone(dest, now + 0.08, 'sine', 240, 640, 0.16, 0.28);
  }

  public playBossDefeat(): void {
    const dest = this.beginPlay('boss_defeat', 500, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'sine', 150, 26, 0.45, 0.9);
    this.playFilteredNoise(dest, now, 0.32, 2600, 300, 0.9, 0.72);
    this.playTone(dest, now + 0.12, 'triangle', 740, 180, 0.38, 0.32);
  }

  public playTreasurePickup(): void {
    const dest = this.beginPlay('treasure_pickup', 120, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.playTone(dest, now + i * 0.055, 'triangle', f, f * 1.02, 0.14, 0.28);
    });
  }

  public playUpgradeConfirm(): void {
    const dest = this.beginPlay('upgrade_confirm', 150, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((f, i) => {
      this.playTone(dest, now + i * 0.05, 'triangle', f, f, 0.18, 0.32);
    });
  }

  public playComboMilestone(): void {
    const dest = this.beginPlay('combo_milestone', 220, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    this.playTone(dest, now, 'triangle', 659.25, 987.77, 0.12, 0.26);
  }

  public playVictoryFanfare(): void {
    const dest = this.beginPlay('victory_fanfare', 800, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const melody = [
      { f: 523.25, t: 0, d: 0.12 },
      { f: 659.25, t: 0.11, d: 0.12 },
      { f: 783.99, t: 0.22, d: 0.14 },
      { f: 1046.5, t: 0.36, d: 0.38 },
    ];
    for (const n of melody) {
      this.playTone(dest, now + n.t, 'triangle', n.f, n.f, n.d, 0.36);
      this.playTone(dest, now + n.t, 'sine', n.f * 0.5, n.f * 0.5, n.d, 0.22);
    }
  }

  public playDefeatSting(): void {
    const dest = this.beginPlay('defeat_sting', 800, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const notes = [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => {
      this.playTone(dest, now + i * 0.16, 'sawtooth', f, f * 0.96, 0.22, 0.24);
    });
  }

  public playGuardBlock(): void {
    const dest = this.beginPlay('guard_block', 55, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    // Crisp metallic shield clang + spark chime!
    this.playTone(dest, now, 'triangle', 1240 * p, 680 * p, 0.14, 0.38);
    this.playTone(dest, now + 0.01, 'sine', 1860 * p, 1120 * p, 0.11, 0.24);
    this.playFilteredNoise(dest, now, 0.06, 4200 * p, 1400 * p, 2.2, 0.42);
  }

  public playHeroDizzy(): void {
    const dest = this.beginPlay('hero_dizzy', 280, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.08);
    // Comedic spinning-stars cartoon dizzy warble!
    this.playTone(dest, now, 'sine', 540 * p, 820 * p, 0.11, 0.24);
    this.playTone(dest, now + 0.1, 'sine', 820 * p, 460 * p, 0.11, 0.22);
    this.playTone(dest, now + 0.2, 'triangle', 460 * p, 740 * p, 0.12, 0.2);
  }

  public playPowerUpBurst(): void {
    const dest = this.beginPlay('power_up_burst', 180, 'combat');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    // Heroic rising elemental power-up arpeggio + ki whoosh!
    const notes = [440, 554.37, 659.25, 880, 1174.66];
    notes.forEach((f, i) => {
      this.playTone(dest, now + i * 0.045, 'triangle', f, f * 1.03, 0.18, 0.3);
    });
    this.playFilteredNoise(dest, now, 0.22, 900, 3200, 1.4, 0.28);
  }

  public playWreckageKick(): void {
    const dest = this.beginPlay('wreckage_kick', 95, 'env');
    if (!dest) return;
    const now = this.ctx!.currentTime;
    const p = this.vary(1.0, 0.14);
    this.playTone(dest, now, 'triangle', 260 * p, 115 * p, 0.075, 0.24);
    this.playFilteredNoise(dest, now, 0.055, 1900 * p, 620 * p, 1.8, 0.22);
  }

  // ==================== INTERNAL AUDIO ENGINE ====================

  private beginPlay(
    channel: SoundChannel,
    cooldownMs: number,
    bus: 'combat' | 'env',
  ): GainNode | null {
    const vol =
      bus === 'env'
        ? this.mayhemTuning?.envSfxVolume ?? this.tuning.audioVolume
        : this.tuning.audioVolume;
    if (vol <= 0.001) return null;

    if (!this.ctx || this.ctx.state !== 'running') return null;

    const dest = bus === 'env' ? this.envGain : this.combatGain;
    if (!dest) return null;

    const nowMs = performance.now();
    const last = this.lastPlayedAt.get(channel) ?? -Infinity;
    if (nowMs - last < cooldownMs) return null;
    this.lastPlayedAt.set(channel, nowMs);
    this.syncVolume();
    return dest;
  }

  private playTone(
    dest: GainNode,
    startTime: number,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    durationSec: number,
    peakGain: number,
  ): void {
    if (!this.ctx) return;
    const maxVoices = this.polish?.maxAudioVoices ?? 20;
    if (this.activeVoices >= maxVoices) return;

    this.activeVoices += 1;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + durationSec);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(dest);
    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.01);
  }

  private playFilteredNoise(
    dest: GainNode,
    startTime: number,
    durationSec: number,
    startFreq: number,
    endFreq: number,
    q: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const maxVoices = this.polish?.maxAudioVoices ?? 20;
    if (this.activeVoices >= maxVoices) return;

    this.activeVoices += 1;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(q, startTime);
    filter.frequency.setValueAtTime(Math.max(80, startFreq), startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), startTime + durationSec);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(startTime);
    src.stop(startTime + durationSec + 0.01);
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private vary(base: number, spread: number): number {
    return base * (1 + (Math.random() * 2 - 1) * spread);
  }

  public destroy(): void {
    if (this.unlockBound) {
      window.removeEventListener('keydown', this.unlockBound);
      window.removeEventListener('pointerdown', this.unlockBound);
      this.unlockBound = undefined;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = undefined;
    }
    this.masterGain = undefined;
    this.combatGain = undefined;
    this.envGain = undefined;
    this.voiceGain = undefined;
    this.musicGain = undefined;
    this.uiGain = undefined;
    this.compressor = undefined;
    this.noiseBuffer = undefined;
    this.activeVoices = 0;
  }
}
