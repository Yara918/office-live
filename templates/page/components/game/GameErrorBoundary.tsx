"use client";

import { Component, type ReactNode } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("GameErrorBoundary");

interface Props {
  children: ReactNode;
  onReload?: () => void;
}

interface State {
  error: Error | null;
}

export class GameErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error(error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    this.props.onReload?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "absolute",
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
            <div style={{ fontSize: 14, marginBottom: 12 }}>Scene crashed</div>
            <div style={{ color: "var(--pixel-muted, #a09888)", fontSize: 10, marginBottom: 20 }}>
              {this.state.error.message}
            </div>
            <button
              onClick={this.handleReload}
              style={{
                padding: "8px 24px",
                border: "3px solid var(--pixel-border, #4a4238)",
                borderRadius: "var(--pixel-radius-sm, 6px)",
                background: "var(--pixel-panel-fill, #322c24)",
                color: "var(--pixel-text, #e8e2d8)",
                fontFamily: "inherit",
                fontSize: 10,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Reload Scene
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
