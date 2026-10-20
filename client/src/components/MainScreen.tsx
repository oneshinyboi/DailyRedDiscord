import { useState } from "react";
import BattleScene from "./BattleScene";
import LeadCard from "./LeadCard";
import Sprite from "./Sprite";
import TeamView from "./TeamView";
import { pokemonName, resultBanner } from "../lib/format";
import type { ActiveMon } from "../lib/battle";
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

function previewMon(set: PokemonSet | undefined): ActiveMon | null {
  if (set === undefined) return null;
  return {
    name: pokemonName(set),
    species: set.species,
    level: set.level ?? 100,
    hpPct: 100,
    hp: null,
    maxHp: null,
    status: null,
    fainted: false,
  };
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
  const leadMon = team[lead - 1] ?? team[0];
  const redLead = redTeam[0];
  const size = Math.max(team.length, 1);

  const allyPreview = previewMon(leadMon);
  const foePreview = previewMon(redLead);
  if (allyPreview !== null) {
    allyPreview.hp = 100;
    allyPreview.maxHp = 100;
  }

  return (
    <section className="screen main">
      {note !== null && <p className="banner banner-note">{note}</p>}
      <div className="lobby">
        <BattleScene
          foe={foePreview}
          ally={allyPreview}
          foePips={{ teamSize: redTeam.length || 6, fainted: 0 }}
          allyPips={{ teamSize: size, fainted: 0 }}
        >
          <div className="msgbox">
            {result !== null
              ? result.text
              : "RED would like to battle!"}
          </div>
          <div className="cmd-row">
            <div className="cmd-panel">
              <div className="cmd-title">
                <span>{sessionEnded ? "Today's squad" : "Choose your lead"}</span>
                <span>{date}</span>
              </div>
              <div className="party-grid">
                {team.map((mon, index) => {
                  const slot = index + 1;
                  return (
                    <button
                      type="button"
                      key={`${slot}-${mon.species}`}
                      className={`party-btn${slot === lead ? " selected" : ""}`}
                      disabled={starting}
                      onClick={() => setLead(slot)}
                    >
                      <Sprite species={mon.species} alt={pokemonName(mon)} />
                      <span className="party-text">
                        <span>{pokemonName(mon)}</span>
                        <span className="party-hp">{`Lv${mon.level ?? 100}`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cmd-panel go-panel">
              {sessionEnded ? (
                <p className="go-note">New squad tomorrow!</p>
              ) : (
                <>
                  <button
                    type="button"
                    className="go-btn"
                    disabled={starting}
                    onClick={() => onStart(lead)}
                  >
                    {starting ? "Starting..." : "Battle!"}
                  </button>
                  <p className="go-note">
                    {leadMon !== undefined
                      ? `Go! ${pokemonName(leadMon)}!`
                      : ""}
                  </p>
                </>
              )}
            </div>
          </div>
        </BattleScene>

        <aside className="lobby-side">
          {leadMon !== undefined && <LeadCard pokemon={leadMon} />}
          <details className="red-team">
            <summary>Red's team</summary>
            <TeamView team={redTeam} showMoves />
          </details>
        </aside>
      </div>
    </section>
  );
}
