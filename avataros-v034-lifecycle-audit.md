# v0.3.4 入场审计：Avatar 生命周期所有权

> 解冻后第一步（按 Architecture Freeze 约定）：读取四处真实代码，完成 Avatar 生命周期所有权审计，再决定 Profile Migration 实现。
> 审计日期：2026-07-23。纯读码，无代码改动。

## 1. 审计入口（四文件真实路径）

| 文件 | 路径 | 角色 |
|---|---|---|
| Avatar.tsx | `apps/desktop/src/avatar/Avatar.tsx` | 视图汇聚层（React 组件） |
| SkinRegistry.tsx | `apps/desktop/src/avatar/skins/SkinRegistry.tsx` | 皮肤注册表 |
| StandardAvatarSkin.tsx | `apps/desktop/src/avatar/skins/StandardAvatarSkin.tsx` | 标准 3D 身体（Adapter 层） |
| RuntimeKernel | `packages/runtime/src/runtime-kernel.ts` | 运行时内核（@avatar-os/runtime） |

## 2. 逐文件事实（带行号）

### RuntimeKernel（`packages/runtime/src/runtime-kernel.ts`）
- 只编排**大脑侧**三件事：`SPEECH_INPUT → cognition`（L76-83）、`MEMORY_APPEND → memory.remember`（L85-104）、孤独感超阈值自发思考（L106-121）。
- 设计红线注明白：runtime 只编排"认知驱动 / 记忆持久 / 自发触发"（L10-13）。
- **结论：RuntimeKernel 完全不碰 Avatar / 身体生命周期。** 所谓"Runtime 协调层"对 body 而言当前不存在。

### Avatar.tsx（`apps/desktop/src/avatar/Avatar.tsx`）
- L29 从 SkinRegistry 导入 `MVPSkin`；L374 渲染 `<MVPSkin mood={mood} />`。
- 组件自身只合成 2D `frame`（limbAngles / gaze / headTilt）并喂 `gazeBus`，不持有任何身体配置。
- **结论：身体由 React 组件挂载，且硬编码为 `MVPSkin`，无任何 `activeAvatarId` / 切换概念。**

### SkinRegistry.tsx（`apps/desktop/src/avatar/skins/SkinRegistry.tsx`）
- L9 `DEFAULT_SKIN = "bag-character"`（编译期常量，**未被用于选活跃身体**）。
- L15-18 `SKIN_REGISTRY: Record<string, RigConfig> = { "bag-character": BAG_CONFIG, "rigged-glb": ROBOT_CONFIG }`——多身体字典**已存在**。
- L21 `export const MVPSkin = StandardMVPSkin`——**硬编码别名**，注册表从未被用来选 active 身体。
- **结论：多身体字典是雏形，但 selector 缺失；活跃皮肤被写死。**

### StandardAvatarSkin.tsx（`apps/desktop/src/avatar/skins/StandardAvatarSkin.tsx`）
- L147 `StandardAvatarSkin({ mood, config = BAG_CONFIG })`——**config 驱动**，可接收任意 RigConfig。
- L165-167 `StandardMVPSkin({ mood }) → <StandardAvatarSkin mood={mood} config={BAG_CONFIG} />`——MVP 别名写死 BAG_CONFIG。
- L169 `useGLTF.preload(BAG_CONFIG.url)`——写死 bag 预加载。
- L45-71 `StandardModel` 的 `useEffect` 内**实例化全部运行时引擎**：`AnimationManager` / `BagCharacterExpression` / `EmbodimentRuntime` / `BehaviorVMAdapter`（引擎由 UI 组件 effect 创建）。
- L53 `new AnimationManager(mixer, actions, { idleClip: config.idleClip })`；L56 `BehaviorVMAdapter(..., { bindings: config, ... })`——引擎已接受 config 绑定。
- L87 `useEffect` 依赖含 `config`——**config 变化时引擎自动拆建**（切换就绪）。
- **结论：Adapter 层已 body-agnostic 且切换就绪；但引擎在 UI effect 内创建，身体生命周期归 React。**

## 3. 五问审计结论

