import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors anywhere below it and shows a recoverable
 * screen (reload / report) instead of a blank white page — important on a
 * rapidly-updated hosted build.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // surfaced in the console for debugging; not sent anywhere automatically
    console.error('UI crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <div className="panel error-boundary-card">
          <h1 className="h1">Something went wrong</h1>
          <p className="subtitle">A part of the interface hit an unexpected error.</p>
          <pre className="error-boundary-msg">{this.state.error.message}</pre>
          <div className="error-boundary-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="btn ghost" onClick={() => this.setState({ error: null })}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}
