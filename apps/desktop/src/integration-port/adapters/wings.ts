// ============================================================================
// ⚠️  参考实现 (REFERENCE ONLY) — 默认不加载，不参与生产构建
// ----------------------------------------------------------------------------
// 本文件演示「如何用通用对接端口(../contract + ../registry)接入 WINGS 德育平台」。
// 它【不会】被 App.tsx / Avatar.tsx 引用，且已在 tsconfig 的 exclude 中，
// 因此不会进入 tsc 类型检查与 vite 打包。
//
// 重新融合时：在 dev 或显式入口处 `import` 本模块并调用 enableWingsAdapter()，
// 同时按 INTEGRATION_PORTS.md 的"重新融合接线步骤"把视觉映射接回内核即可。
// ============================================================================

import { emitExternalEvent, registerExternalSource, unregisterExternalSource } from "../registry";
import type { ExternalEvent, ExternalEventKind } from "../contract";

// ---- 配置（读取 .env 中的 VITE_WINGS_*，缺失时回退默认值） ----
const ENV = (import.meta as any).env ?? {};
const API_BASE: string = ENV.VITE_WINGS_API_BASE ?? "https://lijiangschool.online/api/v1";
const DEFAULT_TOKEN: string = ENV.VITE_WINGS_TOKEN ?? "";
const USE_MOCK: boolean = ENV.VITE_WINGS_MOCK === "true" || ENV.VITE_WINGS_MOCK === true;

// ----------------------------------------------------------------------------
// 1) SSE 实时事件流（CEP 复合预警泵站）
//    鉴权：WINGS 走标准 JWT —— Authorization: Bearer <token>
//          （注意：不是 ?token= 查询参数；浏览器 EventSource 无法带 Header，
//           故桌面端必须用 fetch 流式读取，见下方 openStream）
//    事件名：COMPOSITE_ALERT
//    payload: { type, school_id, student_id, alert_id, title, summary, trigger, triggered_at, created_at }
// ----------------------------------------------------------------------------

/** WINGS CEP payload → 通用 ExternalEvent */
function mapPayload(p: any): ExternalEvent {
  const tag = String(p?.type ?? p?.trigger ?? "").toUpperCase();
  // 严重度分级（参考，可后续细化）
  let kind: ExternalEventKind = "info";
  if (tag.includes("CRITICAL") || tag.includes("ESCALATION")) kind = "crisis";
  else if (tag.includes("SILENCE") || tag.includes("PENDING")) kind = "warning";
  return {
    source: "wings",
    kind,
    title: p?.title ?? "德育预警",
    detail: p?.summary ?? "",
    payload: p,
  };
}

/** 用 fetch + Bearer 流式读取 SSE，返回断开函数 */
function openStream(token: string, onEvent: (e: ExternalEvent) => void): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        console.error(`[WINGS adapter] SSE open failed: ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const ev = frame.match(/event:\s*(.+)/)?.[1]?.trim();
          const data = frame.match(/data:\s*([\s\S]*)/)?.[1];
          if (!data || ev !== "COMPOSITE_ALERT") continue;
          try {
            onEvent(mapPayload(JSON.parse(data)));
          } catch {
            /* 忽略非法 JSON */
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") console.error("[WINGS adapter] SSE error", err);
    }
  })();
  return () => ctrl.abort();
}

// ----------------------------------------------------------------------------
// 2) REST 只读拉取（Tier1 感知层，仍走标准 JWT）
// ----------------------------------------------------------------------------

async function authedFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/** 全校 RDI 摘要（真实端点：/api/v1/reports/rdi-summary） */
export function fetchRdiSummary(token: string) {
  return authedFetch("/reports/rdi-summary", token);
}

/** 危机学生看板（真实端点：/api/v1/risk_models/dashboard） */
export function fetchAtRisk(token: string) {
  return authedFetch("/risk_models/dashboard", token);
}

/** 学生名册（真实端点：/api/v1/student_registry/students） */
export function fetchStudents(token: string, gradeId?: number) {
  const q = gradeId ? `?grade_id=${gradeId}` : "";
  return authedFetch(`/student_registry/students${q}`, token);
}

// ----------------------------------------------------------------------------
// 3) 本地 LLM 副驾（Tier2，接主机已运行的 Ollama，敏感内容不出本机）
// ----------------------------------------------------------------------------

export async function draftWithOllama(
  prompt: string,
  model = "deepseek-r1:8b",
): Promise<string> {
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  const data = await res.json();
  return data?.response ?? "";
}

// ----------------------------------------------------------------------------
// 4) Mock 模式（本地开发无后端时轮播三类危机，验证端口贯通）
// ----------------------------------------------------------------------------

function startMockStream(onEvent: (e: ExternalEvent) => void): () => void {
  const samples: ExternalEvent[] = [
    { source: "wings", kind: "crisis", title: "复合危机预警", detail: "2501班 张同学 行为+心理双维度下滑" },
    { source: "wings", kind: "warning", title: "习惯卡沉默", detail: "3 名学生连续 5 天未打卡" },
    { source: "wings", kind: "info", title: "心理风险随访", detail: "李同学筛查风险已降级" },
  ];
  let i = 0;
  const t = setInterval(() => {
    onEvent(samples[i % samples.length]);
    i++;
  }, 13_000);
  return () => clearInterval(t);
}

// ----------------------------------------------------------------------------
// 5) 适配器入口（融合期显式启用；默认不被任何代码调用）
// ----------------------------------------------------------------------------

export interface WingsAdapterConfig {
  token: string;
  apiBase?: string;
  mock?: boolean;
}

/** 启用 WINGS 适配器：注册源 + 打开 SSE，返回断开函数 */
export function enableWingsAdapter(cfg: WingsAdapterConfig): () => void {
  const apiBase = cfg.apiBase ?? API_BASE;
  const mock = cfg.mock ?? USE_MOCK;
  const token = cfg.token || DEFAULT_TOKEN;

  const disconnect = mock
    ? startMockStream((e) => emitExternalEvent(e))
    : openStream(token, (e) => emitExternalEvent(e));

  registerExternalSource("wings", () => {
    /* 融合期可在此做握手/心跳 */
  });

  return () => {
    disconnect();
    unregisterExternalSource("wings");
  };
}
