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
