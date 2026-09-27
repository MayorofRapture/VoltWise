import { describe, it, expect } from 'vitest';
import { calculateGridFlows } from '../utils/gridFlowAccounting';
import { routeIntegratedBatteryFlow } from '../utils/integratedBatteryFlow';
import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  IntegratedBatteryFlowInterval,
  SolarLoadFlowInterval,
} from '../types/energy';

function createMockIntegratedInterval(
  overrides: Partial<IntegratedBatteryFlowInterval> = {}
): IntegratedBatteryFlowInterval {
  const index = overrides.sourceIndex ?? 0;
  return {
    sourceIndex: index,
    sourceTimestamp: `2025-06-01 ${String(index).padStart(2, '0')}:00`,
    timestampUtc: `2025-06-01T${String(index).padStart(2, '0')}:00:00.000Z`,
    tierId: 'off-peak',

    homeLoadKwh: 3,
    solarGenerationKwh: 0,
    solarDirectToLoadKwh: 0,

    residualHomeLoadBeforeBatteryKwh: 3,
    surplusSolarBeforeBatteryKwh: 0,

    gridChargeAllowed: false,
    dischargeAllowed: false,

    solarToBatteryAcKwh: 0,
    renewableEnergyStoredKwh: 0,

    requestedGridChargeAcKwh: 0,
    gridToBatteryAcKwh: 0,
    gridEnergyStoredKwh: 0,

    batteryDeliveredToLoadKwh: 0,
    storedEnergyDrainedKwh: 0,

    syntheticSocDrainedKwh: 0,
    renewableSocDrainedKwh: 0,
    generatorSocDrainedKwh: 0,
    gridSocDrainedKwh: 0,

    residualHomeLoadAfterBatteryKwh: 3,
    remainingSurplusSolarKwh: 0,

    batterySocBeforeKwh: 0,
    batterySocAfterKwh: 0,

    stateBefore: {
      syntheticSocKwh: 0,
      gridChargedSocKwh: 0,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    },
    stateAfter: {
      syntheticSocKwh: 0,
      gridChargedSocKwh: 0,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    },
    ...overrides,
  };
}

