import type { HourConditions, Location } from '../../shared/types.js';
import { coarse, fetchJson } from './http.js';

export interface Forecast {
  timezone: string;
  utcOffsetSeconds: number;
  hours: HourConditions[];
  daylight: Record<string, { sunrise: string; sunset: string }>;
  airAvailable: boolean;
  fetchedAt: number;
}

interface ForecastResponse {
  timezone: string;
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    relative_humidity_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    weather_code: number[];
    uv_index: (number | null)[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    is_day: number[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

interface AirResponse {
  hourly: { time: string[]; pm2_5: (number | null)[]; pm10: (number | null)[]; us_aqi: (number | null)[] };
}

interface GeocodeResponse {
  results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone: string }[];
}

const FORECAST_DAYS = 3;
const CACHE_MS = 30 * 60 * 1000;
/** If air quality failed, retry soon rather than planning without it for half an hour. */
const PARTIAL_CACHE_MS = 3 * 60 * 1000;
const cache = new Map<string, Forecast>();

async function fetchAir(url: string): Promise<AirResponse | null> {
  for (const timeoutMs of [15000, 25000]) {
    try {
      return await fetchJson<AirResponse>(url, { timeoutMs });
    } catch (err) {
      console.warn(`[air] ${(err as Error).message}`);
    }
  }
  return null;
}

export async function getForecast(lat: number, lon: number, force = false): Promise<Forecast> {
  const la = coarse(lat);
  const lo = coarse(lon);
  const key = `${la},${lo}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.fetchedAt < (hit.airAvailable ? CACHE_MS : PARTIAL_CACHE_MS)) return hit;

  const hourlyWeather = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation_probability',
    'precipitation',
    'weather_code',
    'uv_index',
    'wind_speed_10m',
    'wind_gusts_10m',
    'is_day',
  ].join(',');
  const common = `latitude=${la}&longitude=${lo}&timezone=auto&forecast_days=${FORECAST_DAYS}`;

  const [wx, air] = await Promise.all([
    fetchJson<ForecastResponse>(
      `https://api.open-meteo.com/v1/forecast?${common}&hourly=${hourlyWeather}&daily=sunrise,sunset`,
    ),
    fetchAir(`https://air-quality-api.open-meteo.com/v1/air-quality?${common}&hourly=pm2_5,pm10,us_aqi`),
  ]);

  const airByTime = new Map<string, { pm25: number | null; pm10: number | null; usAqi: number | null }>();
  if (air) {
    air.hourly.time.forEach((t, i) =>
      airByTime.set(t, { pm25: air.hourly.pm2_5[i], pm10: air.hourly.pm10[i], usAqi: air.hourly.us_aqi[i] }),
    );
  }

  const h = wx.hourly;
  const hours: HourConditions[] = h.time.map((time, i) => {
    const a = airByTime.get(time);
    return {
      time,
      temp: h.temperature_2m[i],
      feels: h.apparent_temperature[i],
      humidity: h.relative_humidity_2m[i],
      rainProb: h.precipitation_probability[i] ?? 0,
      precip: h.precipitation[i] ?? 0,
      weatherCode: h.weather_code[i],
      uv: h.uv_index[i] ?? 0,
      wind: h.wind_speed_10m[i],
      gust: h.wind_gusts_10m[i],
      isDay: h.is_day[i] === 1,
      pm25: a?.pm25 ?? null,
      pm10: a?.pm10 ?? null,
      usAqi: a?.usAqi ?? null,
    };
  });

  const daylight: Forecast['daylight'] = {};
  wx.daily.time.forEach((d, i) => {
    daylight[d] = { sunrise: wx.daily.sunrise[i].slice(11, 16), sunset: wx.daily.sunset[i].slice(11, 16) };
  });

  const forecast: Forecast = {
    timezone: wx.timezone,
    utcOffsetSeconds: wx.utc_offset_seconds,
    hours,
    daylight,
    airAvailable: !!air,
    fetchedAt: Date.now(),
  };
  cache.set(key, forecast);
  return forecast;
}

export async function geocode(query: string): Promise<Location[]> {
  const res = await fetchJson<GeocodeResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`,
  );
  return (res.results ?? []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: coarse(r.latitude),
    lon: coarse(r.longitude),
    timezone: r.timezone,
  }));
}

export async function reverseTimezone(lat: number, lon: number): Promise<string> {
  const res = await fetchJson<{ timezone: string }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${coarse(lat)}&longitude=${coarse(lon)}&timezone=auto&forecast_days=1&daily=sunrise`,
  );
  return res.timezone;
}
