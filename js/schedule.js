// ============================================================
// Round-Robin Schedule Generator — Three-Phase Constructive
// ============================================================
//
// Phase 1: Sit-out selection (bye fairness + gender-aware)
// Phase 2: Partnership formation (greedy bipartite matching)
// Phase 3: Court grouping (opponent diversity + courtmate avoidance)

// Bye gap is maximized automatically via roundsSinceLastBye.
// Theoretical max gap = floor(numPlayers / numSitOuts).

// Seedable pseudo-random number generator (Mulberry32) for deterministic
// schedule generation in tests. Production code calls Math.random via the
// default RNG; tests can call setScheduleRng(mulberry32(seed)) to make
// generation reproducible.
let _rng = Math.random;
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function setScheduleRng(rng) { _rng = typeof rng === 'function' ? rng : Math.random; }
function resetScheduleRng() { _rng = Math.random; }

function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(_rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tunable weights for the schedule quality heuristics. All other
// coefficients in the algorithm should reference this object.
const SCHEDULE_WEIGHTS = Object.freeze({
  // Partnership matching (Phase 2): a single partner repeat must outrank
  // any combination of other considerations, hence the large multiplier.
  PARTNER_REPEAT_EDGE: 200,
  // Small penalties that act as tiebreakers inside a given partner-repeat bucket.
  RECENT_SAME_COURT_EDGE: 2,
  NEVER_MET_BONUS_EDGE: 1,

  // Court grouping (Phase 3)
  HARD_MULTIPLIER: 1000,          // scales recent-courtmate + recent-partner violations
  GENDER_VIOLATION: 1_000_000,    // MM vs FF, 3M/1F, 1M/3F -> must outrank everything else
  OPPONENT_REPEAT_CUBIC: 10,      // soft penalty per (opponentCount)^3
  NEVER_MET_OPPONENT_BONUS: 3,    // discount per never-met opponent pair
  COURT_COOCCURRENCE_SOFT: 1,     // coefficient on courtCount term

  // Role-flip decay (recent-history weights)
  PREV1_COURT_DECAY: 3,
  PREV2_COURT_DECAY: 1,
  PREV1_PARTNER_DECAY: 5,
  PREV2_PARTNER_DECAY: 2,

  // Multi-start time budget
  DEFAULT_TIME_BUDGET_MS: 10000,
  ASYNC_CHUNK_MS: 80,
});

function generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed) {
  if (!Number.isInteger(numPlayers) || numPlayers <= 0) throw new Error(`numPlayers must be a positive integer (got ${numPlayers})`);
  if (!Number.isInteger(numCourts) || numCourts <= 0) throw new Error(`numCourts must be a positive integer (got ${numCourts})`);
  if (!Number.isInteger(numRounds) || numRounds <= 0) throw new Error(`numRounds must be a positive integer (got ${numRounds})`);
  if (numPlayers < numCourts * 4) throw new Error(`Need at least ${numCourts * 4} players for ${numCourts} courts`);
  if (!Array.isArray(genders) || genders.length !== numPlayers) throw new Error(`genders must be an array of length ${numPlayers} (got length ${genders ? genders.length : 'undefined'})`);
  for (let i = 0; i < genders.length; i++) {
    if (genders[i] !== 'M' && genders[i] !== 'F') throw new Error(`genders[${i}] must be 'M' or 'F' (got ${JSON.stringify(genders[i])})`);
  }
  const n = numPlayers;
  const playersPerRound = numCourts * 4;
  const numSitOuts = n - playersPerRound;

  const sitOutCount = new Array(n).fill(0);
  const partnerCount = Array.from({length: n}, () => new Array(n).fill(0));
  const opponentCount = Array.from({length: n}, () => new Array(n).fill(0));
  const courtCount = Array.from({length: n}, () => new Array(n).fill(0));
  const playCount = new Array(n).fill(0);
  const totalMalesInPool = genders.filter(g => g === 'M').length;
  const idealSitMPerRound = numSitOuts > 0 ? numSitOuts * totalMalesInPool / n : 0;
  let cumMaleByes = 0;

  const schedule = [];
  const zeroPairMatrix = () => Array.from({length: n}, () => new Array(n).fill(0));
  let prev1Court = zeroPairMatrix();
  let prev2Court = zeroPairMatrix();
  let prev1Partner = zeroPairMatrix();
  let prev2Partner = zeroPairMatrix();
  const sitOutHistory = [];
  const coByeCount = Array.from({length: n}, () => new Array(n).fill(0));
  let prevSameGenderPlayers = new Set();

  for (let r = 0; r < numRounds; r++) {

    // =========================================================
    // PHASE 1: Sit-Out Selection
    // =========================================================
    // Compute how many rounds since each player's last bye (higher = safer to sit out)
    const roundsSinceLastBye = new Array(n).fill(Infinity);
    for (let h = 0; h < sitOutHistory.length; h++) {
      sitOutHistory[h].forEach(p => { roundsSinceLastBye[p] = sitOutHistory.length - h; });
    }

    const indices = Array.from({length: n}, (_, i) => i);
    const randKeys = indices.map(() => _rng());
    // Adaptive cooldown: set 2 less than the ideal gap so there are always
    // extra candidates to choose from, enabling diverse bye groupings.
    const idealGap = numSitOuts > 0 ? Math.floor(n / numSitOuts) : Infinity;
    const hardCooldown = Math.max(2, idealGap - 2);
    // Co-bye score measures concentration of co-sitting partners — the maximum
    // number of times a player has co-sat with any single other player, plus a
    // small contribution from variance across partners. Lower = this player has
    // sat out with a diverse set of others, so sitting them again is "safer"
    // for overall group diversity. This broadens N4/A3 beyond adjacent rounds.
    const coByeScore = new Array(n).fill(0);
    if (sitOutHistory.length > 0) {
      for (let i = 0; i < n; i++) {
        let maxPair = 0;
        let sumSq = 0;
        const row = coByeCount[i];
        for (let j = 0; j < n; j++) {
          if (row[j] > maxPair) maxPair = row[j];
          sumSq += row[j] * row[j];
        }
        // Primary: max concentration. Secondary: sum of squares (encourages
        // spreading co-byes evenly across many partners).
        coByeScore[i] = maxPair * 1000 + sumSq;
      }
    }
    const sitOutPriority = (a, b) => {
      const aRecent = roundsSinceLastBye[a] <= hardCooldown ? 1 : 0;
      const bRecent = roundsSinceLastBye[b] <= hardCooldown ? 1 : 0;
      if (aRecent !== bRecent) return aRecent - bRecent;
      if (aRecent && bRecent) {
        if (roundsSinceLastBye[a] !== roundsSinceLastBye[b]) return roundsSinceLastBye[b] - roundsSinceLastBye[a];
      }
      if (sitOutCount[a] !== sitOutCount[b]) return sitOutCount[a] - sitOutCount[b];
      if (coByeScore[a] !== coByeScore[b]) return coByeScore[a] - coByeScore[b];
      return randKeys[a] - randKeys[b];
    };

    const malesByPriority = indices.filter(i => genders[i] === 'M').sort(sitOutPriority);
    const femalesByPriority = indices.filter(i => genders[i] === 'F').sort(sitOutPriority);
    const totalM = malesByPriority.length;
    const totalF = femalesByPriority.length;

    let sitOuts;
    if (numSitOuts > 0) {
      const globalMinSitOut = Math.min(...sitOutCount);
      const idealCumMaleByes = (r + 1) * idealSitMPerRound;

      function evaluateSitM(sitM, skipMixed) {
        const sitF = numSitOuts - sitM;
        const playM = totalM - sitM;
        const playF = totalF - sitF;
        if (sitF < 0 || sitF > totalF) return null;
        if ((playM + playF) % 2 !== 0) return null;
        // In the strict pass, reject options that violate mixed-parity.
        // In the relaxed pass, we still track it to prefer mixed-compatible
        // options as a tiebreaker (see pickBest).
        const mixedBad = (preferMixed && playM > 0 && playF > 0 && playM % 2 !== 0) ? 1 : 0;
        if (!skipMixed && mixedBad) return null;

        let cooldownViolations = 0, unfair = 0, fairness = 0;
        for (let i = 0; i < sitM; i++) {
          if (roundsSinceLastBye[malesByPriority[i]] <= hardCooldown) cooldownViolations++;
          if (sitOutCount[malesByPriority[i]] > globalMinSitOut) unfair++;
          // Squared fairness penalizes selecting players who have sat out more,
          // producing a more even distribution than a plain sum (N8).
          fairness += (sitOutCount[malesByPriority[i]] + 1) * (sitOutCount[malesByPriority[i]] + 1);
        }
        for (let i = 0; i < sitF; i++) {
          if (roundsSinceLastBye[femalesByPriority[i]] <= hardCooldown) cooldownViolations++;
          if (sitOutCount[femalesByPriority[i]] > globalMinSitOut) unfair++;
          fairness += (sitOutCount[femalesByPriority[i]] + 1) * (sitOutCount[femalesByPriority[i]] + 1);
        }
        const genderDev = Math.abs((cumMaleByes + sitM) - idealCumMaleByes);
        return { sitM, unfair, cooldownViolations, fairness, mixedBad, genderDev };
      }

      function pickBest(candidates) {
        let best = candidates[0];
        for (let i = 1; i < candidates.length; i++) {
          const c = candidates[i];
          if (c.unfair < best.unfair) { best = c; continue; }
          if (c.unfair !== best.unfair) continue;
          if (c.cooldownViolations < best.cooldownViolations) { best = c; continue; }
          if (c.cooldownViolations !== best.cooldownViolations) continue;
          if (c.mixedBad < best.mixedBad) { best = c; continue; }
          if (c.mixedBad !== best.mixedBad) continue;
          if (c.fairness < best.fairness) { best = c; continue; }
          if (c.fairness !== best.fairness) continue;
          if (c.genderDev < best.genderDev) { best = c; continue; }
        }
        return best;
      }

      // First pass: respect preferMixed
      let candidates = [];
      for (let sitM = Math.max(0, numSitOuts - totalF); sitM <= Math.min(numSitOuts, totalM); sitM++) {
        const ev = evaluateSitM(sitM, false);
        if (ev) candidates.push(ev);
      }

      // If the best mixed-valid option still has unfair > 0, relax preferMixed
      // to allow fairer bye distribution at the cost of one odd-gender court
      let best;
      if (candidates.length > 0) {
        best = pickBest(candidates);
        if (best.unfair > 0) {
          const relaxed = [];
          for (let sitM = Math.max(0, numSitOuts - totalF); sitM <= Math.min(numSitOuts, totalM); sitM++) {
            const ev = evaluateSitM(sitM, true);
            if (ev) relaxed.push(ev);
          }
          if (relaxed.length > 0) {
            const relaxedBest = pickBest(relaxed);
            if (relaxedBest.unfair < best.unfair) best = relaxedBest;
          }
        }
      } else {
        // No mixed-valid options at all; use all options
        for (let sitM = Math.max(0, numSitOuts - totalF); sitM <= Math.min(numSitOuts, totalM); sitM++) {
          const ev = evaluateSitM(sitM, true);
          if (ev) candidates.push(ev);
        }
        best = pickBest(candidates);
      }

      const bestSitM = best.sitM;
      const bestSitF = numSitOuts - bestSitM;
      cumMaleByes += bestSitM;
      sitOuts = new Set([
        ...malesByPriority.slice(0, bestSitM),
        ...femalesByPriority.slice(0, bestSitF)
      ]);
    } else {
      sitOuts = new Set();
    }

    const playing = indices.filter(i => !sitOuts.has(i));
    sitOuts.forEach(i => sitOutCount[i]++);

    const poolM = _shuffle(playing.filter(i => genders[i] === 'M'));
    const poolF = _shuffle(playing.filter(i => genders[i] === 'F'));

    // =========================================================
    // PHASE 2: Partnership Formation (Greedy Bipartite Matching)
    // =========================================================

    // Compute recent-history matrices BEFORE partnership formation so
    // the matching avoids pairing players who were recently on the
    // same court (prevents both partner→opponent and opponent→partner
    // role flips in consecutive rounds).
    const recentCourt = zeroPairMatrix();
    const recentPartner = zeroPairMatrix();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        recentCourt[i][j] = prev1Court[i][j] * SCHEDULE_WEIGHTS.PREV1_COURT_DECAY + prev2Court[i][j] * SCHEDULE_WEIGHTS.PREV2_COURT_DECAY;
        recentPartner[i][j] = prev1Partner[i][j] * SCHEDULE_WEIGHTS.PREV1_PARTNER_DECAY + prev2Partner[i][j] * SCHEDULE_WEIGHTS.PREV2_PARTNER_DECAY;
      }
    }

    const partnerships = [];

    // --- Mixed partnerships: match ALL males against ALL females ---
    // The matching will create min(M,F) pairs, picking the optimal
    // subset to minimize partner repeats while preserving never-met
    // pairs for opponent encounters, and avoiding recent courtmates.
    if (poolM.length > 0 && poolF.length > 0) {
      const mfPairs = greedyBipartiteMatch(poolM, poolF, partnerCount, opponentCount, recentCourt);
      const matchedM = new Set(mfPairs.map(p => p[0]));
      const matchedF = new Set(mfPairs.map(p => p[1]));

      let unmatchedM = poolM.filter(m => !matchedM.has(m));
      let unmatchedF = poolF.filter(f => !matchedF.has(f));

      // Rotate same-gender overflow: swap previous-round FF/MM players
      // into MF courts so different players go to same-gender courts.
      // Try all possible swaps, only accept weight-0 (no new repeat).
      if (prevSameGenderPlayers.size > 0 && unmatchedF.length > 0) {
        const stuckFF = unmatchedF.filter(f => prevSameGenderPlayers.has(f));
        const usedForSwap = new Set();
        for (const stuck of stuckFF) {
          let swapIdx = -1;
          for (let k = 0; k < mfPairs.length; k++) {
            if (usedForSwap.has(k)) continue;
            const [m, f] = mfPairs[k];
            if (prevSameGenderPlayers.has(f)) continue;
            if (partnerCount[m][stuck] === 0) { swapIdx = k; break; }
          }
          if (swapIdx >= 0) {
            usedForSwap.add(swapIdx);
            const oldF = mfPairs[swapIdx][1];
            mfPairs[swapIdx][1] = stuck;
            matchedF.delete(oldF); matchedF.add(stuck);
            unmatchedF = unmatchedF.filter(f => f !== stuck);
            unmatchedF.push(oldF);
          }
        }
      }
      if (prevSameGenderPlayers.size > 0 && unmatchedM.length > 0) {
        const stuckMM = unmatchedM.filter(m => prevSameGenderPlayers.has(m));
        const usedForSwap = new Set();
        for (const stuck of stuckMM) {
          let swapIdx = -1;
          for (let k = 0; k < mfPairs.length; k++) {
            if (usedForSwap.has(k)) continue;
            const [m, f] = mfPairs[k];
            if (prevSameGenderPlayers.has(m)) continue;
            if (partnerCount[stuck][f] === 0) { swapIdx = k; break; }
          }
          if (swapIdx >= 0) {
            usedForSwap.add(swapIdx);
            const oldM = mfPairs[swapIdx][0];
            mfPairs[swapIdx][0] = stuck;
            matchedM.delete(oldM); matchedM.add(stuck);
            unmatchedM = unmatchedM.filter(m => m !== stuck);
            unmatchedM.push(oldM);
          }
        }
      }

      // Proactively release MF pairs to same-gender when the unique MF
      // partner pool is running low, preventing forced repeats in later rounds.
      if (mfPairs.length >= 2) {
        // "Fresh" = never partnered (partnerCount === 0). In long schedules
        // where zero-repeats is impossible, also consider least-repeated pairs.
        let globalMinPartnerCount = Infinity;
        for (const m of poolM) {
          for (const f of poolF) {
            if (partnerCount[m][f] < globalMinPartnerCount) globalMinPartnerCount = partnerCount[m][f];
          }
        }
        const freshThreshold = globalMinPartnerCount;
        let minRemainingMF = Infinity;
        for (const m of poolM) {
          let avail = 0;
          for (const f of poolF) if (partnerCount[m][f] <= freshThreshold) avail++;
          if (avail < minRemainingMF) minRemainingMF = avail;
        }
        for (const f of poolF) {
          let avail = 0;
          for (const m of poolM) if (partnerCount[m][f] <= freshThreshold) avail++;
          if (avail < minRemainingMF) minRemainingMF = avail;
        }
        const remainingRounds = numRounds - r;
        if (minRemainingMF < remainingRounds) {
          // Pick a release count that keeps both unmatched pools even-sized
          let releaseCount = 0;
          for (let rc = 4; rc >= 2; rc--) {
            if (rc > mfPairs.length) continue;
            if ((unmatchedM.length + rc) % 2 === 0 && (unmatchedF.length + rc) % 2 === 0) {
              releaseCount = rc; break;
            }
          }
          if (releaseCount >= 2) {
            const deficit = remainingRounds - minRemainingMF;
            const shouldRelease = deficit >= minRemainingMF || _rng() < deficit / remainingRounds;
            if (shouldRelease) {
              mfPairs.sort((a, b) => partnerCount[b[0]][b[1]] - partnerCount[a[0]][a[1]]);
              const released = mfPairs.splice(0, releaseCount);
              for (const p of released) { unmatchedM.push(p[0]); unmatchedF.push(p[1]); }
            }
          }
        }
      }

      for (const pair of mfPairs) partnerships.push(pair);
      if (unmatchedM.length > 0) {
        for (const pair of greedySameGenderMatch(unmatchedM, partnerCount, opponentCount, recentCourt)) partnerships.push(pair);
      }
      if (unmatchedF.length > 0) {
        for (const pair of greedySameGenderMatch(unmatchedF, partnerCount, opponentCount, recentCourt)) partnerships.push(pair);
      }
    } else {
      const pool = poolM.length > 0 ? poolM : poolF;
      for (const pair of greedySameGenderMatch(pool, partnerCount, opponentCount, recentCourt)) partnerships.push(pair);
    }

    // =========================================================
    // PHASE 3: Court Grouping (Pair partnerships into courts)
    // =========================================================

    const courts = greedyCourtGrouping(partnerships, recentCourt, recentPartner, opponentCount, courtCount, genders);

    // =========================================================
    // RECORD the round & update all history matrices
    // =========================================================
    for (const court of courts) {
      const [a1, a2] = court.teamA;
      const [b1, b2] = court.teamB;

      partnerCount[a1][a2]++; partnerCount[a2][a1]++;
      partnerCount[b1][b2]++; partnerCount[b2][b1]++;

      opponentCount[a1][b1]++; opponentCount[b1][a1]++;
      opponentCount[a1][b2]++; opponentCount[b2][a1]++;
      opponentCount[a2][b1]++; opponentCount[b1][a2]++;
      opponentCount[a2][b2]++; opponentCount[b2][a2]++;

      const cp = [a1, a2, b1, b2];
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          courtCount[cp[x]][cp[y]]++;
          courtCount[cp[y]][cp[x]]++;
        }
      }
      cp.forEach(i => playCount[i]++);
    }

    schedule.push({
      round: r + 1,
      courts,
      sitOuts: [...sitOuts]
    });

    prev2Court = prev1Court;
    prev1Court = zeroPairMatrix();
    prev2Partner = prev1Partner;
    prev1Partner = zeroPairMatrix();
    for (const court of courts) {
      const cp = [...court.teamA, ...court.teamB];
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          prev1Court[cp[x]][cp[y]] = 1;
          prev1Court[cp[y]][cp[x]] = 1;
        }
      }
      const [pa1, pa2] = court.teamA;
      const [pb1, pb2] = court.teamB;
      prev1Partner[pa1][pa2] = 1; prev1Partner[pa2][pa1] = 1;
      prev1Partner[pb1][pb2] = 1; prev1Partner[pb2][pb1] = 1;
    }
    sitOutHistory.push(new Set(sitOuts));
    const sitArr = [...sitOuts];
    for (let x = 0; x < sitArr.length; x++) {
      for (let y = x + 1; y < sitArr.length; y++) {
        coByeCount[sitArr[x]][sitArr[y]]++;
        coByeCount[sitArr[y]][sitArr[x]]++;
      }
    }

    // Track who was on a same-gender court this round for rotation next round
    prevSameGenderPlayers = new Set();
    for (const court of courts) {
      const all = [...court.teamA, ...court.teamB];
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 0 || mc === 4) all.forEach(p => prevSameGenderPlayers.add(p));
    }
  }

  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, playCount, coByeCount };
}

