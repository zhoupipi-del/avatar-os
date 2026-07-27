import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const REQUIRED_FILES = [
  "apps/desktop/src/avatar/agent/LipSyncControlOverlay.tsx",
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.ts",
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  "scripts/avatar/lip-sync-controls-gate.mjs",
];

const FORBIDDEN_PATTERNS = [
  /new\s+AudioContext/i,
  /new\s+AnalyserNode/i,
  /createMediaElementSource/i,
  /wlipsync/i,
  /edge-tts/i,
  /kokoro/i,
  /piper/i,
  /AudioToViseme/i,
  /interface\s+VisemeFrame/i,
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

function assertNoForbiddenSource() {
  const files = [
    ...listFilesRecursive("apps/desktop/src/avatar/agent"),
    ...listFilesRecursive("apps/desktop/src/avatar/skins"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));

  const offenders = [];

  for (const file of files) {
    const content = read(file);

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        offenders.push(`${file} matches ${pattern}`);
      }
    }
  }

  if (offenders.length === 0) {
    pass("no audio-driven LipSync source detected");
  } else {
    fail(
      `forbidden source detected:\n${offenders
        .map((x) => `  - ${x}`)
        .join("\n")}`,
    );
  }
}

function assertNoDirectSetValueOutsideWriter() {
  const files = [
    ...listFilesRecursive("apps/desktop/src/avatar/agent"),
    ...listFilesRecursive("apps/desktop/src/avatar/skins"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));

  // 扫描范围仅 agent + skins（VrmExpressionController 在 vrm/ 目录，不在范围内，
  // 与 Day9 gate 一致）。白名单只保留唯一嘴型写入口。
  const allowedFiles = new Set([
    "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  ]);

  const offenders = [];

  for (const file of files) {
    if (allowedFiles.has(file.replaceAll("\\", "/"))) {
      continue;
    }

    const content = read(file);

    if (/\.setValue\s*\(/.test(content)) {
      offenders.push(file);
    }
  }

  if (offenders.length === 0) {
    pass("no direct expression setValue outside allowed writer");
  } else {
    fail(
      `direct setValue outside allowed writer:\n${offenders
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

  console.log("\n=== AvatarOS LipSync Product Controls Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(`\nLipSync controls gate failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("\n✅ LipSync controls gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.ts",
  /setOptions/,
  "driver.setOptions exists",
);
assertContains(
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.ts",
  /getOptions/,
  "driver.getOptions exists",
);
assertContains(
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.ts",
  /setEnabled/,
  "driver.setEnabled exists",
);
assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  /setOptions/,
  "writer.setOptions exists",
);
assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  /resetAll/,
  "writer.resetAll exists",
);
assertContains(
  "apps/desktop/src/avatar/agent/LipSyncControlOverlay.tsx",
  /driver\.cancel/,
  "LipSyncControlOverlay reset-all calls driver.cancel",
);
assertContains(
  "apps/desktop/src/avatar/agent/LipSyncControlOverlay.tsx",
  /setOptions/,
  "LipSyncControlOverlay wires setOptions",
);
assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /LipSyncControlOverlay/,
  "VoidVrmSkin mounts LipSyncControlOverlay",
);
assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /getManager/,
  "VoidVrmSkin passes getManager",
);

assertNoForbiddenSource();
assertNoDirectSetValueOutsideWriter();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