describe('G3I — Grid Boundary Flow Accounting', () => {
  describe('1. Residual home load becomes grid import for home', () => {
    it('accurately assigns residualHomeLoadAfterBatteryKwh to gridImportForHomeKwh', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 2.75,
        gridToBatteryAcKwh: 0,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].gridImportForHomeKwh).toBe(2.75);
      expect(result.intervals[0].gridImportForBatteryKwh).toBe(0);
      expect(result.intervals[0].totalGridImportKwh).toBe(2.75);
      expect(result.totalGridImportForHomeKwh).toBe(2.75);
    });
  });

  describe('2. Grid battery charging becomes additional grid import', () => {
    it('accurately assigns gridToBatteryAcKwh to gridImportForBatteryKwh', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 0,
        gridToBatteryAcKwh: 3.5,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].gridImportForHomeKwh).toBe(0);
      expect(result.intervals[0].gridImportForBatteryKwh).toBe(3.5);
      expect(result.intervals[0].totalGridImportKwh).toBe(3.5);
      expect(result.totalGridImportForBatteryKwh).toBe(3.5);
    });
  });

  describe('3. Home load + battery charging sum correctly', () => {
    it('correctly calculates totalGridImportKwh as home import plus battery charge import', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 1.8,
        gridToBatteryAcKwh: 2.4,
      });

      const result = calculateGridFlows([inv], false);

      expect(result.intervals[0].gridImportForHomeKwh).toBe(1.8);
      expect(result.intervals[0].gridImportForBatteryKwh).toBe(2.4);
      expect(result.intervals[0].totalGridImportKwh).toBeCloseTo(4.2, 10);
      expect(result.totalGridImportKwh).toBeCloseTo(4.2, 10);
    });
  });

  describe('4. Zero grid import when neither is needed', () => {
    it('reports 0 grid import when residual load and grid battery charging are both 0', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 0,
        gridToBatteryAcKwh: 0,
        remainingSurplusSolarKwh: 5.0,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].gridImportForHomeKwh).toBe(0);
      expect(result.intervals[0].gridImportForBatteryKwh).toBe(0);
      expect(result.intervals[0].totalGridImportKwh).toBe(0);
      expect(result.totalGridImportKwh).toBe(0);
    });
  });

  describe('5. Solar export enabled routes all remaining surplus to export', () => {
    it('sets solarExportKwh = remainingSurplusSolarKwh and curtailedSolarKwh = 0 when allowSolarExport is true', () => {
      const inv = createMockIntegratedInterval({
        remainingSurplusSolarKwh: 4.6,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].solarExportKwh).toBe(4.6);
      expect(result.intervals[0].curtailedSolarKwh).toBe(0);
      expect(result.intervals[0].totalGridExportKwh).toBe(4.6);
      expect(result.totalSolarExportKwh).toBe(4.6);
      expect(result.totalCurtailedSolarKwh).toBe(0);
      expect(result.totalGridExportKwh).toBe(4.6);
    });
  });

  describe('6. Solar export disabled routes all remaining surplus to curtailment', () => {
    it('sets solarExportKwh = 0 and curtailedSolarKwh = remainingSurplusSolarKwh when allowSolarExport is false', () => {
      const inv = createMockIntegratedInterval({
        remainingSurplusSolarKwh: 4.6,
      });

      const result = calculateGridFlows([inv], false);

      expect(result.intervals[0].solarExportKwh).toBe(0);
      expect(result.intervals[0].curtailedSolarKwh).toBe(4.6);
      expect(result.intervals[0].totalGridExportKwh).toBe(0);
      expect(result.totalSolarExportKwh).toBe(0);
      expect(result.totalCurtailedSolarKwh).toBe(4.6);
      expect(result.totalGridExportKwh).toBe(0);
    });
  });

  describe('7. Export and curtailment conservation', () => {
    it('preserves remainingSurplusSolarKwh = solarExportKwh + curtailedSolarKwh', () => {
      const invExport = createMockIntegratedInterval({
        sourceIndex: 0,
        remainingSurplusSolarKwh: 3.2,
      });
      const resExport = calculateGridFlows([invExport], true);
      expect(
        resExport.intervals[0].solarExportKwh +
          resExport.intervals[0].curtailedSolarKwh
      ).toBeCloseTo(3.2, 10);

      const invCurtail = createMockIntegratedInterval({
        sourceIndex: 0,
        remainingSurplusSolarKwh: 3.2,
      });
      const resCurtail = calculateGridFlows([invCurtail], false);
      expect(
        resCurtail.intervals[0].solarExportKwh +
          resCurtail.intervals[0].curtailedSolarKwh
      ).toBeCloseTo(3.2, 10);
    });
  });

  describe('8. No battery export is invented', () => {
    it('ensures totalGridExportKwh equals solarExportKwh and never includes battery discharge', () => {
      const inv = createMockIntegratedInterval({
        batteryDeliveredToLoadKwh: 5.0,
        remainingSurplusSolarKwh: 2.0,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].solarExportKwh).toBe(2.0);
      expect(result.intervals[0].totalGridExportKwh).toBe(2.0);
    });
  });

  describe('9. Multiple intervals reconcile result totals', () => {
    it('reconciles independent totals across multiple diverse intervals', () => {
      const inv0 = createMockIntegratedInterval({
        sourceIndex: 0,
        residualHomeLoadAfterBatteryKwh: 2.0,
        gridToBatteryAcKwh: 1.0,
        remainingSurplusSolarKwh: 0,
      });
      const inv1 = createMockIntegratedInterval({
        sourceIndex: 1,
        residualHomeLoadAfterBatteryKwh: 0,
        gridToBatteryAcKwh: 3.0,
        remainingSurplusSolarKwh: 0,
      });
      const inv2 = createMockIntegratedInterval({
        sourceIndex: 2,
        residualHomeLoadAfterBatteryKwh: 0,
        gridToBatteryAcKwh: 0,
        remainingSurplusSolarKwh: 4.5,
      });
      const inv3 = createMockIntegratedInterval({
        sourceIndex: 3,
        residualHomeLoadAfterBatteryKwh: 1.5,
        gridToBatteryAcKwh: 0,
        remainingSurplusSolarKwh: 0,
      });

      const result = calculateGridFlows([inv0, inv1, inv2, inv3], true);

      expect(result.totalGridImportForHomeKwh).toBeCloseTo(3.5, 10);
      expect(result.totalGridImportForBatteryKwh).toBeCloseTo(4.0, 10);
      expect(result.totalGridImportKwh).toBeCloseTo(7.5, 10);
      expect(result.totalSolarExportKwh).toBeCloseTo(4.5, 10);
      expect(result.totalCurtailedSolarKwh).toBe(0);
      expect(result.totalGridExportKwh).toBeCloseTo(4.5, 10);
    });
  });

  describe('10. Simultaneous household grid import + battery charging is supported', () => {
    it('supports intervals with simultaneous residual home load and grid battery charging', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 3.0,
        gridToBatteryAcKwh: 2.5,
      });

      const result = calculateGridFlows([inv], false);

      expect(result.intervals[0].gridImportForHomeKwh).toBe(3.0);
      expect(result.intervals[0].gridImportForBatteryKwh).toBe(2.5);
      expect(result.intervals[0].totalGridImportKwh).toBe(5.5);
    });
  });

  describe('11. Solar-export interval with zero import', () => {
    it('properly represents an interval with zero grid import and positive solar export', () => {
      const inv = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: 0,
        gridToBatteryAcKwh: 0,
        remainingSurplusSolarKwh: 6.2,
      });

      const result = calculateGridFlows([inv], true);

      expect(result.intervals[0].totalGridImportKwh).toBe(0);
      expect(result.intervals[0].totalGridExportKwh).toBe(6.2);
    });
  });

  describe('12. Input validation', () => {
    it('rejects empty or non-array intervals', () => {
      expect(() => calculateGridFlows([], true)).toThrow(/non-empty array/i);
      expect(() =>
        calculateGridFlows(null as unknown as IntegratedBatteryFlowInterval[], true)
      ).toThrow(/non-empty array/i);
    });

    it('rejects non-boolean allowSolarExport', () => {
      const inv = createMockIntegratedInterval();
      expect(() =>
        calculateGridFlows([inv], 'true' as unknown as boolean)
      ).toThrow(/must be a boolean/i);
    });

    it('rejects sourceIndex mismatch', () => {
      const inv = createMockIntegratedInterval({ sourceIndex: 5 });
      expect(() => calculateGridFlows([inv], true)).toThrow(/sourceIndex/i);
    });

    it('rejects empty or non-string timestamp/tier strings', () => {
      const invBadTs = createMockIntegratedInterval({ sourceTimestamp: '' });
      expect(() => calculateGridFlows([invBadTs], true)).toThrow(
        /sourceTimestamp/i
      );

      const invBadUtc = createMockIntegratedInterval({ timestampUtc: '   ' });
      expect(() => calculateGridFlows([invBadUtc], true)).toThrow(
        /timestampUtc/i
      );

      const invBadTier = createMockIntegratedInterval({ tierId: '' });
      expect(() => calculateGridFlows([invBadTier], true)).toThrow(/tierId/i);
    });

    it('rejects negative or non-finite flow quantities', () => {
      const invNegHome = createMockIntegratedInterval({
        residualHomeLoadAfterBatteryKwh: -1,
      });
      expect(() => calculateGridFlows([invNegHome], true)).toThrow(
        /residualHomeLoadAfterBatteryKwh/i
      );

      const invNegCharge = createMockIntegratedInterval({
        gridToBatteryAcKwh: -0.5,
      });
      expect(() => calculateGridFlows([invNegCharge], true)).toThrow(
        /gridToBatteryAcKwh/i
      );

      const invNegSurplus = createMockIntegratedInterval({
        remainingSurplusSolarKwh: NaN,
      });
      expect(() => calculateGridFlows([invNegSurplus], true)).toThrow(
        /remainingSurplusSolarKwh/i
      );
    });
  });

  describe('13. Input immutability', () => {
    it('does not mutate frozen input intervals', () => {
      const inv = Object.freeze(
        createMockIntegratedInterval({
          residualHomeLoadAfterBatteryKwh: 2.0,
          gridToBatteryAcKwh: 1.5,
          remainingSurplusSolarKwh: 3.0,
        })
      );

      const intervals = Object.freeze([inv]);

      expect(() => {
        calculateGridFlows(
          intervals as unknown as IntegratedBatteryFlowInterval[],
          true
        );
      }).not.toThrow();
    });
  });

  describe('14. Integration with routeIntegratedBatteryFlow', () => {
    it('directly consumes real output from routeIntegratedBatteryFlow without remapping', () => {
      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 12:00',
          timestampUtc: '2025-06-01T12:00:00.000Z',
          homeLoadKwh: 2,
          solarGenerationKwh: 5, // surplus = 3
          solarDirectToLoadKwh: 2,
          residualHomeLoadKwh: 0,
          surplusSolarKwh: 3,
        },
        {
          sourceIndex: 1,
          sourceTimestamp: '2025-06-01 18:00',
          timestampUtc: '2025-06-01T18:00:00.000Z',
          homeLoadKwh: 4,
          solarGenerationKwh: 0,
          solarDirectToLoadKwh: 0,
          residualHomeLoadKwh: 4,
          surplusSolarKwh: 0,
        },
      ];

      const policy: BatteryDispatchPolicyInterval[] = [
        {
          sourceIndex: 0,
          timestampUtc: '2025-06-01T12:00:00.000Z',
          tierId: 'off-peak',
          allowGridChargeFromGrid: false,
          allowBatteryDischargeToLoad: false,
          dayOfWeek: 0,
          hour: 12,
        },
        {
          sourceIndex: 1,
          timestampUtc: '2025-06-01T18:00:00.000Z',
          tierId: 'on-peak',
          allowGridChargeFromGrid: false,
          allowBatteryDischargeToLoad: true,
          dayOfWeek: 0,
          hour: 18,
        },
      ];

      const profile: BatteryProfile = {
        id: 'test-battery',
        name: 'Test Battery',
        model: 'Test Model',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
        ratedCycleLife: 4000,
        installedCost: 10000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      };

      const initialState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };

      // Run G3H
      const g3hResult = routeIntegratedBatteryFlow(
        intervals,
        policy,
        1.0,
        profile,
        initialState
      );

      // Pass directly into G3I with solar export enabled
      const gridFlows = calculateGridFlows(g3hResult.intervals, true);

      expect(gridFlows.intervals).toHaveLength(2);

      // Interval 0: 3 kWh solar surplus charged into battery (capacity was 10, max charge 5 -> 3 kWh stored)
      // Surplus remaining = 0, no residual load, no grid charge
      expect(gridFlows.intervals[0].gridImportForHomeKwh).toBe(0);
      expect(gridFlows.intervals[0].gridImportForBatteryKwh).toBe(0);
      expect(gridFlows.intervals[0].totalGridImportKwh).toBe(0);
      expect(gridFlows.intervals[0].solarExportKwh).toBe(0);

      // Interval 1: 4 kWh residual load served by 3 kWh battery stored -> 1 kWh unmet
      // 1 kWh imported for home, 0 for battery
      expect(gridFlows.intervals[1].gridImportForHomeKwh).toBe(1);
      expect(gridFlows.intervals[1].gridImportForBatteryKwh).toBe(0);
      expect(gridFlows.intervals[1].totalGridImportKwh).toBe(1);
      expect(gridFlows.intervals[1].solarExportKwh).toBe(0);

      // Overall totals
      expect(gridFlows.totalGridImportKwh).toBe(1);
      expect(gridFlows.totalGridExportKwh).toBe(0);
    });
  });
});
