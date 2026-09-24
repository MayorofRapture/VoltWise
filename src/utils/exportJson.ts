/**
 * LLM JSON Export Builder & Validator for VoltWise
 * Ensures strict consistency between selected projection horizon and exported KPIs.
 */
import {
  BatteryProfile,
  CsvValidationResult,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouProfile,
  YearProjection,
} from '../types/energy';

export interface ExportLlmJsonParams {
  activeAnalysis: ProfileFinancialAnalysis;
  projectionHorizon: number;
  tiers: RateTier[];
  activeTouProfile?: TouProfile;
  financials?: MacroFinancials;
  csvResult?: CsvValidationResult | null;
}

export interface LlmExportPayload {
  metadata: {
    app_name: string;
    app_version: string;
    export_timestamp: string;
    selected_horizon_years: number;
    currency: string;
    dataset_summary: {
      start_date: string;
      end_date: string;
      total_intervals: number;
      interval_duration_hours: number;
      duration_days: number;
      total_home_load_kwh: number;
      is_suitable_for_annual_projection: boolean;
      completeness_reason: string | null;
    };
  };
  battery_configuration: {
    profile_name: string;
    model: string;
    total_capacity_kwh: number;
    usable_dod_pct: number;
    usable_capacity_kwh: number;
    max_continuous_discharge_kw: number;
    max_continuous_charge_kw: number;
    round_trip_efficiency_pct: number;
    rated_cycle_life: number;
    dispatch_strategy: string;
    charge_tiers: string[];
    discharge_tiers: string[];
    allow_grid_export: boolean;
    installed_cost_usd: number;
  };
  tariff_configuration: {
    profile_name: string;
    utility: string;
    description: string;
    rate_tiers: Array<{
      id: string;
      name: string;
      buy_rate_usd_per_kwh: number;
      sell_rate_usd_per_kwh: number;
      color: string;
    }>;
    seasons: Array<{
      id: string;
      name: string;
      months: number[];
      tier_rates: Record<string, { buyRate: number; sellRate: number }>;
    }>;
    schedule_matrix: string[][];
  };
  financial_assumptions: {
    federal_tax_credit_pct: number;
    federal_tax_credit_realization_year: number;
    local_rebate_flat_usd: number;
    annual_electricity_inflation_rate_pct: number;
    annual_battery_degradation_rate_pct: number;
    discount_rate_pct: number;
    financing: {
      is_financed: boolean;
      loan_apr_pct: number;
      loan_term_years: number;
      down_payment_pct: number;
      loan_principal_usd: number;
      monthly_loan_payment_usd: number;
    };
    opportunity_cost: {
      vehicle_name: string;
      benchmark_rate_pct: number;
      horizon_future_value_usd: number;
      horizon_opportunity_profit_usd: number;
    };
    replacement: {
      replacement_enabled: boolean;
      replacement_cost_usd: number | null;
      replacement_year: number | null;
    };
    resilience: {
      critical_home_load_kw: number;
      annual_outage_days: number;
      value_of_lost_load_usd_per_day: number;
      include_voll_in_roi: boolean;
    };
  };
  year_1_results: {
    baseline_electricity_cost_usd: number;
    with_battery_electricity_cost_usd: number;
    net_savings_usd: number;
    savings_percentage: number;
    total_grid_import_kwh: number;
    total_grid_export_kwh: number;
    battery_discharged_energy_kwh: number;
    equivalent_full_cycles: number;
    peak_demand_kw: number;
  };
  horizon_summary_kpis: {
    horizon_years: number;
    net_upfront_installed_cost_usd: number;
    horizon_net_present_value_usd: number;
    horizon_cumulative_net_cash_flow_usd: number;
    horizon_cumulative_savings_usd: number;
    horizon_replacement_expenses_usd: number;
    discounted_payback_years: number | null;
    simple_payback_years: number | null;
    end_of_horizon_soh_pct: number;
    end_of_horizon_usable_capacity_kwh: number;
    horizon_cumulative_cycles: number;
    warranted_cycle_limit: number;
    warranty_cycles_exhausted_within_horizon: boolean;
    cycle_warranty_exhaustion_year: number | null;
    levelized_cost_of_storage_usd_per_kwh: number;
    outage_backup_autonomy_hours: number;
    outage_backup_autonomy_days: number;
    net_monthly_cash_flow_year1_usd: number;
  };
  annual_time_series: Array<{
    year: number;
    baseline_electricity_spend_usd: number;
    with_battery_electricity_spend_usd: number;
    annual_net_savings_usd: number;
    cumulative_net_cash_flow_usd: number;
    cumulative_npv_usd: number;
    battery_state_of_health_pct: number;
    usable_capacity_kwh: number;
    annual_cycles: number;
    cumulative_cycles: number;
    replacement_expense_usd: number;
    tax_credit_inflow_usd: number;
    annual_loan_payment_usd: number;
  }>;
}

