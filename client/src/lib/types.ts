import type { ChoiceRequest, PokemonSet, StreakInfo } from "@dailyred/shared";

export type * from "@dailyred/shared";

export interface GameData {
  battleId: string;
  date: string;
  team: PokemonSet[];
  lines: string[];
  request: ChoiceRequest | null;
  ended: boolean;
  winner: string | null;
  streak: StreakInfo;
}
