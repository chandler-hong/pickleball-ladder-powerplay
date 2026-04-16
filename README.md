# PowerPlay Pickleball Ladder Tool

A scheduling tool for pickleball round-robin tournaments and traditional ladder play. Generates fair, gender-balanced schedules that maximize partner and opponent diversity.

**Live site:** [pickleladder.choxmox.com](https://pickleladder.choxmox.com)

## Features

### Round Robin Mode
- **Smart scheduling** — multi-start optimizer generates hundreds of candidate schedules within an adaptive time budget and picks the best
- **Post-processing 2-opt repair** — after the multi-start converges, a local-search pass exchanges players between courts in the same round to shave off residual partner repeats and role flips
- **Zero partner repeats** — every player gets a new partner each round (when mathematically possible)
- **Mixed doubles preference** — MF vs MF courts maximized; MM vs FF courts never allowed
- **Fair byes** — sit-outs distributed evenly with no back-to-back byes and diverse bye groups
- **Live substitution** — swap player names mid-tournament; changes apply to current and future rounds
- **Swap Partners button** — cycle through all 3 possible team pairings on any court
- **Winner tracking** — click teams to record winners; auto-populates leaderboard with win/loss stats
- **PDF and CSV export** — print-friendly layout and downloadable results

### Traditional Ladder Mode
- 20 players across 5 courts with winners moving up and losers moving down
- Score validation for standard pickleball scoring
- Full round history and leaderboard

### General
- Works offline — pure client-side HTML/CSS/JS, no backend required
- State persists in localStorage across page refreshes
- Mobile-responsive dark theme
- Gender auto-detection from 2,000+ names across 20+ cultures

## Algorithm

The schedule generator uses a three-phase constructive approach per round, followed by a post-processing repair phase on the best schedule:

1. **Sit-out selection** — gender-aware bye assignment with adaptive cooldown to maximize the gap between byes for any player. A concentration-based co-bye score prevents the same group from repeatedly sitting out together.
2. **Partnership formation** — Kuhn's augmenting-path algorithm for optimal bipartite MF matching (with distinct-weight threshold iteration for 50-100× speedup); brute-force enumeration (up to 20 players) for same-gender pools.
3. **Court grouping** — exhaustive search over all possible court assignments (for ≤ 6 courts) to minimize opponent repeats and court co-occurrence, with greedy fallback for larger pools.
4. **2-opt repair (post-processing)** — for each pair of courts within a round, try swapping one player and re-pairing the teams. Accept any swap that strictly improves the schedule under `compareScores`. Runs under a time budget (~500ms).

A multi-start wrapper runs phases 1-3 hundreds of times within an adaptive time budget (scaled to problem size, 2s-15s), scoring each schedule on gender balance, partner uniqueness, bye fairness, court diversity, and opponent spread. The best schedule is then sent through the 2-opt repair phase. Selection is via strict lexicographic comparison.

### Scheduling guarantees (for standard configs: 12-40 players, 2-10 courts, 1-30 rounds)

| Constraint | Guarantee |
|---|---|
| Partner repeats | 0 (when MF pool is sufficient) |
| MM vs FF courts | 0 |
| Bye spread | ≤ 1 (max byes − min byes across players) |
| Back-to-back byes | 0 |
| Duplicate players on a court | 0 (hard invariant, verified by tests) |
| Gender balance (3M/1F) | 0 when even male count is achievable |

## Testing

The `tests/` directory contains a Node-based test harness with deterministic (seeded) schedule generation:

```bash
npm test              # run all tests (≈ 20s)
npm run test:unit     # smoke tests — 12 cases, 1430 assertions
npm run test:stress   # end-to-end — 7 scenarios, 3s budget each
```

The unit tests cover input validation, duplicate-player invariants, gender rules across balanced/skewed pools, bye-fairness invariants, determinism (same seed produces the same schedule), and 2-opt repair correctness.

## Tech stack

Pure vanilla HTML, CSS, and JavaScript. No frameworks, no build step, no runtime dependencies. Hosted on GitHub Pages. Node is only used to run the test suite.

## Credits

Tool created by Chandler Hong and Claude Opus 4.6.
