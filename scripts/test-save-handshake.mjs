import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Mocked frontend invocations cannot detect a missing native IPC registration.
const api = readFileSync(new URL("../src/features/update/api.ts", import.meta.url), "utf8");
const command = api.match(/function reportInstallPreparation[\s\S]*?return invoke\("([^"]+)"/)?.[1];
assert.ok(command, "Cannot find the frontend save acknowledgement command");
const native = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const handlers = native.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
assert.ok(
  handlers?.includes(`updater::commands::${command},`),
  "Save acknowledgement is not registered in native IPC",
);
console.log("Frontend save acknowledgement is registered in native IPC");
