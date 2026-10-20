import { baseStatTotal, moveOf, typesOf } from "../lib/dex";
import { displayName, pokemonName } from "../lib/format";
import type { PokemonSet } from "../lib/types";
import Sprite from "./Sprite";

interface TeamViewProps {
  team: PokemonSet[];
  /** Click-to-select mode (lead picker). Omit for a read-only list. */
  onSelect?: (slot: number) => void;
  /** 1-based slot to leave out (the lead shown in the big card). */
  excludeSlot?: number | null;
  showMoves?: boolean;
  disabled?: boolean;
}

export function TypeBadges({ types }: { types: string[] }) {
  if (types.length === 0) return null;
  return (
    <span className="type-badges">
      {types.map((type) => (
        <span key={type} className={`type-badge type-${type.toLowerCase()}`}>
          {type}
        </span>
      ))}
    </span>
  );
}

export function MoveList({ moves }: { moves: string[] }) {
  return (
    <>
      {moves.map((move) => {
        const info = moveOf(move);
        return (
          <span key={move}>
            <span
              className={`type-dot type-${(info?.type ?? "normal").toLowerCase()}`}
            />
            {info?.name ?? displayName(move)}
          </span>
        );
      })}
    </>
  );
}

export default function TeamView({
  team,
  onSelect,
  excludeSlot = null,
  showMoves = false,
  disabled = false,
}: TeamViewProps) {
  return (
    <ul className="team-list">
      {team.map((pokemon, index) => {
        const slot = index + 1;
        if (slot === excludeSlot) return null;
        const body = (
          <>
            <span className="sprite-box small">
              <Sprite species={pokemon.species} alt={pokemonName(pokemon)} />
            </span>
            <span>
              <h3 className="row-name">{pokemonName(pokemon)}</h3>
              <TypeBadges types={typesOf(pokemon)} />
            </span>
            <span className="row-items">
              <span>{pokemon.item ? pokemon.item : "No item"}</span>
              <span>{pokemon.ability ?? ""}</span>
            </span>
            <span className="row-bst">{baseStatTotal(pokemon) || ""}</span>
            {onSelect !== undefined && (
              <span className="row-action">Set as lead</span>
            )}
            {showMoves && (
              <span className="row-moves">
                <MoveList moves={pokemon.moves} />
              </span>
            )}
          </>
        );
        return (
          <li key={`${slot}-${pokemon.species}`}>
            {onSelect === undefined ? (
              <div className="team-row">{body}</div>
            ) : (
              <button
                type="button"
                className="team-row"
                disabled={disabled}
                onClick={() => onSelect(slot)}
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
