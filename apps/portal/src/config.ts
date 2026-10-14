// Configuration from the environment (see apps/portal/README.md).

import { randomBytes } from "node:crypto";

export interface Limits {
  /** Communities one code may create; null means no limit. */
  maxCommunities: number | null;
  /** Log bytes per community (the node's `max_log_bytes`). */
  maxLogBytes: number;
  /** Attachment bytes per community (the node's `max_blob_bytes_total`). */
  maxBlobBytes: number;
}

export interface PortalConfig {
  /** Where this portal is reached, for links in emails. No trailing slash. */
  publicUrl: string;
  /** The node address people type in the app. Usually the same as publicUrl. */
  nodeUrl: string;
  /** The node's private operator API, e.g. http://node:9787. */
  operatorUrl: string;
  operatorToken: string;
  /** Who approves requests; gets an email for each new one. */
  adminEmail: string;
  adminPassword: string;
  /** Signs the admin session cookie. Random per start when unset. */
  sessionSecret: Buffer;
  mailFrom: string;
  /** smtp:// or smtps:// URL. Unset (and no Mailgun): emails are printed to the log (development only). */
  smtpUrl: string | undefined;
  /** Mailgun's HTTP API instead of SMTP, for hosts that block outbound SMTP. */
  mailgun: { apiKey: string; domain: string; apiUrl: string } | undefined;
  dataDir: string;
  host: string;
  port: number;
  /** Behind a proxy that sets X-Forwarded-For to the client address. */
  trustProxy: boolean;
  defaults: Limits;
  links: { appStore: string; playStore: string; terms: string; privacy: string; guide: string };
}

const MiB = 1024 * 1024;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is required`);
  return v;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a whole number`);
  return n;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PortalConfig {
  const publicUrl = trimSlash(required(env, "PORTAL_PUBLIC_URL"));
  const adminPassword = required(env, "PORTAL_ADMIN_PASSWORD");
  if (adminPassword.length < 12) throw new Error("PORTAL_ADMIN_PASSWORD must have at least 12 characters");
  const secret = env.PORTAL_SESSION_SECRET?.trim();
  if (secret && secret.length < 32) throw new Error("PORTAL_SESSION_SECRET must have at least 32 characters");
  return {
    publicUrl,
    nodeUrl: trimSlash(env.PORTAL_NODE_URL?.trim() || publicUrl),
    operatorUrl: trimSlash(env.PORTAL_OPERATOR_URL?.trim() || "http://node:9787"),
    operatorToken: required(env, "VV_OPERATOR_TOKEN"),
    adminEmail: required(env, "PORTAL_ADMIN_EMAIL"),
    adminPassword,
    sessionSecret: secret ? Buffer.from(secret) : randomBytes(32),
    mailFrom: required(env, "PORTAL_MAIL_FROM"),
    smtpUrl: env.PORTAL_SMTP_URL?.trim() || undefined,
    mailgun: env.PORTAL_MAILGUN_API_KEY?.trim()
      ? {
          apiKey: env.PORTAL_MAILGUN_API_KEY.trim(),
          domain: required(env, "PORTAL_MAILGUN_DOMAIN"),
          apiUrl: trimSlash(env.PORTAL_MAILGUN_API_URL?.trim() || "https://api.mailgun.net"),
        }
      : undefined,
    dataDir: env.PORTAL_DATA_DIR?.trim() || "./data",
    host: env.PORTAL_HOST?.trim() || "0.0.0.0",
    port: int(env, "PORTAL_PORT", 3000),
    trustProxy: ["1", "true", "yes"].includes(env.PORTAL_TRUST_PROXY?.trim() ?? ""),
    defaults: {
      maxCommunities: env.PORTAL_DEFAULT_MAX_COMMUNITIES?.trim() ? int(env, "PORTAL_DEFAULT_MAX_COMMUNITIES", 0) || null : null,
      maxLogBytes: int(env, "PORTAL_DEFAULT_MAX_LOG_MB", 256) * MiB,
      maxBlobBytes: int(env, "PORTAL_DEFAULT_MAX_FILES_MB", 512) * MiB,
    },
    links: {
      appStore: "https://apps.apple.com/app/id6821252003",
      playStore: "https://play.google.com/store/apps/details?id=me.bessa.vamovirar",
      terms: "https://vamovirar.app/termos/",
      privacy: "https://vamovirar.app/privacidade/",
      guide: "https://vamovirar.app/servidor/",
    },
  };
}
