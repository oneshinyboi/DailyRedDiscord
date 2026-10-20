import type { ReactNode } from "react";
import Sprite from "./Sprite";
import { hpColor } from "../lib/battle";
import type { ActiveMon } from "../lib/battle";

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

interface BattleSceneProps {
  foe: ActiveMon | null;
  ally: ActiveMon | null;
  foePips: PipInfo;
  allyPips: PipInfo;
  foeOwner?: string;
  children?: ReactNode;
}

/** The GBA-style stage: Red's mon top-right, ours bottom-left. */
export default function BattleScene({
  foe,
  ally,
  foePips,
  allyPips,
  foeOwner = "RED's",
  children,
}: BattleSceneProps) {
  return (
    <div className="scene">
      <div className="stage">
        <div className="platform foe" />
        <div className="platform ally" />
        {foe !== null && (
          <Sprite
            key={`foe-${foe.species}`}
            species={foe.species}
            className={`foe-sprite enter${foe.fainted ? " fainted" : ""}`}
          />
        )}
        {ally !== null && (
          <Sprite
            key={`ally-${ally.species}`}
            species={ally.species}
            back
            className={`ally-sprite enter${ally.fainted ? " fainted" : ""}`}
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
