# Day14B — Kokoro Install Compatibility Spike

> 阶段性质：**依赖安装兼容性验证**。不下载模型、不真实合成、不接产品 runtime。
> 上游：Day14A（Kokoro Provider Minimal Spike，动态 import 探测 + graceful fallback）。
> 下游：若通过 → Day14C（Kokoro Model Load Smoke，才允许 `from_pretrained` / `generate`）。

## 1. 本阶段要回答的 5 个问题

| # | 问题 | Day14B 结论 |
|---|------|-------------|
| 1 | kokoro-js 装进当前 monorepo 会不会破坏依赖树？ | **否**。`pnpm --filter desktop add kokoro-js@1.2.1` 干净落库，lockfile 正确更新 |
| 2 | vite build 会不会被 onnxruntime / wasm / worker 打爆？ | **否**。provider 用 `import(/* @vite-ignore */ "kokoro-js")`（变量 specifier），vite 不静态打包该模块；build 产物 768 modules、1.36MB（gzip 378KB），与安装前持平 |
| 3 | desktop vitest 能不能稳定通过？ | **能**。desktop 166 / root 226 全部 passed |
| 4 | 动态 import 是否能 resolve？ | **能**。`tryResolveKokoroModule()` 实际 resolve 到已安装的 kokoro-js（测试 274ms 拿到 exportedKeys） |
| 5 | 未下载模型时是否仍 graceful fallback？ | **是**。本阶段禁用 `from_pretrained`，`modelLoadPolicy = "disabled-in-day14b"`；即使包在，也只 resolve 不加载 |

## 2. 与 Day14A 的关系

- **Day14A**：包**未安装**，用动态 import 探测 + graceful fallback（包不在时 `isAvailable()=false`）。
- **Day14B**：包**已真实安装**到 `apps/desktop/package.json`，验证安装后工程四道基础闸门仍全绿，并显式声明本阶段不加载模型。

两层都是「可选后端」思路：真实 kokoro 是 `AudioTtsProvider → PCM` 这一段的可选实现，链路后段仍复用 Day13C 已验证的 `PcmSpectrumSource → FormantVisemeRuntimeProbe → aa/ih/ou/ee/oh`。

## 3. kokoro 关注点（修正许可证）

- **包**：`kokoro-js@1.2.1`
- **许可证**：**Apache-2.0**（npm metadata 实测）
  - ⚠️ Day13D 文档里写的「MIT」是过时判断，**以后一律按 Apache-2.0 记**。Apache-2.0 同为 permissive、无 copyleft 传染风险，可商用。
- **运行时**：浏览器 / Tauri webview 走 `onnxruntime-web`（wasm）；`onnxruntime-node` 是 transitive 依赖但本 spike 不调用原生后端。
- **中文音色**：Day14A 预留 `af_heart` 等；真正验证留到 Day14C（需联网下载模型权重）。
- **输出**：`audio.audio` 为 `Float32Array` PCM，`audio.sampling_rate` 通常为 24000 —— 可直接喂 `PcmSpectrumSource`。

## 4. 安装兼容性决策记录

| 项 | 值 |
|----|----|
| packageName | `kokoro-js` |
| expectedVersion | `1.2.1` |
| license | `Apache-2.0` |
| importMode | `dynamic` |
| modelLoadPolicy | `disabled-in-day14b` |

> 配套修复：`pnpm-workspace.yaml` 的 `allowBuilds` 原本是 pnpm 自动生成的占位符（`"set this to true or false"`），导致 onnxruntime-node / protobufjs / sharp 的构建脚本处于「未批准」状态，`pnpm exec` 的依赖检查把它们当致命错误。已补全为显式 `false`（kokoro-js 走 onnxruntime-web/wasm，不需要这三个原生构建）。该配置文件变更一并纳入本阶段提交。

## 5. Piper 本轮不进入

只评估 / 安装 kokoro；不触碰 `piper-tts` / `edge-tts` / `wlipsync`。Day14C 仍只在 kokoro 路径内深入。

## 6. 推荐 Day14C 只做一件事

**Kokoro Model Load Smoke**（仅 kokoro 路径）：

1. 联网下载 `onnx-community/Kokoro-82M-v1.0` 模型权重（首次）。
2. `KokoroTTS.from_pretrained(modelId, { dtype: "q8" })`。
3. `model.generate("中文短句", { voice: "af_heart" })`。
4. 取 `audio.audio`(Float32Array) + `audio.sampling_rate`，喂 `PcmSpectrumSource`。
5. 接 `FormantVisemeRuntimeProbe`，检查能产出 `aa/ih/ou/ee/oh`。

若 Day14B 因依赖树 / vite 打包失败 → 才转 **Day14C: Piper Install Compatibility Spike**。

## 7. 验收清单（Day14B）

- [x] kokoro-js 安装成功（package.json / pnpm-lock.yaml 正确更新）
- [x] 动态 import 不炸（tryResolveKokoroModule resolve 成功）
- [x] 不下载模型（无 from_pretrained 调用）
- [x] 不真实合成（modelLoadPolicy = disabled-in-day14b）
- [x] 不改产品 runtime（BrowserTtsController / VoidVrmSkin / LipSyncControlOverlay 未 import 新模块）
- [x] 四道基础闸门全绿（tsc / vite build / desktop vitest / root vitest）
- [x] Day14B gate 全绿

## 8. 文件清单

新增：
- `apps/desktop/src/avatar/agent/kokoro-install-compatibility.ts`
- `apps/desktop/src/avatar/agent/kokoro-install-compatibility.test.ts`
- `scripts/avatar/kokoro-install-compatibility-gate.mjs`
- `docs/avatar/day14b-kokoro-install-compatibility.md`

修改：
- `apps/desktop/src/avatar/agent/index.ts`（导出新模块）
- `package.json`（加 `avatar:kokoro-install-compatibility-gate`，desktop 加 `kokoro-js@1.2.1`）
- `pnpm-lock.yaml`（lockfile 自动更新）
- `pnpm-workspace.yaml`（补全 `allowBuilds` 为显式 false）
- `docs/avatar/day11-audio-lipsync-route.md`（路线表 + 下一步更新）
