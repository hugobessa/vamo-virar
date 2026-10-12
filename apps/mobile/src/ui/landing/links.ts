// Where the landing page points. Relative paths are pages of the same site.

const REPO = "https://github.com/hugobessa/vamo-virar";

export interface LandingLinks {
  /** App Store page (ascAppId in eas.json). */
  appStore: string;
  /** Google Play page (android.package in app.json). */
  playStore: string;
  source: string;
  docs: string;
  /** How to run a community server, built from docs/hosting-guide.md. */
  serverDocs: string;
  /** Ask for room on the project's own server (apps/portal). */
  requestServer: string;
  /** Built from docs/privacy-policy.md by the landing build. */
  privacy: string;
  /** Built from docs/terms-of-service.md by the landing build. */
  terms: string;
  /** Standards against child sexual abuse and exploitation, from docs/child-safety.md. */
  childSafety: string;
}

export const defaultLinks: LandingLinks = {
  appStore: "https://apps.apple.com/app/id6821252003",
  playStore: "https://play.google.com/store/apps/details?id=me.bessa.vamovirar",
  source: REPO,
  docs: `${REPO}/tree/main/docs`,
  serverDocs: "/servidor/",
  requestServer: "https://acesso.vamovirar.app/",
  privacy: "/privacidade/",
  terms: "/termos/",
  childSafety: "/seguranca-infantil/",
};

/** Docs that the legal pages link to by file name, as they appear on GitHub. */
export const docUrl = (file: string) => `${REPO}/blob/main/docs/${file}`;
