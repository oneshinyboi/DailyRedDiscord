import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import Sprite from "./Sprite";
import { hpColor } from "../lib/battle";
import type { ActiveMon } from "../lib/battle";
import { typeColor } from "../lib/effects";
import type { ActiveEffect, Side } from "../lib/effects";
import { spriteUrl } from "../lib/sprites";

export interface PipInfo {
  teamSize: number;
  fainted: number;
}

interface HudProps {
  mon: ActiveMon;
  owner?: string;
  pips: PipInfo;
  showNumbers: boolean;
  className: string;
}

function Hud({ mon, owner, pips, showNumbers, className }: HudProps) {
  const total = Math.max(pips.teamSize, 1);
  const color = hpColor(mon.hpPct);
  return (
    <div className={`hud ${className}`}>
      <div className="hud-row">
        <span className="hud-name">
          {owner !== undefined && <span className="owner">{`${owner} `}</span>}
          <b>{mon.species}</b>
        </span>
        <span className="hud-level">{`Lv${mon.level}`}</span>
      </div>
      <div className="hp-row">
        <span className="hp-tag">HP</span>
        <span className="hp-track">
          <span
            className={`hp-fill ${color}`}
            style={{ width: `${mon.hpPct}%` }}
          />
        </span>
      </div>
      <div className="hud-foot">
        <span className="pips" aria-label={`${pips.fainted} of ${total} fainted`}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i < pips.fainted ? "pip out" : "pip"} />
          ))}
        </span>
        {mon.status !== null && (
          <span className={`status-tag status-${mon.status}`}>{mon.status}</span>
        )}
        {showNumbers && mon.hp !== null && mon.maxHp !== null && (
          <span>{`${mon.hp}/ ${mon.maxHp}`}</span>
        )}
      </div>
    </div>
  );
}

const STEP_END = "steps(1, jump-end)";

/** Plays the one-shot motion for an effect on a sprite's body element. */
function playBody(el: HTMLElement, effect: ActiveEffect, side: Side): void {
  // +1 for our sprite (bottom-left, attacks up-right), -1 for Red's.
  const d = side === "p1" ? 1 : -1;
  switch (effect.kind) {
    case "attack": {
      if (effect.style === "physical") {
        const lunge = `translate(${55 * d}%, ${-35 * d}%)`;
        el.animate(
          [
            { transform: "translate(0, 0)" },
            { transform: `translate(${-6 * d}%, ${4 * d}%)`, offset: 0.2 },
            { transform: lunge, offset: 0.45 },
            { transform: lunge, offset: 0.55 },
            { transform: "translate(0, 0)" },
          ],
          { duration: 520, easing: "ease-in-out" }
        );
      } else if (effect.style === "special") {
        el.animate(
          [
            { transform: "scale(1)", filter: "brightness(1)" },
            { transform: "scale(1.1)", filter: "brightness(1.7)", offset: 0.4 },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 600, easing: "ease-in-out" }
        );
      } else {
        el.animate(
          [
            { transform: "translateY(0)" },
            { transform: "translateY(-10%)", offset: 0.25 },
            { transform: "translateY(0)", offset: 0.5 },
            { transform: "translateY(-10%)", offset: 0.75 },
            { transform: "translateY(0)" },
          ],
          { duration: 600, easing: "ease-in-out" }
        );
      }
      break;
    }
    case "hit": {
      const a = ({ 1: 4, 2: 8, 3: 12 } as const)[effect.power ?? 2];
      const frame = (x: number, visible: boolean) => ({
        transform: `translateX(${x}%)`,
        opacity: visible ? 1 : 0,
        filter: visible ? "brightness(1)" : "brightness(3)",
        easing: STEP_END,
      });
      el.animate(
        [
          frame(0, true),
          frame(a, false),
          frame(-a, true),
          frame(a * 0.7, false),
          frame(-a * 0.7, true),
          frame(a * 0.4, false),
          frame(0, true),
        ],
        { duration: effect.power === 3 ? 640 : 480 }
      );
      break;
    }
    case "miss":
      el.animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          { transform: `translate(${-40 * d}%, ${6 * d}%)`, opacity: 0.55, offset: 0.3 },
          { transform: `translate(${-40 * d}%, ${6 * d}%)`, opacity: 0.55, offset: 0.6 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        { duration: 650, easing: "ease-out" }
      );
      break;
    case "withdraw":
      el.animate(
        [
          { transform: "translateX(0)", opacity: 1 },
          { transform: `translateX(${-70 * d}%)`, opacity: 0 },
        ],
        { duration: 340, easing: "ease-in", fill: "forwards" }
      );
      break;
  }
}

