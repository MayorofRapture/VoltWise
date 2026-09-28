/**
 * Generation Project Cost Aggregation & Analysis Routing State Contracts (Milestone G4A)
 *
 * Provides:
 * 1. Authoritative pure aggregation of enabled generation asset CAPEX and annual O&M.
 * 2. Independent solar asset capacity and degradation metadata preservation for future G4 stages.
 * 3. Pure analysis state derivation distinguishing legacy financial, generation-financial-pending,
 *    and partial-period states.
 * 4. Production financial safety gate rules preventing generation savings from entering the
 *    legacy battery-only calculate15YearFinancials() pipeline.
 */

import {
  AnalysisState,
  DatasetCompleteness,
  GenerationAsset,
  GenerationAssetCostBreakdown,
  GenerationConfig,
  GenerationProjectCostSummary,
  GenerationTypeCostBreakdown,
  GenerationTypeCostMap,
  SolarAssetMetadata,
  SolarGenerationAsset,
} from '../types/energy';
import { UnifiedSimulationResult } from './simulationRouter';

export interface DeriveAnalysisStateParams {
  isSuitableForAnnual?: boolean;
  simulationMode?: 'legacy' | 'generation-aware' | null;
  hasEnabledGeneration?: boolean;
  completeness?: DatasetCompleteness | null;
  unifiedResult?: UnifiedSimulationResult | null;
}

/**
 * Aggregates CAPEX and annual O&M for all enabled generation assets.
 * Disabled assets contribute zero.
 * Reconciles totals against per-asset and per-type breakdowns exactly.
 * Preserves individual solar array metadata (capacity, inverter size, degradation)
 * without fleet-averaging.
 */
export function aggregateGenerationProjectCosts(
  config?: GenerationConfig | GenerationAsset[] | null
): GenerationProjectCostSummary {
  const assets: GenerationAsset[] = Array.isArray(config)
    ? config
    : Array.isArray(config?.assets)
    ? config.assets
    : [];

  const enabledAssets = assets.filter(
    (asset): asset is GenerationAsset => asset != null && asset.enabled === true
  );

  let rawCapex = 0;
  let rawOm = 0;

  const byAsset: GenerationAssetCostBreakdown[] = [];
  const solarMetadata: SolarAssetMetadata[] = [];

  const typeTotals: Record<
    'solar' | 'wind' | 'generator',
    { installedCostUsd: number; annualMaintenanceCostUsd: number; assetCount: number }
  > = {
    solar: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
    wind: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
    generator: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
  };

  for (const asset of enabledAssets) {
    const capex = Number(asset.installedCostUsd) || 0;
    const om = Number(asset.annualMaintenanceCostUsd) || 0;
    const type = asset.type;

    rawCapex += capex;
    rawOm += om;

    byAsset.push({
      id: asset.id,
      name: asset.name,
      type,
      installedCostUsd: capex,
      annualMaintenanceCostUsd: om,
    });

    if (typeTotals[type]) {
      typeTotals[type].installedCostUsd += capex;
      typeTotals[type].annualMaintenanceCostUsd += om;
      typeTotals[type].assetCount += 1;
    }

    if (type === 'solar') {
      const solarAsset = asset as SolarGenerationAsset;
      solarMetadata.push({
        id: solarAsset.id,
        name: solarAsset.name,
        dcCapacityKw: Number(solarAsset.dcCapacityKw) || 0,
        inverterAcCapacityKw: Number(solarAsset.inverterAcCapacityKw) || 0,
        annualDegradationPercent: Number(solarAsset.annualDegradationPercent) || 0,
        tiltDegrees: solarAsset.tiltDegrees,
        azimuthDegrees: solarAsset.azimuthDegrees,
        installedCostUsd: capex,
        annualMaintenanceCostUsd: om,
      });
    }
  }

  const generationCapexUsd = Math.round(rawCapex * 100) / 100;
  const annualGenerationMaintenanceUsd = Math.round(rawOm * 100) / 100;

  const solarBreakdown: GenerationTypeCostBreakdown = {
    type: 'solar',
    installedCostUsd: Math.round(typeTotals.solar.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.solar.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.solar.assetCount,
  };

  const windBreakdown: GenerationTypeCostBreakdown = {
    type: 'wind',
    installedCostUsd: Math.round(typeTotals.wind.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.wind.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.wind.assetCount,
  };

  const generatorBreakdown: GenerationTypeCostBreakdown = {
    type: 'generator',
    installedCostUsd: Math.round(typeTotals.generator.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.generator.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.generator.assetCount,
  };

  const byTypeArray = [
    solarBreakdown,
    windBreakdown,
    generatorBreakdown,
  ] as GenerationTypeCostBreakdown[] & GenerationTypeCostMap;

  byTypeArray.solar = solarBreakdown;
  byTypeArray.wind = windBreakdown;
  byTypeArray.generator = generatorBreakdown;

  return {
    generationCapexUsd,
    annualGenerationMaintenanceUsd,
    byAsset,
    byType: byTypeArray,
    solarMetadata,
  };
}

/** Alias for aggregateGenerationProjectCosts */
export const calculateGenerationProjectCosts = aggregateGenerationProjectCosts;

/**
 * Derives the explicit financial analysis state from dataset suitability and simulation mode.
 * - 'partial-period': Incomplete dataset unsuitable for annual projection.
 * - 'legacy-financial': Full-year dataset with no enabled generation (exact legacy financial path).
 * - 'generation-financial-pending': Full-year dataset with generation-aware simulation active;
 *   lifecycle financials are pending G4C.
 * - 'generation-financial': Reserved for future G4C implementation.
 */
export function deriveAnalysisState(
  isSuitableForAnnualOrParams: boolean | DeriveAnalysisStateParams,
  simulationMode?: 'legacy' | 'generation-aware' | null
): AnalysisState {
  if (typeof isSuitableForAnnualOrParams === 'object' && isSuitableForAnnualOrParams !== null) {
    const params = isSuitableForAnnualOrParams;
    const isSuitable =
      params.completeness != null
        ? Boolean(params.completeness.isSuitableForAnnualProjection)
        : (params.isSuitableForAnnual ?? true);

    if (!isSuitable) {
      return 'partial-period';
    }

    const mode =
      params.simulationMode ??
      params.unifiedResult?.mode ??
      (params.hasEnabledGeneration ? 'generation-aware' : 'legacy');

    if (mode === 'generation-aware') {
      return 'generation-financial-pending';
    }
    return 'legacy-financial';
  }

  const isSuitable = Boolean(isSuitableForAnnualOrParams);
  if (!isSuitable) {
    return 'partial-period';
  }
  if (simulationMode === 'generation-aware') {
    return 'generation-financial-pending';
  }
  return 'legacy-financial';
}

/**
 * Production financial safety gate:
 * Determines whether a simulation summary may be passed into calculate15YearFinancials().
 *
 * calculate15YearFinancials() must ONLY be invoked for:
 * - Full-year datasets (isSuitableForAnnual === true)
 * - In legacy simulation mode (no enabled generation assets)
 *
 * Returns false for generation-aware results and partial-period datasets.
 */
export function shouldCalculateLegacyFinancials(
  isSuitableForAnnual: boolean,
  simulationMode?: 'legacy' | 'generation-aware' | null
): boolean {
  return Boolean(isSuitableForAnnual) && simulationMode === 'legacy';
}
