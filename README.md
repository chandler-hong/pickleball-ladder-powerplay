# PowerPlay Pickleball Ladder Tool

A scheduling tool for pickleball round-robin tournaments and traditional ladder play. Generates fair, gender-balanced schedules that maximize partner and opponent diversity.

**Live site:** [pickleladder.choxmox.com](https://pickleladder.choxmox.com)

## Features

### Round Robin Mode
- **Smart scheduling** — 10-second multi-start optimizer generates hundreds of candidate schedules and picks the best
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

The schedule generator uses a three-phase constructive approach per round:

1. **Sit-out selection** — gender-aware bye assignment with adaptive cooldown to maximize gap between byes for any player
2. **Partnership formation** — Kuhn's augmenting-path algorithm for optimal bipartite MF matching; brute-force enumeration (up to 20 players) for same-gender pools
3. **Court grouping** — exhaustive search over all possible court assignments to minimize opponent repeats and court co-occurrence

A multi-start wrapper runs this construction hundreds of times within a 10-second budget, scoring each schedule on gender balance, partner uniqueness, bye fairness, court diversity, and opponent spread. The best schedule is selected via lexicographic comparison.

### Scheduling guarantees (for standard configs: 12-40 players, 2-10 courts, 1-30 rounds)

| Constraint | Guarantee |
|---|---|
| Partner repeats | 0 (when MF pool is sufficient) |
| MM vs FF courts | 0 |
| Bye spread | ≤ 1 (max byes − min byes across players) |
| Back-to-back byes | 0 |
| Gender balance (3M/1F) | 0 when even male count is achievable |

## Tech stack

Pure vanilla HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies. Hosted on GitHub Pages.

## Credits

Tool created by Chandler Hong and Claude Opus 4.6.
