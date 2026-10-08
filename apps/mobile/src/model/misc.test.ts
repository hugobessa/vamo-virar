import { describe, expect, it } from "vitest";
import { allStrings, pickLang, reasonKey, translator } from "./i18n";
import { searchPlaces } from "./places";
import { syncStatusKey } from "./sync-status";

describe("i18n", () => {
  it("has every key in both languages and maps reasons", () => {
    const pt = translator("pt");
    const en = translator("en");
    expect(pt("volunteer")).toBe("Quero participar");
    expect(en("volunteer")).toBe("I want to help");
    expect(reasonKey("capacity_full")).toBe("why_capacity_full");
    expect(reasonKey("something_new")).toBe("why_other");
    expect(pickLang("pt")).toBe("pt");
    expect(pickLang("es")).toBe("en");
  });

  it("never uses protocol jargon in user-facing text", () => {
    const jargon = /\b(node|nodes|epoch|crdt|public key|private key|envelope|operation log|ciphertext|nó|época|chave pública|chave privada|criptograf)/i;
    for (const lang of ["pt", "en"] as const) {
      for (const s of allStrings(lang)) expect(s).not.toMatch(jargon);
    }
  });
});

describe("places", () => {
  it("search ignores accents and case", () => {
    expect(searchPlaces("sao paulo")[0]!.name).toBe("São Paulo, SP");
    expect(searchPlaces("recife").map((p) => p.name)).toContain("Recife, PE");
    expect(searchPlaces("")).toHaveLength(8);
  });
});

describe("sync status", () => {
  it("prioritises removal, then access, then connectivity, then pending", () => {
    expect(syncStatusKey({ status: "removed", connectivity: "offline", pending: 3 }).key).toBe("syncRemoved");
    expect(syncStatusKey({ status: "waiting_for_key", connectivity: "ok", pending: 0 }).key).toBe("syncWaitingAccess");
    expect(syncStatusKey({ status: "active", connectivity: "offline", pending: 2 }).key).toBe("syncOffline");
    expect(syncStatusKey({ status: "active", connectivity: "ok", pending: 2 }).key).toBe("syncSending");
    expect(syncStatusKey({ status: "active", connectivity: "ok", pending: 0 }).key).toBe("syncUpToDate");
  });

  it("says why the server is holding changes back", () => {
    expect(syncStatusKey({ status: "active", connectivity: "ok", pending: 1, blocked: "moved" }).key).toBe("syncMoving");
    expect(syncStatusKey({ status: "active", connectivity: "ok", pending: 1, blocked: "suspended" }).key).toBe("syncSuspended");
    expect(syncStatusKey({ status: "active", connectivity: "ok", pending: 1, blocked: "quota_exceeded" }).key).toBe("syncFull");
    expect(syncStatusKey({ status: "active", connectivity: "offline", pending: 1, blocked: "moved" }).key).toBe("syncOffline");
  });
});
