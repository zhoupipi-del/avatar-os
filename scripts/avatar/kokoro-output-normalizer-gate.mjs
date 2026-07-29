// Day14D gate: Kokoro Output Normalizer + Access Diagnostics + Normalized Formant Pipeline
// 校验：
//   1. REQUIRED_FILES 存在（6 个新 .ts + gate.mjs + docs，先 assertFile 防呆）
//   2. normalizer 核心 API 存在（NormalizedKokoroPcm / normalizeKokoroAudioOutput / extractSampleRate / extractFloat32Audio）
//   3. diagnostics 核心 API 存在（KokoroAccessFailureKind / classifyKokoroAccessError / getKokoroAccessHint / buildKokoroAccessReport）
//   4. pipeline 核心 API 存在（analyzeNormalizedKokoroOutput）且不触发模型下载（无 from_pretrained / .generate(）
//   5. 三个产品文件不 import 新模块（runtime 隔离，先 assertFile 防呆）
//   6. 禁用词（仅查本 milestone 新增的 6 个 .ts 文件，gate 互不干扰）
//   7. 新模块不反向 import runtime / 产品组件 / writer / driver；index.ts 已导出 3 个新模块
//   8. 四道基础闸门全绿
// 注：Day14D 新模块是纯数据变换/分类，禁止出现 from_pretrained / .generate(（模型加载仅允许留在 Day14C smoke 模块）。
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

console.log("[Day14D] Kokoro Output Normalizer gate");

// 1. REQUIRED_FILES（先 assertFile 防呆）
const NORMALIZER = resolve(AGENT_DIR, "kokoro-output-normalizer.ts");
const NORMALIZER_TEST = resolve(AGENT_DIR, "kokoro-output-normalizer.test.ts");
const DIAG = resolve(AGENT_DIR, "kokoro-access-diagnostics.ts");
const DIAG_TEST = resolve(AGENT_DIR, "kokoro-access-diagnostics.test.ts");
const PIPELINE = resolve(AGENT_DIR, "kokoro-normalized-formant-pipeline.ts");
const PIPELINE_TEST = resolve(AGENT_DIR, "kokoro-normalized-formant-pipeline.test.ts");
const GATE = resolve(__dirname, "kokoro-output-normalizer-gate.mjs");
const DOCS = resolve(ROOT, "docs/avatar/day14d-kokoro-output-normalizer.md");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(NORMALIZER, "kokoro-output-normalizer.ts");
assertFile(NORMALIZER_TEST, "kokoro-output-normalizer.test.ts");
assertFile(DIAG, "kokoro-access-diagnostics.ts");
assertFile(DIAG_TEST, "kokoro-access-diagnostics.test.ts");
assertFile(PIPELINE, "kokoro-normalized-formant-pipeline.ts");
assertFile(PIPELINE_TEST, "kokoro-normalized-formant-pipeline.test.ts");
assertFile(GATE, "kokoro-output-normalizer-gate.mjs");
assertFile(DOCS, "day14d-kokoro-output-normalizer.md");
assertFile(INDEX, "agent index.ts");

// 2. normalizer 核心 API
assertContent(NORMALIZER, /interface\s+NormalizedKokoroPcm/, "NormalizedKokoroPcm interface");
assertContent(NORMALIZER, /function\s+normalizeKokoroAudioOutput/, "normalizeKokoroAudioOutput");
assertContent(NORMALIZER, /function\s+extractSampleRate/, "extractSampleRate");
assertContent(NORMALIZER, /function\s+extractFloat32Audio/, "extractFloat32Audio");

// 3. diagnostics 核心 API
assertContent(DIAG, /type\s+KokoroAccessFailureKind/, "KokoroAccessFailureKind type");
assertContent(DIAG, /"proxy-auth-required"/, "proxy-auth-required kind");
assertContent(DIAG, /"hf-unauthorized"/, "hf-unauthorized kind");
assertContent(DIAG, /"network-unreachable"/, "network-unreachable kind");
assertContent(DIAG, /function\s+classifyKokoroAccessError/, "classifyKokoroAccessError");
assertContent(DIAG, /function\s+getKokoroAccessHint/, "getKokoroAccessHint");
assertContent(DIAG, /function\s+buildKokoroAccessReport/, "buildKokoroAccessReport");

// 4. pipeline 核心 API + 不触发模型下载（Day14D 新模块禁 from_pretrained / .generate(）
assertContent(PIPELINE, /function\s+analyzeNormalizedKokoroOutput/, "analyzeNormalizedKokoroOutput");
for (const [f, label] of [
  [NORMALIZER, "normalizer"],
  [DIAG, "diagnostics"],
  [PIPELINE, "pipeline"],
]) {
  assertNoContent(f, /from_pretrained\s*\(/, `from_pretrained( in ${label} (model load stays in Day14C smoke only)`);
  assertNoContent(f, /\.generate\s*\(/, `.generate( in ${label} (synthesis stays in Day14C smoke only)`);
}

// 5. 三个产品文件不 import 新模块（先 assertFile 防呆）
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /kokoro-output-normalizer|kokoro-access-diagnostics|kokoro-normalized-formant-pipeline/, `${label} does not import Day14D modules`);
}

// 6. 禁用词（仅查本 milestone 新增的 6 个 .ts 文件，gate 互不干扰）
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
const NEW_FILES = [NORMALIZER, NORMALIZER_TEST, DIAG, DIAG_TEST, PIPELINE, PIPELINE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day14D sources");

// 7. 新模块不反向 import runtime / 产品组件 / writer / driver；index.ts 已导出 3 个新模块
for (const f of NEW_FILES) {
  assertNoContent(f, /VoidVrmSkin|browser-tts-controller|LipSyncControlOverlay|lip-sync-expression-writer|text-viseme-expression-driver/, `runtime import in ${f}`);
}
assertContent(INDEX, /export \* from "\.\/kokoro-output-normalizer"/, "index exports kokoro-output-normalizer");
assertContent(INDEX, /export \* from "\.\/kokoro-access-diagnostics"/, "index exports kokoro-access-diagnostics");
assertContent(INDEX, /export \* from "\.\/kokoro-normalized-formant-pipeline"/, "index exports kokoro-normalized-formant-pipeline");

// 8. 四道基础闸门
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
  console.log("[Day14D] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day14D] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
