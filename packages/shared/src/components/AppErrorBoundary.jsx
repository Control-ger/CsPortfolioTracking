import { Component } from "react"
import { errorToContext, sendFrontendTelemetryEvent } from "../lib/frontendTelemetry"

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    void sendFrontendTelemetryEvent({
      level: "error",
      event: "frontend.ui_exception",
      message: error?.message || "React render error",
      context: {
        ...errorToContext(error),
        componentStack: typeof errorInfo?.componentStack === "string"
          ? errorInfo.componentStack.split("\n").slice(0, 20).join("\n")
          : undefined,
      },
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border bg-card p-6 space-y-3 text-center">
            <h1 className="text-xl font-semibold text-destructive">UI-Fehler</h1>
            <p className="text-sm text-muted-foreground">
              Die Anwendung ist abgestuerzt. Bitte Seite neu laden.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Neu laden
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

