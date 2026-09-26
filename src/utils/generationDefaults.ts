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
  latitude: 37.7749,
  longitude: -122.4194,
  timeZone: 'America/Los_Angeles',
  elevationM: 16,
};

export const DEFAULT_SOLAR_ASSET: SolarGenerationAsset = {
  id: 'solar-default',
  name: 'Rooftop Solar PV Array',
  enabled: true,
  type: 'solar',
  installedCostUsd: 18000,
  annualMaintenanceCostUsd: 150,

  dcCapacityKw: 8.0,
  tiltDegrees: 25,
  azimuthDegrees: 180, // South

  inverterAcCapacityKw: 7.6,
  inverterEfficiencyPercent: 97.0,

  systemLossPercent: 14.0,
  shadingLossPercent: 3.0,

  annualDegradationPercent: 0.5,

  resourceMode: 'monthly_peak_sun_hours',
  monthlyPeakSunHoursPerDay: [
    3.2, // Jan
    3.9, // Feb
    5.1, // Mar
    6.0, // Apr
    6.8, // May
    7.2, // Jun
    7.4, // Jul
    6.9, // Aug
    5.8, // Sep
    4.5, // Oct
    3.5, // Nov
    2.9, // Dec
  ],
};

export const DEFAULT_WIND_ASSET: WindGenerationAsset = {
  id: 'wind-default',
  name: 'Residential Micro Wind Turbine',
  enabled: false,
  type: 'wind',
  installedCostUsd: 12000,
  annualMaintenanceCostUsd: 300,

  ratedPowerKw: 5.0,
  hubHeightM: 12,
  rotorDiameterM: 4.5,

  cutInWindSpeedMps: 2.5,
  ratedWindSpeedMps: 11.0,
  cutOutWindSpeedMps: 20.0,

  availabilityPercent: 95.0,
  systemLossPercent: 8.0,

  resourceMode: 'annual_average',

  measurementHeightM: 10,
  windShearExponent: 0.2,

  annualAverageWindSpeedMps: 4.8,
  monthlyAverageWindSpeedMps: [
    4.5, 4.8, 5.2, 5.5, 5.3, 4.9,
    4.4, 4.2, 4.5, 4.7, 4.9, 4.6,
  ],

  powerCurve: [
    { windSpeedMps: 0.0, outputKw: 0.0 },
    { windSpeedMps: 2.5, outputKw: 0.0 },
    { windSpeedMps: 4.0, outputKw: 0.4 },
    { windSpeedMps: 6.0, outputKw: 1.2 },
    { windSpeedMps: 8.0, outputKw: 2.6 },
    { windSpeedMps: 10.0, outputKw: 4.3 },
    { windSpeedMps: 11.0, outputKw: 5.0 },
    { windSpeedMps: 15.0, outputKw: 5.0 },
    { windSpeedMps: 20.0, outputKw: 5.0 },
  ],
};

export const DEFAULT_GENERATOR_ASSET: GeneratorGenerationAsset = {
  id: 'generator-default',
  name: 'Standby Natural Gas Generator',
  enabled: false,
  type: 'generator',
  installedCostUsd: 8500,
  annualMaintenanceCostUsd: 250,

  ratedContinuousKw: 10.0,
  minimumStableLoadPercent: 20.0,

  fuelType: 'natural_gas',
  fuelUnit: 'therm',
  fuelCostPerUnit: 1.45,

  fuelCurve: [
    { loadPercent: 0, fuelUnitsPerHour: 0.4 },
    { loadPercent: 25, fuelUnitsPerHour: 0.9 },
    { loadPercent: 50, fuelUnitsPerHour: 1.4 },
    { loadPercent: 75, fuelUnitsPerHour: 1.9 },
    { loadPercent: 100, fuelUnitsPerHour: 2.5 },
  ],

  dispatchMode: 'standby',

  allowBatteryCharging: true,
  allowGridExport: false,
};

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  site: DEFAULT_GENERATION_SITE,
  assets: [
    DEFAULT_SOLAR_ASSET,
    DEFAULT_WIND_ASSET,
    DEFAULT_GENERATOR_ASSET,
  ],
};

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
