import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseGatewayAddress, getDefaultGatewayUrl } from "../utils";
import { BASE_PATH } from "../base-path";

describe("parseGatewayAddress", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  });

  it("returns default gateway url for empty string", () => {
    const result = parseGatewayAddress("");
    // With no env var and no window, falls back to server default
    expect(result).toBe("ws://localhost:3000/api/gateway");
  });

  it("returns default gateway url for whitespace-only string", () => {
    const result = parseGatewayAddress("   ");
    expect(result).toBe("ws://localhost:3000/api/gateway");
  });

  it("keeps ws:// prefix as-is", () => {
    expect(parseGatewayAddress("ws://host:8080/path")).toBe("ws://host:8080/path");
  });

  it("keeps wss:// prefix as-is", () => {
    expect(parseGatewayAddress("wss://secure.example.com:443/ws")).toBe(
      "wss://secure.example.com:443/ws",
    );
  });

  it("is case-insensitive for ws/wss prefix", () => {
    expect(parseGatewayAddress("WS://HOST:1234")).toBe("WS://HOST:1234");
    expect(parseGatewayAddress("WSS://HOST:1234")).toBe("WSS://HOST:1234");
  });

  it("converts bare host:port to ws:// URL with trailing slash", () => {
    expect(parseGatewayAddress("192.168.1.100:18789")).toBe("ws://192.168.1.100:18789/");
  });

  it("converts host:port/path to ws:// URL with trailing slash", () => {
    expect(parseGatewayAddress("host:8080/path")).toBe("ws://host:8080/path/");
  });

  it("does not double trailing slash if already present", () => {
    expect(parseGatewayAddress("host:8080/path/")).toBe("ws://host:8080/path/");
  });

  it("handles hostname without port", () => {
    expect(parseGatewayAddress("myhost")).toBe("ws://myhost/");
  });

  it("handles hostname without port but with path", () => {
    expect(parseGatewayAddress("myhost/api/gateway")).toBe("ws://myhost/api/gateway/");
  });

  it("returns null for invalid input", () => {
    expect(parseGatewayAddress("://bad")).toBeNull();
    expect(parseGatewayAddress("http://not-websocket")).toBeNull();
    expect(parseGatewayAddress("ftp://wrong")).toBeNull();
  });
});

describe("getDefaultGatewayUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_GATEWAY_URL;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
    // Remove window to simulate server-side by default
    // @ts-expect-error -- deliberately removing window for tests
    delete globalThis.window;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_GATEWAY_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_GATEWAY_URL;
    }
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    } else {
      // @ts-expect-error -- restoring original state
      delete globalThis.window;
    }
  });

  it("returns NEXT_PUBLIC_GATEWAY_URL env var when set", () => {
    process.env.NEXT_PUBLIC_GATEWAY_URL = "ws://custom:9999/gw";
    expect(getDefaultGatewayUrl()).toBe("ws://custom:9999/gw");
  });

  it("returns ws:// URL based on window.location for http", () => {
    globalThis.window = {
      location: { protocol: "http:", host: "myapp.local:3000" },
    } as unknown as Window & typeof globalThis;
    expect(getDefaultGatewayUrl()).toBe(`ws://myapp.local:3000${BASE_PATH}/api/gateway`);
  });

  it("returns wss:// URL based on window.location for https", () => {
    globalThis.window = {
      location: { protocol: "https:", host: "myapp.local" },
    } as unknown as Window & typeof globalThis;
    expect(getDefaultGatewayUrl()).toBe(`wss://myapp.local${BASE_PATH}/api/gateway`);
  });

  it("prefers env var over window.location", () => {
    process.env.NEXT_PUBLIC_GATEWAY_URL = "ws://env-wins:1234/";
    globalThis.window = {
      location: { protocol: "https:", host: "ignored.local" },
    } as unknown as Window & typeof globalThis;
    expect(getDefaultGatewayUrl()).toBe("ws://env-wins:1234/");
  });

  it("falls back to ws://localhost:3000/api/gateway on server side", () => {
    // No env var, no window
    expect(getDefaultGatewayUrl()).toBe("ws://localhost:3000/api/gateway");
  });
});
