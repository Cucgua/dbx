import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";
import { shouldOpenUpdateDialog } from "../../apps/desktop/src/composables/useAppUpdater.ts";

test("silent update checks do not auto-open the dialog when an update is available", () => {
  assert.equal(
    shouldOpenUpdateDialog({
      silent: true,
    }),
    false,
  );
});

test("toolbar update button can show a red update badge", () => {
  const source = readFileSync("apps/desktop/src/components/layout/AppToolbar.vue", "utf8");

  assert.match(source, /hasUpdateAvailable/);
  assert.match(source, /v-if="hasUpdateAvailable"/);
  assert.match(source, /bg-red-500/);
});

test("app schedules hourly silent update checks and clears the timer", () => {
  const source = readFileSync("apps/desktop/src/App.vue", "utf8");

  assert.match(source, /UPDATE_CHECK_INTERVAL_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /setInterval\(\(\)\s*=>\s*{[\s\S]*checkUpdates\(\{\s*silent:\s*true\s*}\)/);
  assert.match(source, /clearInterval\(updateCheckTimer\)/);
});

test("app passes update availability to the toolbar badge", () => {
  const source = readFileSync("apps/desktop/src/App.vue", "utf8");

  assert.match(source, /:has-update-available="hasUpdateAvailable"/);
});

test("updater download passes system proxy to tauri updater check", () => {
  const source = readFileSync("apps/desktop/src/composables/useAppUpdater.ts", "utf8");

  assert.match(source, /getSystemProxyUrl/);
  assert.match(source, /check\(proxy \? \{ proxy } : undefined\)/);
});

test("driver manager entry can show an update count badge", () => {
  const toolbarSource = readFileSync("apps/desktop/src/components/layout/AppToolbar.vue", "utf8");
  const tabSource = readFileSync("apps/desktop/src/components/layout/AppTabBar.vue", "utf8");
  const appSource = readFileSync("apps/desktop/src/App.vue", "utf8");

  assert.match(toolbarSource, /agentDriverUpdateCount/);
  assert.match(toolbarSource, /v-if="agentDriverUpdateCount > 0"/);
  assert.match(tabSource, /agentDriverUpdateCount/);
  assert.match(appSource, /:agent-driver-update-count="agentDriverUpdateCount"/);
});
