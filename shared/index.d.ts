export type BattlePhase = "battling" | "ended";

export interface PokemonSet {
  name: string;
  species: string;
  level?: number;
  item?: string;
  ability?: string;
  gender?: string;
  moves: string[];
}

export interface MoveRequestData {
  move: string;
  id: string;
  pp?: number;
  maxpp?: number;
  target?: string;
  disabled?: boolean | string;
}

export interface PokemonSwitchRequestData {
  ident: string;
  details: string;
  condition: string;
  active: boolean;
  moves: string[];
  item: string;
}

export interface SideRequestData {
  name: string;
  id: string;
  pokemon: PokemonSwitchRequestData[];
}

export interface WaitRequest {
  wait: true;
  side: SideRequestData;
}

export interface TeamPreviewRequest {
  teamPreview: true;
  side: SideRequestData;
}

export interface SwitchRequest {
  forceSwitch: boolean[];
  side: SideRequestData;
}

export interface MoveRequest {
  active: { moves: MoveRequestData[] }[];
  side: SideRequestData;
}

export type ChoiceRequest =
  | WaitRequest
  | TeamPreviewRequest
  | SwitchRequest
  | MoveRequest;

export interface BattleSnapshot {
  phase: BattlePhase;
  lines: string[];
  request: ChoiceRequest | null;
  ended: boolean;
  winner: string | null;
}

export type ChoiceResponse = BattleSnapshot & { error?: string };

export type StartResponse =
  | { battleId: null; phase: "preview"; date: string; team: PokemonSet[] }
  | {
      battleId: string;
      date: string;
      phase: BattlePhase;
      team: PokemonSet[];
      ended: boolean;
      winner: string | null;
    };

export type BeginResponse =
  | (BattleSnapshot & { battleId: string; date: string; team: PokemonSet[] })
  | {
      battleId: string;
      date: string;
      phase: BattlePhase;
      team: PokemonSet[];
      ended: boolean;
      winner: string | null;
    };

export type BattleHistory = BattleSnapshot & {
  date: string;
  team: PokemonSet[];
};

export type HistoryResponse = BattleHistory & {
  battleId: string;
};
