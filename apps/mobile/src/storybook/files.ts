// Stand-in for src/lib/files.ts in Storybook: picking yields a small text file, opening is logged.
import { action } from "storybook/actions";
import type { PickedFile } from "../lib/files";

export type { PickedFile } from "../lib/files";

export async function pickFile(): Promise<PickedFile | null> {
  action("files.pickFile")();
  return { name: "roteiro.txt", mime: "text/plain", bytes: new TextEncoder().encode("Roteiro da panfletagem") };
}

export async function openFile(name: string, mime: string, bytes: Uint8Array): Promise<void> {
  action("files.openFile")(name, mime, bytes.length);
}
