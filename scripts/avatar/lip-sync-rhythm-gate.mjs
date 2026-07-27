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
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.ts",
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.test.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  "scripts/avatar/lip-sync-harness-gate.mjs",
];

// Day8 仅禁止「真实嘴型 / 音频 / Edge」相关源码。
// 注意：扫描范围限定在 agent + skins 两目录（与 Day7 一致），
// 因为 avatar/vrm/VrmExpressionController.ts 是既有的表情写入器（含 .setValue），
// 不在 Day8 改动范围内，不应被本 gate 误杀。
const FORBIDDEN_PATTERNS_IN_SOURCE = [
  /interface\s+VisemeFrame/,
  /type\s+Viseme/,
  /new\s+AudioContext/,
  /new\s+AnalyserNode/,
  /createMediaElementSource/,
  /getByteFrequencyData/,
  /AudioToViseme/i,
  /edge-tts/i,
  /kokoro/i,
  // Day8 红线：不得写 VRM expression / 不得驱动嘴型
  /expressionManager\s*\.\s*setValue/,
  /\.setValue\s*\(/,
];

const checks = [];

function pass(message) {
  checks.push({ status: "PASS", message });
}

function fail(message) {
  checks.push({ status: "FAIL", message });
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
    const st = statSync(currentAbsolutePath);

    if (st.isDirectory()) {
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

function assertNoForbiddenSource() {
  const files = [
    ...listFilesRecursive("apps/desktop/src/avatar/agent"),
    ...listFilesRecursive("apps/desktop/src/avatar/skins"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));

  const offenders = [];

  for (const file of files) {
    const content = read(file);

    for (const pattern of FORBIDDEN_PATTERNS_IN_SOURCE) {
      if (pattern.test(content)) {
        offenders.push(`${file} matches ${pattern}`);
      }
    }
  }

  if (offenders.length === 0) {
    pass("no expression-write / audio / edge / viseme source detected");
  } else {
    fail(
      `forbidden source detected:\n${offenders
        .map((x) => `  - ${x}`)
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

  console.log("\n=== AvatarOS LipSync Rhythm Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(`\nLipSync rhythm gate failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("\n✅ LipSync rhythm gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.ts",
  /startText/,
  "rhythm driver starts from text",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.ts",
  /getStatus/,
  "rhythm driver exposes status",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.ts",
  /cancel/,
  "rhythm driver supports cancel",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-text-rhythm.ts",
  /update/,
  "rhythm driver advances state",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /LipSyncTextRhythmDriver/,
  "VoidVrmSkin wires LipSyncTextRhythmDriver",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /avatar-lip-rhythm-status/,
  "VoidVrmSkin renders rhythm status",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /startText/,
  "VoidVrmSkin forwards speech text to rhythm driver",
);

assertNoForbiddenSource();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
