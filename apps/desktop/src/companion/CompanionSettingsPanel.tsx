/**
 * 陪伴设置面板（⚙ 抽屉内）：大脑来源 / API Key / 人设 / 声音 / 主动陪伴。
 * 锁定模式（VITE_COMPANION_LOCK_SETTINGS=true）下只显示主动陪伴开关，Key 与人设不可见。
 */
import { useState } from "react";
import {
  CLOUD_PRESETS,
  VOICE_DEFAULTS,
  companionSettings,
  type BrainMode,
  type CloudPresetId,
  type VoiceMode,
} from "./companion-settings";
import { uploadVoiceSample } from "./cloud-voice";
import { localFetch } from "../platform/local-fetch";
import { useCompanionSettings } from "./useCompanionSettings";
import { bundledPersona, hasLocalPersonaFile } from "./persona";
import type { BrainStatus } from "../avatar/agent/json-llm-brain";

export interface CompanionSettingsPanelProps {
  /** 触发重新探测（测试连接），返回最新状态 */
  readonly onTestConnection: () => Promise<BrainStatus | null>;
  readonly memoryCount: number;
  readonly onClearMemory: () => void;
  /** 用当前声音设置试听一句（失败时 reject，带可读原因） */
  readonly onPreviewVoice?: (text: string) => Promise<void>;
}

