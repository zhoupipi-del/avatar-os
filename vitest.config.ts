// vitest 配置 — 仅覆盖 packages/*/tests 下的规格文件
// 环境用 node（DriveEngine / BehaviorVM 不依赖 DOM，event-bus 为纯 Map 实现）
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/tests/**/*.spec.ts"],
    environment: "node",
    // 单测也是仓库质量门禁的一部分，失败即阻断
    bail: 0,
  },
});
