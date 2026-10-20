import { useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./App.css";
import GameView from "./components/GameView";
import MainScreen from "./components/MainScreen";
import ResultsScreen from "./components/ResultsScreen";
import { beginBattle, errorMessage, fetchBattle, fetchStart } from "./lib/api";
import { getTimeZone, localDate } from "./lib/date";
import type {
  GameData,
  HistoryResponse,
  PokemonSet,
  StartResponse,
} from "./lib/types";

type DiscordUser = Awaited<
  ReturnType<DiscordSDK["commands"]["authenticate"]>
>["user"];

interface AuthSession {
  user: DiscordUser;
  accessToken: string;
}

const NEW_DAY_NOTE = "A new day's team is out - here's your updated squad!";

// The SDK constructor requires Discord's `frame_id` query param and throws
// outside the Discord client, so only create it when it is actually needed.
let discordSdkInstance: DiscordSDK | null = null;

function discordSdk(): DiscordSDK {
  if (discordSdkInstance === null) {
    discordSdkInstance = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
  }
  return discordSdkInstance;
}

// Local browser development bypass. Only active in a Vite dev build when the
// flag is set, so production bundles can never skip Discord auth.
const DEV_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH === "1";
const DEV_ACCESS_TOKEN = "dev";
const DEV_SESSION: AuthSession = {
  user: {
    id: "0",
    username: "Dev Trainer",
    discriminator: "0",
    public_flags: 0,
    avatar: null,
    global_name: "Dev Trainer",
  },
  accessToken: DEV_ACCESS_TOKEN,
};

const AUTH_TIMEOUT_MS = 20_000;
const AUTH_TIMEOUT_MESSAGE =
  "Discord did not respond in time. Close and reopen the activity, then try again.";

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function authenticate(
  onStage?: (message: string) => void
): Promise<AuthSession> {
  const { code } = await discordSdk().commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });

  onStage?.("Exchanging auth token...");
  const response = await fetch("/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  if (!response.ok || body?.access_token === undefined) {
    throw new Error(body?.error ?? `Token exchange failed (${response.status})`);
  }

  onStage?.("Signing in...");
  const auth = await discordSdk().commands.authenticate({
    access_token: body.access_token,
  });
  if (auth == null) {
    throw new Error("Authenticate command failed");
  }
  return { user: auth.user, accessToken: body.access_token };
}

let authSession: Promise<AuthSession> | null = null;

function authenticateOnce(
  onStage?: (message: string) => void
): Promise<AuthSession> {
  if (authSession === null) {
    authSession = DEV_AUTH
      ? Promise.resolve(DEV_SESSION)
      : discordSdk()
          .ready()
          .then(() => {
            onStage?.("Authorizing with Discord...");
            return authenticate(onStage);
          })
          .catch((err: unknown) => {
            authSession = null;
            throw err;
          });
  }
  return authSession;
}

function toGameData(history: HistoryResponse): GameData {
  return {
    battleId: history.battleId,
    date: history.date,
    team: history.team,
    lines: history.lines,
    request: history.request,
    ended: history.ended,
    winner: history.winner,
  };
}

type Screen =
  | { kind: "boot"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "main";
      date: string;
      team: PokemonSet[];
      redTeam: PokemonSet[];
      sessionEnded: boolean;
      winner: string | null;
      note: string | null;
    }
  | { kind: "game"; data: GameData; note: string | null }
  | { kind: "results"; data: GameData };

function App() {
  const [screen, setScreen] = useState<Screen>({
    kind: "boot",
    message: "Authenticating...",
  });
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("Challenger");
  const [starting, setStarting] = useState(false);
  const [timeZone] = useState(getTimeZone);

  const routeStart = (
    accessToken: string,
    start: StartResponse,
    note: string | null
  ) => {
    if (start.phase === "preview") {
      setScreen({
        kind: "main",
        date: start.date,
        team: start.team,
        redTeam: start.redTeam,
        sessionEnded: false,
        winner: null,
        note,
      });
      return;
    }
    if (start.phase === "ended") {
      fetchBattle(accessToken, start.battleId)
        .then((history) =>
          setScreen({ kind: "results", data: toGameData(history) })
        )
        .catch((err: unknown) =>
          setScreen({ kind: "error", message: errorMessage(err) })
        );
      return;
    }
    fetchBattle(accessToken, start.battleId)
      .then((history) =>
        setScreen({ kind: "game", data: toGameData(history), note })
      )
      .catch((err: unknown) =>
        setScreen({ kind: "error", message: errorMessage(err) })
      );
  };

  useEffect(() => {
    let cancelled = false;
    const boot = (message: string) => {
      if (!cancelled) setScreen({ kind: "boot", message });
    };
    boot(DEV_AUTH ? "Starting local dev session..." : "Connecting to Discord...");
    withTimeout(authenticateOnce(boot), AUTH_TIMEOUT_MS, AUTH_TIMEOUT_MESSAGE)
      .then(({ user, accessToken }) => {
        if (cancelled) return;
        setToken(accessToken);
        setUsername(user.username);
        boot(`Loading today's team for ${user.username}...`);
        return fetchStart(accessToken, timeZone).then((start) => {
          if (!cancelled) routeStart(accessToken, start, null);
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setScreen({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [timeZone]);

  const handleStart = (slot: number) => {
    if (starting || token === null || screen.kind !== "main") return;
    setStarting(true);
    const run = async () => {
      if (localDate(timeZone) !== screen.date) {
        routeStart(token, await fetchStart(token, timeZone), NEW_DAY_NOTE);
        return;
      }
      const begun = await beginBattle(token, timeZone, slot);
      let data: GameData;
      let note: string | null = null;
      if ("lines" in begun) {
        data = {
          battleId: begun.battleId,
          date: begun.date,
          team: begun.team,
          lines: begun.lines,
          request: begun.request,
          ended: begun.ended,
          winner: begun.winner,
        };
        if (begun.date !== screen.date) note = NEW_DAY_NOTE;
      } else {
        const history = await fetchBattle(token, begun.battleId);
        data = toGameData(history);
      }
      setScreen(data.ended ? { kind: "results", data } : { kind: "game", data, note });
    };
    run()
      .catch((err: unknown) =>
        setScreen({ kind: "error", message: errorMessage(err) })
      )
      .finally(() => setStarting(false));
  };

  return (
    <main className="app">
      {screen.kind === "boot" && <p className="boot">{screen.message}</p>}
      {screen.kind === "error" && (
        <section className="screen error-screen">
          <h1>Something went wrong</h1>
          <p className="banner banner-error">{screen.message}</p>
        </section>
      )}
      {screen.kind === "main" && (
        <MainScreen
          date={screen.date}
          team={screen.team}
          redTeam={screen.redTeam}
          sessionEnded={screen.sessionEnded}
          winner={screen.winner}
          note={screen.note}
          starting={starting}
          onStart={handleStart}
        />
      )}
      {screen.kind === "game" && token !== null && (
        <GameView
          key={screen.data.battleId}
          token={token}
          username={username}
          data={screen.data}
          note={screen.note}
          onEnded={(data) => setScreen({ kind: "results", data })}
        />
      )}
      {screen.kind === "results" && <ResultsScreen data={screen.data} />}
    </main>
  );
}

export default App;
