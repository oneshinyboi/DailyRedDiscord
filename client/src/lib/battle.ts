/**
 * Folds the Showdown protocol lines the server sends (p1's filtered view)
 * into a small snapshot the battle scene can render.
 */

export interface ActiveMon {
  name: string;
  species: string;
  level: number;
  /** 0-100 */
  hpPct: number;
  /** Real numbers are only known for our own side; Red's HP is a percentage. */
  hp: number | null;
  maxHp: number | null;
  status: string | null;
  fainted: boolean;
}

export interface SideState {
  active: ActiveMon | null;
  teamSize: number;
  /** Species that have fainted. */
  faintedSpecies: string[];
  /** Species seen on this side (preview / sent out), in order. */
  roster: string[];
}

export interface BattleView {
  turn: number;
  p1: SideState;
  p2: SideState;
}

function emptySide(): SideState {
  return { active: null, teamSize: 6, faintedSpecies: [], roster: [] };
}

function parseDetails(details: string): { species: string; level: number } {
  const parts = details.split(", ");
  const species = parts[0] ?? details;
  const levelPart = parts.find((p) => /^L\d+$/.test(p));
  return { species, level: levelPart ? Number(levelPart.slice(1)) : 100 };
}

function parseCondition(condition: string): {
  hpPct: number;
  hp: number | null;
  maxHp: number | null;
  status: string | null;
  fainted: boolean;
} {
  const [hpPart = "0", status] = condition.split(" ");
  if (status === "fnt" || hpPart === "0") {
    return { hpPct: 0, hp: 0, maxHp: null, status: null, fainted: true };
  }
  const [curRaw, maxRaw] = hpPart.split("/");
  const cur = Number(curRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) {
    return { hpPct: 100, hp: null, maxHp: null, status: status ?? null, fainted: false };
  }
  return {
    hpPct: Math.max(0, Math.min(100, (cur / max) * 100)),
    hp: cur,
    maxHp: max,
    status: status ?? null,
    fainted: false,
  };
}

function sideKey(ident: string): "p1" | "p2" | null {
  if (ident.startsWith("p1")) return "p1";
  if (ident.startsWith("p2")) return "p2";
  return null;
}

function nameOf(ident: string): string {
  const at = ident.indexOf(": ");
  return at === -1 ? ident : ident.slice(at + 2);
}

function addRoster(side: SideState, species: string): void {
  if (!side.roster.includes(species)) side.roster.push(species);
}

export function createView(): BattleView {
  return { turn: 0, p1: emptySide(), p2: emptySide() };
}

function cloneSide(side: SideState): SideState {
  return {
    ...side,
    active: side.active === null ? null : { ...side.active },
    faintedSpecies: [...side.faintedSpecies],
    roster: [...side.roster],
  };
}

export function cloneView(view: BattleView): BattleView {
  return { turn: view.turn, p1: cloneSide(view.p1), p2: cloneSide(view.p2) };
}

export function buildBattleView(lines: string[]): BattleView {
  const view = createView();
  for (const line of lines) applyLine(view, line);
  return view;
}

/** Folds one protocol line into `view`, mutating it. */
export function applyLine(view: BattleView, line: string): void {
  if (!line.startsWith("|")) return;
  const parts = line.slice(1).split("|");
  const kind = parts[0];
  const args = parts.slice(1);

  switch (kind) {
    case "teamsize": {
      const key = args[0] === "p1" || args[0] === "p2" ? args[0] : null;
      const size = Number(args[1]);
      if (key !== null && Number.isFinite(size) && size > 0) {
        view[key].teamSize = size;
      }
      break;
    }
    case "poke": {
      const key = args[0] === "p1" || args[0] === "p2" ? args[0] : null;
      if (key !== null && args[1] !== undefined) {
        addRoster(view[key], parseDetails(args[1]).species);
      }
      break;
    }
    case "turn": {
      const n = Number(args[0]);
      if (Number.isFinite(n)) view.turn = n;
      break;
    }
    case "switch":
    case "drag": {
      const key = sideKey(args[0] ?? "");
      if (key === null) break;
      const { species, level } = parseDetails(args[1] ?? "");
      const cond = parseCondition(args[2] ?? "100/100");
      addRoster(view[key], species);
      view[key].active = {
        name: nameOf(args[0] ?? ""),
        species,
        level,
        ...cond,
      };
      break;
    }
    case "-damage":
    case "-heal":
    case "-sethp": {
      const key = sideKey(args[0] ?? "");
      const active = key === null ? null : view[key].active;
      if (key === null || active === null) break;
      const cond = parseCondition(args[1] ?? "");
      view[key].active = {
        ...active,
        ...cond,
        status: cond.status ?? active.status,
      };
      break;
    }
    case "-status": {
      const key = sideKey(args[0] ?? "");
      const active = key === null ? null : view[key].active;
      if (key !== null && active !== null) {
        view[key].active = { ...active, status: args[1] ?? null };
      }
      break;
    }
    case "-curestatus": {
      const key = sideKey(args[0] ?? "");
      const active = key === null ? null : view[key].active;
      if (key !== null && active !== null) {
        view[key].active = { ...active, status: null };
      }
      break;
    }
    case "faint": {
      const key = sideKey(args[0] ?? "");
      const active = key === null ? null : view[key].active;
      if (key !== null && active !== null) {
        view[key].active = { ...active, hpPct: 0, hp: 0, fainted: true, status: null };
        if (!view[key].faintedSpecies.includes(active.species)) {
          view[key].faintedSpecies.push(active.species);
        }
      }
      break;
    }
  }
}

export function hpColor(pct: number): "green" | "yellow" | "red" {
  if (pct > 50) return "green";
  if (pct > 20) return "yellow";
  return "red";
}
