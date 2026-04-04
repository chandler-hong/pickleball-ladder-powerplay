// ============================================================
// Round-Robin Schedule Generator — Three-Phase Constructive
// ============================================================
//
// Phase 1: Sit-out selection (bye fairness + gender-aware)
// Phase 2: Partnership formation (greedy bipartite matching)
// Phase 3: Court grouping (opponent diversity + courtmate avoidance)

// Bye gap is maximized automatically via roundsSinceLastBye.
// Theoretical max gap = floor(numPlayers / numSitOuts).

function generateSchedule(numPlayers, numCourts, numRounds, _iterations, genders, preferMixed) {
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
  let prevRoundCourt = Array.from({length: n}, () => new Array(n).fill(0));
  const sitOutHistory = [];
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
    const randKeys = indices.map(() => Math.random());
    // Hard cooldown: never sit out within 2 rounds. Beyond that, randomize.
    const hardCooldown = 3;
    const sitOutPriority = (a, b) => {
      const aRecent = roundsSinceLastBye[a] <= hardCooldown ? 1 : 0;
      const bRecent = roundsSinceLastBye[b] <= hardCooldown ? 1 : 0;
      if (aRecent !== bRecent) return aRecent - bRecent;
      if (aRecent && bRecent) {
        if (roundsSinceLastBye[a] !== roundsSinceLastBye[b]) return roundsSinceLastBye[b] - roundsSinceLastBye[a];
      }
      if (sitOutCount[a] !== sitOutCount[b]) return sitOutCount[a] - sitOutCount[b];
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
      let bestSitM = 0, bestUnfair = Infinity, bestCooldown = Infinity;
      let bestGenderDev = Infinity, bestFairness = Infinity;

      for (let sitM = Math.max(0, numSitOuts - totalF); sitM <= Math.min(numSitOuts, totalM); sitM++) {
        const sitF = numSitOuts - sitM;
        const playM = totalM - sitM;
        const playF = totalF - sitF;
        if (playM % 2 !== 0 || playF % 2 !== 0) continue;

        let cooldownViolations = 0, unfair = 0, fairness = 0;
        for (let i = 0; i < sitM; i++) {
          if (roundsSinceLastBye[malesByPriority[i]] <= hardCooldown) cooldownViolations++;
          if (sitOutCount[malesByPriority[i]] > globalMinSitOut) unfair++;
          fairness += sitOutCount[malesByPriority[i]];
        }
        for (let i = 0; i < sitF; i++) {
          if (roundsSinceLastBye[femalesByPriority[i]] <= hardCooldown) cooldownViolations++;
          if (sitOutCount[femalesByPriority[i]] > globalMinSitOut) unfair++;
          fairness += sitOutCount[femalesByPriority[i]];
        }

        const genderDev = Math.abs((cumMaleByes + sitM) - idealCumMaleByes);

        if (unfair < bestUnfair ||
            (unfair === bestUnfair && cooldownViolations < bestCooldown) ||
            (unfair === bestUnfair && cooldownViolations === bestCooldown && genderDev < bestGenderDev) ||
            (unfair === bestUnfair && cooldownViolations === bestCooldown && genderDev === bestGenderDev && fairness < bestFairness)) {
          bestUnfair = unfair;
          bestCooldown = cooldownViolations;
          bestGenderDev = genderDev;
          bestFairness = fairness;
          bestSitM = sitM;
        }
      }

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

    const poolM = shuffle(playing.filter(i => genders[i] === 'M'));
    const poolF = shuffle(playing.filter(i => genders[i] === 'F'));
    const numMixedCourts = Math.min(Math.floor(poolM.length / 2), Math.floor(poolF.length / 2));

    // =========================================================
    // PHASE 2: Partnership Formation (Greedy Bipartite Matching)
    // =========================================================

    const partnerships = [];

    // --- Mixed partnerships: match ALL males against ALL females ---
    // The matching will create min(M,F) pairs, picking the optimal
    // subset to minimize partner repeats.
    if (poolM.length > 0 && poolF.length > 0) {
      const mfPairs = greedyBipartiteMatch(poolM, poolF, partnerCount);
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
          let bestIdx = -1;
          for (let k = 0; k < mfPairs.length; k++) {
            if (usedForSwap.has(k)) continue;
            const [m, f] = mfPairs[k];
            if (prevSameGenderPlayers.has(f)) continue;
            if (partnerCount[m][stuck] === 0) { bestIdx = k; break; }
          }
          if (bestIdx >= 0) {
            usedForSwap.add(bestIdx);
            const oldF = mfPairs[bestIdx][1];
            mfPairs[bestIdx][1] = stuck;
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
          let bestIdx = -1;
          for (let k = 0; k < mfPairs.length; k++) {
            if (usedForSwap.has(k)) continue;
            const [m, f] = mfPairs[k];
            if (prevSameGenderPlayers.has(m)) continue;
            if (partnerCount[stuck][f] === 0) { bestIdx = k; break; }
          }
          if (bestIdx >= 0) {
            usedForSwap.add(bestIdx);
            const oldM = mfPairs[bestIdx][0];
            mfPairs[bestIdx][0] = stuck;
            matchedM.delete(oldM); matchedM.add(stuck);
            unmatchedM = unmatchedM.filter(m => m !== stuck);
            unmatchedM.push(oldM);
          }
        }
      }

      for (const pair of mfPairs) partnerships.push(pair);
      if (unmatchedM.length > 0) {
        for (const pair of greedySameGenderMatch(unmatchedM, partnerCount)) partnerships.push(pair);
      }
      if (unmatchedF.length > 0) {
        for (const pair of greedySameGenderMatch(unmatchedF, partnerCount)) partnerships.push(pair);
      }
    } else {
      const pool = poolM.length > 0 ? poolM : poolF;
      for (const pair of greedySameGenderMatch(pool, partnerCount)) partnerships.push(pair);
    }

    // =========================================================
    // PHASE 3: Court Grouping (Pair partnerships into courts)
    // =========================================================

    const courts = greedyCourtGrouping(partnerships, prevRoundCourt, opponentCount, courtCount, genders);

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

    prevRoundCourt = Array.from({length: n}, () => new Array(n).fill(0));
    for (const court of courts) {
      const cp = [...court.teamA, ...court.teamB];
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          prevRoundCourt[cp[x]][cp[y]] = 1;
          prevRoundCourt[cp[y]][cp[x]] = 1;
        }
      }
    }
    sitOutHistory.push(new Set(sitOuts));

    // Track who was on a same-gender court this round for rotation next round
    prevSameGenderPlayers = new Set();
    for (const court of courts) {
      const all = [...court.teamA, ...court.teamB];
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 0 || mc === 4) all.forEach(p => prevSameGenderPlayers.add(p));
    }
  }

  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, playCount };
}

