/**
 * Core Type Definitions for VoltWise Energy Simulation Engine
 */

export type OperationalStrategy = 'arbitrage' | 'self_consumption';

export interface RateTier {
  id: string;
  name: string;
  buyRate: number; // Price to import from grid ($/kWh)
  sellRate: number; // Feed-in tariff / export credit ($/kWh)
  color: string; // Hex color code for visualization
  isChargeWindow?: boolean; // Recommended charging period
  isDischargeWindow?: boolean; // Recommended discharging period
}

export interface TouSeason {
  id: string;
  name: string;
  months: number[]; // 0-indexed (0=Jan, 11=Dec)
  tierRates: Record<string, { buyRate: number; sellRate: number }>;
}

export interface TouProfile {
  id: string;
  name: string;
  utility: string;
  description: string;
  tiers: RateTier[];
  scheduleMatrix: string[][]; // [day 0..6][hour 0..23] = tierId
  seasons: TouSeason[];
}

export interface BatteryProfile {
  id: string;
  name: string;
  model: string;
  totalCapacityKwh: number; // Total nominal energy capacity
  usableDodPercent: number; // Usable Depth of Discharge (e.g. 90% - 100%)
  maxContinuousOutputKw: number; // Max discharge power
  maxContinuousChargeKw: number; // Max charge power
  roundTripEfficiencyPercent: number; // e.g. 90% AC-to-DC-to-AC
  ratedCycleLife: number; // e.g. 4000 or 6000 cycles
  installedCost: number; // Total Hardware + Labor before incentives ($)
  strategy: OperationalStrategy;
  chargeTiers: string[]; // Tier IDs to charge in
  dischargeTiers: string[]; // Tier IDs to discharge in
}

export interface MacroFinancials {
  // Upfront Capital & Incentives
  federalTaxCreditPercent: number; // e.g. 30% US Clean Energy Credit (Section 25D)
  localRebateFlat: number; // e.g. $1,000 flat rebate (SGIP, utility grant)
  
  // Escalation & Degradation
  annualElectricityInflationRate: number; // e.g. 3.5%
  annualBatteryDegradationRate: number; // e.g. 2.0%
  
  // Time Value of Money & Opportunity Cost
  discountRatePercent: number; // e.g. 4.0% to 7.0% for NPV calculation
  opportunityCostVehicle: 'hysa' | 'index_fund' | 'custom';
  opportunityCostRatePercent: number; // e.g. 4.5% for HYSA, 7.0% for Index Fund
  
  // Lifecycle Maintenance & Inverter Replacement Reserve
  replacementEnabled: boolean; // Whether mid-life component replacement is modeled
  replacementCost: number; // e.g. $2,000 for mid-life inverter/controller replacement
  replacementYear: number; // e.g. Year 10
  
  // Financing & Loan
  isFinanced: boolean; // True if financed via clean energy loan
  loanAprPercent: number; // e.g. 6.99%
  loanTermYears: number; // e.g. 10 or 15 or 20 years
  loanDownPaymentPercent: number; // e.g. 0% or 10%
  
  // Non-Financial & Resilience Metrics
  criticalLoadPowerKw: number; // e.g. 1.2 kW continuous essential backup load
  annualOutageDays: number; // e.g. 2.5 days/year blackout expectancy
  valueOfLostLoadPerDay: number; // e.g. $100/day for food preservation, comfort, HVAC
  includeVollInRoi: boolean; // Whether to blend VOLL into financial ROI calculations
}

export interface IntervalDataPoint {
  timestamp: string; // Normalized string YYYY-MM-DD HH:mm
  date: Date;
  hour: number; // 0-23
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  month: number; // 0-11
  usageKwh: number; // Home load demand in this interval (Hourly Total in kWh)
  
  // Extended fields matching exact schema: Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement
  dayStr?: string; // e.g. "09/22/2025"
  hourOfDayStr?: string; // e.g. "12:00 AM"
  hourlyTotal?: number; // e.g. 1.018
  dailyTotal?: number; // e.g. 25.075
  unitOfMeasurement?: string; // e.g. "kWh"
}

export interface IntervalSimulationResult {
  timestamp: string;
  hour: number;
  dayOfWeek: number;
  homeLoadKwh: number;
  tierId: string;
  tierName: string;
  seasonName?: string;
  buyRate: number;
  sellRate: number;
  
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  batterySocKwh: number;
  batterySocPercent: number;
  
  gridImportKwh: number;
  gridExportKwh: number;
  
  baselineCost: number;
  simulatedCost: number;
  netSavings: number;
}

export interface AnnualSimulationSummary {
  profileId: string;
  profileName: string;
  totalIntervals: number;
  intervalHours: number;
  totalHomeLoadKwh: number;
  baselineAnnualCost: number;
  simulatedAnnualCost: number;
  year1Savings: number;
  savingsPercentage: number;
  annualGridImportKwh: number;
  annualGridExportKwh: number;
  annualBatteryDischargedKwh: number;
  equivalentFullCycles: number;
  maxPeakDemandKw: number;
  
