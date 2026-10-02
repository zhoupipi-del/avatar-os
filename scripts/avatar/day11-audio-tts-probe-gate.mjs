// Day11A gate: Audio TTS Pipeline Probe
// 校验：接口存在 / 未替换 BrowserTtsController / 未引入禁用项 / 未新增 setValue / 四道基础闸门全绿。
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

console.log("[Day11A] Audio TTS Pipeline Probe gate");

// 1. REQUIRED_FILES
assertFile(resolve(AGENT_DIR, "audio-tts-provider.ts"), "audio-tts-provider.ts");
assertFile(resolve(AGENT_DIR, "audio-tts-provider.test.ts"), "audio-tts-provider.test.ts");
assertFile(resolve(ROOT, "docs/avatar/day11-audio-lipsync-route.md"), "docs/avatar/day11-audio-lipsync-route.md");
assertFile(resolve(__dirname, "day11-audio-tts-probe-gate.mjs"), "day11-audio-tts-probe-gate.mjs");

// 2. 接口与 capability 内容断言
const PROVIDER = resolve(AGENT_DIR, "audio-tts-provider.ts");
assertContent(PROVIDER, /interface\s+AudioTtsProvider/, "AudioTtsProvider interface");
assertContent(PROVIDER, /interface\s+AudioTtsCapability/, "AudioTtsCapability interface");
assertContent(PROVIDER, /interface\s+AudioTtsPlaybackSession/, "AudioTtsPlaybackSession interface");
assertContent(PROVIDER, /supportsAudioNode/, "capability.supportsAudioNode");
assertContent(PROVIDER, /supportsAudioBuffer/, "capability.supportsAudioBuffer");
assertContent(PROVIDER, /supportsPcm/, "capability.supportsPcm");
assertContent(PROVIDER, /UnsupportedAudioTtsProvider|describeBrowserTtsCapability/, "placeholder provider / capability descriptor");

// 3. BrowserTtsController 未被替换
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
assertContent(BROWSER_TTS, /class\s+BrowserTtsController/, "BrowserTtsController still present");
assertNoContent(BROWSER_TTS, /implements\s+AudioTtsProvider/, "BrowserTtsController not converted to AudioTtsProvider");
assertNoContent(BROWSER_TTS, /new\s+AudioContext/, "BrowserTtsController does not create AudioContext");

// 4. 未引入禁用项（仅扫 agent 目录 .ts/.tsx）
const FORBIDDEN = [
  ["edge-tts", /edge-tts/],
  ["kokoro", /kokoro/],
  ["piper", /piper/],
  ["wlipsync", /wlipsync/],
  ["new AudioContext", /new\s+AudioContext/],
  ["new AnalyserNode", /new\s+AnalyserNode/],
  ["new AudioBufferSourceNode", /new\s+AudioBufferSourceNode/],
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
  console.log("[Day11A] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day11A] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
