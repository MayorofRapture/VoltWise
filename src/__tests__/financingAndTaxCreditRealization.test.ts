import { describe, it, expect } from 'vitest';
import { calculate15YearFinancials, DEFAULT_MACRO_FINANCIALS } from '../utils/simulationEngine';
import { BatteryProfile, AnnualSimulationSummary } from '../types/energy';

describe('Issue 6 — Financing & Deferred Tax Credit Realization', () => {
  const profile: BatteryProfile = {
    id: 'test-powerwall',
    name: 'Test Battery',
    model: '13.5 kWh',
    totalCapacityKwh: 13.5,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5.0,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 12000,
    strategy: 'arbitrage',
    chargeTiers: [],
    dischargeTiers: [],
  };

  const summary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 8000,
    baselineAnnualCost: 2400,
    simulatedAnnualCost: 1400,
    year1Savings: 1000,
    savingsPercentage: 41.7,
    annualGridImportKwh: 5000,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 3000,
    equivalentFullCycles: 222,
    maxPeakDemandKw: 5.0,
    intervalResults: [],
  };

  it('ensures deferred federal tax credit does not artificially reduce loan principal on day 1', () => {
    // Gross: $12,000, Local flat rebate: $2,000, Federal tax credit: 30% ($3,600)
    // Upfront net outlay = $12,000 - $2,000 = $10,000.
    // Financed with 10% down ($1,000) -> Loan principal must be $9,000.
    // (If the tax credit had been deducted upfront, principal would incorrectly be $12,000 - $2,000 - $3,600 = $6,400 - $640 = $5,760).
    const financedSettings = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 30,
      localRebateFlat: 2000,
      federalTaxCreditRealizationYear: 1,
      isFinanced: true,
      loanAprPercent: 6.0,
      loanTermYears: 10,
      loanDownPaymentPercent: 10,
    };

    const analysis = calculate15YearFinancials(profile, summary, financedSettings);

    expect(analysis.grossCost).toBe(12000);
    expect(analysis.upfrontOutOfPocket).toBe(1000); // 10% down payment
    expect(analysis.loanPrincipal).toBe(9000); // $10,000 - $1,000 down payment
  });

  it('realizes tax credit cash inflow in Year 1 (or configured realization year)', () => {
    const financialsYear1 = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 30,
      localRebateFlat: 1000,
      federalTaxCreditRealizationYear: 1,
      isFinanced: false,
    };

    const analysis = calculate15YearFinancials(profile, summary, financialsYear1);
    const taxCreditVal = 12000 * 0.30; // $3,600

    // In Year 1, tax credit inflow is realized
    expect(analysis.projections[0].taxCreditInflow).toBe(taxCreditVal);
    // In Year 2, tax credit inflow is 0
    expect(analysis.projections[1].taxCreditInflow).toBe(0);

    // If configured for Year 2 realization
    const financialsYear2 = {
      ...financialsYear1,
      federalTaxCreditRealizationYear: 2,
    };
    const analysis2 = calculate15YearFinancials(profile, summary, financialsYear2);
    expect(analysis2.projections[0].taxCreditInflow).toBe(0);
    expect(analysis2.projections[1].taxCreditInflow).toBe(taxCreditVal);
  });
});
