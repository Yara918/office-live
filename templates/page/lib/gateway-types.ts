/**
 * Strongly-typed Gateway event and frame definitions.
 *
 * Replaces all `as Record<string, unknown>` casts in the store
 * with discriminated unions the compiler can actually check.
 */

// ── Outbound (client → gateway) ────────────────────────

export interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
  event?: string;
  seq?: number;
}

// ── Inbound event payloads ─────────────────────────────

export interface AgentLifecycleStart {
  phase: "start";
  label?: string;
  /** Target seat ID for dispatched subtasks (auggie bridge). */
  seatId?: string;
  error?: never;
}

export interface AgentLifecycleEnd {
  phase: "end";
  error?: never;
}

export interface AgentLifecycleError {
  phase: "error";
  error?: string;
}

export type AgentLifecycleData = AgentLifecycleStart | AgentLifecycleEnd | AgentLifecycleError;

export interface AgentToolData {
  name?: string;
  tool?: string;
  input?: unknown;
  arguments?: unknown;
  output?: unknown;
  content?: unknown;
  result?: unknown;
}

export interface AgentAssistantDelta {
  delta?: string;
}

export interface AgentEventPayload {
  runId?: string;
  sessionKey?: string;
  stream?: "lifecycle" | "tool" | "assistant";
  data?: AgentLifecycleData | AgentToolData | AgentAssistantDelta;
}

export interface ChatContentBlock {
  type: string;
  text?: string;
}

export interface ChatMessagePayload {
  content?: ChatContentBlock[];
}

export interface ChatEventPayload {
  runId?: string;
  sessionKey?: string;
  state?: "final" | "error" | "aborted";
  message?: ChatMessagePayload;
}

// ── Response payloads ──────────────────────────────────

export interface AgentRequestResult {
  runId?: string;
  status?: string;
}

export interface SessionListRow {
  key: string;
  model?: string | null;
  modelProvider?: string | null;
  contextTokens?: number | null;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SessionsListPayload {
  sessions?: SessionListRow[];
}

export interface SessionPreviewItem {
  role: "user" | "assistant" | "tool" | "system" | "other";
  text: string;
}

export interface SessionsPreviewEntry {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionPreviewItem[];
}

export interface SessionsPreviewPayload {
  previews?: SessionsPreviewEntry[];
}

export interface ModelChoice {
  id: string;
  provider: string;
  contextWindow?: number;
}

export interface ModelsListPayload {
  models?: ModelChoice[];
}

// ── Type guards ────────────────────────────────────────

export function isAgentPayload(payload: unknown): payload is AgentEventPayload {
  return typeof payload === "object" && payload !== null && "runId" in payload;
}

export function isChatPayload(payload: unknown): payload is ChatEventPayload {
  return typeof payload === "object" && payload !== null && "runId" in payload;
}

export function isLifecycleData(
  stream: string | undefined,
  data: unknown,
): data is AgentLifecycleData {
  return stream === "lifecycle" && typeof data === "object" && data !== null && "phase" in data;
}

export function isToolData(stream: string | undefined, data: unknown): data is AgentToolData {
  return stream === "tool" && typeof data === "object" && data !== null;
}

export function isAssistantDelta(
  stream: string | undefined,
  data: unknown,
): data is AgentAssistantDelta {
  return stream === "assistant" && typeof data === "object" && data !== null;
}
