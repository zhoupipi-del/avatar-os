import { ConversationMemory, createLocalConversationStorage } from "../avatar/agent/conversation-memory";

/** 全局对话记忆（对话大脑与主动陪伴共用，主动说的话也会记进去） */
export const conversationStore = new ConversationMemory({ storage: createLocalConversationStorage() });

/** 给主动陪伴用的最近对话（纯文本，按时间顺序） */
export function recentConversationLines(limit = 8, myName = "我"): string[] {
  return conversationStore.recent(limit).map((t) => `${t.role === "user" ? "她" : myName}：${t.text}`);
}
