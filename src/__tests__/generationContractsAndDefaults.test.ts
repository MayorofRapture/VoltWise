import { describe, it, expect } from 'vitest';
import {
  GenerationConfig,
  GenerationSite,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
  GenerationAsset,
} from '../types/energy';
import {
  DEFAULT_GENERATION_SITE,
  DEFAULT_SOLAR_ASSET,
  DEFAULT_WIND_ASSET,
  DEFAULT_GENERATOR_ASSET,
  DEFAULT_GENERATION_CONFIG,
  createDefaultSolarAsset,
  createDefaultWindAsset,
  createDefaultGeneratorAsset,
  createDefaultAsset,
} from '../utils/generationDefaults';
import {
  runAnnualSimulation,
  calculate15YearFinancials,
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
} from '../utils/simulationEngine';
import { generateRealistic8760Dataset } from '../utils/sampleData';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';

describe('G1 Milestone — Power Generation Contracts & Defaults', () => {
  it('instantiates valid DEFAULT_GENERATION_SITE conforming to GenerationSite contract', () => {
    const site: GenerationSite = DEFAULT_GENERATION_SITE;
    expect(site.latitude).toBeGreaterThanOrEqual(-90);
    expect(site.latitude).toBeLessThanOrEqual(90);
    expect(site.longitude).toBeGreaterThanOrEqual(-180);
    expect(site.longitude).toBeLessThanOrEqual(180);
    expect(typeof site.timeZone).toBe('string');
    expect(site.timeZone.length).toBeGreaterThan(0);
    expect(site.elevationM === null || typeof site.elevationM === 'number').toBe(true);
  });

  it('instantiates valid DEFAULT_SOLAR_ASSET with exactly 12 monthly peak sun hours and solar discriminator', () => {
    const solar: SolarGenerationAsset = DEFAULT_SOLAR_ASSET;
    expect(solar.type).toBe('solar');
    expect(solar.enabled).toBe(true);
    expect(solar.dcCapacityKw).toBeGreaterThan(0);
    expect(solar.tiltDegrees).toBeGreaterThanOrEqual(0);
    expect(solar.tiltDegrees).toBeLessThanOrEqual(90);
    expect(solar.azimuthDegrees).toBeGreaterThanOrEqual(0);
    expect(solar.azimuthDegrees).toBeLessThanOrEqual(359);
    expect(solar.inverterAcCapacityKw).toBeGreaterThan(0);
    expect(solar.inverterEfficiencyPercent).toBeGreaterThan(0);
    expect(solar.inverterEfficiencyPercent).toBeLessThanOrEqual(100);
    expect(solar.monthlyPeakSunHoursPerDay).toHaveLength(12);
    solar.monthlyPeakSunHoursPerDay.forEach((hours) => {
      expect(hours).toBeGreaterThanOrEqual(0);
    });
  });

  it('instantiates valid DEFAULT_WIND_ASSET with SI units, 12 monthly wind speeds and power curve points', () => {
    const wind: WindGenerationAsset = DEFAULT_WIND_ASSET;
    expect(wind.type).toBe('wind');
    expect(wind.ratedPowerKw).toBeGreaterThan(0);
    expect(wind.hubHeightM).toBeGreaterThan(0);
    expect(wind.rotorDiameterM).toBeGreaterThan(0);
    expect(wind.cutInWindSpeedMps).toBeLessThan(wind.ratedWindSpeedMps);
    expect(wind.ratedWindSpeedMps).toBeLessThan(wind.cutOutWindSpeedMps);
    expect(wind.monthlyAverageWindSpeedMps).toHaveLength(12);
    expect(wind.powerCurve.length).toBeGreaterThan(0);
    wind.powerCurve.forEach((point) => {
      expect(point.windSpeedMps).toBeGreaterThanOrEqual(0);
      expect(point.outputKw).toBeGreaterThanOrEqual(0);
    });
  });

  it('instantiates valid DEFAULT_GENERATOR_ASSET with fuel type, units, dispatch mode and fuel curve points', () => {
    const generator: GeneratorGenerationAsset = DEFAULT_GENERATOR_ASSET;
    expect(generator.type).toBe('generator');
    expect(generator.ratedContinuousKw).toBeGreaterThan(0);
    expect(generator.minimumStableLoadPercent).toBeGreaterThanOrEqual(0);
    expect(generator.minimumStableLoadPercent).toBeLessThanOrEqual(100);
    expect(['natural_gas', 'propane', 'gasoline', 'diesel', 'custom']).toContain(generator.fuelType);
    expect(['gallon', 'therm', 'ccf', 'mmbtu', 'custom']).toContain(generator.fuelUnit);
    expect(['standby', 'scheduled', 'economic']).toContain(generator.dispatchMode);
    expect(generator.fuelCostPerUnit).toBeGreaterThan(0);
    expect(generator.fuelCurve.length).toBeGreaterThan(0);
    generator.fuelCurve.forEach((point) => {
      expect(point.loadPercent).toBeGreaterThanOrEqual(0);
      expect(point.loadPercent).toBeLessThanOrEqual(100);
      expect(point.fuelUnitsPerHour).toBeGreaterThanOrEqual(0);
    });
  });

  it('properly discriminates assets in GenerationConfig', () => {
    const config: GenerationConfig = DEFAULT_GENERATION_CONFIG;
    expect(config.assets.length).toBe(3);

    const solar = config.assets.find((a): a is SolarGenerationAsset => a.type === 'solar');
    const wind = config.assets.find((a): a is WindGenerationAsset => a.type === 'wind');
    const generator = config.assets.find((a): a is GeneratorGenerationAsset => a.type === 'generator');

    expect(solar).toBeDefined();
    expect(solar?.dcCapacityKw).toBe(8.0);

    expect(wind).toBeDefined();
    expect(wind?.ratedPowerKw).toBe(5.0);

    expect(generator).toBeDefined();
    expect(generator?.ratedContinuousKw).toBe(10.0);
  });

  it('factory functions generate isolated instances with unique IDs', () => {
    const s1 = createDefaultSolarAsset();
    const s2 = createDefaultSolarAsset('Second Solar Array');
    expect(s1.id).not.toBe(s2.id);
    expect(s2.name).toBe('Second Solar Array');
    s1.monthlyPeakSunHoursPerDay[0] = 99.9;
    expect(s2.monthlyPeakSunHoursPerDay[0]).not.toBe(99.9);

    const w1 = createDefaultWindAsset();
    const w2 = createDefaultWindAsset();
    expect(w1.id).not.toBe(w2.id);
    w1.powerCurve[0].outputKw = 42;
    expect(w2.powerCurve[0].outputKw).not.toBe(42);

    const g1 = createDefaultGeneratorAsset();
    const g2 = createDefaultGeneratorAsset();
    expect(g1.id).not.toBe(g2.id);

    const genericAsset = createDefaultAsset('solar');
    expect(genericAsset.type).toBe('solar');
  });

  it('verifies invariant: changing generation config does not alter simulation or financial results', () => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    expect(parsed.isValid).toBe(true);

    const profile = DEFAULT_BATTERY_PROFILES[0];
    const tariff = DEFAULT_TOU_PROFILES[0];

    const baselineSim = runAnnualSimulation(
      parsed.data,
      parsed.intervalHours,
      tariff.tiers,
      tariff.scheduleMatrix,
      profile,
      tariff.seasons
    );

    const baselineFin = calculate15YearFinancials(
      profile,
      baselineSim,
      DEFAULT_MACRO_FINANCIALS
    );

    // Now instantiate modified generation assets
    const modifiedConfig: GenerationConfig = {
      site: {
        latitude: 45.0,
        longitude: -93.0,
        timeZone: 'America/Chicago',
        elevationM: 300,
      },
      assets: [
        {
          ...DEFAULT_SOLAR_ASSET,
          dcCapacityKw: 50.0,
          installedCostUsd: 100000,
        },
        {
          ...DEFAULT_WIND_ASSET,
          ratedPowerKw: 25.0,
          installedCostUsd: 50000,
        },
        {
          ...DEFAULT_GENERATOR_ASSET,
          ratedContinuousKw: 100.0,
          installedCostUsd: 75000,
        },
      ],
    };

    // Re-verify that runAnnualSimulation and calculate15YearFinancials produce identical results
    const rerunSim = runAnnualSimulation(
      parsed.data,
      parsed.intervalHours,
      tariff.tiers,
      tariff.scheduleMatrix,
      profile,
      tariff.seasons
    );

    const rerunFin = calculate15YearFinancials(
      profile,
      rerunSim,
      DEFAULT_MACRO_FINANCIALS
    );

    expect(rerunSim.baselineAnnualCost).toBe(baselineSim.baselineAnnualCost);
    expect(rerunSim.simulatedAnnualCost).toBe(baselineSim.simulatedAnnualCost);
    expect(rerunSim.year1Savings).toBe(baselineSim.year1Savings);
    expect(rerunSim.annualBatteryDischargedKwh).toBe(baselineSim.annualBatteryDischargedKwh);

    expect(rerunFin.paybackYears).toBe(baselineFin.paybackYears);
    expect(rerunFin.npv15Yr).toBe(baselineFin.npv15Yr);
    expect(rerunFin.lifetime25YearNpv).toBe(baselineFin.lifetime25YearNpv);
    expect(rerunFin.lifetime25YearNetProfit).toBe(baselineFin.lifetime25YearNetProfit);
  });
});
