import { useMemo, useState } from "react";
import Sprite from "./Sprite";
import { buildBattleView } from "../lib/battle";
import { buildResult } from "../lib/format";
import type { GameData } from "../lib/types";

interface ResultsScreenProps {
  data: GameData;
}

function legacyCopy(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}

function SpriteRow({
  title,
  species,
  fainted,
}: {
  title: string;
  species: string[];
  fainted: string[];
}) {
  return (
    <div className="result-side">
      <h3>{title}</h3>
      <div className="result-sprites">
        {species.map((name) => (
          <span
            key={name}
            className={
              fainted.includes(name) ? "sprite-box small ko" : "sprite-box small"
            }
          >
            <Sprite species={name} />
          </span>
        ))}
      </div>
    </div>
  );
}

function dayCount(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function StreakTile({
  label,
  current,
  best,
}: {
  label: string;
  current: number;
  best: number;
}) {
  return (
    <div className="streak-tile">
      <span className="streak-label">{label}</span>
      <b className="streak-value">{dayCount(current)}</b>
      <span className="streak-best">Best: {dayCount(best)}</span>
    </div>
  );
}

export default function ResultsScreen({ data }: ResultsScreenProps) {
  const result = buildResult({
    date: data.date,
    winner: data.winner,
    lines: data.lines,
    team: data.team,
  });
  const [copied, setCopied] = useState(false);
  const view = useMemo(() => buildBattleView(data.lines), [data.lines]);
  const mySpecies = data.team.map((mon) => mon.species);

  const copy = () => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText !== undefined) {
      navigator.clipboard
        .writeText(result.shareText)
        .then(done)
        .catch(() => {
          legacyCopy(result.shareText);
          done();
        });
      return;
    }
    legacyCopy(result.shareText);
    done();
  };

  return (
    <section className="screen results">
      <div className={`result-card result-${result.outcome}`}>
        <h1 className="result-headline">
          {result.outcome === "win"
            ? "You beat Red!"
            : result.outcome === "loss"
              ? "Red won today."
              : "It's a tie."}
        </h1>
        <p className="result-stats">{result.headline}</p>
        <div className="result-teams">
          <SpriteRow
            title="Your team"
            species={mySpecies}
            fainted={view.p1.faintedSpecies}
          />
          <SpriteRow
            title="Red's team"
            species={view.p2.roster}
            fainted={view.p2.faintedSpecies}
          />
        </div>
        <p className="result-line">
          <span className="result-icons">{result.icons.join("")}</span>
          <span className="result-stats">{result.stats}</span>
        </p>
        <div className="result-streaks">
          <StreakTile
            label="Play streak"
            current={data.streak.play}
            best={data.streak.bestPlay}
          />
          <StreakTile
            label="Win streak"
            current={data.streak.win}
            best={data.streak.bestWin}
          />
        </div>
      </div>
      <button type="button" className="btn primary" onClick={copy}>
        {copied ? "Copied!" : "Copy result"}
      </button>
      <p className="hint">Come back tomorrow for a new squad.</p>
    </section>
  );
}
