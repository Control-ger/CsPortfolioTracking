import { Component } from "react"
import { errorToContext, sendFrontendTelemetryEvent } from "../lib/frontendTelemetry"
import { Button } from "./ui/button.jsx"

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
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
      const errorMessage = this.state.error?.message || "Unknown error"
      const errorStack = this.state.error?.stack || ""
      
      // Log to console for debugging
      console.error("[AppErrorBoundary] Caught error:", errorMessage, errorStack)
      
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-xl border bg-card p-6 space-y-3 text-center">
            <h1 className="text-xl font-semibold text-destructive">UI-Fehler</h1>
            <p className="text-sm text-muted-foreground">
              Die Anwendung ist abgestuerzt. Bitte Seite neu laden.
            </p>
            {/* Debug info - shows actual error */}
            <div className="text-left text-xs text-destructive bg-destructive/50 rounded-md p-3 overflow-auto max-h-40">
              <p className="font-semibold mb-1">Error:</p>
              <p className="break-all">{errorMessage}</p>
              {errorStack && (
                <>
                  <p className="font-semibold mt-2 mb-1">Stack:</p>
                  <pre className="whitespace-pre-wrap break-all">{errorStack.split("\n").slice(0, 5).join("\n")}</pre>
                </>
              )}
            </div>
            <Button variant="outline" onClick={this.handleReload} className="mt-2">
              Neu laden
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

