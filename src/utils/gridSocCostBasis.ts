/**
 * Grid-Charged SOC Acquisition-Cost Basis Engine (Milestone G3K)
 *
 * Tracks the weighted-average acquisition cost of ONLY grid-charged energy
 * currently stored in the battery:
 *   - Inventory/cost-basis ledger for future battery-export economics.
 *   - Uses G3J's resolved tariff accounting (AC purchase cost of grid imports).
 *   - Accurately tracks weighted-average cost basis on charge additions.
 *   - Removes proportional acquisition cost on G3H grid-SOC provenance depletion.
 *   - Preserves average $/stored-kWh across partial discharges.
 *   - Normalizes to exact zero upon full depletion.
 *   - Supports finite negative electricity prices without artificial clamping.
 *
 * Pure function: does not mutate inputs. Does not modify physical dispatch,
 * G3J tariff costs, or long-term financial results.
 */

import {
  GridSocCostBasisInterval,
  GridSocCostBasisResult,
  GridSocCostBasisState,
  IntegratedBatteryFlowInterval,
  TariffCostInterval,
} from '../types/energy';

const EPSILON = 1e-6;
const ZERO_THRESHOLD = 1e-9;

/**
 * Tracks the weighted-average acquisition cost basis of grid-charged battery energy.
 *
 * @param integratedIntervals Integrated battery flow intervals with provenance state (from G3H)
 * @param tariffIntervals Tariff-accounted cost intervals (from G3J)
 * @param initialState Initial grid-SOC cost basis state
 * @returns Result containing interval cost-basis ledger and summary totals
 */
