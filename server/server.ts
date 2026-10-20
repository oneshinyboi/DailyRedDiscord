import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import {
  DiscordUnavailableError,
  isUserInGuild,
  requireDiscordUser,
} from "./auth.js";
import { handleInteraction } from "./interactions.js";
import { backupDatabase, recordGuild } from "./battle/store.js";
import { beginLimiter, ipLimiter, userLimiter } from "./ratelimit.js";
import type {
  BeginResponse,
  ChoiceResponse,
  HistoryResponse,
  StartResponse,
} from "@dailyred/shared";
import { isValidTimeZone, todayInTimeZone } from "./battle/seed.js";
import { dailyPreview } from "./battle/teamgen.js";
import { RED_TEAM } from "./battle/red.js";
import {
  beginSession,
  getDailySession,
  getSessionFor,
  initSessions,
  shutdownSessions,
  streakFor,
} from "./battle/session.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

// Number of reverse proxies in front of this server (needed for real client
// IPs in rate limiting). Unset when the server is reached directly.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

/** Express 4 ignores rejected promises from async handlers; forward them to the error handler. */
function route(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// Discord signs interaction requests over their exact bytes, so this route
// takes the raw body and must be registered before the JSON parser.
app.post("/api/interactions", express.raw({ type: "*/*" }), handleInteraction);

// Allow express to parse JSON bodies
app.use(express.json());

// All battle routes require a valid Discord access token.
app.use("/api/battle", ipLimiter, requireDiscordUser, userLimiter);
app.use("/api/token", ipLimiter);

const SNOWFLAKE_RE = /^\d{15,25}$/;

/**
 * Remembers which guild the user plays from, for the guild leaderboard. The
 * client reports the guild, but it is only recorded after Discord confirms the
 * user is a member. A failed check never blocks the request.
 */
async function noteGuild(req: express.Request, guildId: unknown): Promise<void> {
  if (typeof guildId !== "string" || !SNOWFLAKE_RE.test(guildId)) return;
  try {
    if (await isUserInGuild(req.headers.authorization, guildId)) {
      recordGuild(req.userId!, guildId);
    }
  } catch (err) {
    console.warn(
      err instanceof DiscordUnavailableError
        ? "could not verify guild membership; not recording guild"
        : "could not record guild",
      err instanceof DiscordUnavailableError ? "" : err
    );
  }
}

// Today's state: the user's existing battle for this timezone's date, or a
// no-commitment preview of today's team (nothing is consumed by this call).
app.post("/api/battle/start", route(async (req, res) => {
  const { timeZone = "UTC", guildId } = req.body as {
    timeZone?: string;
    guildId?: string | null;
  };
  if (!isValidTimeZone(timeZone)) {
    res.status(400).json({ error: "invalid timeZone" });
    return;
  }
  await noteGuild(req, guildId);
  const date = todayInTimeZone(timeZone);
  const session = await getDailySession(req.userId!, date);
  if (session) {
    const payload: StartResponse = {
      battleId: session.id,
      date: session.date,
      phase: session.phase,
      team: session.playerTeam,
      redTeam: RED_TEAM,
      ended: session.ended,
      winner: session.winner,
      streak: streakFor(req.userId!, date),
    };
    res.json(payload);
    return;
  }
  const preview: StartResponse = {
    battleId: null,
    phase: "preview",
    redTeam: RED_TEAM,
    streak: streakFor(req.userId!, date),
    ...dailyPreview(timeZone),
  };
  res.json(preview);
}));

// Commit to the daily: begin today's battle with the chosen lead.
// Body: { timeZone?: string, slot: 1-6 }. Idempotent per date: if the user
// already began today's battle (anywhere on the scale of begun..ended), it
// is returned as-is.
app.post("/api/battle/begin", beginLimiter, route(async (req, res) => {
  const { timeZone = "UTC", slot, guildId } = req.body as {
    timeZone?: string;
    slot?: number;
    guildId?: string | null;
  };
  if (!isValidTimeZone(timeZone)) {
    res.status(400).json({ error: "invalid timeZone" });
    return;
  }
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > 6) {
    res.status(400).json({ error: "slot must be an integer 1-6" });
    return;
  }
  await noteGuild(req, guildId);

  const { session, created } = await beginSession(req.userId!, timeZone, slot);
  if (!created) {
    const payload: BeginResponse = {
      battleId: session.id,
      date: session.date,
      phase: session.phase,
      team: session.playerTeam,
      ended: session.ended,
      winner: session.winner,
      streak: streakFor(req.userId!, session.date),
    };
    res.json(payload);
    return;
  }

  const snapshot = await session.ready();
  const payload: BeginResponse = {
    battleId: session.id,
    date: session.date,
    team: session.playerTeam,
    streak: streakFor(req.userId!, session.date),
    ...snapshot,
  };
  res.json(payload);
}));