interface MonProps {
  mon: ActiveMon;
  side: Side;
  /** Only passed when the effect targets this sprite. */
  effect: ActiveEffect | null;
}

function maskStyle(url: string | null): CSSProperties {
  return { "--mask": url === null ? "none" : `url("${url}")` } as CSSProperties;
}

function Mon({ mon, side, effect }: MonProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const back = side === "p1";

  useEffect(() => {
    if (effect !== null && bodyRef.current !== null) {
      playBody(bodyRef.current, effect, side);
    }
  }, [effect, side]);

  const mask = maskStyle(spriteUrl(mon.species, back));
  let overlay: ReactNode = null;
  let burst: ReactNode = null;
  if (effect !== null) {
    const key = effect.nonce;
    switch (effect.kind) {
      case "boost":
      case "unboost":
        overlay = (
          <span
            key={key}
            className={`fx-shade ${effect.kind === "boost" ? "up" : "down"}`}
            style={mask}
          />
        );
        break;
      case "status":
        overlay = (
          <span key={key} className={`fx-tint s-${effect.status ?? "none"}`} style={mask} />
        );
        break;
      case "heal":
        overlay = <span key={key} className="fx-tint heal" style={mask} />;
        break;
      case "attack":
        if (effect.style === "special") {
          overlay = (
            <span
              key={key}
              className="fx-tint charge"
              style={{ ...mask, "--fx-color": typeColor(effect.moveType) } as CSSProperties}
            />
          );
        }
        break;
      case "hit":
        if (effect.moveType !== undefined) {
          burst = (
            <span
              key={key}
              className={`fx-burst p${effect.power ?? 2}`}
              style={{ "--fx-color": typeColor(effect.moveType) } as CSSProperties}
            />
          );
        }
        break;
    }
  }

  return (
    <div className={`mon ${side === "p1" ? "ally-mon" : "foe-mon"}`}>
      <div
        ref={bodyRef}
        className={`mon-body enter${mon.fainted ? " fainted" : ""}`}
      >
        <Sprite species={mon.species} back={back} />
        {overlay}
      </div>
      {burst}
    </div>
  );
}

interface BattleSceneProps {
  foe: ActiveMon | null;
  ally: ActiveMon | null;
  foePips: PipInfo;
  allyPips: PipInfo;
  foeOwner?: string;
  /** The effect of the playback step on screen, if any. */
  effect?: ActiveEffect | null;
  children?: ReactNode;
}

/** The GBA-style stage: Red's mon top-right, ours bottom-left. */
export default function BattleScene({
  foe,
  ally,
  foePips,
  allyPips,
  foeOwner = "RED's",
  effect = null,
  children,
}: BattleSceneProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (effect?.kind !== "hit" || effect.power !== 3) return;
    stageRef.current?.animate(
      [
        { transform: "translate(0, 0) scale(1)" },
        { transform: "translate(-1.2%, 0.6%) scale(1.03)", offset: 0.2 },
        { transform: "translate(1.2%, -0.6%) scale(1.03)", offset: 0.45 },
        { transform: "translate(-0.8%, 0.4%) scale(1.03)", offset: 0.7 },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration: 380 }
    );
  }, [effect]);

  const effectFor = (side: Side) => (effect?.side === side ? effect : null);

  return (
    <div className="scene">
      <div className="stage" ref={stageRef}>
        <div className="platform foe" />
        <div className="platform ally" />
        {foe !== null && (
          <Mon
            key={`foe-${foe.species}`}
            mon={foe}
            side="p2"
            effect={effectFor("p2")}
          />
        )}
        {ally !== null && (
          <Mon
            key={`ally-${ally.species}`}
            mon={ally}
            side="p1"
            effect={effectFor("p1")}
          />
        )}
        {foe !== null && (
          <Hud
            mon={foe}
            owner={foeOwner}
            pips={foePips}
            showNumbers={false}
            className="hud-foe"
          />
        )}
        {ally !== null && (
          <Hud
            mon={ally}
            pips={allyPips}
            showNumbers
            className="hud-ally"
          />
        )}
      </div>
      {children}
    </div>
  );
}