// -----------------------------------------------------------------
// Optimal bipartite matching: maximize weight-0 pairs using
// augmenting paths (Kuhn's algorithm), then fill remaining greedily.
// Zero partner repeats whenever mathematically possible.
// -----------------------------------------------------------------
function greedyBipartiteMatch(males, females, partnerCount, opponentCount, recentCourt) {
  const nm = males.length, nf = females.length;
  const target = Math.min(nm, nf);

  function edgeWeight(mi, fj) {
    const m = males[mi], f = females[fj];
    const pw = partnerCount[m][f];
    const neverOpp = opponentCount[m][f] === 0 ? SCHEDULE_WEIGHTS.NEVER_MET_BONUS_EDGE : 0;
    const recentSame = recentCourt[m][f] > 0 ? SCHEDULE_WEIGHTS.RECENT_SAME_COURT_EDGE : 0;
    return pw * SCHEDULE_WEIGHTS.PARTNER_REPEAT_EDGE + recentSame + neverOpp;
  }

  // Precompute edge weights once and collect the distinct values in
  // ascending order. Iterating distinct thresholds is 50-100x faster than
  // stepping every integer up to maxWeight (which can reach ~600).
  const weights = Array.from({length: nm}, () => new Array(nf));
  const distinctSet = new Set();
  for (let i = 0; i < nm; i++) {
    for (let j = 0; j < nf; j++) {
      const w = edgeWeight(i, j);
      weights[i][j] = w;
      distinctSet.add(w);
    }
  }
  const distinctWeights = [...distinctSet].sort((a, b) => a - b);

  const matchM = new Array(nm).fill(-1);
  const matchF = new Array(nf).fill(-1);

  function augment(u, visited, maxW) {
    for (let fj = 0; fj < nf; fj++) {
      if (visited[fj] || weights[u][fj] > maxW) continue;
      visited[fj] = true;
      if (matchF[fj] === -1 || augment(matchF[fj], visited, maxW)) {
        matchM[u] = fj;
        matchF[fj] = u;
        return true;
      }
    }
    return false;
  }

  for (const w of distinctWeights) {
    for (let mi = 0; mi < nm; mi++) {
      if (matchM[mi] !== -1) continue;
      augment(mi, new Array(nf).fill(false), w);
    }
    let matched = 0;
    for (let i = 0; i < nm; i++) if (matchM[i] !== -1) matched++;
    if (matched >= target) break;
  }

  const result = [];
  for (let mi = 0; mi < nm; mi++) {
    if (matchM[mi] !== -1) result.push([males[mi], females[matchM[mi]]]);
  }
  return _shuffle(result);
}

