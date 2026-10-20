import { useCallback, useEffect, useRef, useState } from "react";
import { buildBattleView } from "./battle";
import type { BattleView } from "./battle";
import { buildSteps } from "./effects";
import type { ActiveEffect, PlaybackStep } from "./effects";

interface Display {
  view: BattleView;
  /** Protocol lines revealed so far. */
  shown: number;
  text: string | null;
  effect: ActiveEffect | null;
}

export interface Playback {
  view: BattleView;
  shown: number;
  /** Message of the step on screen; null means fall back to the log. */
  text: string | null;
  effect: ActiveEffect | null;
  playing: boolean;
  skip: () => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Replays lines that arrive after mount one step at a time. Anything that is
 * not a plain append (first load, a reload of history) jumps straight to the
 * final state.
 */
export function usePlayback(lines: string[]): Playback {
  const [display, setDisplay] = useState<Display>(() => ({
    view: buildBattleView(lines),
    shown: lines.length,
    text: null,
    effect: null,
  }));
  const [playing, setPlaying] = useState(false);
  const linesRef = useRef(lines);
  const queueRef = useRef<PlaybackStep[]>([]);
  const timerRef = useRef<number | undefined>(undefined);
  const nonceRef = useRef(0);
  const playingRef = useRef(false);

  const settle = useCallback(() => {
    const all = linesRef.current;
    setDisplay({ view: buildBattleView(all), shown: all.length, text: null, effect: null });
  }, []);

  const stop = useCallback(() => {
    window.clearTimeout(timerRef.current);
    queueRef.current = [];
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const advance = useCallback(function tick() {
    const step = queueRef.current.shift();
    if (step === undefined) {
      playingRef.current = false;
      setPlaying(false);
      settle();
      return;
    }
    const effect: ActiveEffect | null =
      step.effect === null ? null : { ...step.effect, nonce: ++nonceRef.current };
    setDisplay((prev) => ({
      view: step.view,
      shown: step.lineCount,
      text: step.text ?? prev.text,
      effect,
    }));
    timerRef.current = window.setTimeout(tick, step.duration);
  }, [settle]);

  useEffect(() => {
    const prev = linesRef.current;
    if (lines === prev) return;
    const unchanged =
      lines.length === prev.length &&
      lines[lines.length - 1] === prev[prev.length - 1];
    linesRef.current = lines;
    if (unchanged) return;

    const appended =
      lines.length > prev.length &&
      (prev.length === 0 || lines[prev.length - 1] === prev[prev.length - 1]);
    if (!appended || prefersReducedMotion()) {
      stop();
      settle();
      return;
    }

    const steps = buildSteps(buildBattleView(prev), lines.slice(prev.length), prev.length);
    if (steps.length === 0) {
      if (!playingRef.current) settle();
      return;
    }
    queueRef.current.push(...steps);
    if (!playingRef.current) {
      playingRef.current = true;
      setPlaying(true);
      advance();
    }
  }, [lines, advance, settle, stop]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const skip = useCallback(() => {
    stop();
    settle();
  }, [stop, settle]);

  return {
    view: display.view,
    shown: display.shown,
    text: display.text,
    effect: display.effect,
    // Also true for the render between new lines arriving and playback starting.
    playing: playing || display.shown < lines.length,
    skip,
  };
}
