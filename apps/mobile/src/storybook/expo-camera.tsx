// Stand-in for expo-camera in stories: no camera, a grey square where the preview goes.
import { View, type ViewProps } from "react-native";

export function CameraView(props: ViewProps & Record<string, unknown>) {
  return <View testID={props.testID} style={[{ backgroundColor: "#333" }, props.style]} />;
}

export function useCameraPermissions() {
  return [{ granted: true, canAskAgain: true, status: "granted", expires: "never" }, async () => ({ granted: true })] as const;
}
