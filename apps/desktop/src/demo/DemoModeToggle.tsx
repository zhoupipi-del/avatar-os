/**
 * Day15A 演示模式齿轮按钮（DEV only）
 * 点击在「干净演示」与「高级调试」之间切换，仅控制调试信息可见性。
 */
import { setAdvancedDebug, useAdvancedDebug } from "./demo-runtime";

export function DemoModeToggle() {
  const showDebug = useAdvancedDebug();
  if (!import.meta.env.DEV) {
    return null;
  }
  return (
    <button
      type="button"
      className={
        "avatar-demo-mode-toggle" +
        (showDebug ? " avatar-demo-mode-toggle--active" : "")
      }
      title={showDebug ? "关闭高级调试" : "打开高级调试"}
      onClick={() => setAdvancedDebug(!showDebug)}
    >
      调试
    </button>
  );
}
