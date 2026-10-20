import express from "express";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import {
  DiscordUnavailableError,
  isUserInGuild,
  requireDiscordUser,
} from "./auth.js";
import { handleInteraction } from "./interactions.js";
import { recordGuild } from "./battle/store.js";
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
  createSession,
  getDailySession,
  getSessionFor,
  restoreSessions,
  streakFor,
} from "./battle/session.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

// Discord signs interaction requests over their exact bytes, so this route
// takes the raw body and must be registered before the JSON parser.
app.post("/api/interactions", express.raw({ type: "*/*" }), handleInteraction);

// Allow express to parse JSON bodies
app.use(express.json());

// All battle routes require a valid Discord access token.
app.use("/api/battle", requireDiscordUser);

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
app.post("/api/battle/start", async (req, res) => {
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
  const session = getDailySession(req.userId!, date);
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
});

// Commit to the daily: begin today's battle with the chosen lead.
// Body: { timeZone?: string, slot: 1-6 }. Idempotent per date: if the user
// already began today's battle (anywhere on the scale of begun..ended), it
// is returned as-is.
app.post("/api/battle/begin", async (req, res) => {
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

  const date = todayInTimeZone(timeZone);
  const existing = getDailySession(req.userId!, date);
  if (existing) {
    const payload: BeginResponse = {
      battleId: existing.id,
      date: existing.date,
      phase: existing.phase,
      team: existing.playerTeam,
      ended: existing.ended,
      winner: existing.winner,
      streak: streakFor(req.userId!, existing.date),
    };
    res.json(payload);
    return;
  }

  const session = createSession(req.userId!, timeZone, slot);
  const snapshot = await session.ready();
  const payload: BeginResponse = {
    battleId: session.id,
    date: session.date,
    team: session.playerTeam,
    streak: streakFor(req.userId!, session.date),
    ...snapshot,
  };
  res.json(payload);
});

// Submit a choice for the challenger. Body: { choice: "move 1" | "switch 2" | ... }
app.post("/api/battle/:id/choice", async (req, res) => {
  const session = getSessionFor(req.userId!, req.params.id);
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
});

// Reconnect: full protocol history + current state.
app.get("/api/battle/:id", (req, res) => {
  const session = getSessionFor(req.userId!, req.params.id);
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
});

app.post("/api/token", async (req, res) => {
  const { code } = req.body as { code: string };

  // Exchange the code for an access_token
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

  // Retrieve the access_token from the response
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token) {
    res.status(502).json({ error: "token exchange failed" });
    return;
  }

  // Return the access_token to our client as { access_token: "..."}
  res.send({ access_token: body.access_token });
});

// Restore stored battles before accepting requests.
await restoreSessions();

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  if (process.env.DEV_AUTH === "1" && process.env.NODE_ENV !== "production") {
    console.warn(
      "DEV_AUTH=1: accepting the local dev token. Never enable this in production."
    );
  }
});