export function trackGridSocCostBasis(
  integratedIntervals: IntegratedBatteryFlowInterval[],
  tariffIntervals: TariffCostInterval[],
  initialState: GridSocCostBasisState
): GridSocCostBasisResult {
  // 1. Array validation
  if (!Array.isArray(integratedIntervals) || integratedIntervals.length === 0) {
    throw new Error('integratedIntervals must be a non-empty array.');
  }
  if (!Array.isArray(tariffIntervals) || tariffIntervals.length === 0) {
    throw new Error('tariffIntervals must be a non-empty array.');
  }

  const length = integratedIntervals.length;
  if (tariffIntervals.length !== length) {
    throw new Error(
      `Array length mismatch: integratedIntervals has ${length}, tariffIntervals has ${tariffIntervals.length}.`
    );
  }

  // 2. Initial state validation
  if (!initialState || typeof initialState !== 'object') {
    throw new Error('initialState must be a valid object.');
  }
  if (
    typeof initialState.gridStoredEnergyKwh !== 'number' ||
    !Number.isFinite(initialState.gridStoredEnergyKwh)
  ) {
    throw new Error(
      `initialState.gridStoredEnergyKwh must be a finite number. Received: ${initialState.gridStoredEnergyKwh}`
    );
  }
  if (initialState.gridStoredEnergyKwh < 0) {
    throw new Error(
      `initialState.gridStoredEnergyKwh must be non-negative. Received: ${initialState.gridStoredEnergyKwh}`
    );
  }
  if (
    typeof initialState.totalAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(initialState.totalAcquisitionCostUsd)
  ) {
    throw new Error(
      `initialState.totalAcquisitionCostUsd must be a finite number. Received: ${initialState.totalAcquisitionCostUsd}`
    );
  }

  // Zero-energy initial state must have zero acquisition cost
  if (Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD) {
    if (Math.abs(initialState.totalAcquisitionCostUsd) >= ZERO_THRESHOLD) {
      throw new Error(
        `Initial state inconsistency: zero initial gridStoredEnergyKwh (${initialState.gridStoredEnergyKwh}) must have zero acquisition cost basis, received ${initialState.totalAcquisitionCostUsd}.`
      );
    }
  }

  // Verify initial grid energy matches first interval stateBefore.gridChargedSocKwh
  const firstInterval = integratedIntervals[0];
  if (!firstInterval || !firstInterval.stateBefore) {
    throw new Error('Invalid first interval: missing stateBefore.');
  }
  if (
    Math.abs(
      initialState.gridStoredEnergyKwh -
        firstInterval.stateBefore.gridChargedSocKwh
    ) > EPSILON
  ) {
    throw new Error(
      `Initial gridStoredEnergyKwh (${initialState.gridStoredEnergyKwh}) does not match first interval stateBefore.gridChargedSocKwh (${firstInterval.stateBefore.gridChargedSocKwh}).`
    );
  }

  // Ledger tracking state
  let currentGridEnergy =
    Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD
      ? 0
      : initialState.gridStoredEnergyKwh;
  let currentAcquisitionCost =
    Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD
      ? 0
      : initialState.totalAcquisitionCostUsd;

  let totalGridChargeAcquisitionCostUsd = 0;
  let totalGridSocCostRemovedUsd = 0;

  const resultIntervals: GridSocCostBasisInterval[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const inf = integratedIntervals[i];
    const tf = tariffIntervals[i];

    if (!inf || typeof inf !== 'object') {
      throw new Error(
        `Invalid integratedInterval at index ${i}: must be an object.`
      );
    }
    if (!tf || typeof tf !== 'object') {
      throw new Error(`Invalid tariffInterval at index ${i}: must be an object.`);
    }

    // Alignment checks
    if (inf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: integratedIntervals sourceIndex is ${inf.sourceIndex}, expected ${i}.`
      );
    }
    if (tf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: tariffIntervals sourceIndex is ${tf.sourceIndex}, expected ${i}.`
      );
    }
    if (inf.sourceTimestamp !== tf.sourceTimestamp) {
      throw new Error(
        `Source timestamp mismatch at index ${i}: integratedIntervals ("${inf.sourceTimestamp}") !== tariffIntervals ("${tf.sourceTimestamp}").`
      );
    }
    if (inf.timestampUtc !== tf.timestampUtc) {
      throw new Error(
        `Timestamp UTC mismatch at index ${i}: integratedIntervals ("${inf.timestampUtc}") !== tariffIntervals ("${tf.timestampUtc}").`
      );
    }
    if (inf.tierId !== tf.tierId) {
      throw new Error(
        `Tier ID mismatch at index ${i}: integratedIntervals ("${inf.tierId}") !== tariffIntervals ("${tf.tierId}").`
      );
    }

    // Verify grid import energy alignment between tariff and integrated dispatch
    if (
      Math.abs(tf.gridImportForBatteryKwh - inf.gridToBatteryAcKwh) > EPSILON
    ) {
      throw new Error(
        `Tariff battery-import energy mismatch at index ${i}: tariff gridImportForBatteryKwh (${tf.gridImportForBatteryKwh}) !== integrated gridToBatteryAcKwh (${inf.gridToBatteryAcKwh}).`
      );
    }

    // Ledger alignment with G3H stateBefore
    if (
      Math.abs(currentGridEnergy - inf.stateBefore.gridChargedSocKwh) > EPSILON
    ) {
      throw new Error(
        `Physical state-before mismatch at index ${i}: ledger gridStoredEnergyKwh (${currentGridEnergy}) !== integrated stateBefore.gridChargedSocKwh (${inf.stateBefore.gridChargedSocKwh}).`
      );
    }

    const gridStoredEnergyBeforeKwh = currentGridEnergy;
    const acquisitionCostBeforeUsd = currentAcquisitionCost;

    const gridEnergyStoredKwh = inf.gridEnergyStoredKwh;
    if (
      typeof gridEnergyStoredKwh !== 'number' ||
      !Number.isFinite(gridEnergyStoredKwh) ||
      gridEnergyStoredKwh < -EPSILON
    ) {
      throw new Error(
        `Invalid gridEnergyStoredKwh at index ${i}: must be a finite non-negative number. Received: ${gridEnergyStoredKwh}`
      );
    }

    // Grid-charge acquisition cost is the AC purchase cost resolved by G3J
    const gridChargeAcquisitionCostUsd = tf.gridImportForBatteryCost;
    if (
      typeof gridChargeAcquisitionCostUsd !== 'number' ||
      !Number.isFinite(gridChargeAcquisitionCostUsd)
    ) {
      throw new Error(
        `Invalid gridImportForBatteryCost at index ${i}: must be a finite number. Received: ${gridChargeAcquisitionCostUsd}`
      );
    }

    // Inventory addition before drain
    const gridStoredEnergyBeforeDrainKwh =
      gridStoredEnergyBeforeKwh + Math.max(0, gridEnergyStoredKwh);
    const acquisitionCostBeforeDrainUsd =
      acquisitionCostBeforeUsd + gridChargeAcquisitionCostUsd;

    const averageAcquisitionCostPerStoredKwhBeforeDrain =
      gridStoredEnergyBeforeDrainKwh > ZERO_THRESHOLD
        ? acquisitionCostBeforeDrainUsd / gridStoredEnergyBeforeDrainKwh
        : 0;

    // G3H grid provenance drain
    const gridSocDrainedKwh = inf.gridSocDrainedKwh;
    if (
      typeof gridSocDrainedKwh !== 'number' ||
      !Number.isFinite(gridSocDrainedKwh) ||
      gridSocDrainedKwh < -EPSILON
    ) {
      throw new Error(
        `Invalid gridSocDrainedKwh at index ${i}: must be a finite non-negative number. Received: ${gridSocDrainedKwh}`
      );
    }

    if (gridSocDrainedKwh > gridStoredEnergyBeforeDrainKwh + EPSILON) {
      throw new Error(
        `Grid SOC drain exceeds available grid stored energy at index ${i}: drained ${gridSocDrainedKwh} > available ${gridStoredEnergyBeforeDrainKwh}.`
      );
    }

    const effectiveDrain = Math.max(0, gridSocDrainedKwh);
    const gridSocCostRemovedUsd =
      effectiveDrain * averageAcquisitionCostPerStoredKwhBeforeDrain;

    let gridStoredEnergyAfterKwh =
      gridStoredEnergyBeforeDrainKwh - effectiveDrain;
    let acquisitionCostAfterUsd =
      acquisitionCostBeforeDrainUsd - gridSocCostRemovedUsd;

    // Normalize exact zero if remaining energy is effectively zero
    if (gridStoredEnergyAfterKwh <= ZERO_THRESHOLD) {
      gridStoredEnergyAfterKwh = 0;
      acquisitionCostAfterUsd = 0;
    }

    const averageAcquisitionCostPerStoredKwhAfter =
      gridStoredEnergyAfterKwh > ZERO_THRESHOLD
        ? acquisitionCostAfterUsd / gridStoredEnergyAfterKwh
        : 0;

    // Ledger alignment with G3H stateAfter
    if (
      Math.abs(gridStoredEnergyAfterKwh - inf.stateAfter.gridChargedSocKwh) >
      EPSILON
    ) {
      throw new Error(
        `Physical state-after mismatch at index ${i}: ledger gridStoredEnergyAfterKwh (${gridStoredEnergyAfterKwh}) !== integrated stateAfter.gridChargedSocKwh (${inf.stateAfter.gridChargedSocKwh}).`
      );
    }

    // Physical reconciliation check
    const expectedAfter =
      gridStoredEnergyBeforeKwh +
      Math.max(0, gridEnergyStoredKwh) -
      effectiveDrain;
    if (
      Math.abs(expectedAfter - gridStoredEnergyAfterKwh) > EPSILON &&
      gridStoredEnergyAfterKwh !== 0
    ) {
      throw new Error(
        `Physical reconciliation failed at index ${i}: before (${gridStoredEnergyBeforeKwh}) + stored (${gridEnergyStoredKwh}) - drained (${effectiveDrain}) !== after (${gridStoredEnergyAfterKwh}).`
      );
    }

    // Advance current ledger state
    currentGridEnergy = gridStoredEnergyAfterKwh;
    currentAcquisitionCost = acquisitionCostAfterUsd;

    totalGridChargeAcquisitionCostUsd += gridChargeAcquisitionCostUsd;
    totalGridSocCostRemovedUsd += gridSocCostRemovedUsd;

    resultIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: inf.sourceTimestamp,
      timestampUtc: inf.timestampUtc,
      tierId: inf.tierId,

      gridStoredEnergyBeforeKwh,
      acquisitionCostBeforeUsd,

      gridEnergyStoredKwh: Math.max(0, gridEnergyStoredKwh),
      gridChargeAcquisitionCostUsd,

      gridStoredEnergyBeforeDrainKwh,
      acquisitionCostBeforeDrainUsd,
      averageAcquisitionCostPerStoredKwhBeforeDrain,

      gridSocDrainedKwh: effectiveDrain,
      gridSocCostRemovedUsd,

      gridStoredEnergyAfterKwh,
      acquisitionCostAfterUsd,
      averageAcquisitionCostPerStoredKwhAfter,
    };
  }

  return {
    intervals: resultIntervals,
    initialState: {
      gridStoredEnergyKwh: initialState.gridStoredEnergyKwh,
      totalAcquisitionCostUsd: initialState.totalAcquisitionCostUsd,
    },
    finalState: {
      gridStoredEnergyKwh: currentGridEnergy,
      totalAcquisitionCostUsd: currentAcquisitionCost,
    },
    totalGridChargeAcquisitionCostUsd,
    totalGridSocCostRemovedUsd,
  };
}
