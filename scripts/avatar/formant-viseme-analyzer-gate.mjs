// Day11B gate: Formant Viseme Analyzer (pure-algorithm clean-room rewrite)
// 校验：analyzer 文件存在 / 三个核心函数与类型存在 / 未引入禁用音频对象 / 未新增 setValue /
//       未接 runtime / 四道基础闸门全绿。
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

console.log("[Day11B] Formant Viseme Analyzer gate");

// 1. REQUIRED_FILES
assertFile(resolve(AGENT_DIR, "formant-viseme-analyzer.ts"), "formant-viseme-analyzer.ts");
assertFile(resolve(AGENT_DIR, "formant-viseme-analyzer.test.ts"), "formant-viseme-analyzer.test.ts");
assertFile(resolve(__dirname, "formant-viseme-analyzer-gate.mjs"), "formant-viseme-analyzer-gate.mjs");

// 2. 函数 / 类型内容断言
const ANALYZER = resolve(AGENT_DIR, "formant-viseme-analyzer.ts");
assertContent(ANALYZER, /analyzeFormantViseme/, "analyzeFormantViseme exported");
assertContent(ANALYZER, /findPeakInRange/, "findPeakInRange exported");
assertContent(ANALYZER, /computeVocalEnergy/, "computeVocalEnergy exported");
assertContent(ANALYZER, /interface\s+FormantPeak/, "FormantPeak interface");
assertContent(ANALYZER, /interface\s+FormantVisemeResult/, "FormantVisemeResult interface");
assertContent(
  ANALYZER,
  /type\s+MouthShape\s*=\s*"aa"\s*\|\s*"ih"\s*\|\s*"ou"\s*\|\s*"ee"\s*\|\s*"oh"/,
  "MouthShape union",
);

// 3. 未引入禁用项（仅扫 agent 目录 .ts/.tsx）
const FORBIDDEN = [
  ["edge-tts", /edge-tts/],
  ["kokoro", /kokoro/],
  ["piper", /piper/],
  ["wlipsync", /wlipsync/],
  ["new AudioContext", /new\s+AudioContext/],
  ["new AnalyserNode", /new\s+AnalyserNode/],
  ["createMediaElementSource", /createMediaElementSource/],
  ["new AudioBufferSourceNode", /new\s+AudioBufferSourceNode/],
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

// 5. 未接 runtime（VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay 不应 import analyzer）
const VOID_SKIN = resolve(AGENT_DIR, "..", "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertNoContent(f, /formant-viseme-analyzer/, `${label} does not import formant-viseme-analyzer`);
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
  console.log("[Day11B] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day11B] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