| # | 生命周期问题 | 当前事实（代码证据） | 归属 | 是否违规 |
|---|---|---|---|---|
| 1 | 谁创建 Avatar？ | React：`Avatar`→`MVPSkin`→`StandardAvatarSkin`→`StandardModel` useEffect 内 `new AnimationManager/Expression/Embodiment/BehaviorVMAdapter`（L45-71） | **React / UI 层** | ❌ 违规（UI 拥有身体） |
| 2 | 谁保存 active Avatar？ | 无 `activeAvatarId`；`DEFAULT_SKIN` 常量（L9）未被使用；`SKIN_REGISTRY` 不被查询 | **无人持有**（隐式恒为 bag） | ❌ 违规（无 Runtime State） |
| 3 | 谁负责切换？ | 无切换机制；`MVPSkin=StandardMVPSkin`（L21）+ `config={BAG_CONFIG}`（L166）写死；改身体=改代码 | **不存在** | ❌ 违规（无 AvatarService） |
| 4 | 谁通知运行时？ | 身体消费 `gazeBus`/`kernelEventBus`/`driveEngine`，但引擎由 skin 自身创建，无独立"被通知"层 | **N/A（引擎与身体同生同灭）** | ⚠️ 架构缺口（无协调层） |
| 5 | 谁负责持久化？ | 无存储；重启恒为 bag（写死） | **不存在** | ❌ 违规（无 Storage） |

## 4. 核心结论：当前 Avatar 生命周期所有权在哪

**完全由 React UI 层拥有。**
- 创建：React 组件树挂载 Canvas + 在 `useEffect` 内实例化全部运行时引擎。
- 活跃状态：隐式硬编码（bag），无运行时状态。
- 切换：不存在（写死别名 / 写死 config / 写死 preload）。
- 通知：N/A（引擎随身体在 UI effect 内同生同灭）。
- 持久化：无（重启恒 bag）。

这与冻结铁律 **"UI 可触发选择，但不能拥有身体"** 直接冲突——当前 UI 不仅"触发"，还"创建、配置、持有、销毁"身体及其引擎。`RuntimeKernel`（唯一的 runtime 内核）只管大脑（认知/记忆），身体侧没有任何 runtime 协调层。

## 5. 好消息：Adapter 层已切换就绪，降低 Migration 风险

- `StandardAvatarSkin` 是 **config 驱动**（L147），接收任意 `RigConfig` 即可渲染不同身体，无需改代码。
- `StandardModel` 的 `useEffect` 依赖含 `config`（L87），config 变化时自动 tear-down + rebuild 引擎——**切换机制底层已具备**。
- `SKIN_REGISTRY` 已是多身体字典，且 `RigConfig` 形状（url/fitHeight/headBone/spineBone/idleClip/intentClip/statusClip）≈ 未来 `AvatarProfile` 所需字段。`AvatarProfile ≈ RigConfig + id`。
- **推论：Profile Migration 的硬骨头（body-agnostic 渲染 + 引擎重绑）已完成；缺的只是其上方的"所有权 / 选择器 / 持久化"壳层。属增量添加，非重写。**

## 6. Profile Migration 应落地的位置（建议，不实现）

1. **所有权**：新增 runtime 侧（或 desktop 级状态）`activeAvatarId` / `ActiveAvatarProfile` 持有者（建议 `AvatarService` / `AvatarProvider`，放 `@avatar-os/runtime` 或 desktop 状态层），**不在 React 组件里**。
2. **选择器**：`MVPSkin` 不再写死 `StandardMVPSkin`，改为从 active-profile 持有者取 `config` 下传；`SKIN_REGISTRY` 被真正查询。
3. **切换入口**：`AvatarService.activate(profileId)` 切换 active，触发 skin `config` prop 变化 → 现有 useEffect（L87）自动重建引擎。
4. **通知**：身体变化时，AnimationManager / Expression / Snapshot 经 `bindings: config` 重绑（已支持），无需新通道。
5. **持久化**：active body id 存 Storage / Runtime State，重启恢复。

**最小改动路径**：把"活跃身体"从写死常量提升为一个 runtime 持有的 `activeAvatarId`，并让 `MVPSkin` 据此查 `SKIN_REGISTRY` 取 config 下传。底层 Adapter 无需动。
