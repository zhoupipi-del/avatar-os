import { defineConfig } from "vitest/config";
import path from "path";

// 用 process.cwd() 而非 __dirname：本仓库根 package.json 无 "type":"module"，
// 但 vitest 以 esbuild 加载此配置，__dirname 在 ESM 上下文可能 undefined。
// pnpm test 始终从仓库根执行，故 process.cwd() === 仓库根，最稳。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/tests/**/*.spec.ts", "packages/**/*.spec.ts"],
  },
  resolve: {
    alias: {
      "@avatar-os/primitives": path.resolve(process.cwd(), "packages/primitives/src"),
      "@avatar-os/runtime": path.resolve(process.cwd(), "packages/runtime/src"),
      "@avatar-os/memory": path.resolve(process.cwd(), "packages/memory/src"),
      "@avatar-os/presence": path.resolve(process.cwd(), "packages/presence/src"),
      "@avatar-os/sensor": path.resolve(process.cwd(), "packages/sensor/src"),
      "@avatar-os/morphology": path.resolve(process.cwd(), "packages/morphology/src"),
    },
  },
});
