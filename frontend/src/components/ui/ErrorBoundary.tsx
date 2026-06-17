import React, { Component, ErrorInfo, ReactNode } from "react";
import { ErrorState } from "./ErrorState";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error captured by ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorState
          title="Application Error"
          message={this.state.error?.message || "An unexpected error occurred in the application."}
          actions={
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: "8px 16px",
                backgroundColor: "#C9821A",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Reload Application
            </button>
          }
        />
      );
    }

    return this.props.children;
  }
}
