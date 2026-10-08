// A small built-in list of places for choosing an event's area without a
// map or GPS. Coordinates are integer degrees × 10⁴ (protocol.md §9.3).
// Phase 7 adds map selection and the person's own reference points.

export interface Place {
  name: string;
  lat_e4: number;
  lng_e4: number;
}

export const PLACES: Place[] = [
  { name: "Recife, PE", lat_e4: -80_476, lng_e4: -348_770 },
  { name: "Olinda, PE", lat_e4: -80_089, lng_e4: -348_553 },
  { name: "Jaboatão dos Guararapes, PE", lat_e4: -81_130, lng_e4: -350_150 },
  { name: "Caruaru, PE", lat_e4: -82_833, lng_e4: -359_761 },
  { name: "João Pessoa, PB", lat_e4: -71_195, lng_e4: -348_450 },
  { name: "Natal, RN", lat_e4: -57_945, lng_e4: -352_110 },
  { name: "Maceió, AL", lat_e4: -96_498, lng_e4: -357_089 },
  { name: "Aracaju, SE", lat_e4: -109_472, lng_e4: -370_731 },
  { name: "Salvador, BA", lat_e4: -129_777, lng_e4: -385_016 },
  { name: "Fortaleza, CE", lat_e4: -37_319, lng_e4: -385_267 },
  { name: "Teresina, PI", lat_e4: -50_892, lng_e4: -428_019 },
  { name: "São Luís, MA", lat_e4: -25_297, lng_e4: -443_028 },
  { name: "Belém, PA", lat_e4: -14_558, lng_e4: -485_044 },
  { name: "Manaus, AM", lat_e4: -31_190, lng_e4: -600_217 },
  { name: "Brasília, DF", lat_e4: -157_975, lng_e4: -478_919 },
  { name: "Goiânia, GO", lat_e4: -166_869, lng_e4: -492_648 },
  { name: "Belo Horizonte, MG", lat_e4: -199_167, lng_e4: -439_345 },
  { name: "Rio de Janeiro, RJ", lat_e4: -229_068, lng_e4: -431_729 },
  { name: "São Paulo, SP", lat_e4: -235_505, lng_e4: -466_333 },
  { name: "Curitiba, PR", lat_e4: -254_284, lng_e4: -492_733 },
  { name: "Florianópolis, SC", lat_e4: -275_954, lng_e4: -485_480 },
  { name: "Porto Alegre, RS", lat_e4: -300_346, lng_e4: -512_177 },
];

export function searchPlaces(q: string): Place[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const n = norm(q.trim());
  if (!n) return PLACES.slice(0, 8);
  return PLACES.filter((p) => norm(p.name).includes(n)).slice(0, 8);
}
