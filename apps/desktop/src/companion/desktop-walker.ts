/**
 * desktop-walker —— 让小人在桌面上走动
 *
 * 原理：小人住在一个透明小窗里。"走路" = 窗口沿屏幕水平移动 + 身体播放程序化走路步态（见 walk-cycle.ts）。
 * 只在她的工作区（不含任务栏）里横向走，y 不变；不会走出屏幕，不会走到她看不到的地方。
 *
 * 何时走：智能体空闲（没在思考 / 说话）、没被拖拽、没在打字时，每隔几分钟随机散一次步。
 * 何时停：到达目标；或她一碰（按下鼠标、开始打字、智能体开始说话）立即停下。
 *
 * 只依赖注入的 WindowPort，Node 测试可完整覆盖；真实实现见 createTauriWindowPort()。
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 窗口操作（物理像素） */
export interface WindowPort {
  getPosition(): Promise<{ x: number; y: number }>;
  getSize(): Promise<{ width: number; height: number }>;
  /** 当前显示器的工作区（不含任务栏）；拿不到返回 null（此时不走） */
  getWorkArea(): Promise<Rect | null>;
  setPosition(x: number, y: number): Promise<void>;
  scaleFactor(): Promise<number>;
}

/** 走路状态总线：渲染层每帧读取（与 gazeBus 同一模式，无订阅开销） */
export const locomotionBus = {
  walking: false,
  /** -1 向左，1 向右，0 站着 */
  direction: 0 as -1 | 0 | 1,
  /** 当前速度（逻辑像素/秒），渲染层据此调步频 */
  speed: 0,
};

export interface WalkPlan {
  readonly fromX: number;
  readonly toX: number;
  readonly y: number;
  readonly direction: -1 | 1;
}

/** 逻辑像素/秒：约等于小人一步的视觉速度 */
export const WALK_SPEED_LOGICAL = 55;
/** 一次散步的距离范围（逻辑像素） */
export const STROLL_MIN_LOGICAL = 120;
export const STROLL_MAX_LOGICAL = 480;

/**
 * 规划一次散步：在工作区内随机挑一个方向和距离。
 * 靠近一侧边缘时自动往另一侧走；可走空间不够最短距离时返回 null。
 */
export function planStroll(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  area: Rect,
  scale: number,
  rng: () => number = Math.random,
): WalkPlan | null {
  const minX = area.x;
  const maxX = area.x + area.width - size.width;
  if (maxX <= minX) return null;

  const x = clamp(pos.x, minX, maxX);
  const roomLeft = x - minX;
  const roomRight = maxX - x;
  const minDist = STROLL_MIN_LOGICAL * scale;
  const maxDist = STROLL_MAX_LOGICAL * scale;

  let direction: -1 | 1;
  if (roomLeft < minDist && roomRight < minDist) return null;
  if (roomLeft < minDist) direction = 1;
  else if (roomRight < minDist) direction = -1;
  else direction = rng() < 0.5 ? -1 : 1;

  const room = direction === 1 ? roomRight : roomLeft;
  const dist = Math.min(room, minDist + rng() * (maxDist - minDist));
  // y 只做"别出界"的收拢，不主动改高度
  const y = clamp(pos.y, area.y, area.y + area.height - size.height);
  return { fromX: x, toX: Math.round(x + direction * dist), y, direction };
}

/** 朝目标走一小步；返回新位置与是否到达 */
export function stepToward(x: number, target: number, speedPxPerSec: number, dtSec: number): { x: number; arrived: boolean } {
  const remaining = target - x;
  const step = speedPxPerSec * Math.max(0, dtSec);
  if (Math.abs(remaining) <= step) return { x: target, arrived: true };
  return { x: x + Math.sign(remaining) * step, arrived: false };
}

/** 下次散步的等待时间：4–10 分钟随机，免得规律得像闹钟 */
export function nextStrollDelayMs(rng: () => number = Math.random): number {
  return Math.round((4 + rng() * 6) * 60_000);
}

