// Web build (dev preview, Storybook, landing): no system notifications and
// no push; the in-app list is all there is. Keeps expo-notifications out of
// the web bundle.

export const pushSupported = false;

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
  return "denied";
}

export async function requestPermission(): Promise<boolean> {
  return false;
}

export async function pushToken(): Promise<string | null> {
  return null;
}

export async function show(_title: string, _body: string, _target: NoticeTarget): Promise<void> {}
