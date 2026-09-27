/**
 * Monthly Peak-Sun-Hour Solar Profile & Summary Engine (Milestone G2B)
 *
 * Implements deterministic monthly solar-resource scaling:
 * 1. Uses clear-sky solar geometry (NOAA position, clear-sky GHI, DNI, POA).
 * 2. Determines local calendar date and month index for each UTC instant.
 * 3. Normalizes horizontal solar resource (GHI) against user's monthly peak sun hours (kWh/m²/day).
 * 4. Scales DNI and POA by the horizontal resource scale factor, preserving the effects
 *    of site latitude, season, daylight duration, panel tilt, and panel azimuth.
 * 5. Applies STC DC capacity, system & shading losses, and inverter AC clipping.
 * 6. Computes monthly and annual generation profile summaries.
 */

import {
  GenerationSite,
  SolarGenerationAsset,
  MonthlyPeakSunHourSolarInterval,
  SolarMonthlyGenerationSummary,
  SolarGenerationProfileSummary,
} from '../types/energy';
import {
  calculateSolarPosition,
  calculateClearSkySolarInterval,
  calculatePvOutputFromPoa,
} from './solarModel';

/**
 * Validates site coordinates according to standard domain contracts.
 */
function validateSiteCoordinates(site: GenerationSite): void {
  if (
    site.latitude === null ||
    site.latitude === undefined ||
    site.longitude === null ||
    site.longitude === undefined
  ) {
    throw new Error('Site coordinates unconfigured: latitude and longitude must not be null.');
  }

  if (site.latitude < -90 || site.latitude > 90) {
    throw new Error(`Invalid latitude: ${site.latitude}. Must be between -90 and 90 degrees.`);
  }

  if (site.longitude < -180 || site.longitude > 180) {
    throw new Error(`Invalid longitude: ${site.longitude}. Must be between -180 and 180 degrees.`);
  }
}

/**
 * Extracts local calendar date (YYYY-MM-DD), month index (0-11), year, and day for a given instant.
 *
 * Respects site.timeZone if specified and valid; defaults to UTC if empty or unconfigured.
 */
export function getLocalDateAndMonth(
  instantUtc: Date,
  timeZone?: string
): { localDate: string; monthIndex: number; year: number; day: number } {
  if (!instantUtc || isNaN(instantUtc.getTime())) {
    throw new Error('Invalid instantUtc: must be a valid Date object.');
  }

  const tz = timeZone && timeZone.trim() ? timeZone.trim() : 'UTC';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDate = formatter.format(instantUtc);
    const [yStr, mStr, dStr] = localDate.split('-');
    const year = parseInt(yStr, 10);
    const monthIndex = parseInt(mStr, 10) - 1;
    const day = parseInt(dStr, 10);
    return { localDate, monthIndex, year, day };
  } catch {
    const year = instantUtc.getUTCFullYear();
    const monthIndex = instantUtc.getUTCMonth();
    const day = instantUtc.getUTCDate();
    const localDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { localDate, monthIndex, year, day };
  }
}

/**
 * Converts a local calendar date and time (hours, minutes, seconds) into a UTC Date object.
 */
export function localTimeToUtc(
  year: number,
  month1Indexed: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone?: string
): Date {
  const tz = timeZone && timeZone.trim() ? timeZone.trim() : 'UTC';

  if (tz === 'UTC' || tz === 'Etc/UTC') {
    return new Date(Date.UTC(year, month1Indexed - 1, day, hour, minute, second));
  }

  try {
    const approx = new Date(Date.UTC(year, month1Indexed - 1, day, hour, minute, second));
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    const parts = dtf.formatToParts(approx);
    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const asTz = new Date(
      Date.UTC(
        parseInt(map.year, 10),
        parseInt(map.month, 10) - 1,
        parseInt(map.day, 10),
        parseInt(map.hour, 10),
        parseInt(map.minute, 10),
        parseInt(map.second, 10)
      )
    );
    const diffMs = approx.getTime() - asTz.getTime();
    return new Date(approx.getTime() + diffMs);
  } catch {
    return new Date(Date.UTC(year, month1Indexed - 1, day, hour, minute, second));
  }
}

