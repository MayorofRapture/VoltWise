import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyPeakSunHourSolarInterval,
  calculateDailyClearSkyGhiKwhPerM2,
  generateMonthlyPeakSunHourSolarProfile,
  summarizeSolarGenerationProfile,
  getLocalDateAndMonth,
} from '../utils/solarProfile';
import { GenerationSite, SolarGenerationAsset } from '../types/energy';
import { createDefaultSolarAsset } from '../utils/generationDefaults';

describe('G2B Milestone — Monthly Peak-Sun-Hour Solar Profile & Summaries', () => {
  const baseSite: GenerationSite = {
    latitude: 37.7749, // San Francisco, CA
    longitude: -122.4194,
    timeZone: 'America/Los_Angeles',
    elevationM: 16,
  };

  const baseAsset: SolarGenerationAsset = {
    ...createDefaultSolarAsset('solar-psh-test', 'Rooftop Solar Array'),
    dcCapacityKw: 10.0,
    tiltDegrees: 20,
    azimuthDegrees: 180, // South
    inverterAcCapacityKw: 8.0,
    inverterEfficiencyPercent: 96.0,
    systemLossPercent: 14.0,
    shadingLossPercent: 0.0,
    annualDegradationPercent: 0.5,
    resourceMode: 'monthly_peak_sun_hours',
    monthlyPeakSunHoursPerDay: [3.0, 3.8, 5.0, 6.0, 6.8, 7.2, 5.5, 6.5, 5.8, 4.5, 3.2, 2.8],
  };

  // --------------------------------------------------------------------------
  // 1. Local Date & Timezone Resolution
  // --------------------------------------------------------------------------
  it('correctly resolves localDate and monthIndex respecting site timeZone', () => {
    // 2026-07-15 03:00:00 UTC is 2026-07-14 20:00:00 PDT in America/Los_Angeles (UTC-7)
    const instantUtc = new Date('2026-07-15T03:00:00Z');
    const local = getLocalDateAndMonth(instantUtc, 'America/Los_Angeles');

    expect(local.localDate).toBe('2026-07-14');
    expect(local.monthIndex).toBe(6); // 0-indexed July
    expect(local.year).toBe(2026);
    expect(local.day).toBe(14);

    // Fallback to UTC if timeZone is empty string
    const utcLocal = getLocalDateAndMonth(instantUtc, '');
    expect(utcLocal.localDate).toBe('2026-07-15');
    expect(utcLocal.monthIndex).toBe(6);
  });

  // --------------------------------------------------------------------------
  // 2. Normalization to Monthly Peak-Sun-Hours
  // --------------------------------------------------------------------------
  it('normalizes daily GHI integral to approximately the target monthly PSH (e.g. 5.5 kWh/m²/day for July)', () => {
    // Generate 24 hourly intervals for July 15 (PDT: UTC-7)
    const intervals = [];
    for (let h = 0; h < 24; h++) {
      const utcDate = new Date(Date.UTC(2026, 6, 15, h + 7, 0, 0));
      intervals.push(utcDate);
    }

    const profile = generateMonthlyPeakSunHourSolarProfile(intervals, 1.0, baseSite, baseAsset);
    expect(profile).toHaveLength(24);

    // Sum modeled GHI across the day
    const modeledDailyGhi = profile.reduce(
      (sum, int) => sum + int.modeledGhiKwPerM2 * 1.0,
      0
    );

    // July target is 5.5 kWh/m²/day
    expect(profile[12].targetPeakSunHoursPerDay).toBe(5.5);
    expect(modeledDailyGhi).toBeCloseTo(5.5, 1);
  });

  // --------------------------------------------------------------------------
  // 3. Proportional Scaling of GHI, DNI, and POA
  // --------------------------------------------------------------------------
  it('scales GHI, DNI, and POA by identical resource scale factor during daylight', () => {
    // Solar noon on July 15 PDT (~20:09 UTC)
    const solarNoon = new Date('2026-07-15T20:09:00Z');
    const result = calculateMonthlyPeakSunHourSolarInterval(solarNoon, 1.0, baseSite, baseAsset);

    expect(result.position.isDaylight).toBe(true);
    expect(result.resourceScaleFactor).toBeGreaterThan(0);

    const scale = result.resourceScaleFactor;
    expect(result.modeledGhiKwPerM2).toBeCloseTo(result.clearSkyGhiKwPerM2 * scale, 6);
    expect(result.modeledDniKwPerM2).toBeCloseTo(result.clearSkyDniKwPerM2 * scale, 6);
    expect(result.modeledPoaKwPerM2).toBeCloseTo(result.clearSkyPoaKwPerM2 * scale, 6);
  });

  // --------------------------------------------------------------------------
  // 4. Orientation Preservation (North vs South panel)
  // --------------------------------------------------------------------------
  it('preserves panel orientation effects: south-facing array produces substantially more AC energy than north-facing', () => {
    const southAsset: SolarGenerationAsset = {
      ...baseAsset,
      tiltDegrees: 30,
      azimuthDegrees: 180, // South
    };

    const northAsset: SolarGenerationAsset = {
      ...baseAsset,
      tiltDegrees: 30,
      azimuthDegrees: 0, // North
    };

    // Equinox midday (2026-03-20 12:00:00 UTC at longitude 0)
    const midLatSite: GenerationSite = {
      latitude: 38,
      longitude: 0,
      timeZone: 'UTC',
      elevationM: 0,
    };
    const midday = new Date('2026-03-20T12:00:00Z');

    const southRes = calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, midLatSite, southAsset);
    const northRes = calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, midLatSite, northAsset);

    // Both have identical target PSH (March = 5.0) and identical horizontal GHI
    expect(southRes.targetPeakSunHoursPerDay).toBe(5.0);
    expect(northRes.targetPeakSunHoursPerDay).toBe(5.0);
    expect(southRes.clearSkyGhiKwPerM2).toBeCloseTo(northRes.clearSkyGhiKwPerM2, 5);
    expect(southRes.modeledGhiKwPerM2).toBeCloseTo(northRes.modeledGhiKwPerM2, 5);

    // But South panel receives much higher POA and produces much more AC energy
    expect(southRes.modeledPoaKwPerM2).toBeGreaterThan(northRes.modeledPoaKwPerM2 * 1.5);
    expect(southRes.acEnergyKwh).toBeGreaterThan(northRes.acEnergyKwh * 1.5);
  });

  // --------------------------------------------------------------------------
  // 5. Zero Resource / Nighttime Behavior
  // --------------------------------------------------------------------------
  it('returns zero modeled irradiances and zero AC power/energy when monthly PSH is 0', () => {
    const zeroPshAsset: SolarGenerationAsset = {
      ...baseAsset,
      monthlyPeakSunHoursPerDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    const midday = new Date('2026-07-15T20:00:00Z');
    const result = calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, baseSite, zeroPshAsset);

    expect(result.position.isDaylight).toBe(true);
    expect(result.clearSkyGhiKwPerM2).toBeGreaterThan(0.5); // Clear sky is positive
    expect(result.resourceScaleFactor).toBe(0);
    expect(result.modeledGhiKwPerM2).toBe(0);
    expect(result.modeledDniKwPerM2).toBe(0);
    expect(result.modeledPoaKwPerM2).toBe(0);
    expect(result.rawDcPowerKw).toBe(0);
    expect(result.acPowerKw).toBe(0);
    expect(result.acEnergyKwh).toBe(0);
  });

  it('returns zero modeled irradiance and zero power at night', () => {
    // Midnight PDT is 07:00 UTC
    const midnight = new Date('2026-07-15T07:00:00Z');
    const result = calculateMonthlyPeakSunHourSolarInterval(midnight, 1.0, baseSite, baseAsset);

    expect(result.position.isDaylight).toBe(false);
    expect(result.clearSkyGhiKwPerM2).toBe(0);
    expect(result.clearSkyPoaKwPerM2).toBe(0);
    expect(result.modeledGhiKwPerM2).toBe(0);
    expect(result.modeledPoaKwPerM2).toBe(0);
    expect(result.acPowerKw).toBe(0);
    expect(result.acEnergyKwh).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 6. Inverter AC Clipping
  // --------------------------------------------------------------------------
  it('clips modeled AC power to inverterAcCapacityKw and records positive clipped energy', () => {
    // High DC capacity (20 kW) on a 5 kW inverter with 8.0 PSH
    const highDcAsset: SolarGenerationAsset = {
      ...baseAsset,
      dcCapacityKw: 20.0,
      inverterAcCapacityKw: 5.0,
      inverterEfficiencyPercent: 100.0,
      systemLossPercent: 0,
      shadingLossPercent: 0,
      monthlyPeakSunHoursPerDay: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
    };

    const solarNoon = new Date('2026-07-15T20:09:00Z');
    const result = calculateMonthlyPeakSunHourSolarInterval(solarNoon, 1.0, baseSite, highDcAsset);

    expect(result.unclippedAcPowerKw).toBeGreaterThan(5.0);
    expect(result.acPowerKw).toBe(5.0);
    expect(result.clippedEnergyKwh).toBeGreaterThan(0);
    expect(result.clippedEnergyKwh).toBeCloseTo(result.unclippedAcPowerKw - 5.0, 5);
  });

  // --------------------------------------------------------------------------
  // 7. Sub-Hourly Energy Scaling
  // --------------------------------------------------------------------------
  it('scales energy linearly while maintaining identical instantaneous power for 15-minute intervals', () => {
    const instant = new Date('2026-07-15T20:09:00Z');

    const res1Hour = calculateMonthlyPeakSunHourSolarInterval(instant, 1.0, baseSite, baseAsset);
    const res15Min = calculateMonthlyPeakSunHourSolarInterval(instant, 0.25, baseSite, baseAsset);

    expect(res1Hour.acPowerKw).toBe(res15Min.acPowerKw);
    expect(res1Hour.modeledPoaKwPerM2).toBe(res15Min.modeledPoaKwPerM2);
    expect(res15Min.acEnergyKwh).toBeCloseTo(0.25 * res1Hour.acEnergyKwh, 6);
    expect(res15Min.dcEnergyKwh).toBeCloseTo(0.25 * res1Hour.dcEnergyKwh, 6);
  });

  // --------------------------------------------------------------------------
  // 8. Profile Generation & Summary Aggregation
  // --------------------------------------------------------------------------
  it('generates multi-day profile and correctly summarizes monthly and overall totals', () => {
    // Create 48 hours across June 30 and July 1
    const instants: Date[] = [];
    for (let h = 0; h < 48; h++) {
      instants.push(new Date(Date.UTC(2026, 5, 30, h, 0, 0))); // Starts June 30 00:00 UTC
    }

    const intervals = generateMonthlyPeakSunHourSolarProfile(instants, 1.0, baseSite, baseAsset);
    expect(intervals).toHaveLength(48);

    const summary = summarizeSolarGenerationProfile(intervals);
    expect(summary.intervalCount).toBe(48);
    expect(summary.totalAcEnergyKwh).toBeGreaterThan(0);
    expect(summary.totalDcEnergyKwh).toBeGreaterThan(summary.totalAcEnergyKwh);
    expect(summary.monthly).toHaveLength(12);

    // Sum of monthly energies matches total
    const sumMonthlyAc = summary.monthly.reduce((sum, m) => sum + m.acEnergyKwh, 0);
    expect(sumMonthlyAc).toBeCloseTo(summary.totalAcEnergyKwh, 5);

    // June (index 5) and July (index 6) have non-zero interval counts
    const juneSummary = summary.monthly[5];
    const julySummary = summary.monthly[6];
    expect(juneSummary.intervalCount + julySummary.intervalCount).toBe(48);
    expect(juneSummary.acEnergyKwh).toBeGreaterThan(0);
    expect(julySummary.acEnergyKwh).toBeGreaterThan(0);

    // Other months have 0 intervals
    expect(summary.monthly[0].intervalCount).toBe(0);
    expect(summary.monthly[0].acEnergyKwh).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 9. Input Validation
  // --------------------------------------------------------------------------
  it('throws clear errors on unconfigured site coordinates or invalid intervalHours', () => {
    const unconfiguredSite: GenerationSite = {
      latitude: null,
      longitude: -122.4,
      timeZone: '',
      elevationM: null,
    };
    const midday = new Date('2026-07-15T20:00:00Z');

    expect(() =>
      calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, unconfiguredSite, baseAsset)
    ).toThrow(/unconfigured/i);

    expect(() =>
      calculateDailyClearSkyGhiKwhPerM2('2026-07-15', unconfiguredSite)
    ).toThrow(/unconfigured/i);

    expect(() =>
      calculateMonthlyPeakSunHourSolarInterval(midday, 0, baseSite, baseAsset)
    ).toThrow(/intervalHours/i);

    expect(() =>
      calculateMonthlyPeakSunHourSolarInterval(midday, -1, baseSite, baseAsset)
    ).toThrow(/intervalHours/i);
  });

  // --------------------------------------------------------------------------
  // 10. Purity and Immutability
  // --------------------------------------------------------------------------
  it('preserves purity by not mutating site or asset objects', () => {
    const siteSnapshot = JSON.stringify(baseSite);
    const assetSnapshot = JSON.stringify(baseAsset);

    const midday = new Date('2026-07-15T20:00:00Z');
    calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, baseSite, baseAsset);
    generateMonthlyPeakSunHourSolarProfile([midday], 1.0, baseSite, baseAsset);

    expect(JSON.stringify(baseSite)).toBe(siteSnapshot);
    expect(JSON.stringify(baseAsset)).toBe(assetSnapshot);
  });
});
