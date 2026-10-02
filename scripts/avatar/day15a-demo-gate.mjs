// Day15A gate: Demo Productization Freeze
// 校验：
//   1. REQUIRED_FILES 存在（3 个新模块 + gate.mjs + docs，先 assertFile 防呆）
//   2. demo-runtime 核心 API 存在（useAdvancedDebug / setAdvancedDebug / isAdvancedDebug / subscribeAdvancedDebug）
//   3. DemoStatusBar / DemoModeToggle 已导出
//   4. 新文件不引入音频 / 表情 / kokoro 逻辑（禁用词 + 无 from_pretrained / .generate(）
//   5. 三个产品文件不新增禁用词（红线：仅 UI 可见性改动，不污染 runtime）
//   6. gating 已接线：VoidVrmSkin 引入 useAdvancedDebug 并用 showDebug 门控三块纯 debug；
//      VoiceControlOverlay / LipSyncControlOverlay 接收 showDebug 并门控内部 __debug 块；App 挂载 DemoModeToggle
//   7. 四道基础闸门全绿
// 注：Day15A 仅收口 UI 可见性，不改变音频 / 表情 / 嘴型算法；普通 gate 不触发模型下载。
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DESKTOP_SRC = resolve(ROOT, "apps/desktop/src");
const AGENT_DIR = resolve(DESKTOP_SRC, "avatar/agent");
const SKINS_DIR = resolve(DESKTOP_SRC, "avatar/skins");
const DEMO_DIR = resolve(DESKTOP_SRC, "demo");

let failures = 0;
const ok = (m) => console.log(`  [ok] ${m}`);
const fail = (m) => { failures++; console.error(`  [FAIL] ${m}`); };

function assertFile(p, label) {
  if (existsSync(p)) ok(`${label} exists`);
  else fail(`${label} missing: ${p}`);
}
function assertContent(file, re, label) {
  if (!existsSync(file)) { fail(`${label} (file missing)`); return; }
  if (re.test(readFileSync(file, "utf8"))) ok(label);
  else fail(`${label} not found in ${file}`);
}
function assertNoContent(file, re, label) {
  if (!existsSync(file)) { fail(`${label} (file missing)`); return; }
  if (re.test(readFileSync(file, "utf8"))) fail(`${label}`);
  else ok(`no ${label}`);
}

console.log("[Day15A] Demo Productization gate");

// 1. REQUIRED_FILES（先 assertFile 防呆）
const RUNTIME = resolve(DEMO_DIR, "demo-runtime.ts");
const STATUS_BAR = resolve(DEMO_DIR, "DemoStatusBar.tsx");
const TOGGLE = resolve(DEMO_DIR, "DemoModeToggle.tsx");
const GATE = resolve(__dirname, "day15a-demo-gate.mjs");
const DOCS = resolve(ROOT, "docs/avatar/day15a-demo-productization.md");
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const VOICE_OVERLAY = resolve(AGENT_DIR, "VoiceControlOverlay.tsx");
const LIP_OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
const APP = resolve(DESKTOP_SRC, "App.tsx");
assertFile(RUNTIME, "demo-runtime.ts");
assertFile(STATUS_BAR, "DemoStatusBar.tsx");
assertFile(TOGGLE, "DemoModeToggle.tsx");
assertFile(GATE, "day15a-demo-gate.mjs");
assertFile(DOCS, "day15a-demo-productization.md");
assertFile(VOID_SKIN, "VoidVrmSkin.tsx");
assertFile(VOICE_OVERLAY, "VoiceControlOverlay.tsx");
assertFile(LIP_OVERLAY, "LipSyncControlOverlay.tsx");
assertFile(APP, "App.tsx");

// 2. demo-runtime 核心 API
assertContent(RUNTIME, /export\s+function\s+useAdvancedDebug/, "useAdvancedDebug exported");
assertContent(RUNTIME, /export\s+function\s+setAdvancedDebug/, "setAdvancedDebug exported");
assertContent(RUNTIME, /export\s+function\s+isAdvancedDebug/, "isAdvancedDebug exported");
assertContent(RUNTIME, /export\s+function\s+subscribeAdvancedDebug/, "subscribeAdvancedDebug exported");