// -----------------------------------------------------------------
// Same-gender matching: brute-force enumerate all perfect matchings
// for small pools (≤12), greedy fallback for larger.
// -----------------------------------------------------------------
function greedySameGenderMatch(players, partnerCount, opponentCount, recentCourt) {
  const n = players.length;
  const target = Math.floor(n / 2);
  if (target === 0) return [];

  function pairWeight(a, b) {
    const pa = players[a], pb = players[b];
    const pw = partnerCount[pa][pb];
    const neverOpp = opponentCount[pa][pb] === 0 ? SCHEDULE_WEIGHTS.NEVER_MET_BONUS_EDGE : 0;
    const recentSame = recentCourt[pa][pb] > 0 ? SCHEDULE_WEIGHTS.RECENT_SAME_COURT_EDGE : 0;
    return pw * SCHEDULE_WEIGHTS.PARTNER_REPEAT_EDGE + recentSame + neverOpp;
  }

  if (n <= 20) {
    let bestPairs = null, bestWeight = Infinity;
    let enumDeadline = Date.now() + (n <= 12 ? 50 : 20);

    function enumerate(remaining, pairs, weight) {
      if (bestWeight === 0) return;
      if (pairs.length === target) {
        if (weight < bestWeight) {
          bestWeight = weight;
          bestPairs = [...pairs];
        }
        return;
      }
      if (weight >= bestWeight) return;
      if (Date.now() > enumDeadline) return;
      const first = remaining[0];
      for (let i = 1; i < remaining.length; i++) {
        const w = pairWeight(first, remaining[i]);
        if (weight + w >= bestWeight) continue;
        const next = remaining.filter((_, idx) => idx !== 0 && idx !== i);
        pairs.push([players[first], players[remaining[i]]]);
        enumerate(next, pairs, weight + w);
        pairs.pop();
        if (bestWeight === 0) return;
      }
    }

    enumerate(Array.from({length: n}, (_, i) => i), [], 0);
    if (bestPairs) return _shuffle(bestPairs);
  }

  // Greedy fallback
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      candidates.push({ a: players[i], b: players[j], weight: pairWeight(i, j), rand: _rng() });
    }
  }
  candidates.sort((a, b) => a.weight - b.weight || a.rand - b.rand);

  const used = new Set();
  const result = [];
  for (const c of candidates) {
    if (used.has(c.a) || used.has(c.b)) continue;
    result.push([c.a, c.b]);
    used.add(c.a); used.add(c.b);
    if (result.length === target) break;
  }
  return _shuffle(result);
}

