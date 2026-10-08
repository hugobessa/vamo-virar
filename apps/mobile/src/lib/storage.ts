// Persistence for replicas (docs/security.md "Keys on devices").
//
// Each community's replica (keys, state, outbox) is one CBOR blob, sealed
// with XChaCha20-Poly1305 under a device key that lives in the platform
// keystore (iOS Keychain / Android Keystore via expo-secure-store), and
// written to the app's document directory. Nothing readable touches disk.
//
// On web (used only for development and automated UI tests) there is no
// keystore; the device key lives in localStorage and the app says so.

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
  if (insecureStorage) {
    const existing = globalThis.localStorage?.getItem(KEY_NAME);
    if (existing) return fromHex(existing);
    const k = defaultRng(32);
    globalThis.localStorage?.setItem(KEY_NAME, toHex(k));
    return k;
  }
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

function webStore(): BlobStore {
  const prefix = "vv.community.";
  const ls = globalThis.localStorage;
  return {
    async list() {
      const out: string[] = [];
      for (let i = 0; i < (ls?.length ?? 0); i++) {
        const k = ls!.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    },
    async read(name) {
      const v = ls?.getItem(prefix + name);
      return v ? fromHex(v) : null;
    },
    async write(name, bytes) {
      ls?.setItem(prefix + name, toHex(bytes));
    },
    async remove(name) {
      ls?.removeItem(prefix + name);
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
