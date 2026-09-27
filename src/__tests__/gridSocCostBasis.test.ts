import { describe, it, expect } from 'vitest';
import { trackGridSocCostBasis } from '../utils/gridSocCostBasis';
import { routeIntegratedBatteryFlow } from '../utils/integratedBatteryFlow';
import { calculateGridFlows } from '../utils/gridFlowAccounting';
import { calculateTariffCosts } from '../utils/tariffCostAccounting';
import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  GridSocCostBasisState,
  IntegratedBatteryFlowInterval,
  RateTier,
  SolarLoadFlowInterval,
  TariffCostInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createMockPair(
  index: number,
  isoUtc: string,
  options: {
    tierId?: string;
    sourceTimestamp?: string;
    stateBeforeGridKwh?: number;
    stateAfterGridKwh?: number;
    gridToBatteryAcKwh?: number;
    gridEnergyStoredKwh?: number;
    gridSocDrainedKwh?: number;
    buyRate?: number;
    sellRate?: number;
    gridImportForBatteryCost?: number;
    homeLoadKwh?: number;
    renewableSocDrainedKwh?: number;
    syntheticSocDrainedKwh?: number;
  } = {}
): {
  integrated: IntegratedBatteryFlowInterval;
  tariff: TariffCostInterval;
} {
  const sourceTimestamp =
    options.sourceTimestamp ?? isoUtc.slice(0, 16).replace('T', ' ');
  const tierId = options.tierId ?? 'off-peak';
  const buyRate = options.buyRate ?? 0.15;
  const sellRate = options.sellRate ?? 0.05;

  const gridToBatteryAcKwh = options.gridToBatteryAcKwh ?? 0;
  const gridEnergyStoredKwh = options.gridEnergyStoredKwh ?? 0;
  const gridSocDrainedKwh = options.gridSocDrainedKwh ?? 0;

  const stateBeforeGridKwh = options.stateBeforeGridKwh ?? 0;
  const defaultAfter = stateBeforeGridKwh + gridEnergyStoredKwh - gridSocDrainedKwh;
  const stateAfterGridKwh =
    options.stateAfterGridKwh !== undefined ? options.stateAfterGridKwh : defaultAfter;

  const gridImportForBatteryCost =
    options.gridImportForBatteryCost !== undefined
      ? options.gridImportForBatteryCost
      : gridToBatteryAcKwh * buyRate;

  const homeLoadKwh = options.homeLoadKwh ?? 2;

  const integrated: IntegratedBatteryFlowInterval = {
    sourceIndex: index,
    sourceTimestamp,
    timestampUtc: isoUtc,
    tierId,

    homeLoadKwh,
    solarGenerationKwh: 0,
    solarDirectToLoadKwh: 0,

    residualHomeLoadBeforeBatteryKwh: homeLoadKwh,
    surplusSolarBeforeBatteryKwh: 0,

    gridChargeAllowed: gridToBatteryAcKwh > 0,
    dischargeAllowed: gridSocDrainedKwh > 0,

    solarToBatteryAcKwh: 0,
    renewableEnergyStoredKwh: 0,

    requestedGridChargeAcKwh: gridToBatteryAcKwh,
    gridToBatteryAcKwh,
    gridEnergyStoredKwh,

    batteryDeliveredToLoadKwh:
      gridSocDrainedKwh +
      (options.renewableSocDrainedKwh ?? 0) +
      (options.syntheticSocDrainedKwh ?? 0),
    storedEnergyDrainedKwh:
      gridSocDrainedKwh +
      (options.renewableSocDrainedKwh ?? 0) +
      (options.syntheticSocDrainedKwh ?? 0),

    syntheticSocDrainedKwh: options.syntheticSocDrainedKwh ?? 0,
    renewableSocDrainedKwh: options.renewableSocDrainedKwh ?? 0,
    generatorSocDrainedKwh: 0,
    gridSocDrainedKwh,

    residualHomeLoadAfterBatteryKwh: homeLoadKwh,
    remainingSurplusSolarKwh: 0,

    batterySocBeforeKwh: stateBeforeGridKwh,
    batterySocAfterKwh: stateAfterGridKwh,

    stateBefore: {
      syntheticSocKwh: 0,
      gridChargedSocKwh: stateBeforeGridKwh,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    },
    stateAfter: {
      syntheticSocKwh: 0,
      gridChargedSocKwh: stateAfterGridKwh,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    },
  };

  const tariff: TariffCostInterval = {
    sourceIndex: index,
    sourceTimestamp,
    timestampUtc: isoUtc,
    tierId,
    tierName: tierId === 'off-peak' ? 'Off-Peak Rate' : 'On-Peak Rate',

    localMonth: 5,

    buyRate,
    sellRate,

    homeLoadKwh,

    gridImportForHomeKwh: homeLoadKwh,
    gridImportForBatteryKwh: gridToBatteryAcKwh,
    totalGridImportKwh: homeLoadKwh + gridToBatteryAcKwh,
    totalGridExportKwh: 0,

    baselineCost: homeLoadKwh * buyRate,

    gridImportForHomeCost: homeLoadKwh * buyRate,
    gridImportForBatteryCost,
    totalGridImportCost: homeLoadKwh * buyRate + gridImportForBatteryCost,

    gridExportCredit: 0,

    simulatedCost: homeLoadKwh * buyRate + gridImportForBatteryCost,
    netSavings: 0,
  };

  return { integrated, tariff };
}

