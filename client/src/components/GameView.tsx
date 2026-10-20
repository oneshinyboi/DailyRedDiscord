import { useEffect, useMemo, useRef, useState } from "react";
import BattleScene from "./BattleScene";
import Sprite from "./Sprite";
import { errorMessage, fetchBattle, sendChoice } from "../lib/api";
import { buildBattleView } from "../lib/battle";
import { moveOf } from "../lib/dex";
import { formatLogLine, identName, resultBanner } from "../lib/format";
import type { LogEntry } from "../lib/format";
import type {
  ChoiceRequest,
  GameData,
  PokemonSet,
} from "../lib/types";

const CHOICE_ITEMS = new Set(["choice band", "choice specs", "choice scarf"]);

function choiceItemOf(
  request: ChoiceRequest | null,
  team: PokemonSet[]
): string | null {
  if (request === null) return null;
  const index = request.side.pokemon.findIndex((mon) => mon.active);
  if (index === -1) return null;
  const item = team[index]?.item;
  if (item === undefined || item === "") return null;
  return CHOICE_ITEMS.has(item.toLowerCase()) ? item : null;
}

interface GameViewProps {
  token: string;
  username: string;
  data: GameData;
  note: string | null;
  onEnded: (data: GameData) => void;
}

export default function GameView({
  token,
  username,
  data,
  note,
  onEnded,
}: GameViewProps) {
  const [state, setState] = useState<GameData>(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifiedRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.ended && !notifiedRef.current) {
      notifiedRef.current = true;
      onEnded(state);
    }
  }, [state, onEnded]);

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
          streak: res.streak,
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
            streak: history.streak,
          });
        })
        .catch((err: unknown) => setError(errorMessage(err)));
    }, 1500);
    return () => clearTimeout(timer);
  }, [state, token]);

  const result = state.ended ? resultBanner(state.winner) : null;
  const view = useMemo(() => buildBattleView(state.lines), [state.lines]);
  const lastText =
    [...log].reverse().find((entry) => !entry.turn)?.text ?? "";
  const message = result !== null ? result.text : lastText;
  const alive = (side: "p1" | "p2") =>
    Math.max(0, view[side].teamSize - view[side].faintedSpecies.length);

  return (
    <section className="screen game">
      {note !== null && <p className="banner banner-note">{note}</p>}
      {result !== null && (
        <p className={`banner result-${result.kind}`}>{result.text}</p>
      )}
      {result === null && error !== null && (
        <p className="banner banner-error">{error}</p>
      )}
      <div className="battle-layout">
        <div className="battle-main">
          <span className="battle-tag">{`${username} vs. Red`}</span>
          <BattleScene
            foe={view.p2.active}
            ally={view.p1.active}
            foePips={{
              teamSize: view.p2.teamSize,
              fainted: view.p2.faintedSpecies.length,
            }}
            allyPips={{
              teamSize: view.p1.teamSize,
              fainted: view.p1.faintedSpecies.length,
            }}
          >
            <div className="msgbox">{message || "..."}</div>
            <Controls
              request={state.request}
              team={state.team}
              busy={busy}
              ended={state.ended}
              choiceItem={choiceItemOf(state.request, state.team)}
              onChoose={choose}
            />
          </BattleScene>
          <p className="hint">
            Arrow keys move the cursor, Enter attacks. Pokémon switches.
          </p>
        </div>
        <aside className="log-card">
          <div className="log-head">
            <h2>Battle log</h2>
            <span>{`You ${alive("p1")}, Red ${alive("p2")}`}</span>
          </div>
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
        </aside>
      </div>
    </section>
  );
}

function speciesOfDetails(details: string): string {
  return details.split(",")[0] ?? details;
}

interface PartyMenuProps {
  request: ChoiceRequest;
  busy: boolean;
  title: string;
  command: "switch" | "team";
  onChoose: (choice: string) => void;
  onBack?: () => void;
}

