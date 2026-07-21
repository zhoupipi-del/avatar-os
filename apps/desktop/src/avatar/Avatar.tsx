import { useEffect, useRef, useState } from "react";
import { Mood } from "@avatar-os/primitives";
import { eventBus, avatarFSM, initThoughtRelay, kernelEventBus } from "@avatar-os/runtime";
import { mouseSensor } from "../sensor/MouseSensor";
import { calculateFrame, VisualFrame } from "../renderer/visual-transform";
import {
  SHOULDER_L,
  SHOULDER_R,
  clientToSvg,
  computeArmReachAngle,
  typingIntensityFromRate,
  typingPose,
  scratchHeadPose,
  stepSpring,
  dragAccelFromDelta,
  systemStatusToLimbs,
  composeLimbAngles,
  REST_LIMB_ANGLES,
  IDLE_BEHAVIORS,
  idlePoseAt,
  nextIdleDelay,
  pickIdleBehavior,
  type IdleBehaviorType,
  type SpringState,
  type SystemStatus,
} from "@avatar-os/morphology";
import { Body } from "./components/Body";
import { ThoughtBubble } from "./components/ThoughtBubble";
import "./Avatar.css";

interface RenderParams {
  eyeOpenRatio: number;
  bodyScale: number;
  gazeBias: { x: number; y: number };
}

const DEFAULT_RENDER: RenderParams = {
  eyeOpenRatio: 1,
  bodyScale: 1,
  gazeBias: { x: 0, y: 0 },
};

/**
 * 纯视图汇聚层。它不持有任何生命状态：
 * - 生命状态(mood)来自 EventBus 的 STATE_MOOD_CHANGED
 * - 动作状态(motion)来自 EventBus 的 STATE_MOTION_CHANGED
 * - 渲染参数(eyeOpenRatio/bodyScale/gazeBias)来自 Morphology 的 STATE_RENDER_PARAMS_CHANGED
 * - 视线偏移(frame.eyeOffset) = 本地鼠标追视(视觉) + Morphology 情绪偏置(gazeBias)
 * - 肢体角(frame.limbAngles) = 120ms gesture tick 合成(鼠标引力/键盘打字/布娃娃/系统状态)
 */
