# 对接端口文档（Integration Ports）

> 两系统已**解耦为独立开发**：WINGS（德育后端）与 Avatar OS（桌面智能体）互不直接依赖。
> 本文档定义的「对接端口」是**契约/接口**而非耦合——融合期可按需接线，平时各自演进。

---

## 一、WINGS 侧既有端口（后端**零改动**，仅记录）

WINGS 已提供以下标准接口，桌面智能体作为客户端消费即可。

### 1. SSE 实时事件流（CEP 复合预警泵站）— 主要端口
- **端点**：`GET /api/v1/notifications/stream`
- **鉴权**：标准 JWT —— `Authorization: Bearer <token>`（**不是** `?token=` 查询参数）
- **RBAC**：仅 `MS_ADMIN / GRADE_LEADER / CLASS_TEACHER` 可订阅
- **多租户红线**：payload 的 `school_id` 必须等于当前用户 `school_id`
- **事件名**：`COMPOSITE_ALERT`
- **payload 结构**：
  ```json
  {
    "type": "CRITICAL_COMPOSITE | PSYCH_RISK_ESCALATION | HABIT_CARD_SILENCE",
    "school_id": 1,
    "student_id": 123,
    "alert_id": "uuid",
    "title": "短标题",
    "summary": "详情摘要",
    "trigger": "触发因子",
    "triggered_at": "ISO8601",
    "created_at": "ISO8601"
  }
  ```
- **客户端实现要点**：浏览器 `EventSource` 无法带 Header，桌面端须用 `fetch` + `ReadableStream` 流式解析（参考适配器已示范）。

### 2. REST 只读端点（Tier1 感知层）
| 用途 | 方法 + 路径 |
|------|------------|
| 全校 RDI 摘要 | `GET /api/v1/reports/rdi-summary` |
| 危机学生看板 | `GET /api/v1/risk_models/dashboard` |
| 学生名册 | `GET /api/v1/student_registry/students`（`?grade_id=N` 可限定） |
| 成长档案看板 | `GET /api/v1/growth/dashboard` |
| 心理筛查看板 | `GET /api/v1/psych_screening/dashboard` |

> 鉴权同上：`Authorization: Bearer <token>`。端点路径以 WINGS 实际路由为准，如有变动改参考适配器即可，**不动 WINGS**。

---

## 二、桌面智能体侧对接端口

### 目录结构
```
apps/desktop/src/integration-port/
├── contract.ts              # 通用契约（类型，零耦合）
├── registry.ts              # 注册表（自包含 pub/sub，不参与激活逻辑）
└── adapters/
    └── wings.ts             # ★ 参考实现（默认不加载，tsconfig 已 exclude）
```

### 1. 通用契约 `contract.ts`
```ts
type ExternalEventKind = "crisis" | "warning" | "info";
interface ExternalEvent {
  source: string;      // 来源系统，如 "wings"
  kind: ExternalEventKind;
  title: string;
  detail?: string;
  payload?: unknown;
  timestamp?: number;
}
type ExternalEventSink = (event: ExternalEvent) => void;
```
> 不引入任何 WINGS 专属概念；WINGS 只是该端口的一个消费者。

### 2. 注册表 `registry.ts`（随构建编译，但默认无激活逻辑）
- `registerExternalSource(id, sink)` —— 注册外部源
- `unregisterExternalSource(id)` —— 注销
- `onExternalEvent(cb)` —— 融合期 UI 订阅事件（返回取消订阅函数）
- `emitExternalEvent(event)` —— 外部源推送事件，广播给订阅者

### 3. 参考适配器 `adapters/wings.ts`（⚠️ 不参与生产构建）
演示如何用上述端口接入 WINGS：
- `openStream(token, onEvent)`：`fetch` + Bearer 流式读 SSE，解析 `COMPOSITE_ALERT` → `mapPayload` → `ExternalEvent`
- `fetchRdiSummary / fetchAtRisk / fetchStudents(token)`：REST 拉取
- `draftWithOllama(prompt, model)`：接主机 `127.0.0.1:11434` 本地 LLM（敏感内容不出本机）
- `enableWingsAdapter({ token })`：启用入口，返回断开函数
- 配置读取 `.env` 的 `VITE_WINGS_API_BASE / VITE_WINGS_TOKEN / VITE_WINGS_MOCK`

---

## 三、重新融合时的接线步骤

当需要再次把两系统连通时：

1. **视觉映射（可选）**：在内核加 `Mood.ALERT` + 抖动动效（参考最初融合），或把 `ExternalEvent.kind` 映射到现有 `Mood`（crisis→SAD 等）。这一步是否做由融合期决定，**不属于当前独立开发态**。
2. **启用适配器**：在 `App.tsx` 的 `useEffect` 或 dev 入口显式调用
   ```ts
   import { enableWingsAdapter } from "./integration-port/adapters/wings";
   const stop = enableWingsAdapter({ token: import.meta.env.VITE_WINGS_TOKEN });
   ```
   （注意：此刻 `adapters/` 仍在 tsconfig exclude 中，启用时需临时移出排除，或直接在主包内引用。）
3. **融合期 UI**：用 `onExternalEvent(cb)` 订阅并渲染危机气泡/指令菜单（组件形态参考最初融合的 `WingsAlertBubble` / `WingsMenu`，它们已被移出激活代码，可按需重建）。
4. **鉴权校准**：SSE 必须走 `Authorization: Bearer`，不要再用 `?token=` 查询参数。

---

## 四、当前状态（解耦完成）

- ✅ 桌面智能体核心（mood/intent/fsm/Body/Avatar.css/intent-registry/App/Avatar）已**回退至融合前**，零 WINGS 运行时依赖。
- ✅ WINGS 后端**一行未改**。
- ✅ 对接端口（contract + registry + 参考适配器）已就位，两系统可各自独立开发。
- ✅ `pnpm --filter desktop build` 应 0 报错（参考适配器被 exclude，不参与类型检查/打包）。
