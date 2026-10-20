import { describe, expect, it } from "vitest";
import { buildBattleView } from "./battle";
import { buildSteps } from "./effects";

const opening = [
  "|switch|p1a: Pikachu|Pikachu, L100|100/100",
  "|switch|p2a: Onix|Onix, L50|100/100",
];
const base = buildBattleView(opening);

function steps(lines: string[]) {
  return buildSteps(base, lines, opening.length);
}

describe("buildSteps", () => {
  it("plays a super effective special hit as attack then hit, and drains HP on the hit", () => {
    const result = steps([
      "|move|p1a: Pikachu|Thunderbolt|p2a: Onix",
      "|-supereffective|p2a: Onix",
      "|-damage|p2a: Onix|40/100",
    ]);
    expect(result.map((s) => s.effect?.kind ?? null)).toEqual(["attack", null, "hit"]);
    expect(result[0].effect).toMatchObject({ side: "p1", style: "special", moveType: "electric" });
    expect(result[0].view.p2.active?.hpPct).toBe(100);
    expect(result[2].effect).toMatchObject({ side: "p2", power: 3, moveType: "electric" });
    expect(result[2].view.p2.active?.hpPct).toBe(40);
    expect(result[2].text).toBeNull();
    expect(result[2].lineCount).toBe(opening.length + 3);
  });

  it("scales hit power down for resisted hits and does not carry modifiers between moves", () => {
    const result = steps([
      "|move|p1a: Pikachu|Thunderbolt|p2a: Onix",
      "|-crit|p2a: Onix",
      "|-damage|p2a: Onix|60/100",
      "|move|p1a: Pikachu|Quick Attack|p2a: Onix",
      "|-damage|p2a: Onix|50/100",
    ]);
    const hits = result.filter((s) => s.effect?.kind === "hit");
    expect(hits.map((s) => s.effect?.power)).toEqual([3, 2]);
  });

  it("targets the defender with miss and the stat-dropped side with unboost", () => {
    const result = steps([
      "|move|p1a: Pikachu|Quick Attack|p2a: Onix",
      "|-miss|p1a: Pikachu|p2a: Onix",
      "|move|p2a: Onix|Growl|p1a: Pikachu",
      "|-unboost|p1a: Pikachu|atk|1",
    ]);
    expect(result[1].effect).toMatchObject({ kind: "miss", side: "p2" });
    expect(result[2].effect).toMatchObject({ kind: "attack", side: "p2", style: "status" });
    expect(result[3].effect).toMatchObject({ kind: "unboost", side: "p1" });
  });

  it("withdraws the old mon before a voluntary switch but not after a faint", () => {
    const voluntary = steps(["|switch|p2a: Geodude|Geodude, L50|100/100"]);
    expect(voluntary.map((s) => s.effect?.kind ?? null)).toEqual(["withdraw", null]);
    expect(voluntary[0].view.p2.active?.species).toBe("Onix");
    expect(voluntary[1].view.p2.active?.species).toBe("Geodude");

    const afterFaint = steps([
      "|faint|p2a: Onix",
      "|switch|p2a: Geodude|Geodude, L50|100/100",
    ]);
    expect(afterFaint.map((s) => s.effect?.kind ?? null)).toEqual(["faint", null]);
    expect(afterFaint[0].view.p2.active?.fainted).toBe(true);
  });

  it("makes no step for lines with nothing to show", () => {
    expect(steps(["|turn|2", "|upkeep", ""])).toEqual([]);
  });
});
