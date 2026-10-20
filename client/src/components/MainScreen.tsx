import { useState } from "react";
import TeamView from "./TeamView";
import { resultBanner } from "../lib/format";
import type { PokemonSet } from "../lib/types";

interface MainScreenProps {
  date: string;
  team: PokemonSet[];
  redTeam: PokemonSet[];
  sessionEnded: boolean;
  winner: string | null;
  note: string | null;
  starting: boolean;
  onStart: (slot: number) => void;
}

export default function MainScreen({
  date,
  team,
  redTeam,
  sessionEnded,
  winner,
  note,
  starting,
  onStart,
}: MainScreenProps) {
  const [lead, setLead] = useState(1);
  const result = sessionEnded ? resultBanner(winner) : null;
  const selectable = !sessionEnded;

  return (
    <section className="screen main">
      <h1>Daily Red</h1>
      <p className="date">{date}</p>
      {note !== null && <p className="banner banner-note">{note}</p>}
      {result !== null && (
        <p className={`banner result-${result.kind}`}>{result.text}</p>
      )}
      <h2>{sessionEnded ? "Today's battle is over" : "Your team"}</h2>
      <p className="hint">
        {sessionEnded
          ? "Come back tomorrow for a brand-new squad."
          : "Pick your lead, then take on Red."}
      </p>
      <TeamView
        team={team}
        selectedSlot={selectable ? lead : null}
        onSelect={selectable ? setLead : undefined}
        disabled={starting}
      />
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
      <details className="red-team">
        <summary className="red-team-summary">Red's team</summary>
        <TeamView team={redTeam} />
      </details>
    </section>
  );
}
