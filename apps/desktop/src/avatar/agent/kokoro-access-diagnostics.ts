/**
 * Day14D — Kokoro Access Diagnostics
 *
 * 把"模型加载 / 权重下载失败"的 unknown error 分类为结构化失败类型，
 * 为 Day14E（访问策略配置：直连 / 带凭据代理 / 镜像 / 本地缓存）提供决策输入。
 *
 * 背景（Day14C 实测）：本机混合代理对 HTTPS GET 要求身份认证（401 / Invalid
 * username or password），模型权重拉取未携带凭据被拒。此类失败必须被识别为
 * "访问配置问题"而非"模块/代码问题"。
 *
 * 纯字符串分类：不发网络请求、不触发模型下载、不读文件、不写任何凭据到日志。
 *
 * 红线（本文件不做的）：
 * - 不发任何网络请求、不带任何真实凭据
 * - 不创建运行时音频对象、不接产品组件
 * - 不写表情 / 不驱动口型
 */

/** 访问失败分类。 */
export type KokoroAccessFailureKind =
  | "none"
  | "proxy-auth-required"
  | "hf-unauthorized"
  | "network-unreachable"
  | "model-not-found"
  | "module-missing"
  | "api-missing"
  | "model-load-failed"
  | "unknown";

export interface KokoroAccessClassification {
  readonly kind: KokoroAccessFailureKind;
  /** 分类命中的证据片段（已脱敏，不含凭据） */
  readonly evidence: string;
}

export interface KokoroAccessReportInput {
  /** 模块是否可加载（动态 import 成功） */
  readonly moduleLoaded: boolean;
  /** 模块是否暴露预期 API（from_pretrained 等） */
  readonly apiAvailable: boolean;
  /** 模型加载/合成阶段的错误（无错误传 null） */
  readonly error: unknown;
}

export interface KokoroAccessReport {
  readonly kind: KokoroAccessFailureKind;
  readonly evidence: string;
  readonly hint: string;
  /** 是否属于"访问/网络配置问题"（而非代码问题） */
  readonly isAccessIssue: boolean;
}

/** 把 unknown error 安全转成可匹配的字符串（不 throw）。 */
function errorToText(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return "";
  }
}

/**
 * 分类模型访问错误。
 * 匹配优先级：代理认证 > HF 未授权 > 网络不可达 > 模型不存在 > 其他加载失败。
 */
export function classifyKokoroAccessError(error: unknown): KokoroAccessClassification {
  const text = errorToText(error);
  if (!text) return { kind: "none", evidence: "" };
  const lower = text.toLowerCase();

  // 代理认证失败（本机实测：混合代理对 HTTPS GET 返回 401 + Invalid username or password）
  if (
    lower.includes("invalid username or password") ||
    lower.includes("proxy authentication required") ||
    lower.includes("407")
  ) {
    return { kind: "proxy-auth-required", evidence: firstEvidenceLine(text) };
  }

  // 401 / Unauthorized：可能是代理拦截，也可能是 HF 侧鉴权
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return { kind: "hf-unauthorized", evidence: firstEvidenceLine(text) };
  }

  // 网络不可达
  if (
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("network") && lower.includes("unreach") ||
    lower.includes("fetch failed")
  ) {
    return { kind: "network-unreachable", evidence: firstEvidenceLine(text) };
  }

  // 模型仓库/文件不存在
  if (lower.includes("404") || lower.includes("not found")) {
    return { kind: "model-not-found", evidence: firstEvidenceLine(text) };
  }

  // 模块无法解析
  if (
    lower.includes("cannot find module") ||
    lower.includes("failed to resolve") ||
    lower.includes("module not found")
  ) {
    return { kind: "module-missing", evidence: firstEvidenceLine(text) };
  }

  // API 缺失
  if (lower.includes("is not a function") || lower.includes("is not a constructor")) {
    return { kind: "api-missing", evidence: firstEvidenceLine(text) };
  }

  return { kind: "model-load-failed", evidence: firstEvidenceLine(text) };
}

/** 取错误文本首行作为证据（截断到 200 字符，避免日志噪声；不含凭据）。 */
function firstEvidenceLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}...` : line;
}

/** 每个失败分类的修复提示（不含任何明文凭据 / 密码 / token 值）。 */
export function getKokoroAccessHint(kind: KokoroAccessFailureKind): string {
  switch (kind) {
    case "none":
      return "No access failure detected.";
    case "proxy-auth-required":
      return "Local proxy requires authentication for HTTPS GET. Options: configure proxy credentials via environment (do NOT hardcode), allowlist the model host in proxy rules, or use a mirror endpoint. Deferred to Day14E access-configuration smoke.";
    case "hf-unauthorized":
      return "Remote returned 401/Unauthorized. Either the proxy intercepted the request or the model host requires a token. Verify proxy pass-through first, then consider a mirror endpoint. Deferred to Day14E.";
    case "network-unreachable":
      return "Network unreachable (DNS/connect/timeout). Check connectivity, proxy availability, or switch to offline local cache.";
    case "model-not-found":
      return "Model repository or file returned 404. Verify the model id and file paths.";
    case "module-missing":
      return "TTS module cannot be resolved. Verify the dependency is installed in the desktop package manifest.";
    case "api-missing":
      return "TTS module resolved but the expected API surface is missing. Verify the installed package version.";
    case "model-load-failed":
      return "Model load/synthesis failed for a non-network reason. Inspect the evidence line and rerun the env-gated smoke.";
    case "unknown":
    default:
      return "Unclassified failure. Inspect the raw error and extend the classifier if a stable pattern emerges.";
  }
}

/**
 * 汇总访问诊断报告：模块状态 + 错误分类 + 提示。
 * 输入错误为 null 且模块/API 正常时 kind="none"。
 */
export function buildKokoroAccessReport(input: KokoroAccessReportInput): KokoroAccessReport {
  if (!input.moduleLoaded) {
    return {
      kind: "module-missing",
      evidence: "module not loaded",
      hint: getKokoroAccessHint("module-missing"),
      isAccessIssue: false,
    };
  }
  if (!input.apiAvailable) {
    return {
      kind: "api-missing",
      evidence: "expected API not exposed",
      hint: getKokoroAccessHint("api-missing"),
      isAccessIssue: false,
    };
  }
  const classified = classifyKokoroAccessError(input.error);
  const accessKinds: ReadonlyArray<KokoroAccessFailureKind> = [
    "proxy-auth-required",
    "hf-unauthorized",
    "network-unreachable",
  ];
  return {
    kind: classified.kind,
    evidence: classified.evidence,
    hint: getKokoroAccessHint(classified.kind),
    isAccessIssue: accessKinds.includes(classified.kind),
  };
}
