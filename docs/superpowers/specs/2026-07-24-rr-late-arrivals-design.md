# Round Robin — Late Arrivals — Design

## Background

Sessions rarely start with everyone present. In the reported case, 16 players were signed up for 3 courts over 10 rounds, and some arrived after play had begun. The tool has no way to express "this person isn't here yet", so the organiser either generates without them (and the roster no longer matches the schedule) or generates with them and manually shuffles round 1 on the fly.

The tool does have a *live substitution* feature — renaming a player mid-tournament, applying to current and future rounds — but that solves a different problem. Renaming does not stop the absent player being scheduled to play in round 1; it just relabels a slot.

## Goals

1. Mark, during setup, that a player joins from a given round.
2. The generator keeps those players on bye until their join round, and optimises the whole schedule around their absence in one pass.
3. Being absent must not count against a player's bye fairness.
4. Block generation, with an actionable message, when too few players are available to field the courts.
5. Existing behaviour is unchanged when nobody is marked late.

## Non-goals

- **No mid-tournament recalculation.** Marking up front is what removes the need: the schedule is built once, correctly, rather than patched afterwards. This was the explicit choice over a mid-round swap-and-regenerate flow.
- **No early departures.** Same machinery would serve it, but it is not the reported problem.
- **No per-round court counts.** `playersPerRound = numCourts * 4` is computed once in `generateSchedule` (`js/schedule.js:119`) and court count is global to the schedule. Making it vary per round would ripple into rendering, score entry, stats, the leaderboard, and both exports. Rejected as out of proportion; over-capacity is handled by blocking instead.
- **No Traditional Ladder support.** The ladder assigns players to courts by position and has no bye concept.
- **No "remove player" semantics.** A join round beyond the last round is a validation error, not a way to exclude someone. Reduce the player count for that.

## Data model

`playerData` entries (built at `js/schedule-ui.js:224`) gain an optional `joinRound`:

```js
{ name, gender, genderManual, joinRound }   // joinRound defaults to 1
```

It persists through the existing `saveState` / `restoreState` path with no other change. Because the field is optional and absent values read as `1`, **payloads saved by earlier versions remain valid** — `STATE_SCHEMA_VERSION` does not need bumping. Restore must apply the `|| 1` default rather than assuming the key exists.

## Generator change

`generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed)` gains a sixth parameter `joinRounds` — an array of length `numPlayers`, 1-based round numbers, defaulting to all `1`. It must be optional so every existing call site and all 3,631 existing assertions keep working untouched.

`generateBestSchedule` and `generateBestScheduleAsync` pass it through.

### Phase 1: sit-out selection

Phase 1 (`js/schedule.js:141` onward) currently picks byes purely on fairness, cooldown, co-bye diversity and gender parity. It gains a forced-bye step ahead of that. For round `r` (0-based, so round number `r + 1`):

1. **Forced byes:** every player with `joinRound > r + 1` sits out. This is not a choice and is not scored.
2. **Voluntary byes:** the remaining `numSitOuts - forcedCount` slots are filled from available players by the existing logic, unchanged.
3. **Gender parity** (`idealSitMPerRound` at `:128`, `cumMaleByes` at `:129`, `genderDev` at `:225`, and the `playM`-even rule for `preferMixed`) is computed over **available** players only, so a forced bye of a known gender does not make the parity target unreachable.

### Bye fairness must exclude forced byes

This is the load-bearing decision in the design.

`sitOutCount[i]` (incremented at `js/schedule.js:317`) drives every fairness signal: `globalMinSitOut` (`:197`), the `unfair` count (`:215`, `:222`), and the squared `fairness` penalty. If forced byes incremented it, a late player would look as though they had already taken several byes, and the scheduler would then over-favour them for the rest of the session — distorting everybody else's byes to compensate for something that was never unfair.

So forced byes are tracked in a separate counter, `voluntaryByeCount`, and are excluded from all fairness comparisons. `sitOutCount` continues to mean **total** byes — forced and voluntary — because that is what a player sees on the schedule; it is `voluntaryByeCount` that every fairness signal reads. Getting these two the wrong way round is the most likely bug in this feature; see the table below.

### Arrivals must be levelled, not left owing byes

Excluding forced byes has a consequence that this design originally missed, and it is a flaw in the design rather than in any implementation of it. An arriving player's `voluntaryByeCount` is `0`, while everyone already there has accumulated several — and every fairness signal ranks *fewest voluntary byes first* (`sitOutPriority`, `globalMinSitOut` / `unfair`, `pickSitters`). So the person who just walked in went straight to the front of the bye queue and was benched repeatedly until they "caught up". Measured on 16 players / 3 courts / 10 rounds, 8M/8F: a player joining round 7 played 2 of their 4 available rounds — 50% benched, against ~21% for everybody else. The exact opposite of the feature's purpose.

