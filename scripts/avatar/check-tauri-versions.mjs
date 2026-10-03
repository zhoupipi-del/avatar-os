// Tauri 版本对齐检查：Cargo.lock 里的 crate 与 apps/desktop 已安装的 @tauri-apps/* 必须 major.minor 一致，
// 否则 `tauri build` 会报 "Found version mismatched Tauri packages" 直接拒绝打包。
// 用法：node scripts/avatar/check-tauri-versions.mjs（退出码 1 = 不一致）
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = readFileSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.lock"), "utf8");
const PAIRS = [
  ["tauri", "@tauri-apps/api"],
  ["tauri", "@tauri-apps/cli"],
  ["tauri-plugin-http", "@tauri-apps/plugin-http"],
  ["tauri-plugin-fs", "@tauri-apps/plugin-fs"],
  ["tauri-plugin-sql", "@tauri-apps/plugin-sql"],
  ["tauri-plugin-autostart", "@tauri-apps/plugin-autostart"],
];
const crateVersion = (name) => lock.match(new RegExp(`name = "${name}"\\nversion = "([^"]+)"`))?.[1];
const npmVersion = (name) => {
  const p = resolve(ROOT, "apps/desktop/node_modules", name, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).version : undefined;
};
const mm = (v) => v.split(".").slice(0, 2).join(".");
let bad = 0;
for (const [crate, pkg] of PAIRS) {
  const c = crateVersion(crate);
  const n = npmVersion(pkg);
  if (!c || !n) {
    console.log(`  [skip] ${crate}=${c ?? "-"} / ${pkg}=${n ?? "-"}（一侧未使用）`);
    continue;
  }
  if (mm(c) === mm(n)) console.log(`  [ok] ${crate} ${c} ↔ ${pkg} ${n}`);
  else {
    bad++;
    console.error(`  [FAIL] ${crate} ${c} ↔ ${pkg} ${n}（major.minor 不一致，tauri build 会拒绝）`);
  }
}
if (bad) {
  console.error(`\n修复：以 Cargo.lock 为准，把 apps/desktop/package.json 里对应 @tauri-apps/* 改成同一 minor（用 ~ 锁定），再 pnpm install。`);
  process.exit(1);
}
console.log("\n[tauri-versions] PASS");
