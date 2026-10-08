import { useColorScheme } from "react-native";

const light = {
  bg: "#FFFFFF",
  surface: "#F4F4F6",
  text: "#16161A",
  muted: "#5C5C66",
  border: "#DADAE0",
  primary: "#B3261E",
  primaryText: "#FFFFFF",
  ok: "#1E6B3A",
  warn: "#8A5A00",
  danger: "#9B1C1C",
  chip: "#ECE7F5",
};

const dark: typeof light = {
  bg: "#111114",
  surface: "#1D1D22",
  text: "#F2F2F5",
  muted: "#A3A3AE",
  border: "#33333B",
  primary: "#F2726B",
  primaryText: "#1A0A09",
  ok: "#6FD394",
  warn: "#F0C062",
  danger: "#FF8A80",
  chip: "#2B2638",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
export const radius = 12;
/** Minimum touch target (accessibility). */
export const touch = 48;
