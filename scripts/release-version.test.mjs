// node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { APPS, checkTag, getVersion, nextVersion, setVersion } from "./release-version.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

/** A scratch copy of just the version files. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "vv-release-"));
  for (const f of Object.values(APPS).flatMap((a) => a.files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    cpSync(join(repo, f), join(dir, f));
  }
  return dir;
}

test("next versions", () => {
  assert.equal(nextVersion("0.5.0", "patch"), "0.5.1");
  assert.equal(nextVersion("0.5.3", "minor"), "0.6.0");
  assert.equal(nextVersion("1.4.2", "major"), "2.0.0");
  assert.equal(nextVersion("1.1.0-rc.1", "patch"), "1.1.0");
  assert.throws(() => nextVersion("1.0.0", "huge"));
});

test("set writes every file and get reads it back", () => {
  const dir = scratch();
  for (const name of Object.keys(APPS)) {
    setVersion(name, "7.8.9", dir);
    assert.equal(getVersion(name, dir), "7.8.9");
  }
  assert.match(readFileSync(join(dir, "Cargo.lock"), "utf8"), /name = "community-node"\nversion = "7\.8\.9"/);
  assert.equal(JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages["apps/portal"].version, "7.8.9");
  // Only the app's own entries change.
  assert.doesNotMatch(readFileSync(join(dir, "Cargo.lock"), "utf8"), /name = "vv-crypto"\nversion = "7\.8\.9"/);
  assert.notEqual(JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages["apps/mobile"].version, "7.8.9");
  assert.throws(() => setVersion("mobile", "1.0", dir), /not a semver/);
});

test("tags must name an app and match its version file", () => {
  const dir = scratch();
  setVersion("mobile", "1.2.0", dir);
  setVersion("node", "0.6.0-rc.1", dir);
  assert.deepEqual(checkTag("mobile-v1.2.0", dir), { app: "mobile", version: "1.2.0", prerelease: false });
  assert.deepEqual(checkTag("node-v0.6.0-rc.1", dir), { app: "node", version: "0.6.0-rc.1", prerelease: true });
  assert.throws(() => checkTag("mobile-v1.3.0", dir), /does not match apps\/mobile\/app\.json, which says 1\.2\.0/);
  assert.throws(() => checkTag("v0.6.0", dir), /not a release tag/);
  assert.throws(() => checkTag("web-v1.0.0", dir), /not a release tag/);
});
