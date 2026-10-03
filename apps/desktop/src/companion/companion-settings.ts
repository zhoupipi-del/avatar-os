/**
 * companion-settings —— 「陪伴」配置的单一事实源
 *
 * 优先级（低 → 高）：内置默认 < 构建期环境变量（.env.local，可把 Key/人设预置进安装包）
 *                    < 用户在 ⚙ 设置里改的值（localStorage）
 * 锁定模式（VITE_COMPANION_LOCK_SETTINGS=true）：设置界面隐藏大脑/人设项，且忽略本地覆盖，
 * 适合"打包好送人、对方只管用"的场景。
 */

export type BrainMode = "cloud" | "ollama" | "rule";
export type CloudPresetId = "deepseek" | "qwen" | "custom";
/** system = Windows 自带语音；clone = 云端合成（可用你自己的克隆声音） */
export type VoiceMode = "system" | "clone";

/**
 * 云端语音默认值：硅基流动（SiliconFlow）OpenAI 兼容 /audio/speech + CosyVoice2。
 * 声音复刻：上传 8–10 秒单人参考音频 + 对应文字 → 返回 voice uri（speech:...）。
 */
export const VOICE_DEFAULTS = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "FunAudioLLM/CosyVoice2-0.5B",
  keyUrl: "https://cloud.siliconflow.cn/account/ak",
} as const;

export interface CloudPreset {
  readonly id: CloudPresetId;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly jsonMode: boolean;
  /** 申请 Key 的地方（落地指南 / 设置界面提示用） */
  readonly keyUrl: string;
}

export const CLOUD_PRESETS: Record<CloudPresetId, CloudPreset> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    jsonMode: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  qwen: {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    jsonMode: false,
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  custom: {
    id: "custom",
    label: "其他 OpenAI 兼容接口",
    baseUrl: "",
    model: "",
    jsonMode: false,
    keyUrl: "",
  },
};

export interface CompanionSettings {
  brainMode: BrainMode;
  cloudPreset: CloudPresetId;
  cloudBaseUrl: string;
  cloudModel: string;
  cloudApiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  /** 角色名（就是你的名字 / 昵称），出现在输入框提示与人设里 */
  companionName: string;
  /** 角色怎么称呼她 */
  userNickname: string;
  /** 人设正文；空字符串 = 用 persona.local.md / persona.example.md */
  personaText: string;
  /** 主动找她说话 */
  proactiveEnabled: boolean;
  /** 两次主动说话的最小间隔（分钟） */
  proactiveIntervalMin: number;
  /** 安静时段（整点，本地时间）：start==end 表示不设 */
  quietStartHour: number;
  quietEndHour: number;
  /** 朗读用哪种声音 */
  voiceMode: VoiceMode;
  voiceBaseUrl: string;
  voiceApiKey: string;
  voiceModel: string;
  /** 克隆声音的 uri（speech:...），或厂商预置音色名 */
  voiceId: string;
}

export type CompanionEnv = Partial<Record<string, string | undefined>>;

const STORAGE_KEY = "avataros:companion-settings:v1";

/** 锁定时这些字段只认构建期配置，不认本地覆盖 */
export const LOCKABLE_FIELDS: ReadonlyArray<keyof CompanionSettings> = [
  "brainMode",
  "cloudPreset",
  "cloudBaseUrl",
  "cloudModel",
  "cloudApiKey",
  "ollamaEndpoint",
  "ollamaModel",
  "companionName",
  "userNickname",
  "personaText",
  "voiceMode",
  "voiceBaseUrl",
  "voiceApiKey",
  "voiceModel",
  "voiceId",
];

export function isSettingsLocked(env: CompanionEnv = viteEnv()): boolean {
  return /^(1|true|yes)$/i.test((env.VITE_COMPANION_LOCK_SETTINGS ?? "").trim());
}

