import { useState } from "react";
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

export default function ResultsScreen({ data }: ResultsScreenProps) {
  const result = buildResult({
    date: data.date,
    winner: data.winner,
    lines: data.lines,
    team: data.team,
  });
  const [copied, setCopied] = useState(false);

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
        <h1 className="result-headline">{result.headline}</h1>
        <p className="result-line">
          <span className="result-icons">{result.icons.join("")}</span>
          <span className="result-stats">{result.stats}</span>
        </p>
      </div>
      <button type="button" className="btn primary" onClick={copy}>
        {copied ? "Copied!" : "Copy result"}
      </button>
      <p className="hint">Come back tomorrow for a new squad.</p>
    </section>
  );
}
