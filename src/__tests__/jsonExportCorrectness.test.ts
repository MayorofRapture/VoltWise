import { describe, it, expect } from 'vitest';
import { buildExportLlmJson } from '../utils/exportJson';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_TOU_PROFILES,
  calculate15YearFinancials,
} from '../utils/simulationEngine';
import { AnnualSimulationSummary, CsvValidationResult } from '../types/energy';

describe('Issue 4 — JSON Export Correctness and Consistency', () => {
  const profile = DEFAULT_BATTERY_PROFILES[0]; // Tesla Powerwall 3
  const touProfile = DEFAULT_TOU_PROFILES[0]; // CA EV2-A
  const tiers = touProfile.tiers;

  const dummySummary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 9000,
    baselineAnnualCost: 2400,
    simulatedAnnualCost: 1400,
    year1Savings: 1000,
    savingsPercentage: 41.7,
    annualGridImportKwh: 5500,
    annualGridExportKwh: 200,
    annualBatteryDischargedKwh: 3500,
    equivalentFullCycles: 260,
    maxPeakDemandKw: 7.2,
    intervalResults: [],
  };

  const mockCsvResult: CsvValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    totalRows: 8760,
    validRows: 8760,
    totalKwh: 9000,
    intervalHours: 1,
    startDate: '2025-01-01 00:00',
    endDate: '2025-12-31 23:00',
    peakKw: 7.2,
    data: [],
    completeness: {
      startDate: '2025-01-01 00:00',
      endDate: '2025-12-31 23:00',
      intervalCount: 8760,
      intervalDurationHours: 1,
      durationDays: 365,
      expectedIntervalCount: 8760,
      missingIntervalCount: 0,
      isLeapYear: false,
      isSuitableForAnnualProjection: true,
    },
  };

  it('ensures 15-year export contains 15-year metrics rather than 25-year metrics', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const export15 = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(export15.metadata.selected_horizon_years).toBe(15);
    expect(export15.annual_time_series).toHaveLength(15);

    const p15 = analysis.projections[14]; // Year 15 projection
    const p25 = analysis.projections[24]; // Year 25 projection

    // NPV in 15-year export must match Year 15 cumulative NPV, NOT Year 25 NPV
    expect(export15.horizon_summary_kpis.horizon_net_present_value_usd).toBe(p15.cumulativeNpv);
    expect(export15.horizon_summary_kpis.horizon_cumulative_net_cash_flow_usd).toBe(p15.cumulativeCashFlow);
    expect(export15.horizon_summary_kpis.end_of_horizon_soh_pct).toBe(p15.sohPercent);
    expect(export15.horizon_summary_kpis.end_of_horizon_usable_capacity_kwh).toBe(p15.usableCapacityKwh);
    expect(export15.horizon_summary_kpis.horizon_cumulative_cycles).toBe(p15.cumulativeCycles);

    // Verify it differs from 25-year values
    expect(export15.horizon_summary_kpis.end_of_horizon_soh_pct).not.toBe(p25.sohPercent);
  });

  it('ensures 25-year export contains 25-year metrics', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const export25 = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 25,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(export25.metadata.selected_horizon_years).toBe(25);
    expect(export25.annual_time_series).toHaveLength(25);

    const p25 = analysis.projections[24];
    expect(export25.horizon_summary_kpis.horizon_net_present_value_usd).toBe(p25.cumulativeNpv);
    expect(export25.horizon_summary_kpis.end_of_horizon_soh_pct).toBe(p25.sohPercent);
    expect(export25.horizon_summary_kpis.horizon_cumulative_cycles).toBe(p25.cumulativeCycles);
  });

  it('ensures disabled replacement does not export replacement values or phantom expenses', () => {
    const noReplacementFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: false,
      replacementCost: 2000,
      replacementYear: 10,
    };

    const analysis = calculate15YearFinancials(profile, dummySummary, noReplacementFinancials);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: noReplacementFinancials,
      csvResult: mockCsvResult,
    });

    expect(exportData.financial_assumptions.replacement.replacement_enabled).toBe(false);
    expect(exportData.financial_assumptions.replacement.replacement_cost_usd).toBeNull();
    expect(exportData.financial_assumptions.replacement.replacement_year).toBeNull();
    expect(exportData.horizon_summary_kpis.horizon_replacement_expenses_usd).toBe(0);

    // Ensure no replacement expense exists in the annual series
    exportData.annual_time_series.forEach((yr) => {
      expect(yr.replacement_expense_usd).toBe(0);
    });
  });

  it('includes complete tariff configuration, battery dispatch configuration, and dataset metadata', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    // Dataset Metadata
    expect(exportData.metadata.dataset_summary.start_date).toBe('2025-01-01 00:00');
    expect(exportData.metadata.dataset_summary.end_date).toBe('2025-12-31 23:00');
    expect(exportData.metadata.dataset_summary.total_intervals).toBe(8760);
    expect(exportData.metadata.dataset_summary.duration_days).toBe(365);
    expect(exportData.metadata.dataset_summary.is_suitable_for_annual_projection).toBe(true);

    // Battery Configuration
    expect(exportData.battery_configuration.profile_name).toBe(profile.name);
    expect(exportData.battery_configuration.total_capacity_kwh).toBe(profile.totalCapacityKwh);
    expect(exportData.battery_configuration.round_trip_efficiency_pct).toBe(profile.roundTripEfficiencyPercent);
    expect(exportData.battery_configuration.charge_tiers).toEqual(profile.chargeTiers);
    expect(exportData.battery_configuration.discharge_tiers).toEqual(profile.dischargeTiers);
    expect(exportData.battery_configuration.installed_cost_usd).toBe(profile.installedCost);

    // Tariff Configuration
    expect(exportData.tariff_configuration.profile_name).toBe(touProfile.name);
    expect(exportData.tariff_configuration.rate_tiers.length).toBeGreaterThanOrEqual(1);
    expect(exportData.tariff_configuration.schedule_matrix).toHaveLength(7);
  });
});
