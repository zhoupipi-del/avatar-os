// Day12 gate: WebAudio Runtime Bridge (isolated bridge module, no product runtime wiring)
// 校验：新文件存在 / 接口与类存在 / bridge 正确接 analyzer + source / 未引入禁用音频对象与真实 TTS /
//       未接 runtime（三个产品文件不 import 新模块）/ setValue 域检查 / getByteFrequencyData 仅允许测试 fake /
//       四道基础闸门全绿。
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
  if (!existsSync(file)) { fail(`${label} (file missing)`); return; }
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

console.log("[Day12] WebAudio Runtime Bridge gate");

// 1. REQUIRED_FILES（先 assertFile 防呆——路径写错时后面的检查无效也不能静默跳过）
const SOURCE = resolve(AGENT_DIR, "web-audio-spectrum-source.ts");
const SOURCE_TEST = resolve(AGENT_DIR, "web-audio-spectrum-source.test.ts");
const PROBE = resolve(AGENT_DIR, "web-audio-formant-probe.ts");
const PROBE_TEST = resolve(AGENT_DIR, "web-audio-formant-probe.test.ts");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(SOURCE, "web-audio-spectrum-source.ts");
assertFile(SOURCE_TEST, "web-audio-spectrum-source.test.ts");
assertFile(PROBE, "web-audio-formant-probe.ts");
assertFile(PROBE_TEST, "web-audio-formant-probe.test.ts");
assertFile(resolve(__dirname, "web-audio-runtime-bridge-gate.mjs"), "web-audio-runtime-bridge-gate.mjs");

// 2. 接口 / 类 / 方法断言（含 index.ts 接线导出）
assertContent(SOURCE, /class\s+WebAudioSpectrumSource/, "WebAudioSpectrumSource class");
assertContent(SOURCE, /getFrequencyData\(\)\s*:\s*Uint8Array/, "getFrequencyData(): Uint8Array");
assertContent(SOURCE, /pullFrequencyData/, "pullFrequencyData (DI injection point)");
assertContent(SOURCE, /implements\s+AudioSpectrumSource/, "WebAudioSpectrumSource implements AudioSpectrumSource");
assertContent(PROBE, /class\s+WebAudioFormantProbe/, "WebAudioFormantProbe class");
assertContent(PROBE, /function\s+createWebAudioFormantProbe/, "createWebAudioFormantProbe factory");
assertContent(PROBE, /getStatus\(\)/, "probe getStatus()");
assertContent(PROBE, /update\(\)/, "probe update()");
assertContent(PROBE, /FormantVisemeRuntimeProbe/, "probe uses FormantVisemeRuntimeProbe");
assertContent(PROBE, /from\s+"\.\/web-audio-spectrum-source"/, "probe imports WebAudioSpectrumSource");
assertContent(INDEX, /web-audio-spectrum-source/, "index.ts exports web-audio-spectrum-source");
assertContent(INDEX, /web-audio-formant-probe/, "index.ts exports web-audio-formant-probe");

// 3. 未引入禁用项（扫 agent 目录 .ts/.tsx，含测试）
const FORBIDDEN = [
  ["edge-tts", /edge-tts/],
  ["kokoro", /kokoro/],
  ["piper", /piper/],
  ["wlipsync", /wlipsync/],
  ["new AudioContext", /new\s+AudioContext/],
  ["webkitAudioContext", /webkitAudioContext/],
  ["new AnalyserNode", /new\s+AnalyserNode/],
  ["createAnalyser", /createAnalyser/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new Audio(", /new\s+Audio\(/],
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

// 4. getByteFrequencyData 仅允许在测试 fake 中出现（生产代码禁止——真实接线推迟到 Day13）
//    仅检查本 milestone 新增文件，避免误伤 Day11A/B 现有注释（gate 互不干扰）。
let gbhfHit = false;
for (const f of [SOURCE, PROBE]) {
  if (/getByteFrequencyData/.test(readFileSync(f, "utf8"))) {
    fail(`getByteFrequencyData in ${f} (must use DI pullFrequencyData)`);
    gbhfHit = true;
  }
}
if (!gbhfHit) ok("getByteFrequencyData absent from Day12 bridge sources");

// 5. setValue 域检查：仅 lip-sync-expression-writer.ts 允许 .setValue(
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

// 6. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
//    注意：VoidVrmSkin 位于 src/avatar/skins/（不是 src/avatar/ 根）。路径写错会静默跳过，故先 assertFile。
const VOID_SKIN = resolve(AGENT_DIR, "..", "skins", "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /web-audio-spectrum-source|web-audio-formant-probe/, `${label} does not import Day12 bridge`);
}

// 7. 新模块不得反向 import runtime / 产品组件 / writer / driver
for (const f of [SOURCE, PROBE]) {
  assertNoContent(f, /VoidVrmSkin|browser-tts-controller|LipSyncControlOverlay|lip-sync-expression-writer|text-viseme-expression-driver/, `runtime import in ${f}`);
}

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
  console.log("[Day12] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day12] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
