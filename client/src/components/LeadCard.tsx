import { baseStatsOf, baseStatTotal, STAT_LABELS, typesOf } from "../lib/dex";
import type { PokemonSet } from "../lib/types";
import Sprite from "./Sprite";
import { MoveList, TypeBadges } from "./TeamView";
import { pokemonName } from "../lib/format";

export default function LeadCard({ pokemon }: { pokemon: PokemonSet }) {
  const stats = baseStatsOf(pokemon);
  return (
    <div className="lead-card">
      <span className="lead-flag">Summary</span>
      <div className="lead-top">
        <span className="sprite-box">
          <Sprite species={pokemon.species} alt={pokemonName(pokemon)} />
        </span>
        <div>
          <h3 className="lead-name">{pokemonName(pokemon)}</h3>
          <TypeBadges types={typesOf(pokemon)} />
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Item</dt>
          <dd>{pokemon.item ? pokemon.item : "No item"}</dd>
        </div>
        <div>
          <dt>Ability</dt>
          <dd>{pokemon.ability ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Base stat total</dt>
          <dd>{baseStatTotal(pokemon)}</dd>
        </div>
      </dl>
      {stats !== null && (
        <div className="stat-tiles">
          {STAT_LABELS.map(([key, label]) => (
            <div className="stat-tile" key={key}>
              <span>{label}</span>
              <b>{stats[key]}</b>
            </div>
          ))}
        </div>
      )}
      <div className="move-chips">
        {pokemon.moves.length > 0 && (
          <MoveListChips moves={pokemon.moves} />
        )}
      </div>
    </div>
  );
}

function MoveListChips({ moves }: { moves: string[] }) {
  return (
    <>
      {moves.map((move) => (
        <div className="move-chip" key={move}>
          <MoveList moves={[move]} />
        </div>
      ))}
    </>
  );
}
