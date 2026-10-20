import { useEffect, useState } from "react";

function msUntilMidnight(timeZone: string, nowMs: number): number {
  const now = new Date(nowMs);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0) % 24;
  const elapsed = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000;
  return 86_400_000 - elapsed;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function SiteHeader({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = msUntilMidnight(timeZone, now);
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(now));

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-ball" aria-hidden="true" />
        <span>
          Daily <span className="red">Red</span>
        </span>
      </div>
      <div className="pills">
        <span className="pill">{today}</span>
        <span className="pill">
          {"Next team "}
          <span className="countdown">{formatCountdown(left)}</span>
        </span>
      </div>
    </header>
  );
}
