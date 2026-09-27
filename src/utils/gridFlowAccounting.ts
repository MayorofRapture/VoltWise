/**
 * Grid Boundary Flow Accounting Engine (Milestone G3I)
 *
 * Models physical grid-boundary energy exchange around G3H integrated battery flow output:
 *   1. Grid import required for remaining household load
 *   2. Grid import required for battery charging (AC)
 *   3. Total grid import
 *   4. Remaining surplus solar exported to grid OR curtailed
 *
 * Does not calculate tariffs, electricity costs, savings, battery export, or finances.
 */

import {
  GridFlowInterval,
  GridFlowResult,
  IntegratedBatteryFlowInterval,
} from '../types/energy';

/**
 * Calculates physical grid import and export/curtailment flows for each interval.
 *
 * Pure function: does not mutate inputs.
 */
export function calculateGridFlows(
  intervals: IntegratedBatteryFlowInterval[],
  allowSolarExport: boolean
): GridFlowResult {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error('intervals must be a non-empty array.');
  }

  if (typeof allowSolarExport !== 'boolean') {
    throw new Error('allowSolarExport must be a boolean.');
  }

  let totalGridImportForHomeKwh = 0;
  let totalGridImportForBatteryKwh = 0;
  let totalGridImportKwh = 0;
  let totalSolarExportKwh = 0;
  let totalCurtailedSolarKwh = 0;
  let totalGridExportKwh = 0;

  const resultIntervals: GridFlowInterval[] = new Array(intervals.length);

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    if (!Number.isInteger(inv.sourceIndex) || inv.sourceIndex !== i) {
      throw new Error(
        `Invalid sourceIndex at index ${i}: expected integer ${i}, received ${inv.sourceIndex}.`
      );
    }

    if (
      typeof inv.sourceTimestamp !== 'string' ||
      inv.sourceTimestamp.trim() === ''
    ) {
      throw new Error(
        `Invalid sourceTimestamp at index ${i}: must be a non-empty string.`
      );
    }

    if (
      typeof inv.timestampUtc !== 'string' ||
      inv.timestampUtc.trim() === ''
    ) {
      throw new Error(
        `Invalid timestampUtc at index ${i}: must be a non-empty string.`
      );
    }

    if (typeof inv.tierId !== 'string' || inv.tierId.trim() === '') {
      throw new Error(
        `Invalid tierId at index ${i}: must be a non-empty string.`
      );
    }

    if (
      typeof inv.residualHomeLoadAfterBatteryKwh !== 'number' ||
      !Number.isFinite(inv.residualHomeLoadAfterBatteryKwh) ||
      inv.residualHomeLoadAfterBatteryKwh < 0
    ) {
      throw new Error(
        `Invalid residualHomeLoadAfterBatteryKwh at index ${i}: must be a finite non-negative number. Received: ${inv.residualHomeLoadAfterBatteryKwh}`
      );
    }

    if (
      typeof inv.gridToBatteryAcKwh !== 'number' ||
      !Number.isFinite(inv.gridToBatteryAcKwh) ||
      inv.gridToBatteryAcKwh < 0
    ) {
      throw new Error(
        `Invalid gridToBatteryAcKwh at index ${i}: must be a finite non-negative number. Received: ${inv.gridToBatteryAcKwh}`
      );
    }

    if (
      typeof inv.remainingSurplusSolarKwh !== 'number' ||
      !Number.isFinite(inv.remainingSurplusSolarKwh) ||
      inv.remainingSurplusSolarKwh < 0
    ) {
      throw new Error(
        `Invalid remainingSurplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${inv.remainingSurplusSolarKwh}`
      );
    }

    const residualHomeLoadKwh = inv.residualHomeLoadAfterBatteryKwh;
    const gridBatteryChargeKwh = inv.gridToBatteryAcKwh;
    const remainingSurplusSolarKwh = inv.remainingSurplusSolarKwh;

    const gridImportForHomeKwh = residualHomeLoadKwh;
    const gridImportForBatteryKwh = gridBatteryChargeKwh;
    const intervalTotalGridImportKwh =
      gridImportForHomeKwh + gridImportForBatteryKwh;

    let solarExportKwh = 0;
    let curtailedSolarKwh = 0;

    if (allowSolarExport) {
      solarExportKwh = remainingSurplusSolarKwh;
      curtailedSolarKwh = 0;
    } else {
      solarExportKwh = 0;
      curtailedSolarKwh = remainingSurplusSolarKwh;
    }

    const totalGridExportKwhInterval = solarExportKwh;

    totalGridImportForHomeKwh += gridImportForHomeKwh;
    totalGridImportForBatteryKwh += gridImportForBatteryKwh;
    totalGridImportKwh += intervalTotalGridImportKwh;
    totalSolarExportKwh += solarExportKwh;
    totalCurtailedSolarKwh += curtailedSolarKwh;
    totalGridExportKwh += totalGridExportKwhInterval;

    resultIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      tierId: inv.tierId,

      residualHomeLoadKwh,
      gridBatteryChargeKwh,
      remainingSurplusSolarKwh,

      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh: intervalTotalGridImportKwh,

      solarExportKwh,
      curtailedSolarKwh,
      totalGridExportKwh: totalGridExportKwhInterval,
    };
  }

  return {
    intervals: resultIntervals,
    totalGridImportForHomeKwh,
    totalGridImportForBatteryKwh,
    totalGridImportKwh,
    totalSolarExportKwh,
    totalCurtailedSolarKwh,
    totalGridExportKwh,
  };
}
