import { Component, type ErrorInfo, type ReactNode } from 'react';

// Temporary diagnostic aid: React's plain console output for "Objects are not valid as a
// React child" never names the owning component (verified — even the browser's own devtools
// console stops at collapsed internal reconciler frames). componentDidCatch's errorInfo.
// componentStack is the only place React actually reports the JSX owner chain.
export class DebugBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string | null }> {
  state: { error: Error | null; stack: string | null } = { error: null, stack: null };

  static getDerivedStateFromError(error: Error) {
    return { error, stack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DebugBoundary] componentStack:', info.componentStack);
    this.setState({ stack: info.componentStack });
    (window as unknown as { __lastComponentStack?: string }).__lastComponentStack = info.componentStack ?? undefined;
  }

  render() {
    if (this.state.error) {
      return (
        <pre style={{ padding: 16, color: '#fff', background: '#7f1d1d', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {this.state.error.message}
          {'\n\n'}
          {this.state.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}
