import type { IGameSystem } from './ModuleRegistry';

/**
 * Coordinates enemy group attacks so bandits don't all swing simultaneously
 * or collapse onto a single horizontal line.
 */
export class CombatCoordinator implements IGameSystem {
  public readonly id = 'combat-coordinator';

  private readonly maxConcurrentAttackers = 1;
  private readonly minAttackStaggerMs = 680;
  private readonly activeAttackers = new Set<string>();
  private staggerCooldownMs = 0;

  public update(_time: number, delta: number): void {
    if (this.staggerCooldownMs > 0) {
      this.staggerCooldownMs = Math.max(0, this.staggerCooldownMs - Math.min(delta, 50));
    }
  }

  public requestAttackToken(enemyId: string): boolean {
    if (this.activeAttackers.has(enemyId)) return true;
    if (this.staggerCooldownMs > 0) return false;
    if (this.activeAttackers.size >= this.maxConcurrentAttackers) return false;

    this.activeAttackers.add(enemyId);
    this.staggerCooldownMs = this.minAttackStaggerMs;
    return true;
  }

  public releaseAttackToken(enemyId: string): void {
    this.activeAttackers.delete(enemyId);
  }

  /**
   * Assigns spread-out flanking positions around the player across multiple
   * depth lanes so enemies approach from diverse angles instead of one row.
   */
  public getFlankOffset(slotIndex: number): { ox: number; oy: number } {
    const slots: Array<{ ox: number; oy: number }> = [
      { ox: -58, oy: -28 }, // Back-left
      { ox: 60, oy: -24 },  // Back-right
      { ox: -68, oy: 18 },  // Front-left
      { ox: 68, oy: 22 },   // Front-right
      { ox: -22, oy: -46 }, // Rear center-left
      { ox: 26, oy: 42 },   // Foreground center-right
    ];
    return slots[((slotIndex % slots.length) + slots.length) % slots.length];
  }

  public reset(): void {
    this.activeAttackers.clear();
    this.staggerCooldownMs = 250;
  }
}
