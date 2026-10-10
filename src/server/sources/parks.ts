import type { Park } from '../../shared/types.js';
import { coarse } from './http.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const RADIUS_M = 3000;
const WALK_KMH = 4.8;

interface OverpassElement {
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Named parks, gardens and nature reserves near the (coarse) location from OpenStreetMap. */
export async function findParks(lat: number, lon: number): Promise<Park[]> {
  const la = coarse(lat);
  const lo = coarse(lon);
  const query = `[out:json][timeout:12];
(
  way["leisure"~"^(park|garden|nature_reserve)$"]["name"](around:${RADIUS_M},${la},${lo});
  relation["leisure"~"^(park|garden|nature_reserve)$"]["name"](around:${RADIUS_M},${la},${lo});
  node["leisure"="park"]["name"](around:${RADIUS_M},${la},${lo});
);
out center tags 60;`;

  let lastError: unknown = null;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'go-window/0.1 (+https://github.com/MasterFloppa/Go-Window)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(14000),
      });
      if (!res.ok) throw new Error(`${new URL(mirror).host} responded ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      return toParks(json.elements, la, lo);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Overpass mirrors failed');
}

function toParks(elements: OverpassElement[], lat: number, lon: number): Park[] {
  const seen = new Set<string>();
  const parks: Park[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    const pLat = el.center?.lat ?? el.lat;
    const pLon = el.center?.lon ?? el.lon;
    if (!name || pLat === undefined || pLon === undefined || seen.has(name)) continue;
    seen.add(name);
    const km = distanceKm(lat, lon, pLat, pLon);
    parks.push({
      name,
      kind: el.tags?.leisure ?? 'park',
      lat: pLat,
      lon: pLon,
      distanceKm: Math.round(km * 10) / 10,
      walkMinutes: Math.max(1, Math.round((km / WALK_KMH) * 60)),
    });
  }
  return parks.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 12);
}
