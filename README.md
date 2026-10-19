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
