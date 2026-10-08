#!/usr/bin/env node
// Phase 10 guard (architecture.md §52): the node protocol must not depend on
// AWS, GCP, Azure, Cloudflare, Supabase or Firebase. A managed host runs the
// same community-node binary as anyone else.
//
// Checks, failing CI on any hit:
//   1. no cloud-vendor SDK anywhere in Cargo.lock or package-lock.json;
//   2. no vendor hostnames or SDK imports in the node, the protocol packages
//      or the deployment files. (The mobile app's optional calendar adapters
//      talk to Google and Microsoft calendar APIs on the person's behalf; that
//      is device-side, opt-in, and not part of the node protocol.)
//
// Usage: node scripts/check-vendor-independence.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const VENDOR_PACKAGE =
  /^(@aws-sdk\/|aws-sdk$|aws-(config|sdk|types|smithy|credential)|@google-cloud\/|google-cloud|gcp[-_]|@azure\/|azure[-_]|@cloudflare\/|cloudflare|wrangler$|@supabase\/|supabase|firebase|@firebase\/|@react-native-firebase\/)/i;

const VENDOR_TEXT =
  /amazonaws\.com|googleapis\.com|cloudfunctions\.net|azure\.com|azurewebsites\.net|windows\.net|workers\.dev|cloudflare|supabase|firebase|@aws-sdk|aws_sdk|google_cloud|@google-cloud|@azure\//i;

// Code that is part of, or deploys, the node protocol.
const PROTOCOL_PATHS = ["apps/node", "crates", "packages/protocol", "packages/crypto", "packages/domain", "packages/sync", "deploy"];
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "dist-web", ".expo"]);
const TEXT_EXT = /\.(rs|toml|ts|tsx|mjs|js|json|yml|yaml|Dockerfile|service|conf)$|Dockerfile$|Caddyfile$/;

const problems = [];

// 1. Lockfiles.
const cargoLock = readFileSync(join(root, "Cargo.lock"), "utf8");
for (const m of cargoLock.matchAll(/^name = "([^"]+)"/gm)) {
  if (VENDOR_PACKAGE.test(m[1])) problems.push(`Cargo.lock: crate ${m[1]}`);
}
const npmLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
for (const path of Object.keys(npmLock.packages ?? {})) {
  const name = path.split("node_modules/").pop();
  if (name && VENDOR_PACKAGE.test(name)) problems.push(`package-lock.json: ${name} (${path})`);
}

// 2. Protocol and node sources.
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT_EXT.test(entry)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (VENDOR_TEXT.test(line)) problems.push(`${relative(root, p)}:${i + 1}: ${line.trim()}`);
        });
    }
  }
}
for (const p of PROTOCOL_PATHS) walk(join(root, p));

if (problems.length) {
  console.error("Vendor dependencies found where the node protocol must stay provider-independent:\n");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("vendor independence: ok (no cloud-vendor SDKs; node and protocol code reference no vendor services)");
