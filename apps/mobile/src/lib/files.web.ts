// Web: the browser's file dialog to pick, and a download to open.

import * as DocumentPicker from "expo-document-picker";
import type { PickedFile } from "./files";

export type { PickedFile } from "./files";

export async function pickFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: false, base64: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const file = a.file ?? (await (await fetch(a.uri)).blob());
  return { name: a.name, mime: a.mimeType ?? file.type ?? "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function openFile(name: string, mime: string, bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
