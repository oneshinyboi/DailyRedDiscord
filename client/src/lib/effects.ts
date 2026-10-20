import { applyLine, cloneView } from "./battle";
import type { BattleView } from "./battle";
import { moveOf } from "./dex";
import { formatLogLine } from "./format";

export type Side = "p1" | "p2";

export type EffectKind =
  | "attack"
  | "hit"
  | "miss"
  | "boost"
  | "unboost"
  | "status"
  | "heal"
  | "faint"
  | "withdraw";

export interface Effect {
  kind: EffectKind;
  /** The side whose sprite the effect plays on. */
  side: Side;
  /** attack: how the attacker moves. */
  style?: "physical" | "special" | "status";
  /** attack/hit: lowercase type of the move in play, for tinting. */
  moveType?: string;
  /** hit: 1 resisted / chip damage, 2 normal, 3 critical or super effective. */
  power?: 1 | 2 | 3;
  /** status: the status code, e.g. "par". */
  status?: string;
}

export interface ActiveEffect extends Effect {
  /** Changes every step so repeated effects replay. */
  nonce: number;
}

export interface PlaybackStep {
  /** Battle state once this step has landed. */
  view: BattleView;
  /** How many protocol lines have been revealed after this step. */
  lineCount: number;
  /** Message to show; null keeps the previous one. */
  text: string | null;
  effect: Effect | null;
  /** Milliseconds before the next step. */
  duration: number;
}

const TYPE_COLORS: Record<string, string> = {
  normal: "#d8d8c0",
  fire: "#ff8a2e",
  water: "#4a9bff",
  electric: "#ffe035",
  grass: "#6fdc45",
  ice: "#8ff0ec",
  fighting: "#e0443c",
  poison: "#c04ebe",
  ground: "#e6c25a",
  flying: "#a994ff",
  psychic: "#ff5c92",
  bug: "#b8cc2a",
  rock: "#c4ae3c",
  ghost: "#7a62a8",
  dragon: "#7a4cff",
  dark: "#7a6050",
  steel: "#b4b4d0",
};

export function typeColor(type: string | undefined): string {
  return (type !== undefined && TYPE_COLORS[type]) || "#ffffff";
}

function sideOf(ident: string | undefined): Side | null {
  if (ident === undefined) return null;
  if (ident.startsWith("p1")) return "p1";
  if (ident.startsWith("p2")) return "p2";
  return null;
}

function other(side: Side): Side {
  return side === "p1" ? "p2" : "p1";
}

const TEXT_MS = 550;
const MOVE_MS = 750;
const HIT_MS = 850;
const STATUS_MS = 950;
const FAINT_MS = 1000;
const WITHDRAW_MS = 350;

/**
 * Turns freshly arrived protocol lines into timed steps. `base` is the view
 * before `lines`, and `offset` is how many lines preceded them. Lines that
 * neither change what the player sees nor have a message produce no step; the
 * state they change is carried into the next step's view.
 */
export function buildSteps(
  base: BattleView,
  lines: string[],
  offset: number
): PlaybackStep[] {
  const view = cloneView(base);
  const steps: PlaybackStep[] = [];
  let moveType: string | undefined;
  let crit = false;
  let superEffective = false;
  let resisted = false;

  lines.forEach((line, i) => {
    const parts = line.startsWith("|") ? line.slice(1).split("|") : [];
    const kind = parts[0];
    const args = parts.slice(1);
    const side = sideOf(args[0]);

    if (kind === "switch" && side !== null) {
      const current = view[side].active;
      if (current !== null && !current.fainted) {
        steps.push({
          view: cloneView(view),
          lineCount: offset + i,
          text: null,
          effect: { kind: "withdraw", side },
          duration: WITHDRAW_MS,
        });
      }
    }

    applyLine(view, line);

    const entry = formatLogLine(line);
    let text = entry !== null && entry.turn !== true ? entry.text : null;
    let effect: Effect | null = null;
    let duration = TEXT_MS;
    const fromSource = args.some((arg) => arg.startsWith("[from]"));

    switch (kind) {
      case "move": {
        const info = moveOf(args[1] ?? "");
        moveType = info?.type.toLowerCase();
        crit = false;
        superEffective = false;
        resisted = false;
        if (side !== null) {
          const target = sideOf(args[2]);
          const style =
            info?.category === "Status" || target === side
              ? "status"
              : info?.category === "Special"
                ? "special"
                : "physical";
          effect = { kind: "attack", side, style, moveType };
        }
        duration = MOVE_MS;
        break;
      }
      case "-crit":
        crit = true;
        break;
      case "-supereffective":
        superEffective = true;
        break;
      case "-resisted":
        resisted = true;
        break;
      case "-damage":
        if (side !== null) {
          if (fromSource) {
            effect = { kind: "hit", side, power: 1 };
          } else {
            const power = crit || superEffective ? 3 : resisted ? 1 : 2;
            effect = { kind: "hit", side, power, moveType };
            text = null;
            crit = false;
            superEffective = false;
            resisted = false;
          }
          duration = HIT_MS;
        }
        break;
      case "-heal":
        if (side !== null) {
          effect = { kind: "heal", side };
          if (!fromSource) text = null;
          duration = HIT_MS;
        }
        break;
      case "-miss": {
        const target = sideOf(args[1]) ?? (side === null ? null : other(side));
        if (target !== null) effect = { kind: "miss", side: target };
        duration = MOVE_MS;
        break;
      }
      case "-immune":
        if (side !== null) effect = { kind: "miss", side };
        duration = MOVE_MS;
        break;
      case "-boost":
      case "-unboost":
        if (side !== null) {
          effect = { kind: kind === "-boost" ? "boost" : "unboost", side };
          duration = STATUS_MS;
        }
        break;
      case "-status":
        if (side !== null) {
          effect = { kind: "status", side, status: args[1] };
          duration = STATUS_MS;
        }
        break;
      case "faint":
        if (side !== null) {
          effect = { kind: "faint", side };
          duration = FAINT_MS;
        }
        break;
      case "switch":
      case "win":
      case "tie":
        duration = MOVE_MS;
        break;
    }

    if (effect === null && text === null) return;
    steps.push({
      view: cloneView(view),
      lineCount: offset + i + 1,
      text,
      effect,
      duration,
    });
  });

  return steps;
}