// -----------------------------------------------------------------
// Optimal bipartite matching: maximize weight-0 pairs using
// augmenting paths (Kuhn's algorithm), then fill remaining greedily.
// Zero partner repeats whenever mathematically possible.
// -----------------------------------------------------------------
function greedyBipartiteMatch(males, females, partnerCount) {
  const nm = males.length, nf = females.length;
  const target = Math.min(nm, nf);

  // Find max weight needed (cap search to avoid scanning huge matrices)
  let maxWeight = 0;
  for (let i = 0; i < nm; i++)
    for (let j = 0; j < nf; j++) {
      const w = partnerCount[males[i]][females[j]];
      if (w > maxWeight) maxWeight = w;
    }
  if (maxWeight === 0) maxWeight = 1;

  const matchM = new Array(nm).fill(-1);
  const matchF = new Array(nf).fill(-1);

  function augment(u, visited, maxW) {
    for (let fj = 0; fj < nf; fj++) {
      if (visited[fj] || partnerCount[males[u]][females[fj]] > maxW) continue;
      visited[fj] = true;
      if (matchF[fj] === -1 || augment(matchF[fj], visited, maxW)) {
        matchM[u] = fj;
        matchF[fj] = u;
        return true;
      }
    }
    return false;
  }

  for (let w = 0; w <= maxWeight; w++) {
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
  return shuffle(result);
}

// -----------------------------------------------------------------
// Same-gender matching: brute-force enumerate all perfect matchings
// for small pools (≤12), greedy fallback for larger.
// -----------------------------------------------------------------
function greedySameGenderMatch(players, partnerCount) {
  const n = players.length;
  const target = Math.floor(n / 2);
  if (target === 0) return [];

  if (n <= 12) {
    // Brute-force: enumerate all perfect matchings, pick min weight
    let bestPairs = null, bestWeight = Infinity;

    function enumerate(remaining, pairs, weight) {
      if (pairs.length === target) {
        if (weight < bestWeight) {
          bestWeight = weight;
          bestPairs = [...pairs];
        }
        return;
      }
      if (weight >= bestWeight) return;
      const first = remaining[0];
      for (let i = 1; i < remaining.length; i++) {
        const w = partnerCount[players[first]][players[remaining[i]]];
        const next = remaining.filter((_, idx) => idx !== 0 && idx !== i);
        pairs.push([players[first], players[remaining[i]]]);
        enumerate(next, pairs, weight + w);
        pairs.pop();
      }
    }

    enumerate(Array.from({length: n}, (_, i) => i), [], 0);
    return bestPairs ? shuffle(bestPairs) : [];
  }

  // Greedy fallback for large pools
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      candidates.push({ a: players[i], b: players[j], weight: partnerCount[players[i]][players[j]] });
    }
  }
  candidates.sort((a, b) => a.weight - b.weight || Math.random() - 0.5);

  const used = new Set();
  const result = [];
  for (const c of candidates) {
    if (used.has(c.a) || used.has(c.b)) continue;
    result.push([c.a, c.b]);
    used.add(c.a); used.add(c.b);
    if (result.length === target) break;
  }
  return shuffle(result);
}

