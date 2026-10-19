import express from "express";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import { requireDiscordUser } from "./auth.js";
import { isValidTimeZone } from "./battle/seed.js";
import { createSession, getSessionFor } from "./battle/session.js";

const app = express();
const port = 3001;

// Allow express to parse JSON bodies
app.use(express.json());

// All battle routes require a valid Discord access token.
app.use("/api/battle", requireDiscordUser);

// Start a daily battle. Body: { timeZone?: string } (IANA name, defaults UTC).
app.post("/api/battle/start", async (req, res) => {
  const { timeZone = "UTC" } = req.body as { timeZone?: string };
  if (!isValidTimeZone(timeZone)) {
    res.status(400).json({ error: "invalid timeZone" });
    return;
  }
  const session = createSession(req.userId!, timeZone);
  const { lines, request, ended, winner } = await session.ready();
  res.json({
    battleId: session.id,
    date: session.date,
    lines,
    request,
    ended,
    winner,
  });
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
    const result = await session.choose(choice);
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
  res.json({ battleId: session.id, ...session.history() });
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