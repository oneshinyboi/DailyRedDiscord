import type { PokemonSet } from "pokemon-showdown/dist/sim/teams.js";

const maxIvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/**
 * Red's team - canon GSC Mt. Silver set (Pikachu, Espeon, Snorlax, Venusaur,
 * Charizard, Blastoise) with his in-game movesets, scaled to level 100. The
 * held items are not canon; they are the usual gen 3 picks for each Pokemon.
 */
export const RED_TEAM: PokemonSet[] = [
  {
    name: "Pikachu",
    species: "pikachu",
    item: "Light Ball",
    ability: "Static",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["thunder", "thunderbolt", "quickattack", "lightscreen"],
    evs: { hp: 4, spa: 252, spe: 252 },
  },
  {
    name: "Espeon",
    species: "espeon",
    item: "Twisted Spoon",
    ability: "Synchronize",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["psychic", "mudslap", "quickattack", "reflect"],
    evs: { hp: 4, spa: 252, spe: 252 },
  },
  {
    name: "Snorlax",
    species: "snorlax",
    item: "Leftovers",
    ability: "Immunity",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["amnesia", "bodyslam", "rest", "snore"],
    evs: { hp: 252, atk: 252, spd: 4 },
  },
  {
    name: "Venusaur",
    species: "venusaur",
    item: "Miracle Seed",
    ability: "Overgrow",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["gigadrain", "sunnyday", "synthesis", "solarbeam"],
    evs: { hp: 4, def: 252, spa: 252 },
  },
  {
    name: "Charizard",
    species: "charizard",
    item: "Charcoal",
    ability: "Blaze",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["flamethrower", "wingattack", "slash", "firespin"],
    evs: { hp: 4, spa: 252, spe: 252 },
  },
  {
    name: "Blastoise",
    species: "blastoise",
    item: "Mystic Water",
    ability: "Torrent",
    gender: "M",
    nature: "Serious",
    ivs: maxIvs,
    level: 100,
    moves: ["surf", "raindance", "bite", "withdraw"],
    evs: { hp: 4, def: 252, spa: 252 },
  },
];