// -----------------------------------------------------------------
// Court grouping: exhaustive for ≤12 partnerships (≤6 courts),
// greedy for larger pools. Finds optimal opponent diversity.
// -----------------------------------------------------------------
function greedyCourtGrouping(partnerships, prevRoundCourt, opponentCount, courtCount, genders) {
  const np = partnerships.length;
  const numCourts = Math.floor(np / 2);
  const useExhaustive = np <= 12;

  const pairScore = {};
  for (let i = 0; i < np; i++) {
    for (let j = i + 1; j < np; j++) {
      const p1 = partnerships[i];
      const p2 = partnerships[j];
      const allFour = [...p1, ...p2];

      let prevViolations = 0;
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          prevViolations += prevRoundCourt[allFour[x]][allFour[y]];
        }
      }

      const maleCount = allFour.filter(p => genders[p] === 'M').length;
      let genderViolation = 0;
      if (maleCount === 1 || maleCount === 3) genderViolation = 1000000;
      else if (maleCount === 2 && genders[p1[0]] === genders[p1[1]]) genderViolation = 1000000;

      const [a1, a2] = p1;
      const [b1, b2] = p2;
      const oppScore = opponentCount[a1][b1] + opponentCount[a1][b2] +
                        opponentCount[a2][b1] + opponentCount[a2][b2];

      let courtScore = 0;
      for (let x = 0; x < 4; x++) {
        for (let y = x + 1; y < 4; y++) {
          courtScore += courtCount[allFour[x]][allFour[y]];
        }
      }

      const hard = prevViolations * 1000 + genderViolation;
      const soft = oppScore * 5 + courtScore * 2;
      pairScore[i + ',' + j] = { hard, soft };
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
      if (totalHard === bestHard && totalSoft >= bestSoft) return;

      let first = -1;
      for (let i = 0; i < np; i++) { if (!used[i]) { first = i; break; } }
      if (first === -1) return;

      used[first] = true;
      for (let j = first + 1; j < np; j++) {
        if (used[j]) continue;
        const s = pairScore[first + ',' + j];
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
      const s = pairScore[i + ',' + j];
      sorted.push({ i, j, hard: s.hard, soft: s.soft });
    }
  }
  sorted.sort((a, b) => (a.hard - b.hard) || (a.soft - b.soft) || (Math.random() - 0.5));

  const used = new Set();
  const courts = [];
  for (const c of sorted) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    courts.push({ teamA: partnerships[c.i], teamB: partnerships[c.j] });
    if (courts.length === numCourts) break;
  }

  // Fill any remaining
  if (courts.length < numCourts) {
    const rem = [];
    for (let i = 0; i < np; i++) if (!used.has(i)) rem.push(partnerships[i]);
    for (let i = 0; i < rem.length - 1; i += 2) courts.push({ teamA: rem[i], teamB: rem[i+1] });
  }
  return courts;
}
