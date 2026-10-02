/**
 * 视线共享总线（模块级可变 ref）。
 * Avatar 在每次鼠标/空闲调度更新 frame.eyeOffset 时写入此处；
 * 3D 皮肤的 useFrame 直接读取，避免把 gaze 当 React prop 触发 Canvas 重渲染。
 */
export const gazeBus = {
  x: 0,
  y: 0,
  /**
   * 空闲行为树产出的头部倾斜（度，2D 侧直塞 CSS rotate）。
   * 由 Avatar.tsx 的 idle tick 写入；非 idle 时恒为 0。
   * 3D 皮肤映射到 head.rotation.z（roll），与 gaze 占用的 Y(yaw)/X(pitch) 不同轴、互不打架。
   */
  headTilt: 0,
};