export function CompanionSettingsPanel({ onTestConnection, memoryCount, onClearMemory, onPreviewVoice }: CompanionSettingsPanelProps) {
  const s = useCompanionSettings();
  const locked = companionSettings.isLocked();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [personaDraft, setPersonaDraft] = useState<string | null>(null);

  const update = companionSettings.update.bind(companionSettings);
  const personaValue = personaDraft ?? (s.personaText || bundledPersona());

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const st = await onTestConnection();
      setTestResult(
        !st
          ? "大脑还没准备好，稍后再试"
          : st.source === "llm"
            ? `✅ 已连接 ${st.provider}`
            : `⚠️ ${st.lastError ?? "连接失败"}`,
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="companion-settings">
      {!locked ? (
        <section className="companion-settings__card">
          <h4>大脑</h4>
          <label className="companion-settings__field">
            <span>来源</span>
            <select value={s.brainMode} onChange={(e) => update({ brainMode: e.currentTarget.value as BrainMode })}>
              <option value="cloud">云端大模型（推荐）</option>
              <option value="ollama">本机 Ollama</option>
              <option value="rule">离线（固定回复）</option>
            </select>
          </label>

          {s.brainMode === "cloud" ? (
            <>
              <label className="companion-settings__field">
                <span>厂商</span>
                <select
                  value={s.cloudPreset}
                  onChange={(e) => companionSettings.applyPreset(e.currentTarget.value as CloudPresetId)}
                >
                  {Object.values(CLOUD_PRESETS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="companion-settings__field">
                <span>API Key</span>
                <span className="companion-settings__inline">
                  <input
                    type={showKey ? "text" : "password"}
                    value={s.cloudApiKey}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => update({ cloudApiKey: e.currentTarget.value.trim() })}
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </span>
              </label>
              <label className="companion-settings__field">
                <span>模型</span>
                <input value={s.cloudModel} spellCheck={false} onChange={(e) => update({ cloudModel: e.currentTarget.value })} />
              </label>
              <label className="companion-settings__field">
                <span>接口地址</span>
                <input value={s.cloudBaseUrl} spellCheck={false} onChange={(e) => update({ cloudBaseUrl: e.currentTarget.value })} />
              </label>
              {CLOUD_PRESETS[s.cloudPreset]?.keyUrl ? (
                <small className="companion-settings__hint">Key 在 {CLOUD_PRESETS[s.cloudPreset].keyUrl} 申请</small>
              ) : null}
            </>
          ) : null}

          {s.brainMode === "ollama" ? (
            <>
              <label className="companion-settings__field">
                <span>地址</span>
                <input value={s.ollamaEndpoint} spellCheck={false} onChange={(e) => update({ ollamaEndpoint: e.currentTarget.value })} />
              </label>
              <label className="companion-settings__field">
                <span>模型</span>
                <input value={s.ollamaModel} spellCheck={false} onChange={(e) => update({ ollamaModel: e.currentTarget.value })} />
              </label>
            </>
          ) : null}

          {s.brainMode !== "rule" ? (
            <div className="companion-settings__row">
              <button type="button" disabled={testing} onClick={() => void test()}>
                {testing ? "连接中…" : "测试连接"}
              </button>
              {testResult ? <small>{testResult}</small> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {!locked ? (
        <section className="companion-settings__card">
          <h4>人设</h4>
          <label className="companion-settings__field">
            <span>名字</span>
            <input value={s.companionName} placeholder="你的名字 / 昵称" onChange={(e) => update({ companionName: e.currentTarget.value })} />
          </label>
          <label className="companion-settings__field">
            <span>称呼她</span>
            <input value={s.userNickname} placeholder="例：宝" onChange={(e) => update({ userNickname: e.currentTarget.value })} />
          </label>
          <label className="companion-settings__field companion-settings__field--block">
            <span>
              人设
              <small>（{s.personaText ? "已自定义" : hasLocalPersonaFile() ? "来自 persona.local.md" : "模板，请修改"}）</small>
            </span>
            <textarea
              rows={8}
              value={personaValue}
              onChange={(e) => setPersonaDraft(e.currentTarget.value)}
              onBlur={() => {
                if (personaDraft === null) return;
                update({ personaText: personaDraft.trim() === bundledPersona().trim() ? "" : personaDraft });
                setPersonaDraft(null);
              }}
            />
          </label>
          {s.personaText ? (
            <div className="companion-settings__row">
              <button
                type="button"
                onClick={() => {
                  setPersonaDraft(null);
                  update({ personaText: "" });
                }}
              >
                恢复默认人设
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {!locked ? <VoiceSection onPreviewVoice={onPreviewVoice} /> : null}

      <section className="companion-settings__card">
        <h4>主动陪伴</h4>
        <label className="companion-settings__check">
          <input
            type="checkbox"
            checked={s.proactiveEnabled}
            onChange={(e) => update({ proactiveEnabled: e.currentTarget.checked })}
          />
          <span>她在电脑前、一阵没聊天时，主动说句话</span>
        </label>
        <label className="companion-settings__field">
          <span>最多每</span>
          <span className="companion-settings__inline">
            <input
              type="number"
              min={5}
              max={1440}
              value={s.proactiveIntervalMin}
              onChange={(e) => update({ proactiveIntervalMin: Number(e.currentTarget.value) })}
            />
            <em>分钟一次</em>
          </span>
        </label>
        <label className="companion-settings__field">
          <span>安静时段</span>
          <span className="companion-settings__inline">
            <HourSelect value={s.quietStartHour} onChange={(v) => update({ quietStartHour: v })} />
            <em>到</em>
            <HourSelect value={s.quietEndHour} onChange={(v) => update({ quietEndHour: v })} />
          </span>
        </label>
      </section>

      <section className="companion-settings__card companion-settings__row">
        <span>聊天记忆：{memoryCount} 条</span>
        {confirmClear ? (
          <span className="companion-settings__inline">
            <button
              type="button"
              className="companion-settings__danger"
              onClick={() => {
                onClearMemory();
                setConfirmClear(false);
              }}
            >
              确认清空
            </button>
            <button type="button" onClick={() => setConfirmClear(false)}>
              取消
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)}>
            清空记忆
          </button>
        )}
      </section>
    </div>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}

/**
 * 声音：系统语音 / 你的克隆声音（硅基流动 CosyVoice2，OpenAI 兼容 /audio/speech）。
 * 在这里上传 8–10 秒你的录音 + 逐字文本即可完成克隆，音色 uri 自动填入。
 */
function VoiceSection({ onPreviewVoice }: { onPreviewVoice?: (text: string) => Promise<void> }) {
  const s = useCompanionSettings();
  const update = companionSettings.update.bind(companionSettings);
  const [showKey, setShowKey] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState<"upload" | "preview" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    if (!file) {
      setMsg("⚠️ 先选择一段录音文件");
      return;
    }
    setBusy("upload");
    setMsg(null);
    try {
      const uri = await uploadVoiceSample({
        baseUrl: s.voiceBaseUrl,
        apiKey: s.voiceApiKey,
        model: s.voiceModel,
        name: "companion-voice",
        transcript,
        file,
        fileName: file.name,
        fetchImpl: localFetch,
      });
      update({ voiceId: uri, voiceMode: "clone" });
      setMsg("✅ 声音克隆好了，点「试听」听听像不像");
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!onPreviewVoice) return;
    setBusy("preview");
    setMsg(null);
    try {
      const who = s.userNickname.trim();
      await onPreviewVoice(`${who ? who + "，" : ""}今天过得怎么样？记得早点休息哦。`);
      setMsg("✅ 正在播放");
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="companion-settings__card">
      <h4>声音</h4>
      <label className="companion-settings__field">
        <span>朗读</span>
        <select value={s.voiceMode} onChange={(e) => update({ voiceMode: e.currentTarget.value as VoiceMode })}>
          <option value="system">系统语音</option>
          <option value="clone">我的声音（云端克隆）</option>
        </select>
      </label>

      {s.voiceMode === "clone" ? (
        <>
          <label className="companion-settings__field">
            <span>API Key</span>
            <span className="companion-settings__inline">
              <input
                type={showKey ? "text" : "password"}
                value={s.voiceApiKey}
                placeholder="硅基流动 sk-..."
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => update({ voiceApiKey: e.currentTarget.value.trim() })}
              />
              <button type="button" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </span>
          </label>
          <small className="companion-settings__hint">Key 在 {VOICE_DEFAULTS.keyUrl} 申请（和聊天模型的 Key 不是同一个）</small>

          <label className="companion-settings__field companion-settings__field--block">
            <span>
              录音样本 <small>（8–10 秒，只有你一个人说话，安静环境）</small>
            </span>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.opus"
              onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <label className="companion-settings__field companion-settings__field--block">
            <span>录音里说的话 <small>（逐字一致）</small></span>
            <textarea
              rows={2}
              value={transcript}
              placeholder="例：今天天气真好，我们晚上一起去吃火锅吧，我已经想了一整天了。"
              onChange={(e) => setTranscript(e.currentTarget.value)}
            />
          </label>
          <div className="companion-settings__row">
            <button type="button" disabled={busy !== null} onClick={() => void upload()}>
              {busy === "upload" ? "上传中…" : "上传并克隆"}
            </button>
            <button type="button" disabled={busy !== null || !s.voiceId} onClick={() => void preview()}>
              {busy === "preview" ? "合成中…" : "试听"}
            </button>
          </div>
          {msg ? <small className="companion-settings__hint">{msg}</small> : null}

          <label className="companion-settings__field">
            <span>音色</span>
            <input
              value={s.voiceId}
              placeholder="上传后自动填入 speech:..."
              spellCheck={false}
              onChange={(e) => update({ voiceId: e.currentTarget.value.trim() })}
            />
          </label>
          <label className="companion-settings__field">
            <span>模型</span>
            <input value={s.voiceModel} spellCheck={false} onChange={(e) => update({ voiceModel: e.currentTarget.value })} />
          </label>
          <label className="companion-settings__field">
            <span>接口地址</span>
            <input value={s.voiceBaseUrl} spellCheck={false} onChange={(e) => update({ voiceBaseUrl: e.currentTarget.value })} />
          </label>
          <small className="companion-settings__hint">合成失败会自动改用系统语音，不会没声音。</small>
        </>
      ) : null}
    </section>
  );
}
