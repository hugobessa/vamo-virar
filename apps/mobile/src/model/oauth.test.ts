import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANDROID_PACKAGE, APP_SCHEME, nativeRedirectUri, reversedGoogleClientId } from "./oauth";

const { expo } = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8"));
const schemes = (s: string | string[] | undefined) => [expo.scheme, s].flat().filter(Boolean);

describe("OAuth redirects", () => {
  it("reverses a Google client ID", () => {
    expect(reversedGoogleClientId("123-abc.apps.googleusercontent.com")).toBe("com.googleusercontent.apps.123-abc");
  });

  it("uses Google's native redirect forms and keeps vamovirar://oauth for Microsoft", () => {
    expect(nativeRedirectUri("google", "ios", "123-abc.apps.googleusercontent.com")).toBe("com.googleusercontent.apps.123-abc:/oauth2redirect");
    expect(nativeRedirectUri("google", "android", "x")).toBe("me.bessa.vamovirar:/oauth2redirect");
    expect(nativeRedirectUri("microsoft", "ios", "x")).toBe("vamovirar://oauth");
    expect(nativeRedirectUri("google", "web", "x")).toBeNull();
  });

  it("registers every redirect scheme in app.json", () => {
    expect(expo.scheme).toBe(APP_SCHEME);
    expect(expo.android.package).toBe(ANDROID_PACKAGE);
    expect(schemes(expo.android.scheme)).toContain(ANDROID_PACKAGE);
    if (expo.extra.googleClientIdIos) expect(schemes(expo.ios.scheme)).toContain(reversedGoogleClientId(expo.extra.googleClientIdIos));
  });
});
