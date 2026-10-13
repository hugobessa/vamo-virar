import { describe, expect, it } from "vitest";
import { allStrings, reasonKey, translator } from "./i18n";
import { searchPlaces } from "./places";
import { syncStatusKey } from "./sync-status";

describe("i18n", () => {
  it("is in Portuguese and maps reasons", () => {
    const t = translator();
    expect(t("volunteer")).toBe("Quero participar");
    expect(reasonKey("capacity_full")).toBe("why_capacity_full");
    expect(reasonKey("something_new")).toBe("why_other");
  });

  it("never uses protocol jargon in user-facing text", () => {
    const jargon = /\b(node|nodes|epoch|crdt|public key|private key|envelope|operation log|ciphertext|nó|época|chave pública|chave privada|criptograf)/i;
    for (const s of allStrings()) expect(s).not.toMatch(jargon);
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

describe("error text", () => {
  it("is always Portuguese, never the raw English message", async () => {
    const { NodeError } = await import("@vamo-virar/sync");
    const { errorText } = await import("./errors");
    expect(errorText(new NodeError(409, "moved", "this community moved"))).toBe("A comunidade mudou de servidor. Tente de novo em instantes.");
    expect(errorText(new NodeError(0, "stream", "could not open stream"))).toMatch(/^Sem conexão/);
    expect(errorText(new TypeError("Network request failed"))).toMatch(/^Sem conexão/);
    expect(errorText(new NodeError(502, "http_error", "Application failed to respond"))).toMatch(/^O servidor não está respondendo/);
    expect(errorText(new NodeError(403, "forbidden", "provisioning token required"))).toMatch(/código de criação/);
    // A bug is not a connection problem.
    expect(errorText(new TypeError("Cannot read property 'x' of undefined"))).toBe("Algo deu errado.");
    expect(errorText(new Error("this recovery code is not for this community"))).toBe("Esse código de recuperação não é desta comunidade.");
    expect(errorText(new Error("something internal and English"))).toBe("Algo deu errado.");
  });

  it("gives the raw error only where there is no sentence for it", async () => {
    const { NodeError } = await import("@vamo-virar/sync");
    const { errorDetail } = await import("./errors");
    expect(errorDetail(new TypeError("Cannot read property 'x' of undefined"))).toBe("TypeError: Cannot read property 'x' of undefined");
    expect(errorDetail(new NodeError(418, "teapot", "short and stout"))).toBe("418 teapot: short and stout");
    expect(errorDetail(new TypeError("Network request failed"))).toBeNull();
    expect(errorDetail(new NodeError(507, "quota_exceeded", "no room"))).toBeNull();
    expect(errorDetail(new Error("this recovery code is not for this community"))).toBeNull();
  });
});
