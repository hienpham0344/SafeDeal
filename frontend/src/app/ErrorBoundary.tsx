import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly message: string;
}

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unexpected rendering error.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SafeDeal UI boundary error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-black p-6 text-white font-geist">
          <div className="max-w-md rounded-2xl border border-white/15 bg-neutral-950 p-6 space-y-4">
            <h1 className="text-lg font-medium">Application Error</h1>
            <p className="text-sm text-white/70">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
