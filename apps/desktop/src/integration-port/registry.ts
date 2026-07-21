// ============================================================
// 对接端口注册表 (Integration Port Registry)
// ------------------------------------------------------------
// 自包含的发布/订阅，不污染内核事件总线(kernelEventBus)。
//   - 融合期适配器（如 WINGS）经 registerExternalSource 接入；
//   - 融合期 UI 经 onExternalEvent 订阅并渲染气泡/菜单。
//
// 核心 App / Avatar 默认【不】加载任何外部源，保证两系统独立开发。
// 本文件随构建参与编译（是"端口"本身），但默认无激活逻辑。
// ============================================================

import type {
  ExternalEvent,
  ExternalEventSink,
  ExternalSourceId,
} from "./contract";

const sinks = new Map<ExternalSourceId, ExternalEventSink>();
const listeners = new Set<(event: ExternalEvent) => void>();

/** 注册一个外部事件源（如 WINGS 适配器，融合期调用） */
export function registerExternalSource(
  id: ExternalSourceId,
  sink: ExternalEventSink,
): void {
  sinks.set(id, sink);
  console.info(`[IntegrationPort] source registered: ${id}`);
}

/** 注销外部事件源 */
export function unregisterExternalSource(id: ExternalSourceId): void {
  sinks.delete(id);
  console.info(`[IntegrationPort] source unregistered: ${id}`);
}

/** 融合期 UI 订阅外部事件（如危机气泡组件） */
export function onExternalEvent(cb: (event: ExternalEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 外部源调用此函数把事件推入端口，广播给所有订阅者 */
export function emitExternalEvent(event: ExternalEvent): void {
  const full: ExternalEvent = { timestamp: Date.now(), ...event };
  listeners.forEach((cb) => {
    try {
      cb(full);
    } catch (err) {
      console.error(
        `[IntegrationPort] listener error for source=${event.source}`,
        err,
      );
    }
  });
}
