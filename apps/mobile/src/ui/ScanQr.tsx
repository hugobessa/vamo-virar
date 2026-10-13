// Camera view that reads one QR code and hands back its text. Only the
// camera preview is mounted while scanning (expo-camera allows one at a time).

import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useApp } from "../lib/context";
import { Banner, Button } from "./kit";
import { space } from "./theme";

export function ScanQr({ onScan, onClose, accept }: { onScan: (text: string) => void; onClose: () => void; accept: (text: string) => boolean }) {
  const { t } = useApp();
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void request();
  }, [permission, request]);

  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <View style={{ gap: space.s }}>
        <Banner tone="warn" text={t("linkCameraDenied")} />
        <Button kind="secondary" label={t("linkScanClose")} onPress={onClose} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      {permission?.granted ? (
        <View style={{ width: "100%", aspectRatio: 1, maxWidth: 360, alignSelf: "center", borderRadius: 12, overflow: "hidden" }}>
          <CameraView
            testID="qr-camera"
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(r) => {
              // Other QR codes (a WhatsApp group, a site) are ignored, not errors.
              if (done.current || !accept(r.data)) return;
              done.current = true;
              onScan(r.data);
            }}
          />
        </View>
      ) : null}
      <Button kind="secondary" label={t("linkScanClose")} onPress={onClose} />
    </View>
  );
}
