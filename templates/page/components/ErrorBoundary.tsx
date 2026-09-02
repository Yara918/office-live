"use client";

import { Component, type ReactNode } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("ErrorBoundary");

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--pixel-bg, #1a1814)",
            color: "var(--pixel-red, #ef4444)",
            fontFamily: 'var(--pixel-font, "ArkPixel", monospace)',
            fontSize: 12,
            padding: 32,
            textAlign: "center",
            lineHeight: 2,
          }}
        >
          <div>
            <div style={{ fontSize: 16, marginBottom: 16 }}>Something went wrong</div>
            <div style={{ color: "var(--pixel-muted, #a09888)", fontSize: 10 }}>
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                marginTop: 24,
                padding: "8px 24px",
                border: "3px solid var(--pixel-border, #4a4238)",
                borderRadius: "var(--pixel-radius-sm, 6px)",
                background: "var(--pixel-panel-fill, #322c24)",
                color: "var(--pixel-text, #e8e2d8)",
                fontFamily: "inherit",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