// -----------------------------------------------------------------
// Court grouping: exhaustive for ≤12 partnerships (≤6 courts),
// greedy for larger pools. Finds optimal opponent diversity.
// -----------------------------------------------------------------
function greedyCourtGrouping(partnerships, recentCourt, recentPartner, opponentCount, courtCount, genders) {
  const np = partnerships.length;
  const numCourts = Math.floor(np / 2);
  const useExhaustive = np <= 12;

  const pairScore = Array.from({length: np}, () => new Array(np));
  for (let i = 0; i < np; i++) {
    for (let j = i + 1; j < np; j++) {
      const p1 = partnerships[i];
      const p2 = partnerships[j];
      const allFour = [...p1, ...p2];

      let prevViolations = 0;
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          prevViolations += recentCourt[allFour[x]][allFour[y]];
        }
      }
      const [ra1, ra2] = p1;
      const [rb1, rb2] = p2;
      prevViolations += recentPartner[ra1][rb1] + recentPartner[ra1][rb2] +
                        recentPartner[ra2][rb1] + recentPartner[ra2][rb2];

      const maleCount = allFour.filter(p => genders[p] === 'M').length;
      let genderViolation = 0;
      if (maleCount === 1 || maleCount === 3) genderViolation = SCHEDULE_WEIGHTS.GENDER_VIOLATION;
      else if (maleCount === 2 && genders[p1[0]] === genders[p1[1]]) genderViolation = SCHEDULE_WEIGHTS.GENDER_VIOLATION;

      const [a1, a2] = p1;
      const [b1, b2] = p2;
      const oppCounts = [opponentCount[a1][b1], opponentCount[a1][b2],
                         opponentCount[a2][b1], opponentCount[a2][b2]];
      const oppScore = oppCounts.reduce((s, v) => s + v * v * v, 0);
      const neverMetBonus = oppCounts.filter(v => v === 0).length;

      let courtScore = 0;
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          courtScore += courtCount[allFour[x]][allFour[y]];
        }
      }

      const hard = prevViolations * SCHEDULE_WEIGHTS.HARD_MULTIPLIER + genderViolation;
      const soft = oppScore * SCHEDULE_WEIGHTS.OPPONENT_REPEAT_CUBIC - neverMetBonus * SCHEDULE_WEIGHTS.NEVER_MET_OPPONENT_BONUS + courtScore * SCHEDULE_WEIGHTS.COURT_COOCCURRENCE_SOFT;
      pairScore[i][j] = { hard, soft };
      pairScore[j][i] = pairScore[i][j];
    }
  }

  if (useExhaustive) {
    // Enumerate all perfect matchings (feasible for ≤12 partnerships = ≤6 courts)
    let bestGrouping = null;
    let bestHard = Infinity, bestSoft = Infinity;

    function enumerate(used, courts, totalHard, totalSoft) {
      if (courts.length === numCourts) {
        if (totalHard < bestHard || (totalHard === bestHard && totalSoft < bestSoft)) {
          bestHard = totalHard;
          bestSoft = totalSoft;
          bestGrouping = [...courts];
        }
        return;
      }
      if (totalHard > bestHard) return;

      let first = -1;
      for (let i = 0; i < np; i++) { if (!used[i]) { first = i; break; } }
      if (first === -1) return;

      used[first] = true;
      for (let j = first + 1; j < np; j++) {
        if (used[j]) continue;
        const s = pairScore[first][j];
        used[j] = true;
        courts.push([first, j]);
        enumerate(used, courts, totalHard + s.hard, totalSoft + s.soft);
        courts.pop();
        used[j] = false;
      }
      used[first] = false;
    }

    enumerate(new Array(np).fill(false), [], 0, 0);
    if (bestGrouping) return bestGrouping.map(([i, j]) => ({ teamA: partnerships[i], teamB: partnerships[j] }));
  }

  // Greedy fallback for large pools: sort all pairs by score, pick greedily
  const sorted = [];
  for (let i = 0; i < np; i++) {
    for (let j = i + 1; j < np; j++) {
      const s = pairScore[i][j];
      sorted.push({ i, j, hard: s.hard, soft: s.soft });
    }
  }
  for (const s of sorted) s.rand = _rng();
  sorted.sort((a, b) => (a.hard - b.hard) || (a.soft - b.soft) || (a.rand - b.rand));

  const used = new Set();
  const courts = [];
  for (const c of sorted) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    courts.push({ teamA: partnerships[c.i], teamB: partnerships[c.j] });
    if (courts.length === numCourts) break;
  }

  if (courts.length !== numCourts) {
    throw new Error(`Court grouping invariant violated: produced ${courts.length} of ${numCourts} courts from ${np} partnerships`);
  }
  return courts;
}

