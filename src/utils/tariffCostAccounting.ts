/**
 * TOU / Seasonal Tariff Cost Accounting Engine (Milestone G3J)
 *
 * Computes interval-level electricity costs and net savings for VoltWise simulations:
 *   - Reuses authoritative tariff rate resolution from Milestone G3M (resolveTariffRates).
 *   - Evaluates baseline electricity cost against original household load.
 *   - Evaluates simulated grid import costs for home and battery AC charging.
 *   - Evaluates solar export feed-in credits and simulated net cost.
 *   - Computes interval-level and aggregate financial savings.
 *
 * Pure function: does not mutate inputs. Does not modify physical dispatch or long-term finances.
 */

import {
  GridFlowInterval,
  IntegratedBatteryFlowInterval,
  RateTier,
  TariffCostInterval,
  TariffCostResult,
  TouSeason,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';
import { resolveTariffRates } from './tariffRateResolver';

/**
 * Calculates interval-by-interval tariff costs, export credits, simulated costs, and net savings.
 *
 * @param gridFlows Physical grid-boundary exchange intervals (from G3I)
 * @param integratedIntervals Integrated solar/load/battery intervals (from G3H)
 * @param alignedTimestamps Authoritative aligned timestamps (from G2D)
 * @param timeZone Site IANA timezone string
 * @param tiers Non-empty array of base RateTier definitions
 * @param seasons Optional array of seasonal TOU overrides
 * @returns TariffCostResult containing interval accounting and reconciled totals
 */
export function calculateTariffCosts(
  gridFlows: GridFlowInterval[],
  integratedIntervals: IntegratedBatteryFlowInterval[],
  alignedTimestamps: AlignedLoadTimestamp[],
  timeZone: string,
  tiers: RateTier[],
  seasons?: TouSeason[]
): TariffCostResult {
  // 1. Array existence and non-emptiness checks
  if (!Array.isArray(gridFlows) || gridFlows.length === 0) {
    throw new Error('gridFlows must be a non-empty array.');
  }

  if (!Array.isArray(integratedIntervals) || integratedIntervals.length === 0) {
    throw new Error('integratedIntervals must be a non-empty array.');
  }

  if (!Array.isArray(alignedTimestamps) || alignedTimestamps.length === 0) {
    throw new Error('alignedTimestamps must be a non-empty array.');
  }

  // 2. Length equality check
  const length = gridFlows.length;
  if (
    integratedIntervals.length !== length ||
    alignedTimestamps.length !== length
  ) {
    throw new Error(
      `Array length mismatch: gridFlows has ${length}, integratedIntervals has ${integratedIntervals.length}, alignedTimestamps has ${alignedTimestamps.length}.`
    );
  }

  // Energy-flow specific alignment check for gridFlows sourceIndex
  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    if (!gf || typeof gf !== 'object') {
      throw new Error(`Invalid gridFlow interval at index ${i}: must be an object.`);
    }
    if (gf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: gridFlows sourceIndex is ${gf.sourceIndex}, expected ${i}.`
      );
    }
  }

  // 3. Authoritative tariff rate resolution via G3M reusable resolver
  // (Validates timeZone, tiers, seasons, alignedTimestamps, and resolves buyRate/sellRate/localMonth/seasonName)
  const resolvedRates = resolveTariffRates(
    gridFlows,
    alignedTimestamps,
    timeZone,
    tiers,
    seasons
  );

  // 4. Interval accumulation variables
  let totalBaselineCost = 0;
  let totalGridImportForHomeCost = 0;
  let totalGridImportForBatteryCost = 0;
  let totalGridImportCost = 0;
  let totalGridExportCredit = 0;
  let totalSimulatedCost = 0;
  let totalNetSavings = 0;

  const resultIntervals: TariffCostInterval[] = new Array(length);

  // 5. Interval-by-interval energy accounting
  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    const inf = integratedIntervals[i];
    const at = alignedTimestamps[i];
    const rr = resolvedRates[i];

    if (!inf || typeof inf !== 'object') {
      throw new Error(
        `Invalid integrated interval at index ${i}: must be an object.`
      );
    }

    // Source index alignment
    if (inf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: integratedIntervals sourceIndex is ${inf.sourceIndex}, expected ${i}.`
      );
    }

    // Timestamp UTC alignment
    if (gf.timestampUtc !== inf.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: gridFlows timestampUtc ("${gf.timestampUtc}") !== integratedIntervals timestampUtc ("${inf.timestampUtc}").`
      );
    }
    if (inf.timestampUtc !== at.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: integratedIntervals timestampUtc ("${inf.timestampUtc}") !== alignedTimestamps timestampUtc ("${at.timestampUtc}").`
      );
    }

    // Source timestamp alignment
    if (gf.sourceTimestamp !== inf.sourceTimestamp) {
      throw new Error(
        `Source timestamp mismatch at index ${i}: gridFlows sourceTimestamp ("${gf.sourceTimestamp}") !== integratedIntervals sourceTimestamp ("${inf.sourceTimestamp}").`
      );
    }

    // Energy flows validation
    const homeLoadKwh = inf.homeLoadKwh;
    if (typeof homeLoadKwh !== 'number' || !Number.isFinite(homeLoadKwh)) {
      throw new Error(
        `Invalid homeLoadKwh at index ${i}: must be a finite number. Received: ${homeLoadKwh}`
      );
    }

    const gridImportForHomeKwh = gf.gridImportForHomeKwh;
    if (
      typeof gridImportForHomeKwh !== 'number' ||
      !Number.isFinite(gridImportForHomeKwh)
    ) {
      throw new Error(
        `Invalid gridImportForHomeKwh at index ${i}: must be a finite number. Received: ${gridImportForHomeKwh}`
      );
    }

    const gridImportForBatteryKwh = gf.gridImportForBatteryKwh;
    if (
      typeof gridImportForBatteryKwh !== 'number' ||
      !Number.isFinite(gridImportForBatteryKwh)
    ) {
      throw new Error(
        `Invalid gridImportForBatteryKwh at index ${i}: must be a finite number. Received: ${gridImportForBatteryKwh}`
      );
    }

    const totalGridImportKwh = gf.totalGridImportKwh;
    if (
      typeof totalGridImportKwh !== 'number' ||
      !Number.isFinite(totalGridImportKwh)
    ) {
      throw new Error(
        `Invalid totalGridImportKwh at index ${i}: must be a finite number. Received: ${totalGridImportKwh}`
      );
    }

    const totalGridExportKwh = gf.totalGridExportKwh;
    if (
      typeof totalGridExportKwh !== 'number' ||
      !Number.isFinite(totalGridExportKwh)
    ) {
      throw new Error(
        `Invalid totalGridExportKwh at index ${i}: must be a finite number. Received: ${totalGridExportKwh}`
      );
    }

    // Resolved rates from G3M utility
    const buyRate = rr.buyRate;
    const sellRate = rr.sellRate;

    // Cost equations
    const baselineCost = homeLoadKwh * buyRate;

    const gridImportForHomeCost = gridImportForHomeKwh * buyRate;
    const gridImportForBatteryCost = gridImportForBatteryKwh * buyRate;
    const totalGridImportCostInterval = totalGridImportKwh * buyRate;

    const gridExportCredit = totalGridExportKwh * sellRate;

    const simulatedCost = totalGridImportCostInterval - gridExportCredit;
    const netSavings = baselineCost - simulatedCost;

    // Accumulate totals independently
    totalBaselineCost += baselineCost;
    totalGridImportForHomeCost += gridImportForHomeCost;
    totalGridImportForBatteryCost += gridImportForBatteryCost;
    totalGridImportCost += totalGridImportCostInterval;
    totalGridExportCredit += gridExportCredit;
    totalSimulatedCost += simulatedCost;
    totalNetSavings += netSavings;

    resultIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: gf.sourceTimestamp,
      timestampUtc: gf.timestampUtc,

      tierId: rr.tierId,
      tierName: rr.tierName,
      seasonName: rr.seasonName,

      localMonth: rr.localMonth,

      buyRate,
      sellRate,

      homeLoadKwh,

      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh,
      totalGridExportKwh,

      baselineCost,

      gridImportForHomeCost,
      gridImportForBatteryCost,
      totalGridImportCost: totalGridImportCostInterval,

      gridExportCredit,

      simulatedCost,
      netSavings,
    };
  }

  return {
    intervals: resultIntervals,
    baselineCost: totalBaselineCost,
    gridImportForHomeCost: totalGridImportForHomeCost,
    gridImportForBatteryCost: totalGridImportForBatteryCost,
    totalGridImportCost,
    gridExportCredit: totalGridExportCredit,
    simulatedCost: totalSimulatedCost,
    netSavings: totalNetSavings,
  };
}
