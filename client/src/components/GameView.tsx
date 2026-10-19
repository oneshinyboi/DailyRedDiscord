import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, fetchBattle, sendChoice } from "../lib/api";
import { formatLogLine, identName, resultBanner } from "../lib/format";
import type { LogEntry } from "../lib/format";
import type {
  ChoiceRequest,
  GameData,
  PokemonSwitchRequestData,
} from "../lib/types";

interface GameViewProps {
  token: string;
  username: string;
  data: GameData;
  note: string | null;
}

export default function GameView({ token, username, data, note }: GameViewProps) {
  const [state, setState] = useState<GameData>(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const log = useMemo<LogEntry[]>(
    () =>
      state.lines
        .map((line) => formatLogLine(line))
        .filter((entry): entry is LogEntry => entry !== null),
    [state.lines]
  );

  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log]);

  const choose = (choice: string) => {
    if (busy || state.ended) return;
    setBusy(true);
    setError(null);
    sendChoice(token, state.battleId, choice)
      .then((res) => {
        setState((prev) => ({
          ...prev,
          lines: [...prev.lines, ...res.lines],
          request: res.request,
          phase: res.phase,
          ended: res.ended,
          winner: res.winner,
        }));
        if (res.error !== undefined) setError(res.error);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (state.ended) return;
    const waiting =
      state.request === null ||
      ("wait" in state.request && state.request.wait);
    if (!waiting) return;
    const timer = setTimeout(() => {
      fetchBattle(token, state.battleId)
        .then((history) => {
          setState({
            battleId: history.battleId,
            date: history.date,
            team: history.team,
            lines: history.lines,
            request: history.request,
            ended: history.ended,
            winner: history.winner,
          });
        })
        .catch((err: unknown) => setError(errorMessage(err)));
    }, 1500);
    return () => clearTimeout(timer);
  }, [state, token]);

  const result = state.ended ? resultBanner(state.winner) : null;

  return (
    <section className="screen game">
      <header className="game-header">
        <h1>{`${username} vs. Red`}</h1>
      </header>
      {note !== null && <p className="banner banner-note">{note}</p>}
      {result !== null && (
        <p className={`banner result-${result.kind}`}>{result.text}</p>
      )}
      {result === null && error !== null && (
        <p className="banner banner-error">{error}</p>
      )}
      <div className="battle-body">
        <div className="battle-log" ref={logRef}>
          {log.map((entry, i) =>
            entry.turn ? (
              <div className="turn-divider" key={i}>
                {entry.text}
              </div>
            ) : (
              <div className="log-line" key={i}>
                {entry.text}
              </div>
            )
          )}
        </div>
        <div className="side-panel">
          <TeamStatus request={state.request} />
          <Controls
            request={state.request}
            busy={busy}
            ended={state.ended}
            onChoose={choose}
          />
        </div>
      </div>
    </section>
  );
}

function statusClass(mon: PokemonSwitchRequestData): string {
  if (mon.condition.includes("fnt")) return "fainted";
  if (mon.active) return "active";
  return "";
}

function TeamStatus({ request }: { request: ChoiceRequest | null }) {
  if (request === null) return null;
  return (
    <>
      <h2>Your team</h2>
      <ul className="team-status">
        {request.side.pokemon.map((mon) => (
          <li key={mon.ident} className={statusClass(mon)}>
            <span>{identName(mon.ident)}</span>
            <span className="condition">{mon.condition}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface ControlsProps {
  request: ChoiceRequest | null;
  busy: boolean;
  ended: boolean;
  onChoose: (choice: string) => void;
}

function Controls({ request, busy, ended, onChoose }: ControlsProps) {
  if (ended) {
    return (
      <>
        <h2>Battle over</h2>
        <p className="waiting">Come back tomorrow for a new squad.</p>
      </>
    );
  }
  if (request === null) {
    return (
      <>
        <h2>Waiting...</h2>
        <p className="waiting">The battle is still heating up.</p>
      </>
    );
  }
  if ("wait" in request) {
    return (
      <>
        <h2>Red is choosing...</h2>
        <p className="waiting">Hold tight.</p>
      </>
    );
  }
  if ("teamPreview" in request) {
    return (
      <>
        <h2>Choose your lead</h2>
        <div className="control-grid">
          {request.side.pokemon.map((mon, i) => (
            <button
              type="button"
              key={mon.ident}
              disabled={busy}
              onClick={() => onChoose(`team ${i + 1}`)}
            >
              {identName(mon.ident)}
            </button>
          ))}
        </div>
      </>
    );
  }
  if ("forceSwitch" in request) {
    return (
      <>
        <h2>Send out a Pokemon</h2>
        <div className="control-grid">
          {request.side.pokemon.map((mon, i) => (
            <button
              type="button"
              key={mon.ident}
              disabled={busy || mon.active || mon.condition.includes("fnt")}
              onClick={() => onChoose(`switch ${i + 1}`)}
            >
              {identName(mon.ident)}
              <span className="pp">{mon.condition}</span>
            </button>
          ))}
        </div>
      </>
    );
  }
  const active = request.active.length > 0 ? request.active[0] : null;
  if (active === null) {
    return (
      <>
        <h2>Waiting...</h2>
        <p className="waiting">The battle is still heating up.</p>
      </>
    );
  }
  return (
    <>
      <h2>Your moves</h2>
      <div className="control-grid">
        {active.moves.map((move, i) => {
          const reason =
            typeof move.disabled === "string" ? move.disabled : undefined;
          const disabled = move.disabled !== undefined && move.disabled !== false;
          return (
            <button
              type="button"
              key={move.id}
              disabled={busy || disabled}
              title={reason}
              onClick={() => onChoose(`move ${i + 1}`)}
            >
              {move.move}
              {typeof move.pp === "number" && (
                <span className="pp">{` ${move.pp}/${move.maxpp ?? move.pp} PP`}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
