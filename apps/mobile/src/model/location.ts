// Pure helpers for event locations: coordinate units, the approximate point
// shown to people who have not confirmed (protocol.md §9.6), the map link,
// and the parsing of Photon (OpenStreetMap) search results. No network here;
// see lib/geocode.ts.

/** Integer degrees × 10⁴ (~11 m), the unit events carry (protocol.md §9.3). */
export interface Area {
  lat_e4: number;
  lng_e4: number;
}

/** A place chosen for an event: what people read plus where it is. */
export interface PickedPlace extends Area {
  name: string;
  /** Street, district, city: shown only while choosing. */
  address?: string;
}

/** A row of the autocomplete list. Photon returns coordinates with the row. */
export interface PlaceSuggestion extends PickedPlace {
  id: string;
}

export const degToE4 = (deg: number): number => Math.round(deg * 1e4);
export const e4ToDeg = (e4: number): number => e4 / 1e4;

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

/**
 * Centre of the grid cell of about 2 × `radiusM` that contains `area`:
 * the point members see until they are confirmed (protocol.md §9.6).
 * Stable for the same event, so repeated views do not leak the exact spot.
 */
export function snapArea(area: Area, radiusM = 500): Area {
  const cellLat = Math.max(1, Math.round(((2 * radiusM) / M_PER_DEG) * 1e4));
  const cos = Math.max(0.01, Math.cos((e4ToDeg(area.lat_e4) * Math.PI) / 180));
  const cellLng = Math.max(1, Math.round(cellLat / cos));
  const snap = (v: number, cell: number) => Math.floor(v / cell) * cell + Math.floor(cell / 2);
  return { lat_e4: snap(area.lat_e4, cellLat), lng_e4: snap(area.lng_e4, cellLng) };
}

const latLng = (a: Area) => `${e4ToDeg(a.lat_e4)},${e4ToDeg(a.lng_e4)}`;

/** Opens the point in the Google Maps app or site; needs no API key. */
export function mapsSearchUrl(area: Area): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latLng(area))}`;
}

/** Brazil, as Photon's `bbox` (minLon,minLat,maxLon,maxLat). */
export const BRAZIL_BBOX = "-74.0,-33.8,-28.8,5.3";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Photon's GeoJSON → rows for the list. The first line is the place's name,
 * or its street and number for plain addresses; the second line goes from
 * the street to the state, skipping repeats. Rows without coordinates or
 * without anything to read are dropped, as are duplicates.
 */
export function parsePhoton(body: unknown): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  const list = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(list)) return out;
  for (const f of list) {
    const feat = f as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
    const p = feat.properties ?? {};
    const coords = feat.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords as unknown[];
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const street = str(p.street);
    const house = str(p.housenumber);
    const streetLine = street ? (house ? `${street}, ${house}` : street) : undefined;
    const name = str(p.name) ?? streetLine ?? str(p.city) ?? str(p.state);
    if (!name) continue;
    const parts = [name === streetLine ? undefined : streetLine, str(p.district), str(p.city), str(p.state)].filter((x): x is string => !!x && x !== name);
    const address = [...new Set(parts)].join(", ") || undefined;

    const id = `${str(p.osm_type) ?? "?"}${str(p.osm_id) ?? String(p.osm_id ?? "")}` || `${lat},${lng}`;
    // Photon often returns the same square or street as several OSM objects
    // metres apart; one row with that name and address is enough.
    const key = `${name}|${address ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name, lat_e4: degToE4(lat), lng_e4: degToE4(lng), ...(address ? { address } : {}) });
  }
  return out;
}