The fix is to treat an arrival as *caught up* rather than *owed byes*: on the round they first become available — once, before that round's bye selection — their `voluntaryByeCount` is seeded to the **minimum voluntary count among the players already present**. From then on they take byes at the same rate as everyone else instead of absorbing a backlog. The minimum is chosen deliberately: it is the count carried by whoever has been there all along and been luckiest with byes, so the newcomer is never worse off than the best-off incumbent.

Three places compute "voluntary byes" and all three must apply the seeding identically, or repair would score a schedule on different numbers than the generator built it with: `generateSchedule` (incrementally), `rebuildCounts` (re-derived from a finished schedule for the 2-opt path) and `scoreSchedule`'s `maxMidByeSpread` walk. They share one function, `seedArrivalByeCounts`, for exactly that reason. With nobody late it is a complete no-op — no player satisfies `joinRound === round` for any round after the first, and it makes no RNG call, so a seeded schedule is byte-identical to one generated without `joinRounds` at all.

### Two counters, and which consumer reads which

This is the most likely place for a subtle bug, so the contract is stated explicitly. `generateSchedule`'s result (`js/schedule.js:534`) currently returns one `sitOutCount`. It must return two arrays:

| Field | Counts | Read by |
|---|---|---|
| `sitOutCount` | **Total** byes, forced + voluntary | `renderStats` (`js/schedule-ui.js:1350`, displays "N byes") — a human looking at the schedule counts every round they sat out, whatever the reason |
| `voluntaryByeCount` (new) | Voluntary byes only | Phase 1 fairness internals, and `scoreSchedule` |

`scoreSchedule` destructures `sitOutCount` at `js/schedule.js:792` and derives `maxSitOut` / `byeSpread` from it at `:797`, with `maxMidByeSpread` walking the same per-round data. **All of those must switch to `voluntaryByeCount`.** Otherwise a schedule containing late arrivals scores as permanently unfair, `compareScores` ranks every candidate by an unreachable target, and the optimiser wastes its entire search budget — which would silently degrade partner and opponent diversity, the exact quality this tool exists to provide.

When nobody is late the two arrays are equal element-for-element, so every existing consumer and all 3,631 assertions are unaffected. That equivalence is worth asserting directly in tests rather than assumed.

Two further consequences:

- The repo's stated guarantee needs qualifying in `README.md`'s Scheduling-guarantees table, and the qualification is weaker than "≤ 1 after every round, measured over rounds in which the player was present" — that is not something this design delivers. What was measured, after the arrival seeding above, over 8 configs × 10 seeds × both `preferMixed` settings: the **final** voluntary spread stays ≤ 1 whenever the arrival plays at least two rounds, and reaches 2 for someone joining for the final round only (in their favour — fewer byes, more games). The **running** spread can reach 2 while the rest of the field advances past the newcomer's seed. These are measurements, not proofs, and the table says so.
- `restoreState` assigns `playerData = state.playerData || []` wholesale (`js/state.js:60`), so entries saved by earlier versions simply lack the key. The `|| 1` default must therefore be applied **at read time** — in `buildPlayerGrid` (which reads `playerData[i].name` / `.gender` / `.genderManual` at `js/schedule-ui.js:44-46`) and wherever the `joinRounds` array is assembled — rather than by back-filling the restored array. Mutating on restore would work too, but read-time defaulting cannot be defeated by a payload that skipped the migration.

### Feasibility inside the generator

With forced byes consuming slots, some `sitM` splits become unreachable and `preferMixed` may be unsatisfiable for a given round. The existing relaxation path — which drops `preferMixed` when the best mixed-legal option is still unfair (`js/schedule.js:253`) — already covers this and needs no change. Phase 2 and Phase 3 are untouched: they only ever see the players who are playing.

## Validation

In `collectValidationErrors` (`js/schedule-ui.js`), for each round `r` in `1..numRounds`, count players with `joinRound <= r`. If any round has fewer than `numCourts * 4` available, block Generate and name the first offending round plus both remedies:

> Round 1 has only 11 of the 12 players 3 courts needs. Either drop to 2 courts, or lower a join round.

Also reject a `joinRound` outside `1..numRounds`, and flag the offending row so the error is findable in a 40-row grid, consistent with how existing field errors behave.

Because the error message is a function of the config, it participates in the existing shrink-only banner behaviour for free: fixing the court count or a join round retires the message as the user types.

## UI

Each player row gains a compact late toggle. When off — the default — the row looks exactly as it does today. When on, a small round-number input appears beside it.

A permanent extra field on every row is rejected: the grid runs to 40 rows and already carries a number, a name input, and a gender toggle.

```
PLAYERS                                   8M · 8F
 1.  T              [M][F]  ⏱ joins R3
 2.  Phil           [M][F]  ⏱
 3.  Chandler       [M][F]  ⏱ joins R2
 4.  Kevin Savage   [M][F]  ⏱
```

