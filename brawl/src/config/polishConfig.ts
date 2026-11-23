import type { CombatTuning } from './combatConfig.ts';
import type { MayhemTuning } from './mayhemConfig.ts';
import type { Step4Tuning } from './step4Config.ts';

export type CombatFeelPresetId = 'ARCADE_CLASSIC' | 'MAXIMUM_MAYHEM' | 'CUSTOM';

export type HitStopClass = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'ENV_MAJOR' | 'FINISHER';

export type ImpactTier = 'LIGHT' | 'MEDIUM' | 'STRONG' | 'EXTREME';

export interface ImpactReactionProfile {
  readonly tier: ImpactTier;
  readonly squashX: number;
  readonly squashY: number;
  readonly bounceRestitution: number;
  readonly tumbleSpinMul: number;
  readonly landingDustScale: number;
}

export const IMPACT_REACTION_PROFILES: Record<ImpactTier, ImpactReactionProfile> = {
  LIGHT: {
    tier: 'LIGHT',
    squashX: 0.92,
    squashY: 1.08,
    bounceRestitution: 0.12,
    tumbleSpinMul: 0.65,
    landingDustScale: 0.7,
  },
  MEDIUM: {
    tier: 'MEDIUM',
    squashX: 0.85,
    squashY: 1.15,
    bounceRestitution: 0.25,
    tumbleSpinMul: 0.95,
    landingDustScale: 1.0,
  },
  STRONG: {
    tier: 'STRONG',
    squashX: 1.22,
    squashY: 0.78,
    bounceRestitution: 0.36,
    tumbleSpinMul: 1.25,
    landingDustScale: 1.35,
  },
  EXTREME: {
    tier: 'EXTREME',
    squashX: 1.34,
    squashY: 0.68,
    bounceRestitution: 0.45,
    tumbleSpinMul: 1.55,
    landingDustScale: 1.75,
  },
};

export interface PolishSettings {
  activePreset: CombatFeelPresetId;
  // Hit-stop class durations & safety cap
  lightHitStopMs: number;
  heavyHitStopMs: number;
  majorEnvHitStopMs: number;
  maxHitStopCapMs: number;
  // Camera & Accessibility
  reduceMotion: boolean;
  impactFlashStrength: number; // 0..1
  maxShakeCap: number; // px
  effectIntensity: number; // 0.3..1.3
  // Audio Bus Gains & Mixing
  masterVolume: number;
  combatVolume: number;
  envVolume: number;
  voiceVolume: number;
  musicVolume: number;
  uiVolume: number;
  musicDuckingAmount: number; // 0..0.85
  maxAudioVoices: number; // 8..32
}

export function createDefaultPolishSettings(): PolishSettings {
  return {
    activePreset: 'MAXIMUM_MAYHEM',
    lightHitStopMs: 26,
    heavyHitStopMs: 62,
    majorEnvHitStopMs: 78,
    maxHitStopCapMs: 105,
    reduceMotion: false,
    impactFlashStrength: 0.65,
    maxShakeCap: 11,
    effectIntensity: 1.0,
    masterVolume: 0.9,
    combatVolume: 0.95,
    envVolume: 0.9,
    voiceVolume: 0.85,
    musicVolume: 0.55,
    uiVolume: 0.85,
    musicDuckingAmount: 0.55,
    maxAudioVoices: 20,
  };
}

/**
 * Applies either A/B Combat Feel Preset cleanly across existing tuning objects.
 * Both presets use the exact same gameplay systems and are fully playable.
 */
export function applyCombatFeelPreset(
  preset: 'ARCADE_CLASSIC' | 'MAXIMUM_MAYHEM',
  combat: CombatTuning,
  mayhem: MayhemTuning,
  step4: Step4Tuning,
  polish: PolishSettings,
): void {
  polish.activePreset = preset;

  if (preset === 'ARCADE_CLASSIC') {
    // Crisp, tight, ultra-responsive classic arcade beat-'em-up feel
    combat.hitStopScale = 0.82;
    combat.knockbackMultiplier = 0.92;
    combat.screenShakeIntensity = 0.65;
    mayhem.knockbackTransferCoeff = 0.72;
    step4.chargeKnockback = 470;
    polish.lightHitStopMs = 22;
    polish.heavyHitStopMs = 50;
    polish.majorEnvHitStopMs = 62;
    polish.maxHitStopCapMs = 85;
    polish.impactFlashStrength = 0.35;
    polish.maxShakeCap = 7;
    polish.effectIntensity = 0.85;
  } else {
    // Expressive, booming, chaotic Three Kingdoms Mayhem feel
    combat.hitStopScale = 1.08;
    combat.knockbackMultiplier = 1.12;
    combat.screenShakeIntensity = 1.05;
    mayhem.knockbackTransferCoeff = 0.92;
    step4.chargeKnockback = 540;
    polish.lightHitStopMs = 30;
    polish.heavyHitStopMs = 70;
    polish.majorEnvHitStopMs = 86;
    polish.maxHitStopCapMs = 105;
    polish.impactFlashStrength = 0.72;
    polish.maxShakeCap = 11;
    polish.effectIntensity = 1.1;
  }
}

