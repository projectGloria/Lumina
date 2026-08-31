import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort renderer recovery so one component failure never leaves a blank window. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[lumina] renderer failure', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="app no-vault">
        <div className="empty-state">
          <h1>Lumina hit a problem</h1>
          <p>{this.state.error.message || 'The interface could not be rendered.'}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload Lumina
          </button>
        </div>
      </div>
    )
  }
}