Toggling late, or changing a join round, is a setup change and so must call `setupChanged()` — retiring an unplayed schedule exactly like a name or count edit, and leaving an in-progress tournament alone. It must also re-run `checkGenderWarning()`, which has to judge the 3M/1F parity **per round over the players actually present** rather than once over the whole roster. Otherwise the note misses precisely the case its own text describes: 8M/8F on 3 courts with 3 men and 1 woman marked late is a comfortable 8M/8F on paper, but round 1 is 5M/7F with no byes to spare and a 1M/3F court is forced. Rounds after the last join round always have the full roster, so inspecting rounds `1..max(joinRound)` covers every distinct availability profile — and with nobody late that maximum is 1, which is the old whole-roster check exactly. Rounds that cannot field the courts are skipped; those are Validation's message, not this one's.

## Edge cases

| Case | Behaviour |
|---|---|
| Nobody marked late | `joinRounds` all `1`; forced-bye set empty every round; behaviour byte-identical to today. This must be asserted, not assumed. |
| Everyone marked late from round 1 | `joinRound: 1` means present from the start — a no-op, not an error. |
| More absent than there are bye slots | Blocked by validation before generation. |
| Exactly enough players available | Zero voluntary byes that round; every available player plays. Existing `numSitOuts === 0` path handles it. |
| Late player's join round equals `numRounds` | Legal: they play exactly the final round. |
| Join round beyond `numRounds` | Validation error. |
| Player count reduced below a marked row | The grid rebuild drops that row's data, as it already does for names and genders. |
| Late arrival plus `preferMixed` infeasible | Existing relaxation drops `preferMixed` for that round, as it does today for lopsided pools. |

## Testing

This is pure scheduling logic, so unlike recent CSS work it is properly unit-testable in the existing Node harness with seeded RNG. Tests belong in `tests/schedule.test.js`.

1. **Absence respected** — a player with `joinRound: 3` appears in no court and no team in rounds 1-2, and does appear from round 3 onward.
2. **Courts always full** — every round still fields exactly `numCourts * 4` players, with late arrivals present.
3. **No duplicates** — the existing duplicate-player invariant holds with late arrivals.
4. **Fairness excludes forced byes** — the *final* voluntary-bye spread stays ≤ 1 (2 for an arrival who plays only the last round), while a late player's *total* byes may legitimately exceed everyone else's. Not asserted after every round: the running voluntary spread can reach 2 while the field advances past a newcomer's arrival seed.
5. **Arrivals are not made to catch up** — a latecomer's benched *rate* over the rounds they were present is comparable to the field's, not double it, and they never take more byes in that window than a full share of it rounded up. This is the regression guard for the design flaw described above; it fails loudly on the pre-seeding generator.
6. **One definition of "voluntary"** — `generateSchedule`'s incremental counter, `rebuildCounts`' recompute and `scoreSchedule`'s running walk produce the same numbers for the same schedule. A silent disagreement here means repair scores a schedule on byes the generator did not build it with.
7. **Display vs fairness split** — `result.sitOutCount` reports total byes including forced ones, and does not equal the fairness counter when someone is late.
8. **Gender rules hold** — no MM-vs-FF, and the `preferMixed` guarantees behave as they do today.
9. **No-op equivalence** — with `joinRounds` all `1`, or omitted entirely, output is identical to the current generator for the same seed. This is the regression guard for the whole change, and it constrains the arrival seeding too: no extra RNG call, no counter touched.
10. **Validation** — over-capacity configs are rejected; out-of-range join rounds are rejected.

The full existing suite (3,631 + 89 + 40 assertions at the time of writing; 4,477 + 89 + 40 once the tests above landed) must stay green at every step, not only at the end. `generateSchedule` feeds the multi-start optimiser and the 2-opt repair, and is the most load-bearing code in the repo.

## Alternatives considered

**Mid-tournament swap with a bye player, then regenerate the remaining rounds.** Matches the "they just didn't show up" case and needs no setup-time input. Rejected in favour of upfront marking, which produces a globally optimised schedule instead of a patched one. Regeneration would also require `generateSchedule` to accept prior partner/opponent/bye history, which it currently cannot — it always starts from zero matrices.

**One shared "late players join from round N" for everyone flagged.** Simpler UI. Rejected: people arrive at different times, and per-player join rounds cost only a small input.

**A plain checkbox meaning "misses round 1".** Simplest possible. Rejected as too coarse for someone who is an hour out.

**Auto-dropping a court for under-populated rounds.** The best on-the-day behaviour, and the only option that handles more absentees than bye slots. Rejected for this change as disproportionate — see Non-goals. Worth revisiting as its own feature if blocking proves annoying in practice.
