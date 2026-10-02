// Avatar Adapter 层 —— 彻底解耦的 3D/动画/骨骼抽象。
// 内核只认这里的接口(ExpressionController / AnimationManager / BehaviorVMAdapter)，
// 不认具体 GLB 资产。换模型 = 换配置 + 换 ExpressionController 实现。
export * from "./expression-interface";
export * from "./animation-manager";
export * from "./animation-channel-scanner";
export * from "./body-channel-authority";
export * from "./behavior-bridge";
export * from "./capabilities";
export * from "./embodiment-runtime";
