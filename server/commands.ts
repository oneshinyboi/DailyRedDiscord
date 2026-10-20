/** Application commands registered with Discord (see scripts/registerCommands.ts). */
export const COMMANDS = [
  {
    name: "leaderboard",
    description: "Top 10 Daily Red players in this server by win rate",
    type: 1,
    // Guild installs only, usable in server channels (not DMs).
    integration_types: [0],
    contexts: [0],
  },
];