export function buildExportLlmJson(params: ExportLlmJsonParams): LlmExportPayload {
  const {
    activeAnalysis,
    projectionHorizon,
    tiers,
    activeTouProfile,
    financials,
    csvResult,
  } = params;

  const {
    profile,
    annualSummary,
    netInstalledCost,
    upfrontOutOfPocket,
    isFinanced,
    loanPrincipal,
    monthlyLoanPayment,
    netMonthlyCashFlow,
    lcosPerKwh,
    outageAutonomyHours,
    outageAutonomyDays,
    criticalLoadPowerKw,
    projections,
    replacementEnabled: analysisReplacementEnabled,
    replacementCostTotal,
    replacementYear: analysisReplacementYear,
    warrantedCycleExhaustionYear,
    opportunityCostRate,
    opportunityCostVehicleName,
  } = activeAnalysis;

  // Replacement settings: explicit handling of replacementEnabled
  const replacementEnabled = financials?.replacementEnabled ?? analysisReplacementEnabled ?? true;
  const replacementCost = replacementEnabled
    ? (financials?.replacementCost ?? replacementCostTotal ?? 2000)
    : null;
  const replacementYear = replacementEnabled
    ? (financials?.replacementYear ?? analysisReplacementYear ?? 10)
    : null;

  // Horizon-specific projections slicing
  const safeHorizon = Math.max(1, Math.min(25, projectionHorizon));
  const horizonProjections: YearProjection[] = (projections || []).slice(0, safeHorizon);
  const lastProj = horizonProjections[horizonProjections.length - 1];

  // Horizon-dependent KPIs
  const horizonNpv = lastProj ? lastProj.cumulativeNpv : activeAnalysis.npv;
  const horizonCumulativeCashFlow = lastProj ? lastProj.cumulativeCashFlow : -upfrontOutOfPocket;
  const horizonCumulativeSavings = horizonProjections.reduce((sum, p) => sum + p.annualSavings, 0);
  const horizonReplacementExpenses = horizonProjections.reduce((sum, p) => sum + p.replacementExpense, 0);
  const endOfHorizonSoh = lastProj ? lastProj.sohPercent : 100;
  const endOfHorizonCapacity = lastProj ? lastProj.usableCapacityKwh : profile.totalCapacityKwh;
  const horizonCumulativeCycles = lastProj ? lastProj.cumulativeCycles : 0;
  const warrantyExhaustedInHorizon = horizonProjections.some((p) => p.warrantedCyclesExceeded);
  const cycleExhaustionYearInHorizon =
    warrantedCycleExhaustionYear !== null && warrantedCycleExhaustionYear <= safeHorizon
      ? warrantedCycleExhaustionYear
      : null;

  // Discounted payback period (where cumulative NPV crosses >= 0)
  let discountedPaybackPeriodYears: number | null = null;
  for (let i = 0; i < horizonProjections.length; i++) {
    const p = horizonProjections[i];
    if (p.cumulativeNpv >= 0) {
      if (i === 0) {
        discountedPaybackPeriodYears = 1.0;
      } else {
        const prev = horizonProjections[i - 1];
        const denom = p.cumulativeNpv - prev.cumulativeNpv;
        const fraction = denom !== 0 ? (0 - prev.cumulativeNpv) / denom : 0;
        discountedPaybackPeriodYears = Math.round((prev.year + fraction) * 100) / 100;
      }
      break;
    }
  }

  // Simple payback within horizon
  const simplePaybackWithinHorizon =
    activeAnalysis.paybackYears !== null && activeAnalysis.paybackYears <= safeHorizon
      ? activeAnalysis.paybackYears
      : null;

  // Opportunity cost at target horizon
  const oppRate = (opportunityCostRate || 4.5) / 100;
  const horizonOpportunityFutureVal = Math.round(upfrontOutOfPocket * Math.pow(1 + oppRate, safeHorizon));
  const horizonOpportunityProfit = Math.max(0, horizonOpportunityFutureVal - upfrontOutOfPocket);

  // Annual time series up to selected horizon
  const annualTimeSeries = horizonProjections.map((p) => ({
    year: p.year,
    baseline_electricity_spend_usd: Math.round(p.baselineCost * 100) / 100,
    with_battery_electricity_spend_usd: Math.round(p.withBatteryCost * 100) / 100,
    annual_net_savings_usd: Math.round(p.annualSavings * 100) / 100,
    cumulative_net_cash_flow_usd: Math.round(p.cumulativeCashFlow * 100) / 100,
    cumulative_npv_usd: Math.round(p.cumulativeNpv * 100) / 100,
    battery_state_of_health_pct: Math.round(p.sohPercent * 10) / 10,
    usable_capacity_kwh: Math.round(p.usableCapacityKwh * 10) / 10,
    annual_cycles: Math.round(p.cyclesThisYear),
    cumulative_cycles: Math.round(p.cumulativeCycles),
    replacement_expense_usd: Math.round(p.replacementExpense * 100) / 100,
    tax_credit_inflow_usd: Math.round((p.taxCreditInflow ?? 0) * 100) / 100,
    annual_loan_payment_usd: Math.round(p.annualLoanPayment * 100) / 100,
  }));

  const usableDod = profile.usableDodPercent;
  const usableCapacity = Math.round(profile.totalCapacityKwh * (usableDod / 100) * 100) / 100;

  const completeness = csvResult?.completeness;

  return {
    metadata: {
      app_name: 'VoltWise',
      app_version: '1.0.0',
      export_timestamp: new Date().toISOString(),
      selected_horizon_years: safeHorizon,
      currency: 'USD',
      dataset_summary: {
        start_date: completeness?.startDate || csvResult?.startDate || '',
        end_date: completeness?.endDate || csvResult?.endDate || '',
        total_intervals: completeness?.intervalCount || annualSummary.totalIntervals,
        interval_duration_hours: completeness?.intervalDurationHours || annualSummary.intervalHours,
        duration_days: completeness?.durationDays || Math.round(annualSummary.totalIntervals / 24),
        total_home_load_kwh: annualSummary.totalHomeLoadKwh,
        is_suitable_for_annual_projection: completeness?.isSuitableForAnnualProjection ?? true,
        completeness_reason: completeness?.reason ?? null,
      },
    },
    battery_configuration: {
      profile_name: profile.name,
      model: profile.model,
      total_capacity_kwh: profile.totalCapacityKwh,
      usable_dod_pct: usableDod,
      usable_capacity_kwh: usableCapacity,
      max_continuous_discharge_kw: profile.maxContinuousOutputKw,
      max_continuous_charge_kw: profile.maxContinuousChargeKw,
      round_trip_efficiency_pct: profile.roundTripEfficiencyPercent,
      rated_cycle_life: profile.ratedCycleLife,
      dispatch_strategy: profile.strategy,
      charge_tiers: [...profile.chargeTiers],
      discharge_tiers: [...profile.dischargeTiers],
      allow_grid_export: Boolean(profile.allowGridExport),
      installed_cost_usd: profile.installedCost,
    },
    tariff_configuration: {
      profile_name: activeTouProfile?.name || 'Standard TOU',
      utility: activeTouProfile?.utility || 'Utility',
      description: activeTouProfile?.description || '',
      rate_tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        buy_rate_usd_per_kwh: t.buyRate,
        sell_rate_usd_per_kwh: t.sellRate,
        color: t.color,
      })),
      seasons: (activeTouProfile?.seasons || []).map((s) => ({
        id: s.id,
        name: s.name,
        months: [...s.months],
        tier_rates: { ...s.tierRates },
      })),
      schedule_matrix: activeTouProfile?.scheduleMatrix || [],
    },
    financial_assumptions: {
      federal_tax_credit_pct: financials?.federalTaxCreditPercent ?? 0,
      federal_tax_credit_realization_year: financials?.federalTaxCreditRealizationYear ?? 1,
      local_rebate_flat_usd: financials?.localRebateFlat ?? 0,
      annual_electricity_inflation_rate_pct: financials?.annualElectricityInflationRate ?? 3.5,
      annual_battery_degradation_rate_pct: financials?.annualBatteryDegradationRate ?? 2.0,
      discount_rate_pct: financials?.discountRatePercent ?? 5.0,
      financing: {
        is_financed: Boolean(isFinanced),
        loan_apr_pct: financials?.loanAprPercent ?? 6.99,
        loan_term_years: financials?.loanTermYears ?? 10,
        down_payment_pct: financials?.loanDownPaymentPercent ?? 0,
        loan_principal_usd: Math.round(loanPrincipal),
        monthly_loan_payment_usd: Math.round(monthlyLoanPayment * 100) / 100,
      },
      opportunity_cost: {
        vehicle_name: opportunityCostVehicleName,
        benchmark_rate_pct: opportunityCostRate,
        horizon_future_value_usd: horizonOpportunityFutureVal,
        horizon_opportunity_profit_usd: horizonOpportunityProfit,
      },
      replacement: {
        replacement_enabled: replacementEnabled,
        replacement_cost_usd: replacementCost,
        replacement_year: replacementYear,
      },
      resilience: {
        critical_home_load_kw: criticalLoadPowerKw,
        annual_outage_days: financials?.annualOutageDays ?? 2.5,
        value_of_lost_load_usd_per_day: financials?.valueOfLostLoadPerDay ?? 100,
        include_voll_in_roi: financials?.includeVollInRoi ?? false,
      },
    },
    year_1_results: {
      baseline_electricity_cost_usd: annualSummary.baselineAnnualCost,
      with_battery_electricity_cost_usd: annualSummary.simulatedAnnualCost,
      net_savings_usd: annualSummary.year1Savings,
      savings_percentage: annualSummary.savingsPercentage,
      total_grid_import_kwh: annualSummary.annualGridImportKwh,
      total_grid_export_kwh: annualSummary.annualGridExportKwh,
      battery_discharged_energy_kwh: annualSummary.annualBatteryDischargedKwh,
      equivalent_full_cycles: annualSummary.equivalentFullCycles,
      peak_demand_kw: annualSummary.maxPeakDemandKw,
    },
    horizon_summary_kpis: {
      horizon_years: safeHorizon,
      net_upfront_installed_cost_usd: Math.round(netInstalledCost * 100) / 100,
      horizon_net_present_value_usd: Math.round(horizonNpv * 100) / 100,
      horizon_cumulative_net_cash_flow_usd: Math.round(horizonCumulativeCashFlow * 100) / 100,
      horizon_cumulative_savings_usd: Math.round(horizonCumulativeSavings * 100) / 100,
      horizon_replacement_expenses_usd: Math.round(horizonReplacementExpenses * 100) / 100,
      discounted_payback_years: discountedPaybackPeriodYears,
      simple_payback_years: simplePaybackWithinHorizon !== null ? Math.round(simplePaybackWithinHorizon * 100) / 100 : null,
      end_of_horizon_soh_pct: Math.round(endOfHorizonSoh * 10) / 10,
      end_of_horizon_usable_capacity_kwh: Math.round(endOfHorizonCapacity * 10) / 10,
      horizon_cumulative_cycles: Math.round(horizonCumulativeCycles),
      warranted_cycle_limit: profile.ratedCycleLife,
      warranty_cycles_exhausted_within_horizon: warrantyExhaustedInHorizon,
      cycle_warranty_exhaustion_year: cycleExhaustionYearInHorizon,
      levelized_cost_of_storage_usd_per_kwh: Math.round(lcosPerKwh * 1000) / 1000,
      outage_backup_autonomy_hours: Math.round(outageAutonomyHours * 10) / 10,
      outage_backup_autonomy_days: Math.round(outageAutonomyDays * 10) / 10,
      net_monthly_cash_flow_year1_usd: Math.round(netMonthlyCashFlow * 100) / 100,
    },
    annual_time_series: annualTimeSeries,
  };
}
