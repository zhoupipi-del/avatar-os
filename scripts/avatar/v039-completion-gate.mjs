// v0.3.9 gate: Completion Patch（可交付态）
// 校验：
//   1. 默认身体不再依赖不入库的 GLB（Avatar 默认 skinId=null，走 AvatarService → VOID VRM）
//   2. SkinErrorBoundary 包裹身体渲染（资源缺失不再整窗白屏）
//   3. Tauri 专属调用均有 isTauri() 守卫（浏览器 dev 无 invoke 报错）
//   4. 大脑：OllamaProvider 默认 fetch 已绑定；对话记忆 + 真实 Brain 状态接线
//   5. Ollama 经 tauri-plugin-http（localFetch）访问，capability 仅放行本机 11434
//   6. 生命状态 mood → VOID 表情；RuntimeKernel 主动说话 → 语音 + 嘴型
//   7. 身体选择持久化不再是内存占位
//   8. 系统托盘（显示/隐藏/置顶/退出）
//   9. 四道基础闸门全绿
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC = resolve(ROOT, "apps/desktop/src");
const TAURI = resolve(ROOT, "apps/desktop/src-tauri");

let failures = 0;
const ok = (m) => console.log(`  [ok] ${m}`);
const fail = (m) => { failures++; console.error(`  [FAIL] ${m}`); };
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
function has(file, re, label) {
  const s = read(file);
  if (s === null) return fail(`${label} (missing ${file})`);
  re.test(s) ? ok(label) : fail(label);
}
function hasNot(file, re, label) {
  const s = read(file);
  if (s === null) return fail(`${label} (missing ${file})`);
  re.test(s) ? fail(label) : ok(label);
}

console.log("[v0.3.9] Completion gate");

const AVATAR = resolve(SRC, "avatar/Avatar.tsx");
const VOID = resolve(SRC, "avatar/skins/VoidVrmSkin.tsx");
const APP = resolve(SRC, "App.tsx");

// 1 + 2
has(AVATAR, /useState<string \| null>\(null\)/, "Avatar default skinId is null (VOID VRM by default)");
hasNot(AVATAR, /SKIN_REGISTRY\[CURRENT_SKIN_ID\]/, "Avatar no longer falls back to frieza-3d");
has(AVATAR, /<SkinErrorBoundary/, "Avatar wraps body in SkinErrorBoundary");

// 3
has(AVATAR, /isTauri\(\)/, "Avatar guards global-mousemove listen with isTauri()");
has(resolve(SRC, "persistence/tauri-relationship-repository.ts"), /if \(!isTauri\(\)\) return undefined/, "relationship repository degrades outside Tauri");
has(resolve(SRC, "window/window-state.ts"), /isTauri\(\)/, "window-state uses isTauri()");

// 4
has(resolve(SRC, "avatar/agent/ollama-provider.ts"), /globalThis\.fetch\(input, init\)/, "OllamaProvider default fetch is bound");
has(resolve(SRC, "avatar/agent/json-llm-brain.ts"), /buildHistory\(\)/, "JsonLlmBrain sends conversation history");
has(VOID, /conversationStore/, "VoidVrmSkin wires conversation memory");
has(VOID, /brainState=\{brainState\}/, "DemoStatusBar receives real brain state");

// 5
has(VOID, /fetchImpl: localFetch/, "chat brain uses localFetch");
has(resolve(SRC, "cognition/cognitionDriver.ts"), /localFetch/, "kernel cognition uses localFetch");
has(resolve(TAURI, "src/main.rs"), /tauri_plugin_http::init\(\)/, "tauri-plugin-http registered");
has(resolve(TAURI, "capabilities/default.json"), /127\.0\.0\.1:11434/, "http capability scoped to local Ollama");

// 6
has(VOID, /applyMoodExpression\(/, "life-state mood drives VOID expression");
has(VOID, /kernelEventBus\.on\("AVATAR_THOUGHT"/, "proactive speech routed to TTS + lip-sync");

// 7
has(APP, /createLocalAvatarStorage\(\)/, "avatar selection persisted via localStorage");
hasNot(APP, /IN_MEMORY_AVATAR_STORAGE/, "App no longer uses in-memory avatar storage");

// 8
has(resolve(TAURI, "src/main.rs"), /TrayIconBuilder/, "system tray built");
has(resolve(TAURI, "Cargo.toml"), /"tray-icon"/, "tauri tray-icon feature enabled");

// 9
const gates = [
  ["tsc --noEmit (desktop)", "pnpm --filter desktop exec tsc --noEmit"],
  ["vite build (desktop)", "pnpm --filter desktop exec vite build"],
  ["vitest (desktop)", "pnpm --filter desktop exec vitest run"],
  ["vitest (root)", "pnpm vitest run"],
];
for (const [label, cmd] of gates) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    ok(label);
  } catch (e) {
    fail(`${label}\n${String(e.stdout ?? "").slice(-2000)}${String(e.stderr ?? "").slice(-2000)}`);
  }
}

if (failures > 0) {
  console.error(`\n[v0.3.9] FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n[v0.3.9] PASS");