/**
 * Calculates horizontal clear-sky GHI (kW/m²) at a specific UTC instant and site.
 */
function getClearSkyGhiAtInstant(instantUtc: Date, site: GenerationSite): number {
  const position = calculateSolarPosition(instantUtc, site);
  if (!position.isDaylight || position.elevationDegrees <= 0) {
    return 0;
  }

  const elevDeg = position.elevationDegrees;
  const elevRad = elevDeg * (Math.PI / 180);

  const airMass =
    1 /
    (Math.sin(elevRad) +
      0.50572 * Math.pow(elevDeg + 6.07995, -1.6364));

  const elevationM = site.elevationM ?? 0;
  const pressureRatio = Math.exp(-elevationM / 8434.5);
  const correctedAirMass = airMass * pressureRatio;

  const dni = Math.max(0, 1.353 * Math.pow(0.7, Math.pow(correctedAirMass, 0.678)));
  const beamHorizontal = dni * Math.sin(elevRad);
  const diffuseHorizontal = 0.1 * beamHorizontal;

  return beamHorizontal + diffuseHorizontal;
}

/**
 * Calculates the clear-sky daily horizontal solar energy (GHI) integral for a given local date.
 *
 * Result is in kWh/m²/day.
 */
export function calculateDailyClearSkyGhiKwhPerM2(
  localDateStr: string,
  site: GenerationSite,
  options?: { stepMinutes?: number; timeZone?: string }
): number {
  validateSiteCoordinates(site);

  const [yearStr, monthStr, dayStr] = localDateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid localDateStr: ${localDateStr}. Must be YYYY-MM-DD.`);
  }

  const tz = options?.timeZone || site.timeZone || 'UTC';
  const stepMinutes = options?.stepMinutes ?? 15;
  if (stepMinutes <= 0 || !Number.isFinite(stepMinutes)) {
    throw new Error(`Invalid stepMinutes: ${stepMinutes}. Must be greater than 0.`);
  }

  const dt = stepMinutes / 60;
  const steps = Math.floor(1440 / stepMinutes);

  let totalDailyGhi = 0;
  for (let i = 0; i < steps; i++) {
    const minsFromMidnight = (i + 0.5) * stepMinutes;
    const hour = Math.floor(minsFromMidnight / 60);
    const minute = Math.floor(minsFromMidnight % 60);
    const instantUtc = localTimeToUtc(year, month, day, hour, minute, 0, tz);

    const ghiKwPerM2 = getClearSkyGhiAtInstant(instantUtc, site);
    totalDailyGhi += ghiKwPerM2 * dt;
  }

  return totalDailyGhi;
}

export interface SolarIntervalCalculationOptions {
  dailyClearSkyGhiKwhPerM2?: number;
  resourceScaleFactor?: number;
}

/**
 * Calculates interval solar generation under the monthly_peak_sun_hours resource model.
 *
 * Implements:
 * 1. NOAA clear-sky geometry to determine sun position and clear-sky irradiances (GHI, DNI, POA).
 * 2. Normalization of horizontal irradiance (GHI) against the user's monthly peak sun hours (kWh/m²/day).
 * 3. Scaling of DNI and POA by the identical resource scale factor.
 * 4. Application of system losses, shading losses, and inverter clipping via calculatePvOutputFromPoa.
 */
export function calculateMonthlyPeakSunHourSolarInterval(
  instantUtc: Date,
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset,
  optionsOrDailyGhi?: SolarIntervalCalculationOptions | number
): MonthlyPeakSunHourSolarInterval {
  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  validateSiteCoordinates(site);

  const { localDate, monthIndex } = getLocalDateAndMonth(instantUtc, site.timeZone);
  const targetPeakSunHoursPerDay = Math.max(0, asset.monthlyPeakSunHoursPerDay[monthIndex] ?? 0);

  let resourceScaleFactor = 0;

  if (typeof optionsOrDailyGhi === 'number') {
    const dailyGhi = optionsOrDailyGhi;
    resourceScaleFactor = dailyGhi > 0 && targetPeakSunHoursPerDay > 0 ? targetPeakSunHoursPerDay / dailyGhi : 0;
  } else if (optionsOrDailyGhi && typeof optionsOrDailyGhi.resourceScaleFactor === 'number') {
    resourceScaleFactor = Math.max(0, optionsOrDailyGhi.resourceScaleFactor);
  } else if (optionsOrDailyGhi && typeof optionsOrDailyGhi.dailyClearSkyGhiKwhPerM2 === 'number') {
    const dailyGhi = optionsOrDailyGhi.dailyClearSkyGhiKwhPerM2;
    resourceScaleFactor = dailyGhi > 0 && targetPeakSunHoursPerDay > 0 ? targetPeakSunHoursPerDay / dailyGhi : 0;
  } else {
    const dailyClearSkyGhi = calculateDailyClearSkyGhiKwhPerM2(localDate, site);
    resourceScaleFactor =
      dailyClearSkyGhi > 0 && targetPeakSunHoursPerDay > 0
        ? targetPeakSunHoursPerDay / dailyClearSkyGhi
        : 0;
  }

  // Clear-sky calculation for geometry and baseline irradiance
  const clearSky = calculateClearSkySolarInterval(instantUtc, intervalHours, site, asset);
  const clearSkyPoaKwPerM2 = clearSky.planeOfArrayIrradianceKwPerM2;

  // Scale GHI, DNI, and POA by identical horizontal resource scale factor
  const modeledGhiKwPerM2 = clearSky.clearSkyGhiKwPerM2 * resourceScaleFactor;
  const modeledDniKwPerM2 = clearSky.clearSkyDniKwPerM2 * resourceScaleFactor;
  const modeledPoaKwPerM2 = clearSkyPoaKwPerM2 * resourceScaleFactor;

  // Calculate electrical conversion from modeled POA irradiance
  const pvOutput = calculatePvOutputFromPoa(modeledPoaKwPerM2, intervalHours, asset);

  return {
    timestampUtc: instantUtc.toISOString(),
    localDate,
    monthIndex,
    targetPeakSunHoursPerDay,
    resourceScaleFactor,
    position: clearSky.position,
    clearSkyGhiKwPerM2: clearSky.clearSkyGhiKwPerM2,
    clearSkyDniKwPerM2: clearSky.clearSkyDniKwPerM2,
    clearSkyPoaKwPerM2,
    modeledGhiKwPerM2,
    modeledDniKwPerM2,
    modeledPoaKwPerM2,
    ...pvOutput,
  };
}

export type ProfileIntervalInput =
  | Date
  | string
  | { timestampUtc?: string | Date; timestamp?: string | Date; intervalHours?: number };

/**
 * Generates an interval solar generation profile for a series of UTC timestamps
 * under the monthly_peak_sun_hours resource model.
 *
 * Supports overloaded calling conventions:
 * - (instants: Date[], intervalHours: number, site: GenerationSite, asset: SolarGenerationAsset)
 * - (intervals: ProfileIntervalInput[], site: GenerationSite, asset: SolarGenerationAsset, defaultIntervalHours?: number)
 */
export function generateMonthlyPeakSunHourSolarProfile(
  instants: Date[],
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset
): MonthlyPeakSunHourSolarInterval[];

export function generateMonthlyPeakSunHourSolarProfile(
  intervals: ProfileIntervalInput[],
  site: GenerationSite,
  asset: SolarGenerationAsset,
  defaultIntervalHours?: number
): MonthlyPeakSunHourSolarInterval[];

export function generateMonthlyPeakSunHourSolarProfile(
  arg1: ProfileIntervalInput[],
  arg2: number | GenerationSite,
  arg3: GenerationSite | SolarGenerationAsset,
  arg4?: SolarGenerationAsset | number
): MonthlyPeakSunHourSolarInterval[] {
  let rawIntervals: ProfileIntervalInput[];
  let site: GenerationSite;
  let asset: SolarGenerationAsset;
  let defaultIntervalHours: number;

  if (typeof arg2 === 'number') {
    rawIntervals = arg1;
    defaultIntervalHours = arg2;
    site = arg3 as GenerationSite;
    asset = arg4 as SolarGenerationAsset;
  } else {
    rawIntervals = arg1;
    site = arg2 as GenerationSite;
    asset = arg3 as SolarGenerationAsset;
    defaultIntervalHours = typeof arg4 === 'number' ? arg4 : 1.0;
  }

  if (!rawIntervals || rawIntervals.length === 0) {
    return [];
  }

  validateSiteCoordinates(site);

  // Cache daily clear-sky GHI integral per localDate to avoid redundant calculation
  const dailyGhiCache = new Map<string, number>();

  const results: MonthlyPeakSunHourSolarInterval[] = [];

  for (const item of rawIntervals) {
    let date: Date;
    let dt = defaultIntervalHours;

    if (item instanceof Date) {
      date = item;
    } else if (typeof item === 'string') {
      date = new Date(item);
    } else if (typeof item === 'object' && item !== null) {
      const rawTs = item.timestampUtc ?? item.timestamp;
      date = rawTs instanceof Date ? rawTs : new Date(rawTs as string);
      if (typeof item.intervalHours === 'number' && item.intervalHours > 0) {
        dt = item.intervalHours;
      }
    } else {
      continue;
    }

    if (!date || isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp in interval: ${JSON.stringify(item)}`);
    }

    const { localDate } = getLocalDateAndMonth(date, site.timeZone);

    let dailyGhi = dailyGhiCache.get(localDate);
    if (dailyGhi === undefined) {
      dailyGhi = calculateDailyClearSkyGhiKwhPerM2(localDate, site);
      dailyGhiCache.set(localDate, dailyGhi);
    }

    const result = calculateMonthlyPeakSunHourSolarInterval(date, dt, site, asset, dailyGhi);
    results.push(result);
  }

  return results;
}

