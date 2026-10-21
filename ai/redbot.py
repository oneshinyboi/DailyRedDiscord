#!/usr/bin/env python3
"""Red's brain: Foul Play (pmariglia/foul-play) driven over stdio.

Foul Play is a Pokemon Showdown websocket client. This script runs its battle
loop unmodified but swaps the websocket for JSON lines on stdin/stdout:

  in : {"chunk": "<protocol lines the p2 stream produced>"}
  out: {"choice": "move 2"}   (a choice for the p2 stream)

Difficulty (0..1) scales search time and how often Red plays a weaker move.
"""
import argparse
import asyncio
import json
import logging
import math
import os
import random
import re
import sys
from copy import deepcopy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get("FOULPLAY_DIR", os.path.join(HERE, "foul-play")))

# stdout carries the protocol, so everything Foul Play logs goes to stderr
logging.basicConfig(
    stream=sys.stderr,
    level=os.environ.get("REDBOT_LOG", "WARNING"),
    format="%(levelname)-8s %(message)s",
)

from fp.config import BotModes, FoulPlayConfig, SaveReplay  # noqa: E402
from fp.data.mods.apply_mods import apply_mods  # noqa: E402
from fp.battle.state import LastUsedMove  # noqa: E402
from fp.run_battle import pokemon_battle  # noqa: E402
import fp.modes.base as fp_base  # noqa: E402
import fp.data.sets.randbats as fp_randbats  # noqa: E402
import fp.modes.random_battle as fp_random_battle  # noqa: E402
import fp.run_battle as fp_run_battle  # noqa: E402
import fp.search.main as fp_search  # noqa: E402

FORMAT = "gen3randombattle"
# The server forces the challenger's whole team to this level (teamgen.ts).
CHALLENGER_LEVEL = 100
BATTLE_TAG = "battle-gen3randombattle-1"

SEARCH_MS = (10, int(os.environ.get("REDBOT_MAX_SEARCH_MS", "100")))
BLUNDER_RATE = (0.30, 0.0)
POLICY_CUTOFF = (0.0, 0.75)


def lerp(span, t):
    return span[0] + (span[1] - span[0]) * t


def pick_weaker_or_best(difficulty):
    """Replacement for Foul Play's final move choice, scaled by difficulty."""
    blunder = lerp(BLUNDER_RATE, difficulty)
    cutoff = lerp(POLICY_CUTOFF, difficulty)

    def select(mcts_results):
        policy = {}
        for result, sample_chance, _index in mcts_results:
            for option in result.side_one:
                share = sample_chance * option.visits / result.total_visits
                policy[option.move_choice] = policy.get(option.move_choice, 0) + share
        ranked = sorted(policy.items(), key=lambda kv: kv[1], reverse=True)
        if random.random() < blunder:
            return random.choice(ranked)[0]
        best = ranked[0][1]
        kept = [kv for kv in ranked if kv[1] >= best * cutoff]
        return random.choices(kept, weights=[w for _, w in kept])[0][0]

    return select


HP_FIELD = re.compile(r"^(\d+)/(\d+)(.*)$")
HP_LINES = {"switch", "drag", "replace", "-damage", "-heal", "-sethp"}


def hide_opponent_hp(chunk, opponent_side):
    """Foul Play expects the opponent's HP as a percentage, like the real server."""
    out = []
    for line in chunk.split("\n"):
        parts = line.split("|")
        if len(parts) > 3 and parts[1] in HP_LINES and parts[2].startswith(opponent_side):
            idx = 4 if parts[1] in {"switch", "drag", "replace"} else 3
            if len(parts) > idx:
                m = HP_FIELD.match(parts[idx])
                if m and int(m.group(2)) != 100:
                    hp, max_hp, rest = int(m.group(1)), int(m.group(2)), m.group(3)
                    pct = 0 if hp == 0 else max(1, math.ceil(hp * 100 / max_hp))
                    parts[idx] = f"{pct}/100{rest}"
                    line = "|".join(parts)
        out.append(line)
    return "\n".join(out)


def force_challenger_level():
    """Random battle set data lists levels 75-90; the challenger is level 100.

    Foul Play filters the opponent's possible sets by level and builds the
    simulated opponent at the set's level, so the data has to say 100.
    """
    original = fp_randbats.RandomBattleTeamDatasets._initialize_pkmn_sets

    def initialize(self):
        original(self)
        for sets in self.pkmn_sets.values():
            for predicted in sets:
                predicted.pkmn_set.level = CHALLENGER_LEVEL

    fp_randbats.RandomBattleTeamDatasets._initialize_pkmn_sets = initialize


