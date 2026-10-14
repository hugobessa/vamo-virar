// The set of devices sharing one membership, and which of them is the main
// one (protocol.md §10.5.2). It lives, signed by the member's MSK and sealed
// to their MEK, in the member's own mailbox, where every one of their
// devices reads.

import { CTX, sha256, sign, verify, type SigningKeyPair } from "@vamo-virar/crypto";
import { compareBytes, encode, equalBytes, type CborValue } from "@vamo-virar/protocol";

export const MAX_DEVICES = 8;
export const DEVICE_LABEL_MAX = 60;

export interface DeviceEntry {
  /** DIK.public: names the device and its mailbox. */
  dik: Uint8Array;
  label: string;
  added: number;
}

export interface DeviceSet {
  ver: number;
  main: Uint8Array;
  devices: DeviceEntry[];
  sig: Uint8Array;
}

export type UnsignedDeviceSet = Omit<DeviceSet, "sig">;

const entryCbor = (d: DeviceEntry): CborValue => ({ dik: d.dik, label: d.label, added: d.added });

function signed(cid: Uint8Array, s: UnsignedDeviceSet): CborValue {
  return { cid, ver: s.ver, main: s.main, devices: s.devices.map(entryCbor) };
}

export function signDeviceSet(cid: Uint8Array, msk: SigningKeyPair, s: UnsignedDeviceSet): DeviceSet {
  return { ...s, sig: sign(msk.sk, CTX.devices, signed(cid, s)) };
}

export function deviceSetToCbor(s: DeviceSet): CborValue {
  return { ver: s.ver, main: s.main, devices: s.devices.map(entryCbor), sig: s.sig };
}

const isBytes = (v: unknown, n: number): v is Uint8Array => v instanceof Uint8Array && v.length === n;

/** The shape only; `deviceSetValid` checks it belongs to this member. */
export function deviceSetFromCbor(v: unknown): DeviceSet | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Uint8Array) return null;
  const m = v as Record<string, unknown>;
  if (!Number.isInteger(m.ver) || (m.ver as number) < 1 || (m.ver as number) > 0xffffffff) return null;
  if (!isBytes(m.main, 32) || !isBytes(m.sig, 64) || !Array.isArray(m.devices)) return null;
  if (m.devices.length < 1 || m.devices.length > MAX_DEVICES) return null;
  const devices: DeviceEntry[] = [];
  for (const d of m.devices as unknown[]) {
    if (!d || typeof d !== "object") return null;
    const e = d as Record<string, unknown>;
    if (!isBytes(e.dik, 32) || typeof e.label !== "string" || !Number.isInteger(e.added)) return null;
    if (e.label.length < 1 || e.label.length > DEVICE_LABEL_MAX) return null;
    if (devices.some((x) => equalBytes(x.dik, e.dik as Uint8Array))) return null;
    devices.push({ dik: e.dik, label: e.label, added: e.added as number });
  }
  if (!devices.some((d) => equalBytes(d.dik, m.main as Uint8Array))) return null;
  return { ver: m.ver as number, main: m.main, devices, sig: m.sig };
}

/** Signed by this member's MSK (only their own devices hold it). */
export function deviceSetValid(cid: Uint8Array, mskPublic: Uint8Array, s: DeviceSet): boolean {
  return verify(mskPublic, CTX.devices, signed(cid, s), s.sig);
}

const digest = (s: DeviceSet) => sha256(encode(deviceSetToCbor(s)));

/** Whether `a` wins over `b`: higher `ver`, then the larger hash (§10.5.2). */
export function preferDeviceSet(a: DeviceSet, b: DeviceSet | undefined): boolean {
  if (!b) return true;
  if (a.ver !== b.ver) return a.ver > b.ver;
  return compareBytes(digest(a), digest(b)) > 0;
}

export function sameDeviceSet(a: DeviceSet, b: DeviceSet): boolean {
  return equalBytes(digest(a), digest(b));
}

export function listsDevice(s: DeviceSet, dik: Uint8Array): boolean {
  return s.devices.some((d) => equalBytes(d.dik, dik));
}

/** A device's own label for itself: trimmed, never empty, within the limit. */
export function deviceLabel(label: string): string {
  return label.trim().slice(0, DEVICE_LABEL_MAX) || "Dispositivo";
}
