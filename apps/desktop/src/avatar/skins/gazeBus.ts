/**
 * 视线共享总线（模块级可变 ref）。
 * Avatar 在每次鼠标/空闲调度更新 frame.eyeOffset 时写入此处；
 * 3D 皮肤的 useFrame 直接读取，避免把 gaze 当 React prop 触发 Canvas 重渲染。
 */
export const gazeBus = { x: 0, y: 0 };
