// Stand-in for src/lib/notifications in Storybook: logs what the phone would show.
import { action } from "storybook/actions";

export const pushSupported = true;

export interface NoticeTarget {
  community: string;
  task?: string;
  event?: string;
}

export type Permission = "granted" | "denied" | "undetermined";

export function configure(_onOpen: (target: NoticeTarget) => void): () => void {
  return () => {};
}

export async function permission(): Promise<Permission> {
  return "undetermined";
}

export async function requestPermission(): Promise<boolean> {
  action("notifications.requestPermission")();
  return true;
}

export async function pushToken(): Promise<string | null> {
  return null;
}

export async function show(title: string, body: string, target: NoticeTarget): Promise<void> {
  action("notifications.show")(title, body, target);
}
