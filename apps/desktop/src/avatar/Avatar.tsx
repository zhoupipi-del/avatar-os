import { useEffect, useRef, useState } from "react";
import { Mood } from "@avatar-os/primitives";
import { eventBus, avatarFSM } from "@avatar-os/runtime";
import { mouseSensor } from "../sensor/MouseSensor";
import { calculateFrame, VisualFrame } from "../renderer/visual-transform";
import { Body } from "./components/Body";
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
 */
export function Avatar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<Mood>(avatarFSM.getMood().current);
  const [motion, setMotion] = useState<string>("BREATH");
  const [frame, setFrame] = useState<VisualFrame>({
    eyeOffset: { x: 0, y: 0 },
    bodyScale: 1.0,
  });
  const [render, setRender] = useState<RenderParams>(DEFAULT_RENDER);
  // 最新渲染参数引用：供 mousemove 闭包读取，避免重注册监听
  const renderRef = useRef<RenderParams>(DEFAULT_RENDER);

  useEffect(() => {
    if (containerRef.current) {
      mouseSensor.init(containerRef.current);
    }

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

    // 视线追踪：纯视觉，50ms 节流，独立于生命状态流；
    // 最终偏移 = 本地鼠标追视 + Morphology 情绪偏置
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
      setFrame({
        eyeOffset: { x: base.eyeOffset.x + bias.x, y: base.eyeOffset.y + bias.y },
        bodyScale: base.bodyScale * renderRef.current.bodyScale,
      });
    };
    window.addEventListener("mousemove", onMove);

    return () => {
      unbindMood();
      unbindMotion();
      unbindRender();
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div className="avatar-root" ref={containerRef}>
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