export function defaultSettingsFromEnv(env: CompanionEnv = viteEnv()): CompanionSettings {
  const pick = (k: string) => env[k]?.trim() || undefined;
  const presetId = (pick("VITE_CLOUD_PRESET") as CloudPresetId | undefined) ?? "deepseek";
  const preset = CLOUD_PRESETS[presetId] ?? CLOUD_PRESETS.deepseek;
  const apiKey = pick("VITE_CLOUD_API_KEY") ?? "";
  const rawMode = pick("VITE_AVATAROS_BRAIN_MODE")?.toLowerCase();
  const brainMode: BrainMode =
    rawMode === "cloud" || rawMode === "ollama" || rawMode === "rule"
      ? rawMode
      : apiKey
        ? "cloud"
        : "ollama";

  return {
    brainMode,
    cloudPreset: preset.id,
    cloudBaseUrl: pick("VITE_CLOUD_BASE_URL") ?? preset.baseUrl,
    cloudModel: pick("VITE_CLOUD_MODEL") ?? preset.model,
    cloudApiKey: apiKey,
    ollamaEndpoint: pick("VITE_OLLAMA_ENDPOINT") ?? "http://127.0.0.1:11434",
    ollamaModel: pick("VITE_OLLAMA_MODEL") ?? "qwen2.5:7b",
    companionName: pick("VITE_COMPANION_NAME") ?? "VOID",
    userNickname: pick("VITE_COMPANION_NICKNAME") ?? "",
    personaText: "",
    proactiveEnabled: !/^(0|false|no)$/i.test(pick("VITE_COMPANION_PROACTIVE") ?? "true"),
    proactiveIntervalMin: clampInt(Number(pick("VITE_COMPANION_PROACTIVE_MINUTES") ?? 45), 5, 24 * 60),
    quietStartHour: clampInt(Number(pick("VITE_COMPANION_QUIET_START") ?? 0), 0, 23),
    quietEndHour: clampInt(Number(pick("VITE_COMPANION_QUIET_END") ?? 8), 0, 23),
    voiceMode: resolveVoiceMode(pick("VITE_VOICE_MODE"), pick("VITE_VOICE_ID"), pick("VITE_VOICE_API_KEY")),
    voiceBaseUrl: pick("VITE_VOICE_BASE_URL") ?? VOICE_DEFAULTS.baseUrl,
    voiceApiKey: pick("VITE_VOICE_API_KEY") ?? "",
    voiceModel: pick("VITE_VOICE_MODEL") ?? VOICE_DEFAULTS.model,
    voiceId: pick("VITE_VOICE_ID") ?? "",
  };
}

export interface SettingsStorage {
  load(): Partial<CompanionSettings> | null;
  save(value: Partial<CompanionSettings>): void;
}

export class CompanionSettingsStore {
  private overrides: Partial<CompanionSettings>;
  private readonly listeners = new Set<(s: CompanionSettings) => void>();
  private cached: CompanionSettings;

  constructor(
    private readonly defaults: CompanionSettings,
    private readonly storage: SettingsStorage | null,
    private readonly locked: boolean,
  ) {
    let loaded: Partial<CompanionSettings> | null = null;
    try {
      loaded = storage?.load() ?? null;
    } catch {
      loaded = null;
    }
    this.overrides = sanitize(loaded ?? {});
    this.cached = this.compute();
  }

  get(): CompanionSettings {
    return this.cached;
  }

  isLocked(): boolean {
    return this.locked;
  }

  update(patch: Partial<CompanionSettings>): void {
    this.overrides = sanitize({ ...this.overrides, ...patch });
    try {
      this.storage?.save(this.overrides);
    } catch {
      // 存储不可用：仍在内存生效
    }
    this.cached = this.compute();
    this.listeners.forEach((l) => l(this.cached));
  }

  /** 选择预设：同时把接口地址/模型重置为该预设的默认值 */
  applyPreset(id: CloudPresetId): void {
    const preset = CLOUD_PRESETS[id];
    this.update({ cloudPreset: id, cloudBaseUrl: preset.baseUrl, cloudModel: preset.model });
  }

  reset(fields: ReadonlyArray<keyof CompanionSettings>): void {
    const next = { ...this.overrides };
    fields.forEach((f) => delete next[f]);
    this.overrides = {};
    this.update(next);
  }

