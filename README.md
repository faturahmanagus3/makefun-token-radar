# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faturahmanagus3/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faturahmanagus3/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed DefiLlama snapshot of 758 protocols and ranks the ones that record no token yet by an implied value: what a token would be worth if the protocol's record stayed as it is. The model is one stated function of the snapshot's own figures — TVL × a category multiple × seven-day growth × maturity (how long the protocol has run with no token) × chain breadth — with no protocol name special-cased. The board covers all 40 watchlist protocols and 152 more the radar found below the watchlist floor; protocols whose token already trades are set aside at their market caps, and wrapped, staked or bridged products of live tokens are set aside with the reason named. Every ranked row carries a seven-step farm plan with costs and times, derived from its category, chains, TVL and age. The dashboard is a static page (no network, no build step) with a sortable, filterable board, a detail view per protocol that recomputes its value in the page, and the model stated in full.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

The grader mounts the sealed snapshot at `/input`, where plain `node main.ts` finds it; locally, pass any copy of the snapshot (for example the kit's `input/snapshot.json`) with `--input`. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, and refuses with a reason if the board it built is one the gate would not take.

---
<sub>Entered on [make.fun](https://make.fun/?ref=dontol&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
