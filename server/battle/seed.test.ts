import { describe, expect, it } from "vitest";
import {
  dailySeedsForDate,
  isValidTimeZone,
  previousDay,
  seedFromString,
} from "./seed.js";

describe("seedFromString", () => {
  it("is deterministic and produces four numeric parts", () => {
    const seed = seedFromString("hello");
    expect(seedFromString("hello")).toBe(seed);
    expect(seed.split(",")).toHaveLength(4);
    expect(seed.split(",").every((p) => /^\d+$/.test(p))).toBe(true);
  });

  it("differs for different inputs", () => {
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
  });
});

describe("dailySeedsForDate", () => {
  it("is stable for a date and differs between dates", () => {
    expect(dailySeedsForDate("2026-01-01")).toEqual(dailySeedsForDate("2026-01-01"));
    expect(dailySeedsForDate("2026-01-01").teamSeed).not.toBe(
      dailySeedsForDate("2026-01-02").teamSeed
    );
  });

  it("uses a distinct seed for team, battle and AI", () => {
    const { teamSeed, battleSeed, aiSeed } = dailySeedsForDate("2026-01-01");
    expect(new Set([teamSeed, battleSeed, aiSeed]).size).toBe(3);
  });
});

describe("previousDay", () => {
  it.each([
    ["2026-03-15", "2026-03-14"],
    ["2026-03-01", "2026-02-28"],
    ["2024-03-01", "2024-02-29"],
    ["2026-01-01", "2025-12-31"],
  ])("%s -> %s", (input, expected) => {
    expect(previousDay(input)).toBe(expected);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects garbage", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
