/**
 * Day14B — Kokoro Install Compatibility Spike
 *
 * 目标：验证 kokoro-js 是否真的装进了 AvatarOS 当前 Vite / Tauri / Vitest / TypeScript 工程，
 * 且动态 import 能 resolve。本阶段只验证依赖安装与动态 import resolve，
 * 不下载模型、不真实合成、不接产品 runtime。
 *
 *   pnpm add kokoro-js@1.2.1
 *     -> tsc / vite build / vitest 不炸
 *     -> import("kokoro-js") 能 resolve
 *     -> 不调用 from_pretrained（不加载模型）
 *
 * 与 Day14A 的关系：Day14A 用动态 import 探测（包未装时 graceful fallback）。
 * Day14B 把 kokoro-js 真正写入 dependencies，验证安装后工程仍兼容，
 * 并显式声明本阶段禁用真实模型加载。
 *
 * 红线（不做的）：
 * - 不创建音频上下文 / 不创建音频节点
 * - 不改既有产品语音控制器 / 皮肤组件 / 口型面板
 * - 不写 expression / 不驱动口型
 * - 不调用 from_pretrained / 不下载模型权重 / 不真实合成
 */

/** kokoro-js 候选包 specifier（字符串常量，动态 import 探测用）。 */
const KOKORO_JS_SPECIFIER = "kokoro-js";

/** Day14B 验证用的期望版本（pnpm view 实测）。 */
const KOKORO_JS_EXPECTED_VERSION = "1.2.1";

/** Day14B 验证用的许可证（npm metadata 实测，Apache-2.0；修正 Day13D 文档里的过时 MIT 判断）。 */
const KOKORO_JS_LICENSE = "Apache-2.0";

/** 安装兼容性静态元数据。 */
export interface KokoroInstallCompatibility {
  packageName: string;
  expectedVersion: string;
  license: string;
  importMode: "dynamic";
  modelLoadPolicy: "disabled-in-day14b";
}

/**
 * 返回 kokoro-js 的安装兼容性元数据。
 * 纯静态声明，不触发任何 import / 网络 / 模型加载。
 */
export function getKokoroInstallCompatibility(): KokoroInstallCompatibility {
  return {
    packageName: KOKORO_JS_SPECIFIER,
    expectedVersion: KOKORO_JS_EXPECTED_VERSION,
    license: KOKORO_JS_LICENSE,
    importMode: "dynamic",
    modelLoadPolicy: "disabled-in-day14b",
  };
}

/** 动态 import 解析结果。 */
export interface KokoroModuleResolution {
  available: boolean;
  exportedKeys: string[];
  error?: string;
}

/**
 * 用动态 import 探测 kokoro-js 是否能 resolve。
 * 成功返回 { available:true, exportedKeys }；失败返回 { available:false, error }。
 *
 * 关键：只 resolve 模块、枚举导出名，**绝不调用 from_pretrained / 不下载模型 / 不真实合成**。
 * 用变量 specifier（KOKORO_JS_SPECIFIER as string）+ /* @vite-ignore *\/，
 * 使 tsc / vite 不静态解析、不把 kokoro-js 打进产物。
 */
export async function tryResolveKokoroModule(): Promise<KokoroModuleResolution> {
  try {
    const mod: any = await import(/* @vite-ignore */ KOKORO_JS_SPECIFIER as string);
    const ns = mod && typeof mod === "object" ? mod : {};
    const exportedKeys = Object.keys(ns);
    return { available: true, exportedKeys };
  } catch (err) {
    return {
      available: false,
      exportedKeys: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 断言 Day14B 阶段禁用真实模型加载。
 * 返回 true 表示 modelLoadPolicy 为 "disabled-in-day14b"。
 */
export function assertKokoroModelLoadDisabled(): boolean {
  return getKokoroInstallCompatibility().modelLoadPolicy === "disabled-in-day14b";
}
