# Pickleball Round Robin & Ladder Tool

A scheduling tool for pickleball round-robin tournaments and traditional ladder play. Generates fair, gender-balanced schedules that maximize partner and opponent diversity.

**Live site:** [pickle.choxmox.com](https://pickle.choxmox.com)

## Features

### Round Robin Mode
- **Duplicate-name detection** — matching player names are flagged both as you type and when you press Generate, with a prompt to add a last initial so the leaderboard can tell two people apart; the check ignores case and surrounding whitespace
- **Generate gates the schedule** — the schedule and round timer stay hidden until you press **Generate Schedule**; editing the roster beforehand retires a generated-but-unplayed schedule so it can't silently reappear stale, a tournament with results already recorded is left alone so mid-event substitution keeps working, and refreshing mid-tournament restores the schedule you had
- **Smart scheduling** — multi-start optimizer generates hundreds of candidate schedules within an adaptive time budget and picks the best
- **Post-processing 2-opt repair** — after the multi-start converges, a local-search pass exchanges players between courts in the same round to shave off residual partner repeats and role flips
- **Fresh partners** — every player gets a new partner each round when the pool allows; with *Prefer mixed* on and a small minority gender, mixed courts take priority, so a partner may repeat rather than break up a mixed court
- **Mixed doubles preference** — *Prefer mixed* maximizes MF-vs-MF courts and never segregates for partner variety; all-men / all-women courts appear only when a gender is in excess on court (e.g. 6 men + 2 women → one all-men court), and MM-vs-FF or 3M/1F courts never occur
- **Fair byes** — sit-outs distributed evenly with no back-to-back byes and diverse bye groups
- **Late arrivals** — tap **⏱ Late** on anyone who's running behind and set the round they'll join; they sit out until then and the whole schedule is optimised around their absence in one pass. Their forced byes are excluded from bye-fairness so nobody else is penalised for them, and the newcomer starts level with the field rather than owing the byes they were absent for — so they aren't benched to "catch up" on arrival
- **Live substitution** — swap player names mid-tournament; changes apply to current and future rounds
- **Swap Partners button** — cycle through all 3 possible team pairings on any court
- **Two ways to record results** — tap a team to pick the winner, or switch to **Enter scores** and type each game's score. Score entry has a **Win by 1 / Win by 2** toggle (games to 11), live validation that blocks impossible scores, and a **Complete Game Early** option for games the round timer cuts short
- **Leaderboard** — auto-populates win/loss stats; when scores are entered it adds a **point-differential** column and uses it as the tiebreaker
- **Per-round countdown timer** — set the round length (default 10 min), Pause / Resume / Reset; survives page refresh; auto-resets when the round advances and goes red/pulses when time's up
- **Current round pinned to the top** — the round you're playing sits directly under the round timer, with upcoming rounds next and completed rounds tucked at the bottom, so you never scroll to reach the timer
- **Smooth round transitions** — completing a round animates the reshuffle instead of snapping into place, and a muted `✓ Completed · N rounds` divider marks where played rounds begin; the motion respects `prefers-reduced-motion` and falls back to an instant change on browsers without the View Transitions API
- **PDF and CSV export** — print-friendly layout and downloadable results

### Traditional Ladder Mode
- **Configurable layout** — pick 1–10 courts (4 players per court) and customize each court number
- **Manual or random initial assignment** — drag players between courts to set starting positions, or click Re-shuffle for a gender-balanced random layout
- **Per-round countdown timer** — set the round length (default 10 min), Pause / Resume / Reset; survives page refresh; goes red and pulses when time's up
- **Per-court Done badge** — at-a-glance status of which courts have finished while the round is in progress
- Winners move up, losers move down each round
- Score validation for standard pickleball scoring
- Full round history and leaderboard

### General
- Works offline — pure client-side HTML/CSS/JS, no backend required
- State persists in localStorage across page refreshes (with a schema version that safely resets incompatible saved data instead of breaking on boot)
- **Light / dark theme toggle** — defaults to your device's setting and remembers your choice across visits
- Mobile-responsive layout
- **Labelled ⏱ Late chip** — the late-arrival marker on each player row carries the word, not just a clock, so it explains itself without relying on a hover tooltip that touch devices don't have; a hint line sits under the Players heading at every screen width, the chip is a 44px tap target on mobile, and tabbing to it shows a focus ring that stays visible after you tick it. Its text clears WCAG AA (4.5:1) in both themes, resting and ticked
- Gender auto-detection from 2,000+ names across 20+ cultures; a gender you set by hand is sticky and never auto-overridden

## Algorithm

The schedule generator uses a three-phase constructive approach per round, followed by a post-processing repair phase on the best schedule:

1. **Sit-out selection** — gender-aware bye assignment with adaptive cooldown to maximize the gap between byes for any player. A concentration-based co-bye score prevents the same group from repeatedly sitting out together.
2. **Partnership formation** — Kuhn's augmenting-path algorithm for optimal bipartite MF matching (with distinct-weight threshold iteration for 50-100× speedup); brute-force enumeration (up to 20 players) for same-gender pools.
3. **Court grouping** — exhaustive search over all possible court assignments (for ≤ 6 courts) to minimize opponent repeats and court co-occurrence, with greedy fallback for larger pools.
4. **2-opt repair (post-processing)** — for each pair of courts within a round, try swapping one player and re-pairing the teams. Accept any swap that strictly improves the schedule under `compareScores`. Runs under a small time budget (up to ~500ms).

A multi-start wrapper runs phases 1-3 hundreds of times within an adaptive time budget (scaled to problem size; 2s floor, 15s ceiling), scoring each schedule on gender balance, partner uniqueness, bye fairness, court diversity, and opponent spread. The best schedule is then sent through the 2-opt repair phase. Selection is via strict lexicographic comparison.

### Scheduling guarantees (for standard configs: 12-40 players, 2-10 courts, 1-30 rounds)

| Constraint | Guarantee |
|---|---|
| Partner repeats | 0 when the pool allows; with *Prefer mixed* on and a lopsided split, mixed courts take priority so partners can repeat (e.g. 6M/4F over 10 rounds → up to 2) |
| Back-to-back partners | 0 — the same pair never partners in two consecutive rounds; any forced repeat is always spaced apart |
| MM vs FF courts | 0 |
| Bye spread | ≤ 1 after every round when nobody is late — no player receives an (N+1)th bye until everyone has had N. With a late arrival, forced byes are excluded and the newcomer is levelled with the field's lowest count on the round they join: the final voluntary spread then measured ≤ 1 in every config tested (2 for someone joining for the final round only — in their favour, fewer byes), and the running spread can reach 2 while the field advances past them. Measured, not proved. |
| Back-to-back byes | 0 |
| Same-court pair streak | Typically ≤ 2 consecutive rounds; the generator strongly avoids 3-in-a-row and spaces repeat meetings apart. In very tight low-court configs with no byes (e.g. 12 players / 3 courts), an occasional streak of 3 can occur. |
| Duplicate players on a court | 0 (hard invariant, verified by tests) |
| Gender balance (3M/1F) | 0 when even male count is achievable |

## Testing

The `tests/` directory contains a Node-based test harness with deterministic (seeded) schedule generation:

```bash
npm test              # run all suites (≈ 20s)
npm run test:unit     # schedule smoke tests — 33 cases, 4477 assertions
npm run test:stress   # schedule end-to-end — 7 scenarios, 3s budget each
npm run test:utils    # utils helpers — 9 cases, 89 assertions (csvCell, guessGender, shuffle, pickRandomNames, pickleball score validation)
npm run test:ladder   # ladder logic — 7 cases, 40 assertions (scoring, pairing, movement, leaderboard)
```

The schedule tests cover input validation, duplicate-player invariants, gender rules across balanced/skewed pools, bye-fairness invariants — including regression tests for the running, after-every-round guarantee described above, and for late arrivals: that a newcomer is benched at roughly the field's rate rather than made to absorb the byes they were absent for, and that the generator's incremental voluntary-bye counter, the 2-opt rebuild and the scorer all agree on the same numbers — determinism (same seed produces the same schedule), and 2-opt repair correctness. The utils and ladder suites cover CSV-injection escaping, gender detection (including unisex deferral), pickleball score validation (win by 1 / win by 2, rejecting impossible scores), ladder score validation and up/down movement, and leaderboard stats (including the position-based Highest Court ranking).

## Tech stack

Pure vanilla HTML, CSS, and JavaScript. No frameworks, no build step, no runtime dependencies. Hosted on GitHub Pages. Node is only used to run the test suite.

## Credits

Tool created by Chandler Hong and Claude Opus 5.
