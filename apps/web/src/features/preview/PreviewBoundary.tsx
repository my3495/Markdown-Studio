import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 预览区错误边界。
 *
 * 背景：`hast-util-to-jsx-runtime` 遇到无法处理的属性会抛错，而 React 在渲染期抛错时
 * 会卸载整棵根树 —— 表现为「打开某个文档后整个界面白屏」，用户只会觉得卡死。
 * 这里把故障限制在预览面板内：编辑器、侧栏、状态栏仍然可用，并给出重试入口。
 */
export class PreviewBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[preview] render failed', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const locale = useSettings.getState().locale;
    return (
      <div className="md-preview preview-error" role="alert">
        <div className="preview-error-title">{t(locale, 'previewErrorTitle')}</div>
        <p className="preview-error-hint">{t(locale, 'previewErrorHint')}</p>
        <pre className="preview-error-detail">{error.message}</pre>
        <button type="button" className="tb-btn" onClick={this.reset}>
          {t(locale, 'previewRetry')}
        </button>
      </div>
    );
  }
}
