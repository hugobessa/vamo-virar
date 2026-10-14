// OAuth redirect URIs per provider and platform. Google's native client types
// reject an app-chosen scheme like vamovirar://: an iOS client only redirects
// to its reversed client ID, an Android client to the package name (with
// "Custom URI scheme" enabled on the client). Both schemes must also be listed
// in app.json (ios.scheme / android.scheme) so the redirect reaches the app.

export const APP_SCHEME = "vamovirar";
export const ANDROID_PACKAGE = "me.bessa.vamovirar";

const GOOGLE_SUFFIX = ".apps.googleusercontent.com";

/** "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc". */
export function reversedGoogleClientId(clientId: string): string {
  return `com.googleusercontent.apps.${clientId.endsWith(GOOGLE_SUFFIX) ? clientId.slice(0, -GOOGLE_SUFFIX.length) : clientId}`;
}

/**
 * The redirect URI for a native platform, or null on web, where the caller
 * derives one from the page origin. Microsoft takes vamovirar://oauth, as
 * registered in Entra ID (docs/calendars.md).
 */
export function nativeRedirectUri(source: "google" | "microsoft", os: string, clientId: string): string | null {
  if (os !== "ios" && os !== "android") return null;
  if (source === "microsoft") return `${APP_SCHEME}://oauth`;
  return os === "ios" ? `${reversedGoogleClientId(clientId)}:/oauth2redirect` : `${ANDROID_PACKAGE}:/oauth2redirect`;
}
