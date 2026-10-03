/**
 * ConversationMemory —— VOID 的短期对话记忆（多轮上下文）
 *
 * 此前 JsonLlmBrain 每次只把"本句话"发给 LLM，VOID 记不住上一句说了什么。
 * 本模块保存最近若干轮 user/assistant 对话，供 LLM 作为上下文；
 * 可注入存储（默认 localStorage），重启后仍记得最近的聊天。
 *
 * 只存纯文本，不存 intent/emotion（那些是一次性身体指令，不属于"记忆"）。
 */

export type ConversationRole = "user" | "assistant";

export interface ConversationTurn {
  readonly role: ConversationRole;
  readonly text: string;
  readonly at: number;
}

export interface ConversationStorage {
  load(): ConversationTurn[] | null;
  save(turns: readonly ConversationTurn[]): void;
  clear?(): void;
}

export interface ConversationMemoryOptions {
  /** 最多保留多少条消息（user+assistant 各算一条），默认 40 */
  readonly maxStored?: number;
  /** 发给 LLM 的上下文条数，默认 12（约 6 轮） */
  readonly contextSize?: number;
  /** 单条消息最大长度（防止超长粘贴撑爆上下文），默认 400 */
  readonly maxTextLength?: number;
  readonly storage?: ConversationStorage | null;
}

const STORAGE_KEY = "avataros:conversation:v1";

export class ConversationMemory {
  private turns: ConversationTurn[] = [];
  private readonly maxStored: number;
  private readonly contextSize: number;
  private readonly maxTextLength: number;
  private readonly storage: ConversationStorage | null;

  constructor(options: ConversationMemoryOptions = {}) {
    this.maxStored = Math.max(2, options.maxStored ?? 40);
    this.contextSize = Math.max(0, options.contextSize ?? 12);
    this.maxTextLength = Math.max(20, options.maxTextLength ?? 400);
    this.storage = options.storage ?? null;

    const loaded = safeLoad(this.storage);
    if (loaded) {
      this.turns = loaded.filter(isValidTurn).slice(-this.maxStored);
    }
  }

  append(role: ConversationRole, text: string, at: number = Date.now()): void {
    const clean = text.trim().slice(0, this.maxTextLength);
    if (!clean) return;
    this.turns.push({ role, text: clean, at });
    if (this.turns.length > this.maxStored) {
      this.turns = this.turns.slice(-this.maxStored);
    }
    safeSave(this.storage, this.turns);
  }

  /** 发给 LLM 的最近上下文（按时间顺序）。 */
  recent(limit: number = this.contextSize): ConversationTurn[] {
    if (limit <= 0) return [];
    return this.turns.slice(-limit);
  }

  all(): readonly ConversationTurn[] {
    return this.turns;
  }

  size(): number {
    return this.turns.length;
  }

  clear(): void {
    this.turns = [];
    try {
      if (this.storage?.clear) this.storage.clear();
      else this.storage?.save([]);
    } catch {
      // 存储失败不影响对话
    }
  }
}

function isValidTurn(t: unknown): t is ConversationTurn {
  if (!t || typeof t !== "object") return false;
  const r = t as Record<string, unknown>;
  return (
    (r.role === "user" || r.role === "assistant") &&
    typeof r.text === "string" &&
    typeof r.at === "number"
  );
}

function safeLoad(storage: ConversationStorage | null): ConversationTurn[] | null {
  if (!storage) return null;
  try {
    const v = storage.load();
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function safeSave(storage: ConversationStorage | null, turns: readonly ConversationTurn[]): void {
  if (!storage) return;
  try {
    storage.save(turns);
  } catch {
    // 配额满 / 隐私模式：静默降级为纯内存
  }
}

/** localStorage 存储（Tauri WebView 与浏览器均可用；不可用时返回 null）。 */
export function createLocalConversationStorage(key: string = STORAGE_KEY): ConversationStorage | null {
  let ls: Storage | undefined;
  try {
    ls = typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    ls = undefined;
  }
  if (!ls) return null;
  const store = ls;
  return {
    load() {
      const raw = store.getItem(key);
      return raw ? (JSON.parse(raw) as ConversationTurn[]) : null;
    },
    save(turns) {
      store.setItem(key, JSON.stringify(turns));
    },
    clear() {
      store.removeItem(key);
    },
  };
}