// 3. DemoStatusBar / DemoModeToggle 已导出
assertContent(STATUS_BAR, /export\s+function\s+DemoStatusBar/, "DemoStatusBar exported");
assertContent(TOGGLE, /export\s+function\s+DemoModeToggle/, "DemoModeToggle exported");

// 4. 新文件不引入音频 / 表情 / kokoro 逻辑（禁用词 + 无 from_pretrained / .generate(）
const FORBIDDEN = [
  ["new AudioContext", /new\s+AudioContext/],
  ["webkitAudioContext", /webkitAudioContext/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new Audio(", /new\s+Audio\(/],
  ["AudioBufferSourceNode", /AudioBufferSourceNode/],
  ["node:fs", /node:fs/],
  ["node:url", /node:url/],
  ["edge-tts", /edge-tts/],
  ["piper-tts", /piper-tts/],
  ["wlipsync", /wlipsync/],
  ["expressionManager.setValue", /expressionManager\.setValue/],
  [".setValue(", /\.setValue\s*\(/],
];
const NEW_FILES = [RUNTIME, STATUS_BAR, TOGGLE];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day15A sources");
for (const f of NEW_FILES) {
  assertNoContent(f, /from_pretrained\s*\(/, `from_pretrained( in ${f.name} (model load stays in Day14C smoke only)`);
  assertNoContent(f, /\.generate\s*\(/, `.generate( in ${f.name} (synthesis stays in Day14C smoke only)`);
}

// 5. 三个产品文件不新增禁用词（红线：仅 UI 可见性改动）
const PRODUCT_FILES = [VOID_SKIN, VOICE_OVERLAY, LIP_OVERLAY, APP];
for (const file of PRODUCT_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) fail(`forbidden token "${label}" introduced into ${file}`);
  }
}
if (PRODUCT_FILES.every((f) => existsSync(f))) ok("no forbidden tokens in product files");

// 6. gating 已接线
assertContent(VOID_SKIN, /useAdvancedDebug/, "VoidVrmSkin uses useAdvancedDebug");
assertContent(VOID_SKIN, /showDebug\s*&&\s*lipSyncStatus/, "VoidVrmSkin gates lip-sync status");
assertContent(VOID_SKIN, /showDebug\s*&&\s*rhythmStatus/, "VoidVrmSkin gates rhythm status");
assertContent(VOID_SKIN, /showDebug\s*&&\s*textVisemeStatus/, "VoidVrmSkin gates text-viseme status");
assertContent(VOID_SKIN, /showDebug=\{\s*showDebug\s*\}/, "VoidVrmSkin passes showDebug to overlays");
assertContent(VOICE_OVERLAY, /readonly\s+showDebug\?:/, "VoiceControlOverlay accepts showDebug");
assertContent(VOICE_OVERLAY, /\{showDebug\s*&&/, "VoiceControlOverlay gates debug block");
assertContent(LIP_OVERLAY, /readonly\s+showDebug\?:/, "LipSyncControlOverlay accepts showDebug");
assertContent(LIP_OVERLAY, /\{showDebug\s*&&/, "LipSyncControlOverlay gates debug block");
assertContent(APP, /DemoModeToggle/, "App mounts DemoModeToggle");

// 7. 四道基础闸门
const commands = [
  ["tsc --noEmit (desktop)", "pnpm --filter desktop exec tsc --noEmit"],
  ["vite build (desktop)", "pnpm --filter desktop exec vite build"],
  ["vitest (desktop)", "pnpm --filter desktop exec vitest run"],
  ["vitest (root)", "pnpm vitest run"],
];
for (const [label, cmd] of commands) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "ignore" });
    ok(label);
  } catch {
    fail(`${label} failed`);
  }
}

console.log("");
if (failures === 0) {
  console.log("[Day15A] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day15A] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
