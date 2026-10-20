import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import type { PokemonSet } from "./types";

const gens = new Generations(Dex);
export const gen3 = gens.get(3);

export function speciesOf(set: PokemonSet) {
  return gen3.species.get(set.species) ?? gen3.species.get(set.name) ?? null;
}

export function typesOf(set: PokemonSet): string[] {
  return speciesOf(set)?.types ?? [];
}

function moveIdOf(id: string): string {
  const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.startsWith("hiddenpower") ? "hiddenpower" : normalized;
}

export function moveOf(id: string) {
  return gen3.moves.get(moveIdOf(id)) ?? null;
}

export function speciesByName(name: string) {
  return gen3.species.get(name) ?? null;
}

export function dexNumOf(name: string): number | null {
  const num = speciesByName(name)?.num;
  return num !== undefined && num > 0 && num <= 386 ? num : null;
}

export const STAT_LABELS = [
  ["hp", "HP"],
  ["atk", "Atk"],
  ["def", "Def"],
  ["spa", "SpA"],
  ["spd", "SpD"],
  ["spe", "Spe"],
] as const;

export function baseStatsOf(set: PokemonSet) {
  return speciesOf(set)?.baseStats ?? null;
}

export function baseStatTotal(set: PokemonSet): number {
  const stats = baseStatsOf(set);
  if (stats === null) return 0;
  return stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe;
}
