// Small platform pieces for linking devices (protocol.md §10.5).

import { Platform, Share } from "react-native";

/** What this device calls itself in the person's device list, until they rename it. */
export function defaultDeviceLabel(): string {
  if (Platform.OS === "web") return "Navegador";
  if (Platform.OS === "ios") return (Platform as { isPad?: boolean }).isPad ? "iPad" : "iPhone";
  if (Platform.OS === "android") return "Android";
  return "Dispositivo";
}

/**
 * Copies on the web; on a phone, opens the share sheet (to send the link to
 * oneself). Resolves to "copied" or "shared".
 */
export async function copyOrShare(text: string): Promise<"copied" | "shared"> {
  const clip = Platform.OS === "web" ? globalThis.navigator?.clipboard : undefined;
  if (clip) {
    await clip.writeText(text);
    return "copied";
  }
  await Share.share({ message: text });
  return "shared";
}
