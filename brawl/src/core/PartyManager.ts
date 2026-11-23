import {
  ALL_HERO_IDS,
  type HeroId,
  type PartySlotConfig,
  type SlotControlType,
} from '../config/heroConfig.ts';

export interface OwnershipTransferResult {
  success: boolean;
  reason?: string;
  slotIndex?: number;
  heroId?: HeroId;
  mode?: 'TOOK_OVER_AI' | 'SPAWNED_NEW' | 'RETURNED_TO_AI';
}

/**
 * Authoritative flexible party manager (1 to 4 active heroes).
 * Unused slots remain strictly EMPTY unless explicitly configured as HUMAN or AI.
 * Guarantees no two players ever control the same hero.
 */
export class PartyManager {
  public readonly slots: PartySlotConfig[] = [];

  constructor(initialSlots?: PartySlotConfig[]) {
    if (initialSlots && initialSlots.length === 4) {
      this.slots = initialSlots.map((s) => ({ ...s }));
    } else {
      // Default flexible start: 1 Human (Zhao Yun) + 3 AI companions (Guan Yu, Zhang Fei, Huang Zhong)
      // Easily configurable to Solo (1H+0AI), 2P, 3P, or 4P via PartySetupOverlay!
      this.slots = [
        { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' },
        { slotIndex: 1, control: 'AI', heroId: 'guanyu', deviceId: null },
        { slotIndex: 2, control: 'AI', heroId: 'zhangfei', deviceId: null },
        { slotIndex: 3, control: 'AI', heroId: 'huangzhong', deviceId: null },
      ];
    }
    this.normalize();
  }

  public get activeSlots(): PartySlotConfig[] {
    return this.slots.filter((s) => s.control !== 'EMPTY' && s.heroId !== null);
  }

  public get humanSlots(): PartySlotConfig[] {
    return this.slots.filter((s) => s.control === 'HUMAN' && s.heroId !== null);
  }

  public get aiSlots(): PartySlotConfig[] {
    return this.slots.filter((s) => s.control === 'AI' && s.heroId !== null);
  }

  public get activeHeroCount(): number {
    return this.activeSlots.length;
  }

  public get humanPlayerCount(): number {
    return this.humanSlots.length;
  }

  public getSlotByHero(heroId: HeroId): PartySlotConfig | undefined {
    return this.slots.find((s) => s.control !== 'EMPTY' && s.heroId === heroId);
  }

  public getSlotByDevice(deviceId: string): PartySlotConfig | undefined {
    return this.slots.find((s) => s.control === 'HUMAN' && s.deviceId === deviceId);
  }

  public getUnassignedHeroes(): HeroId[] {
    const used = new Set(this.activeSlots.map((s) => s.heroId));
    return ALL_HERO_IDS.filter((id) => !used.has(id));
  }

  public setPreset(preset: 'SOLO' | 'DUO_AI' | 'FULL_AI' | 'LOCAL_2P' | 'LOCAL_4P'): void {
    switch (preset) {
      case 'SOLO':
        this.slots[0] = { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' };
        this.slots[1] = { slotIndex: 1, control: 'EMPTY', heroId: null, deviceId: null };
        this.slots[2] = { slotIndex: 2, control: 'EMPTY', heroId: null, deviceId: null };
        this.slots[3] = { slotIndex: 3, control: 'EMPTY', heroId: null, deviceId: null };
        break;
      case 'DUO_AI':
        this.slots[0] = { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' };
        this.slots[1] = { slotIndex: 1, control: 'AI', heroId: 'zhangfei', deviceId: null };
        this.slots[2] = { slotIndex: 2, control: 'EMPTY', heroId: null, deviceId: null };
        this.slots[3] = { slotIndex: 3, control: 'EMPTY', heroId: null, deviceId: null };
        break;
      case 'FULL_AI':
        this.slots[0] = { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' };
        this.slots[1] = { slotIndex: 1, control: 'AI', heroId: 'guanyu', deviceId: null };
        this.slots[2] = { slotIndex: 2, control: 'AI', heroId: 'zhangfei', deviceId: null };
        this.slots[3] = { slotIndex: 3, control: 'AI', heroId: 'huangzhong', deviceId: null };
        break;
      case 'LOCAL_2P':
        this.slots[0] = { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' };
        this.slots[1] = { slotIndex: 1, control: 'HUMAN', heroId: 'zhangfei', deviceId: 'gamepad:0' };
        this.slots[2] = { slotIndex: 2, control: 'EMPTY', heroId: null, deviceId: null };
        this.slots[3] = { slotIndex: 3, control: 'EMPTY', heroId: null, deviceId: null };
        break;
      case 'LOCAL_4P':
        this.slots[0] = { slotIndex: 0, control: 'HUMAN', heroId: 'zhaoyun', deviceId: 'keyboard' };
        this.slots[1] = { slotIndex: 1, control: 'HUMAN', heroId: 'guanyu', deviceId: 'gamepad:0' };
        this.slots[2] = { slotIndex: 2, control: 'HUMAN', heroId: 'zhangfei', deviceId: 'gamepad:1' };
        this.slots[3] = { slotIndex: 3, control: 'HUMAN', heroId: 'huangzhong', deviceId: 'gamepad:2' };
        break;
    }
    this.normalize();
  }

  public setSlot(
    slotIndex: number,
    control: SlotControlType,
    heroId: HeroId | null,
    deviceId?: string | null,
  ): boolean {
    if (slotIndex < 0 || slotIndex >= 4) return false;

    if (control === 'EMPTY' || heroId === null) {
      // Never allow zero human players if this is the last human slot
      const otherHumans = this.slots.filter(
        (s) => s.slotIndex !== slotIndex && s.control === 'HUMAN',
      ).length;
      if (otherHumans === 0) return false;

      this.slots[slotIndex] = {
        slotIndex,
        control: 'EMPTY',
        heroId: null,
        deviceId: null,
      };
      return true;
    }

    // Prevent duplicate hero assignment
    const conflict = this.slots.find(
      (s) => s.slotIndex !== slotIndex && s.control !== 'EMPTY' && s.heroId === heroId,
    );
    if (conflict) return false;

    const assignedDevice =
      control === 'HUMAN'
        ? deviceId ??
          this.slots[slotIndex].deviceId ??
          (slotIndex === 0 ? 'keyboard' : `gamepad:${slotIndex - 1}`)
        : null;

    this.slots[slotIndex] = {
      slotIndex,
      control,
      heroId,
      deviceId: assignedDevice,
    };
    return true;
  }

  /**
   * Join-in-progress: connects a human device to either an existing AI hero
   * or spawns a new hero into an EMPTY slot (when activeHeroCount < 4).
   */
  public joinHuman(
    deviceId: string,
    preferredHeroId?: HeroId,
  ): OwnershipTransferResult {
    // Device already controls a hero
    const existing = this.getSlotByDevice(deviceId);
    if (existing && existing.heroId) {
      return {
        success: false,
        reason: 'Device already assigned',
        slotIndex: existing.slotIndex,
        heroId: existing.heroId,
      };
    }

    // 1. If preferredHeroId is currently AI-controlled -> seamless AI-to-Human transfer!
    if (preferredHeroId) {
      const targetSlot = this.getSlotByHero(preferredHeroId);
      if (targetSlot) {
        if (targetSlot.control === 'HUMAN') {
          return { success: false, reason: 'Hero already controlled by another human' };
        }
        targetSlot.control = 'HUMAN';
        targetSlot.deviceId = deviceId;
        return {
          success: true,
          slotIndex: targetSlot.slotIndex,
          heroId: preferredHeroId,
          mode: 'TOOK_OVER_AI',
        };
      }

      // Preferred hero is not yet active -> spawn into an EMPTY slot if available!
      const emptySlot = this.slots.find((s) => s.control === 'EMPTY');
      if (emptySlot) {
        emptySlot.control = 'HUMAN';
        emptySlot.heroId = preferredHeroId;
        emptySlot.deviceId = deviceId;
        return {
          success: true,
          slotIndex: emptySlot.slotIndex,
          heroId: preferredHeroId,
          mode: 'SPAWNED_NEW',
        };
      }
      return { success: false, reason: 'No empty slot available' };
    }

    // 2. No preference: prefer taking over an active AI hero first, else spawn into empty slot
    const aiSlot = this.aiSlots[0];
    if (aiSlot && aiSlot.heroId) {
      aiSlot.control = 'HUMAN';
      aiSlot.deviceId = deviceId;
      return {
        success: true,
        slotIndex: aiSlot.slotIndex,
        heroId: aiSlot.heroId,
        mode: 'TOOK_OVER_AI',
      };
    }

    const emptySlot = this.slots.find((s) => s.control === 'EMPTY');
    const freeHero = this.getUnassignedHeroes()[0];
    if (emptySlot && freeHero) {
      emptySlot.control = 'HUMAN';
      emptySlot.heroId = freeHero;
      emptySlot.deviceId = deviceId;
      return {
        success: true,
        slotIndex: emptySlot.slotIndex,
        heroId: freeHero,
        mode: 'SPAWNED_NEW',
      };
    }

    return { success: false, reason: 'Party is full (4 humans)' };
  }

  /**
   * Safely returns a disconnected or leaving human player's hero back to AI control
   * without destroying or duplicating the hero.
   */
  public releaseHumanDevice(deviceId: string): OwnershipTransferResult {
    const slot = this.getSlotByDevice(deviceId);
    if (!slot || !slot.heroId) {
      return { success: false, reason: 'Device not found' };
    }
    slot.control = 'AI';
    slot.deviceId = null;
    return {
      success: true,
      slotIndex: slot.slotIndex,
      heroId: slot.heroId,
      mode: 'RETURNED_TO_AI',
    };
  }

  /**
   * TAB quick-switch for solo play: swaps a human device from its current hero
   * onto the next active AI hero (preserving both heroes' states!).
   */
  public cycleHumanHero(deviceId: string): OwnershipTransferResult {
    const curSlot = this.getSlotByDevice(deviceId);
    if (!curSlot || !curSlot.heroId) {
      return { success: false, reason: 'No hero owned by device' };
    }

    const aiCandidates = this.aiSlots;
    if (aiCandidates.length === 0) {
      return { success: false, reason: 'No AI heroes available to swap with' };
    }

    // Pick next AI slot after curSlot.slotIndex (wrapping around)
    const nextAi =
      aiCandidates.find((s) => s.slotIndex > curSlot.slotIndex) ?? aiCandidates[0];
    if (!nextAi || !nextAi.heroId) {
      return { success: false, reason: 'No AI hero found' };
    }

    curSlot.control = 'AI';
    curSlot.deviceId = null;
    nextAi.control = 'HUMAN';
    nextAi.deviceId = deviceId;

    return {
      success: true,
      slotIndex: nextAi.slotIndex,
      heroId: nextAi.heroId,
      mode: 'TOOK_OVER_AI',
    };
  }

  private normalize(): void {
    const seen = new Set<HeroId>();
    for (const slot of this.slots) {
      if (slot.control === 'EMPTY' || !slot.heroId) {
        slot.control = 'EMPTY';
        slot.heroId = null;
        slot.deviceId = null;
        continue;
      }
      if (seen.has(slot.heroId)) {
        slot.control = 'EMPTY';
        slot.heroId = null;
        slot.deviceId = null;
        continue;
      }
      seen.add(slot.heroId);
      if (slot.control === 'AI') {
        slot.deviceId = null;
      }
    }

    // Guarantee at least 1 human hero exists
    if (this.humanSlots.length === 0) {
      const firstActive = this.activeSlots[0];
      if (firstActive) {
        firstActive.control = 'HUMAN';
        firstActive.deviceId = 'keyboard';
      } else {
        this.slots[0] = {
          slotIndex: 0,
          control: 'HUMAN',
          heroId: 'zhaoyun',
          deviceId: 'keyboard',
        };
      }
    }
  }
}
