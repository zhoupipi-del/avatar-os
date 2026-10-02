// Day14B gate: Kokoro Install Compatibility Spike (real install, no model load)
// 校验：kokoro-js 进入 package.json / pnpm-lock.yaml /
//       新文件存在 / getKokoroInstallCompatibility + tryResolveKokoroModule 存在 /
//       未接 runtime（三个产品文件不 import 新模块）/
//       kokoro-js 字面量仅出现在允许的文件中 /
//       禁用词（仅查本 milestone 新增文件，gate 互不干扰）/
//       真实模型加载禁用：Day14B 新文件不得调用 from_pretrained( / .generate( /
//       四道基础闸门全绿。
// 注：Day14B 允许 kokoro-js 真实依赖进入 dependencies（这是本阶段要验证的安装兼容性）；
//     但禁止 edge-tts / piper-tts / wlipsync 等其它真实包名与音频上下文相关裸词。
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

console.log("[Day14B] Kokoro Install Compatibility gate");

// 1. kokoro-js 进入依赖清单（本阶段核心：真安装）
// 注意：kokoro-js 装在 apps/desktop/package.json（而非仓库根 package.json）。
const PKG = resolve(ROOT, "apps/desktop/package.json");
const LOCK = resolve(ROOT, "pnpm-lock.yaml");
assertFile(PKG, "apps/desktop/package.json");
assertFile(LOCK, "pnpm-lock.yaml");
assertContent(PKG, /"kokoro-js"\s*:\s*"1\.2\.1"/, "kokoro-js@1.2.1 in apps/desktop/package.json");
assertContent(LOCK, /kokoro-js@1\.2\.1|'kokoro-js@1\.2\.1'|kokoro-js:\n\s+1\.2\.1/, "kokoro-js@1.2.1 in pnpm-lock.yaml");

// 2. REQUIRED_FILES（先 assertFile 防呆）
const COMPAT = resolve(AGENT_DIR, "kokoro-install-compatibility.ts");
const COMPAT_TEST = resolve(AGENT_DIR, "kokoro-install-compatibility.test.ts");
const GATE = resolve(__dirname, "kokoro-install-compatibility-gate.mjs");
const INDEX = resolve(AGENT_DIR, "index.ts");
assertFile(COMPAT, "kokoro-install-compatibility.ts");
assertFile(COMPAT_TEST, "kokoro-install-compatibility.test.ts");
assertFile(GATE, "kokoro-install-compatibility-gate.mjs");

// 3. 函数 / 决策存在
assertContent(COMPAT, /function\s+getKokoroInstallCompatibility/, "getKokoroInstallCompatibility");
assertContent(COMPAT, /function\s+tryResolveKokoroModule/, "tryResolveKokoroModule");
assertContent(COMPAT, /function\s+assertKokoroModelLoadDisabled/, "assertKokoroModelLoadDisabled");
assertContent(COMPAT, /modelLoadPolicy\s*:\s*"disabled-in-day14b"/, "modelLoadPolicy = disabled-in-day14b");
assertContent(COMPAT, /import\([^)]*KOKORO_JS_SPECIFIER[^)]*\)/, "dynamic import(kokoro-js) probe");
assertContent(INDEX, /kokoro-install-compatibility/, "index.ts exports kokoro-install-compatibility");

// 4. 未接 runtime：三个产品文件不得 import 新模块（先 assertFile 防呆）
const VOID_SKIN = resolve(SKINS_DIR, "VoidVrmSkin.tsx");
const BROWSER_TTS = resolve(AGENT_DIR, "browser-tts-controller.ts");
const OVERLAY = resolve(AGENT_DIR, "LipSyncControlOverlay.tsx");
for (const [f, label] of [[VOID_SKIN, "VoidVrmSkin"], [BROWSER_TTS, "BrowserTtsController"], [OVERLAY, "LipSyncControlOverlay"]]) {
  assertFile(f, `${label} (runtime file)`);
  assertNoContent(f, /kokoro-install-compatibility|kokoro-provider-spike|kokoro-formant-pipeline-spike/, `${label} does not import Day14 modules`);
}

// 5. kokoro-js 字面量位置限制：apps/desktop/src 下只允许出现在白名单 .ts 文件
// 注：Day14A 的 provider / pipeline 测试文件（.test.ts）也含 "kokoro-js" 字面量（graceful skip 注释），
//     它们属于已验收的 Day14A 探针代码，与 .ts 主文件一并纳入白名单；
//     spec #6 只列了非测试主文件，这里按"kokoro-js 仅限 Day14 探针产物"的意图补全。
const ALLOWED_TS = [
  resolve(AGENT_DIR, "kokoro-provider-spike.ts"),
  resolve(AGENT_DIR, "kokoro-provider-spike.test.ts"),
  resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.ts"),
  resolve(AGENT_DIR, "kokoro-formant-pipeline-spike.test.ts"),
  resolve(AGENT_DIR, "kokoro-install-compatibility.ts"),
  resolve(AGENT_DIR, "kokoro-install-compatibility.test.ts"),
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

// 6. 禁用词（仅查本 milestone 新增的 2 个 .ts 文件，gate 互不干扰）
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
const NEW_FILES = [COMPAT, COMPAT_TEST];
let forbiddenHit = false;
for (const file of NEW_FILES) {
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  for (const [label, re] of FORBIDDEN) {
    if (re.test(s)) { fail(`forbidden token "${label}" in ${file}`); forbiddenHit = true; }
  }
}
if (!forbiddenHit) ok("no forbidden tokens in Day14B sources");

// 7. 真实模型加载禁用：Day14B 新文件不得调用 from_pretrained( / .generate(
for (const f of NEW_FILES) {
  assertNoContent(f, /from_pretrained\s*\(/, "no from_pretrained( in Day14B new files");
  assertNoContent(f, /\.generate\s*\(/, "no .generate( in Day14B new files");
}

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
  console.log("[Day14B] PASS — all checks green");
  process.exit(0);
} else {
  console.error(`[Day14B] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
