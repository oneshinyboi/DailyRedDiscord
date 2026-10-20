import dotenv from "dotenv";
import { COMMANDS } from "../commands.js";

dotenv.config({ path: "../.env" });

const API = process.env.DISCORD_API_BASE_URL ?? "https://discord.com/api";
const clientId = process.env.VITE_DISCORD_CLIENT_ID;
const clientSecret = process.env.DISCORD_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("VITE_DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set");
  process.exit(1);
}

// A client-credentials token with this scope may manage the app's commands,
// so no bot token is needed.
const tokenResponse = await fetch(`${API}/oauth2/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
  },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    scope: "applications.commands.update",
  }),
});
const token = (await tokenResponse.json()) as { access_token?: string };
if (!tokenResponse.ok || !token.access_token) {
  console.error("Could not get a command-management token", token);
  process.exit(1);
}

// Create-or-update each command by name. A bulk overwrite is avoided on
// purpose: Activities have an auto-created Entry Point command that a bulk
// update would try to remove. Commands not listed here are left untouched.
for (const command of COMMANDS) {
  const response = await fetch(`${API}/applications/${clientId}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.access_token}`,
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    console.error(
      `Registering /${command.name} failed (${response.status})`,
      await response.text()
    );
    process.exit(1);
  }
  console.log(`Registered /${command.name}`);
}
