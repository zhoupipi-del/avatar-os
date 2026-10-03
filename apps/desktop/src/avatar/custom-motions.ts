/**
 * custom-motions —— 你的「招牌动作」
 *
 * 用法：把 XR Animator 等工具导出的 .vrma 放到 public/avatars/void/animations/custom/，
 * 在同目录 motions.json 里登记一行（id / 文件名 / 叫什么 / 什么时候做）。不用改代码。
 *
 *   { "motions": [
 *       { "id": "HEART", "file": "heart.vrma", "label": "比心", "when": "开心、被夸、说喜欢她的时候", "idleWeight": 0 },
 *       { "id": "SCRATCH_HEAD", "file": "scratch.vrma", "label": "挠头", "when": "不好意思、答不上来的时候", "idleWeight": 1 }
 *   ] }
 *
 * - 聊天：动作清单会自动写进提示词，模型回复里带 "motion":"HEART" 就播放它（替代普通动作）。
 * - 闲着：idleWeight > 0 的动作会在空闲时偶尔自己做（权重越大越常做）。
 * - 某个文件坏了只跳过它，不影响其他动作。
 */

export const CUSTOM_MOTION_DIR = "/avatars/void/animations/custom/";
export const CUSTOM_MOTION_MANIFEST = `${CUSTOM_MOTION_DIR}motions.json`;

export interface CustomMotion {
  /** 大写字母 / 数字 / 下划线，例如 HEART */
  readonly id: string;
  /** custom/ 目录下的文件名，例如 heart.vrma */
  readonly file: string;
  /** 中文名，例如「比心」 */
  readonly label: string;
  /** 什么时候做（写给模型看） */
  readonly when: string;
  /** 空闲时自己做的权重，0 = 只在聊天时用 */
  readonly idleWeight: number;
}

/** 内置动作名，招牌动作不能重名（否则会顶掉内置动作） */
export const BUILTIN_MOTION_IDS = new Set([
  "IDLE", "GREET", "GREET_ALT", "BOUNCE_HAPPY", "PEEK", "THINKING", "HAPPY_IDLE", "SAD_BODY",
  "SPEAK", "LISTEN", "COMFORT", "NONE", "STRETCH", "DOZE",
]);

const ID_RE = /^[A-Z][A-Z0-9_]{1,23}$/;
const FILE_RE = /^[A-Za-z0-9_\-.]{1,64}\.vrma$/;
export const MAX_CUSTOM_MOTIONS = 16;

export interface ManifestParseResult {
  readonly motions: CustomMotion[];
  /** 被跳过的条目与原因（给开发者看） */
  readonly skipped: string[];
}

/** 校验清单：id 规范、文件名安全（不允许 ../ 之类路径）、不重名、不撞内置动作 */
export function parseCustomMotionManifest(raw: unknown): ManifestParseResult {
  const list = (raw as { motions?: unknown })?.motions;
  const motions: CustomMotion[] = [];
  const skipped: string[] = [];
  if (!Array.isArray(list)) return { motions, skipped: list === undefined ? [] : ["motions 不是数组"] };
  const seen = new Set<string>();
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim().toUpperCase() : "";
    const file = typeof r.file === "string" ? r.file.trim() : "";
    if (!ID_RE.test(id)) {
      skipped.push(`${String(r.id)}：id 只能用大写字母、数字、下划线（2–24 位，字母开头）`);
      continue;
    }
    if (BUILTIN_MOTION_IDS.has(id)) {
      skipped.push(`${id}：和内置动作重名，换个名字`);
      continue;
    }
    if (seen.has(id)) {
      skipped.push(`${id}：重复`);
      continue;
    }
    if (!FILE_RE.test(file)) {
      skipped.push(`${id}：文件名需是 custom 目录下的 .vrma（只用字母数字 - _ .）`);
      continue;
    }
    if (motions.length >= MAX_CUSTOM_MOTIONS) {
      skipped.push(`${id}：最多 ${MAX_CUSTOM_MOTIONS} 个招牌动作`);
      continue;
    }
    seen.add(id);
    motions.push({
      id,
      file,
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 12) : id,
      when: typeof r.when === "string" ? r.when.trim().slice(0, 60) : "",
      idleWeight: Number.isFinite(r.idleWeight) ? Math.max(0, Math.min(10, Number(r.idleWeight))) : 0,
    });
  }
  return { motions, skipped };
}

/** 读取清单；不存在 / 格式错误时返回空（招牌动作是可选的） */
export async function loadCustomMotionManifest(fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): Promise<ManifestParseResult> {
  try {
    const res = await fetchImpl(CUSTOM_MOTION_MANIFEST, { cache: "no-store" });
    if (!res.ok) return { motions: [], skipped: [] };
    const text = await res.text();
    // Vite dev 对不存在的文件会回退 index.html
    if (!text.trim().startsWith("{")) return { motions: [], skipped: [] };
    return parseCustomMotionManifest(JSON.parse(text));
  } catch (e) {
    return { motions: [], skipped: [`motions.json 读取失败：${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** 当前已成功加载、可以播放的招牌动作（加载完成后由 VoidVrmSkin 写入；提示词每轮读取） */
export const customMotionRegistry: { motions: CustomMotion[] } = { motions: [] };

export function isCustomMotion(id: string | undefined | null): boolean {
  if (!id) return false;
  const up = id.toUpperCase();
  return customMotionRegistry.motions.some((m) => m.id === up);
}

/** 写进聊天提示词的一段说明；没有招牌动作时返回空串 */
export function describeCustomMotionsForPrompt(motions: readonly CustomMotion[] = customMotionRegistry.motions): string {
  if (motions.length === 0) return "";
  const lines = motions.map((m) => `  - ${m.id}：${m.label}${m.when ? `（${m.when}）` : ""}`);
  return [
    "- motion（可选）：你的招牌动作，只在非常合适时偶尔用，大多数回复不要带。可取：",
    ...lines,
  ].join("\n");
}

/** 按权重随机挑一个空闲招牌动作；没有可用的返回 null */
export function pickIdleMotion(motions: readonly CustomMotion[], rng: () => number = Math.random): CustomMotion | null {
  const pool = motions.filter((m) => m.idleWeight > 0);
  const total = pool.reduce((s, m) => s + m.idleWeight, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const m of pool) {
    r -= m.idleWeight;
    if (r < 0) return m;
  }
  return pool[pool.length - 1] ?? null;
}