// -----------------------------------------------------------------
// Multi-start optimization: generate many schedules, return the best.
// Evaluates opponent spread, partner spread, coverage, and gender balance.
// -----------------------------------------------------------------
function scoreSchedule(result, n, genders) {
  const { partnerCount, opponentCount, sitOutCount } = result;
  let maxOpp = 0, totalOppExcess = 0, neverMet = 0;
  let maxPartner = 0, totalPartnerExcess = 0;
  let genderBadCourts = 0;
  let partnerToOpp = 0;
  const maxSitOut = sitOutCount ? Math.max(0, ...sitOutCount) : 0;
  const minSitOut = sitOutCount ? Math.min(...sitOutCount) : 0;
  const byeSpread = maxSitOut - minSitOut;

  // Mid-schedule bye fairness: track worst spread at any point during the schedule
  let maxMidByeSpread = 0;
  const runningByeCount = new Array(n).fill(0);
  for (const round of result.schedule) {
    round.sitOuts.forEach(p => runningByeCount[p]++);
    const midSpread = Math.max(...runningByeCount) - Math.min(...runningByeCount);
    if (midSpread > maxMidByeSpread) maxMidByeSpread = midSpread;
  }

  // Co-bye diversity: prefer the pre-computed coByeCount from generateSchedule;
  // fall back to recomputing it for compatibility (e.g., externally constructed
  // results). Either way, maxCoBye is the largest cell above the diagonal.
  let maxCoBye = 0;
  const coByeMatrix = result.coByeCount || (() => {
    const m = Array.from({length: n}, () => new Array(n).fill(0));
    for (const round of result.schedule) {
      for (let i = 0; i < round.sitOuts.length; i++)
        for (let j = i + 1; j < round.sitOuts.length; j++) {
          m[round.sitOuts[i]][round.sitOuts[j]]++;
          m[round.sitOuts[j]][round.sitOuts[i]]++;
        }
    }
    return m;
  })();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (coByeMatrix[i][j] > maxCoBye) maxCoBye = coByeMatrix[i][j];

  let maxCourt = 0, totalCourtExcess = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const opp = opponentCount[i][j];
      if (opp > maxOpp) maxOpp = opp;
      if (opp > 1) totalOppExcess += opp - 1;
      if (result.courtCount[i][j] === 0) neverMet++;

      const part = partnerCount[i][j];
      if (part > maxPartner) maxPartner = part;
      if (part > 1) totalPartnerExcess += part - 1;

      const court = result.courtCount[i][j];
      if (court > maxCourt) maxCourt = court;
      if (court > 1) totalCourtExcess += court - 1;
    }
  }

  const rounds = result.schedule;

  // Consecutive-round courtmate tracking. `consecCourtmate` counts how
  // many pairs reappear on the same court in adjacent rounds (whether as
  // partners or opponents). `maxCourtmateStreak` is the longest streak of
  // consecutive rounds any single pair spent as courtmates. These catch
  // the "I keep playing the same person over and over" complaint that
  // the per-round recentCourt mechanism cannot fully prevent on its own.
  let consecCourtmate = 0;
  let maxCourtmateStreak = 0;
  const _pairStreak = new Map();

  for (let ri = 0; ri < rounds.length; ri++) {
    const hereKeys = new Set();
    for (const court of rounds[ri].courts) {
      const all = [...court.teamA, ...court.teamB];
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 1 || mc === 3) genderBadCourts++;
      else if (mc === 2) {
        const teamAGenders = court.teamA.map(p => genders[p]).sort().join('');
        if (teamAGenders === 'FF' || teamAGenders === 'MM') genderBadCourts++;
      }
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          const lo = all[x] < all[y] ? all[x] : all[y];
          const hi = all[x] < all[y] ? all[y] : all[x];
          hereKeys.add(lo + ',' + hi);
        }
      }
    }
    for (const k of hereKeys) {
      const v = (_pairStreak.get(k) || 0) + 1;
      _pairStreak.set(k, v);
      if (v >= 2) consecCourtmate++;
      if (v > maxCourtmateStreak) maxCourtmateStreak = v;
    }
    for (const k of [..._pairStreak.keys()]) {
      if (!hereKeys.has(k)) _pairStreak.delete(k);
    }

    // Count role flips: partner↔opponent transitions within 2 rounds.
    // Only counts when a pair's relationship CHANGES (not same-role repeats).
    if (ri === 0) continue;
    const prevPartners = new Set();
    const prevOpponents = new Set();
    for (let back = 1; back <= 2 && ri - back >= 0; back++) {
      for (const c of rounds[ri - back].courts) {
        const pk = (a, b) => a + ',' + b;
        prevPartners.add(pk(c.teamA[0], c.teamA[1])); prevPartners.add(pk(c.teamA[1], c.teamA[0]));
        prevPartners.add(pk(c.teamB[0], c.teamB[1])); prevPartners.add(pk(c.teamB[1], c.teamB[0]));
        for (const [a, b] of [[c.teamA[0],c.teamB[0]],[c.teamA[0],c.teamB[1]],[c.teamA[1],c.teamB[0]],[c.teamA[1],c.teamB[1]]]) {
          prevOpponents.add(pk(a, b)); prevOpponents.add(pk(b, a));
        }
      }
    }
    for (const c of rounds[ri].courts) {
      const pk = (a, b) => a + ',' + b;
      // Current partners who were recent opponents
      for (const [a, b] of [[c.teamA[0],c.teamA[1]],[c.teamB[0],c.teamB[1]]]) {
        if (prevOpponents.has(pk(a, b))) partnerToOpp++;
      }
      // Current opponents who were recent partners
      for (const [a, b] of [[c.teamA[0],c.teamB[0]],[c.teamA[0],c.teamB[1]],[c.teamA[1],c.teamB[0]],[c.teamA[1],c.teamB[1]]]) {
        if (prevPartners.has(pk(a, b))) partnerToOpp++;
      }
    }
  }

  return { genderBadCourts, byeSpread, maxMidByeSpread, maxCoBye, partnerToOpp, maxOpp, neverMet, totalOppExcess, maxPartner, totalPartnerExcess, maxCourt, totalCourtExcess, consecCourtmate, maxCourtmateStreak };
}

