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
  "apps/desktop/src/avatar/agent/rule-based-brain.ts",
  "apps/desktop/src/avatar/agent/brain-json-parser.ts",
  "apps/desktop/src/avatar/agent/AgentInputOverlay.tsx",
  "apps/desktop/src/avatar/agent/llm-provider.ts",
  "apps/desktop/src/avatar/agent/ollama-provider.ts",
  "apps/desktop/src/avatar/agent/json-llm-brain.ts",
  "apps/desktop/src/avatar/agent/brain-factory.ts",
  "apps/desktop/src/avatar/agent/agent-runtime.test.ts",
  "apps/desktop/src/avatar/agent/json-llm-brain.test.ts",
  "apps/desktop/src/avatar/agent/brain-factory.test.ts",
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  "apps/desktop/src/avatar/Avatar.css",
];

// 注意：packages/memory 是既有的基础设施包（sqlite 记忆内核），
// 不属于 v0.3.8-fast 要排除的「记忆功能特性」，
// 故 packages 维度不把 memory 列为禁用；只在 demo 源码
// （apps/desktop/src/avatar）内禁止 memory 特性混入。
const FORBIDDEN_PATH_PATTERNS = [
  /packages[\\/](lip-sync|lipsync|speech|relationship)[\\/]/i,
  /apps[\\/]desktop[\\/]src[\\/]avatar[\\/].*(lip-sync|lipsync|tts|speech|memory|relationship)/i,
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
      if (path.basename(currentAbsolutePath).toLowerCase() === "node_modules") {
        return; // 跳过依赖树，避免 node_modules 内路径误判
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
    pass("no TTS/LipSync/Memory/Relationship source paths found");
  } else {
    fail(
      `forbidden fast-demo feature paths found:\n${offenders
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

  console.log("\n=== AvatarOS Fast Demo Gate ===\n");

  for (const check of checks) {
    const icon = check.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} ${check.message}`);
  }

  if (failed.length > 0) {
    console.error(
      `\nFast demo gate failed: ${failed.length} issue(s).`,
    );
    process.exit(1);
  }

  console.log("\n✅ Fast demo gate passed.");
}

for (const file of REQUIRED_FILES) {
  assertFile(file);
}

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /createDefaultDemoBrain/,
  "VoidVrmSkin uses createDefaultDemoBrain",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /window\.__avatarOSAgent/,
  "VoidVrmSkin exposes window.__avatarOSAgent",
);

assertContains(
  "apps/desktop/src/avatar/skins/VoidVrmSkin.tsx",
  /AgentInputOverlay/,
  "VoidVrmSkin renders AgentInputOverlay",
);

assertContains(
  "apps/desktop/src/avatar/agent/json-llm-brain.ts",
  /RuleBasedBrain/,
  "JsonLlmBrain keeps RuleBasedBrain fallback",
);

assertContains(
  "apps/desktop/src/avatar/agent/json-llm-brain.test.ts",
  /falls back/i,
  "JsonLlmBrain fallback tests exist",
);

assertContains(
  "apps/desktop/src/avatar/agent/brain-factory.ts",
  /VITE_OLLAMA_ENDPOINT/,
  "brain factory reads VITE_OLLAMA_ENDPOINT",
);

assertContains(
  "apps/desktop/src/avatar/agent/brain-factory.ts",
  /VITE_OLLAMA_MODEL/,
  "brain factory reads VITE_OLLAMA_MODEL",
);

assertContains(
  "apps/desktop/src/avatar/agent/brain-factory.ts",
  /VITE_OLLAMA_TIMEOUT_MS/,
  "brain factory reads VITE_OLLAMA_TIMEOUT_MS",
);

assertNoForbiddenFeatureFiles();

run(PNPM, ["--filter", "desktop", "exec", "tsc", "--noEmit"]);
run(PNPM, ["--filter", "desktop", "exec", "vite", "build"]);
run(PNPM, ["--filter", "desktop", "exec", "vitest", "run"]);
run(PNPM, ["vitest", "run"]);

printResultAndExit();
