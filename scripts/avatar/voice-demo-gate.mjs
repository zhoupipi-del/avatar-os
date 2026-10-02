import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const REQUIRED_FILES = [
  "apps/desktop/src/avatar/agent/agent-intent.ts",
  "apps/desktop/src/avatar/agent/agent-runtime.ts",
  "apps/desktop/src/avatar/agent/AgentInputOverlay.tsx",
  "apps/desktop/src/avatar/agent/browser-tts-controller.ts",
  "apps/desktop/src/avatar/agent/browser-tts-controller.test.ts",
  "apps/desktop/src/avatar/agent/voice-control-state.ts",
  "apps/desktop/src/avatar/agent/voice-control-state.test.ts",
  "apps/desktop/src/avatar/agent/VoiceControlOverlay.tsx",
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.ts",
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.test.ts",
  "apps/desktop/src/avatar/agent/json-llm-brain.ts",
  "apps/desktop/src/avatar/agent/brain-factory.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
];

const FORBIDDEN_PATH_PATTERNS = [
  /packages[\\/](lip-sync|lipsync|speech|relationship)/i,
  /apps[\\/]desktop[\\/]src[\\/]avatar[\\/].*(lip-sync|lipsync|edge-tts|kokoro|memory|relationship)/i,
  // Day6 闸门：禁止完整 LipSync / Viseme / Audio→Viseme 引擎混入
  // 注意：vrm-lip-shape-probe 是只读探测，文件名不含 lipsyncengine/viseme/audiocontext，不会被误杀
  /apps[\\/]desktop[\\/]src[\\/]avatar[\\/].*(lipsyncengine|viseme|audio.?to.?viseme|audiocontext)/i,
];

const checks = [];

function pass(message) {
  checks.push({
    status: "PASS",
    message,
  });
}

function fail(message) {
  checks.push({
    status: "FAIL",
    message,
  });
}

function abs(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  return readFileSync(abs(relativePath), "utf8");
}

function assertFile(relativePath) {
  if (existsSync(abs(relativePath))) {
    pass(`required file exists: ${relativePath}`);
  } else {
    fail(`missing required file: ${relativePath}`);
  }
}

function assertContains(relativePath, pattern, label) {
  if (!existsSync(abs(relativePath))) {
    fail(`cannot inspect missing file: ${relativePath}`);
    return;
  }

  const content = read(relativePath);

  if (pattern.test(content)) {
    pass(`${label}: ${relativePath}`);
  } else {
    fail(`${label} missing in ${relativePath}`);
  }
}

function listFilesRecursive(startRelativePath) {
  const start = abs(startRelativePath);

  if (!existsSync(start)) {
    return [];
  }

  const result = [];

  function walk(currentAbsolutePath) {
    const stat = statSync(currentAbsolutePath);

    if (stat.isDirectory()) {
      if (path.basename(currentAbsolutePath) === "node_modules") {
        return;
      }

      for (const entry of readdirSync(currentAbsolutePath)) {
        walk(path.join(currentAbsolutePath, entry));
      }

      return;
    }

    result.push(path.relative(ROOT, currentAbsolutePath));
  }

  walk(start);

  return result;
}

function assertNoForbiddenFeatureFiles() {
  const files = [
    ...listFilesRecursive("apps/desktop/src/avatar"),
    ...listFilesRecursive("packages"),
  ];

  const offenders = files.filter((file) =>
    FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(file)),
  );

  if (offenders.length === 0) {
    pass("no Edge/LipSync/Memory/Relationship feature paths found");
  } else {
    fail(
      `forbidden voice-demo feature paths found:\n${offenders
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    fail(`command failed: ${command} ${args.join(" ")}`);
    return;
  }

  pass(`command passed: ${command} ${args.join(" ")}`);
}

function printResultAndExit() {
  const failed = checks.filter((check) => check.status === "FAIL");

  console.log("\n=== AvatarOS Voice Demo Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(
      `\nVoice demo gate failed: ${failed.length} issue(s).`,
    );
    process.exit(1);
  }

  console.log("\n✅ Voice demo gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/agent/browser-tts-controller.ts",
  /speechSynthesis/,
  "Browser TTS uses speechSynthesis",
);

assertContains(
  "apps/desktop/src/avatar/agent/browser-tts-controller.ts",
  /cancel\(\)/,
  "Browser TTS exposes cancel",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /BrowserTtsController/,
  "VoidVrmSkin wires BrowserTtsController",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /\.speak\(text\)/,
  "BodyBridge speaks text through TTS",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /\.cancel\(\)/,
  "BodyBridge cancels TTS on stop",
);

assertContains(
  "apps/desktop/src/avatar/agent/VoiceControlOverlay.tsx",
  /VoiceControlOverlay/,
  "Voice control overlay component exists",
);

assertContains(
  "apps/desktop/src/avatar/agent/browser-tts-controller.ts",
  /setEnabled\(/,
  "Browser TTS supports setEnabled",
);

assertContains(
  "apps/desktop/src/avatar/agent/browser-tts-controller.ts",
  /setOptions\(/,
  "Browser TTS supports setOptions",
);

assertContains(
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.ts",
  /probeLipShapes/,
  "VRM lip shape probe exports probeLipShapes",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /probeLipShapes/,
  "VoidVrmSkin wires lip shape probe",
);

assertContains(
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.ts",
  /getExpression|expressionMap|expressions/,
  "Lip probe reads expression manager state only",
);

assertNoForbiddenFeatureFiles();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