/**
 * Summarizes an interval solar generation profile into monthly and overall aggregate metrics.
 */
export function summarizeSolarGenerationProfile(
  intervals: MonthlyPeakSunHourSolarInterval[]
): SolarGenerationProfileSummary {
  let totalDcEnergyKwh = 0;
  let totalAcEnergyKwh = 0;
  let totalClippedEnergyKwh = 0;

  // Initialize all 12 calendar months (0 = Jan .. 11 = Dec)
  const monthly: SolarMonthlyGenerationSummary[] = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    intervalCount: 0,
    dcEnergyKwh: 0,
    acEnergyKwh: 0,
    clippedEnergyKwh: 0,
  }));

  for (const interval of intervals) {
    totalDcEnergyKwh += interval.dcEnergyKwh;
    totalAcEnergyKwh += interval.acEnergyKwh;
    totalClippedEnergyKwh += interval.clippedEnergyKwh;

    const m = interval.monthIndex;
    if (m >= 0 && m < 12) {
      const ms = monthly[m];
      ms.intervalCount += 1;
      ms.dcEnergyKwh += interval.dcEnergyKwh;
      ms.acEnergyKwh += interval.acEnergyKwh;
      ms.clippedEnergyKwh += interval.clippedEnergyKwh;
    }
  }

  return {
    intervalCount: intervals.length,
    totalDcEnergyKwh,
    totalAcEnergyKwh,
    totalClippedEnergyKwh,
    monthly,
  };
}

export { summarizeSolarGenerationProfile as calculateSolarProfileSummary };
export { summarizeSolarGenerationProfile as summarizeSolarProfile };
