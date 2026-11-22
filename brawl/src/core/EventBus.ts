export interface GameEventMap {
  'player:moved': { x: number; y: number; vx: number; vy: number; facing: string };
  'debug:toggled': { visible: boolean };
  // Reserved hooks for upcoming systems:
  // 'combat:hit': { attackerId: string; targetId: string; damage: number };
  // 'prop:destroyed': { propId: string; x: number; y: number };
  // 'audio:play': { key: string; volume?: number };
}

type EventHandler<T> = (payload: T) => void;

/**
 * Lightweight typed event bus for decoupling gameplay systems
 * (combat, AI, destructible props, audio, multiplayer sync).
 */
export class EventBus {
  private readonly listeners = new Map<keyof GameEventMap, Set<EventHandler<unknown>>>();

  public on<K extends keyof GameEventMap>(
    event: K,
    handler: EventHandler<GameEventMap[K]>,
  ): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  public off<K extends keyof GameEventMap>(
    event: K,
    handler: EventHandler<GameEventMap[K]>,
  ): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  public emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const handler of bucket) {
      (handler as EventHandler<GameEventMap[K]>)(payload);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
