#!/usr/bin/env node
// Versions and release tags for each app. Each app releases on its own tag,
// `<app>-v<semver>`, and its version lives in one file that the tag must match:
//
//   node    node-v0.6.0     apps/node/Cargo.toml (+ its Cargo.lock entry)
//   portal  portal-v0.6.0   apps/portal/package.json (+ its package-lock.json entry)
//   mobile  mobile-v1.1.0   apps/mobile/app.json (expo.version, shown in the stores)
//
// Usage:
//   node scripts/release-version.mjs get <app>
//   node scripts/release-version.mjs next <app> <patch|minor|major>
//   node scripts/release-version.mjs set <app> <version>
//   node scripts/release-version.mjs check-tag <tag>
//
// `check-tag` fails unless the tag names a known app and equals the version
// in that app's file; it prints app=, version= and prerelease= lines (also
// appended to $GITHUB_OUTPUT when set) for release.yml.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

export const APPS = {
  node: {
    files: ["apps/node/Cargo.toml", "Cargo.lock"],
    read: (root) => cargoVersion(read(root, "apps/node/Cargo.toml")),
    write(root, v) {
      edit(root, "apps/node/Cargo.toml", (s) => s.replace(/^(\[package\][^[]*?\nversion = ")[^"]*(")/m, `$1${v}$2`));
      edit(root, "Cargo.lock", (s) => s.replace(/(\[\[package\]\]\nname = "community-node"\nversion = ")[^"]*(")/, `$1${v}$2`));
    },
  },
  portal: {
    files: ["apps/portal/package.json", "package-lock.json"],
    read: (root) => JSON.parse(read(root, "apps/portal/package.json")).version,
    write(root, v) {
      editJson(root, "apps/portal/package.json", (j) => (j.version = v));
      editJson(root, "package-lock.json", (j) => (j.packages["apps/portal"].version = v));
    },
  },
  mobile: {
    files: ["apps/mobile/app.json"],
    read: (root) => JSON.parse(read(root, "apps/mobile/app.json")).expo.version,
    write(root, v) {
      editJson(root, "apps/mobile/app.json", (j) => (j.expo.version = v));
    },
  },
};

const read = (root, f) => readFileSync(join(root, f), "utf8");
function edit(root, f, change) {
  const before = read(root, f);
  const after = change(before);
  if (after === before) throw new Error(`${f}: version not found or already set`);
  writeFileSync(join(root, f), after);
}
function editJson(root, f, change) {
  const j = JSON.parse(read(root, f));
  change(j);
  writeFileSync(join(root, f), JSON.stringify(j, null, 2) + "\n");
}
function cargoVersion(toml) {
  const m = toml.match(/^\[package\][^[]*?\nversion = "([^"]*)"/m);
  if (!m) throw new Error("apps/node/Cargo.toml: no [package] version");
  return m[1];
}

function app(name) {
  const a = APPS[name];
  if (!a) throw new Error(`unknown app "${name}" (one of: ${Object.keys(APPS).join(", ")})`);
  return a;
}

export function getVersion(name, root) {
  return app(name).read(root);
}

/** The next release version. A pre-release goes to its own release version. */
export function nextVersion(current, level) {
  const m = current.match(SEMVER);
  if (!m) throw new Error(`"${current}" is not a semver version`);
  let [major, minor, patch] = m.slice(1, 4).map(Number);
  if (m[4]) return `${major}.${minor}.${patch}`;
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`level must be patch, minor or major, not "${level}"`);
}

export function setVersion(name, version, root) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a semver version`);
  app(name).write(root, version);
}

/** Parses `<app>-v<semver>` and checks it against the app's version file. */
export function checkTag(tag, root) {
  const m = tag.match(/^([a-z]+)-v(.+)$/);
  if (!m || !APPS[m[1]] || !SEMVER.test(m[2])) {
    throw new Error(`"${tag}" is not a release tag: expected <app>-v<semver> with app one of ${Object.keys(APPS).join(", ")}`);
  }
  const [, name, version] = m;
  const inFile = getVersion(name, root);
  if (inFile !== version) {
    throw new Error(`${tag} does not match ${APPS[name].files[0]}, which says ${inFile}: bump the version first (see .claude/skills/release)`);
  }
  return { app: name, version, prerelease: version.includes("-") };
}

function main(argv) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const [cmd, ...args] = argv;
  if (cmd === "get") return console.log(getVersion(args[0], root));
  if (cmd === "next") return console.log(nextVersion(getVersion(args[0], root), args[1]));
  if (cmd === "set") {
    setVersion(args[0], args[1], root);
    return console.log(`${args[0]}: ${args[1]} (${app(args[0]).files.join(", ")})`);
  }
  if (cmd === "check-tag") {
    const r = checkTag(args[0], root);
    const lines = `app=${r.app}\nversion=${r.version}\nprerelease=${r.prerelease}\n`;
    process.stdout.write(lines);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
    return;
  }
  throw new Error("usage: release-version.mjs get|next|set|check-tag ...");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
