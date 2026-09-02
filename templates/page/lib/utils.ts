import type { AgentProvider } from "@/types/game";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Returns the configured agent provider.
 * Set via NEXT_PUBLIC_AGENT_PROVIDER env var (available client-side).
 */
export function getAgentProvider(): AgentProvider {
  const val = process.env.NEXT_PUBLIC_AGENT_PROVIDER;
  if (val === "auggie") return "auggie";
  return "openclaw";
}

export function getDefaultGatewayUrl() {
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return process.env.NEXT_PUBLIC_GATEWAY_URL;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${BASE_PATH}/api/gateway`;
  }

  return "ws://localhost:3000/api/gateway";
}

/**
 * Parse a user-friendly gateway address into a full WebSocket URL.
 *
 *   "192.168.1.100:18789"  → "ws://192.168.1.100:18789/"
 *   "ws://host:port/path"  → kept as-is
 *   "wss://host:port"      → kept as-is
 *   ""                     → fallback to getDefaultGatewayUrl()
 */
/**
 * Returns null if the input is not a valid WebSocket URL.
 */
export function parseGatewayAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return getDefaultGatewayUrl();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `ws://${trimmed}${trimmed.endsWith("/") ? "" : "/"}`;
  }
  return null;
}
