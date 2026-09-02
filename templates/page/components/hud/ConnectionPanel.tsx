"use client";

import { useState } from "react";
import { LS_CONFIG, STATUS_LABELS } from "@/lib/constants";
import { useStudio } from "@/lib/store";
import { getAgentProvider, parseGatewayAddress } from "@/lib/utils";
import HudFlyout from "./HudFlyout";

const DEFAULT_GATEWAY = "ws://127.0.0.1:18789";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const IS_AUGGIE = getAgentProvider() === "auggie";

function loadSavedConfig(): { url: string; token: string } {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_CONFIG) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { url?: string; token?: string };
      return {
        url: parsed.url || DEFAULT_GATEWAY,
        token: parsed.token || DEFAULT_TOKEN,
      };
    }
  } catch {}
  return { url: DEFAULT_GATEWAY, token: DEFAULT_TOKEN };
}

export default function ConnectionPanel() {
  const { state, connect, disconnect } = useStudio();
  const [url, setUrl] = useState(() => loadSavedConfig().url);
  const [token, setToken] = useState(() => loadSavedConfig().token);
  const [error, setError] = useState("");
  const isConnected = state.connection === "connected";
  const isConnecting = state.connection === "connecting";
  const isAuthFailed = state.connection === "auth_failed";
  const isUnreachable = state.connection === "unreachable";
  const isRateLimited = state.connection === "rate_limited";

  const handleConnect = () => {
    setError("");
    if (IS_AUGGIE) {
      connect({ url: parseGatewayAddress("") ?? "", token: "" });
      return;
    }
    const parsed = parseGatewayAddress(url);
    if (!parsed) {
      setError("地址格式不正确，请使用 ws://host:port 或 host:port。");
      return;
    }
    connect({ url: parsed, token: token.trim() });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleConnect();
    }
  };

  return (
    <HudFlyout
      title="连接状态"
      subtitle={`${STATUS_LABELS[state.connection]}${IS_AUGGIE ? " · 本地代理" : " · 本地通道"}`}
    >
      <div className="hud-panel__stack">
        {!IS_AUGGIE && (
          <>
            <label className="hud-panel__label">本地通道地址</label>
            <input
              className="pixel-input hud-panel__input"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="ws://127.0.0.1:18789"
              disabled={isConnected || isConnecting}
            />
            <label className="hud-panel__label">访问令牌</label>
            <input
              className="pixel-input hud-panel__input"
              type="text"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="可选"
              disabled={isConnected || isConnecting}
            />
          </>
        )}
        {IS_AUGGIE && !isConnected && !isConnecting && (
          <p style={{ color: "var(--pixel-muted)", fontSize: "8px" }}>
            当前使用本地代理模式，请确认命令行工具已安装并完成授权。
          </p>
        )}
        {isAuthFailed && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            授权失败，令牌可能无效或已过期，请重新输入。
          </p>
        )}
        {isUnreachable && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            本地通道不可访问，请确认服务已启动。
          </p>
        )}
        {isRateLimited && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            失败次数过多，请稍后再试。
          </p>
        )}
        {error && <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>{error}</p>}
        {!isConnected && !isConnecting ? (
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={handleConnect}
            disabled={!url.trim()}
          >
            连接
          </button>
        ) : null}
        {isConnected ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            断开
          </button>
        ) : null}
        {isConnecting ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            取消
          </button>
        ) : null}
      </div>
    </HudFlyout>
  );
}
