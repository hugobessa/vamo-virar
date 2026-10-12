// Persistence for replicas (docs/security.md "Keys on devices").
//
// Each community's replica (keys, state, outbox) is one CBOR blob, sealed
// with XChaCha20-Poly1305 under a device key that lives in the platform
// keystore (iOS Keychain / Android Keystore via expo-secure-store), and
// written to the app's document directory. Nothing readable touches disk.
//
// On web there is no keystore. The device key is kept in IndexedDB wrapped
// (AES-GCM) by a non-extractable WebCrypto key, so a copy of the site's
// storage, or a script that can read it, never gets the key itself; code
// running inside the page can still use it, so web stays weaker than the
// phone. Replicas live in IndexedDB too, and the page asks the browser to
// keep that storage (navigator.storage.persist), since browsers may clear it.
// Earlier web builds kept both in localStorage; they move over on first use.

import { aeadOpen, aeadSeal, defaultRng } from "@vamo-virar/crypto";
import { concatBytes, fromHex, toHex } from "@vamo-virar/protocol";
import { Platform } from "react-native";

const KEY_NAME = "vv.device-key.v1";
const NONCE = 24;
const AAD = new Uint8Array([0x76, 0x76, 0x2f, 0x73, 0x74, 0x6f, 0x72, 0x65]); // "vv/store"

export const insecureStorage = Platform.OS === "web";

export interface BlobStore {
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

async function deviceKey(): Promise<Uint8Array> {
  if (insecureStorage) return (await webReady()).deviceKey;
  const SecureStore = await import("expo-secure-store");
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return fromHex(existing);
  const k = defaultRng(32);
  await SecureStore.setItemAsync(KEY_NAME, toHex(k), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return k;
}

function fileStore(): BlobStore {
  // Loaded lazily so the web bundle never touches native modules.
  const fs = require("expo-file-system") as typeof import("expo-file-system");
  const dir = new fs.Directory(fs.Paths.document, "communities");
  const ensure = () => dir.create({ idempotent: true, intermediates: true });
  return {
    async list() {
      ensure();
      return dir
        .list()
        .filter((e): e is InstanceType<typeof fs.File> => e instanceof fs.File)
        .map((f) => f.name)
        .filter((n) => n.endsWith(".bin"))
        .map((n) => n.slice(0, -4));
    },
    async read(name) {
      const f = new fs.File(dir, `${name}.bin`);
      return f.exists ? await f.bytes() : null;
    },
    async write(name, bytes) {
      ensure();
      const tmp = new fs.File(dir, `${name}.tmp`);
      tmp.create({ overwrite: true });
      tmp.write(bytes);
      const f = new fs.File(dir, `${name}.bin`);
      if (f.exists) f.delete();
      await tmp.move(f);
    },
    async remove(name) {
      const f = new fs.File(dir, `${name}.bin`);
      if (f.exists) f.delete();
    },
  };
}

// --- web: IndexedDB ---------------------------------------------------------

const DB_NAME = "vamo-virar";
const KEYS = "keys";
const BLOBS = "blobs";
const LEGACY_PREFIX = "vv.community.";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore(KEYS);
    r.result.createObjectStore(BLOBS);
  };
  return request(r);
}

/** One request in its own transaction (WebCrypto awaits would end a longer one). */
function op<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return request(f(db.transaction(store, mode).objectStore(store)));
}

/** WebCrypto wants ArrayBuffer-backed views; this copies into one. */
const buf = (u: Uint8Array) => new Uint8Array(u) as Uint8Array<ArrayBuffer>;

interface WebState {
  db: IDBDatabase;
  deviceKey: Uint8Array;
}

async function openWeb(): Promise<WebState> {
  const db = await openDb();
  const subtle = globalThis.crypto.subtle;
  let wrap = (await op(db, KEYS, "readonly", (s) => s.get("wrap"))) as CryptoKey | undefined;
  if (!wrap) {
    wrap = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await op(db, KEYS, "readwrite", (s) => s.put(wrap, "wrap"));
  }
  const sealed = (await op(db, KEYS, "readonly", (s) => s.get("device"))) as { iv: Uint8Array; ct: ArrayBuffer } | undefined;
  let deviceKey: Uint8Array;
  if (sealed) {
    deviceKey = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: buf(sealed.iv) }, wrap, sealed.ct));
  } else {
    // A key left by an earlier build keeps its replicas readable.
    const ls = globalThis.localStorage;
    const legacy = ls?.getItem(KEY_NAME);
    deviceKey = legacy ? fromHex(legacy) : defaultRng(32);
    const iv = defaultRng(12);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, wrap, buf(deviceKey));
    await op(db, KEYS, "readwrite", (s) => s.put({ iv, ct }, "device"));
    if (ls) {
      for (const k of Object.keys(ls).filter((k) => k.startsWith(LEGACY_PREFIX))) {
        const v = ls.getItem(k);
        if (v) await op(db, BLOBS, "readwrite", (s) => s.put(fromHex(v), k.slice(LEGACY_PREFIX.length)));
        ls.removeItem(k);
      }
      ls.removeItem(KEY_NAME);
    }
  }
  // Best effort: browsers may still say no, and may clear unpersisted storage.
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return { db, deviceKey };
}

let web: Promise<WebState> | null = null;
function webReady(): Promise<WebState> {
  if (!web) web = openWeb();
  return web;
}

function webStore(): BlobStore {
  return {
    async list() {
      const { db } = await webReady();
      return (await op(db, BLOBS, "readonly", (s) => s.getAllKeys())).map(String);
    },
    async read(name) {
      const { db } = await webReady();
      const v = (await op(db, BLOBS, "readonly", (s) => s.get(name))) as Uint8Array | undefined;
      return v ?? null;
    },
    async write(name, bytes) {
      const { db } = await webReady();
      await op(db, BLOBS, "readwrite", (s) => s.put(bytes, name));
    },
    async remove(name) {
      const { db } = await webReady();
      await op(db, BLOBS, "readwrite", (s) => s.delete(name));
    },
  };
}

/** Encrypting wrapper around the platform blob store. */
export class SealedStore {
  private key: Promise<Uint8Array> | null = null;

  constructor(private readonly inner: BlobStore = insecureStorage ? webStore() : fileStore()) {}

  private k(): Promise<Uint8Array> {
    if (!this.key) this.key = deviceKey();
    return this.key;
  }

  list(): Promise<string[]> {
    return this.inner.list();
  }

  async read(name: string): Promise<Uint8Array | null> {
    const raw = await this.inner.read(name);
    if (!raw || raw.length < NONCE + 16) return null;
    return aeadOpen(await this.k(), raw.subarray(0, NONCE), raw.subarray(NONCE), AAD);
  }

  async write(name: string, bytes: Uint8Array): Promise<void> {
    const nonce = defaultRng(NONCE);
    await this.inner.write(name, concatBytes(nonce, aeadSeal(await this.k(), nonce, bytes, AAD)));
  }

  remove(name: string): Promise<void> {
    return this.inner.remove(name);
  }
}
