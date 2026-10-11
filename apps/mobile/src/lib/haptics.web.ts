// Web build (dev preview, Storybook, landing): no haptics.

export type Tap = "confirm" | "light";

export function tap(_kind: Tap = "light"): void {}
