import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 变化时清除错误态，重新尝试渲染（切换身体 / 皮肤时用）。 */
  resetKey: string;
  /** 捕获到渲染/加载错误后的回调（用于退回默认身体）。 */
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
  key: string;
}

/**
 * 皮肤级错误边界：身体资源（.glb/.vrm）缺失或加载失败时只隔离该皮肤，
 * 不让 R3F 的 Suspense 异常冒泡卸载整个应用（此前表现为整窗白屏）。
 */
export class SkinErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[SkinErrorBoundary] avatar body failed to render:", error, info.componentStack);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="avatar-load-error" role="alert">
          <span>身体加载失败</span>
          <small>{this.state.error.message.slice(0, 120)}</small>
        </div>
      );
    }
    return this.props.children;
  }
}