  intervalResults: IntervalSimulationResult[];
}

export interface YearProjection {
  year: number;
  inflationFactor: number;
  capacityRetentionFactor: number;
  baselineCost: number;
  withBatteryCost: number;
  annualSavings: number;
  
  // Cash Flow & Capital Outlays
  replacementExpense: number; // Inverter replacement in target year
  annualLoanPayment: number; // Debt service if financed
  netCashFlow: number; // annualSavings - replacementExpense - annualLoanPayment
  cumulativeCashFlow: number; // cumulative sum starting from -upfrontCapital
  cumulativeBaselineSpend: number; // cumulative electricity spend with NO battery
  cumulativeBatterySpend: number; // upfrontCapital + cumulative withBatteryCost + maintenance
  
  // Time Value & Opportunity Cost
  discountedCashFlow: number; // Net cash flow discounted to Year 0
  cumulativeNpv: number; // Cumulative NPV up to this year
  opportunityCostValue: number; // Upfront capital compounded in alternative vehicle
  
  // Asset Health & Degradation
  usableCapacityKwh: number;
  sohPercent: number; // State of Health % (remaining usable capacity)
  cyclesThisYear: number;
  cumulativeCycles: number;
  warrantedCyclesExceeded: boolean;
  
  // Resilience Value
  resilienceValue: number; // Annual VOLL
  cumulativeResilienceValue: number;
}

export interface ProfileFinancialAnalysis {
  profile: BatteryProfile;
  annualSummary: AnnualSimulationSummary;
  
  // Upfront Capital & Incentives
  grossCost: number;
  incentivesAmount: number;
  netInstalledCost: number;
  upfrontOutOfPocket: number; // Net cost minus loan principal if financed
  
  // Operational Savings
  year1Savings: number;
  paybackYears: number | null; // e.g. 6.35 years, or null if > horizon
  paybackFormatted: string; // e.g. "6 yrs 4 mos"
  lifetimeTotalSavings: number;
  lifetimeNetProfit: number; // total savings - net installed cost - maintenance
  lifetimeRoiPercent: number; // (net profit / net out-of-pocket) * 100
  
  // Advanced Financial Metrics (Time Value of Money)
  npv: number; // Net Present Value at target horizon
  irrPercent: number | null; // Internal Rate of Return %
  isNpvNegativeWithPositiveProfit: boolean; // Flag if nominal profit > 0 but NPV < 0
  discountRatePercent: number;
  
  // Opportunity Cost Comparison
  opportunityCostVehicleName: string;
  opportunityCostRate: number;
  opportunityCostFutureValue: number;
  opportunityCostProfit: number;
  opportunityCostDiff: number; // Battery Net Profit minus Alternative Profit
  batteryOutperformsAlternative: boolean;
  
  // Financing & Loan Metrics
  isFinanced: boolean;
  loanPrincipal: number;
  monthlyLoanPayment: number;
  monthlyElectricitySavingsYear1: number;
  netMonthlyCashFlow: number; // Monthly electricity savings - monthly loan payment
  isCashFlowPositiveDay1: boolean;
  totalLoanPaymentLifetime: number;
  totalLoanInterestPaid: number;
  
  // Lifecycle Maintenance
  replacementCostTotal: number;
  replacementYear: number;
  replacementEnabled: boolean;
  
  // Asset Health, Warranty & LCOS
  endOfLifeSohPercent: number; // SoH % at horizon
  remainingUsableCapacityKwh: number;
  totalLifetimeDischargedKwh: number;
  lcosPerKwh: number; // Levelized Cost of Storage ($/kWh)
  warrantedCycleLimit: number;
  warrantedCycleExhaustionYear: number | null;
  isWarrantyVoidedBeforePayback: boolean;
  
  // Resilience & Non-Financial Outage Metrics
  outageAutonomyHours: number;
  outageAutonomyDays: number;
  criticalLoadPowerKw: number;
  annualResilienceValue: number;
  lifetimeResilienceValue: number;
  npvWithVoll: number;
  lifetimeNetProfitWithVoll: number;
  lifetimeRoiWithVollPercent: number;
  
  // Multi-Year Projections
  projections: YearProjection[];
  
  // Backward compatibility aliases
  projections15Yr: YearProjection[];
  lifetimeTotalSavings15Yr: number;
  lifetimeNetProfit15Yr: number;
  npv15Yr: number;
}

export interface CsvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalRows: number;
  validRows: number;
  totalKwh: number;
  intervalHours: number;
  startDate?: string;
  endDate?: string;
  peakKw: number;
  data: IntervalDataPoint[];
  schemaDetected?: 'standard_5col' | 'legacy_2col';
}
