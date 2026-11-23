export type EnvObjectKind =
  | 'table'
  | 'barrel_water'
  | 'barrel_empty'
  | 'ceramic_jar'
  | 'fruit_basket';

export type HazardKind = 'water_puddle' | 'spilled_food' | 'banana_peel';

export interface EnvObjectSpec {
  readonly kind: EnvObjectKind;
  readonly label: string;
  readonly mass: number;
  readonly radius: number;
  readonly durability: number;
  readonly pickupable: boolean;
  readonly rollable: boolean;
  readonly carrySpeedFactor: number;
  readonly impactDamage: number;
  readonly knockbackForce: number;
  readonly launchVz: number;
  readonly material: 'wood' | 'ceramic' | 'fruit';
  readonly containsWater: boolean;
  readonly spillsFood: boolean;
}

export const ENV_OBJECT_SPECS: Record<EnvObjectKind, EnvObjectSpec> = {
  table: {
    kind: 'table',
    label: '나무 탁자',
    mass: 2.4,
    radius: 36,
    durability: 3,
    pickupable: true,
    rollable: false,
    carrySpeedFactor: 0.80,
    impactDamage: 38,
    knockbackForce: 470,
    launchVz: 265,
    material: 'wood',
    containsWater: false,
    spillsFood: false,
  },
  barrel_water: {
    kind: 'barrel_water',
    label: '물통',
    mass: 2.0,
    radius: 25,
    durability: 2,
    pickupable: false,
    rollable: true,
    carrySpeedFactor: 0.84,
    impactDamage: 26,
    knockbackForce: 340,
    launchVz: 170,
    material: 'wood',
    containsWater: true,
    spillsFood: false,
  },
  barrel_empty: {
    kind: 'barrel_empty',
    label: '나무 상자',
    mass: 1.7,
    radius: 25,
    durability: 2,
    pickupable: true,
    rollable: true,
    carrySpeedFactor: 0.86,
    impactDamage: 24,
    knockbackForce: 310,
    launchVz: 155,
    material: 'wood',
    containsWater: false,
    spillsFood: false,
  },
  ceramic_jar: {
    kind: 'ceramic_jar',
    label: '도자기 항아리',
    mass: 0.9,
    radius: 22,
    durability: 1,
    pickupable: true,
    rollable: false,
    carrySpeedFactor: 0.94,
    impactDamage: 24,
    knockbackForce: 240,
    launchVz: 125,
    material: 'ceramic',
    containsWater: false,
    spillsFood: false,
  },
  fruit_basket: {
    kind: 'fruit_basket',
    label: '과일 바구니',
    mass: 1.1,
    radius: 23,
    durability: 1,
    pickupable: true,
    rollable: false,
    carrySpeedFactor: 0.92,
    impactDamage: 20,
    knockbackForce: 210,
    launchVz: 110,
    material: 'fruit',
    containsWater: false,
    spillsFood: true,
  },
};

export interface MayhemTuning {
  objectThrowForce: number;
  objectMassMultiplier: number;
  objectDurabilityMultiplier: number;
  knockbackTransferCoeff: number;
  collisionEnergyThreshold: number;
  maxChainDepth: number;
  surfaceFriction: number;
  slipProbability: number;
  puddleDurationMs: number;
  particleIntensity: number;
  envSfxVolume: number;
  showObjectShapes: boolean;
  showActorShapes: boolean;
  showVelocityVectors: boolean;
  showWorldCoords: boolean;
  showChainCounters: boolean;
}

export function createDefaultMayhemTuning(): MayhemTuning {
  return {
    objectThrowForce: 560,
    objectMassMultiplier: 1.0,
    objectDurabilityMultiplier: 1.0,
    knockbackTransferCoeff: 0.82,
    collisionEnergyThreshold: 130,
    maxChainDepth: 4,
    surfaceFriction: 1.0,
    slipProbability: 0.78,
    puddleDurationMs: 14000,
    particleIntensity: 1.0,
    envSfxVolume: 0.85,
    showObjectShapes: false,
    showActorShapes: false,
    showVelocityVectors: false,
    showWorldCoords: false,
    showChainCounters: true,
  };
}
