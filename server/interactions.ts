import { createPublicKey, verify, type KeyObject } from "node:crypto";
import type { Request, Response } from "express";
import { guildLeaderboard, MIN_RANKED_GAMES } from "./battle/store.js";

// DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG_RESPONSE = 1;
const MESSAGE_RESPONSE = 4;
const EPHEMERAL = 64;

let cachedKey: { hex: string; key: KeyObject } | undefined;

function publicKey(): KeyObject | undefined {
  const hex = process.env.DISCORD_PUBLIC_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  if (cachedKey?.hex !== hex) {
    cachedKey = {
      hex,
      key: createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]),
        format: "der",
        type: "spki",
      }),
    };
  }
  return cachedKey.key;
}

function validSignature(req: Request, key: KeyObject): boolean {
  const signature = req.get("x-signature-ed25519");
  const timestamp = req.get("x-signature-timestamp");
  if (!signature || !timestamp || !Buffer.isBuffer(req.body)) return false;
  try {
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), req.body]),
      key,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

function formatRate(wins: number, games: number): string {
  return `${+((wins / games) * 100).toFixed(1)}%`;
}

function leaderboardMessage(guildId: string) {
  const entries = guildLeaderboard(guildId, 10);
  if (entries.length === 0) {
    return {
      content:
        "Nobody here has finished a Daily Red battle yet. Launch the activity and be the first!",
      allowed_mentions: { parse: [] },
    };
  }

  const lines: string[] = [];
  let rankedHeaderDone = false;
  entries.forEach((entry, i) => {
    if (!rankedHeaderDone && entry.games < MIN_RANKED_GAMES) {
      rankedHeaderDone = true;
      if (i > 0) lines.push("", `**Fewer than ${MIN_RANKED_GAMES} games**`);
    }
    lines.push(
      `${i + 1}. <@${entry.ownerId}> - ${formatRate(entry.wins, entry.games)} ` +
        `(${entry.wins}/${entry.games})`
    );
  });

  return {
    embeds: [
      {
        title: "Daily Red leaderboard",
        description: lines.join("\n"),
        color: 0xd23339,
        footer: {
          text: `Win rate = wins / games played. Players under ${MIN_RANKED_GAMES} games are listed after everyone else.`,
        },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/**
 * Discord interactions endpoint. Mount with `express.raw()` so the body is
 * the exact bytes Discord signed.
 */
export function handleInteraction(req: Request, res: Response): void {
  const key = publicKey();
  if (!key) {
    res.status(503).json({ error: "DISCORD_PUBLIC_KEY is not configured" });
    return;
  }
  if (!validSignature(req, key)) {
    res.status(401).send("invalid request signature");
    return;
  }

  let interaction: {
    type: number;
    guild_id?: string;
    data?: { name?: string };
  };
  try {
    interaction = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  if (interaction.type === PING) {
    res.json({ type: PONG_RESPONSE });
    return;
  }

  if (
    interaction.type === APPLICATION_COMMAND &&
    interaction.data?.name === "leaderboard"
  ) {
    if (!interaction.guild_id) {
      res.json({
        type: MESSAGE_RESPONSE,
        data: { content: "Use this command in a server.", flags: EPHEMERAL },
      });
      return;
    }
    res.json({ type: MESSAGE_RESPONSE, data: leaderboardMessage(interaction.guild_id) });
    return;
  }

  res.json({
    type: MESSAGE_RESPONSE,
    data: { content: "Unknown command.", flags: EPHEMERAL },
  });
}
