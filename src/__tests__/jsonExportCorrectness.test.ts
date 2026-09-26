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

  it('exports explicit cost_and_incentives block distinguishing upfront, immediate, and deferred incentives', () => {
    const customFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      localRebateFlat: 1500,
      federalTaxCreditPercent: 30,
      federalTaxCreditRealizationYear: 1,
      isFinanced: false,
    };

    const analysis = calculate15YearFinancials(profile, dummySummary, customFinancials);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: customFinancials,
      csvResult: mockCsvResult,
    });

    const costAndIncentives = exportData.financial_assumptions.cost_and_incentives;
    expect(costAndIncentives).toBeDefined();

    // 1. Gross installed cost
    expect(costAndIncentives.gross_installed_cost_usd).toBe(analysis.grossCost);

    // 2. Immediate rebate amount
    const expectedImmediateRebates = Math.min(
      analysis.grossCost,
      Math.max(0, customFinancials.localRebateFlat)
    );
    expect(costAndIncentives.immediate_rebates_usd).toBe(expectedImmediateRebates);

    // 3. Upfront cost after immediate rebates (acquisition basis before financing)
    const expectedUpfrontCost = Math.max(0, analysis.grossCost - expectedImmediateRebates);
    expect(costAndIncentives.upfront_cost_after_immediate_rebates_usd).toBe(expectedUpfrontCost);

    // 4. Cash due at purchase (for cash purchase = upfront cost after immediate rebates)
    expect(costAndIncentives.cash_due_at_purchase_usd).toBe(analysis.upfrontOutOfPocket);
    expect(costAndIncentives.cash_due_at_purchase_usd).toBe(expectedUpfrontCost);

    // 5. Federal tax credit percentage and realization year
    expect(costAndIncentives.federal_tax_credit_pct).toBe(30);
    expect(costAndIncentives.federal_tax_credit_realization_year).toBe(1);

    // 6. Deferred federal tax credit USD (from full projections cash flow)
    const expectedDeferredTaxCredit = analysis.projections.reduce(
      (sum, p) => sum + (p.taxCreditInflow ?? 0),
      0
    );
    expect(costAndIncentives.deferred_federal_tax_credit_usd).toBe(expectedDeferredTaxCredit);

    // 7. Net cost after all incentives
    expect(costAndIncentives.net_cost_after_all_incentives_usd).toBe(analysis.netInstalledCost);

    // 8. Ensure net_upfront_installed_cost_usd is removed from horizon_summary_kpis
    expect('net_upfront_installed_cost_usd' in exportData.horizon_summary_kpis).toBe(false);

    // 9. Ensure no duplicate incentive assumptions at root of financial_assumptions
    expect('federal_tax_credit_pct' in exportData.financial_assumptions).toBe(false);
    expect('federal_tax_credit_realization_year' in exportData.financial_assumptions).toBe(false);
    expect('local_rebate_flat_usd' in exportData.financial_assumptions).toBe(false);
  });

  it('correctly exports financing reproducibility fields for financed vs cash scenarios', () => {
    // 1. Cash purchase
    const cashFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: false,
    };
    const cashAnalysis = calculate15YearFinancials(profile, dummySummary, cashFinancials);
    const cashExport = buildExportLlmJson({
      activeAnalysis: cashAnalysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: cashFinancials,
      csvResult: mockCsvResult,
    });

    expect(cashExport.financial_assumptions.financing.is_financed).toBe(false);
    expect(cashExport.financial_assumptions.financing.down_payment_usd).toBeNull();
    expect(cashExport.financial_assumptions.financing.total_loan_interest_usd).toBeNull();

    // 2. Financed purchase
    const financedFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanAprPercent: 6.5,
      loanTermYears: 10,
      loanDownPaymentPercent: 20,
    };
    const financedAnalysis = calculate15YearFinancials(profile, dummySummary, financedFinancials);
    const financedExport = buildExportLlmJson({
      activeAnalysis: financedAnalysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: financedFinancials,
      csvResult: mockCsvResult,
    });

    expect(financedExport.financial_assumptions.financing.is_financed).toBe(true);
    expect(financedExport.financial_assumptions.financing.down_payment_usd).toBe(financedAnalysis.upfrontOutOfPocket);
    expect(financedExport.financial_assumptions.financing.total_loan_interest_usd).toBe(financedAnalysis.totalLoanInterestPaid);
    expect(financedExport.financial_assumptions.cost_and_incentives.cash_due_at_purchase_usd).toBe(financedAnalysis.upfrontOutOfPocket);
  });

  it('sources application version directly from package.json without manual duplication', async () => {
    const pkg = await import('../../package.json');
    const { APP_VERSION } = await import('../version');

    expect(APP_VERSION).toBe(pkg.version);

    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(exportData.metadata.app_version).toBe(pkg.version);
  });
});
