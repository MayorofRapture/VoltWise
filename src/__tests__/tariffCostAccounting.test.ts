import { describe, it, expect } from 'vitest';
import { calculateTariffCosts } from '../utils/tariffCostAccounting';
import { calculateGridFlows } from '../utils/gridFlowAccounting';
import { routeIntegratedBatteryFlow } from '../utils/integratedBatteryFlow';
import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  GridFlowInterval,
  IntegratedBatteryFlowInterval,
  RateTier,
  SolarLoadFlowInterval,
  TouSeason,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createMockAlignedTimestamp(
  index: number,
  isoUtc: string,
  sourceTimestamp?: string
): AlignedLoadTimestamp {
  const instant = new Date(isoUtc);
  return {
    sourceIndex: index,
    sourceTimestamp:
      sourceTimestamp ??
      isoUtc.slice(0, 16).replace('T', ' '),
    instantUtc: instant,
    timestampUtc: isoUtc,
  };
}

function createMockIntegratedInterval(
  index: number,
  isoUtc: string,
  overrides: Partial<IntegratedBatteryFlowInterval> = {}
): IntegratedBatteryFlowInterval {
  const sourceTimestamp =
    overrides.sourceTimestamp ??
    isoUtc.slice(0, 16).replace('T', ' ');
  return {
    sourceIndex: index,
    sourceTimestamp,
    timestampUtc: isoUtc,
    tierId: overrides.tierId ?? 'standard',

    homeLoadKwh: overrides.homeLoadKwh ?? 3,
    solarGenerationKwh: overrides.solarGenerationKwh ?? 0,
    solarDirectToLoadKwh: overrides.solarDirectToLoadKwh ?? 0,

    residualHomeLoadBeforeBatteryKwh:
      overrides.residualHomeLoadBeforeBatteryKwh ?? 3,
    surplusSolarBeforeBatteryKwh:
      overrides.surplusSolarBeforeBatteryKwh ?? 0,

    gridChargeAllowed: overrides.gridChargeAllowed ?? false,
    dischargeAllowed: overrides.dischargeAllowed ?? false,

    solarToBatteryAcKwh: overrides.solarToBatteryAcKwh ?? 0,
    renewableEnergyStoredKwh: overrides.renewableEnergyStoredKwh ?? 0,

    requestedGridChargeAcKwh: overrides.requestedGridChargeAcKwh ?? 0,
    gridToBatteryAcKwh: overrides.gridToBatteryAcKwh ?? 0,
    gridEnergyStoredKwh: overrides.gridEnergyStoredKwh ?? 0,

    batteryDeliveredToLoadKwh: overrides.batteryDeliveredToLoadKwh ?? 0,
    storedEnergyDrainedKwh: overrides.storedEnergyDrainedKwh ?? 0,

    syntheticSocDrainedKwh: 0,
    renewableSocDrainedKwh: 0,
    generatorSocDrainedKwh: 0,
    gridSocDrainedKwh: 0,

    residualHomeLoadAfterBatteryKwh:
      overrides.residualHomeLoadAfterBatteryKwh ?? 3,
    remainingSurplusSolarKwh: overrides.remainingSurplusSolarKwh ?? 0,

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
  };
}

function createMockGridFlow(
  index: number,
  isoUtc: string,
  overrides: Partial<GridFlowInterval> = {}
): GridFlowInterval {
  const sourceTimestamp =
    overrides.sourceTimestamp ??
    isoUtc.slice(0, 16).replace('T', ' ');
  const gridImportForHomeKwh = overrides.gridImportForHomeKwh ?? 3;
  const gridImportForBatteryKwh = overrides.gridImportForBatteryKwh ?? 0;
  const totalGridImportKwh =
    overrides.totalGridImportKwh ??
    gridImportForHomeKwh + gridImportForBatteryKwh;
  const totalGridExportKwh = overrides.totalGridExportKwh ?? 0;

  return {
    sourceIndex: index,
    sourceTimestamp,
    timestampUtc: isoUtc,
    tierId: overrides.tierId ?? 'standard',

    residualHomeLoadKwh: gridImportForHomeKwh,
    gridBatteryChargeKwh: gridImportForBatteryKwh,
    remainingSurplusSolarKwh: totalGridExportKwh,

    gridImportForHomeKwh,
    gridImportForBatteryKwh,
    totalGridImportKwh,

    solarExportKwh: totalGridExportKwh,
    curtailedSolarKwh: 0,
    totalGridExportKwh,
  };
}

