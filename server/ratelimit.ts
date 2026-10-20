import type { Request } from "express";
import { rateLimit } from "express-rate-limit";

const WINDOW_MS = 60_000;

function limiter(limit: number | (() => number), key?: (req: Request) => string) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: typeof limit === "function" ? limit : () => limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "too many requests, slow down" },
    ...(key ? { keyGenerator: key } : {}),
  });
}

// Behind Discord's proxy many players can share one address, so the per-IP
// limit is only a flood guard and is deliberately generous.
export const ipLimiter = limiter(() => Number(process.env.RATE_LIMIT_IP_PER_MIN) || 600);

/** Per signed-in user; use after requireDiscordUser. */
export const userLimiter = limiter(120, (req) => req.userId ?? "anonymous");

/** Starting a battle spins up an engine, so it is limited more tightly. */
export const beginLimiter = limiter(10, (req) => req.userId ?? "anonymous");
