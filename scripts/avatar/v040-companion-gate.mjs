// v0.4.0 gate: Companion Mode（云端大模型 + 人设 + 主动陪伴）
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC = resolve(ROOT, "apps/desktop/src");
const C = resolve(SRC, "companion");

let failures = 0;
const ok = (m) => console.log(`  [ok] ${m}`);
const fail = (m) => { failures++; console.error(`  [FAIL] ${m}`); };
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const has = (f, re, label) => { const s = read(f); s !== null && re.test(s) ? ok(label) : fail(label); };
const hasNot = (f, re, label) => { const s = read(f); s !== null && !re.test(s) ? ok(label) : fail(label); };

console.log("[v0.4.0] Companion gate");

for (const f of ["companion-settings.ts", "companion-brain.ts", "kernel-llm-provider.ts", "persona.ts", "persona.example.md", "CompanionSettingsPanel.tsx", "conversation-store.ts", "activity.ts"]) {
  existsSync(resolve(C, f)) ? ok(`${f} exists`) : fail(`${f} missing`);
}
has(resolve(SRC, "avatar/agent/openai-compatible-provider.ts"), /chat\/completions/, "OpenAI-compatible provider");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /new CompanionBrain\(/, "VOID uses CompanionBrain");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /markUserActivity\(\)/, "chat marks user activity for the kernel");
has(resolve(SRC, "cognition/cognitionDriver.ts"), /buildProactivePersona/, "proactive speech uses persona");
has(resolve(ROOT, "packages/cognition/src/cognition-engine.ts"), /options\.persona\?\.\(\)/, "CognitionEngine persona hook");
has(resolve(SRC, "App.tsx"), /isUserPresent\(\)/, "proactive only when she is at the computer");
has(resolve(SRC, "App.tsx"), /isQuietHour\(s\)/, "proactive respects quiet hours");
has(resolve(ROOT, "packages/runtime/src/runtime-kernel.ts"), /cooldownMs/, "kernel proactive cooldown");
has(resolve(ROOT, ".gitignore"), /persona\.local\.md/, "private persona file is gitignored");
has(resolve(ROOT, "apps/desktop/src-tauri/capabilities/default.json"), /api\.deepseek\.com/, "http scope allows DeepSeek");
hasNot(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /sk-[A-Za-z0-9]{16,}/, "no API key hardcoded in source");
// 你的声音（克隆）
has(resolve(SRC, "companion/cloud-voice.ts"), /audio\/speech/, "cloud TTS uses OpenAI-compatible /audio/speech");
has(resolve(SRC, "companion/cloud-voice.ts"), /uploads\/audio\/voice/, "voice clone upload implemented");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /function speakWithBody\(/, "chat + proactive speech share one voice path");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /onStart: startLip/, "lip-sync starts when audio actually plays");
has(resolve(ROOT, "apps/desktop/src-tauri/capabilities/default.json"), /api\.siliconflow\.cn/, "http scope allows SiliconFlow");
has(resolve(SRC, "companion/persona.ts"), /COMPANION_GROUND_RULES,/, "honesty / safety ground rules always in prompts");
hasNot(resolve(SRC, "companion/cloud-voice.ts"), /sk-[A-Za-z0-9]{16,}/, "no voice key hardcoded");
// 走动 + 招牌动作
has(resolve(SRC, "companion/desktop-walker.ts"), /getWorkArea/, "walker stays inside the work area");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /restoreGait\(eng\.gaitSaved\)/, "gait overlay is undone every frame (no drift)");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /loadCustomMotionManifest\(\)/, "signature motions loaded from manifest");
has(resolve(SRC, "avatar/vrm/load-vrma.ts"), /Promise\.allSettled/, "a broken signature motion cannot break built-in motions");
has(resolve(ROOT, "apps/desktop/src-tauri/capabilities/default.json"), /core:window:allow-set-position/, "window may be moved (walking)");
// 形象导入 + 表情自动补全
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /synthesizeMissingExpressions\(loaded\)/, "imported models get missing expressions synthesized");
has(resolve(SRC, "avatar/skins/VoidVrmSkin.tsx"), /throw new Error\("这个文件打不开/, "imports are validated before replacing the current model");
has(resolve(SRC, "avatar/custom-avatar-store.ts"), /BaseDirectory\.AppLocalData/, "imported model stored in app data, not the program folder");
// Tauri npm ↔ crate 版本必须同一 minor（否则 tauri build 拒绝打包）
try {
  execSync("node scripts/avatar/check-tauri-versions.mjs", { cwd: ROOT, stdio: "pipe" });
  ok("tauri npm packages and crates on matching major.minor");
} catch (e) {
  fail(`tauri version mismatch\n${String(e.stderr ?? e.stdout ?? "")}`);
}

for (const [label, cmd] of [
  ["tsc --noEmit (desktop)", "pnpm --filter desktop exec tsc --noEmit"],
  ["vite build (desktop)", "pnpm --filter desktop exec vite build"],
  ["vitest (desktop)", "pnpm --filter desktop exec vitest run"],
  ["vitest (root)", "pnpm vitest run"],
]) {
  try { execSync(cmd, { cwd: ROOT, stdio: "pipe" }); ok(label); }
  catch (e) { fail(`${label}\n${String(e.stdout ?? "").slice(-2000)}`); }
}

if (failures) { console.error(`\n[v0.4.0] FAIL — ${failures} check(s) failed`); process.exit(1); }
console.log("\n[v0.4.0] PASS");
