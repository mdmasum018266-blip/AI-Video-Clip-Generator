import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: "",
  };

  public static getDerivedStateFromError(error: Error): State {
    let readable = error.message || "Unexpected application error.";
    try {
      const parsed = JSON.parse(readable);
      if (parsed?.error) {
        readable = `Sync error (${parsed.operationType || "read"}): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: readable };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Application ErrorBoundary caught:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#0A0A0C] text-[#F4F4F6] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl bg-[#121216] border border-[#272731] p-6 space-y-4 text-center">
            <div className="w-10 h-10 rounded-full bg-red-950/50 border border-red-900/60 flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-white">Something went wrong</h2>
              <p className="text-xs text-zinc-400 leading-relaxed break-words">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
