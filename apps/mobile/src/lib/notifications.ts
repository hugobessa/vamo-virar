// System notifications on the phone (protocol.md §14, architecture.md §50).
//
// Two kinds, both built here:
// - Local ones, with content: the app computes "Bia mencionou você · Levar o
//   som" on the phone after a sync and shows it. Nothing leaves the device.
// - Push, without content: the node asks Expo's push service to wake this
//   device ("Você tem novidades"); the app then syncs and shows the above.
//   The token registered on the node identifies this app install, nothing
//   else; the node never sees why it is waking it.
//
// The web build (notifications.web.ts) has neither: there the in-app list
// is all there is.

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const pushSupported = true;

/** Where a tapped notification should take the person. */
export interface NoticeTarget {
  community: string;
  task?: string;
  event?: string;
}

export type Permission = "granted" | "denied" | "undetermined";

const CHANNEL = "default";
let configured = false;

/** Shows notifications while the app is open too, and routes taps. Returns the unsubscribe. */
export function configure(onOpen: (target: NoticeTarget) => void): () => void {
  if (!configured) {
    configured = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync(CHANNEL, { name: "Avisos", importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
    }
  }
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Partial<NoticeTarget> | undefined;
    if (data && typeof data.community === "string") onOpen({ community: data.community, ...(data.task ? { task: data.task } : {}), ...(data.event ? { event: data.event } : {}) });
  });
  return () => sub.remove();
}

export async function permission(): Promise<Permission> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

export async function requestPermission(): Promise<boolean> {
  try {
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * This install's push token, once permission is granted. Null on a simulator,
 * without network, or when the person said no: the app then relies on polling.
 */
export async function pushToken(): Promise<string | null> {
  if ((await permission()) !== "granted") return null;
  try {
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {});
    return data;
  } catch {
    return null;
  }
}

/** A notification with content, built on the phone. */
export async function show(title: string, body: string, target: NoticeTarget): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { ...target } }, trigger: null });
  } catch {
    // Without permission there is nothing to show; the in-app list still has it.
  }
}
