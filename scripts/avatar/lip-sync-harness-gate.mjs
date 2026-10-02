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
  "apps/desktop/src/avatar/agent/lip-sync-noop-harness.ts",
  "apps/desktop/src/avatar/agent/lip-sync-noop-harness.test.ts",
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.ts",
  "apps/desktop/src/avatar/agent/vrm-lip-shape-probe.test.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  "scripts/avatar/voice-demo-gate.mjs",
];

const FORBIDDEN_PATTERNS_IN_SOURCE = [
  /interface\s+VisemeFrame/,
  /type\s+Viseme/,
  /new\s+AudioContext/,
  /new\s+AnalyserNode/,
  /createMediaElementSource/,
  /getByteFrequencyData/,
  /edge-tts/i,
  /kokoro/i,
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

    for (const pattern of FORBIDDEN_PATTERNS_IN_SOURCE) {
      if (pattern.test(content)) {
        offenders.push(`${file} matches ${pattern}`);
      }
    }
  }

  if (offenders.length === 0) {
    pass("no full LipSync/Audio/Edge source detected");
  } else {
    fail(`forbidden source detected:\n${offenders.map((x) => `  - ${x}`).join("\n")}`);
  }
}

function assertNoSetValueInHarness() {
  const file = "apps/desktop/src/avatar/agent/lip-sync-noop-harness.ts";

  if (!existsSync(abs(file))) {
    fail(`cannot inspect missing file: ${file}`);
    return;
  }

  const content = read(file);

  if (/setValue\s*\(/.test(content)) {
    fail("lip-sync-noop-harness must not call expressionManager.setValue");
    return;
  }

  pass("lip-sync-noop-harness does not write expressions");
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

  console.log("\n=== AvatarOS LipSync Harness Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(`\nLipSync harness gate failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("\n✅ LipSync harness gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-noop-harness.ts",
  /notifySpeechText/,
  "harness receives speech text",
);

assertContains(
  "apps/desktop/src/avatar/agent/lip-sync-noop-harness.ts",
  /getStatus/,
  "harness exposes status",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /LipSyncNoopHarness/,
  "VoidVrmSkin wires LipSyncNoopHarness",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /avatar-lip-sync-status/,
  "VoidVrmSkin renders lip sync status",
);

assertNoSetValueInHarness();
assertNoForbiddenSource();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