export interface ExportedTuningBundle {
  version: 1;
  combat: Partial<CombatTuning>;
  mayhem: Partial<MayhemTuning>;
  step4: Partial<Step4Tuning>;
  polish: Partial<PolishSettings>;
}

export function serializeTuningJson(
  combat: CombatTuning,
  mayhem: MayhemTuning,
  step4: Step4Tuning,
  polish: PolishSettings,
): string {
  const bundle: ExportedTuningBundle = {
    version: 1,
    combat: {
      hitStopScale: combat.hitStopScale,
      knockbackMultiplier: combat.knockbackMultiplier,
      attackSpeedMultiplier: combat.attackSpeedMultiplier,
      screenShakeIntensity: combat.screenShakeIntensity,
      screenShakeEnabled: combat.screenShakeEnabled,
    },
    mayhem: {
      objectThrowForce: mayhem.objectThrowForce,
      knockbackTransferCoeff: mayhem.knockbackTransferCoeff,
      particleIntensity: mayhem.particleIntensity,
    },
    step4: {
      chargeKnockback: step4.chargeKnockback,
      cameraGagEnabled: step4.cameraGagEnabled,
      cameraGagCooldownMs: step4.cameraGagCooldownMs,
      cameraGagDurationMs: step4.cameraGagDurationMs,
    },
    polish: { ...polish },
  };
  return JSON.stringify(bundle, null, 2);
}

export function applyImportedTuningJson(
  rawJson: string,
  combat: CombatTuning,
  mayhem: MayhemTuning,
  step4: Step4Tuning,
  polish: PolishSettings,
): boolean {
  try {
    const parsed = JSON.parse(rawJson) as Partial<ExportedTuningBundle>;
    if (!parsed || parsed.version !== 1) return false;

    if (parsed.combat && typeof parsed.combat === 'object') {
      if (typeof parsed.combat.hitStopScale === 'number') combat.hitStopScale = Math.max(0, Math.min(2, parsed.combat.hitStopScale));
      if (typeof parsed.combat.knockbackMultiplier === 'number') combat.knockbackMultiplier = Math.max(0.4, Math.min(2, parsed.combat.knockbackMultiplier));
      if (typeof parsed.combat.attackSpeedMultiplier === 'number') combat.attackSpeedMultiplier = Math.max(0.5, Math.min(2, parsed.combat.attackSpeedMultiplier));
      if (typeof parsed.combat.screenShakeIntensity === 'number') combat.screenShakeIntensity = Math.max(0, Math.min(2, parsed.combat.screenShakeIntensity));
      if (typeof parsed.combat.screenShakeEnabled === 'boolean') combat.screenShakeEnabled = parsed.combat.screenShakeEnabled;
    }

    if (parsed.mayhem && typeof parsed.mayhem === 'object') {
      if (typeof parsed.mayhem.objectThrowForce === 'number') mayhem.objectThrowForce = Math.max(200, Math.min(1200, parsed.mayhem.objectThrowForce));
      if (typeof parsed.mayhem.knockbackTransferCoeff === 'number') mayhem.knockbackTransferCoeff = Math.max(0.2, Math.min(1.5, parsed.mayhem.knockbackTransferCoeff));
      if (typeof parsed.mayhem.particleIntensity === 'number') mayhem.particleIntensity = Math.max(0, Math.min(2, parsed.mayhem.particleIntensity));
    }

    if (parsed.step4 && typeof parsed.step4 === 'object') {
      if (typeof parsed.step4.chargeKnockback === 'number') step4.chargeKnockback = Math.max(250, Math.min(900, parsed.step4.chargeKnockback));
      if (typeof parsed.step4.cameraGagEnabled === 'boolean') step4.cameraGagEnabled = parsed.step4.cameraGagEnabled;
      if (typeof parsed.step4.cameraGagCooldownMs === 'number') step4.cameraGagCooldownMs = Math.max(2000, Math.min(60000, parsed.step4.cameraGagCooldownMs));
      if (typeof parsed.step4.cameraGagDurationMs === 'number') step4.cameraGagDurationMs = Math.max(700, Math.min(1800, parsed.step4.cameraGagDurationMs));
    }

    if (parsed.polish && typeof parsed.polish === 'object') {
      Object.assign(polish, parsed.polish);
      polish.maxHitStopCapMs = Math.max(30, Math.min(130, polish.maxHitStopCapMs));
      polish.maxShakeCap = Math.max(0, Math.min(16, polish.maxShakeCap));
      polish.maxAudioVoices = Math.max(6, Math.min(32, Math.round(polish.maxAudioVoices)));
    }
    return true;
  } catch {
    return false;
  }
}
