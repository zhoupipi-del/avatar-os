/**
 * 用户最近一次主动互动的时间（打字聊天、点击等）。
 * RuntimeKernel 原本只认 SPEECH_INPUT（DebugConsole），VOID 输入框聊天它感知不到，
 * 导致聊着天它还会"主动开口"。这里作为共享信号，由聊天入口写、内核读。
 */
let lastUserActivityAt = 0;

export function markUserActivity(at: number = Date.now()): void {
  lastUserActivityAt = Math.max(lastUserActivityAt, at);
}

export function getLastUserActivityAt(): number {
  return lastUserActivityAt;
}

/**
 * 她是否在电脑前：全局鼠标移动（Windows 钩子）/ 窗口内鼠标键盘都算。
 * 主动陪伴只在"人在、但有一阵没聊天"时开口——不对着空屋子说话。
 */
let lastPresenceAt = 0;

export function markPresence(at: number = Date.now()): void {
  lastPresenceAt = Math.max(lastPresenceAt, at);
}

export function getLastPresenceAt(): number {
  return lastPresenceAt;
}

export function isUserPresent(withinMs = 5 * 60_000, now: number = Date.now()): boolean {
  return now - Math.max(lastPresenceAt, lastUserActivityAt) <= withinMs;
}
