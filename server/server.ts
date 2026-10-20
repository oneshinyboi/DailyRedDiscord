import express from "express";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import { requireDiscordUser } from "./auth.js";
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
} from "./battle/session.js";

const app = express();
const port = 3001;

// Allow express to parse JSON bodies
app.use(express.json());

// All battle routes require a valid Discord access token.
app.use("/api/battle", requireDiscordUser);

// Today's state: the user's existing battle for this timezone's date, or a
// no-commitment preview of today's team (nothing is consumed by this call).
app.post("/api/battle/start", (req, res) => {
  const { timeZone = "UTC" } = req.body as { timeZone?: string };
  if (!isValidTimeZone(timeZone)) {
    res.status(400).json({ error: "invalid timeZone" });
    return;
  }
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
    };
    res.json(payload);
    return;
  }
  const preview: StartResponse = {
    battleId: null,
    phase: "preview",
    redTeam: RED_TEAM,
    ...dailyPreview(timeZone),
  };
  res.json(preview);
});

// Commit to the daily: begin today's battle with the chosen lead.
// Body: { timeZone?: string, slot: 1-6 }. Idempotent per date: if the user
// already began today's battle (anywhere on the scale of begun..ended), it
// is returned as-is.
app.post("/api/battle/begin", async (req, res) => {
  const { timeZone = "UTC", slot } = req.body as {
    timeZone?: string;
    slot?: number;
  };
  if (!isValidTimeZone(timeZone)) {
    res.status(400).json({ error: "invalid timeZone" });
    return;
  }
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > 6) {
    res.status(400).json({ error: "slot must be an integer 1-6" });
    return;
  }

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
  const payload: HistoryResponse = { battleId: session.id, ...session.history() };
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

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});