// ============================================================
// Round-Robin Schedule Generator — Three-Phase Constructive
// ============================================================
//
// Phase 1: Sit-out selection (bye fairness + gender-aware)
// Phase 2: Partnership formation (greedy bipartite matching)
// Phase 3: Court grouping (opponent diversity + courtmate avoidance)

// Bye gap is maximized automatically via roundsSinceLastBye.
// Theoretical max gap = floor(numPlayers / numSitOuts).

function generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed) {
  if (numPlayers < numCourts * 4) throw new Error(`Need at least ${numCourts * 4} players for ${numCourts} courts`);
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
    const randKeys = indices.map(() => Math.random());
    // Adaptive cooldown: set 2 less than the ideal gap so there are always
    // extra candidates to choose from, enabling diverse bye groupings.
    const idealGap = numSitOuts > 0 ? Math.floor(n / numSitOuts) : Infinity;
    const hardCooldown = Math.max(2, idealGap - 2);
    const coByeScore = new Array(n).fill(0);
    if (sitOutHistory.length > 0) {
      const lastByers = sitOutHistory[sitOutHistory.length - 1];
      for (let i = 0; i < n; i++) {
        lastByers.forEach(p => { coByeScore[i] += coByeCount[i][p]; });
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
        if (!skipMixed && preferMixed && playM > 0 && playF > 0 && playM % 2 !== 0) return null;

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
        return { sitM, unfair, cooldownViolations, fairness, genderDev };
      }

      function pickBest(candidates) {
        let best = candidates[0];
        for (let i = 1; i < candidates.length; i++) {
          const c = candidates[i];
          if (c.unfair < best.unfair ||
              (c.unfair === best.unfair && c.cooldownViolations < best.cooldownViolations) ||
              (c.unfair === best.unfair && c.cooldownViolations === best.cooldownViolations && c.fairness < best.fairness) ||
              (c.unfair === best.unfair && c.cooldownViolations === best.cooldownViolations && c.fairness === best.fairness && c.genderDev < best.genderDev)) {
            best = c;
          }
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

    const poolM = shuffle(playing.filter(i => genders[i] === 'M'));
    const poolF = shuffle(playing.filter(i => genders[i] === 'F'));

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
        recentCourt[i][j] = prev1Court[i][j] * 3 + prev2Court[i][j];
        recentPartner[i][j] = prev1Partner[i][j] * 5 + prev2Partner[i][j] * 2;
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

      // Proactively release MF pairs to same-gender when the unique MF
      // partner pool is running low, preventing forced repeats in later rounds.
      if (mfPairs.length >= 2) {
        let minRemainingMF = Infinity;
        for (const m of poolM) {
          let avail = 0;
          for (const f of poolF) if (partnerCount[m][f] === 0) avail++;
          if (avail < minRemainingMF) minRemainingMF = avail;
        }
        for (const f of poolF) {
          let avail = 0;
          for (const m of poolM) if (partnerCount[m][f] === 0) avail++;
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
            const shouldRelease = deficit >= minRemainingMF || Math.random() < deficit / remainingRounds;
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

  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, playCount };
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
    const neverOpp = opponentCount[m][f] === 0 ? 1 : 0;
    const recentSame = recentCourt[m][f] > 0 ? 2 : 0;
    return pw * 200 + recentSame + neverOpp;
  }

  let maxWeight = 0;
  for (let i = 0; i < nm; i++)
    for (let j = 0; j < nf; j++) {
      const w = edgeWeight(i, j);
      if (w > maxWeight) maxWeight = w;
    }
  if (maxWeight === 0) maxWeight = 1;

  const matchM = new Array(nm).fill(-1);
  const matchF = new Array(nf).fill(-1);

  function augment(u, visited, maxW) {
    for (let fj = 0; fj < nf; fj++) {
      if (visited[fj] || edgeWeight(u, fj) > maxW) continue;
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
function greedySameGenderMatch(players, partnerCount, opponentCount, recentCourt) {
  const n = players.length;
  const target = Math.floor(n / 2);
  if (target === 0) return [];

  function pairWeight(a, b) {
    const pa = players[a], pb = players[b];
    const pw = partnerCount[pa][pb];
    const neverOpp = opponentCount[pa][pb] === 0 ? 1 : 0;
    const recentSame = recentCourt[pa][pb] > 0 ? 2 : 0;
    return pw * 200 + recentSame + neverOpp;
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
    if (bestPairs) return shuffle(bestPairs);
  }

  // Greedy fallback
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      candidates.push({ a: players[i], b: players[j], weight: pairWeight(i, j), rand: Math.random() });
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
  return shuffle(result);
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
      if (maleCount === 1 || maleCount === 3) genderViolation = 1000000;
      else if (maleCount === 2 && genders[p1[0]] === genders[p1[1]]) genderViolation = 1000000;

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

      const hard = prevViolations * 1000 + genderViolation;
      const soft = oppScore * 10 - neverMetBonus * 3 + courtScore;
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
  for (const s of sorted) s.rand = Math.random();
  sorted.sort((a, b) => (a.hard - b.hard) || (a.soft - b.soft) || (a.rand - b.rand));

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

  // Co-bye diversity: how often the same pair sits out together
  let maxCoBye = 0;
  const coByeMatrix = Array.from({length: n}, () => new Array(n).fill(0));
  for (const round of result.schedule) {
    for (let i = 0; i < round.sitOuts.length; i++)
      for (let j = i + 1; j < round.sitOuts.length; j++) {
        coByeMatrix[round.sitOuts[i]][round.sitOuts[j]]++;
        coByeMatrix[round.sitOuts[j]][round.sitOuts[i]]++;
      }
    round.sitOuts.forEach(p => runningByeCount[p]++);
    const midSpread = Math.max(...runningByeCount) - Math.min(...runningByeCount);
    if (midSpread > maxMidByeSpread) maxMidByeSpread = midSpread;
  }
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
  for (let ri = 0; ri < rounds.length; ri++) {
    for (const court of rounds[ri].courts) {
      const all = [...court.teamA, ...court.teamB];
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 1 || mc === 3) genderBadCourts++;
      else if (mc === 2) {
        const teamAGenders = court.teamA.map(p => genders[p]).sort().join('');
        if (teamAGenders === 'FF' || teamAGenders === 'MM') genderBadCourts++;
      }
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

  return { genderBadCourts, byeSpread, maxMidByeSpread, maxCoBye, partnerToOpp, maxOpp, neverMet, totalOppExcess, maxPartner, totalPartnerExcess, maxCourt, totalCourtExcess };
}

function compareScores(a, b) {
  if (a.genderBadCourts !== b.genderBadCourts) return a.genderBadCourts - b.genderBadCourts;
  // Zero partner repeats is the top priority after gender
  if (a.maxPartner !== b.maxPartner) return a.maxPartner - b.maxPartner;
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

function generateBestSchedule(numPlayers, numCourts, numRounds, genders, preferMixed) {
  const timeBudgetMs = 10000;
  const start = Date.now();
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
    }
  } while (Date.now() - start < timeBudgetMs);

  return bestResult;
}

function generateBestScheduleAsync(numPlayers, numCourts, numRounds, genders, preferMixed, onProgress, onComplete) {
  const timeBudgetMs = 10000;
  const start = Date.now();
  let bestResult = null;
  let bestScore = null;
  let iterations = 0;

  function runChunk() {
    const chunkEnd = Math.min(Date.now() + 80, start + timeBudgetMs);
    while (Date.now() < chunkEnd) {
      const result = generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed);
      const score = scoreSchedule(result, numPlayers, genders);
      iterations++;
      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestScore = score;
        bestResult = result;
      }
    }
    var elapsed = Date.now() - start;
    if (onProgress) onProgress({ iterations: iterations, pct: Math.min(100, Math.round(elapsed / timeBudgetMs * 100)), score: bestScore });
    if (elapsed < timeBudgetMs) {
      setTimeout(runChunk, 0);
    } else {
      onComplete(bestResult);
    }
  }

  setTimeout(runChunk, 0);
}
