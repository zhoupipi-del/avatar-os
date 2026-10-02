// Day13C gate: Local PCM Fixture Provider + Formant Pipeline (synthetic PCM -> FFT -> formant, no product runtime)
// 校验：新文件存在 / 类与工厂存在 / 串联 Day11A provider + Day13C PCM source + Day11C probe /
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

console.log("[Day13C] Local PCM Fixture Provider gate");

// 1. REQUIRED_FILES（先 assertFile 防呆——路径写错时后续检查无效也不能静默跳过）
const PCM_SOURCE = resolve(AGENT_DIR, "pcm-spectrum-source.ts");
const PCM_SOURCE_TEST = resolve(AGENT_DIR, "pcm-spectrum-source.test.ts");
const PROVIDER = resolve(AGENT_DIR, "local-pcm-fixture-tts-provider.ts");
const PROVIDER_TEST = resolve(AGENT_DIR, "local-pcm-fixture-tts-provider.test.ts");
const PIPELINE = resolve(AGENT_DIR, "local-pcm-formant-pipeline.ts");
const PIPELINE_TEST = resolve(AGENT_DIR, "local-pcm-formant-pipeline.test.ts");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(PCM_SOURCE, "pcm-spectrum-source.ts");
assertFile(PCM_SOURCE_TEST, "pcm-spectrum-source.test.ts");
assertFile(PROVIDER, "local-pcm-fixture-tts-provider.ts");
assertFile(PROVIDER_TEST, "local-pcm-fixture-tts-provider.test.ts");
assertFile(PIPELINE, "local-pcm-formant-pipeline.ts");
assertFile(PIPELINE_TEST, "local-pcm-formant-pipeline.test.ts");
assertFile(resolve(__dirname, "local-pcm-fixture-provider-gate.mjs"), "local-pcm-fixture-provider-gate.mjs");

// 2. 类 / 工厂 / 串联断言
assertContent(PCM_SOURCE, /class\s+PcmSpectrumSource/, "PcmSpectrumSource class");
assertContent(PCM_SOURCE, /implements\s+AudioSpectrumSource/, "PcmSpectrumSource implements AudioSpectrumSource");
assertContent(PCM_SOURCE, /function\s+buildSyntheticVowelPcm/, "buildSyntheticVowelPcm function");
assertContent(PCM_SOURCE, /function\s+fftRadix2/, "fftRadix2 (pure TS FFT, no browser audio)");
assertContent(PROVIDER, /class\s+LocalPcmFixtureTtsProvider/, "LocalPcmFixtureTtsProvider class");
assertContent(PROVIDER, /implements\s+AudioTtsProvider/, "LocalPcmFixtureTtsProvider implements AudioTtsProvider");
assertContent(PROVIDER, /supportsPcm:\s*true/, "capability supportsPcm: true");
assertContent(PROVIDER, /supportsSpectrumSource:\s*true/, "capability supportsSpectrumSource: true");
assertContent(PROVIDER, /PcmSpectrumSource/, "provider uses PcmSpectrumSource (PCM -> FFT, no real audio)");
assertContent(PROVIDER, /getSpectrumSource\(\)/, "session exposes getSpectrumSource()");
assertContent(PROVIDER, /getPcm\(\)/, "session exposes getPcm()");
assertContent(PIPELINE, /class\s+LocalPcmFormantPipeline/, "LocalPcmFormantPipeline class");
assertContent(PIPELINE, /function\s+createLocalPcmFormantPipeline/, "createLocalPcmFormantPipeline factory");
assertContent(PIPELINE, /FormantVisemeRuntimeProbe/, "pipeline uses FormantVisemeRuntimeProbe");
assertContent(PIPELINE, /speakAndAnalyze\(/, "pipeline.speakAndAnalyze()");
assertContent(INDEX, /pcm-spectrum-source/, "index.ts exports pcm-spectrum-source");
assertContent(INDEX, /local-pcm-fixture-tts-provider/, "index.ts exports local-pcm-fixture-tts-provider");
assertContent(INDEX, /local-pcm-formant-pipeline/, "index.ts exports local-pcm-formant-pipeline");

// 3. 未引入禁用项（仅查本 milestone 新增的 6 个文件，避免误伤 Day11/Day12/Day13A/B 既有注释）
const FORBIDDEN = [
  ["new AudioContext", /new\s+AudioContext/],
  ["webkitAudioContext", /webkitAudioContext/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new Audio(", /new\s+Audio\(/],
  ["AudioBufferSourceNode", /AudioBufferSourceNode/],
  ["node:fs", /node:fs/],
  ["node:url", /node:url/],
  ["edge-tts", /edge-tts/],
  ["kokoro-js", /kokoro-js/],
  ["kokoro", /kokoro/],
  ["piper-tts", /piper-tts/],
  ["piper", /piper/],
  ["wlipsync", /wlipsync/],
  ["expressionManager.setValue", /expressionManager\.setValue/],
  [".setValue(", /\.setValue\s*\(/],
];
const NEW_FILES = [PCM_SOURCE, PCM_SOURCE_TEST, PROVIDER, PROVIDER_TEST, PIPELINE, PIPELINE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day13C sources");

// 4. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
//    VoidVrmSkin 位于 src/avatar/skins/（不是 src/avatar 根），路径写错会静默跳过，故先 assertFile。
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /pcm-spectrum-source|local-pcm-fixture-tts-provider|local-pcm-formant-pipeline/, `${label} does not import Day13C modules`);
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
  console.log("[Day13C] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day13C] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
