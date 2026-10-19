import type {
  BattleSnapshot,
  BeginResponse,
  HistoryResponse,
  StartResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: unknown; code?: unknown };
    if (typeof e.message === "string" && e.message !== "") {
      return e.code === undefined ? e.message : `${e.message} (code ${String(e.code)})`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "[unserializable error]";
    }
  }
  return String(err);
}

async function api<T>(
  path: string,
  token: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function fetchStart(
  token: string,
  timeZone: string
): Promise<StartResponse> {
  return api("/api/battle/start", token, "POST", { timeZone });
}

export function beginBattle(
  token: string,
  timeZone: string,
  slot: number
): Promise<BeginResponse> {
  return api("/api/battle/begin", token, "POST", { timeZone, slot });
}

export function fetchBattle(
  token: string,
  battleId: string
): Promise<HistoryResponse> {
  return api(`/api/battle/${battleId}`, token, "GET");
}

export function sendChoice(
  token: string,
  battleId: string,
  choice: string
): Promise<BattleSnapshot> {
  return api(`/api/battle/${battleId}/choice`, token, "POST", { choice });
}
