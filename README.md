# DailyRedDiscord

A Discord Activity that simulates a Pokemon battle against Red, in the style of
[daily-red.com](https://daily-red.com), powered by
[pokemon-showdown](https://github.com/smogon/pokemon-showdown).

## Structure

- `client/` - React + Vite frontend, embedded via the Discord SDK
- `server/` - Express backend; authoritative battle engine + OAuth token exchange
- `shared/` - `@dailyred/shared`, the wire-contract types used by both

## Setup

1. `cp example.env .env` and fill in your Discord app credentials
2. `npm install` at the repo root (npm workspaces)
3. `npm run dev:client` and `npm run dev:server` from the repo root

## Leaderboard command

`/leaderboard` shows a server's top 10 players by win rate. It is a slash
command delivered to the server over Discord's interactions endpoint, so no bot
token or gateway connection is needed.

1. Set `DISCORD_PUBLIC_KEY` in `.env` (Developer Portal -> General Information).
2. In the portal, set **Interactions Endpoint URL** to
   `https://<your public host>/api/interactions`.
3. Register the command with `npm run register-commands -w server`.
4. The app must be installed in the server with the `applications.commands` scope.

Players only appear on a server's board once they have opened the activity
from that server. Players with fewer than 3 finished games are listed after
everyone else.
