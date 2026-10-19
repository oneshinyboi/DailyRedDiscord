export interface LogEntry {
  text: string;
  turn?: boolean;
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
