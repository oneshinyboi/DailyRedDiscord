import { moveOf, typesOf } from "../lib/dex";
import { displayName } from "../lib/format";
import type { PokemonSet } from "../lib/types";

interface TeamViewProps {
  team: PokemonSet[];
  selectedSlot?: number | null;
  onSelect?: (slot: number) => void;
  disabled?: boolean;
}

function pokemonName(set: PokemonSet): string {
  return set.name || displayName(set.species);
}

function TypeBadges({ types }: { types: string[] }) {
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

export default function TeamView({
  team,
  selectedSlot = null,
  onSelect,
  disabled = false,
}: TeamViewProps) {
  return (
    <div className="team-view">
      <div className="team-grid">
        {team.map((pokemon, index) => {
          const slot = index + 1;
          const isLead = onSelect !== undefined && slot === selectedSlot;
          const card = (
            <>
              {isLead && <span className="lead-badge">Lead</span>}
              <h3>{pokemonName(pokemon)}</h3>
              <p className="meta">
                {`Lv. ${pokemon.level ?? 100}${pokemon.item ? ` - ${pokemon.item}` : ""}`}
              </p>
              <TypeBadges types={typesOf(pokemon)} />
            </>
          );
          if (onSelect === undefined) {
            return (
              <div key={`${slot}-${pokemon.name}`} className="poke-card static">
                {card}
              </div>
            );
          }
          return (
            <button
              key={`${slot}-${pokemon.name}`}
              type="button"
              className={isLead ? "poke-card selected" : "poke-card"}
              disabled={disabled}
              onClick={() => onSelect(slot)}
            >
              {card}
            </button>
          );
        })}
      </div>
      <details className="team-details">
        <summary>Team details</summary>
        <ul className="mon-detail-list">
          {team.map((pokemon, index) => (
            <li key={`${index}-${pokemon.name}`}>
              <details className="mon-detail">
                <summary>
                  <span className="mon-name">{pokemonName(pokemon)}</span>
                  <span className="mon-level">{`Lv. ${pokemon.level ?? 100}`}</span>
                  <TypeBadges types={typesOf(pokemon)} />
                </summary>
                <dl className="mon-stats">
                  <div>
                    <dt>Ability</dt>
                    <dd>{pokemon.ability ? pokemon.ability : "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Item</dt>
                    <dd>{pokemon.item ? pokemon.item : "No item"}</dd>
                  </div>
                  <div>
                    <dt>Moves</dt>
                    <dd>
                      <ul className="move-detail-list">
                        {pokemon.moves.map((move) => {
                          const info = moveOf(move);
                          return (
                            <li key={move}>
                              <span>{info?.name ?? displayName(move)}</span>
                              {info && <TypeBadges types={[info.type]} />}
                            </li>
                          );
                        })}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
