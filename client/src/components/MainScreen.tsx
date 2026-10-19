import { useState } from "react";
import { displayName, resultBanner } from "../lib/format";
import type { PokemonSet } from "../lib/types";

interface MainScreenProps {
  date: string;
  team: PokemonSet[];
  sessionEnded: boolean;
  winner: string | null;
  note: string | null;
  starting: boolean;
  onStart: (slot: number) => void;
}

export default function MainScreen({
  date,
  team,
  sessionEnded,
  winner,
  note,
  starting,
  onStart,
}: MainScreenProps) {
  const [lead, setLead] = useState(1);
  const result = sessionEnded ? resultBanner(winner) : null;

  return (
    <section className="screen main">
      <h1>Daily Red</h1>
      <p className="date">{date}</p>
      {note !== null && <p className="banner banner-note">{note}</p>}
      {result !== null && (
        <p className={`banner result-${result.kind}`}>{result.text}</p>
      )}
      <h2>{sessionEnded ? "Today's battle is over" : "Today's team"}</h2>
      <p className="hint">
        {sessionEnded
          ? "Come back tomorrow for a brand-new squad."
          : "Pick your lead, then take on Red."}
      </p>
      <div className="team-grid">
        {team.map((pokemon, index) => {
          const slot = index + 1;
          const isLead = !sessionEnded && slot === lead;
          return (
            <button
              key={`${slot}-${pokemon.name}`}
              type="button"
              className={isLead ? "poke-card selected" : "poke-card"}
              disabled={sessionEnded || starting}
              onClick={() => setLead(slot)}
            >
              {isLead && <span className="lead-badge">Lead</span>}
              <h3>{pokemon.name || displayName(pokemon.species)}</h3>
              <p className="meta">
                {`Lv. ${pokemon.level ?? 100}${pokemon.item ? ` - ${pokemon.item}` : ""}`}
              </p>
              {pokemon.ability && <p className="meta">{pokemon.ability}</p>}
              <ul className="moves">
                {pokemon.moves.map((move) => (
                  <li key={move}>{displayName(move)}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      {!sessionEnded && (
        <button
          type="button"
          className="btn primary"
          disabled={starting}
          onClick={() => onStart(lead)}
        >
          {starting ? "Starting..." : "Start New Game"}
        </button>
      )}
    </section>
  );
}
