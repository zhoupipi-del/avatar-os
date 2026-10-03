/**
 * persona —— 把「你」变成提示词
 *
 * 人设来源优先级：设置界面里填写的文本 > persona.local.md（私人，不入库）> persona.example.md（模板）
 * 系统提示词在每次对话时现算：带上当前日期 / 星期 / 时段，让它会说"早安""该睡了""周末去哪"。
 */
import { describeCustomMotionsForPrompt } from "../avatar/custom-motions";
import type { CompanionSettings } from "./companion-settings";

// Vite eager glob：文件不存在时得到空对象（persona.local.md 是可选的私人文件）
const localFiles = import.meta.glob("./persona.local.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const exampleFiles = import.meta.glob("./persona.example.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** 构建期自带的默认人设（local 优先） */
export function bundledPersona(): string {
  const local = Object.values(localFiles)[0];
  const example = Object.values(exampleFiles)[0];
  return stripHtmlComments(local ?? example ?? "");
}

export function hasLocalPersonaFile(): boolean {
  return Object.keys(localFiles).length > 0;
}

export function resolvePersonaText(settings: Pick<CompanionSettings, "personaText">, fallback = bundledPersona()): string {
  const custom = settings.personaText.trim();
  return custom ? custom : fallback;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function describeNow(date = new Date()): string {
  const h = date.getHours();
  const period =
    h < 5 ? "深夜" : h < 9 ? "早上" : h < 12 ? "上午" : h < 14 ? "中午" : h < 18 ? "下午" : h < 23 ? "晚上" : "深夜";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${WEEKDAYS[date.getDay()]} ${pad(h)}:${pad(date.getMinutes())}（${period}）`;
}

function identityLines(settings: Pick<CompanionSettings, "companionName" | "userNickname">): string[] {
  const lines: string[] = [];
  if (settings.companionName.trim()) lines.push(`你的名字：${settings.companionName.trim()}`);
  if (settings.userNickname.trim()) lines.push(`你称呼她为「${settings.userNickname.trim()}」。`);
  return lines;
}

/**
 * 底线（写在代码里，不随人设文件改变）：
 * 数字分身再像也不是本人——被认真问到时要诚实；遇到真正的危险或急事，要把她引向真人。
 */
export const COMPANION_GROUND_RULES = `## 底线（始终遵守）
- 如果她认真地问你是不是他本人、是不是真人，要如实说你是他做的数字分身，真正的他随时可以联系。
- 如果她提到身体不适、出了意外、遇到危险，或流露出伤害自己的念头：先温柔地回应，然后明确让她马上联系他本人或身边的人；情况紧急就打 120 / 110。不要假装你能替代真人处理。`;

const CHAT_FORMAT = `## 回复格式（必须遵守）
只输出一个 JSON 对象，不要输出 JSON 以外的任何文字或代码围栏：
{"speech":"你要说的话","intent":{"type":"GREET","intensity":0.6},"emotion":{"type":"happy","intensity":0.6}}
- speech：像微信聊天一样口语化，一般 1~3 句、不超过 60 个字；不要用 markdown、不要列清单。
- intent.type 只能取：GREET / GREET_ALT / BOUNCE_HAPPY / HAPPY_IDLE / THINKING / PEEK / SAD_BODY / COMFORT / LISTEN / IDLE / NONE（身体动作，没有合适的就用 NONE）
- emotion.type 只能取：neutral / happy / sad / thinking / curious / tired（你说这句话时的表情）
- intensity 是 0~1 的数字。`;

/** 对话大脑（JsonLlmBrain）的系统提示词 */
export function buildChatSystemPrompt(settings: CompanionSettings, now = new Date(), persona = resolvePersonaText(settings)): string {
  return [
    persona,
    ...identityLines(settings),
    `现在是 ${describeNow(now)}。`,
    "结合之前的聊天记录自然接话，记住她说过的事。",
    COMPANION_GROUND_RULES,
    CHAT_FORMAT,
    describeCustomMotionsForPrompt(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 主动陪伴（RuntimeKernel → CognitionEngine）的人设开头；格式要求由 CognitionEngine 追加 */
export function buildProactivePersona(settings: CompanionSettings, now = new Date(), persona = resolvePersonaText(settings)): string {
  return [
    persona,
    ...identityLines(settings),
    `现在是 ${describeNow(now)}。她有一阵子没理你了，你想主动跟她说句话：`,
    "可以是关心（喝水、休息、吃饭、早点睡）、分享、撒娇或接着之前聊过的事，要自然、简短（不超过 40 字），不要每次都一样。",
    COMPANION_GROUND_RULES,
  ]
    .filter(Boolean)
    .join("\n");
}
