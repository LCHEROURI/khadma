import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLang } from '../lib/i18n';

interface Props {
  children: ReactNode;
  errorText: string;
  retryText: string;
}

interface State {
  hasError: boolean;
}

class BoundaryInner extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Minimal data collection: no external error telemetry.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page">
          <div className="empty">
            <p>{this.props.errorText}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false });
                window.location.assign('/');
              }}
            >
              {this.props.retryText}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useLang();
  return (
    <BoundaryInner errorText={t('common.error')} retryText={t('common.retry')}>
      {children}
    </BoundaryInner>
  );
}
