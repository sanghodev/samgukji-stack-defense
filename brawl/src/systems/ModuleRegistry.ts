import Phaser from 'phaser';
import { EventBus } from '../core/EventBus';

export interface SystemContext {
  scene: Phaser.Scene;
  events: EventBus;
}

/**
 * Base contract for all pluggable gameplay subsystems.
 */
export interface IGameSystem {
  readonly id: string;
  init?(ctx: SystemContext): void;
  update?(time: number, delta: number): void;
  destroy?(): void;
}

/**
 * Reserved interfaces for future milestones:
 * Combat, Enemy AI, Environmental Destruction, Audio, and Multiplayer.
 */
export interface ICombatSystem extends IGameSystem {
  readonly id: 'combat';
}

export interface IEnemyAISystem extends IGameSystem {
  readonly id: 'enemy-ai';
}

export interface IDestructibleSystem extends IGameSystem {
  readonly id: 'destructibles';
}

export interface IAudioSystem extends IGameSystem {
  readonly id: 'audio';
}

export interface IMultiplayerSystem extends IGameSystem {
  readonly id: 'multiplayer';
}

/**
 * Manages lifecycle of registered modular gameplay systems.
 */
export class SystemRegistry {
  private readonly systems: IGameSystem[] = [];
  private readonly ctx: SystemContext;

  constructor(ctx: SystemContext) {
    this.ctx = ctx;
  }

  public register<T extends IGameSystem>(system: T): T {
    this.systems.push(system);
    system.init?.(this.ctx);
    return system;
  }

  public update(time: number, delta: number): void {
    for (const system of this.systems) {
      system.update?.(time, delta);
    }
  }

  public destroy(): void {
    for (const system of this.systems) {
      system.destroy?.();
    }
    this.systems.length = 0;
  }
}