function compareScores(a, b) {
  if (a.genderBadCourts !== b.genderBadCourts) return a.genderBadCourts - b.genderBadCourts;
  // Zero partner repeats is the top priority after gender
  if (a.maxPartner !== b.maxPartner) return a.maxPartner - b.maxPartner;
  // No player should share a court with the same person in consecutive rounds
  // (catches the "same opponent 3 games in a row" failure mode that the
  // per-round recentCourt soft penalty can still slip past).
  const aMaxStreak = a.maxCourtmateStreak || 0;
  const bMaxStreak = b.maxCourtmateStreak || 0;
  if (aMaxStreak !== bMaxStreak) return aMaxStreak - bMaxStreak;
  const aConsec = a.consecCourtmate || 0;
  const bConsec = b.consecCourtmate || 0;
  if (aConsec !== bConsec) return aConsec - bConsec;
  // Fair bye distribution: final spread, mid-schedule spread, and diverse bye groups
  if (a.byeSpread !== b.byeSpread) return a.byeSpread - b.byeSpread;
  if (a.maxMidByeSpread !== b.maxMidByeSpread) return a.maxMidByeSpread - b.maxMidByeSpread;
  if (a.maxCoBye !== b.maxCoBye) return a.maxCoBye - b.maxCoBye;
  // Court co-occurrence: prefer lower max same-court
  if (a.maxCourt !== b.maxCourt) return a.maxCourt - b.maxCourt;
  // Opponent diversity: prefer lower max opponent repeats
  if (a.maxOpp !== b.maxOpp) return a.maxOpp - b.maxOpp;
  // Then balance role flips, coverage, and excess spreads
  const aScore = a.partnerToOpp * 3 + a.neverMet * 2;
  const bScore = b.partnerToOpp * 3 + b.neverMet * 2;
  if (aScore !== bScore) return aScore - bScore;
  if (a.totalCourtExcess !== b.totalCourtExcess) return a.totalCourtExcess - b.totalCourtExcess;
  if (a.totalOppExcess !== b.totalOppExcess) return a.totalOppExcess - b.totalOppExcess;
  return a.totalPartnerExcess - b.totalPartnerExcess;
}

