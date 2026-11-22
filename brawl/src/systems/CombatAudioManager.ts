import { CombatTuning } from '../config/combatConfig';
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
  | 'enemy_defeat';

/**
 * Procedural Web Audio API combat sound engine.
 * Designed for crisp 16-bit arcade feel with pitch variation, multi-layering,
 * master dynamic compression (zero clipping), and cooldown throttling.
 */
export class CombatAudioManager implements IAudioSystem {
  public readonly id = 'audio';

  private readonly tuning: CombatTuning;
  private ctx?: AudioContext;
  private masterGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private noiseBuffer?: AudioBuffer;
  private readonly lastPlayedAt = new Map<SoundChannel, number>();
  private unlockBound?: () => void;

  constructor(tuning: CombatTuning) {
    this.tuning = tuning;
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
      this.masterGain.gain.setValueAtTime(this.tuning.audioVolume, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public syncVolume(): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1.5, this.tuning.audioVolume)),
      this.ctx.currentTime,
      0.015,
    );
  }

  public playLightWhoosh(): void {
    if (!this.beginPlay('light_whoosh', 45)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.09);
    this.playFilteredNoise(now, 0.095, 1600 * pitch, 650 * pitch, 2.2, 0.28);
    this.playTone(now, 'triangle', 520 * pitch, 210 * pitch, 0.07, 0.1);
  }

  public playStrongWhoosh(): void {
    if (!this.beginPlay('strong_whoosh', 70)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.07);
    this.playFilteredNoise(now, 0.18, 1200 * pitch, 320 * pitch, 1.8, 0.44);
    this.playTone(now, 'sawtooth', 360 * pitch, 110 * pitch, 0.14, 0.14);
  }

  public playLightImpact(): void {
    if (!this.beginPlay('light_impact', 30)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.08);
    // Sharp initial slap transient
    this.playFilteredNoise(now, 0.045, 2400 * pitch, 900 * pitch, 1.2, 0.45);
    // Snappy body thump
    this.playTone(now, 'triangle', 220 * pitch, 72 * pitch, 0.075, 0.42);
  }

  public playComboFinisherImpact(): void {
    if (!this.beginPlay('finisher_impact', 40)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.07);
    // 1. Sharp metallic/air transient
    this.playFilteredNoise(now, 0.07, 3200 * pitch, 700 * pitch, 1.4, 0.56);
    // 2. Deep punchy body impact
    this.playTone(now, 'sine', 190 * pitch, 48 * pitch, 0.14, 0.62);
    // 3. Crisp spear ring accent
    this.playTone(now + 0.008, 'triangle', 740 * pitch, 380 * pitch, 0.09, 0.18);
  }

  public playHeavyImpact(): void {
    if (!this.beginPlay('heavy_impact', 45)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.06);
    // 1. Sharp crack transient
    this.playFilteredNoise(now, 0.11, 3600 * pitch, 500 * pitch, 1.1, 0.72);
    // 2. Deep sub-bass body impact
    this.playTone(now, 'sine', 160 * pitch, 36 * pitch, 0.21, 0.85);
    // 3. Mid-range crunch punch
    this.playTone(now, 'sawtooth', 260 * pitch, 68 * pitch, 0.12, 0.28);
    // 4. Metallic spear shimmer
    this.playTone(now + 0.01, 'triangle', 920 * pitch, 460 * pitch, 0.13, 0.22);
  }

  public playEnemyHurt(heavy = false): void {
    if (!this.beginPlay('enemy_hurt', 45)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.12);
    if (heavy) {
      // Cartoon high-to-low knockback yelp
      this.playTone(now + 0.015, 'square', 560 * pitch, 210 * pitch, 0.16, 0.16);
      this.playTone(now + 0.02, 'triangle', 420 * pitch, 160 * pitch, 0.17, 0.2);
    } else {
      // Quick comic grunt
      this.playTone(now + 0.01, 'square', 380 * pitch, 230 * pitch, 0.08, 0.12);
    }
  }

  public playKnockdownLanding(): void {
    if (!this.beginPlay('knockdown_land', 50)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.08);
    // Dull cobblestone slam
    this.playTone(now, 'sine', 125 * pitch, 42 * pitch, 0.13, 0.52);
    // Short dusty scrape
    this.playFilteredNoise(now, 0.085, 850 * pitch, 280 * pitch, 1.1, 0.3);
  }

  public playFootstep(): void {
    if (!this.beginPlay('footstep', 135)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.12);
    this.playFilteredNoise(now, 0.032, 950 * pitch, 420 * pitch, 1.8, 0.1);
  }

  public playEnemyWhoosh(): void {
    if (!this.beginPlay('enemy_whoosh', 90)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.1);
    this.playFilteredNoise(now, 0.11, 780 * pitch, 260 * pitch, 1.6, 0.22);
  }

  public playPlayerHurt(): void {
    if (!this.beginPlay('player_hurt', 110)) return;
    const now = this.ctx!.currentTime;
    const pitch = this.vary(1.0, 0.06);
    // Armored clang + low thud
    this.playTone(now, 'sawtooth', 190 * pitch, 65 * pitch, 0.14, 0.45);
    this.playTone(now, 'square', 620 * pitch, 290 * pitch, 0.08, 0.18);
    this.playFilteredNoise(now, 0.06, 1800, 600, 1.5, 0.25);
  }

  public playEnemyDefeat(): void {
    if (!this.beginPlay('enemy_defeat', 70)) return;
    const now = this.ctx!.currentTime;
    // Crisp 16-bit arcade KO fanfare chirp
    this.playTone(now, 'triangle', 523.25, 523.25, 0.075, 0.24);
    this.playTone(now + 0.065, 'triangle', 659.25, 659.25, 0.08, 0.26);
    this.playTone(now + 0.13, 'triangle', 783.99, 1046.5, 0.14, 0.28);
  }

  private beginPlay(channel: SoundChannel, cooldownMs: number): boolean {
    if (this.tuning.audioVolume <= 0.001) return false;
    this.ensureUnlocked();
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return false;

    const nowMs = performance.now();
    const last = this.lastPlayedAt.get(channel) ?? -Infinity;
    if (nowMs - last < cooldownMs) return false;
    this.lastPlayedAt.set(channel, nowMs);
    this.syncVolume();
    return true;
  }

  private playTone(
    startTime: number,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    durationSec: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + durationSec);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.01);
  }

  private playFilteredNoise(
    startTime: number,
    durationSec: number,
    startFreq: number,
    endFreq: number,
    q: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
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
    gain.connect(this.masterGain);
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
    this.compressor = undefined;
    this.noiseBuffer = undefined;
  }
}