  subscribe(listener: (s: CompanionSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private compute(): CompanionSettings {
    const merged = { ...this.defaults, ...this.overrides };
    if (this.locked) {
      for (const f of LOCKABLE_FIELDS) {
        (merged as Record<string, unknown>)[f] = this.defaults[f];
      }
    }
    return merged;
  }
}

function resolveVoiceMode(raw: string | undefined, voiceId: string | undefined, apiKey: string | undefined): VoiceMode {
  const v = raw?.toLowerCase();
  if (v === "clone" || v === "cloud") return "clone";
  if (v === "system") return "system";
  return voiceId && apiKey ? "clone" : "system";
}

/** 克隆声音是否配置齐全（不齐全时朗读退回系统语音） */
export function isCloneVoiceReady(s: Pick<CompanionSettings, "voiceMode" | "voiceBaseUrl" | "voiceApiKey" | "voiceModel" | "voiceId">): boolean {
  return s.voiceMode === "clone" && !!s.voiceBaseUrl.trim() && !!s.voiceApiKey.trim() && !!s.voiceModel.trim() && !!s.voiceId.trim();
}

/** 是否处于安静时段（不主动说话）。start==end 视为未设置；支持跨午夜（如 23→7）。 */
export function isQuietHour(settings: Pick<CompanionSettings, "quietStartHour" | "quietEndHour">, date = new Date()): boolean {
  const { quietStartHour: s, quietEndHour: e } = settings;
  if (s === e) return false;
  const h = date.getHours();
  return s < e ? h >= s && h < e : h >= s || h < e;
}

export function cloudPresetLabel(settings: CompanionSettings): string {
  return CLOUD_PRESETS[settings.cloudPreset]?.label ?? "云端模型";
}

function sanitize(input: Partial<CompanionSettings>): Partial<CompanionSettings> {
  const out: Partial<CompanionSettings> = {};
  const src = input as Record<string, unknown>;
  const str = (k: keyof CompanionSettings) => {
    if (typeof src[k] === "string") (out as Record<string, unknown>)[k] = src[k];
  };
  (["cloudBaseUrl", "cloudModel", "cloudApiKey", "ollamaEndpoint", "ollamaModel", "companionName", "userNickname", "personaText", "voiceBaseUrl", "voiceApiKey", "voiceModel", "voiceId"] as const).forEach(str);
  if (src.voiceMode === "system" || src.voiceMode === "clone") out.voiceMode = src.voiceMode;
  if (src.brainMode === "cloud" || src.brainMode === "ollama" || src.brainMode === "rule") out.brainMode = src.brainMode;
  if (typeof src.cloudPreset === "string" && src.cloudPreset in CLOUD_PRESETS) out.cloudPreset = src.cloudPreset as CloudPresetId;
  if (typeof src.proactiveEnabled === "boolean") out.proactiveEnabled = src.proactiveEnabled;
  if (Number.isFinite(src.proactiveIntervalMin)) out.proactiveIntervalMin = clampInt(src.proactiveIntervalMin as number, 5, 24 * 60);
  if (Number.isFinite(src.quietStartHour)) out.quietStartHour = clampInt(src.quietStartHour as number, 0, 23);
  if (Number.isFinite(src.quietEndHour)) out.quietEndHour = clampInt(src.quietEndHour as number, 0, 23);
  return out;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function viteEnv(): CompanionEnv {
  try {
    return (import.meta as unknown as { env?: CompanionEnv }).env ?? {};
  } catch {
    return {};
  }
}

function localSettingsStorage(): SettingsStorage | null {
  let ls: Storage | undefined;
  try {
    ls = typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    ls = undefined;
  }
  if (!ls) return null;
  const store = ls;
  return {
    load: () => {
      const raw = store.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<CompanionSettings>) : null;
    },
    save: (v) => store.setItem(STORAGE_KEY, JSON.stringify(v)),
  };
}

/** 全局单例（对话大脑、主动陪伴、设置界面共用） */
export const companionSettings = new CompanionSettingsStore(
  defaultSettingsFromEnv(),
  localSettingsStorage(),
  isSettingsLocked(),
);
