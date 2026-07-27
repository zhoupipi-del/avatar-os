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
  "apps/desktop/src/avatar/agent/text-viseme-timeline.ts",
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.ts",
  "apps/desktop/src/avatar/agent/text-viseme-expression-driver.test.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
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
    fail(`forbidden source detected:\n${offenders.map((x) => `  - ${x}`).join("\n")}`);
  }
}

function assertNoDirectSetValueOutsideWriter() {
  const files = [
    ...listFilesRecursive("apps/desktop/src/avatar/agent"),
    ...listFilesRecursive("apps/desktop/src/avatar/skins"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));

  const allowedFiles = new Set([
    "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
    "apps/desktop/src/avatar/expressions/VrmExpressionController.ts",
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
    pass("no direct expression setValue outside allowed writers");
  } else {
    fail(`direct setValue outside allowed writers:\n${offenders.map((x) => `  - ${x}`).join("\n")}`);
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

  console.log("\n=== AvatarOS Text Viseme Expression Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(`\nText viseme expression gate failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("\n✅ Text viseme expression gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  /LIP_SYNC_MOUTH_SHAPES/,
  "mouth shape allowlist exists",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  /resetAll/,
  "reset all exists",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-expression-writer.ts",
  /setProbeAvailable/,
  "probe gate exists",
);

assertContains(
  "apps/desktop/src/avatar/agent/text-viseme-timeline.ts",
  /primaryWeight/,
  "text viseme frame has primary weight",
);

assertContains(
  "apps/desktop/src/avatar/agent/text-viseme-timeline.ts",
  /secondaryWeight/,
  "text viseme frame has secondary weight",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /TextVisemeExpressionDriver/,
  "VoidVrmSkin wires text viseme expression driver",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /textVisemeExpression/,
  "engine owns text viseme expression driver",
);

assertNoForbiddenSource();
assertNoDirectSetValueOutsideWriter();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
