import type { PokemonSet } from "./types";

export interface LogEntry {
  text: string;
  turn?: boolean;
}

export interface BattleResult {
  date: string;
  outcome: "win" | "loss" | "tie";
  winnerLabel: string;
  icons: string[];
  koCount: number;
  teamSize: number;
  turns: number;
  headline: string;
  stats: string;
  shareText: string;
}

const KO_ICON = "\u{1F7E5}";
const ALIVE_ICON = "\u2B1B";

function sideAndSlot(ident: string): { side: string; slot: number } | null {
  const match = /^(p[12])([a-z]):/.exec(ident);
  if (match === null) return null;
  return { side: match[1], slot: match[2].charCodeAt(0) - 97 };
}

export function buildResult(input: {
  date: string;
  winner: string | null;
  lines: string[];
  team: PokemonSet[];
}): BattleResult {
  const { date, winner, lines } = input;
  const outcome =
    winner === "Challenger" ? "win" : winner === "Red" ? "loss" : "tie";
  const winnerLabel = winner === "Challenger" ? "You" : winner === "Red" ? "Red" : "";
  const shownSide = winner === "Red" ? "p2" : "p1";

  let teamSize = shownSide === "p1" ? input.team.length || 6 : 6;
  const fainted = new Set<number>();
  let turns = 0;

  for (const line of lines) {
    if (line.startsWith("|teamsize|")) {
      const parts = line.slice(1).split("|");
      if (parts[1] === shownSide && parts[2] !== undefined) {
        teamSize = Number(parts[2]) || teamSize;
      }
    } else if (line.startsWith("|faint|")) {
      const parts = line.slice(1).split("|");
      const loc = sideAndSlot(parts[1] ?? "");
      if (loc !== null && loc.side === shownSide) fainted.add(loc.slot);
    } else if (line.startsWith("|turn|")) {
      const parts = line.slice(1).split("|");
      const value = Number(parts[1]);
      if (Number.isFinite(value)) turns = value;
    }
  }

  const maxSlot = fainted.size > 0 ? Math.max(...fainted) : -1;
  teamSize = Math.max(teamSize, maxSlot + 1);

  const icons: string[] = [];
  for (let slot = 0; slot < teamSize; slot++) {
    icons.push(fainted.has(slot) ? KO_ICON : ALIVE_ICON);
  }

  const headline =
    outcome === "tie"
      ? `Daily Red ${date}: Tie`
      : `Daily Red ${date}: ${winnerLabel} won`;
  const stats = `${fainted.size}/${teamSize} KO'd \u00B7 ${turns} turns`;

  return {
    date,
    outcome,
    winnerLabel,
    icons,
    koCount: fainted.size,
    teamSize,
    turns,
    headline,
    stats,
    shareText: `${headline}\n${icons.join("")}  ${stats}`,
  };
}

export function resultBanner(winner: string | null): {
  text: string;
  kind: "win" | "loss" | "tie";
} {
  if (winner === "Challenger") return { text: "You defeated Red!", kind: "win" };
  if (winner === "Red") {
    return { text: "Red defeated you. Come back tomorrow!", kind: "loss" };
  }
  return { text: "It's a tie!", kind: "tie" };
}

export function displayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function identName(ident: string): string {
  const at = ident.indexOf(": ");
  return at === -1 ? ident : ident.slice(at + 2);
}

const SKIP = new Set([
  "init",
  "title",
  "player",
  "p1",
  "p2",
  "p3",
  "p4",
  "gen",
  "tier",
  "rule",
  "rated",
  "start",
  "seed",
  "chat",
  "gametype",
  "teamsize",
  "poke",
  "teampreview",
  "clearpoke",
  "j",
  "l",
  "t:",
  "upkeep",
]);

const STATUS: Record<string, string> = {
  par: "paralyzed",
  psn: "poisoned",
  tox: "badly poisoned",
  brn: "burned",
  slp: "put to sleep",
  frz: "frozen",
};

function sideOf(ident: string): string {
  return ident.startsWith("p1") ? "You" : "Red";
}

function hpOf(condition: string): string {
  return condition.split(" ")[0] ?? condition;
}

export function formatLogLine(line: string): LogEntry | null {
  if (line === "") return null;
  if (!line.startsWith("|")) return { text: line };
  const parts = line.slice(1).split("|");
  const kind = parts[0];
  if (!kind || SKIP.has(kind)) return null;
  const args = parts.slice(1);

  if (kind === "turn") return { text: `Turn ${args[0] ?? ""}`, turn: true };

  switch (kind) {
    case "move":
      return { text: `${identName(args[0] ?? "")} used ${args[1] ?? ""}!` };
    case "switch":
    case "drag":
    case "replace":
      return {
        text: `${sideOf(args[0] ?? "")} sent out ${identName(args[0] ?? "")}!`,
      };
    case "faint":
      return { text: `${identName(args[0] ?? "")} fainted!` };
    case "win":
      return { text: `${args[0] ?? ""} wins!` };
    case "tie":
      return { text: "The battle ended in a tie." };
    case "error":
      return { text: `Error: ${args[0] ?? ""}` };
    case "damage":
    case "heal":
    case "-damage":
    case "-heal":
      return {
        text: `${identName(args[0] ?? "")} is at ${hpOf(args[1] ?? "")} HP.`,
      };
    case "-miss":
      return { text: "The attack missed!" };
    case "-fail":
      return { text: "But it failed!" };
    case "-immune":
      return { text: `${identName(args[0] ?? "")} is unaffected!` };
    case "-crit":
      return { text: "A critical hit!" };
    case "-supereffective":
      return { text: "It's super effective!" };
    case "-resisted":
      return { text: "It's not very effective..." };
    case "-status":
      return {
        text: `${identName(args[0] ?? "")} was ${STATUS[args[1] ?? ""] ?? "affected"}!`,
      };
    case "-curestatus":
      return {
        text: `${identName(args[0] ?? "")} is no longer ${STATUS[args[1] ?? ""] ?? "affected"}.`,
      };
    case "-boost":
    case "-unboost": {
      const dir = kind === "-boost" ? "rose" : "fell";
      const sharply = args[2] === "2" ? " sharply" : "";
      return {
        text: `${identName(args[0] ?? "")}'s ${args[1] ?? "stat"}${sharply} ${dir}!`,
      };
    }
  }

  const rest = args.filter(Boolean).join(" - ");
  return rest === "" ? null : { text: rest };
}

export function pokemonName(set: PokemonSet): string {
  return set.name || displayName(set.species);
}
