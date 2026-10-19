declare module "pokemon-showdown/dist/sim/tools/random-player-ai.js" {
  import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";

  export interface RandomPlayerAIOptions {
    move?: number;
    mega?: number;
    seed?: PRNGSeed;
  }

  class RandomPlayerAI {
    constructor(
      playerStream: object,
      options?: RandomPlayerAIOptions,
      debug?: boolean
    );
    start(): Promise<void>;
  }

  export default { RandomPlayerAI };
}
