/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DataAndRatesTab } from './components/DataAndRatesTab';
import { BatteryProfilesTab } from './components/BatteryProfilesTab';
import { PowerGenerationTab } from './components/PowerGenerationTab';
import { FinancialSettingsTab } from './components/FinancialSettingsTab';
import { ResultsAnalyticsTab } from './components/ResultsAnalyticsTab';
import {
  BatteryProfile,
  CsvValidationResult,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouProfile,
  AnnualSimulationSummary,
  GenerationConfig,
} from './types/energy';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
  ScheduleMatrix,
  calculate15YearFinancials,
  createDefaultScheduleMatrix,
  runAnnualSimulation,
  getHeaderSavingsLabel,
  getHeaderPaybackText,
} from './utils/simulationEngine';
import { DEFAULT_GENERATION_CONFIG } from './utils/generationDefaults';
import { generateRealistic8760Dataset } from './utils/sampleData';
import { parseAndValidateEnergyCsv } from './utils/csvParser';
import { Zap, ChevronRight, Activity, ArrowRight, Bookmark } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'data' | 'profiles' | 'generation' | 'financials' | 'results'>('results');

  // TOU Saved Rate Profiles & Active Schedule
  const [touProfiles, setTouProfiles] = useState<TouProfile[]>(DEFAULT_TOU_PROFILES);
  const [activeTouProfileId, setActiveTouProfileId] = useState<string>('california-ev2a');
  const [tiers, setTiers] = useState<RateTier[]>(DEFAULT_TOU_PROFILES[0].tiers);
  const [scheduleMatrix, setScheduleMatrix] = useState<ScheduleMatrix>(DEFAULT_TOU_PROFILES[0].scheduleMatrix);

  // Battery Profiles
  const [profiles, setProfiles] = useState<BatteryProfile[]>(DEFAULT_BATTERY_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('powerwall-3');

  // Power Generation Assets & Site Config (Milestone G1)
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(DEFAULT_GENERATION_CONFIG);

  // Macro Financials
  const [financials, setFinancials] = useState<MacroFinancials>(DEFAULT_MACRO_FINANCIALS);

  // CSV Energy Usage Data State
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);

  // Active TOU Profile reference
  const activeTouProfile = useMemo(() => {
    return touProfiles.find((p) => p.id === activeTouProfileId) || touProfiles[0];
  }, [touProfiles, activeTouProfileId]);

  // Initialize with realistic 8,760-hour dataset on mount
  useEffect(() => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
  }, []);

  // Handle User CSV Upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseAndValidateEnergyCsv(text);
      setCsvResult(parsed);
    };
    reader.readAsText(file);
  };

  // Quick load 8,760h realistic sample
  const handleLoadSample = () => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
  };

  // Reset data handler
  const handleResetData = () => {
    setCsvResult(null);
    setTouProfiles(DEFAULT_TOU_PROFILES);
    setActiveTouProfileId('california-ev2a');
    setTiers(DEFAULT_TOU_PROFILES[0].tiers);
    setScheduleMatrix(DEFAULT_TOU_PROFILES[0].scheduleMatrix);
    setProfiles(DEFAULT_BATTERY_PROFILES);
    setActiveProfileId('powerwall-3');
    setGenerationConfig(DEFAULT_GENERATION_CONFIG);
    setFinancials(DEFAULT_MACRO_FINANCIALS);
    setActiveTab('data');
  };

  // 1. Always compute interval simulation summaries for all profiles (works for full or partial datasets)
  const allSimulationSummaries = useMemo<Record<string, AnnualSimulationSummary>>(() => {
    if (!csvResult || !csvResult.isValid || csvResult.data.length === 0) {
      return {};
    }
    const summaries: Record<string, AnnualSimulationSummary> = {};
    profiles.forEach((profile) => {
      summaries[profile.id] = runAnnualSimulation(
        csvResult.data,
        csvResult.intervalHours,
        tiers,
        scheduleMatrix,
        profile,
        activeTouProfile?.seasons
      );
    });
    return summaries;
  }, [csvResult, tiers, scheduleMatrix, profiles, activeTouProfile]);

  const isSuitableForAnnual = Boolean(
    csvResult?.completeness ? csvResult.completeness.isSuitableForAnnualProjection : true
  );

  // 2. Compute 25-year financial projections ONLY if dataset is suitable for annual projection
  const allAnalyses = useMemo<ProfileFinancialAnalysis[]>(() => {
    if (!isSuitableForAnnual || !csvResult || !csvResult.isValid || csvResult.data.length === 0) {
      return [];
    }

    return profiles.map((profile) => {
      const annualSummary = allSimulationSummaries[profile.id];
      return calculate15YearFinancials(profile, annualSummary, financials);
    });
  }, [isSuitableForAnnual, csvResult, profiles, allSimulationSummaries, financials]);

  // Active Profile Analysis (null for partial/unsuitable datasets)
  const activeAnalysis = useMemo<ProfileFinancialAnalysis | null>(() => {
    return allAnalyses.find((a) => a.profile.id === activeProfileId) || allAnalyses[0] || null;
  }, [allAnalyses, activeProfileId]);

  const activeSimulationSummary = allSimulationSummaries[activeProfileId] || null;
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-400">
      {/* 3-Zone Top Navigation Contract */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLoadSampleData={handleLoadSample}
        onResetData={handleResetData}
        hasData={!!csvResult?.isValid}
        totalKwh={csvResult?.totalKwh || 0}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Context Breadcrumbs & Quick State Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800/80 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="font-semibold text-slate-200">Simulation Workspace</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
            <span className="text-emerald-400 font-medium">
              {activeTab === 'data' && '01. CSV Ingestion & TOU Schedule Matrix'}
              {activeTab === 'profiles' && '02. Battery Profiles & Hardware Strategy'}
              {activeTab === 'generation' && '03. On-Site Power Generation'}
              {activeTab === 'financials' && '04. Incentives, Escalation & Degradation'}
              {activeTab === 'results' && '05. Results, Cash Flow & Dispatch'}
            </span>
          </div>

          {activeAnalysis ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400">
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-emerald-400" />
                Tariff:{' '}
                <strong className="text-slate-200">{activeTouProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                Battery:{' '}
                <strong className="text-slate-200">{activeProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                {getHeaderSavingsLabel(true)}:{' '}
                <strong className="text-emerald-400 font-mono">
                  ${activeAnalysis.year1Savings.toLocaleString()}/yr
                </strong>
              </span>
              <span>·</span>
              <span>
                Payback:{' '}
                <strong className="text-amber-300 font-mono">
                  {getHeaderPaybackText(activeAnalysis, true)}
                </strong>
              </span>
            </div>
          ) : activeSimulationSummary ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400">
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-emerald-400" />
                Tariff:{' '}
                <strong className="text-slate-200">{activeTouProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                Battery:{' '}
                <strong className="text-slate-200">{activeProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                {getHeaderSavingsLabel(false)}:{' '}
                <strong className="text-emerald-400 font-mono">
                  ${(activeSimulationSummary.periodSavings ?? activeSimulationSummary.year1Savings).toLocaleString()}
                </strong>
              </span>
            </div>
          ) : null}
        </div>

        {/* Tab 1: Data & Rates */}
        {activeTab === 'data' && (
          <DataAndRatesTab
            csvResult={csvResult}
            onFileUpload={handleFileUpload}
            onLoadSample={handleLoadSample}
            touProfiles={touProfiles}
            setTouProfiles={setTouProfiles}
            activeTouProfileId={activeTouProfileId}
            setActiveTouProfileId={setActiveTouProfileId}
            tiers={tiers}
            setTiers={setTiers}
            scheduleMatrix={scheduleMatrix}
            setScheduleMatrix={setScheduleMatrix}
          />
        )}

        {/* Tab 2: Battery Profiles */}
        {activeTab === 'profiles' && (
          <BatteryProfilesTab
            profiles={profiles}
            setProfiles={setProfiles}
            activeProfileId={activeProfileId}
            setActiveProfileId={setActiveProfileId}
            tiers={tiers}
          />
        )}

        {/* Tab 3: Power Generation */}
        {activeTab === 'generation' && (
          <PowerGenerationTab
            generationConfig={generationConfig}
            setGenerationConfig={setGenerationConfig}
          />
        )}

        {/* Tab 4: Financials & Settings */}
        {activeTab === 'financials' && (
          <FinancialSettingsTab
            financials={financials}
            setFinancials={setFinancials}
            activeProfile={activeProfile}
          />
        )}

        {/* Tab 5: Results & Analytics */}
        {activeTab === 'results' && (
          <ResultsAnalyticsTab
            activeAnalysis={activeAnalysis}
            allAnalyses={allAnalyses}
            activeSimulationSummary={activeSimulationSummary}
            allSimulationSummaries={allSimulationSummaries}
            activeProfile={activeProfile}
            setActiveProfileId={setActiveProfileId}
            tiers={tiers}
            activeTouProfile={activeTouProfile}
            financials={financials}
            csvResult={csvResult}
          />
        )}

        {/* Tab Navigation Footer Bar */}
        <div className="mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div>
            {activeTab !== 'data' && (
              <button
                onClick={() => {
                  if (activeTab === 'results') setActiveTab('financials');
                  else if (activeTab === 'financials') setActiveTab('generation');
                  else if (activeTab === 'generation') setActiveTab('profiles');
                  else if (activeTab === 'profiles') setActiveTab('data');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
              >
                ← Previous Step
              </button>
            )}
          </div>

          <div>
            {activeTab !== 'results' ? (
              <button
                onClick={() => {
                  if (activeTab === 'data') setActiveTab('profiles');
                  else if (activeTab === 'profiles') setActiveTab('generation');
                  else if (activeTab === 'generation') setActiveTab('financials');
                  else if (activeTab === 'financials') setActiveTab('results');
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-sm shadow-emerald-950"
              >
                <span>Continue to Next Step</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => setActiveTab('data')}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
              >
                Back to Data & Rates
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Quiet Non-Intrusive Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-16 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">VoltWise Engine</span>
            <span>·</span>
            <span>8,760-Hour Dispatch & Financial Lifecycle Simulator</span>
          </div>
          <div className="text-slate-500">
            Client-side calculation engine · Zero telemetry
          </div>
        </div>
      </footer>
    </div>
  );
}