export interface DesktopWalkerOptions {
  readonly port: WindowPort;
  /** 是否允许开始 / 继续走（开关打开、智能体空闲、她没在操作） */
  readonly canWalk: () => boolean;
  readonly rng?: () => number;
  readonly now?: () => number;
  /** 两次检查之间的间隔（默认 5 秒） */
  readonly checkIntervalMs?: number;
  /** 走路时窗口刷新间隔（默认 33ms ≈ 30fps） */
  readonly frameMs?: number;
  readonly bus?: typeof locomotionBus;
}

export class DesktopWalker {
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly bus: typeof locomotionBus;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private nextAt: number;
  private walking: { plan: WalkPlan; x: number; speed: number; last: number } | null = null;
  private busy = false;

  constructor(private readonly opts: DesktopWalkerOptions) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => Date.now());
    this.bus = opts.bus ?? locomotionBus;
    // 启动后先等 1–3 分钟再第一次散步，别一打开就跑
    this.nextAt = this.now() + Math.round((1 + this.rng() * 2) * 60_000);
  }

  start(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => void this.check(), this.opts.checkIntervalMs ?? 5000);
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    this.halt();
  }

  isWalking(): boolean {
    return this.walking !== null;
  }

  /** 她碰了它 / 开始说话：立即停下，并把下次散步往后推 */
  interrupt(): void {
    if (!this.walking) return;
    this.halt();
    this.nextAt = this.now() + nextStrollDelayMs(this.rng);
  }

  /** 立刻散一次步（调试 / 托盘"走两步"用）。返回是否成功开始 */
  async strollNow(): Promise<boolean> {
    return this.begin(true);
  }

  /** 定时检查：到点且允许时开始散步（测试可直接调用） */
  async check(): Promise<void> {
    if (this.walking || this.busy) return;
    if (this.now() < this.nextAt) return;
    if (!this.opts.canWalk()) return;
    await this.begin(false);
  }

  /** 走一帧（测试可直接调用） */
  async frame(): Promise<void> {
    const w = this.walking;
    if (!w) return;
    if (!this.opts.canWalk()) {
      this.interrupt();
      return;
    }
    const t = this.now();
    const dt = Math.min(0.2, (t - w.last) / 1000);
    w.last = t;
    const r = stepToward(w.x, w.plan.toX, w.speed, dt);
    w.x = r.x;
    try {
      await this.opts.port.setPosition(Math.round(r.x), w.plan.y);
    } catch {
      this.halt();
      return;
    }
    if (r.arrived) {
      this.halt();
      this.nextAt = this.now() + nextStrollDelayMs(this.rng);
    }
  }

  private async begin(force: boolean): Promise<boolean> {
    if (this.walking || this.busy) return false;
    if (!force && !this.opts.canWalk()) return false;
    this.busy = true;
    try {
      const [pos, size, area, scale] = await Promise.all([
        this.opts.port.getPosition(),
        this.opts.port.getSize(),
        this.opts.port.getWorkArea(),
        this.opts.port.scaleFactor(),
      ]);
      const plan = area ? planStroll(pos, size, area, scale || 1, this.rng) : null;
      this.nextAt = this.now() + nextStrollDelayMs(this.rng);
      if (!plan) return false;
      const speed = WALK_SPEED_LOGICAL * (scale || 1);
      this.walking = { plan, x: plan.fromX, speed, last: this.now() };
      this.bus.walking = true;
      this.bus.direction = plan.direction;
      this.bus.speed = WALK_SPEED_LOGICAL;
      this.frameTimer = setInterval(() => void this.frame(), this.opts.frameMs ?? 33);
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }

  private halt(): void {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.walking = null;
    this.bus.walking = false;
    this.bus.direction = 0;
    this.bus.speed = 0;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
