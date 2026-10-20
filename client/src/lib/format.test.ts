import { describe, expect, it } from "vitest";
import { buildResult, formatLogLine, resultBanner } from "./format";
import type { PokemonSet } from "./types";

const team = Array.from({ length: 6 }, () => ({}) as PokemonSet);

describe("buildResult", () => {
  it("summarises a win from the challenger's side", () => {
    const result = buildResult({
      date: "2026-01-01",
      winner: "Challenger",
      team,
      lines: ["|turn|1", "|faint|p1a: Pidgey", "|faint|p2a: Rattata", "|turn|7"],
    });
    expect(result.outcome).toBe("win");
    expect(result.koCount).toBe(1);
    expect(result.teamSize).toBe(6);
    expect(result.turns).toBe(7);
    expect(result.icons).toEqual(["\u{1F7E5}", ...Array(5).fill("\u2B1B")]);
    expect(result.headline).toBe("Daily Red 2026-01-01: You won");
    expect(result.shareText).toContain("1/6 KO'd \u00B7 7 turns");
  });

  it("shows Red's side when Red wins", () => {
    const result = buildResult({
      date: "2026-01-01",
      winner: "Red",
      team,
      lines: ["|teamsize|p2|3", "|faint|p1a: Pidgey", "|faint|p2c: Snorlax"],
    });
    expect(result.outcome).toBe("loss");
    expect(result.teamSize).toBe(3);
    expect(result.koCount).toBe(1);
    expect(result.icons).toEqual(["\u2B1B", "\u2B1B", "\u{1F7E5}"]);
  });

  it("reports a tie", () => {
    const result = buildResult({ date: "2026-01-01", winner: null, team, lines: [] });
    expect(result.outcome).toBe("tie");
    expect(result.headline).toBe("Daily Red 2026-01-01: Tie");
  });
});

describe("resultBanner", () => {
  it("maps each winner to a banner kind", () => {
    expect(resultBanner("Challenger").kind).toBe("win");
    expect(resultBanner("Red").kind).toBe("loss");
    expect(resultBanner(null).kind).toBe("tie");
  });
});

describe("formatLogLine", () => {
  it("formats common battle lines", () => {
    expect(formatLogLine("|turn|3")).toEqual({ text: "Turn 3", turn: true });
    expect(formatLogLine("|move|p1a: Pikachu|Thunderbolt|p2a: Onix")).toEqual({
      text: "Pikachu used Thunderbolt!",
    });
    expect(formatLogLine("|faint|p2a: Onix")).toEqual({ text: "Onix fainted!" });
    expect(formatLogLine("|switch|p2a: Onix|Onix|100/100")).toEqual({
      text: "Red sent out Onix!",
    });
    expect(formatLogLine("|-boost|p1a: Pikachu|atk|2")).toEqual({
      text: "Pikachu's atk sharply rose!",
    });
  });

  it("skips protocol noise and blank lines", () => {
    expect(formatLogLine("")).toBeNull();
    expect(formatLogLine("|start")).toBeNull();
    expect(formatLogLine("|player|p1|Challenger")).toBeNull();
  });
});
