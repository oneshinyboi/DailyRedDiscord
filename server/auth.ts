import type { NextFunction, Request, Response } from "express";

const DISCORD_API_BASE =
  process.env.DISCORD_API_BASE_URL ?? "https://discord.com/api";

const TOKEN_CACHE_TTL = 10 * 60_000;

interface CachedUser {
  userId: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedUser>();

export class DiscordUnavailableError extends Error {
  constructor() {
    super("discord unavailable");
  }
}

function sweepCache(): void {
  const now = Date.now();
  for (const [token, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(token);
  }
}

const cacheSweeper = setInterval(sweepCache, 5 * 60_000);
cacheSweeper.unref();

/**
 * Verifies a Discord OAuth access token ("Authorization: Bearer ...") against
 * Discord's /users/@me and returns the user id. Results are cached briefly so
 * frequent in-battle requests don't hit Discord every time.
 *
 * Returns null for missing/invalid tokens; throws DiscordUnavailableError if
 * Discord itself cannot be reached.
 */
export async function getDiscordUser(
  authorization: string | undefined
): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (token === "") return null;

  const cached = tokenCache.get(token);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.userId;
    tokenCache.delete(token);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DiscordUnavailableError();
  }

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new DiscordUnavailableError();

  const user = (await response.json()) as { id?: string };
  if (!user.id) return null;

  tokenCache.set(token, {
    userId: user.id,
    expiresAt: Date.now() + TOKEN_CACHE_TTL,
  });
  return user.id;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Express guard for /api/battle routes: requires a valid Discord token. */
export async function requireDiscordUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Local browser development: the client sends "Bearer dev" instead of a
  // Discord token. Opt-in only, and refused when NODE_ENV=production.
  if (
    process.env.DEV_AUTH === "1" &&
    process.env.NODE_ENV !== "production" &&
    req.headers.authorization === "Bearer dev"
  ) {
    req.userId = "dev-user";
    next();
    return;
  }

  try {
    const userId = await getDiscordUser(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = userId;
    next();
  } catch {
    res.status(503).json({ error: "discord unavailable" });
  }
}
