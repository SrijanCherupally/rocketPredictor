import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('apexFlite render failure', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert"><div><p className="eyebrow">WORKSPACE RECOVERY</p><h1>apexFlite hit an unexpected problem.</h1><p>Your saved flight data has not been deleted. Reload the app to restore the last persisted workspace.</p><button className="primary-button" onClick={() => window.location.reload()}>Reload workspace</button><details><summary>Technical details</summary><code>{this.state.error.message}</code></details></div></main>
  }
}
