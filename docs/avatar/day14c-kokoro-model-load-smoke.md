# Day14C — Kokoro Model Load Smoke

> 生成于 Day14C（2026-07-29）。配套代码：`apps/desktop/src/avatar/agent/kokoro-model-smoke.ts`
> gate：`scripts/avatar/kokoro-model-smoke-gate.mjs`

## 0. 目标

Day14C 是 Kokoro 真实模型加载的冒烟测试：**第一次允许 `from_pretrained` / `generate` 真实合成**。

```
kokoro-js → model load → generate short text → inspect audio output
  → try extract PCM → feed PcmSpectrumSource/Formant pipeline → produce viseme result
```

不是产品接线，不是替换 BrowserTTS，不是让 VOID 嘴动。

## 1. 与 Day14A/B 的关系

| 阶段 | 做了什么 | from_pretrained | generate |
|------|---------|-----------------|----------|
| Day14A | 动态 import 探测（未安装时 graceful fallback） | 代码已就位但未实际安装包 | 同左 |
| Day14B | 真安装 kokoro-js@1.2.1，验证四道基础闸门兼容 | **禁用** | **禁用** |
| **Day14C（本步）** | **允许真实模型加载 + 合成 + PCM 提取 + formant 分析** | **允许** | **允许** |

## 2. 环境门控

真实模型下载**不进普通 gate / CI**。用环境变量 `AVATAROS_RUN_KOKORO_MODEL_SMOKE` 手动开启：

```bash
# 普通测试（不下载模型、不真实合成）
pnpm --filter desktop exec vitest run

# 手动真实 smoke（下载模型 ~100MB，需联网）
AVATAROS_RUN_KOKORO_MODEL_SMOKE=1 pnpm --filter desktop exec vitest run
```

设为 `"1"` / `"true"` / `"yes"`（大小写不敏感）时 `shouldRunKokoroModelSmoke()` 返回 `true`。

## 3. 新增文件

### `kokoro-model-smoke.ts`（7 个函数）

| 函数 | 职责 |
|------|------|
| `getKokoroModelSmokeConfig()` | 返回静态配置（env var 名 / model ID / 默认音色 / dtype / policy） |
| `shouldRunKokoroModelSmoke()` | 读环境变量，判断是否允许真实模型加载 |
| `loadKokoroModuleForSmoke()` | 动态 import kokoro-js（变量 specifier + @vite-ignore） |
| `inspectKokoroModule(mod)` | 检查模块导出，提取 KokoroTTS 构造器 |
| `runKokoroModelLoadSmoke(text?, options?)` | 真实冒烟：from_pretrained → generate → 提取 PCM |
| `extractKokoroPcmFromUnknownOutput(output)` | 防御性提取 PCM（尝试 audio/pcm/data/samples/waveform + sampling_rate/sampleRate/sr/sample_rate） |
| `analyzeKokoroPcmSmoke(pcm, frameCount?)` | PCM → PcmSpectrumSource → FormantVisemeRuntimeProbe → 逐帧分析 |

### `kokoro-model-smoke.test.ts`（8 个测试用例）

1. `getKokoroModelSmokeConfig` 返回完整配置
2. `shouldRunKokoroModelSmoke` 无 env var 时返回 false
3. `shouldRunKokoroModelSmoke` env var 为 1/true/yes 时返回 true
4. `loadKokoroModuleForSmoke` resolve 到真实模块（kokoro-js@1.2.1 已安装）
5. `inspectKokoroModule` 找到 KokoroTTS 构造器
6. `extractKokoroPcmFromUnknownOutput` 从标准 RawAudio 提取 PCM
7. `extractKokoroPcmFromUnknownOutput` 处理异构字段名 + 无效输入返回 null
8. `analyzeKokoroPcmSmoke` 从合成元音 PCM 产生 viseme 结果

### `kokoro-model-smoke-gate.mjs`（9 条 gate 规则）

1. REQUIRED_FILES 存在
2. 7 个函数存在于 smoke.ts
3. shouldRunKokoroModelSmoke 使用正确的 env var 名
4. from_pretrained( 和 .generate( 存在于 smoke.ts（Day14C 允许）
5. 三个产品文件不 import smoke 模块
6. kokoro-js 字面量仅在白名单文件
7. 禁用词（仅查本 milestone 新增文件；不含 from_pretrained/generate）
8. 新模块不反向 import runtime / 产品组件
9. 四道基础闸门全绿

## 4. kokoro-js 真实 API（验真结果）

来源：`node_modules/.pnpm/kokoro-js@1.2.1/node_modules/kokoro-js/types/kokoro.d.ts`

```typescript
class KokoroTTS {
  static from_pretrained(model_id: string, {
    dtype?: "fp32"|"fp16"|"q8"|"q4"|"q4f16",
    device?: "wasm"|"webgpu"|"cpu"|null,
    progress_callback?: ProgressCallback
  }): Promise<KokoroTTS>;

  generate(text: string, {
    voice?: keyof typeof VOICES,  // 默认 "af_heart"
    speed?: number                // 默认 1
  }): Promise<RawAudio>;
  // RawAudio = { audio: Float32Array, sampling_rate: number }
}
```

- 版本：1.2.1，许可证：Apache-2.0
- 默认采样率：24000 Hz
- browser shim：`path: false, fs/promises: false`
- 依赖：`@huggingface/transformers` ^3.5.1, `phonemizer` ^1.2.1

## 5. 手动真实 Smoke 流程

```bash
# 1. 设置环境变量
export AVATAROS_RUN_KOKORO_MODEL_SMOKE=1

# 2. 运行（首次会下载 ~100MB 模型权重）
pnpm --filter desktop exec vitest run src/avatar/agent/kokoro-model-smoke.test.ts

# 3. 或在 Node REPL 中手动调用
node -e "
  const { shouldRunKokoroModelSmoke, runKokoroModelLoadSmoke, analyzeKokoroPcmSmoke } =
    await import('./apps/desktop/src/avatar/agent/kokoro-model-smoke.ts');
  if (!shouldRunKokoroModelSmoke()) { console.log('Set AVATAROS_RUN_KOKORO_MODEL_SMOKE=1'); process.exit(1); }
  const smoke = await runKokoroModelLoadSmoke('Hello world');
  console.log('PCM:', smoke.pcm);
  console.log('Error:', smoke.error);
  if (smoke.pcm) {
    const analysis = analyzeKokoroPcmSmoke(smoke.pcm, 10);
    console.log('Visemes:', analysis.results.map(r => r.reason));
    console.log('Active:', analysis.activeCount);
  }
"
```

## 6. 红线（本步已遵守）

- 不接产品 runtime、不驱动 VOID 嘴型
- 不创建音频上下文 / 不创建音频节点
- 不改 BrowserTtsController / VoidVrmSkin / LipSyncControlOverlay
- 不写 expression / 不驱动口型
- 不复制 SAP AGPL 源码
- 真实模型加载仅限 smoke 文件，用环境变量门控

## 7. 下一步

- **Day14C 成功** → Day14D：Kokoro → PCM → Formant pipeline 稳定化（输出归一化 / 边界处理 / 性能优化）
- **Day14C 失败**（模型下载失败 / 合成异常 / PCM 提取失败）→ Day14D：Failure Report + 转 Piper 候选
- **Day15**：再考虑接产品 runtime（让 VOID 真实嘴型动起来）
