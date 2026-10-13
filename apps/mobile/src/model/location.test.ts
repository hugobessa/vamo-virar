import { describe, expect, it } from "vitest";
import { degToE4, e4ToDeg, mapsSearchUrl, parsePhoton, snapArea } from "./location";

const derby = { lat_e4: -80_571, lng_e4: -348_950 };

describe("coordinates", () => {
  it("round-trips degrees and e4 units", () => {
    expect(degToE4(-8.0571)).toBe(-80_571);
    expect(e4ToDeg(-348_950)).toBe(-34.895);
    expect(degToE4(e4ToDeg(123_456))).toBe(123_456);
  });
});

describe("snapArea", () => {
  it("moves the point at most about one radius and is stable", () => {
    const s = snapArea(derby, 500);
    // 500 m ≈ 45 e4 units of latitude; the cell is 2 × radius wide.
    expect(Math.abs(s.lat_e4 - derby.lat_e4)).toBeLessThanOrEqual(45);
    expect(Math.abs(s.lng_e4 - derby.lng_e4)).toBeLessThanOrEqual(46);
    expect(snapArea(derby, 500)).toEqual(s);
    expect(Number.isInteger(s.lat_e4) && Number.isInteger(s.lng_e4)).toBe(true);
  });

  it("gives nearby points the same cell and far points another", () => {
    const s = snapArea(derby, 500);
    expect(snapArea({ lat_e4: derby.lat_e4 + 3, lng_e4: derby.lng_e4 - 3 }, 500)).toEqual(s);
    expect(snapArea({ lat_e4: derby.lat_e4 + 300, lng_e4: derby.lng_e4 }, 500)).not.toEqual(s);
  });
});

describe("mapsSearchUrl", () => {
  it("links to Google Maps without any key", () => {
    expect(mapsSearchUrl(derby)).toBe("https://www.google.com/maps/search/?api=1&query=-8.0571%2C-34.895");
  });
});

describe("parsePhoton", () => {
  const feature = (properties: Record<string, unknown>, coordinates: unknown = [-34.89504, -8.05712]) => ({
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates },
  });

  it("reads a named place with its address and e4 coordinates", () => {
    const rows = parsePhoton({
      features: [feature({ osm_type: "W", osm_id: 123, name: "Praça do Derby", district: "Derby", city: "Recife", state: "Pernambuco", country: "Brasil" })],
    });
    expect(rows).toEqual([{ id: "W123", name: "Praça do Derby", address: "Derby, Recife, Pernambuco", lat_e4: -80_571, lng_e4: -348_950 }]);
  });

  it("names plain addresses by street and number, and cities by themselves", () => {
    const rows = parsePhoton({
      features: [
        feature({ osm_type: "N", osm_id: 1, street: "Rua da Aurora", housenumber: "100", city: "Recife", state: "Pernambuco" }),
        feature({ osm_type: "R", osm_id: 2, name: "Recife", state: "Pernambuco" }),
      ],
    });
    expect(rows[0]).toMatchObject({ name: "Rua da Aurora, 100", address: "Recife, Pernambuco" });
    expect(rows[1]).toMatchObject({ name: "Recife", address: "Pernambuco" });
  });

  it("drops rows without coordinates or names, and same-named rows at the same address", () => {
    const rows = parsePhoton({
      features: [
        feature({ osm_type: "N", osm_id: 1, name: "A" }, null),
        feature({ osm_type: "N", osm_id: 2, name: "B" }, ["x", 1]),
        feature({ osm_type: "N", osm_id: 3 }),
        feature({ osm_type: "N", osm_id: 4, name: "C", city: "Recife" }),
        // The same square mapped twice, metres apart: one row.
        feature({ osm_type: "W", osm_id: 5, name: "C", city: "Recife" }, [-34.8996, -8.0567]),
        feature({ osm_type: "N", osm_id: 6, name: "C", city: "Olinda" }),
      ],
    });
    expect(rows.map((r) => `${r.name} (${r.address})`)).toEqual(["C (Recife)", "C (Olinda)"]);
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: "x" })).toEqual([]);
  });
});