describe('Grid-Charged SOC Acquisition-Cost Basis (Milestone G3K)', () => {
  const zeroState: GridSocCostBasisState = {
    gridStoredEnergyKwh: 0,
    totalAcquisitionCostUsd: 0,
  };

  // 1. zero grid SOC / no activity remains zero
  it('1. maintains zero state when there is no grid charging and no grid SOC', () => {
    const pair = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      stateBeforeGridKwh: 0,
      stateAfterGridKwh: 0,
      gridToBatteryAcKwh: 0,
      gridEnergyStoredKwh: 0,
      gridSocDrainedKwh: 0,
    });

    const result = trackGridSocCostBasis([pair.integrated], [pair.tariff], zeroState);

    expect(result.intervals[0].gridStoredEnergyBeforeKwh).toBe(0);
    expect(result.intervals[0].acquisitionCostBeforeUsd).toBe(0);
    expect(result.intervals[0].gridEnergyStoredKwh).toBe(0);
    expect(result.intervals[0].gridChargeAcquisitionCostUsd).toBe(0);
    expect(result.intervals[0].gridStoredEnergyAfterKwh).toBe(0);
    expect(result.intervals[0].acquisitionCostAfterUsd).toBe(0);
    expect(result.intervals[0].averageAcquisitionCostPerStoredKwhAfter).toBe(0);

    expect(result.finalState.gridStoredEnergyKwh).toBe(0);
    expect(result.finalState.totalAcquisitionCostUsd).toBe(0);
    expect(result.totalGridChargeAcquisitionCostUsd).toBe(0);
    expect(result.totalGridSocCostRemovedUsd).toBe(0);
  });

  // 2. one grid charge creates correct acquisition cost
  it('2. adds correct acquisition cost from G3J tariff accounting on single grid charge', () => {
    // 4 kWh AC imported at $0.15/kWh => $0.60 cost
    // 3.6 kWh DC stored in battery
    const pair = createMockPair(0, '2025-06-15T01:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 4,
      gridEnergyStoredKwh: 3.6,
      buyRate: 0.15,
      gridImportForBatteryCost: 0.60,
    });

    const result = trackGridSocCostBasis([pair.integrated], [pair.tariff], zeroState);
    const inv = result.intervals[0];

    expect(inv.gridChargeAcquisitionCostUsd).toBe(0.60);
    expect(inv.gridStoredEnergyBeforeDrainKwh).toBe(3.6);
    expect(inv.acquisitionCostBeforeDrainUsd).toBe(0.60);
    expect(inv.averageAcquisitionCostPerStoredKwhBeforeDrain).toBeCloseTo(0.60 / 3.6, 8); // $0.166667/stored kWh

    expect(inv.gridStoredEnergyAfterKwh).toBe(3.6);
    expect(inv.acquisitionCostAfterUsd).toBe(0.60);
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.60 / 3.6, 8);

    expect(result.finalState.gridStoredEnergyKwh).toBe(3.6);
    expect(result.finalState.totalAcquisitionCostUsd).toBe(0.60);
    expect(result.totalGridChargeAcquisitionCostUsd).toBe(0.60);
  });

  // 3. 90% RTE proves cost basis uses AC purchase cost, not stored-energy × rate
  it('3. uses AC purchase cost rather than stored energy × buyRate (proves conversion losses included)', () => {
    // 2.0 kWh AC purchased at $0.10/kWh => $0.20 AC cost.
    // Battery RTE < 100%: stored energy is 1.8 kWh.
    // Stored-energy * buyRate would be 1.8 * 0.10 = $0.18 (WRONG).
    // G3K must use AC purchase cost = $0.20.
    const pair = createMockPair(0, '2025-06-15T02:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      buyRate: 0.10,
      gridImportForBatteryCost: 0.20,
    });

    const result = trackGridSocCostBasis([pair.integrated], [pair.tariff], zeroState);
    const inv = result.intervals[0];

    expect(inv.gridChargeAcquisitionCostUsd).toBe(0.20);
    expect(inv.acquisitionCostAfterUsd).toBe(0.20);
    expect(inv.gridStoredEnergyAfterKwh).toBe(1.8);
    // Average cost per stored kWh reflects the conversion loss: 0.20 / 1.8 = $0.11111.../kWh
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.20 / 1.8, 8);
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).not.toBeCloseTo(0.10, 4);
  });

  // 4. two charges at different prices produce correct weighted average
  it('4. calculates weighted average cost basis when charged at different prices', () => {
    // Interval 0: 2 kWh AC at $0.10 = $0.20, stores 1.8 kWh DC.
    const p0 = createMockPair(0, '2025-06-15T01:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      buyRate: 0.10,
      gridImportForBatteryCost: 0.20,
    });
    // Interval 1: 3 kWh AC at $0.20 = $0.60, stores 2.7 kWh DC.
    const p1 = createMockPair(1, '2025-06-15T02:00:00.000Z', {
      stateBeforeGridKwh: 1.8,
      gridToBatteryAcKwh: 3.0,
      gridEnergyStoredKwh: 2.7,
      buyRate: 0.20,
      gridImportForBatteryCost: 0.60,
    });

    const result = trackGridSocCostBasis(
      [p0.integrated, p1.integrated],
      [p0.tariff, p1.tariff],
      zeroState
    );

    const inv1 = result.intervals[1];
    // Total energy stored = 1.8 + 2.7 = 4.5 kWh
    // Total cost basis = 0.20 + 0.60 = $0.80
    // Weighted average = 0.80 / 4.5 = $0.177777.../kWh
    expect(inv1.gridStoredEnergyAfterKwh).toBeCloseTo(4.5, 8);
    expect(inv1.acquisitionCostAfterUsd).toBeCloseTo(0.80, 8);
    expect(inv1.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.80 / 4.5, 8);

    expect(result.finalState.gridStoredEnergyKwh).toBeCloseTo(4.5, 8);
    expect(result.finalState.totalAcquisitionCostUsd).toBeCloseTo(0.80, 8);
  });

  // 5. renewable/synthetic discharge does not change grid cost basis
  it('5. does not change grid cost basis when renewable or synthetic SOC is discharged', () => {
    // Battery starts with 3.0 kWh grid SOC with $0.60 cost basis ($0.20/kWh).
    // An interval discharges 2.0 kWh of renewable SOC; gridSocDrainedKwh = 0.
    const p0 = createMockPair(0, '2025-06-15T14:00:00.000Z', {
      stateBeforeGridKwh: 3.0,
      stateAfterGridKwh: 3.0,
      gridSocDrainedKwh: 0,
      renewableSocDrainedKwh: 2.0,
    });

    const initialState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0.60,
    };

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], initialState);
    const inv = result.intervals[0];

    expect(inv.gridSocDrainedKwh).toBe(0);
    expect(inv.gridSocCostRemovedUsd).toBe(0);
    expect(inv.gridStoredEnergyAfterKwh).toBe(3.0);
    expect(inv.acquisitionCostAfterUsd).toBe(0.60);
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.20, 8);
  });

  // 6. partial grid-SOC drain removes proportional cost
  it('6. removes proportional acquisition cost upon partial grid-SOC drain', () => {
    // Start with 4.0 kWh stored at $1.00 ($0.25/kWh).
    // Drain 1.0 kWh of grid SOC.
    const p0 = createMockPair(0, '2025-06-15T18:00:00.000Z', {
      stateBeforeGridKwh: 4.0,
      gridSocDrainedKwh: 1.0,
    });

    const initialState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4.0,
      totalAcquisitionCostUsd: 1.00,
    };

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], initialState);
    const inv = result.intervals[0];

    // Average cost before drain = 1.00 / 4.0 = $0.25/kWh
    expect(inv.averageAcquisitionCostPerStoredKwhBeforeDrain).toBeCloseTo(0.25, 8);
    // Cost removed = 1.0 * 0.25 = $0.25
    expect(inv.gridSocCostRemovedUsd).toBeCloseTo(0.25, 8);
    // Remaining = 3.0 kWh, cost = $0.75
    expect(inv.gridStoredEnergyAfterKwh).toBeCloseTo(3.0, 8);
    expect(inv.acquisitionCostAfterUsd).toBeCloseTo(0.75, 8);
    expect(result.totalGridSocCostRemovedUsd).toBeCloseTo(0.25, 8);
  });

  // 7. partial drain preserves average cost per remaining stored kWh
  it('7. preserves average cost per remaining stored kWh across partial drain', () => {
    const p0 = createMockPair(0, '2025-06-15T19:00:00.000Z', {
      stateBeforeGridKwh: 5.0,
      gridSocDrainedKwh: 2.5,
    });

    const initialState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 5.0,
      totalAcquisitionCostUsd: 1.50, // $0.30 / kWh
    };

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], initialState);
    const inv = result.intervals[0];

    expect(inv.averageAcquisitionCostPerStoredKwhBeforeDrain).toBeCloseTo(0.30, 8);
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.30, 8);
    expect(inv.gridStoredEnergyAfterKwh).toBeCloseTo(2.5, 8);
    expect(inv.acquisitionCostAfterUsd).toBeCloseTo(0.75, 8);
  });

  // 8. full grid-SOC drain resets energy and cost to exactly zero
  it('8. resets remaining energy and acquisition cost to exactly zero upon full drain', () => {
    const p0 = createMockPair(0, '2025-06-15T20:00:00.000Z', {
      stateBeforeGridKwh: 2.0,
      gridSocDrainedKwh: 2.0,
    });

    const initialState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2.0,
      totalAcquisitionCostUsd: 0.50,
    };

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], initialState);
    const inv = result.intervals[0];

    expect(inv.gridStoredEnergyAfterKwh).toBe(0);
    expect(inv.acquisitionCostAfterUsd).toBe(0);
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBe(0);
    expect(result.finalState.gridStoredEnergyKwh).toBe(0);
    expect(result.finalState.totalAcquisitionCostUsd).toBe(0);
    expect(result.totalGridSocCostRemovedUsd).toBeCloseTo(0.50, 8);
  });

  // 9. negative buy price creates valid negative cost basis
  it('9. accepts negative buy price and creates valid negative cost basis without clamping', () => {
    // 2.0 kWh AC imported at -$0.05/kWh => -$0.10 cost basis (user was paid to charge)
    // 1.8 kWh stored DC
    const p0 = createMockPair(0, '2025-06-15T03:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      buyRate: -0.05,
      gridImportForBatteryCost: -0.10,
    });

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], zeroState);
    const inv = result.intervals[0];

    expect(inv.gridChargeAcquisitionCostUsd).toBe(-0.10);
    expect(inv.acquisitionCostAfterUsd).toBe(-0.10);
    // Negative average cost per stored kWh
    expect(inv.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(-0.10 / 1.8, 8);
    expect(result.finalState.totalAcquisitionCostUsd).toBe(-0.10);
  });

  // 10. sequential low-price charge → high-price charge → grid discharge
  it('10. tracks multi-step progression: low-price charge -> high-price charge -> grid discharge', () => {
    // Step 0: Charge 2 kWh AC at $0.10 = $0.20, stores 1.8 kWh DC
    const p0 = createMockPair(0, '2025-06-15T01:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      buyRate: 0.10,
      gridImportForBatteryCost: 0.20,
    });
    // Step 1: Charge 2 kWh AC at $0.30 = $0.60, stores 1.8 kWh DC
    const p1 = createMockPair(1, '2025-06-15T02:00:00.000Z', {
      stateBeforeGridKwh: 1.8,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      buyRate: 0.30,
      gridImportForBatteryCost: 0.60,
    });
    // Step 2: Discharge 1.8 kWh grid SOC
    const p2 = createMockPair(2, '2025-06-15T03:00:00.000Z', {
      stateBeforeGridKwh: 3.6,
      gridToBatteryAcKwh: 0,
      gridEnergyStoredKwh: 0,
      gridSocDrainedKwh: 1.8,
    });

    const result = trackGridSocCostBasis(
      [p0.integrated, p1.integrated, p2.integrated],
      [p0.tariff, p1.tariff, p2.tariff],
      zeroState
    );

    // After step 1: 3.6 kWh stored, total cost = $0.80, avg cost = $0.80 / 3.6 = $0.22222.../kWh
    expect(result.intervals[1].gridStoredEnergyAfterKwh).toBeCloseTo(3.6, 8);
    expect(result.intervals[1].acquisitionCostAfterUsd).toBeCloseTo(0.80, 8);
    expect(result.intervals[1].averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(
      0.80 / 3.6,
      8
    );

    // After step 2: 1.8 kWh drained at $0.22222... => $0.40 cost removed
    // Remaining = 1.8 kWh, remaining cost = $0.40, avg cost = $0.22222...
    const inv2 = result.intervals[2];
    expect(inv2.gridSocCostRemovedUsd).toBeCloseTo(0.40, 8);
    expect(inv2.gridStoredEnergyAfterKwh).toBeCloseTo(1.8, 8);
    expect(inv2.acquisitionCostAfterUsd).toBeCloseTo(0.40, 8);
    expect(inv2.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.40 / 1.8, 8);

    expect(result.totalGridChargeAcquisitionCostUsd).toBeCloseTo(0.80, 8);
    expect(result.totalGridSocCostRemovedUsd).toBeCloseTo(0.40, 8);
  });

  // 11. non-zero initial grid SOC with explicit cost basis
  it('11. accepts non-zero initial grid SOC with caller-provided cost basis', () => {
    const initialState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0.45, // $0.15/kWh
    };

    const p0 = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      stateBeforeGridKwh: 3.0,
      stateAfterGridKwh: 3.0,
    });

    const result = trackGridSocCostBasis([p0.integrated], [p0.tariff], initialState);

    expect(result.initialState.gridStoredEnergyKwh).toBe(3.0);
    expect(result.initialState.totalAcquisitionCostUsd).toBe(0.45);
    expect(result.intervals[0].gridStoredEnergyBeforeKwh).toBe(3.0);
    expect(result.intervals[0].acquisitionCostBeforeUsd).toBe(0.45);
    expect(result.intervals[0].averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.15, 8);
  });

  // 12. initial energy/cost inconsistency rejected
  it('12. rejects initial energy/cost inconsistency (zero energy with non-zero cost or negative energy)', () => {
    const p0 = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      stateBeforeGridKwh: 0,
    });

    // Zero energy with non-zero cost
    const inconsistentState: GridSocCostBasisState = {
      gridStoredEnergyKwh: 0,
      totalAcquisitionCostUsd: 10.0,
    };
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [p0.tariff], inconsistentState)
    ).toThrow(/zero initial gridStoredEnergyKwh.*must have zero acquisition cost basis/);

    // Negative initial energy
    const negativeEnergyState: GridSocCostBasisState = {
      gridStoredEnergyKwh: -1.0,
      totalAcquisitionCostUsd: 0,
    };
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [p0.tariff], negativeEnergyState)
    ).toThrow(/must be non-negative/);
  });

  // 13. physical state-before/state-after mismatch rejected
  it('13. rejects physical state-before and state-after mismatches with integrated dispatch', () => {
    // Initial state does not match first interval stateBefore
    const p0 = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      stateBeforeGridKwh: 2.0,
    });
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [p0.tariff], {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      })
    ).toThrow(/does not match first interval stateBefore.gridChargedSocKwh/);

    // State after mismatch in interval
    const pBadAfter = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      stateBeforeGridKwh: 0,
      stateAfterGridKwh: 99.0, // Does not match actual computed state
    });
    expect(() =>
      trackGridSocCostBasis([pBadAfter.integrated], [pBadAfter.tariff], zeroState)
    ).toThrow(/Physical state-after mismatch/);
  });

  // 14. tariff battery-import energy mismatch rejected
  it('14. rejects tariff battery-import energy mismatch against integrated grid import', () => {
    const p0 = createMockPair(0, '2025-06-15T00:00:00.000Z', {
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
    });

    // Mismatched tariff grid import for battery
    const badTariff = {
      ...p0.tariff,
      gridImportForBatteryKwh: 5.0, // Mismatched!
    };

    expect(() =>
      trackGridSocCostBasis([p0.integrated], [badTariff], zeroState)
    ).toThrow(/Tariff battery-import energy mismatch/);
  });

  // 15. index/timestamp/tier mismatch rejected
  it('15. rejects index, timestamp, and tier mismatches between arrays', () => {
    const p0 = createMockPair(0, '2025-06-15T00:00:00.000Z');
    const p1 = createMockPair(1, '2025-06-15T01:00:00.000Z');

    // Length mismatch
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [p0.tariff, p1.tariff], zeroState)
    ).toThrow(/Array length mismatch/);

    // Timestamp mismatch
    const badTsTariff = {
      ...p0.tariff,
      timestampUtc: '2025-06-15T99:00:00.000Z',
    };
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [badTsTariff], zeroState)
    ).toThrow(/Timestamp UTC mismatch/);

    // Source timestamp mismatch
    const badSourceTsTariff = {
      ...p0.tariff,
      sourceTimestamp: '2025-06-15 99:99',
    };
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [badSourceTsTariff], zeroState)
    ).toThrow(/Source timestamp mismatch/);

    // Tier mismatch
    const badTierTariff = {
      ...p0.tariff,
      tierId: 'different-tier',
    };
    expect(() =>
      trackGridSocCostBasis([p0.integrated], [badTierTariff], zeroState)
    ).toThrow(/Tier ID mismatch/);
  });

  // 16. result totals reconcile interval additions/removals
  it('16. reconciles result totals across interval additions and removals', () => {
    const p0 = createMockPair(0, '2025-06-15T01:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 3.0,
      gridEnergyStoredKwh: 2.7,
      gridImportForBatteryCost: 0.45,
    });
    const p1 = createMockPair(1, '2025-06-15T02:00:00.000Z', {
      stateBeforeGridKwh: 2.7,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      gridImportForBatteryCost: 0.40,
    });
    const p2 = createMockPair(2, '2025-06-15T03:00:00.000Z', {
      stateBeforeGridKwh: 4.5,
      gridSocDrainedKwh: 1.5,
    });
    const p3 = createMockPair(3, '2025-06-15T04:00:00.000Z', {
      stateBeforeGridKwh: 3.0,
      gridSocDrainedKwh: 3.0,
    });

    const result = trackGridSocCostBasis(
      [p0.integrated, p1.integrated, p2.integrated, p3.integrated],
      [p0.tariff, p1.tariff, p2.tariff, p3.tariff],
      zeroState
    );

    let sumAdded = 0;
    let sumRemoved = 0;
    for (const inv of result.intervals) {
      sumAdded += inv.gridChargeAcquisitionCostUsd;
      sumRemoved += inv.gridSocCostRemovedUsd;
    }

    expect(result.totalGridChargeAcquisitionCostUsd).toBeCloseTo(sumAdded, 8);
    expect(result.totalGridSocCostRemovedUsd).toBeCloseTo(sumRemoved, 8);
    expect(result.finalState.gridStoredEnergyKwh).toBe(0);
    expect(result.finalState.totalAcquisitionCostUsd).toBe(0);
  });

  // 17. input immutability
  it('17. does not mutate input objects or arrays (verified with Object.freeze)', () => {
    const pair = createMockPair(0, '2025-06-15T01:00:00.000Z', {
      stateBeforeGridKwh: 0,
      gridToBatteryAcKwh: 2.0,
      gridEnergyStoredKwh: 1.8,
      gridImportForBatteryCost: 0.30,
    });

    const frozenIntegrated = Object.freeze([Object.freeze(pair.integrated)]);
    const frozenTariff = Object.freeze([Object.freeze(pair.tariff)]);
    const frozenInitial = Object.freeze({ ...zeroState });

    expect(() =>
      trackGridSocCostBasis(
        frozenIntegrated as unknown as IntegratedBatteryFlowInterval[],
        frozenTariff as unknown as TariffCostInterval[],
        frozenInitial
      )
    ).not.toThrow();
  });

  // 18. direct pipeline integration:
  // G3H -> G3I -> G3J -> G3K without remapping interval objects
  it('18. integrates across full pipeline G3H -> G3I -> G3J -> G3K without remapping', () => {
    const solarLoadFlows: SolarLoadFlowInterval[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 01:00',
        timestampUtc: '2025-06-01T01:00:00.000Z',
        homeLoadKwh: 2,
        solarGenerationKwh: 0,
        solarDirectToLoadKwh: 0,
        residualHomeLoadKwh: 2,
        surplusSolarKwh: 0,
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
        timestampUtc: '2025-06-01T01:00:00.000Z',
        tierId: 'off-peak',
        allowGridChargeFromGrid: true, // Grid charging allowed in off-peak
        allowBatteryDischargeToLoad: false,
        dayOfWeek: 0,
        hour: 1,
      },
      {
        sourceIndex: 1,
        timestampUtc: '2025-06-01T18:00:00.000Z',
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true, // Discharge allowed in on-peak
        dayOfWeek: 0,
        hour: 18,
      },
    ];

    const alignedTimestamps: AlignedLoadTimestamp[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 01:00',
        timestampUtc: '2025-06-01T01:00:00.000Z',
        instantUtc: new Date('2025-06-01T01:00:00.000Z'),
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2025-06-01 18:00',
        timestampUtc: '2025-06-01T18:00:00.000Z',
        instantUtc: new Date('2025-06-01T18:00:00.000Z'),
      },
    ];

    const batteryProfile: BatteryProfile = {
      id: 'test-battery',
      name: 'Test Battery',
      model: 'Test Model',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousChargeKw: 4,
      maxContinuousOutputKw: 4,
      roundTripEfficiencyPercent: 100, // 100% RTE for clean unit math
      ratedCycleLife: 4000,
      installedCost: 10000,
      strategy: 'arbitrage',
      chargeTiers: ['off-peak'],
      dischargeTiers: ['on-peak'],
    };

    const initialSoc: BatterySocProvenanceState = {
      syntheticSocKwh: 0,
      gridChargedSocKwh: 0,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    };

    const tiers: RateTier[] = [
      {
        id: 'off-peak',
        name: 'Off-Peak Rate',
        buyRate: 0.10,
        sellRate: 0.05,
        color: '#3b82f6',
      },
      {
        id: 'on-peak',
        name: 'On-Peak Rate',
        buyRate: 0.40,
        sellRate: 0.15,
        color: '#ef4444',
      },
    ];

    // 1. G3H: Integrated battery flow
    const g3hResult = routeIntegratedBatteryFlow(
      solarLoadFlows,
      policy,
      1.0, // 1 hour intervals
      batteryProfile,
      initialSoc
    );

    // In interval 0: grid charges battery up to 4 kW * 1 h = 4 kWh. Grid import for battery = 4 kWh.
    // In interval 1: battery discharges to meet home load 4 kWh. Grid SOC drained = 4 kWh.

    // 2. G3I: Physical grid flow accounting
    const g3iResult = calculateGridFlows(g3hResult.intervals, true);

    // 3. G3J: Tariff cost accounting
    const g3jResult = calculateTariffCosts(
      g3iResult.intervals,
      g3hResult.intervals,
      alignedTimestamps,
      'UTC',
      tiers
    );

    // 4. G3K: Grid-SOC cost basis tracking - direct inputs without remapping
    const g3kResult = trackGridSocCostBasis(
      g3hResult.intervals,
      g3jResult.intervals,
      zeroState
    );

    expect(g3kResult.intervals).toHaveLength(2);

    // Interval 0:
    // Charged 4 kWh at $0.10/kWh => $0.40 acquisition cost added.
    const inv0 = g3kResult.intervals[0];
    expect(inv0.gridChargeAcquisitionCostUsd).toBeCloseTo(0.40, 8);
    expect(inv0.gridStoredEnergyAfterKwh).toBeCloseTo(4.0, 8);
    expect(inv0.acquisitionCostAfterUsd).toBeCloseTo(0.40, 8);
    expect(inv0.averageAcquisitionCostPerStoredKwhAfter).toBeCloseTo(0.10, 8);

    // Interval 1:
    // Drained 4 kWh grid SOC => $0.40 cost basis removed.
    const inv1 = g3kResult.intervals[1];
    expect(inv1.gridSocDrainedKwh).toBeCloseTo(4.0, 8);
    expect(inv1.gridSocCostRemovedUsd).toBeCloseTo(0.40, 8);
    expect(inv1.gridStoredEnergyAfterKwh).toBe(0);
    expect(inv1.acquisitionCostAfterUsd).toBe(0);
    expect(inv1.averageAcquisitionCostPerStoredKwhAfter).toBe(0);

    // Final state
    expect(g3kResult.finalState.gridStoredEnergyKwh).toBe(0);
    expect(g3kResult.finalState.totalAcquisitionCostUsd).toBe(0);
    expect(g3kResult.totalGridChargeAcquisitionCostUsd).toBeCloseTo(0.40, 8);
    expect(g3kResult.totalGridSocCostRemovedUsd).toBeCloseTo(0.40, 8);
  });
});
