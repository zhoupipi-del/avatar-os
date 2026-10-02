// Day13D gate: TTS Dependency Spike (kokoro/piper evaluation, no real package, no runtime)
// 校验：新文件存在 / 评估函数存在 / 未接 runtime（三个产品文件不 import 新模块）/
//       禁用词（仅查本 milestone 新增文件，gate 互不干扰）/ 四道基础闸门全绿。
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

console.log("[Day13D] TTS Dependency Spike gate");

// 1. REQUIRED_FILES（先 assertFile 防呆——路径写错时后续检查无效也不能静默跳过）
const SPIKE = resolve(AGENT_DIR, "tts-dependency-spike.ts");
const SPIKE_TEST = resolve(AGENT_DIR, "tts-dependency-spike.test.ts");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(SPIKE, "tts-dependency-spike.ts");
assertFile(SPIKE_TEST, "tts-dependency-spike.test.ts");
assertFile(resolve(__dirname, "tts-dependency-spike-gate.mjs"), "tts-dependency-spike-gate.mjs");

// 2. 函数 / 类型 / 接口断言
assertContent(SPIKE, /type\s+TtsDependencyCandidate/, "TtsDependencyCandidate type");
assertContent(SPIKE, /interface\s+TtsDependencyProbeResult/, "TtsDependencyProbeResult interface");
assertContent(SPIKE, /function\s+evaluateTtsDependencyCandidate/, "evaluateTtsDependencyCandidate function");
assertContent(SPIKE, /function\s+rankTtsDependencyCandidates/, "rankTtsDependencyCandidates function");
assertContent(SPIKE, /function\s+recommendTtsDependencySpike/, "recommendTtsDependencySpike function");
assertContent(SPIKE, /"kokoro"\s*\|\s*"piper"/, "candidate union: kokoro | piper");
assertContent(INDEX, /tts-dependency-spike/, "index.ts exports tts-dependency-spike");

// 3. 禁用词（仅查本 milestone 新增的 2 个 .ts 文件，避免误伤既有注释）
//    注意：kokoro / piper 作为候选标识符是允许的；
//    禁止的是真实包名 kokoro-js / piper-tts / edge-tts（证明没有真实 import）。
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
  ["piper-tts", /piper-tts/],
  ["wlipsync", /wlipsync/],
  ["expressionManager.setValue", /expressionManager\.setValue/],
  [".setValue(", /\.setValue\s*\(/],
];
const NEW_FILES = [SPIKE, SPIKE_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day13D sources");

// 4. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
//    VoidVrmSkin 位于 src/avatar/skins/（不是 src/avatar 根），路径写错会静默跳过，故先 assertFile。
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /tts-dependency-spike/, `${label} does not import Day13D module`);
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
  console.log("[Day13D] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day13D] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