// Submit a choice for the challenger. Body: { choice: "move 1" | "switch 2" | ... }
app.post("/api/battle/:id/choice", route(async (req, res) => {
  const session = await getSessionFor(req.userId!, req.params.id as string);
  if (!session) {
    res.status(404).json({ error: "unknown battle" });
    return;
  }
  const { choice } = req.body as { choice?: string };
  if (typeof choice !== "string" || choice === "") {
    res.status(400).json({ error: "missing choice" });
    return;
  }
  try {
    const result: ChoiceResponse = await session.choose(choice);
    res.json(result);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "error" });
  }
}));

// Reconnect: full protocol history + current state.
app.get("/api/battle/:id", route(async (req, res) => {
  const session = await getSessionFor(req.userId!, req.params.id as string);
  if (!session) {
    res.status(404).json({ error: "unknown battle" });
    return;
  }
  const payload: HistoryResponse = {
    battleId: session.id,
    streak: streakFor(req.userId!, session.date),
    ...session.history(),
  };
  res.json(payload);
}));

app.post("/api/token", route(async (req, res) => {
  const { code } = req.body as { code?: unknown };
  if (typeof code !== "string" || code === "") {
    res.status(400).json({ error: "missing code" });
    return;
  }

  // Exchange the code for an access_token
  let body: { access_token?: string } | null = null;
  let ok = false;
  try {
    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID ?? "",
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
        grant_type: "authorization_code",
        code,
      }),
    });
    ok = response.ok;
    body = (await response.json()) as { access_token?: string };
  } catch {
    // Discord unreachable or sent something unparseable; handled below.
  }
  if (!ok || !body?.access_token) {
    res.status(502).json({ error: "token exchange failed" });
    return;
  }

  // Return the access_token to our client as { access_token: "..."}
  res.send({ access_token: body.access_token });
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not found" });
});

// In production the server also serves the built client.
const clientDist = process.env.CLIENT_DIST ?? resolve(import.meta.dirname, "../../client/dist");
if (existsSync(join(clientDist, "index.html"))) {
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints everything under /assets/, so it can be cached forever.
        res.setHeader(
          "Cache-Control",
          filePath.includes(`${join(clientDist, "assets")}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache"
        );
      },
    })
  );
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(clientDist, "index.html"));
  });
}

// Must be last. Never leak internals; body-parser errors keep their 4xx status.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "bad request" });
    return;
  }
  console.error("unhandled request error", err);
  res.status(500).json({ error: "internal error" });
});

initSessions();

// Optional database backups: a consistent copy at most once a day, newest kept.
const backupDir = process.env.DB_BACKUP_DIR;
if (backupDir) {
  const keep = Number(process.env.DB_BACKUP_KEEP) || 7;
  const backup = () => {
    try {
      const name = backupDatabase(backupDir, keep, 24 * 60 * 60_000);
      if (name) console.log(`Database backed up to ${join(backupDir, name)}`);
    } catch (err) {
      console.error("database backup failed", err);
    }
  };
  backup();
  setInterval(backup, 60 * 60_000).unref();
}

const server = app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  if (process.env.DEV_AUTH === "1" && process.env.NODE_ENV !== "production") {
    console.warn(
      "DEV_AUTH=1: accepting the local dev token. Never enable this in production."
    );
  }
});

// Finish in-flight requests, then close the engines and the database.
// Accepted moves are already stored, so an abrupt stop loses nothing either.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => {
    console.error("shutdown timed out, forcing exit");
    shutdownSessions();
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    shutdownSessions();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
