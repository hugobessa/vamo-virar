import { Alert, Platform } from "react-native";

/** Yes/no confirmation that works on native and web. */
export function confirm(message: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(message) ?? true);
  return new Promise((resolve) =>
    Alert.alert("", message, [
      { text: no, style: "cancel", onPress: () => resolve(false) },
      { text: yes, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}
