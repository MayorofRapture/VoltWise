/**
 * On-Site Power Generation Default Constants and Factory Helpers (G1 Milestone)
 */
import {
  GenerationConfig,
  GenerationSite,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
  GenerationAsset,
} from '../types/energy';

export const DEFAULT_GENERATION_SITE: GenerationSite = {
  latitude: null,
  longitude: null,
  timeZone: '',
  elevationM: null,
};

export const DEFAULT_SOLAR_ASSET: SolarGenerationAsset = {
  id: 'solar-default',
  name: 'Rooftop Solar PV Array',
  enabled: true,
  type: 'solar',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  dcCapacityKw: 0,
  tiltDegrees: 20,
  azimuthDegrees: 180, // South

  inverterAcCapacityKw: 0,
  inverterEfficiencyPercent: 96.0,

  systemLossPercent: 14.0,
  shadingLossPercent: 0,

  annualDegradationPercent: 0.5,

  resourceMode: 'monthly_peak_sun_hours',
  monthlyPeakSunHoursPerDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_WIND_ASSET: WindGenerationAsset = {
  id: 'wind-default',
  name: 'Residential Wind Turbine',
  enabled: false,
  type: 'wind',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  ratedPowerKw: 0,
  hubHeightM: 10,
  rotorDiameterM: 0,

  cutInWindSpeedMps: 0,
  ratedWindSpeedMps: 0,
  cutOutWindSpeedMps: 0,

  availabilityPercent: 100.0,
  systemLossPercent: 0,

  resourceMode: 'annual_average',

  measurementHeightM: 10,
  windShearExponent: 0.14,

  annualAverageWindSpeedMps: null,
  monthlyAverageWindSpeedMps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  powerCurve: [],
};

export const DEFAULT_GENERATOR_ASSET: GeneratorGenerationAsset = {
  id: 'generator-default',
  name: 'Standby Generator',
  enabled: false,
  type: 'generator',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  ratedContinuousKw: 0,
  minimumStableLoadPercent: 0,

  fuelType: 'natural_gas',
  fuelUnit: 'therm',
  fuelCostPerUnit: null,

  fuelCurve: [],

  dispatchMode: 'standby',

  allowBatteryCharging: true,
  allowGridExport: false,
};

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  site: DEFAULT_GENERATION_SITE,
  assets: [],
};

export function createDefaultGenerationConfig(): GenerationConfig {
  return {
    site: {
      latitude: null,
      longitude: null,
      timeZone: '',
      elevationM: null,
    },
    assets: [],
  };
}

let nextAssetIdCounter = 1;

export function createDefaultSolarAsset(customName?: string): SolarGenerationAsset {
  const count = nextAssetIdCounter++;
  return {
    ...DEFAULT_SOLAR_ASSET,
    id: `solar-${Date.now()}-${count}`,
    name: customName || `Solar Array ${count}`,
    monthlyPeakSunHoursPerDay: [...DEFAULT_SOLAR_ASSET.monthlyPeakSunHoursPerDay],
  };
}

export function createDefaultWindAsset(customName?: string): WindGenerationAsset {
  const count = nextAssetIdCounter++;
  return {
    ...DEFAULT_WIND_ASSET,
    id: `wind-${Date.now()}-${count}`,
    name: customName || `Wind Turbine ${count}`,
    monthlyAverageWindSpeedMps: [...DEFAULT_WIND_ASSET.monthlyAverageWindSpeedMps],
    powerCurve: DEFAULT_WIND_ASSET.powerCurve.map((pt) => ({ ...pt })),
  };
}

export function createDefaultGeneratorAsset(customName?: string): GeneratorGenerationAsset {
  const count = nextAssetIdCounter++;
  return {
    ...DEFAULT_GENERATOR_ASSET,
    id: `generator-${Date.now()}-${count}`,
    name: customName || `Generator ${count}`,
    fuelCurve: DEFAULT_GENERATOR_ASSET.fuelCurve.map((pt) => ({ ...pt })),
  };
}

export function createDefaultAsset(type: 'solar' | 'wind' | 'generator'): GenerationAsset {
  switch (type) {
    case 'solar':
      return createDefaultSolarAsset();
    case 'wind':
      return createDefaultWindAsset();
    case 'generator':
      return createDefaultGeneratorAsset();
  }
}
