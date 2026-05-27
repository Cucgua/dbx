import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  bundle?: { macOS?: { entitlements?: string } };
};

test("macOS bundle disables library validation for DuckDB extensions", () => {
  const entitlementsPath = tauriConfig.bundle?.macOS?.entitlements;

  assert.equal(entitlementsPath, "Entitlements.plist");
  assert.equal(existsSync(`src-tauri/${entitlementsPath}`), true);

  const entitlements = readFileSync(`src-tauri/${entitlementsPath}`, "utf8");
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(entitlements, /<true\/>/);
});