function PartyMenu({ request, busy, title, command, onChoose, onBack }: PartyMenuProps) {
  return (
    <div className="cmd-row">
      <div className="cmd-panel cmd-full">
        <div className="cmd-title">
          <span>{title}</span>
          {onBack !== undefined && (
            <button type="button" className="menu-btn" onClick={onBack}>
              Back
            </button>
          )}
        </div>
        <div className="party-grid">
          {request.side.pokemon.map((mon, i) => {
            const fainted = mon.condition.includes("fnt");
            const blocked =
              command === "switch" && (mon.active || fainted);
            return (
              <button
                type="button"
                className="party-btn"
                key={mon.ident}
                disabled={busy || blocked}
                onClick={() => onChoose(`${command} ${i + 1}`)}
              >
                <Sprite species={speciesOfDetails(mon.details)} />
                <span className="party-text">
                  <span>{identName(mon.ident)}</span>
                  <span className="party-hp">
                    {fainted ? "Fainted" : mon.condition}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ControlsProps {
  request: ChoiceRequest | null;
  team: PokemonSet[];
  busy: boolean;
  ended: boolean;
  choiceItem: string | null;
  onChoose: (choice: string) => void;
}

function Controls({
  request,
  team,
  busy,
  ended,
  choiceItem,
  onChoose,
}: ControlsProps) {
  const [showParty, setShowParty] = useState(false);
  const [cursor, setCursor] = useState(0);
  const isMoveRequest =
    request !== null &&
    !("wait" in request) &&
    !("teamPreview" in request) &&
    !("forceSwitch" in request);
  const moveCount = isMoveRequest ? (request.active[0]?.moves.length ?? 0) : 0;

  useEffect(() => {
    if (!isMoveRequest || showParty || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const delta: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: 2,
        ArrowUp: -2,
      };
      const step = delta[e.key];
      if (step !== undefined) {
        e.preventDefault();
        setCursor((c) => {
          const next = c + step;
          return next >= 0 && next < moveCount ? next : c;
        });
      } else if (
        e.key === "Enter" &&
        document.activeElement?.tagName !== "BUTTON"
      ) {
        const move = request.active[0]?.moves[cursor];
        if (move !== undefined && !(move.disabled !== undefined && move.disabled !== false)) {
          onChoose(`move ${cursor + 1}`);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMoveRequest, showParty, busy, moveCount, cursor, request, onChoose]);

  if (ended || request === null || "wait" in request) return null;
  if ("teamPreview" in request) {
    return (
      <PartyMenu
        request={request}
        busy={busy}
        title="Choose your lead"
        command="team"
        onChoose={onChoose}
      />
    );
  }
  if ("forceSwitch" in request) {
    return (
      <PartyMenu
        request={request}
        busy={busy}
        title="Send out a Pokémon"
        command="switch"
        onChoose={onChoose}
      />
    );
  }
  if (showParty) {
    return (
      <PartyMenu
        request={request}
        busy={busy}
        title="Switch to which Pokémon?"
        command="switch"
        onChoose={(choice) => {
          setShowParty(false);
          onChoose(choice);
        }}
        onBack={() => setShowParty(false)}
      />
    );
  }
  const active = request.active[0];
  if (active === undefined) return null;
  const activeIndex = request.side.pokemon.findIndex((mon) => mon.active);
  const activeMon = request.side.pokemon[activeIndex];
  const ability = team[activeIndex]?.ability;
  const focused = active.moves[cursor] ?? active.moves[0];
  const focusedInfo = focused === undefined ? null : moveOf(focused.id);

  return (
    <div className="cmd-row">
      <div className="cmd-panel">
        <div className="cmd-title">
          <span>
            {`What will ${activeMon === undefined ? "" : identName(activeMon.ident)} do?`}
          </span>
          <span>{ability ?? ""}</span>
        </div>
        <div className="move-grid">
          {active.moves.map((move, i) => {
            const reason =
              typeof move.disabled === "string" ? move.disabled : undefined;
            const disabled =
              move.disabled !== undefined && move.disabled !== false;
            const type = (moveOf(move.id)?.type ?? "Normal").toLowerCase();
            let title = reason;
            if (disabled && title === undefined) {
              if (move.pp === 0) title = "Out of PP";
              else if (choiceItem !== null) title = `Locked by ${choiceItem}`;
              else title = "Disabled";
            }
            return (
              <button
                type="button"
                key={move.id}
                className={i === cursor ? "move-btn cursor" : "move-btn"}
                disabled={busy || disabled}
                title={title}
                onMouseEnter={() => setCursor(i)}
                onFocus={() => setCursor(i)}
                onClick={() => onChoose(`move ${i + 1}`)}
              >
                <span className={`type-dot type-${type}`} />
                <span className="name">{move.move}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="cmd-panel">
        <div className="info-line">
          <span>PP</span>
          <span>
            {focused !== undefined && typeof focused.pp === "number"
              ? `${focused.pp}/${focused.maxpp ?? focused.pp}`
              : "--"}
          </span>
        </div>
        <div className="info-line">
          <span>TYPE/</span>
          <span>{(focusedInfo?.type ?? "---").toUpperCase()}</span>
        </div>
        <div className="info-sub">
          <span>{focusedInfo?.category ?? ""}</span>
          <span>
            {focusedInfo !== null && focusedInfo.basePower > 0
              ? `Power ${focusedInfo.basePower}`
              : ""}
          </span>
        </div>
        <div className="info-sub">
          <span>
            {focusedInfo !== null && focusedInfo.accuracy !== true
              ? `Accuracy ${focusedInfo.accuracy}`
              : "Never misses"}
          </span>
        </div>
        <div className="menu-btns">
          <button
            type="button"
            className="menu-btn cmd-full"
            disabled={busy}
            onClick={() => setShowParty(true)}
          >
            Pokémon
          </button>
        </div>
      </div>
    </div>
  );
}
