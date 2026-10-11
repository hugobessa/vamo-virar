// A short tap when someone confirms or approves. Native only: the web
// version (haptics.web.ts) is a no-op, so the landing page and Storybook
// never load expo-haptics.

import * as Haptics from "expo-haptics";

export type Tap = "confirm" | "light";

export function tap(kind: Tap = "light"): void {
  const p = kind === "confirm" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  p.catch(() => {});
}
