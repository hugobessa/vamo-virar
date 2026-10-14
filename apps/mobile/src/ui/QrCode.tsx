// A QR code drawn with plain views, so it works the same on phones and the
// web without an SVG or canvas module. Dark modules on a white field with
// the 4-module quiet zone scanners expect, whatever the app's theme.

import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { View } from "react-native";

export function QrCode({ value, size = 260, testID }: { value: string; size?: number; testID?: string }) {
  const { count, runs } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    // One view per horizontal run of dark modules, not per module.
    const out: { row: number; col: number; len: number }[] = [];
    for (let row = 0; row < n; row++) {
      let col = 0;
      while (col < n) {
        if (!qr.isDark(row, col)) {
          col++;
          continue;
        }
        const start = col;
        while (col < n && qr.isDark(row, col)) col++;
        out.push({ row, col: start, len: col - start });
      }
    }
    return { count: n, runs: out };
  }, [value]);
  const cell = Math.max(1, Math.floor(size / (count + 8)));
  const side = cell * (count + 8);
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="QR code"
      style={{ width: side, height: side, backgroundColor: "#FFFFFF", borderRadius: 8, alignSelf: "center" }}
    >
      {runs.map((r) => (
        <View
          key={`${r.row}:${r.col}`}
          style={{ position: "absolute", left: (r.col + 4) * cell, top: (r.row + 4) * cell, width: r.len * cell, height: cell, backgroundColor: "#000000" }}
        />
      ))}
    </View>
  );
}
