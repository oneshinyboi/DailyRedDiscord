import { useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./App.css";

type DiscordUser = Awaited<
  ReturnType<DiscordSDK["commands"]["authenticate"]>
>["user"];

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

async function authenticate(): Promise<DiscordUser> {
  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });

  const response = await fetch("/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  const { access_token } = (await response.json()) as { access_token: string };

  const auth = await discordSdk.commands.authenticate({ access_token });
  if (auth == null) {
    throw new Error("Authenticate command failed");
  }
  return auth.user;
}

function App() {
  const [user, setUser] = useState<DiscordUser>();

  useEffect(() => {
    discordSdk.ready().then(authenticate).then(setUser).catch(console.error);
  }, []);

  return (
    <main className="app">
      {user ? <h1>Welcome {user.username}</h1> : <p>Authenticating…</p>}
    </main>
  );
}

export default App;
