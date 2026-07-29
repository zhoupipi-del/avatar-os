// Day14C gate: Kokoro Model Load Smoke (env-gated real model load + generate)
// 校验：
//   1. REQUIRED_FILES 存在（smoke.ts / smoke.test.ts / gate.mjs / docs）
//   2. 7 个函数存在于 smoke.ts
//   3. shouldRunKokoroModelSmoke 使用正确的 env var 名（AVATAROS_RUN_KOKORO_MODEL_SMOKE）
//   4. from_pretrained( 和 .generate( 存在于 smoke.ts（Day14C 允许真实模型加载）
//   5. 三个产品文件不 import 新模块（runtime 隔离）
//   6. kokoro-js 字面量仅出现在白名单文件
//   7. 禁用词（仅查本 milestone 新增的 2 个 .ts 文件，gate 互不干扰）
//   8. 新模块不反向 import runtime / 产品组件 / writer / driver
//   9. 四道基础闸门全绿
// 注：Day14C 允许 from_pretrained / generate（这是本阶段的核心目标）；
//     禁用词列表不包含 from_pretrained / generate，但仍禁 AudioContext / node:fs 等。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const AGENT_DIR = resolve(ROOT, "apps/desktop/src/avatar/agent");
const SKINS_DIR = resolve(AGENT_DIR, "..", "skins");

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
function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTs(p));
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}

console.log("[Day14C] Kokoro Model Load Smoke gate");

// 1. REQUIRED_FILES（先 assertFile 防呆）
const SMOKE = resolve(AGENT_DIR, "kokoro-model-smoke.ts");
const SMOKE_TEST = resolve(AGENT_DIR, "kokoro-model-smoke.test.ts");
const GATE = resolve(__dirname, "kokoro-model-smoke-gate.mjs");
const DOCS = resolve(ROOT, "docs/avatar/day14c-kokoro-model-load-smoke.md");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(SMOKE, "kokoro-model-smoke.ts");
assertFile(SMOKE_TEST, "kokoro-model-smoke.test.ts");
assertFile(GATE, "kokoro-model-smoke-gate.mjs");
assertFile(DOCS, "day14c-kokoro-model-load-smoke.md");

// 2. 7 个函数存在于 smoke.ts
assertContent(SMOKE, /function\s+getKokoroModelSmokeConfig/, "getKokoroModelSmokeConfig");
assertContent(SMOKE, /function\s+shouldRunKokoroModelSmoke/, "shouldRunKokoroModelSmoke");
assertContent(SMOKE, /function\s+loadKokoroModuleForSmoke/, "loadKokoroModuleForSmoke");
assertContent(SMOKE, /function\s+inspectKokoroModule/, "inspectKokoroModule");
assertContent(SMOKE, /function\s+runKokoroModelLoadSmoke/, "runKokoroModelLoadSmoke");
assertContent(SMOKE, /function\s+extractKokoroPcmFromUnknownOutput/, "extractKokoroPcmFromUnknownOutput");
assertContent(SMOKE, /function\s+analyzeKokoroPcmSmoke/, "analyzeKokoroPcmSmoke");

// 3. shouldRunKokoroModelSmoke 使用正确的 env var 名
assertContent(SMOKE, /AVATAROS_RUN_KOKORO_MODEL_SMOKE/, "env var name AVATAROS_RUN_KOKORO_MODEL_SMOKE");
assertContent(SMOKE, /modelLoadPolicy\s*:\s*"env-gated-day14c"/, "modelLoadPolicy = env-gated-day14c");

// 4. from_pretrained( 和 .generate( 存在于 smoke.ts（Day14C 允许真实模型加载）
assertContent(SMOKE, /from_pretrained\s*\(/, "from_pretrained( in smoke.ts (Day14C allows model load)");
assertContent(SMOKE, /\.generate\s*\(/, ".generate( in smoke.ts (Day14C allows synthesis)");

// 5. 三个产品文件不 import 新模块（先 assertFile 防呆）
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /kokoro-model-smoke/, `${label} does not import Day14C smoke module`);
}

// 6. kokoro-js 字面量位置限制：apps/desktop/src 下只允许出现在白名单 .ts 文件
const ALLOWED_TS = [
  resolve(AGENT_DIR, "kokoro-provider-spike.ts"),
  resolve(AGENT_DIR, "kokoro-provider-spike.test.ts"),
  resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.ts"),
  resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.test.ts"),
  resolve(AGENT_DIR, "kokoro-install-compatibility.ts"),
  resolve(AGENT_DIR, "kokoro-install-compatibility.test.ts"),
  resolve(AGENT_DIR, "kokoro-model-smoke.ts"),
  resolve(AGENT_DIR, "kokoro-model-smoke.test.ts"),
];
const allTs = walkTs(AGENT_DIR);
let locationHit = false;
for (const f of allTs) {
  if (!existsSync(f)) continue;
  if (readFileSync(f, "utf8").includes("kokoro-js") && !ALLOWED_TS.includes(f)) {
    fail(`"kokoro-js" literal outside allowlist in ${f}`);
    locationHit = true;
  }
}
if (!locationHit) ok("kokoro-js literal only in allowlisted files");

// 7. 禁用词（仅查本 milestone 新增的 2 个 .ts 文件，gate 互不干扰）
//    注：Day14C 允许 from_pretrained / generate，不在此禁用列表中。
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
const NEW_FILES = [SMOKE, SMOKE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day14C sources");

// 8. 新模块不得反向 import runtime / 产品组件 / writer / driver
for (const f of NEW_FILES) {
  assertNoContent(f, /VoidVrmSkin|browser-tts-controller|LipSyncControlOverlay|lip-sync-expression-writer|text-viseme-expression-driver/, `runtime import in ${f}`);
}

// 9. 四道基础闸门
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
  console.log("[Day14C] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day14C] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
