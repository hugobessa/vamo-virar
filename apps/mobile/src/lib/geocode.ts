// Place search for event locations, through Photon (photon.komoot.io): an
// open-source geocoder over OpenStreetMap data, made for search-as-you-type,
// with no key, no account and no billing. Its public server is run on a
// fair-use basis with no guarantees, so the app treats it as best effort:
// the built-in city list (model/places.ts) always answers too, and a failed
// search only shows a notice.
//
// Privacy: what the organizer types in the "Local" field reaches Photon
// (plus the IP), and nothing else. The person's own places (settings) never
// use this module. Attribution: data © OpenStreetMap contributors (ODbL).

import { BRAZIL_BBOX, parsePhoton, type PlaceSuggestion } from "../model/location";

const PHOTON = "https://photon.komoot.io/api/";

/** Up to six places or addresses in Brazil matching what was typed. */
export async function searchPhoton(input: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const q = new URLSearchParams({ q: input, limit: "6", bbox: BRAZIL_BBOX });
  const res = await fetch(`${PHOTON}?${q.toString()}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  return parsePhoton(await res.json());
}