// -----------------------------------------------------------------
// Post-processing 2-opt repair phase
// -----------------------------------------------------------------
// Given an already-optimized schedule result, try in-round swaps that
// exchange one player between two courts of the same round and re-pair
// the four players on each affected court. Accept swaps that strictly
// improve compareScores. Iterate until no improvement in one pass.
// -----------------------------------------------------------------
function rebuildCounts(schedule, n) {
  const partnerCount = Array.from({length: n}, () => new Array(n).fill(0));
  const opponentCount = Array.from({length: n}, () => new Array(n).fill(0));
  const courtCount = Array.from({length: n}, () => new Array(n).fill(0));
  const sitOutCount = new Array(n).fill(0);
  const playCount = new Array(n).fill(0);
  const coByeCount = Array.from({length: n}, () => new Array(n).fill(0));
  for (const round of schedule) {
    for (const court of round.courts) {
      const [a1, a2] = court.teamA;
      const [b1, b2] = court.teamB;
      partnerCount[a1][a2]++; partnerCount[a2][a1]++;
      partnerCount[b1][b2]++; partnerCount[b2][b1]++;
      opponentCount[a1][b1]++; opponentCount[b1][a1]++;
      opponentCount[a1][b2]++; opponentCount[b2][a1]++;
      opponentCount[a2][b1]++; opponentCount[b1][a2]++;
      opponentCount[a2][b2]++; opponentCount[b2][a2]++;
      const cp = [a1, a2, b1, b2];
      for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) {
        courtCount[cp[x]][cp[y]]++;
        courtCount[cp[y]][cp[x]]++;
      }
      cp.forEach(i => playCount[i]++);
    }
    for (const p of round.sitOuts) sitOutCount[p]++;
    for (let i = 0; i < round.sitOuts.length; i++)
      for (let j = i + 1; j < round.sitOuts.length; j++) {
        coByeCount[round.sitOuts[i]][round.sitOuts[j]]++;
        coByeCount[round.sitOuts[j]][round.sitOuts[i]]++;
      }
  }
  return { partnerCount, opponentCount, courtCount, sitOutCount, playCount, coByeCount };
}

function courtsAreValidGender(court, genders) {
  const all = [...court.teamA, ...court.teamB];
  const mc = all.filter(p => genders[p] === 'M').length;
  if (mc === 1 || mc === 3) return false;
  if (mc === 2 && genders[court.teamA[0]] === genders[court.teamA[1]]) return false;
  return true;
}

// Given 4 player ids, yield the 3 distinct 2v2 partitions.
function partitionsOfFour(four) {
  const [a, b, c, d] = four;
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ];
}

