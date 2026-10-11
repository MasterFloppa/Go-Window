import type { Park } from '../../shared/types.js';
import { coarse } from './http.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const RADIUS_M = 3000;
const WALK_KMH = 4.8;
const USER_AGENT = 'go-window/0.1 (+https://github.com/MasterFloppa/Go-Window)';

interface OverpassElement {
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

/** Rough area of a bounding box in m². Good enough to tell a pocket garden from a big park. */
function boxArea(b: { minlat: number; minlon: number; maxlat: number; maxlon: number }): number {
  const h = (b.maxlat - b.minlat) * 111_000;
  const w = (b.maxlon - b.minlon) * 111_000 * Math.cos((((b.minlat + b.maxlat) / 2) * Math.PI) / 180);
  return Math.max(0, Math.round(h * w));
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
out bb tags 80;`;

  const errors: string[] = [];
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`responded ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[]; remark?: string };
      // Overpass reports its own timeouts as a 200 with an empty result and a remark.
      if (json.remark && !json.elements?.length) throw new Error(json.remark.slice(0, 120));
      const parks = toParks(json.elements ?? [], la, lo);
      if (!parks.length) throw new Error('no named parks in the result');
      return parks;
    } catch (err) {
      errors.push(`${new URL(mirror).host}: ${(err as Error).message}`);
    }
  }
  try {
    return await viaNominatim(la, lo);
  } catch (err) {
    errors.push(`nominatim: ${(err as Error).message}`);
  }
  throw new Error(`No park source reachable (${errors.join('; ')})`);
}

/** Fallback: Nominatim keyword search bounded to a box around the location. Results are cached for a week. */
async function viaNominatim(lat: number, lon: number): Promise<Park[]> {
  const d = RADIUS_M / 111000;
  const viewbox = [lon - d, lat + d, lon + d, lat - d].map((n) => n.toFixed(4)).join(',');
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=park&format=jsonv2&limit=40&bounded=1&viewbox=${viewbox}`,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`responded ${res.status}`);
  const rows = (await res.json()) as {
    name: string;
    lat: string;
    lon: string;
    category: string;
    type: string;
    boundingbox?: [string, string, string, string];
  }[];
  return toParks(
    rows
      .filter((r) => r.category === 'leisure' && ['park', 'garden', 'nature_reserve'].includes(r.type))
      .map((r) => ({
        tags: { name: r.name, leisure: r.type },
        lat: Number(r.lat),
        lon: Number(r.lon),
        bounds: r.boundingbox
          ? { minlat: Number(r.boundingbox[0]), maxlat: Number(r.boundingbox[1]), minlon: Number(r.boundingbox[2]), maxlon: Number(r.boundingbox[3]) }
          : undefined,
      })),
    lat,
    lon,
  );
}

function toParks(elements: OverpassElement[], lat: number, lon: number): Park[] {
  const seen = new Set<string>();
  const parks: Park[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    const b = el.bounds;
    const pLat = el.lat ?? (b ? (b.minlat + b.maxlat) / 2 : undefined);
    const pLon = el.lon ?? (b ? (b.minlon + b.maxlon) / 2 : undefined);
    if (!name || pLat === undefined || pLon === undefined || seen.has(name)) continue;
    seen.add(name);
    const km = distanceKm(lat, lon, pLat, pLon);
    parks.push({
      name,
      kind: el.tags?.leisure ?? 'park',
      lat: Math.round(pLat * 1e5) / 1e5,
      lon: Math.round(pLon * 1e5) / 1e5,
      distanceKm: Math.round(km * 10) / 10,
      walkMinutes: Math.max(1, Math.round((km / WALK_KMH) * 60)),
      areaM2: b && b.maxlat > b.minlat ? boxArea(b) : null,
    });
  }
  return parks.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 25);
}