const DEFAULT_TIERS: RateTier[] = [
  {
    id: 'off-peak',
    name: 'Off-Peak Rate',
    buyRate: 0.15,
    sellRate: 0.05,
    color: '#3b82f6',
  },
  {
    id: 'on-peak',
    name: 'On-Peak Rate',
    buyRate: 0.40,
    sellRate: 0.10,
    color: '#ef4444',
  },
];

describe('Tariff Cost Accounting Engine (Milestone G3J)', () => {
  // 1. base-tier buy rate applied to household grid import
  it('1. applies base-tier buy rate to household grid import', () => {
    const isoUtc = '2025-06-15T10:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak', homeLoadKwh: 5 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'off-peak',
        gridImportForHomeKwh: 5,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 5,
        totalGridExportKwh: 0,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    expect(result.intervals[0].buyRate).toBe(0.15);
    expect(result.intervals[0].gridImportForHomeCost).toBeCloseTo(0.75, 8); // 5 * 0.15
    expect(result.intervals[0].gridImportForBatteryCost).toBe(0);
    expect(result.intervals[0].totalGridImportCost).toBeCloseTo(0.75, 8);
  });

  // 2. grid battery charging cost uses AC grid import
  it('2. costs grid battery charging using AC grid import (not stored energy)', () => {
    const isoUtc = '2025-06-15T02:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [
      createMockIntegratedInterval(0, isoUtc, {
        tierId: 'off-peak',
        homeLoadKwh: 2,
        gridToBatteryAcKwh: 4, // 4 kWh AC purchased from grid
        gridEnergyStoredKwh: 3.6, // 3.6 kWh DC stored in battery after conversion
      }),
    ];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'off-peak',
        gridImportForHomeKwh: 2,
        gridImportForBatteryKwh: 4, // AC import
        totalGridImportKwh: 6,
        totalGridExportKwh: 0,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Grid battery charging cost must use AC grid import: 4 kWh * $0.15 = $0.60 (not 3.6 * 0.15 = $0.54)
    expect(result.intervals[0].gridImportForBatteryKwh).toBe(4);
    expect(result.intervals[0].gridImportForBatteryCost).toBeCloseTo(0.60, 8);
    expect(result.intervals[0].gridImportForHomeCost).toBeCloseTo(0.30, 8); // 2 * 0.15
    expect(result.intervals[0].totalGridImportCost).toBeCloseTo(0.90, 8); // 6 * 0.15
  });

  // 3. solar export receives sell-rate credit
  it('3. credits solar export using the active sell rate', () => {
    const isoUtc = '2025-06-15T13:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [
      createMockIntegratedInterval(0, isoUtc, {
        tierId: 'on-peak',
        homeLoadKwh: 1,
        remainingSurplusSolarKwh: 8,
      }),
    ];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 0,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 0,
        totalGridExportKwh: 8,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    expect(result.intervals[0].sellRate).toBe(0.10);
    expect(result.intervals[0].totalGridExportKwh).toBe(8);
    expect(result.intervals[0].gridExportCredit).toBeCloseTo(0.80, 8); // 8 * 0.10
  });

  // 4. simulatedCost = import cost - export credit
  it('4. calculates simulatedCost = totalGridImportCost - gridExportCredit', () => {
    const isoUtc = '2025-06-15T15:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'on-peak', homeLoadKwh: 3 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 3,
        gridImportForBatteryKwh: 2,
        totalGridImportKwh: 5,
        totalGridExportKwh: 2,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Import cost = 5 * 0.40 = 2.00
    // Export credit = 2 * 0.10 = 0.20
    // Simulated cost = 2.00 - 0.20 = 1.80
    expect(result.intervals[0].totalGridImportCost).toBeCloseTo(2.00, 8);
    expect(result.intervals[0].gridExportCredit).toBeCloseTo(0.20, 8);
    expect(result.intervals[0].simulatedCost).toBeCloseTo(1.80, 8);
  });

  // 5. baselineCost uses original homeLoadKwh, not residual load
  it('5. calculates baselineCost from original homeLoadKwh without solar or battery offset', () => {
    const isoUtc = '2025-06-15T18:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [
      createMockIntegratedInterval(0, isoUtc, {
        tierId: 'on-peak',
        homeLoadKwh: 10, // original household load
        residualHomeLoadAfterBatteryKwh: 2, // residual load after solar & battery
      }),
    ];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 2,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 2,
        totalGridExportKwh: 0,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Baseline cost must be 10 * 0.40 = 4.00, NOT 2 * 0.40 = 0.80
    expect(result.intervals[0].baselineCost).toBeCloseTo(4.00, 8);
    expect(result.intervals[0].gridImportForHomeCost).toBeCloseTo(0.80, 8);
  });

  // 6. interval savings = baseline - simulated
  it('6. calculates netSavings = baselineCost - simulatedCost', () => {
    const isoUtc = '2025-06-15T19:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'on-peak', homeLoadKwh: 8 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 2,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 2,
        totalGridExportKwh: 1,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Baseline = 8 * 0.40 = 3.20
    // Import = 2 * 0.40 = 0.80
    // Export = 1 * 0.10 = 0.10
    // Simulated = 0.80 - 0.10 = 0.70
    // Net savings = 3.20 - 0.70 = 2.50
    expect(result.intervals[0].baselineCost).toBeCloseTo(3.20, 8);
    expect(result.intervals[0].simulatedCost).toBeCloseTo(0.70, 8);
    expect(result.intervals[0].netSavings).toBeCloseTo(2.50, 8);
  });

  // 7. seasonal buy/sell override
  it('7. overrides buyRate and sellRate when an active season has a tier override', () => {
    const isoUtc = '2025-07-15T14:00:00.000Z'; // July = month 6
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'on-peak', homeLoadKwh: 5 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 5,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 5,
        totalGridExportKwh: 2,
      }),
    ];

    const summerSeason: TouSeason = {
      id: 'summer',
      name: 'Summer Season',
      months: [5, 6, 7, 8], // June, July, August, September
      tierRates: {
        'on-peak': { buyRate: 0.55, sellRate: 0.18 },
      },
    };

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, [summerSeason]);

    const interval = result.intervals[0];
    expect(interval.seasonName).toBe('Summer Season');
    expect(interval.buyRate).toBe(0.55);
    expect(interval.sellRate).toBe(0.18);
    expect(interval.baselineCost).toBeCloseTo(5 * 0.55, 8);
    expect(interval.gridExportCredit).toBeCloseTo(2 * 0.18, 8);
    expect(interval.simulatedCost).toBeCloseTo(5 * 0.55 - 2 * 0.18, 8);
  });

  // 8. active season with no tier override falls back to base rates but keeps seasonName
  it('8. falls back to base tier rates when season matches but has no override for that tier', () => {
    const isoUtc = '2025-07-15T02:00:00.000Z'; // July = month 6
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak', homeLoadKwh: 4 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'off-peak',
        gridImportForHomeKwh: 4,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 4,
        totalGridExportKwh: 0,
      }),
    ];

    const summerSeason: TouSeason = {
      id: 'summer',
      name: 'Summer Season',
      months: [5, 6, 7, 8],
      tierRates: {
        'on-peak': { buyRate: 0.55, sellRate: 0.18 }, // No override for 'off-peak'
      },
    };

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, [summerSeason]);

    const interval = result.intervals[0];
    expect(interval.seasonName).toBe('Summer Season');
    expect(interval.buyRate).toBe(0.15); // base off-peak buyRate
    expect(interval.sellRate).toBe(0.05); // base off-peak sellRate
    expect(interval.baselineCost).toBeCloseTo(4 * 0.15, 8);
  });

  // 9. local-month resolution follows supplied site timezone
  it('9. resolves local month according to site IANA timezone, not host timezone', () => {
    // 2025-06-01T02:00:00Z:
    // UTC month = 5 (June)
    // In America/Los_Angeles (UTC-7 daylight saving), it is 2025-05-31 19:00:00 => month = 4 (May)
    const isoUtc = '2025-06-01T02:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak', homeLoadKwh: 2 })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'off-peak' })];

    const seasons: TouSeason[] = [
      {
        id: 'may-season',
        name: 'Spring May',
        months: [4], // May
        tierRates: { 'off-peak': { buyRate: 0.12, sellRate: 0.04 } },
      },
      {
        id: 'june-season',
        name: 'Summer June',
        months: [5], // June
        tierRates: { 'off-peak': { buyRate: 0.22, sellRate: 0.08 } },
      },
    ];

    const resultLA = calculateTariffCosts(
      gf,
      inf,
      at,
      'America/Los_Angeles',
      DEFAULT_TIERS,
      seasons
    );
    expect(resultLA.intervals[0].localMonth).toBe(4); // May
    expect(resultLA.intervals[0].seasonName).toBe('Spring May');
    expect(resultLA.intervals[0].buyRate).toBe(0.12);

    const resultUTC = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, seasons);
    expect(resultUTC.intervals[0].localMonth).toBe(5); // June
    expect(resultUTC.intervals[0].seasonName).toBe('Summer June');
    expect(resultUTC.intervals[0].buyRate).toBe(0.22);
  });

  // 10. month boundary where UTC month differs from local month
  it('10. handles month boundary where UTC month differs from local month across Year/New Year boundary', () => {
    // 2025-01-01T03:00:00Z:
    // UTC month = 0 (January 2025)
    // In America/New_York (UTC-5), local time is 2024-12-31 22:00:00 => month = 11 (December)
    const isoUtc = '2025-01-01T03:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak', homeLoadKwh: 3 })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'off-peak' })];

    const seasons: TouSeason[] = [
      {
        id: 'winter-dec',
        name: 'December Holiday',
        months: [11], // Dec
        tierRates: { 'off-peak': { buyRate: 0.11, sellRate: 0.03 } },
      },
      {
        id: 'winter-jan',
        name: 'January Freeze',
        months: [0], // Jan
        tierRates: { 'off-peak': { buyRate: 0.19, sellRate: 0.07 } },
      },
    ];

    const resultNY = calculateTariffCosts(
      gf,
      inf,
      at,
      'America/New_York',
      DEFAULT_TIERS,
      seasons
    );
    expect(resultNY.intervals[0].localMonth).toBe(11);
    expect(resultNY.intervals[0].seasonName).toBe('December Holiday');
    expect(resultNY.intervals[0].buyRate).toBe(0.11);
  });

  // 11. first matching season wins when seasons overlap
  it('11. selects first matching season when multiple seasons contain the same month', () => {
    const isoUtc = '2025-07-15T12:00:00.000Z'; // Month = 6 (July)
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'on-peak', homeLoadKwh: 2 })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'on-peak' })];

    const overlappingSeasons: TouSeason[] = [
      {
        id: 'season-primary',
        name: 'Primary Broad Season',
        months: [5, 6, 7],
        tierRates: { 'on-peak': { buyRate: 0.33, sellRate: 0.09 } },
      },
      {
        id: 'season-secondary',
        name: 'Secondary Peak Season',
        months: [6, 7],
        tierRates: { 'on-peak': { buyRate: 0.50, sellRate: 0.20 } },
      },
    ];

    const result = calculateTariffCosts(
      gf,
      inf,
      at,
      'UTC',
      DEFAULT_TIERS,
      overlappingSeasons
    );
    expect(result.intervals[0].seasonName).toBe('Primary Broad Season');
    expect(result.intervals[0].buyRate).toBe(0.33);
    expect(result.intervals[0].sellRate).toBe(0.09);
  });

  // 12. multiple intervals reconcile all totals
  it('12. accurately accumulates and reconciles all totals across multiple intervals', () => {
    const timestamps = [
      '2025-06-15T00:00:00.000Z',
      '2025-06-15T01:00:00.000Z',
      '2025-06-15T12:00:00.000Z',
      '2025-06-15T18:00:00.000Z',
    ];

    const at = timestamps.map((ts, idx) => createMockAlignedTimestamp(idx, ts));
    const inf = [
      createMockIntegratedInterval(0, timestamps[0], {
        tierId: 'off-peak',
        homeLoadKwh: 4,
      }),
      createMockIntegratedInterval(1, timestamps[1], {
        tierId: 'off-peak',
        homeLoadKwh: 3,
      }),
      createMockIntegratedInterval(2, timestamps[2], {
        tierId: 'on-peak',
        homeLoadKwh: 2,
      }),
      createMockIntegratedInterval(3, timestamps[3], {
        tierId: 'on-peak',
        homeLoadKwh: 6,
      }),
    ];

    const gf = [
      // Interval 0: Grid import for home 4, battery 2
      createMockGridFlow(0, timestamps[0], {
        tierId: 'off-peak',
        gridImportForHomeKwh: 4,
        gridImportForBatteryKwh: 2,
        totalGridImportKwh: 6,
        totalGridExportKwh: 0,
      }),
      // Interval 1: Grid import for home 3, battery 0
      createMockGridFlow(1, timestamps[1], {
        tierId: 'off-peak',
        gridImportForHomeKwh: 3,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 3,
        totalGridExportKwh: 0,
      }),
      // Interval 2: Solar surplus export 5, no import
      createMockGridFlow(2, timestamps[2], {
        tierId: 'on-peak',
        gridImportForHomeKwh: 0,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 0,
        totalGridExportKwh: 5,
      }),
      // Interval 3: Battery offset 4, grid import 2
      createMockGridFlow(3, timestamps[3], {
        tierId: 'on-peak',
        gridImportForHomeKwh: 2,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 2,
        totalGridExportKwh: 0,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Sum verification
    let sumBaseline = 0;
    let sumImportHome = 0;
    let sumImportBattery = 0;
    let sumTotalImport = 0;
    let sumExportCredit = 0;
    let sumSimulated = 0;
    let sumSavings = 0;

    for (const inv of result.intervals) {
      sumBaseline += inv.baselineCost;
      sumImportHome += inv.gridImportForHomeCost;
      sumImportBattery += inv.gridImportForBatteryCost;
      sumTotalImport += inv.totalGridImportCost;
      sumExportCredit += inv.gridExportCredit;
      sumSimulated += inv.simulatedCost;
      sumSavings += inv.netSavings;
    }

    expect(result.baselineCost).toBeCloseTo(sumBaseline, 8);
    expect(result.gridImportForHomeCost).toBeCloseTo(sumImportHome, 8);
    expect(result.gridImportForBatteryCost).toBeCloseTo(sumImportBattery, 8);
    expect(result.totalGridImportCost).toBeCloseTo(sumTotalImport, 8);
    expect(result.gridExportCredit).toBeCloseTo(sumExportCredit, 8);
    expect(result.simulatedCost).toBeCloseTo(sumSimulated, 8);
    expect(result.netSavings).toBeCloseTo(sumSavings, 8);

    // Reconcile simulated cost = total import cost - export credit
    expect(result.simulatedCost).toBeCloseTo(
      result.totalGridImportCost - result.gridExportCredit,
      8
    );
    // Reconcile net savings = baseline - simulated
    expect(result.netSavings).toBeCloseTo(
      result.baselineCost - result.simulatedCost,
      8
    );
  });

  // 13. zero import + positive export can produce negative simulatedCost
  it('13. produces negative simulatedCost when solar export exceeds import (unclamped)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'on-peak', homeLoadKwh: 1 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'on-peak',
        gridImportForHomeKwh: 0,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 0,
        totalGridExportKwh: 10,
      }),
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS);

    // Total import cost = 0
    // Export credit = 10 * 0.10 = 1.00
    // Simulated cost = 0 - 1.00 = -1.00
    expect(result.intervals[0].simulatedCost).toBeCloseTo(-1.00, 8);
    expect(result.simulatedCost).toBeCloseTo(-1.00, 8);
    // Baseline = 1 * 0.40 = 0.40
    // Net savings = 0.40 - (-1.00) = 1.40
    expect(result.intervals[0].netSavings).toBeCloseTo(1.40, 8);
    expect(result.netSavings).toBeCloseTo(1.40, 8);
  });

  // 14. negative finite buy/sell rates are accepted and calculated mathematically
  it('14. accepts negative finite buy and sell rates and calculates costs mathematically', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'negative-tier', homeLoadKwh: 10 })];
    const gf = [
      createMockGridFlow(0, isoUtc, {
        tierId: 'negative-tier',
        gridImportForHomeKwh: 6,
        gridImportForBatteryKwh: 4,
        totalGridImportKwh: 10,
        totalGridExportKwh: 5,
      }),
    ];

    const negativeTier: RateTier[] = [
      {
        id: 'negative-tier',
        name: 'Negative Spot Price Tier',
        buyRate: -0.05, // e.g. paid to consume energy
        sellRate: -0.02, // e.g. penalized for exporting
        color: '#10b981',
      },
    ];

    const result = calculateTariffCosts(gf, inf, at, 'UTC', negativeTier);

    // Baseline = 10 * -0.05 = -0.50
    expect(result.intervals[0].baselineCost).toBeCloseTo(-0.50, 8);
    // Grid import home = 6 * -0.05 = -0.30
    expect(result.intervals[0].gridImportForHomeCost).toBeCloseTo(-0.30, 8);
    // Grid import battery = 4 * -0.05 = -0.20
    expect(result.intervals[0].gridImportForBatteryCost).toBeCloseTo(-0.20, 8);
    // Total import cost = 10 * -0.05 = -0.50
    expect(result.intervals[0].totalGridImportCost).toBeCloseTo(-0.50, 8);
    // Export credit = 5 * -0.02 = -0.10
    expect(result.intervals[0].gridExportCredit).toBeCloseTo(-0.10, 8);
    // Simulated cost = -0.50 - (-0.10) = -0.40
    expect(result.intervals[0].simulatedCost).toBeCloseTo(-0.40, 8);
    // Net savings = -0.50 - (-0.40) = -0.10
    expect(result.intervals[0].netSavings).toBeCloseTo(-0.10, 8);
  });

  // 15. unknown tier ID rejected
  it('15. rejects interval with unknown tier ID', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'unknown-tier' })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'unknown-tier' })];

    expect(() => calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS)).toThrow(
      /Unknown tier ID "unknown-tier"/
    );
  });

  // 16. duplicate tier IDs rejected
  it('16. rejects configuration with duplicate RateTier IDs', () => {
    const duplicateTiers: RateTier[] = [
      { id: 'peak', name: 'Peak 1', buyRate: 0.30, sellRate: 0.10, color: '#f00' },
      { id: 'peak', name: 'Peak 2', buyRate: 0.35, sellRate: 0.12, color: '#f00' },
    ];
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'peak' })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'peak' })];

    expect(() => calculateTariffCosts(gf, inf, at, 'UTC', duplicateTiers)).toThrow(
      /Duplicate RateTier ID "peak"/
    );
  });

  // 17. invalid tier rate/name/id rejected
  it('17. rejects invalid tier fields (empty id/name or non-finite buy/sell rates)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'peak' })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'peak' })];

    // Empty id
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', [
        { id: '', name: 'Empty ID', buyRate: 0.3, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/id must be a non-empty string/);

    // Empty name
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', [
        { id: 't1', name: '   ', buyRate: 0.3, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/name must be a non-empty string/);

    // NaN buyRate
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', [
        { id: 't1', name: 'Tier 1', buyRate: NaN, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/buyRate must be a finite number/);

    // Infinity sellRate
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', [
        { id: 't1', name: 'Tier 1', buyRate: 0.3, sellRate: Infinity, color: '#000' },
      ])
    ).toThrow(/sellRate must be a finite number/);
  });

  // 18. invalid seasonal month/rates rejected
  it('18. rejects invalid seasonal configuration (out-of-range month or non-finite rates)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const at = [createMockAlignedTimestamp(0, isoUtc)];
    const inf = [createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak' })];
    const gf = [createMockGridFlow(0, isoUtc, { tierId: 'off-peak' })];

    // Month out of bounds (> 11)
    const invalidMonthSeason: TouSeason = {
      id: 'inv-month',
      name: 'Invalid Month Season',
      months: [12],
      tierRates: {},
    };
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, [invalidMonthSeason])
    ).toThrow(/month at index 0 must be an integer between 0 and 11/);

    // Month negative (< 0)
    const negativeMonthSeason: TouSeason = {
      id: 'neg-month',
      name: 'Negative Month Season',
      months: [-1],
      tierRates: {},
    };
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, [negativeMonthSeason])
    ).toThrow(/month at index 0 must be an integer between 0 and 11/);

    // Non-finite seasonal rate
    const nanRateSeason: TouSeason = {
      id: 'nan-rate',
      name: 'NaN Rate Season',
      months: [5],
      tierRates: {
        'off-peak': { buyRate: NaN, sellRate: 0.05 },
      },
    };
    expect(() =>
      calculateTariffCosts(gf, inf, at, 'UTC', DEFAULT_TIERS, [nanRateSeason])
    ).toThrow(/seasonal buyRate for tier "off-peak"/);
  });

  // 19. array length/index/timestamp mismatch rejected
  it('19. rejects array length, sourceIndex, and timestamp mismatches', () => {
    const isoUtc0 = '2025-06-15T10:00:00.000Z';
    const isoUtc1 = '2025-06-15T11:00:00.000Z';

    const at = [createMockAlignedTimestamp(0, isoUtc0)];
    const inf = [createMockIntegratedInterval(0, isoUtc0, { tierId: 'off-peak' })];
    const gf = [createMockGridFlow(0, isoUtc0, { tierId: 'off-peak' })];

    // Array length mismatch
    expect(() =>
      calculateTariffCosts(
        gf,
        [...inf, createMockIntegratedInterval(1, isoUtc1, { tierId: 'off-peak' })],
        at,
        'UTC',
        DEFAULT_TIERS
      )
    ).toThrow(/Array length mismatch/);

    // Empty arrays
    expect(() => calculateTariffCosts([], [], [], 'UTC', DEFAULT_TIERS)).toThrow(
      /gridFlows must be a non-empty array/
    );

    // sourceIndex mismatch
    const badIndexGf = [createMockGridFlow(1, isoUtc0, { tierId: 'off-peak' })];
    expect(() => calculateTariffCosts(badIndexGf, inf, at, 'UTC', DEFAULT_TIERS)).toThrow(
      /Alignment error at index 0: gridFlows sourceIndex is 1, expected 0/
    );

    // timestampUtc mismatch
    const mismatchedTsGf = [createMockGridFlow(0, isoUtc1, { tierId: 'off-peak' })];
    expect(() => calculateTariffCosts(mismatchedTsGf, inf, at, 'UTC', DEFAULT_TIERS)).toThrow(
      /Timestamp mismatch at index 0/
    );

    // sourceTimestamp mismatch
    const mismatchedSourceTsGf = [
      createMockGridFlow(0, isoUtc0, {
        tierId: 'off-peak',
        sourceTimestamp: '2025-06-15 99:99',
      }),
    ];
    expect(() =>
      calculateTariffCosts(mismatchedSourceTsGf, inf, at, 'UTC', DEFAULT_TIERS)
    ).toThrow(/Source timestamp mismatch at index 0/);
  });

  // 20. input immutability
  it('20. does not mutate input arrays or objects (verified with Object.freeze)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const atItem = Object.freeze(createMockAlignedTimestamp(0, isoUtc));
    const at = Object.freeze([atItem]);

    const infItem = Object.freeze(
      createMockIntegratedInterval(0, isoUtc, { tierId: 'off-peak', homeLoadKwh: 4 })
    );
    const inf = Object.freeze([infItem]);

    const gfItem = Object.freeze(
      createMockGridFlow(0, isoUtc, {
        tierId: 'off-peak',
        gridImportForHomeKwh: 3,
        gridImportForBatteryKwh: 1,
        totalGridImportKwh: 4,
        totalGridExportKwh: 2,
      })
    );
    const gf = Object.freeze([gfItem]);

    const tier0 = Object.freeze({ ...DEFAULT_TIERS[0] });
    const tier1 = Object.freeze({ ...DEFAULT_TIERS[1] });
    const tiers = Object.freeze([tier0, tier1]);

    const season = Object.freeze({
      id: 'summer',
      name: 'Summer Season',
      months: Object.freeze([5, 6, 7]),
      tierRates: Object.freeze({
        'off-peak': Object.freeze({ buyRate: 0.16, sellRate: 0.06 }),
      }),
    });
    const seasons = Object.freeze([season as unknown as TouSeason]);

    expect(() =>
      calculateTariffCosts(
        gf as unknown as GridFlowInterval[],
        inf as unknown as IntegratedBatteryFlowInterval[],
        at as unknown as AlignedLoadTimestamp[],
        'UTC',
        tiers as unknown as RateTier[],
        seasons as unknown as TouSeason[]
      )
    ).not.toThrow();
  });

  // 21. direct integration:
  // routeIntegratedBatteryFlow() -> calculateGridFlows() -> calculateTariffCosts()
  // with no remapping of grid-flow objects
  it('21. integrates directly from routeIntegratedBatteryFlow -> calculateGridFlows -> calculateTariffCosts', () => {
    const solarLoadFlows: SolarLoadFlowInterval[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 12:00',
        timestampUtc: '2025-06-01T12:00:00.000Z',
        homeLoadKwh: 2,
        solarGenerationKwh: 7,
        solarDirectToLoadKwh: 2,
        residualHomeLoadKwh: 0,
        surplusSolarKwh: 5,
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2025-06-01 18:00',
        timestampUtc: '2025-06-01T18:00:00.000Z',
        homeLoadKwh: 6,
        solarGenerationKwh: 0,
        solarDirectToLoadKwh: 0,
        residualHomeLoadKwh: 6,
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

    const alignedTimestamps: AlignedLoadTimestamp[] = [
      createMockAlignedTimestamp(0, '2025-06-01T12:00:00.000Z', '2025-06-01 12:00'),
      createMockAlignedTimestamp(1, '2025-06-01T18:00:00.000Z', '2025-06-01 18:00'),
    ];

    const batteryProfile: BatteryProfile = {
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

    const initialSoc: BatterySocProvenanceState = {
      syntheticSocKwh: 0,
      gridChargedSocKwh: 0,
      renewableChargedSocKwh: 0,
      generatorChargedSocKwh: 0,
    };

    // 1. G3H integrated battery flow
    const g3hResult = routeIntegratedBatteryFlow(
      solarLoadFlows,
      policy,
      1.0,
      batteryProfile,
      initialSoc
    );

    // In interval 0: surplus solar 5 charges battery by 5 kWh. Remaining surplus solar = 0.
    // In interval 1: residual load 6 is supplied by battery 5 kWh. Residual load after battery = 1 kWh.

    // 2. G3I physical grid boundary flows
    const g3iResult = calculateGridFlows(g3hResult.intervals, true);

    // In interval 0: grid import = 0, grid export = 0.
    // In interval 1: grid import for home = 1, grid import for battery = 0, total import = 1.

    // 3. G3J tariff cost accounting - directly pass g3iResult.intervals with no remapping
    const g3jResult = calculateTariffCosts(
      g3iResult.intervals,
      g3hResult.intervals,
      alignedTimestamps,
      'UTC',
      DEFAULT_TIERS
    );

    expect(g3jResult.intervals).toHaveLength(2);

    // Interval 0 (off-peak, buy 0.15):
    // Baseline: homeLoad 2 * 0.15 = 0.30
    // Total import: 0 * 0.15 = 0
    // Simulated cost: 0
    // Net savings: 0.30 - 0 = 0.30
    expect(g3jResult.intervals[0].baselineCost).toBeCloseTo(0.30, 8);
    expect(g3jResult.intervals[0].simulatedCost).toBeCloseTo(0.00, 8);
    expect(g3jResult.intervals[0].netSavings).toBeCloseTo(0.30, 8);

    // Interval 1 (on-peak, buy 0.40):
    // Baseline: homeLoad 6 * 0.40 = 2.40
    // Total import: 1 * 0.40 = 0.40
    // Simulated cost: 0.40
    // Net savings: 2.40 - 0.40 = 2.00
    expect(g3jResult.intervals[1].baselineCost).toBeCloseTo(2.40, 8);
    expect(g3jResult.intervals[1].simulatedCost).toBeCloseTo(0.40, 8);
    expect(g3jResult.intervals[1].netSavings).toBeCloseTo(2.00, 8);

    // Totals reconciliation
    expect(g3jResult.baselineCost).toBeCloseTo(2.70, 8);
    expect(g3jResult.simulatedCost).toBeCloseTo(0.40, 8);
    expect(g3jResult.netSavings).toBeCloseTo(2.30, 8);
  });
});
