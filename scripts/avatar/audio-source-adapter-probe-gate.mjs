// Day11C gate: Audio Source Adapter Probe (spectrum source + runtime probe, pure data only)
// 校验：新文件存在 / 接口与类存在 / probe 正确接 analyzer / 未引入禁用音频对象与真实 TTS /
//       未接 runtime（三个产品文件不 import 新模块）/ setValue 域检查 / 四道基础闸门全绿。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const AGENT_DIR = resolve(ROOT, "apps/desktop/src/avatar/agent");

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
  if (!existsSync(file)) return;
  if (re.test(readFileSync(file, "utf8"))) fail(`${label}`);
  else ok(`no ${label}`);
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

console.log("[Day11C] Audio Source Adapter Probe gate");

// 1. REQUIRED_FILES
const SOURCE = resolve(AGENT_DIR, "audio-spectrum-source.ts");
const SOURCE_TEST = resolve(AGENT_DIR, "audio-spectrum-source.test.ts");
const PROBE = resolve(AGENT_DIR, "formant-viseme-runtime-probe.ts");
const PROBE_TEST = resolve(AGENT_DIR, "formant-viseme-runtime-probe.test.ts");
assertFile(SOURCE, "audio-spectrum-source.ts");
assertFile(SOURCE_TEST, "audio-spectrum-source.test.ts");
assertFile(PROBE, "formant-viseme-runtime-probe.ts");
assertFile(PROBE_TEST, "formant-viseme-runtime-probe.test.ts");
assertFile(resolve(__dirname, "audio-source-adapter-probe-gate.mjs"), "audio-source-adapter-probe-gate.mjs");

// 2. 接口 / 类 / 方法断言
assertContent(SOURCE, /interface\s+AudioSpectrumSource/, "AudioSpectrumSource interface");
assertContent(SOURCE, /getFrequencyData\(\)\s*:\s*Uint8Array/, "getFrequencyData(): Uint8Array");
assertContent(SOURCE, /class\s+StaticFrequencySpectrumSource/, "StaticFrequencySpectrumSource class");
assertContent(SOURCE, /class\s+CyclingFrequencySpectrumSource/, "CyclingFrequencySpectrumSource class");
assertContent(SOURCE, /function\s+createSilentSpectrumSource/, "createSilentSpectrumSource factory");
assertContent(PROBE, /class\s+FormantVisemeRuntimeProbe/, "FormantVisemeRuntimeProbe class");
assertContent(PROBE, /getStatus\(\)/, "probe getStatus()");
assertContent(PROBE, /cancel\(\)/, "probe cancel()");
assertContent(PROBE, /reset\(\)/, "probe reset()");
assertContent(PROBE, /analyzeFormantViseme/, "probe uses analyzeFormantViseme");
assertContent(PROBE, /from\s+"\.\/audio-spectrum-source"/, "probe imports AudioSpectrumSource");

// 3. 未引入禁用项（扫 agent 目录 .ts/.tsx）
const FORBIDDEN = [
  ["edge-tts", /edge-tts/],
  ["kokoro", /kokoro/],
  ["piper", /piper/],
  ["wlipsync", /wlipsync/],
  ["new AudioContext", /new\s+AudioContext/],
  ["new AnalyserNode", /new\s+AnalyserNode/],
  ["createAnalyser", /createAnalyser/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new AudioBufferSourceNode", /new\s+AudioBufferSourceNode/],
  ["createBufferSource", /createBufferSource/],
  ["expressionManager.setValue", /expressionManager\.setValue/],
];
const agentFiles = walk(AGENT_DIR);
let forbiddenHit = false;
for (const file of agentFiles) {
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in agent sources");

// 4. setValue 域检查：仅 lip-sync-expression-writer.ts 允许 .setValue(
const ALLOWED_SETVALUE = resolve(AGENT_DIR, "lip-sync-expression-writer.ts");
let setValueViolation = false;
for (const file of agentFiles) {
  const s = readFileSync(file, "utf8");
  if (/\.setValue\s*\(/.test(s) && file !== ALLOWED_SETVALUE) {
    fail(`.setValue( found outside allowlist in ${file}`);
    setValueViolation = true;
  }
}
if (!setValueViolation) ok("setValue( only in lip-sync-expression-writer.ts");

// 5. 未接 runtime：三个产品文件不得 import 新模块
//    注意：VoidVrmSkin 位于 src/avatar/skins/（不是 src/avatar/ 根）。
//    这里先 assertFile 防呆——路径写错时 assertNoContent 会静默跳过，检查形同虚设。
const VOID_SKIN = resolve(AGENT_DIR, "..", "skins", "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /audio-spectrum-source/, `${label} does not import audio-spectrum-source`);
  assertNoContent(f, /formant-viseme-runtime-probe/, `${label} does not import formant-viseme-runtime-probe`);
}

// 6. 新模块不得反向 import runtime / 产品组件
for (const f of [SOURCE, PROBE]) {
  assertNoContent(f, /VoidVrmSkin|browser-tts-controller|LipSyncControlOverlay|lip-sync-expression-writer/, `runtime import in ${f}`);
}

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
  console.log("[Day11C] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day11C] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