def record_known_choice(battle, choice):
    """Bookkeeping for a decision that was already made (restoring a battle).

    Foul Play uses its own previous move when inferring the opponent's sets, so
    a replayed request must leave the same trace a real search would have.
    """
    kind, _, arg = choice.partition(" ")
    if kind == "switch":
        fresh = deepcopy(battle)
        fresh.user.update_from_request_json(fresh.request_json)
        target = next(p for p in fresh.user.reserve if p.index == int(arg))
        decision = f"switch {target.name}"
    elif arg.isdigit():
        decision = battle.request_json["active"][0]["moves"][int(arg) - 1]["id"]
    else:
        decision = arg
    battle.user.last_selected_move = LastUsedMove(
        battle.user.active.name, decision, battle.turn
    )


def replay_aware(pick_move, client):
    async def wrapper(battle):
        if client.known_choice is not None:
            record_known_choice(battle, client.known_choice)
            return ["/choose known", str(battle.rqid)]
        return await pick_move(battle)

    return wrapper


class StdioClient:
    """Stands in for PSWebsocketClient; same methods Foul Play's loop calls."""

    def __init__(self, name, opponent_name, opponent_side):
        self.frames = asyncio.Queue()
        self.opponent_side = opponent_side
        self.rqid = 0
        self.known_choice = None
        self.frames.put_nowait(
            f">{BATTLE_TAG}\n|init|battle\n|title|{opponent_name} vs. {name}\n"
        )

    async def pump_stdin(self):
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        await loop.connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
        )
        while True:
            raw = await reader.readline()
            if not raw:
                self.frames.put_nowait(None)
                return
            message = json.loads(raw)
            chunk = message["chunk"]
            if chunk.startswith("|request|"):
                request = json.loads(chunk[len("|request|"):])
                self.rqid += 1
                request["rqid"] = self.rqid
                chunk = "|request|" + json.dumps(request)
            frame = f">{BATTLE_TAG}\n{hide_opponent_hp(chunk, self.opponent_side)}\n"
            self.frames.put_nowait((frame, message.get("answer")))

    async def receive_message(self):
        item = await self.frames.get()
        if item is None:
            raise SystemExit(0)
        if isinstance(item, str):
            return item
        frame, self.known_choice = item
        return frame

    async def send_message(self, room, parts):
        text = parts[0]
        if self.known_choice is not None:
            self.known_choice = None
            return
        if text.startswith("/choose "):
            choice = text[len("/choose "):]
        elif text.startswith("/switch "):
            choice = "switch " + text[len("/switch "):]
        else:
            return
        sys.stdout.write(json.dumps({"choice": choice}) + "\n")
        sys.stdout.flush()

    async def leave_battle(self, battle_tag):
        return

    async def save_replay(self, battle_tag):
        return

    async def update_team(self, team):
        return

    async def close(self):
        return


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--difficulty", type=float, default=1.0)
    parser.add_argument("--name", default="Red")
    parser.add_argument("--opponent", default="Challenger")
    parser.add_argument("--side", choices=["p1", "p2"], default="p2")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    difficulty = min(1.0, max(0.0, args.difficulty))
    if args.seed is not None:
        random.seed(args.seed)

    cfg = FoulPlayConfig
    cfg.username = args.name
    cfg.password = None
    cfg.avatar = None
    cfg.bot_mode = BotModes.accept_challenge
    cfg.pokemon_format = FORMAT
    cfg.smogon_stats = None
    cfg.search_time_ms = int(lerp(SEARCH_MS, difficulty))
    cfg.parallelism = 1
    cfg.search_threads = 1
    cfg.team_preview_search_time_ms = cfg.search_time_ms
    cfg.team_preview_search_parallelism = 1
    cfg.team_name = FORMAT
    cfg.team_list = None
    cfg.save_replay = SaveReplay.never
    cfg.room_name = None
    cfg.log_to_file = False

    apply_mods(cfg.format_spec)
    fp_search.select_move_from_mcts_results = pick_weaker_or_best(difficulty)
    force_challenger_level()

    client = StdioClient(args.name, args.opponent, "p1" if args.side == "p2" else "p2")
    fp_run_battle.async_pick_move = replay_aware(fp_base.async_pick_move, client)
    fp_random_battle.async_pick_move = fp_run_battle.async_pick_move
    pump = asyncio.create_task(client.pump_stdin())
    try:
        await pokemon_battle(client, FORMAT, None)
    finally:
        pump.cancel()


if __name__ == "__main__":
    asyncio.run(main())
