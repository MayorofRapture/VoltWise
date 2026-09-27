/**
 * TOU / Seasonal Tariff Cost Accounting Engine (Milestone G3J)
 *
 * Computes interval-level electricity costs and net savings for VoltWise simulations:
 *   - Resolves active buy and sell rates per interval from base TOU tiers and seasonal overrides.
 *   - Uses site IANA timezone to resolve local calendar month (not UTC or host timezone).
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
import {
  AlignedLoadTimestamp,
  isValidIanaTimeZone,
} from './loadTimeAlignment';

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

  // 3. Timezone validation
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(`Invalid or unsupported IANA timeZone: "${timeZone}".`);
  }

  // 4. RateTier validation
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error('tiers must be a non-empty array.');
  }

  const tierMap = new Map<string, RateTier>();
  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    if (!tier || typeof tier !== 'object') {
      throw new Error(`Invalid RateTier at index ${t}: must be an object.`);
    }
    if (typeof tier.id !== 'string' || tier.id.trim() === '') {
      throw new Error(
        `Invalid RateTier at index ${t}: id must be a non-empty string.`
      );
    }
    if (typeof tier.name !== 'string' || tier.name.trim() === '') {
      throw new Error(
        `Invalid RateTier at index ${t}: name must be a non-empty string.`
      );
    }
    if (typeof tier.buyRate !== 'number' || !Number.isFinite(tier.buyRate)) {
      throw new Error(
        `Invalid RateTier "${tier.id}": buyRate must be a finite number. Received: ${tier.buyRate}`
      );
    }
    if (typeof tier.sellRate !== 'number' || !Number.isFinite(tier.sellRate)) {
      throw new Error(
        `Invalid RateTier "${tier.id}": sellRate must be a finite number. Received: ${tier.sellRate}`
      );
    }
    if (tierMap.has(tier.id)) {
      throw new Error(
        `Duplicate RateTier ID "${tier.id}" detected in tiers configuration.`
      );
    }
    tierMap.set(tier.id, tier);
  }

  // 5. TouSeason validation (if provided)
  if (seasons !== undefined && seasons !== null) {
    if (!Array.isArray(seasons)) {
      throw new Error('seasons must be an array when provided.');
    }

    for (let s = 0; s < seasons.length; s++) {
      const season = seasons[s];
      if (!season || typeof season !== 'object') {
        throw new Error(`Invalid TouSeason at index ${s}: must be an object.`);
      }
      if (typeof season.id !== 'string' || season.id.trim() === '') {
        throw new Error(
          `Invalid TouSeason at index ${s}: id must be a non-empty string.`
        );
      }
      if (typeof season.name !== 'string' || season.name.trim() === '') {
        throw new Error(
          `Invalid TouSeason at index ${s}: name must be a non-empty string.`
        );
      }
      if (!Array.isArray(season.months)) {
        throw new Error(
          `Invalid TouSeason "${season.id}": months must be an array.`
        );
      }
      for (let mIdx = 0; mIdx < season.months.length; mIdx++) {
        const m = season.months[mIdx];
        if (!Number.isInteger(m) || m < 0 || m > 11) {
          throw new Error(
            `Invalid TouSeason "${season.id}": month at index ${mIdx} must be an integer between 0 and 11. Received: ${m}`
          );
        }
      }
      if (
        !season.tierRates ||
        typeof season.tierRates !== 'object' ||
        Array.isArray(season.tierRates)
      ) {
        throw new Error(
          `Invalid TouSeason "${season.id}": tierRates must be a non-array object.`
        );
      }
      for (const [tierId, rates] of Object.entries(season.tierRates)) {
        if (!rates || typeof rates !== 'object') {
          throw new Error(
            `Invalid seasonal tier rates for tier "${tierId}" in season "${season.id}": must be an object.`
          );
        }
        if (typeof rates.buyRate !== 'number' || !Number.isFinite(rates.buyRate)) {
          throw new Error(
            `Invalid seasonal buyRate for tier "${tierId}" in season "${season.id}": must be a finite number. Received: ${rates.buyRate}`
          );
        }
        if (typeof rates.sellRate !== 'number' || !Number.isFinite(rates.sellRate)) {
          throw new Error(
            `Invalid seasonal sellRate for tier "${tierId}" in season "${season.id}": must be a finite number. Received: ${rates.sellRate}`
          );
        }
      }
    }
  }

  // 6. Setup local month formatter
  const localMonthFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    month: 'numeric',
  });

  // 7. Interval accumulation variables
  let totalBaselineCost = 0;
  let totalGridImportForHomeCost = 0;
  let totalGridImportForBatteryCost = 0;
  let totalGridImportCost = 0;
  let totalGridExportCredit = 0;
  let totalSimulatedCost = 0;
  let totalNetSavings = 0;

  const resultIntervals: TariffCostInterval[] = new Array(length);

  // 8. Interval-by-interval processing
  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    const inf = integratedIntervals[i];
    const at = alignedTimestamps[i];

    if (!gf || typeof gf !== 'object') {
      throw new Error(`Invalid gridFlow interval at index ${i}: must be an object.`);
    }
    if (!inf || typeof inf !== 'object') {
      throw new Error(
        `Invalid integrated interval at index ${i}: must be an object.`
      );
    }
    if (!at || typeof at !== 'object') {
      throw new Error(
        `Invalid alignedTimestamp interval at index ${i}: must be an object.`
      );
    }

    // Source index alignment
    if (gf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: gridFlows sourceIndex is ${gf.sourceIndex}, expected ${i}.`
      );
    }
    if (inf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: integratedIntervals sourceIndex is ${inf.sourceIndex}, expected ${i}.`
      );
    }
    if (at.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: alignedTimestamps sourceIndex is ${at.sourceIndex}, expected ${i}.`
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

    // Tier existence
    const baseTier = tierMap.get(gf.tierId);
    if (!baseTier) {
      throw new Error(
        `Unknown tier ID "${gf.tierId}" at index ${i}: not present in configured tiers.`
      );
    }

    // Check instantUtc Date validity
    if (!(at.instantUtc instanceof Date) || isNaN(at.instantUtc.getTime())) {
      throw new Error(
        `Invalid instantUtc at index ${i}: must be a valid Date object.`
      );
    }

    // Resolve local calendar month using site timezone
    const parts = localMonthFormatter.formatToParts(at.instantUtc);
    const monthPart = parts.find((p) => p.type === 'month');
    if (!monthPart) {
      throw new Error(
        `Failed to resolve local month for instantUtc at index ${i}.`
      );
    }
    const localMonth = parseInt(monthPart.value, 10) - 1;
    if (localMonth < 0 || localMonth > 11 || isNaN(localMonth)) {
      throw new Error(
        `Resolved invalid local month ${localMonth} at index ${i}.`
      );
    }

    // Active season matching: first-matching season wins
    const activeSeason = seasons?.find((s) => s.months.includes(localMonth));

    let buyRate = baseTier.buyRate;
    let sellRate = baseTier.sellRate;
    let seasonName: string | undefined = undefined;

    if (activeSeason) {
      seasonName = activeSeason.name;
      const seasonalOverride = activeSeason.tierRates[baseTier.id];
      if (seasonalOverride !== undefined && seasonalOverride !== null) {
        buyRate = seasonalOverride.buyRate;
        sellRate = seasonalOverride.sellRate;
      }
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

      tierId: baseTier.id,
      tierName: baseTier.name,
      seasonName,

      localMonth,

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
