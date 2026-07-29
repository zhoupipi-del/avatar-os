// Day14A gate: Kokoro Provider Minimal Spike (dynamic-import probe, no product runtime)
// 校验：新文件存在 / 类与工厂存在 / 串联 kokoro provider + Day13C PCM source + Day11C probe /
//       未接 runtime（三个产品文件不 import 新模块）/ 禁用词（仅查本 milestone 新增文件，gate 互不干扰）/
//       四道基础闸门全绿。
// 注：Day14A 允许 kokoro / kokoro-js 作为候选包名出现在新文件（这是本阶段要碰的依赖）；
//     但禁止 edge-tts / piper-tts / wlipsync 等真实包名与音频上下文相关裸词。
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

console.log("[Day14A] Kokoro Provider Minimal Spike gate");

// 1. REQUIRED_FILES（先 assertFile 防呆——路径写错时后续检查无效也不能静默跳过）
const PROVIDER = resolve(AGENT_DIR, "kokoro-provider-spike.ts");
const PROVIDER_TEST = resolve(AGENT_DIR, "kokoro-provider-spike.test.ts");
const PIPELINE = resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.ts");
const PIPELINE_TEST = resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.test.ts");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(PROVIDER, "kokoro-provider-spike.ts");
assertFile(PROVIDER_TEST, "kokoro-provider-spike.test.ts");
assertFile(PIPELINE, "kokoro-formant-pipeline-spike.ts");
assertFile(PIPELINE_TEST, "kokoro-formant-pipeline-spike.test.ts");
assertFile(resolve(__dirname, "kokoro-provider-spike-gate.mjs"), "kokoro-provider-spike-gate.mjs");

// 2. 类 / 工厂 / 串联断言
assertContent(PROVIDER, /class\s+KokoroProviderSpike/, "KokoroProviderSpike class");
assertContent(PROVIDER, /implements\s+AudioTtsProvider/, "KokoroProviderSpike implements AudioTtsProvider");
assertContent(PROVIDER, /class\s+KokoroPlaybackSession/, "KokoroPlaybackSession class");
assertContent(PROVIDER, /async\s+load\(\)/, "session.load() (real or fallback synthesis)");
assertContent(PROVIDER, /PcmSpectrumSource/, "provider uses PcmSpectrumSource (PCM -> FFT, no real audio ctx)");
assertContent(PROVIDER, /from_pretrained/, "real kokoro synthesis path present (KokoroTTS.from_pretrained)");
assertContent(PROVIDER, /KOKORO_SPECIFIER\s*=\s*"kokoro-js"/, "dynamic import specifier = kokoro-js (graceful probe)");
assertContent(PIPELINE, /class\s+KokoroFormantPipelineSpike/, "KokoroFormantPipelineSpike class");
assertContent(PIPELINE, /function\s+createKokoroFormantPipelineSpike/, "createKokoroFormantPipelineSpike factory");
assertContent(PIPELINE, /FormantVisemeRuntimeProbe/, "pipeline uses FormantVisemeRuntimeProbe");
assertContent(PIPELINE, /speakAndAnalyze\(/, "pipeline.speakAndAnalyze()");
assertContent(INDEX, /kokoro-provider-spike/, "index.ts exports kokoro-provider-spike");
assertContent(INDEX, /kokoro-formant-pipeline-spike/, "index.ts exports kokoro-formant-pipeline-spike");

// 3. 未引入禁用项（仅查本 milestone 新增的 4 个 .ts 文件，gate 互不干扰）
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
// 注：kokoro / kokoro-js 为 Day14A 合法候选包名，不在禁用列表。
const NEW_FILES = [PROVIDER, PROVIDER_TEST, PIPELINE, PIPELINE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day14A sources");

// 4. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /kokoro-provider-spike|kokoro-formant-pipeline-spike/, `${label} does not import Day14A modules`);
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
  console.log("[Day14A] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day14A] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