function _findOneImprovement(schedule, n, genders, curScore, deadlineMs) {
  const start = Date.now();
  for (let ri = 0; ri < schedule.length; ri++) {
    if (Date.now() - start > deadlineMs) return null;
    const round = schedule[ri];
    const nc = round.courts.length;
    for (let ci = 0; ci < nc; ci++) {
      for (let cj = ci + 1; cj < nc; cj++) {
        const c1 = round.courts[ci], c2 = round.courts[cj];
        const c1Players = [...c1.teamA, ...c1.teamB];
        const c2Players = [...c2.teamA, ...c2.teamB];
        for (let a = 0; a < 4; a++) {
          for (let b = 0; b < 4; b++) {
            const p1 = c1Players[a], p2 = c2Players[b];
            if (genders[p1] !== genders[p2]) continue;
            const newC1Four = c1Players.slice(); newC1Four[a] = p2;
            const newC2Four = c2Players.slice(); newC2Four[b] = p1;
            const c1Options = partitionsOfFour(newC1Four);
            const c2Options = partitionsOfFour(newC2Four);
            for (const nc1 of c1Options) {
              if (!courtsAreValidGender(nc1, genders)) continue;
              for (const nc2 of c2Options) {
                if (!courtsAreValidGender(nc2, genders)) continue;
                const trialCourts = round.courts.slice();
                trialCourts[ci] = nc1;
                trialCourts[cj] = nc2;
                const trialRound = { round: round.round, sitOuts: round.sitOuts, courts: trialCourts };
                const trialSchedule = schedule.slice();
                trialSchedule[ri] = trialRound;
                const trialCounts = rebuildCounts(trialSchedule, n);
                const trialResult = { schedule: trialSchedule, ...trialCounts };
                const trialScore = scoreSchedule(trialResult, n, genders);
                if (compareScores(trialScore, curScore) < 0) {
                  return { result: trialResult, score: trialScore };
                }
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function repairSchedule2opt(result, n, genders, options) {
  const maxPasses = (options && options.maxPasses) || 3;
  const deadlineMs = (options && options.deadlineMs) || 500;
  const start = Date.now();
  let schedule = result.schedule.map(r => ({
    round: r.round,
    sitOuts: [...r.sitOuts],
    courts: r.courts.map(c => ({ teamA: [...c.teamA], teamB: [...c.teamB] })),
  }));
  const counts = rebuildCounts(schedule, n);
  let curResult = { schedule, ...counts };
  let curScore = scoreSchedule(curResult, n, genders);
  for (let pass = 0; pass < maxPasses; pass++) {
    const remaining = deadlineMs - (Date.now() - start);
    if (remaining <= 0) break;
    const improvement = _findOneImprovement(curResult.schedule, n, genders, curScore, remaining);
    if (!improvement) break;
    curResult = improvement.result;
    curScore = improvement.score;
  }
  return curResult;
}

// Choose a time budget proportional to problem size. Small problems plateau
// quickly so a shorter budget avoids wasted work; large problems benefit
// from more iterations. The bounds keep the UX responsive.
function adaptiveTimeBudgetMs(numPlayers, numCourts, numRounds) {
  // Rough estimate: generateSchedule is ~O(R * (N^3 + K^3)) for court grouping
  // enumeration plus O(N^2) bookkeeping. Scale linearly with R * N * K.
  const sizeFactor = numRounds * numPlayers * numCourts;
  // Target ~200 iterations on a typical laptop. For 10r, 20p, 4c this is ~16k,
  // so a 1ms-per-k-factor coefficient produces the historical ~10s budget.
  const targetMs = sizeFactor * 0.6;
  return Math.max(2000, Math.min(15000, Math.round(targetMs)));
}

function generateBestSchedule(numPlayers, numCourts, numRounds, genders, preferMixed, options) {
  const timeBudgetMs = (options && options.timeBudgetMs) || adaptiveTimeBudgetMs(numPlayers, numCourts, numRounds);
  const plateauMs = (options && options.plateauMs) || Math.min(2000, timeBudgetMs / 3);
  const skipRepair = options && options.skipRepair;
  const repairMs = (options && options.repairMs) || Math.min(500, timeBudgetMs * 0.05);
  const start = Date.now();
  let lastImprovement = start;
  let bestResult = null;
  let bestScore = null;
  let iterations = 0;

  do {
    const result = generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed);
    const score = scoreSchedule(result, numPlayers, genders);
    iterations++;

    if (!bestScore || compareScores(score, bestScore) < 0) {
      bestScore = score;
      bestResult = result;
      lastImprovement = Date.now();
    }
    // Early exit on plateau: if no improvement for plateauMs and we've done
    // enough iterations to sample the space meaningfully.
    if (iterations >= 100 && Date.now() - lastImprovement > plateauMs) break;
  } while (Date.now() - start < timeBudgetMs);

  if (!skipRepair && bestResult) {
    bestResult = repairSchedule2opt(bestResult, numPlayers, genders, { deadlineMs: repairMs });
  }
  return bestResult;
}

function generateBestScheduleAsync(numPlayers, numCourts, numRounds, genders, preferMixed, onProgress, onComplete, options) {
  const timeBudgetMs = (options && options.timeBudgetMs) || adaptiveTimeBudgetMs(numPlayers, numCourts, numRounds);
  const plateauMs = (options && options.plateauMs) || Math.min(2000, timeBudgetMs / 3);
  const skipRepair = options && options.skipRepair;
  const repairMs = (options && options.repairMs) || Math.min(500, timeBudgetMs * 0.05);
  const start = Date.now();
  let lastImprovement = start;
  let bestResult = null;
  let bestScore = null;
  let iterations = 0;

  function runChunk() {
    const chunkEnd = Math.min(Date.now() + SCHEDULE_WEIGHTS.ASYNC_CHUNK_MS, start + timeBudgetMs);
    while (Date.now() < chunkEnd) {
      const result = generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed);
      const score = scoreSchedule(result, numPlayers, genders);
      iterations++;
      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestScore = score;
        bestResult = result;
        lastImprovement = Date.now();
      }
    }
    const elapsed = Date.now() - start;
    const plateaued = iterations >= 100 && Date.now() - lastImprovement > plateauMs;
    if (onProgress) onProgress({ iterations: iterations, pct: Math.min(100, Math.round(elapsed / timeBudgetMs * 100)), score: bestScore });
    if (elapsed < timeBudgetMs && !plateaued) {
      setTimeout(runChunk, 0);
    } else {
      // Run the 2-opt repair phase (non-blocking) then complete.
      if (!skipRepair && bestResult) {
        setTimeout(() => {
          bestResult = repairSchedule2opt(bestResult, numPlayers, genders, { deadlineMs: repairMs });
          onComplete(bestResult);
        }, 0);
      } else {
        onComplete(bestResult);
      }
    }
  }

  setTimeout(runChunk, 0);
}

// Node/CommonJS export for tests. Guarded so the browser (where `module`
// is undefined) is unaffected.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateSchedule,
    generateBestSchedule,
    scoreSchedule,
    compareScores,
    repairSchedule2opt,
    adaptiveTimeBudgetMs,
    setScheduleRng,
    resetScheduleRng,
    mulberry32,
    SCHEDULE_WEIGHTS,
  };
}
