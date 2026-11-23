export interface PerfSnapshot {
  avgFps: number;
  medianFrameMs: number;
  p95FrameMs: number;
  maxSpikeMs: number;
  longFrameCount: number;
  activeEnemies: number;
  activeProjectiles: number;
  activeParticles: number;
  activeAudioVoices: number;
}

/**
 * Lightweight zero-allocation ring-buffer performance monitor.
 * Computes rolling P50/P95/Max frame times and long-frame spike counts
 * without creating per-frame garbage during combat.
 */
export class PerformanceMonitor {
  private readonly capacity: number;
  private readonly samples: Float32Array;
  private readonly scratch: Float32Array;
  private cursor = 0;
  private count = 0;
  private longFrames = 0;

  constructor(windowSize = 120) {
    this.capacity = Math.max(16, windowSize);
    this.samples = new Float32Array(this.capacity);
    this.scratch = new Float32Array(this.capacity);
  }

  public recordFrame(deltaMs: number): void {
    const clamped = Math.max(0.1, Math.min(250, deltaMs));
    this.samples[this.cursor] = clamped;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    if (clamped > 22) this.longFrames += 1;
  }

  public getSnapshot(counts: {
    activeEnemies: number;
    activeProjectiles: number;
    activeParticles: number;
    activeAudioVoices: number;
  }): PerfSnapshot {
    if (this.count === 0) {
      return {
        avgFps: 60,
        medianFrameMs: 16.7,
        p95FrameMs: 16.7,
        maxSpikeMs: 16.7,
        longFrameCount: 0,
        ...counts,
      };
    }

    let sum = 0;
    let maxVal = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.samples[i];
      this.scratch[i] = v;
      sum += v;
      if (v > maxVal) maxVal = v;
    }

    const view = this.scratch.subarray(0, this.count);
    view.sort();

    const avgMs = sum / this.count;
    const medianFrameMs = view[Math.floor(this.count * 0.5)];
    const p95FrameMs = view[Math.min(this.count - 1, Math.floor(this.count * 0.95))];

    return {
      avgFps: avgMs > 0 ? Math.min(240, 1000 / avgMs) : 60,
      medianFrameMs,
      p95FrameMs,
      maxSpikeMs: maxVal,
      longFrameCount: this.longFrames,
      ...counts,
    };
  }

  public reset(): void {
    this.cursor = 0;
    this.count = 0;
    this.longFrames = 0;
  }
}
