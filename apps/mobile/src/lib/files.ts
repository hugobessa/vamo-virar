// Picking a file to attach and opening one that was downloaded, on iOS and
// Android. The web version (files.web.ts) uses the browser's own dialogs.
// Bytes only pass through here; sealing and uploading happen in the replica.

import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export interface PickedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** Opens the system file picker. Null when the person cancels. */
export async function pickFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const bytes = await new File(a.uri).bytes();
  return { name: a.name, mime: a.mimeType ?? "application/octet-stream", bytes };
}

/**
 * Writes the bytes to the cache and hands them to the system share sheet,
 * which also opens them. The clear-text copy lives only as long as the sheet
 * (security.md, "Chaves nos dispositivos").
 */
export async function openFile(name: string, mime: string, bytes: Uint8Array): Promise<void> {
  const f = new File(Paths.cache, name.replace(/[/\\]/g, "_"));
  f.create({ overwrite: true, intermediates: true });
  f.write(bytes);
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: name });
  } finally {
    try {
      f.delete();
    } catch {
      // The receiving app may still hold it; the system clears the cache anyway.
    }
  }
}