export function Avatar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<Mood>(avatarFSM.getMood().current);
  const [motion, setMotion] = useState<string>("BREATH");
  const [frame, setFrame] = useState<VisualFrame>({
    eyeOffset: { x: 0, y: 0 },
    bodyScale: 1.0,
    limbAngles: { ...REST_LIMB_ANGLES },
  });
  const [render, setRender] = useState<RenderParams>(DEFAULT_RENDER);
  // 最新渲染参数引用：供 mousemove 闭包读取，避免重注册监听
  const renderRef = useRef<RenderParams>(DEFAULT_RENDER);

  // ---- 实时输入信号 refs (供 gesture tick 读取, 避免重注册监听) ----
  const svgCursorRef = useRef<{ x: number; y: number } | null>(null);
  const keyTimesRef = useRef<number[]>([]); // 近 1s 内按键时间戳
  const dragRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
    lastDelta: number;
    accel: number;
    springs: { armL: SpringState; armR: SpringState; legL: SpringState; legR: SpringState };
  }>({
    active: false,
    lastX: 0,
    lastY: 0,
    lastDelta: 0,
    accel: 0,
    springs: {
      armL: { angle: 0, vel: 0 },
      armR: { angle: 0, vel: 0 },
      legL: { angle: 0, vel: 0 },
      legR: { angle: 0, vel: 0 },
    },
  });
  const statusRef = useRef<SystemStatus>("idle");

  // ---- 随机行为树：空闲微动作调度状态 ----
  // 萌物无人交互超过 nextDelay 后，随机挑一个空闲小动作播放；
  // 任何交互(鼠标移动/按键/拖拽)立即取消当前动作并重置计时。
  interface IdleState {
    phase: "WAITING" | "PLAYING";
    type?: IdleBehaviorType;
    startedAt?: number;
    nextDelay: number; // 下次触发前的随机等待(ms)
  }
  const idleRef = useRef<IdleState>({
    phase: "WAITING",
    type: undefined,
    startedAt: undefined,
    nextDelay: nextIdleDelay(Math.random),
  });
  // 最近一次交互时刻：用于判断"是否空闲足够久"
  const lastInteractionRef = useRef<number>(Date.now());

  /** 取消正在播放的空闲动作并重置计时（交互发生时调用） */
  const cancelIdle = () => {
    const idle = idleRef.current;
    if (idle.phase === "PLAYING") {
      idle.phase = "WAITING";
      idle.type = undefined;
      idle.startedAt = undefined;
      idle.nextDelay = nextIdleDelay(Math.random);
    }
  };

  useEffect(() => {
    if (containerRef.current) {
      mouseSensor.init(containerRef.current);
    }

    // 启动想法气泡中继(情绪/意图/系统状态 → AVATAR_THOUGHT)
    const unbindRelay = initThoughtRelay();

    const unbindMood = eventBus.on("STATE_MOOD_CHANGED", (p) => setMood(p.mood));
    const unbindMotion = eventBus.on("STATE_MOTION_CHANGED", (p) => setMotion(p.motion));
    const unbindRender = eventBus.on("STATE_RENDER_PARAMS_CHANGED", (p) => {
      const next: RenderParams = {
        eyeOpenRatio: p.eyeOpenRatio,
        bodyScale: p.bodyScale,
        gazeBias: p.gazeBias,
      };
      renderRef.current = next;
      setRender(next);
    });
    const unbindStatus = eventBus.on("SYSTEM_STATUS_CHANGED", (p) => {
      statusRef.current = p.status;
    });

    // 视线追踪 + 鼠标引力光标采集 + 拖拽加速度采集
    let lastTime = 0;
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastTime < 50) return;
      lastTime = now;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const distance = Math.hypot(dx, dy);
      const base = calculateFrame(dx, dy, distance);

      const bias = renderRef.current.gazeBias;
      // 函数式更新: 保留 tick 写入的 limbAngles, 避免鼠标移动时肢体角被冲掉
      setFrame((f) => ({
        ...f,
        eyeOffset: { x: base.eyeOffset.x + bias.x, y: base.eyeOffset.y + bias.y },
        bodyScale: base.bodyScale * renderRef.current.bodyScale,
      }));

      // F1: 光标 → SVG 坐标, 供 gesture tick 算够指针角
      svgCursorRef.current = clientToSvg(e.clientX, e.clientY, rect);

      // 任何鼠标移动都算"交互"：重置空闲计时并取消正在播放的空闲动作
      lastInteractionRef.current = now;
      cancelIdle();

      // F3: 拖拽中 → 由移动差分推导甩动加速度
      const d = dragRef.current;
      if (d.active) {
        const mdx = e.clientX - d.lastX;
        const mdy = e.clientY - d.lastY;
        const delta = Math.hypot(mdx, mdy);
        d.accel = dragAccelFromDelta(d.lastDelta, delta, 0.05);
        d.lastDelta = delta;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
      }
    };
    window.addEventListener("mousemove", onMove);

    // F2: 键盘打字强度采集
    const onKeyDown = () => {
      keyTimesRef.current.push(performance.now());
      lastInteractionRef.current = Date.now();
      cancelIdle();
    };
    window.addEventListener("keydown", onKeyDown);

    // F3: 拖拽检测 (仅在 Tauri 拖拽区按下才算抓取)
    const onMouseDown = (e: MouseEvent) => {
      const wrap = containerRef.current?.querySelector(".drag-region-wrap");
      if (wrap && e.target instanceof Node && wrap.contains(e.target)) {
        const d = dragRef.current;
        d.active = true;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        d.lastDelta = 0;
        // 抓取瞬间给个甩动冲量, 即使原生拖拽暂停 mousemove 也能看到"晃一下"
        d.springs.armL = { angle: d.springs.armL.angle, vel: 28 };
        d.springs.armR = { angle: d.springs.armR.angle, vel: -28 };
        d.springs.legL = { angle: d.springs.legL.angle, vel: 20 };
        d.springs.legR = { angle: d.springs.legR.angle, vel: -20 };
      }
      lastInteractionRef.current = Date.now();
      cancelIdle();
    };
    const onMouseUp = () => {
      dragRef.current.active = false;
      dragRef.current.accel = 0;
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    // ---- gesture tick: 120ms 合成肢体角 (F1/F2/F3/F4 + 随机行为树) ----
    const tick = window.setInterval(() => {
      const t = performance.now();
      const now = Date.now();

      // ===== 随机行为树：空闲微动作调度 =====
      // 无人交互超过 nextDelay → 随机挑一个动作播放；播放期间接管双臂，
      // 并冒一个"想法气泡"。任何交互已在事件回调里取消当前动作并重置计时。
      const idle = idleRef.current;
      let idleLayer = REST_LIMB_ANGLES;
      let headTilt = 0;
      let bodyBob = 0;

      if (idle.phase === "WAITING") {
        if (now - lastInteractionRef.current > idle.nextDelay) {
          const type = pickIdleBehavior(Math.random);
          idle.phase = "PLAYING";
          idle.type = type;
          idle.startedAt = now;
          const def = IDLE_BEHAVIORS[type];
          // 同步冒想法气泡(时长对齐动作，source=IDLE 避免与情绪总线重复)
          kernelEventBus.emit("AVATAR_THOUGHT", {
            emoji: def.thought.emoji,
            text: def.thought.text,
            kind: "thought",
            source: "IDLE",
            durationMs: def.durationMs,
          });
        }
      } else {
        const def = IDLE_BEHAVIORS[idle.type!];
        const elapsed = now - idle.startedAt!;
        if (elapsed >= def.durationMs) {
          // 动作结束：回到等待，重算下次等待，并把空闲基线顺延到此刻
          idle.phase = "WAITING";
          idle.type = undefined;
          idle.startedAt = undefined;
          idle.nextDelay = nextIdleDelay(Math.random);
          lastInteractionRef.current = now;
        } else {
          const r = idlePoseAt(def, elapsed, t);
          idleLayer = r.angles;
          headTilt = r.tilt;
          bodyBob = r.bob;
        }
      }

      // F1 鼠标引力: 双手随光标 IK 够指针
      // 空闲动作播放时接管双臂，屏蔽静止光标的"残留够指"
      let reach = REST_LIMB_ANGLES;
      if (idle.phase !== "PLAYING") {
        const cur = svgCursorRef.current;
        if (cur) {
          reach = {
            armL: computeArmReachAngle(SHOULDER_L, cur, { side: "L" }),
            armR: computeArmReachAngle(SHOULDER_R, cur, { side: "R" }),
            legL: 0,
            legR: 0,
          };
        }
      }

      // F2 键盘同步: 打字强度 → 胸前虚空打字 / 轻敲挠头
      const ktNow = performance.now();
      keyTimesRef.current = keyTimesRef.current.filter((ts) => ktNow - ts < 1000);
      const rate = keyTimesRef.current.length; // 近 1s 按键数 ≈ 键/s
      const intensity = typingIntensityFromRate(rate);
      const typing =
        intensity > 0.08
          ? typingPose(intensity, t)
          : intensity > 0.02
            ? scratchHeadPose(t)
            : REST_LIMB_ANGLES;

      // F3 布娃娃弹簧: 四肢惯性晃荡, 松手后衰减归零
      const d = dragRef.current;
      const accel = d.accel;
      d.springs.armL = stepSpring(d.springs.armL, accel, 0.12);
      d.springs.armR = stepSpring(d.springs.armR, accel, 0.12);
      d.springs.legL = stepSpring(d.springs.legL, accel * 1.2, 0.12);
      d.springs.legR = stepSpring(d.springs.legR, accel * 1.2, 0.12);
      const ragdoll: typeof REST_LIMB_ANGLES = {
        armL: d.springs.armL.angle,
        armR: d.springs.armR.angle,
        legL: d.springs.legL.angle,
        legR: d.springs.legR.angle,
      };
      d.accel *= 0.82; // 拖拽停止后衰减

      // F4 系统状态: 欢呼 / 抱头 (覆盖双臂，优先级最高)
      const status = statusRef.current;
      const statusAngles = status !== "idle" ? systemStatusToLimbs(status, t) : undefined;

      // 合成：idle(最底) → reach → typing → ragdoll → status(最高)
      const final = composeLimbAngles({
        idle: idleLayer,
        reach,
        typing,
        ragdoll,
        status: statusAngles,
      });
      // 函数式更新: 保留 eyeOffset/bodyScale，叠加 idle 头部倾斜/浮动
      setFrame((f) => ({
        ...f,
        limbAngles: final,
        headTilt,
        bodyBob,
      }));
    }, 120);

    return () => {
      unbindRelay();
      unbindMood();
      unbindMotion();
      unbindRender();
      unbindStatus();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.clearInterval(tick);
    };
  }, []);

  return (
    <div className="avatar-root" ref={containerRef}>
      <ThoughtBubble />
      <div className="drag-region-wrap" data-tauri-drag-region>
        <Body mood={mood} motion={motion} frame={frame} eyeOpenRatio={render.eyeOpenRatio} />
      </div>
      <button
        className="touch-point"
        onClick={(e) => mouseSensor.triggerClick(e.clientX, e.clientY)}
        title="摸摸它"
      />
    </div>
  );
}
