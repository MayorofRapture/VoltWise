import { describe, it, expect } from 'vitest';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationProjectCosts,
  deriveAnalysisState,
  shouldCalculateLegacyFinancials,
} from '../utils/generationFinancials';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_RATE_TIERS,
  getHeaderPaybackText,
  getHeaderSavingsLabel,
} from '../utils/simulationEngine';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import { createDefaultAsset, createDefaultGenerationConfig } from '../utils/generationDefaults';
import {
  DatasetCompleteness,
  GenerationConfig,
  IntervalDataPoint,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
} from '../types/energy';

describe('G4A — Financial Safety Gate & Generation Project Cost Contracts', () => {
  function makeSolar(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number,
    overrides: Partial<SolarGenerationAsset> = {}
  ): SolarGenerationAsset {
    const base = createDefaultAsset('solar', id) as SolarGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
      dcCapacityKw: 8.5,
      inverterAcCapacityKw: 7.6,
      annualDegradationPercent: 0.5,
      ...overrides,
    };
  }

  function makeWind(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number
  ): WindGenerationAsset {
    const base = createDefaultAsset('wind', id) as WindGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
    };
  }

  function makeGenerator(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number
  ): GeneratorGenerationAsset {
    const base = createDefaultAsset('generator', id) as GeneratorGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
    };
  }

  function createDataPoints(count = 48): IntervalDataPoint[] {
    const start = new Date('2025-06-01T00:00:00Z');
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start.getTime() + i * 3600 * 1000);
      return {
        timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh: 1.5,
      };
    });
  }

  function createScheduleMatrix(): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) =>
        h >= 16 && h < 21 ? 'on-peak' : 'off-peak'
      )
    );
  }

  // ==========================================================================
  // Group A: Project-Cost Aggregation
  // ==========================================================================
  describe('Project-Cost Aggregation', () => {
    it('1. One enabled solar asset contributes its CAPEX exactly once', () => {
      const solar = makeSolar('solar-1', true, 18500, 150);
      const summary = aggregateGenerationProjectCosts([solar]);

      expect(summary.generationCapexUsd).toBe(18500);
      expect(summary.byAsset).toHaveLength(1);
      expect(summary.byAsset[0].installedCostUsd).toBe(18500);
      expect(summary.byType.solar.installedCostUsd).toBe(18500);
    });

    it('2. Disabled solar contributes zero to CAPEX and O&M', () => {
      const disabledSolar = makeSolar('solar-disabled', false, 25000, 500);
      const summary = aggregateGenerationProjectCosts([disabledSolar]);

      expect(summary.generationCapexUsd).toBe(0);
      expect(summary.annualGenerationMaintenanceUsd).toBe(0);
      expect(summary.byAsset).toHaveLength(0);
      expect(summary.byType.solar.installedCostUsd).toBe(0);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(0);
      expect(summary.solarMetadata).toHaveLength(0);
    });

    it('3. Annual solar O&M aggregates correctly', () => {
      const solar = makeSolar('solar-om', true, 12000, 275.5);
      const summary = aggregateGenerationProjectCosts([solar]);

      expect(summary.annualGenerationMaintenanceUsd).toBe(275.5);
      expect(summary.byAsset[0].annualMaintenanceCostUsd).toBe(275.5);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(275.5);
    });

    it('4. Multiple enabled solar arrays aggregate deterministically', () => {
      const array1 = makeSolar('roof-array', true, 14000, 120, {
        dcCapacityKw: 6,
        inverterAcCapacityKw: 5.5,
        annualDegradationPercent: 0.5,
      });
      const array2 = makeSolar('ground-array', true, 22000, 230, {
        dcCapacityKw: 10,
        inverterAcCapacityKw: 9.6,
        annualDegradationPercent: 0.7,
      });

      const summary = aggregateGenerationProjectCosts([array1, array2]);

      expect(summary.generationCapexUsd).toBe(36000);
      expect(summary.annualGenerationMaintenanceUsd).toBe(350);
      expect(summary.byAsset).toHaveLength(2);
      expect(summary.byType.solar.installedCostUsd).toBe(36000);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(350);
      expect(summary.byType.solar.assetCount).toBe(2);
    });

    it('5. Per-asset CAPEX/O&M breakdown reconciles to totals', () => {
      const solar1 = makeSolar('solar-1', true, 15000, 150);
      const solar2 = makeSolar('solar-2', true, 8500, 95);
      const disabledSolar = makeSolar('solar-3', false, 30000, 300);
      const wind = makeWind('wind-1', true, 12000, 200);
      const generator = makeGenerator('gen-1', true, 7500, 100);

      const summary = aggregateGenerationProjectCosts({
        site: { latitude: 37.77, longitude: -122.42, timeZone: 'America/Los_Angeles', elevationM: 10 },
        assets: [solar1, solar2, disabledSolar, wind, generator],
      });

      const totalCapexFromAssets = summary.byAsset.reduce(
        (sum, a) => sum + a.installedCostUsd,
        0
      );
      const totalOmFromAssets = summary.byAsset.reduce(
        (sum, a) => sum + a.annualMaintenanceCostUsd,
        0
      );

      expect(totalCapexFromAssets).toBe(summary.generationCapexUsd);
      expect(totalOmFromAssets).toBe(summary.annualGenerationMaintenanceUsd);
      expect(summary.generationCapexUsd).toBe(15000 + 8500 + 12000 + 7500);
      expect(summary.annualGenerationMaintenanceUsd).toBe(150 + 95 + 200 + 100);
    });

    it('6. Per-type CAPEX/O&M breakdown reconciles to totals', () => {
      const solar = makeSolar('solar-1', true, 20000, 250);
      const wind = makeWind('wind-1', true, 16000, 350);
      const generator = makeGenerator('gen-1', true, 5000, 75);

      const summary = aggregateGenerationProjectCosts([solar, wind, generator]);

      // Array methods iteration on byType
      const capexSumFromArray = summary.byType.reduce(
        (sum, t) => sum + t.installedCostUsd,
        0
      );
      const omSumFromArray = summary.byType.reduce(
        (sum, t) => sum + t.annualMaintenanceCostUsd,
        0
      );

      // Property access on byType
      const capexSumFromMap =
        summary.byType.solar.installedCostUsd +
        summary.byType.wind.installedCostUsd +
        summary.byType.generator.installedCostUsd;
      const omSumFromMap =
        summary.byType.solar.annualMaintenanceCostUsd +
        summary.byType.wind.annualMaintenanceCostUsd +
        summary.byType.generator.annualMaintenanceCostUsd;

      expect(capexSumFromArray).toBe(summary.generationCapexUsd);
      expect(omSumFromArray).toBe(summary.annualGenerationMaintenanceUsd);
      expect(capexSumFromMap).toBe(summary.generationCapexUsd);
      expect(omSumFromMap).toBe(summary.annualGenerationMaintenanceUsd);
    });

    it('7. Solar metadata retains independent capacity/degradation information for multiple arrays', () => {
      const array1 = makeSolar('east-facing', true, 11000, 100, {
        dcCapacityKw: 5.2,
        inverterAcCapacityKw: 4.8,
        annualDegradationPercent: 0.45,
        tiltDegrees: 20,
        azimuthDegrees: 90,
      });
      const array2 = makeSolar('west-facing', true, 17500, 180, {
        dcCapacityKw: 9.8,
        inverterAcCapacityKw: 8.6,
        annualDegradationPercent: 0.75,
        tiltDegrees: 30,
        azimuthDegrees: 270,
      });

      const summary = aggregateGenerationProjectCosts([array1, array2]);

      expect(summary.solarMetadata).toHaveLength(2);

      const meta1 = summary.solarMetadata.find((m) => m.id === 'east-facing');
      const meta2 = summary.solarMetadata.find((m) => m.id === 'west-facing');

      expect(meta1).toBeDefined();
      expect(meta1?.dcCapacityKw).toBe(5.2);
      expect(meta1?.inverterAcCapacityKw).toBe(4.8);
      expect(meta1?.annualDegradationPercent).toBe(0.45);
      expect(meta1?.tiltDegrees).toBe(20);
      expect(meta1?.azimuthDegrees).toBe(90);

      expect(meta2).toBeDefined();
      expect(meta2?.dcCapacityKw).toBe(9.8);
      expect(meta2?.inverterAcCapacityKw).toBe(8.6);
      expect(meta2?.annualDegradationPercent).toBe(0.75);
      expect(meta2?.tiltDegrees).toBe(30);
      expect(meta2?.azimuthDegrees).toBe(270);

      // Verify alias
      const aliasSummary = calculateGenerationProjectCosts([array1, array2]);
      expect(aliasSummary).toStrictEqual(summary);
    });
  });

  // ==========================================================================
  // Group B: Analysis-State Safety
  // ==========================================================================
  describe('Analysis-State Safety', () => {
    it('8. Full-year legacy mode derives legacy-financial', () => {
      expect(deriveAnalysisState(true, 'legacy')).toBe('legacy-financial');
      expect(deriveAnalysisState({ isSuitableForAnnual: true, simulationMode: 'legacy' })).toBe('legacy-financial');

      const fullCompleteness: DatasetCompleteness = {
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        intervalCount: 8760,
        intervalDurationHours: 1,
        durationDays: 365,
        expectedIntervalCount: 8760,
        missingIntervalCount: 0,
        isLeapYear: false,
        isSuitableForAnnualProjection: true,
      };
      expect(
        deriveAnalysisState({
          completeness: fullCompleteness,
          simulationMode: 'legacy',
        })
      ).toBe('legacy-financial');
    });

    it('9. Partial/incomplete data derives partial-period', () => {
      expect(deriveAnalysisState(false, 'legacy')).toBe('partial-period');
      expect(deriveAnalysisState(false, 'generation-aware')).toBe('partial-period');
      expect(deriveAnalysisState({ isSuitableForAnnual: false, simulationMode: 'generation-aware' })).toBe('partial-period');

      const partialCompleteness: DatasetCompleteness = {
        startDate: '2025-06-01',
        endDate: '2025-06-30',
        intervalCount: 720,
        intervalDurationHours: 1,
        durationDays: 30,
        expectedIntervalCount: 8760,
        missingIntervalCount: 8040,
        isLeapYear: false,
        isSuitableForAnnualProjection: false,
      };
      expect(
        deriveAnalysisState({
          completeness: partialCompleteness,
          simulationMode: 'generation-aware',
        })
      ).toBe('partial-period');
    });

    it('10. Full-year generation-aware mode derives generation-financial-pending', () => {
      expect(deriveAnalysisState(true, 'generation-aware')).toBe('generation-financial-pending');
      expect(
        deriveAnalysisState({
          isSuitableForAnnual: true,
          simulationMode: 'generation-aware',
        })
      ).toBe('generation-financial-pending');
    });

    it('11. Full-year generation-aware mode is NOT reported as partial-period', () => {
      const state = deriveAnalysisState(true, 'generation-aware');
      expect(state).not.toBe('partial-period');
      expect(state).toBe('generation-financial-pending');
    });
  });

  // ==========================================================================
  // Group C: Financial Routing & Safety Gate
  // ==========================================================================
  describe('Financial Routing & Header Safety', () => {
    it('12. No-generation/full-year mode remains eligible for calculate15YearFinancials()', () => {
      const eligible = shouldCalculateLegacyFinancials(true, 'legacy');
      expect(eligible).toBe(true);
    });

    it('13. Generation-aware/full-year mode is not eligible for the legacy financial engine', () => {
      const eligible = shouldCalculateLegacyFinancials(true, 'generation-aware');
      expect(eligible).toBe(false);

      // Incomplete dataset is also not eligible
      expect(shouldCalculateLegacyFinancials(false, 'legacy')).toBe(false);
      expect(shouldCalculateLegacyFinancials(false, 'generation-aware')).toBe(false);
    });

    it('14. Generation-enabled Year-1 operational savings remain available even though lifecycle finance is suppressed', () => {
      const dataPoints = createDataPoints(48);
      const scheduleMatrix = createScheduleMatrix();
      const battery = DEFAULT_BATTERY_PROFILES[0];
      const solar = makeSolar('solar-active', true, 18000, 150);
      const config: GenerationConfig = {
        site: { latitude: 37.77, longitude: -122.42, timeZone: 'America/Los_Angeles', elevationM: 10 },
        assets: [solar],
      };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: DEFAULT_RATE_TIERS,
        scheduleMatrix,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: false,
      });

      expect(unifiedResult.mode).toBe('generation-aware');
      // Year-1 operational electricity savings remain fully calculated and authoritative
      expect(unifiedResult.annualSummary.year1Savings).toBeDefined();
      expect(typeof unifiedResult.annualSummary.year1Savings).toBe('number');
      expect(unifiedResult.annualSummary.baselineAnnualCost).toBeGreaterThan(0);
      expect(unifiedResult.annualSummary.simulatedAnnualCost).toBeLessThanOrEqual(
        unifiedResult.annualSummary.baselineAnnualCost
      );
      expect(unifiedResult.generationAwareResult).toBeDefined();

      // Lifecycle financial eligibility is false
      expect(shouldCalculateLegacyFinancials(true, unifiedResult.mode)).toBe(false);
    });

    it('15. Header payback is unavailable/suppressed while generation financial analysis is pending', () => {
      // In generation-financial-pending mode, activeAnalysis is null because lifecycle calculation is suppressed
      const activeAnalysis = null;
      const paybackText = getHeaderPaybackText(activeAnalysis, true);

      expect(paybackText).toBeNull();
    });

    it('16. The valid full-year generation case retains annual/Year-1 savings semantics rather than being labeled as a partial-period result', () => {
      const isSuitableForAnnual = true;
      const label = getHeaderSavingsLabel(isSuitableForAnnual);

      expect(label).toBe('Year 1 Savings');
      expect(label).not.toBe('Period Savings');

      const partialLabel = getHeaderSavingsLabel(false);
      expect(partialLabel).toBe('Period Savings');
    });
  });
});
