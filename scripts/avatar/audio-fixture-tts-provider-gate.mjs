// Day13A gate: Audio Fixture TTS Provider + Formant Pipeline (test-closed-loop, no product runtime)
// 校验：新文件存在 / 类与工厂存在 / 串联 Day11A provider + Day11C source + Day12 probe /
//       未接 runtime（三个产品文件不 import 新模块）/ 禁用词（仅查本 milestone 新增文件，gate 互不干扰）/
//       四道基础闸门全绿。
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

console.log("[Day13A] Audio Fixture TTS Provider gate");

// 1. REQUIRED_FILES（先 assertFile 防呆——路径写错时后续检查无效也不能静默跳过）
const PROVIDER = resolve(AGENT_DIR, "audio-fixture-tts-provider.ts");
const PROVIDER_TEST = resolve(AGENT_DIR, "audio-fixture-tts-provider.test.ts");
const PIPELINE = resolve(AGENT_DIR, "audio-fixture-formant-pipeline.ts");
const PIPELINE_TEST = resolve(AGENT_DIR, "audio-fixture-formant-pipeline.test.ts");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(PROVIDER, "audio-fixture-tts-provider.ts");
assertFile(PROVIDER_TEST, "audio-fixture-tts-provider.test.ts");
assertFile(PIPELINE, "audio-fixture-formant-pipeline.ts");
assertFile(PIPELINE_TEST, "audio-fixture-formant-pipeline.test.ts");
assertFile(resolve(__dirname, "audio-fixture-tts-provider-gate.mjs"), "audio-fixture-tts-provider-gate.mjs");

// 2. 类 / 工厂 / 串联断言
assertContent(PROVIDER, /class\s+AudioFixtureTtsProvider/, "AudioFixtureTtsProvider class");
assertContent(PROVIDER, /implements\s+AudioTtsProvider/, "AudioFixtureTtsProvider implements AudioTtsProvider");
assertContent(PROVIDER, /supportsSpectrumSource:\s*true/, "capability supportsSpectrumSource: true");
assertContent(PROVIDER, /CyclingFrequencySpectrumSource/, "provider uses CyclingFrequencySpectrumSource (no real audio)");
assertContent(PROVIDER, /getSpectrumSource\(\)/, "session exposes getSpectrumSource()");
assertContent(PIPELINE, /class\s+AudioFixtureFormantPipeline/, "AudioFixtureFormantPipeline class");
assertContent(PIPELINE, /function\s+createAudioFixtureFormantPipeline/, "createAudioFixtureFormantPipeline factory");
assertContent(PIPELINE, /FormantVisemeRuntimeProbe/, "pipeline uses FormantVisemeRuntimeProbe");
assertContent(PIPELINE, /speakAndAnalyze\(/, "pipeline.speakAndAnalyze()");
assertContent(INDEX, /audio-fixture-tts-provider/, "index.ts exports audio-fixture-tts-provider");
assertContent(INDEX, /audio-fixture-formant-pipeline/, "index.ts exports audio-fixture-formant-pipeline");

// 3. 未引入禁用项（仅查本 milestone 新增的 4 个文件，避免误伤 Day11A/B/C/Day12 既有注释）
const FORBIDDEN = [
  ["new AudioContext", /new\s+AudioContext/],
  ["webkitAudioContext", /webkitAudioContext/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new Audio(", /new\s+Audio\(/],
  ["AudioBufferSourceNode", /AudioBufferSourceNode/],
  ["wlipsync", /wlipsync/],
  ["edge-tts", /edge-tts/],
  ["kokoro", /kokoro/],
  ["piper", /piper/],
  ["expressionManager.setValue", /expressionManager\.setValue/],
  [".setValue(", /\.setValue\s*\(/],
];
const NEW_FILES = [PROVIDER, PROVIDER_TEST, PIPELINE, PIPELINE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day13A sources");

// 4. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
//    VoidVrmSkin 位于 src/avatar/skins/（不是 src/avatar/ 根），路径写错会静默跳过，故先 assertFile。
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /audio-fixture-tts-provider|audio-fixture-formant-pipeline/, `${label} does not import Day13A modules`);
}

// 5. 新模块不得反向 import runtime / 产品组件 / writer / driver
for (const f of NEW_FILES) {
  assertNoContent(f, /VoidVrmSkin|browser-tts-controller|LipSyncControlOverlay|lip-sync-expression-writer|text-viseme-expression-driver/, `runtime import in ${f}`);
}

// 6. 四道基础闸门
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
  console.log("[Day13A] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day13A] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
