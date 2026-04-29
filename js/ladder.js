function ladderExportPDF() {
  const d = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('printDate').textContent = d.toLocaleDateString('en-US', opts);
  document.getElementById('printMode').textContent = 'Traditional Ladder';
  document.body.classList.add('print-ladder');
  const orig = document.title;
  document.title = `ladder-results-${fileDate()}`;
  window.print();
  document.title = orig;
  document.body.classList.remove('print-ladder');
}

let ladderLeaderboardData = [];

function ladderExportCSV() {
  let csv = '';

  // Leaderboard
  if (ladderLeaderboardData.length) {
    csv += 'LEADERBOARD\nRank,Player,W,L,Win %,Streak,Current Court,Highest Court,Been Pickled\n';
    ladderLeaderboardData.forEach((p, i) => {
      const pct = p.total > 0 ? (p.pct * 100).toFixed(0) + '%' : '';
      csv += `${i + 1},"${p.name}",${p.wins},${p.losses},${pct},${p.streak},${p.court},${p.highestCourt},${p.pickles}\n`;
    });
  }

  // Round history
  if (ladderState && ladderState.rounds.length > 0) {
    csv += '\nROUND HISTORY\n';
    const courtsHighToLow = [...getLadderCourts()].reverse();
    for (const round of ladderState.rounds) {
      const rNames = round.names || ladderState.names;
      csv += `\nRound ${round.round}\n`;
      csv += 'Court,Team A,Score A,Team B,Score B,Winner\n';
      for (const court of courtsHighToLow) {
        const c = round.courts[court];
        const tA = `${rNames[c.teamA[0]]} & ${rNames[c.teamA[1]]}`;
        const tB = `${rNames[c.teamB[0]]} & ${rNames[c.teamB[1]]}`;
        const winner = c.winner === 'A' ? tA : tB;
        csv += `${court},"${tA}",${c.scoreA},"${tB}",${c.scoreB},"${winner}"\n`;
      }
    }
  }

  downloadCSV(`ladder-results-${fileDate()}.csv`, csv);
}
const LADDER_STORAGE_KEY = 'powerplay_pickleball_ladder_state';

let ladderConfig = {
  numCourts: 5,
  courtNumbers: [2, 3, 7, 8, 9],
  manualAssignment: null,
};

function getLadderCourts() { return ladderConfig.courtNumbers; }
function getLadderPlayerCount() { return ladderConfig.numCourts * 4; }

function newRoundTimerState(lastDurationSec) {
  return {
    durationSec: lastDurationSec,
    startedAt: null,
    pausedRemaining: null,
    expired: false,
    lastDurationSec,
  };
}

function formatTimerMMSS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function getLadderTimerState() {
  if (!ladderState || !ladderState.roundTimer) return 'idle';
  const t = ladderState.roundTimer;
  if (t.expired) return 'expired';
  if (t.pausedRemaining !== null) return 'paused';
  if (t.startedAt !== null) return 'running';
  return 'idle';
}

function getLadderTimerRemainingSec() {
  if (!ladderState || !ladderState.roundTimer) return 0;
  const t = ladderState.roundTimer;
  if (t.expired) return 0;
  if (t.pausedRemaining !== null) return t.pausedRemaining;
  if (t.startedAt !== null) {
    return Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  }
  return t.durationSec;
}

function setLadderNumCourts(n) {
  if (n < 1 || n > 10 || isNaN(n)) return false;
  const oldN = ladderConfig.numCourts;
  if (n === oldN) return true;

  if (n < oldN) {
    const droppedNames = [];
    for (let i = n * 4; i < oldN * 4; i++) {
      const el = document.getElementById(`lp${i}`);
      if (el && el.value.trim()) droppedNames.push(el.value.trim());
    }
    if (droppedNames.length > 0) {
      const ok = confirm(
        `Reducing the court count will remove the last ${oldN * 4 - n * 4} players ` +
        `(${droppedNames.join(', ')}). Continue?`
      );
      if (!ok) {
        document.getElementById('ladderNumCourts').value = oldN;
        return false;
      }
    }
  }

  ladderConfig.numCourts = n;
  if (ladderConfig.courtNumbers.length > n) {
    ladderConfig.courtNumbers = ladderConfig.courtNumbers.slice(0, n);
  } else {
    while (ladderConfig.courtNumbers.length < n) {
      let candidate = ladderConfig.courtNumbers.length + 1;
      while (ladderConfig.courtNumbers.includes(candidate)) candidate++;
      ladderConfig.courtNumbers.push(candidate);
    }
  }
  ladderConfig.manualAssignment = null;

  buildLadderPlayerGrid();
  buildLadderCourtInputs();
  buildLadderCourtAssignments();
  const banner = document.getElementById('ladderResizeBanner');
  if (banner) banner.style.display = '';
  updateLadderSetupMessage();
  saveLadderState();
  return true;
}

function updateLadderSetupMessage() {
  const display = document.getElementById('ladderNumPlayersDisplay');
  if (display) display.textContent = `${getLadderPlayerCount()} players`;
}

function applyLadderSetupLock() {
  const locked = !!ladderState;
  const numCourtsEl = document.getElementById('ladderNumCourts');
  if (numCourtsEl) numCourtsEl.disabled = locked;
  for (let i = 0; i < ladderConfig.numCourts; i++) {
    const el = document.getElementById(`ladderCourt${i}`);
    if (el) el.disabled = locked;
  }
  const reshuffleBtn = document.getElementById('ladderReshuffleBtn');
  if (reshuffleBtn) reshuffleBtn.disabled = locked;
  const container = document.getElementById('ladderCourtAssignments');
  if (container) {
    container.classList.toggle('ladder-setup-locked', locked);
    container.querySelectorAll('.ladder-chip').forEach(chip => {
      chip.draggable = !locked;
    });
  }
}

let ladderPlayerData = [];
let ladderState = null;
let ladderTimerInterval = null;

// --- Ladder court inputs ---
function buildLadderCourtInputs() {
  const container = document.getElementById('ladderCourtInputs');
  if (!container) return;
  container.innerHTML = '';

  const courtsHighToLow = [...ladderConfig.courtNumbers].reverse();
  for (let i = 0; i < ladderConfig.numCourts; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'court-num-group';
    const label = document.createElement('span');
    label.textContent = i === 0 ? 'Top' : (i === ladderConfig.numCourts - 1 ? 'Bottom' : `#${i + 1}`);
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'court-num-input';
    input.id = `ladderCourt${i}`;
    input.min = 1; input.max = 99;
    input.value = courtsHighToLow[i];
    input.addEventListener('input', function() {
      this.classList.remove('input-error');
      const v = parseInt(this.value);
      if (!isNaN(v) && v >= 1 && v <= 99) {
        const idx = ladderConfig.numCourts - 1 - i;
        ladderConfig.courtNumbers[idx] = v;
        updateLadderSetupMessage();
        buildLadderCourtAssignments();
        saveLadderState();
      }
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

// --- Ladder player grid ---
function buildLadderPlayerGrid() {
  const titleEl = document.getElementById('ladderPlayersCardTitle');
  if (titleEl) titleEl.textContent = `Players (${getLadderPlayerCount()})`;

  const grid = document.getElementById('ladderPlayerGrid');
  grid.innerHTML = '';
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    const div = document.createElement('div');
    div.className = 'player-input';
    div.innerHTML =
      `<span class="player-num">${i + 1}.</span>` +
      `<input type="text" id="lp${i}" placeholder="Player ${i + 1}">` +
      `<div class="gender-toggle">` +
        `<input type="radio" name="lg${i}" id="lg${i}m" value="M" checked>` +
        `<label for="lg${i}m" class="g-m">M</label>` +
        `<input type="radio" name="lg${i}" id="lg${i}f" value="F">` +
        `<label for="lg${i}f" class="g-f">F</label>` +
      `</div>`;
    grid.appendChild(div);
    if (i < ladderPlayerData.length) {
      document.getElementById(`lp${i}`).value = ladderPlayerData[i].name;
      if (ladderPlayerData[i].gender === 'F') document.getElementById(`lg${i}f`).checked = true;
    }
    document.getElementById(`lp${i}`).addEventListener('input', function() {
      this.classList.remove('input-error');
      const g = guessGender(this.value);
      if (g) document.getElementById(`lg${this.id.slice(2)}${g.toLowerCase()}`).checked = true;

      // Live substitution: update current round if ladder is active
      const idx = parseInt(this.id.slice(2));
      if (ladderState && idx < ladderState.names.length) {
        const newName = this.value.trim() || `Player ${idx + 1}`;

        // Duplicate name warning
        const existingWarn = this.parentElement.querySelector('.dup-warning');
        if (existingWarn) existingWarn.remove();
        const otherNames = ladderState.names.filter((_, ni) => ni !== idx);
        if (newName && otherNames.includes(newName)) {
          this.style.outline = '2px solid #f59e0b';
          const warn = document.createElement('div');
          warn.className = 'dup-warning';
          warn.textContent = '"' + newName + '" already exists, please add a last name initial or else duplicate names will merge on the leaderboard!';
          this.parentElement.appendChild(warn);
        } else {
          this.style.outline = '';
        }

        ladderState.names[idx] = newName;
        ladderState.genders[idx] = document.getElementById(`lg${idx}f`).checked ? 'F' : 'M';
        debounce('ladderRender', () => {
          renderLadderCurrentRound();
          renderLadderLeaderboard();
        }, 180);
      }
      debounce('ladderAssignChips', () => buildLadderCourtAssignments(), 80);
      saveLadderPlayerData();
    });
    document.getElementById(`lg${i}m`).addEventListener('change', () => {
      saveLadderPlayerData();
      buildLadderCourtAssignments();
    });
    document.getElementById(`lg${i}f`).addEventListener('change', () => {
      saveLadderPlayerData();
      buildLadderCourtAssignments();
    });
  }
}

function ensureLadderAssignment() {
  const expectedSlots = getLadderPlayerCount();
  const cfg = ladderConfig.manualAssignment;
  const isValid = Array.isArray(cfg)
    && cfg.length === ladderConfig.numCourts
    && cfg.every(c => Array.isArray(c) && c.length === 4)
    && cfg.flat().slice().sort((a, b) => a - b).every((v, i) => v === i)
    && cfg.flat().length === expectedSlots;
  if (!isValid) {
    ladderConfig.manualAssignment =
      randomGenderBalancedAssignment(getLadderGenders(), ladderConfig.numCourts);
  }
}

function buildLadderCourtAssignments() {
  const container = document.getElementById('ladderCourtAssignments');
  if (!container) return;
  ensureLadderAssignment();

  container.innerHTML = '';
  const courtsHighToLow = ladderConfig.courtNumbers
    .map((num, idx) => ({ num, idx }))
    .reverse();

  const names = getLadderNames();
  const genders = getLadderGenders();

  for (const { num, idx } of courtsHighToLow) {
    const col = document.createElement('div');
    col.className = 'ladder-assignment-court';
    col.dataset.courtIdx = String(idx);

    const head = document.createElement('div');
    head.className = 'ladder-assignment-head';
    const isTop = idx === ladderConfig.numCourts - 1;
    const isBottom = idx === 0;
    const tag = isTop ? ' (Top)' : isBottom ? ' (Bottom)' : '';
    head.textContent = `Court ${num}${tag}`;
    col.appendChild(head);

    const slots = ladderConfig.manualAssignment[idx];
    for (let s = 0; s < 4; s++) {
      const pIdx = slots[s];
      const chip = document.createElement('div');
      chip.className = 'ladder-chip';
      chip.dataset.playerIdx = String(pIdx);
      chip.dataset.courtIdx = String(idx);
      chip.dataset.slotIdx = String(s);
      chip.draggable = true;

      const label = document.createElement('span');
      label.className = 'ladder-chip-name';
      label.textContent = names[pIdx] || `Player ${pIdx + 1}`;

      const badge = document.createElement('span');
      badge.className = 'ladder-chip-gender ' + (genders[pIdx] === 'F' ? 'g-f' : 'g-m');
      badge.textContent = genders[pIdx] === 'F' ? 'F' : 'M';

      chip.appendChild(label);
      chip.appendChild(badge);

      chip.addEventListener('dragstart', function(e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain',
          `${this.dataset.courtIdx}:${this.dataset.slotIdx}`);
        this.classList.add('dragging');
      });
      chip.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        document.querySelectorAll('.ladder-chip.drag-over')
          .forEach(el => el.classList.remove('drag-over'));
      });
      chip.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });
      chip.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
      });
      chip.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        const [srcCourt, srcSlot] = data.split(':').map(Number);
        const dstCourt = parseInt(this.dataset.courtIdx);
        const dstSlot = parseInt(this.dataset.slotIdx);
        if (srcCourt === dstCourt && srcSlot === dstSlot) return;
        const a = ladderConfig.manualAssignment[srcCourt][srcSlot];
        const b = ladderConfig.manualAssignment[dstCourt][dstSlot];
        ladderConfig.manualAssignment[srcCourt][srcSlot] = b;
        ladderConfig.manualAssignment[dstCourt][dstSlot] = a;
        document.getElementById('ladderResizeBanner').style.display = 'none';
        buildLadderCourtAssignments();
        saveLadderState();
      });

      col.appendChild(chip);
    }
    container.appendChild(col);
  }

  applyLadderSetupLock();
}

function getLadderNames() {
  const names = [];
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    const v = document.getElementById(`lp${i}`);
    names.push(v && v.value.trim() ? v.value.trim() : `Player ${i + 1}`);
  }
  return names;
}

function getLadderGenders() {
  const genders = [];
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    const el = document.getElementById(`lg${i}f`);
    genders.push(el && el.checked ? 'F' : 'M');
  }
  return genders;
}

function ladderFillDefaults() {
  const picks = pickRandomNames(getLadderPlayerCount());
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    document.getElementById(`lp${i}`).value = picks[i].name;
    document.getElementById(`lg${i}${picks[i].gender.toLowerCase()}`).checked = true;
  }
  ladderConfig.manualAssignment =
    randomGenderBalancedAssignment(getLadderGenders(), ladderConfig.numCourts);
  const banner = document.getElementById('ladderResizeBanner');
  if (banner) banner.style.display = 'none';
  buildLadderCourtAssignments();
  saveLadderPlayerData();
}

function ladderReset() {
  if (!confirm('Reset the ladder? All results will be cleared.')) return;
  stopLadderTimerInterval();
  clearLadderState();
  ladderState = null;
  ladderPlayerData = [];
  ladderConfig.manualAssignment = null;
  document.getElementById('ladderOutput').style.display = 'none';
  buildLadderPlayerGrid();
  buildLadderCourtInputs();
  buildLadderCourtAssignments();
  updateLadderSetupMessage();
  applyLadderSetupLock();
}

// --- Core ladder algorithms ---
function bestPairing(fourPlayers, genders, preferMixed, partnerHistory) {
  // partnerHistory = NxN matrix of partnership counts (0 = never partnered)
  // Priority: 1) minimize total repeat partnerships, 2) prefer mixed gender
  const [A, B, C, D] = fourPlayers;
  const pairings = [
    { teamA: [A, B], teamB: [C, D] },
    { teamA: [A, C], teamB: [B, D] },
    { teamA: [A, D], teamB: [B, C] },
  ];
  let bestRepeats = Infinity;
  let bestMixed = -1;
  let bestOptions = [];
  for (const p of pairings) {
    const repeats = partnerHistory[p.teamA[0]][p.teamA[1]] + partnerHistory[p.teamB[0]][p.teamB[1]];
    let mixed = 0;
    if (preferMixed) {
      if (genders[p.teamA[0]] !== genders[p.teamA[1]]) mixed++;
      if (genders[p.teamB[0]] !== genders[p.teamB[1]]) mixed++;
    }
    if (repeats < bestRepeats || (repeats === bestRepeats && mixed > bestMixed)) {
      bestRepeats = repeats;
      bestMixed = mixed;
      bestOptions = [p];
    } else if (repeats === bestRepeats && mixed === bestMixed) {
      bestOptions.push(p);
    }
  }
  return bestOptions[Math.floor(Math.random() * bestOptions.length)];
}

function newPartnerHistory() {
  return Array.from({length: getLadderPlayerCount()}, () => new Array(getLadderPlayerCount()).fill(0));
}

function randomGenderBalancedAssignment(genders, numCourts) {
  const totalSlots = numCourts * 4;
  const allIndices = Array.from({ length: totalSlots }, (_, i) => i);
  const males = shuffle(allIndices.filter(i => genders[i] === 'M'));
  const females = shuffle(allIndices.filter(i => genders[i] === 'F'));

  const courts = [];
  for (let c = 0; c < numCourts; c++) courts.push([]);

  let mi = 0, fi = 0;
  for (let c = 0; c < numCourts; c++) {
    for (let k = 0; k < 2 && fi < females.length; k++) courts[c].push(females[fi++]);
    for (let k = 0; k < 2 && mi < males.length; k++) courts[c].push(males[mi++]);
  }
  for (let c = 0; c < numCourts; c++) {
    while (courts[c].length < 4) {
      if (mi < males.length) courts[c].push(males[mi++]);
      else if (fi < females.length) courts[c].push(females[fi++]);
      else break;
    }
  }
  return courts; // index 0 = lowest court, last = highest
}

function pairTeamsForAssignment(courtSlots, courtNumbers, genders, preferMixed, partnerHistory) {
  const courtPlayers = {};
  const courtTeams = {};
  for (let c = 0; c < courtNumbers.length; c++) {
    const court = courtNumbers[c];
    courtPlayers[court] = courtSlots[c];
    courtTeams[court] = bestPairing(courtSlots[c], genders, preferMixed, partnerHistory);
  }
  return { courtPlayers, courtTeams };
}

function ladderProcessMovement(scores, courtTeams, genders, preferMixed, partnerHistory) {
  const courtResults = {};
  for (const court of getLadderCourts()) {
    const teams = courtTeams[court];
    if (scores[court].scoreA > scores[court].scoreB) {
      courtResults[court] = { winners: teams.teamA, losers: teams.teamB };
    } else {
      courtResults[court] = { winners: teams.teamB, losers: teams.teamA };
    }
  }

  // Record this round's partnerships in the history matrix
  for (const court of getLadderCourts()) {
    const t = courtTeams[court];
    partnerHistory[t.teamA[0]][t.teamA[1]]++;
    partnerHistory[t.teamA[1]][t.teamA[0]]++;
    partnerHistory[t.teamB[0]][t.teamB[1]]++;
    partnerHistory[t.teamB[1]][t.teamB[0]]++;
  }

  // Movement: winners UP, losers DOWN
  const newCourtPlayers = {};
  getLadderCourts().forEach(c => { newCourtPlayers[c] = []; });
  const movements = {};

  for (let ci = 0; ci < getLadderCourts().length; ci++) {
    const court = getLadderCourts()[ci];
    const { winners, losers } = courtResults[court];

    if (ci < getLadderCourts().length - 1) {
      const dest = getLadderCourts()[ci + 1];
      winners.forEach(p => { newCourtPlayers[dest].push(p); movements[p] = { from: court, to: dest, dir: 'up' }; });
    } else {
      winners.forEach(p => { newCourtPlayers[court].push(p); movements[p] = { from: court, to: court, dir: 'stay' }; });
    }

    if (ci > 0) {
      const dest = getLadderCourts()[ci - 1];
      losers.forEach(p => { newCourtPlayers[dest].push(p); movements[p] = { from: court, to: dest, dir: 'down' }; });
    } else {
      losers.forEach(p => { newCourtPlayers[court].push(p); movements[p] = { from: court, to: court, dir: 'stay' }; });
    }
  }

  // Re-pair at each court using full partnership history
  const newTeams = {};
  for (const court of getLadderCourts()) {
    newTeams[court] = bestPairing(newCourtPlayers[court], genders, preferMixed, partnerHistory);
  }

  return { newCourtPlayers, newTeams, movements, courtResults };
}

// --- Ladder start / validation ---
function ladderValidate() {
  const names = getLadderNames();
  const errors = [];
  let emptyCount = 0;
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    if (!document.getElementById(`lp${i}`).value.trim()) emptyCount++;
  }
  if (emptyCount > 0) errors.push(`${emptyCount} player name${emptyCount > 1 ? 's are' : ' is'} empty`);

  const seen = {};
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    const lower = names[i].toLowerCase();
    if (seen[lower] !== undefined) {
      errors.push(`"${esc(names[i])}" appears more than once — add a last name initial`);
    }
    seen[lower] = i;
  }

  const courtVals = [];
  for (let i = 0; i < ladderConfig.numCourts; i++) {
    const el = document.getElementById(`ladderCourt${i}`);
    if (!el) continue;
    const v = parseInt(el.value);
    if (!el.value.trim() || isNaN(v) || v < 1 || v > 99) {
      el.classList.add('input-error');
      errors.push(`Court ${i + 1} must be a number between 1 and 99`);
    }
    courtVals.push(el.value.trim());
  }
  for (let i = 0; i < courtVals.length; i++) {
    for (let j = i + 1; j < courtVals.length; j++) {
      if (courtVals[i] && courtVals[j] && courtVals[i] === courtVals[j]) {
        const a = document.getElementById(`ladderCourt${i}`);
        const b = document.getElementById(`ladderCourt${j}`);
        if (a) a.classList.add('input-error');
        if (b) b.classList.add('input-error');
        errors.push(`Duplicate court number: ${courtVals[i]}`);
      }
    }
  }

  return errors;
}

function ladderStart() {
  const errors = ladderValidate();
  const banner = document.getElementById('ladderErrorBanner');
  if (errors.length > 0) {
    const unique = [...new Set(errors)];
    banner.innerHTML = unique.length === 1 ? unique[0] : '<ul>' + unique.map(e => `<li>${e}</li>`).join('') + '</ul>';
    banner.style.display = 'block';
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  banner.style.display = 'none';

  const names = getLadderNames();
  const genders = getLadderGenders();
  const preferMixed = true;
  const partnerHistory = newPartnerHistory();
  const courtSlots = ladderConfig.manualAssignment
    ? ladderConfig.manualAssignment.map(arr => [...arr])
    : randomGenderBalancedAssignment(genders, ladderConfig.numCourts);
  const { courtPlayers, courtTeams } =
    pairTeamsForAssignment(courtSlots, ladderConfig.courtNumbers, genders, preferMixed, partnerHistory);

  ladderState = {
    round: 1,
    names,
    genders,
    preferMixed,
    courtPlayers,
    courtTeams,
    partnerHistory,
    rounds: [],
    playerWins: new Array(getLadderPlayerCount()).fill(0),
    playerLosses: new Array(getLadderPlayerCount()).fill(0),
    roundTimer: newRoundTimerState(600),
  };

  document.getElementById('ladderOutput').style.display = 'block';
  renderLadderCurrentRound();
  renderLadderLeaderboard();
  renderLadderHistory();
  saveLadderState();
  applyLadderSetupLock();
  document.getElementById('ladderCurrentRound').scrollIntoView({ behavior: 'smooth' });
}

// --- Ladder rendering ---
function stopLadderTimerInterval() {
  if (ladderTimerInterval !== null) {
    clearInterval(ladderTimerInterval);
    ladderTimerInterval = null;
  }
}

function startLadderTimerInterval() {
  stopLadderTimerInterval();
  ladderTimerInterval = setInterval(tickLadderTimer, 500);
}

function tickLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) {
    stopLadderTimerInterval();
    return;
  }
  const t = ladderState.roundTimer;
  if (t.startedAt === null) {
    stopLadderTimerInterval();
    return;
  }
  const remaining = t.durationSec - (Date.now() - t.startedAt) / 1000;
  const display = document.getElementById('roundTimerDisplay');
  if (display) display.textContent = formatTimerMMSS(remaining);
  if (remaining <= 0) {
    expireLadderTimer();
  }
}

function startLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const input = document.getElementById('roundTimerMinutes');
  const minutes = parseInt(input && input.value);
  if (isNaN(minutes) || minutes < 1 || minutes > 60) {
    if (input) {
      input.classList.add('input-error');
      setTimeout(() => input.classList.remove('input-error'), 1200);
    }
    return;
  }
  const seconds = minutes * 60;
  ladderState.roundTimer.durationSec = seconds;
  ladderState.roundTimer.lastDurationSec = seconds;
  ladderState.roundTimer.startedAt = Date.now();
  ladderState.roundTimer.pausedRemaining = null;
  ladderState.roundTimer.expired = false;
  renderLadderRoundTimer();
  startLadderTimerInterval();
  saveLadderState();
}

function pauseLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.startedAt === null) return;
  const remaining = Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  t.pausedRemaining = remaining;
  t.startedAt = null;
  stopLadderTimerInterval();
  renderLadderRoundTimer();
  saveLadderState();
}

function resumeLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.pausedRemaining === null) return;
  t.durationSec = t.pausedRemaining;
  t.startedAt = Date.now();
  t.pausedRemaining = null;
  renderLadderRoundTimer();
  startLadderTimerInterval();
  saveLadderState();
}

function resetLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  stopLadderTimerInterval();
  const last = ladderState.roundTimer.lastDurationSec || 600;
  ladderState.roundTimer = newRoundTimerState(last);
  renderLadderRoundTimer();
  saveLadderState();
}

function expireLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  t.expired = true;
  t.startedAt = null;
  t.pausedRemaining = null;
  stopLadderTimerInterval();
  renderLadderRoundTimer();
  saveLadderState();
}

function resumeLadderTimerOnRestore() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.expired) return;
  if (t.pausedRemaining !== null) return;
  if (t.startedAt !== null) {
    const remaining = t.durationSec - (Date.now() - t.startedAt) / 1000;
    if (remaining <= 0) {
      t.expired = true;
      t.startedAt = null;
      t.pausedRemaining = null;
      saveLadderState();
      return;
    }
    startLadderTimerInterval();
  }
}

function renderLadderRoundTimer() {
  const container = document.getElementById('ladderRoundTimer');
  if (!container || !ladderState || !ladderState.roundTimer) {
    if (container) container.innerHTML = '';
    return;
  }
  const t = ladderState.roundTimer;
  const state = getLadderTimerState();
  const remaining = getLadderTimerRemainingSec();
  const lastMin = Math.max(1, Math.round(t.lastDurationSec / 60));

  let html = `<div class="round-timer round-timer-${state}">`;

  if (state === 'idle') {
    html += `
      <span class="round-timer-label">Round Timer</span>
      <input type="number" class="round-timer-input" id="roundTimerMinutes"
             min="1" max="60" value="${lastMin}">
      <span class="round-timer-unit">min</span>
      <button class="btn-timer btn-timer-start" id="roundTimerStartBtn" type="button">Start</button>`;
  } else {
    const display = formatTimerMMSS(remaining);
    html += `<span class="round-timer-label">Round Timer</span>
      <span class="round-timer-display" id="roundTimerDisplay">${display}</span>`;
    if (state === 'paused') html += `<span class="round-timer-tag">paused</span>`;
    if (state === 'running') {
      html += `<button class="btn-timer btn-timer-pause" id="roundTimerPauseBtn" type="button">Pause</button>`;
    } else if (state === 'paused') {
      html += `<button class="btn-timer btn-timer-resume" id="roundTimerResumeBtn" type="button">Resume</button>`;
    }
    html += `<button class="btn-timer btn-timer-reset" id="roundTimerResetBtn" type="button">Reset</button>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  const startBtn = document.getElementById('roundTimerStartBtn');
  if (startBtn) startBtn.addEventListener('click', startLadderTimer);
  const pauseBtn = document.getElementById('roundTimerPauseBtn');
  if (pauseBtn) pauseBtn.addEventListener('click', pauseLadderTimer);
  const resumeBtn = document.getElementById('roundTimerResumeBtn');
  if (resumeBtn) resumeBtn.addEventListener('click', resumeLadderTimer);
  const resetBtn = document.getElementById('roundTimerResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetLadderTimer);

  const minutesInput = document.getElementById('roundTimerMinutes');
  if (minutesInput) {
    minutesInput.addEventListener('input', function() { this.classList.remove('input-error'); });
    minutesInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); startLadderTimer(); }
    });
  }
}

function renderLadderCurrentRound() {
  const container = document.getElementById('ladderCurrentRound');
  if (!ladderState) { container.innerHTML = ''; return; }

  const { round, courtTeams, names } = ladderState;
  const courtsHighToLow = [...getLadderCourts()].reverse();

  let html = `<div class="card">
    <div class="schedule-header"><h2>Round ${round}</h2></div>
    <div class="current-round-banner">
      <span class="current-round-dot"></span>
      <span class="current-round-text">Enter scores and click <span>"Complete Round"</span></span>
      <span class="current-round-timer-slot" id="ladderRoundTimer"></span>
    </div>
    <div class="ladder-courts">`;

  for (const court of courtsHighToLow) {
    const teams = courtTeams[court];
    const label = court === getLadderCourts()[getLadderCourts().length - 1] ? `Court ${court} (Top)`
                : court === getLadderCourts()[0] ? `Court ${court} (Bottom)`
                : `Court ${court}`;
    const cls = court === getLadderCourts()[getLadderCourts().length - 1] ? 'ladder-court court-highest'
              : court === getLadderCourts()[0] ? 'ladder-court court-lowest'
              : 'ladder-court';

    html += `<div class="${cls}" id="lc${court}">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.6rem;">
        <div class="court-label" style="margin-bottom:0;">${label}</div>
        <button class="btn-swap" onclick="ladderSwapPartners(${court})">Mix Partners (if necessary)</button>
      </div>
      <div class="ladder-matchup">
        <div class="ladder-score-group">
          <span class="team team-a" id="lt${court}a">${esc(names[teams.teamA[0]])} &amp; ${esc(names[teams.teamA[1]])}</span>
          <input type="number" class="ladder-score-input" id="ls${court}a" min="0" max="11" placeholder="0" inputmode="numeric" pattern="[0-9]*" onkeydown="return(event.key.length>1||/[0-9]/.test(event.key))">
        </div>
        <span class="vs">vs</span>
        <div class="ladder-score-group">
          <span class="team team-b" id="lt${court}b">${esc(names[teams.teamB[0]])} &amp; ${esc(names[teams.teamB[1]])}</span>
          <input type="number" class="ladder-score-input" id="ls${court}b" min="0" max="11" placeholder="0" inputmode="numeric" pattern="[0-9]*" onkeydown="return(event.key.length>1||/[0-9]/.test(event.key))">
        </div>
      </div>
      <button class="btn-early" id="early${court}" onclick="ladderCompleteEarly(${court})" style="display:none;">Complete Game Early</button>
    </div>`;
  }

  html += `</div>
    <div class="controls" style="margin-top:1.25rem;">
      <div class="spacer"></div>
      <button class="btn btn-primary" onclick="ladderCompleteRound()">Complete Round</button>
    </div></div>`;

  container.innerHTML = html;

  // Wire up live score checking on each court
  for (const court of getLadderCourts()) {
    const handler = () => checkLadderCourtScore(court);
    document.getElementById(`ls${court}a`).addEventListener('input', handler);
    document.getElementById(`ls${court}b`).addEventListener('input', handler);
  }

  renderLadderRoundTimer();
}

function isValidPickleballResult(scoreA, scoreB) {
  if (isNaN(scoreA) || isNaN(scoreB)) return null;
  if (scoreA === scoreB) return null; // tied
  // Play to 11, win by 1: winner must have exactly 11, loser 0-10
  if (scoreA === 11 && scoreB >= 0 && scoreB <= 10) return 'A';
  if (scoreB === 11 && scoreA >= 0 && scoreA <= 10) return 'B';
  return null;
}

function scoreError(sa, sb) {
  if (isNaN(sa) || isNaN(sb)) return null;
  if (sa < 0 || sb < 0) return 'Scores cannot be negative';
  if (sa === sb) return 'Scores cannot be tied';
  if (sa > 11 || sb > 11) return 'Max score is 11';
  const hi = Math.max(sa, sb);
  if (hi === 11) return null; // valid result
  if (hi > 0 && hi < 11 && sa !== sb) return null; // game in progress, no error yet
  return null;
}

function ladderSwapPartners(court) {
  if (!ladderState) return;
  const [A, B, C, D] = ladderState.courtPlayers[court];
  const pairings = [
    { teamA: [A, B], teamB: [C, D] },
    { teamA: [A, C], teamB: [B, D] },
    { teamA: [A, D], teamB: [B, C] },
  ];
  const cur = ladderState.courtTeams[court];
  const curKey = Math.min(cur.teamA[0], cur.teamA[1]) + '-' + Math.max(cur.teamA[0], cur.teamA[1]);
  let idx = pairings.findIndex(p => Math.min(p.teamA[0], p.teamA[1]) + '-' + Math.max(p.teamA[0], p.teamA[1]) === curKey);
  idx = (idx + 1) % 3;
  ladderState.courtTeams[court] = pairings[idx];

  const { names } = ladderState;
  const t = pairings[idx];
  document.getElementById(`lt${court}a`).innerHTML = `${esc(names[t.teamA[0]])} &amp; ${esc(names[t.teamA[1]])}`;
  document.getElementById(`lt${court}b`).innerHTML = `${esc(names[t.teamB[0]])} &amp; ${esc(names[t.teamB[1]])}`;
  checkLadderCourtScore(court);
  saveLadderState();
}

function checkLadderCourtScore(court) {
  const saEl = document.getElementById(`ls${court}a`);
  const sbEl = document.getElementById(`ls${court}b`);
  const sa = parseInt(saEl.value);
  const sb = parseInt(sbEl.value);
  const courtEl = document.getElementById(`lc${court}`);
  const teamAEl = document.getElementById(`lt${court}a`);
  const teamBEl = document.getElementById(`lt${court}b`);

  // Remove previous error
  let errEl = courtEl.querySelector('.ladder-score-error');
  if (errEl) errEl.remove();
  saEl.classList.remove('input-error');
  sbEl.classList.remove('input-error');

  const winner = isValidPickleballResult(sa, sb);
  const err = scoreError(sa, sb);

  // Show error if both fields have values and the combination is invalid
  if (err && saEl.value !== '' && sbEl.value !== '') {
    saEl.classList.add('input-error');
    sbEl.classList.add('input-error');
    const msg = document.createElement('div');
    msg.className = 'ladder-score-error';
    msg.textContent = err;
    courtEl.appendChild(msg);
  }

  // Determine if early completion is possible (both entered, one higher, but not valid pickleball)
  const earlyBtn = document.getElementById(`early${court}`);
  const bothEntered = saEl.value !== '' && sbEl.value !== '' && !isNaN(sa) && !isNaN(sb) && sa >= 0 && sb >= 0;
  const hasLeader = bothEntered && sa !== sb;
  const earlyEligible = hasLeader && winner === null;
  const earlyActive = courtEl.dataset.earlyDone === 'true';
  earlyBtn.style.display = (earlyEligible || earlyActive) ? '' : 'none';

  const earlyDone = courtEl.dataset.earlyDone === 'true';
  const resolved = winner !== null || earlyDone;
  const effectiveWinner = winner || (earlyDone ? (sa > sb ? 'A' : 'B') : null);

  courtEl.classList.toggle('court-done', resolved);
  teamAEl.classList.toggle('ladder-winner', effectiveWinner === 'A');
  teamAEl.classList.toggle('ladder-loser', effectiveWinner === 'B');
  teamBEl.classList.toggle('ladder-winner', effectiveWinner === 'B');
  teamBEl.classList.toggle('ladder-loser', effectiveWinner === 'A');
}

function ladderCompleteEarly(court) {
  const courtEl = document.getElementById(`lc${court}`);
  const btn = document.getElementById(`early${court}`);
  if (courtEl.dataset.earlyDone === 'true') {
    courtEl.dataset.earlyDone = '';
    btn.textContent = 'Complete Game Early';
    btn.classList.remove('btn-early-active');
  } else {
    courtEl.dataset.earlyDone = 'true';
    btn.textContent = 'Undo Early Completion';
    btn.classList.add('btn-early-active');
  }
  checkLadderCourtScore(court);
}

function ladderCompleteRound() {
  const scores = {};
  let valid = true;

  for (const court of getLadderCourts()) {
    const saEl = document.getElementById(`ls${court}a`);
    const sbEl = document.getElementById(`ls${court}b`);
    const sa = parseInt(saEl.value);
    const sb = parseInt(sbEl.value);
    const courtEl = document.getElementById(`lc${court}`);
    const earlyDone = courtEl.dataset.earlyDone === 'true';

    if (earlyDone) {
      // Early-completed: just need one team ahead
      if (isNaN(sa) || isNaN(sb) || sa === sb) {
        saEl.classList.add('input-error');
        sbEl.classList.add('input-error');
        valid = false;
      } else {
        saEl.classList.remove('input-error');
        sbEl.classList.remove('input-error');
        scores[court] = { scoreA: sa, scoreB: sb };
      }
    } else {
      const winner = isValidPickleballResult(sa, sb);
      if (winner === null) {
        saEl.classList.add('input-error');
        sbEl.classList.add('input-error');
        valid = false;
      } else {
        saEl.classList.remove('input-error');
        sbEl.classList.remove('input-error');
        scores[court] = { scoreA: sa, scoreB: sb };
      }
    }
  }

  if (!valid) {
    alert('Please enter valid scores for all courts (play to 11, win by 1 — or use "Complete Game Early").');
    return;
  }

  const { newCourtPlayers, newTeams, movements, courtResults } =
    ladderProcessMovement(scores, ladderState.courtTeams, ladderState.genders, ladderState.preferMixed, ladderState.partnerHistory);

  // Record round (snapshot names for substitution support)
  const roundRecord = { round: ladderState.round, names: [...ladderState.names], courts: {} };
  for (const court of getLadderCourts()) {
    const t = ladderState.courtTeams[court];
    roundRecord.courts[court] = {
      teamA: t.teamA, teamB: t.teamB,
      scoreA: scores[court].scoreA, scoreB: scores[court].scoreB,
      winner: courtResults[court].winners === t.teamA ? 'A' : 'B',
    };
  }

  // Update stats
  for (const court of getLadderCourts()) {
    courtResults[court].winners.forEach(p => ladderState.playerWins[p]++);
    courtResults[court].losers.forEach(p => ladderState.playerLosses[p]++);
  }

  ladderState.rounds.push(roundRecord);
  ladderState.round++;
  ladderState.courtPlayers = newCourtPlayers;
  ladderState.courtTeams = newTeams;

  const lastDuration = (ladderState.roundTimer && ladderState.roundTimer.lastDurationSec) || 600;
  stopLadderTimerInterval();
  ladderState.roundTimer = newRoundTimerState(lastDuration);

  renderLadderCurrentRound();
  renderLadderLeaderboard();
  renderLadderHistory();
  saveLadderState();
  document.getElementById('ladderCurrentRound').scrollIntoView({ behavior: 'smooth' });
}

function renderLadderLeaderboard() {
  const section = document.getElementById('ladderLeaderboardSection');
  if (!ladderState) { section.innerHTML = ''; return; }

  // Build stats from round history using per-round names (supports substitutions)
  const identityStats = {}; // "slotIdx:name" -> stats object
  const init = (key, name) => {
    if (!identityStats[key]) identityStats[key] = {
      name, slot: parseInt(key), wins: 0, losses: 0, pickles: 0,
      highestCourt: 0, results: [], // results: ordered list of 'W'/'L' for streak calc
    };
  };

  for (const round of ladderState.rounds) {
    const rNames = round.names || ladderState.names;
    for (const court of getLadderCourts()) {
      const c = round.courts[court];
      const winTeam = c.winner === 'A' ? c.teamA : c.teamB;
      const loseTeam = c.winner === 'A' ? c.teamB : c.teamA;
      const loseScore = c.winner === 'A' ? c.scoreB : c.scoreA;
      winTeam.forEach(p => {
        const key = p + ':' + rNames[p];
        init(key, rNames[p]);
        const s = identityStats[key];
        s.wins++;
        if (court > s.highestCourt) s.highestCourt = court;
        s.results.push('W');
      });
      loseTeam.forEach(p => {
        const key = p + ':' + rNames[p];
        init(key, rNames[p]);
        const s = identityStats[key];
        s.losses++;
        if (loseScore === 0) s.pickles++;
        if (court > s.highestCourt) s.highestCourt = court;
        s.results.push('L');
      });
    }
  }

  // Determine current court from live state
  const currentCourt = {};
  for (const court of getLadderCourts()) {
    if (ladderState.courtPlayers[court]) {
      ladderState.courtPlayers[court].forEach(p => { currentCourt[p] = court; });
    }
  }

  const players = Object.values(identityStats).map(s => {
    // Compute streak from end of results array
    let streak = '';
    if (s.results.length > 0) {
      const last = s.results[s.results.length - 1];
      let count = 0;
      for (let i = s.results.length - 1; i >= 0 && s.results[i] === last; i--) count++;
      streak = last + count;
    }
    return {
      name: s.name, wins: s.wins, losses: s.losses,
      total: s.wins + s.losses,
      pct: (s.wins + s.losses) > 0 ? s.wins / (s.wins + s.losses) : 0,
      court: currentCourt[s.slot] || '\u2014',
      streak,
      highestCourt: s.highestCourt,
      pickles: s.pickles,
    };
  });
  players.sort((a, b) => b.pct - a.pct || b.wins - a.wins || a.losses - b.losses);

  const totalGames = players.reduce((a, p) => a + p.wins, 0);
  if (totalGames === 0) {
    section.innerHTML = `<div class="leaderboard"><h2>Leaderboard</h2>
      <div class="card" style="text-align:center;padding:2rem;">
        <span style="color:#4b5c72;font-size:0.85rem;">Complete a round to populate the leaderboard</span>
      </div></div>`;
    return;
  }

  ladderLeaderboardData = players;

  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  let html = '<div class="leaderboard"><div class="schedule-header"><h2>Leaderboard</h2><button class="btn-export-pdf" onclick="ladderExportPDF()">Export PDF</button><button class="btn-export-csv" onclick="ladderExportCSV()">Export CSV</button></div>';
  html += '<table class="leaderboard-table"><thead><tr>';
  html += '<th>Player</th><th>W</th><th>L</th><th>Win %</th><th>Streak</th><th>Current Court</th><th>Highest Court</th><th>Been Pickled</th><th class="lb-bar-cell"></th>';
  html += '</tr></thead><tbody>';

  players.forEach((p, idx) => {
    const pct = p.total > 0 ? (p.pct * 100).toFixed(0) : '\u2014';
    const wPct = p.total > 0 ? (p.wins / p.total * 100).toFixed(1) : 0;
    const lPct = p.total > 0 ? (p.losses / p.total * 100).toFixed(1) : 0;
    const medal = idx < 3 && p.total > 0 ? `<span class="lb-medal">${medals[idx]}</span>` : '';
    const streakClass = p.streak.startsWith('W') ? 'lb-streak-w' : p.streak.startsWith('L') ? 'lb-streak-l' : '';
    html += `<tr>
      <td>${medal}<span class="lb-rank">${idx + 1}.</span><span class="lb-name">${esc(p.name)}</span></td>
      <td class="lb-wins">${p.wins}</td>
      <td class="lb-losses">${p.losses}</td>
      <td class="lb-pct">${p.total > 0 ? pct + '%' : '<span class="lb-empty">\u2014</span>'}</td>
      <td class="${streakClass}">${p.streak || '\u2014'}</td>
      <td class="lb-court">${p.court}</td>
      <td class="lb-best">${p.highestCourt || '\u2014'}</td>
      <td class="lb-pickles">${p.pickles > 0 ? p.pickles : '<span class="lb-empty">\u2014</span>'}</td>
      <td class="lb-bar-cell"><div class="lb-bar">
        <div class="lb-bar-w" style="width:${wPct}%"></div>
        <div class="lb-bar-l" style="width:${lPct}%"></div>
      </div></td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  section.innerHTML = html;
}

function renderLadderHistory() {
  const section = document.getElementById('ladderHistorySection');
  if (!ladderState || ladderState.rounds.length === 0) { section.innerHTML = ''; return; }

  const courtsHighToLow = [...getLadderCourts()].reverse();

  let html = '<div class="card ladder-history-card"><h2 class="ladder-history-heading">Round History</h2>';

  for (let ri = ladderState.rounds.length - 1; ri >= 0; ri--) {
    const round = ladderState.rounds[ri];
    const rNames = round.names || ladderState.names; // use snapshot, fallback for old data
    html += `<div class="round ladder-history-round">
      <div class="round-header"><span class="round-title">Round ${round.round}</span></div>
      <div class="courts">`;

    for (const court of courtsHighToLow) {
      const c = round.courts[court];
      html += `<div class="court">
        <div class="court-label">Court ${court}</div>
        <div class="matchup">
          <span class="team team-a ${c.winner === 'A' ? 'winner' : 'loser'}">${esc(rNames[c.teamA[0]])} &amp; ${esc(rNames[c.teamA[1]])} <small>(${c.scoreA})</small></span>
          <span class="vs">vs</span>
          <span class="team team-b ${c.winner === 'B' ? 'winner' : 'loser'}">${esc(rNames[c.teamB[0]])} &amp; ${esc(rNames[c.teamB[1]])} <small>(${c.scoreB})</small></span>
        </div>
      </div>`;
    }
    html += '</div></div>';
  }
  html += '</div>';
  section.innerHTML = html;
}

// --- Ladder persistence ---
function saveLadderPlayerData() {
  ladderPlayerData = [];
  for (let i = 0; i < getLadderPlayerCount(); i++) {
    const el = document.getElementById(`lp${i}`);
    const gf = document.getElementById(`lg${i}f`);
    if (el) ladderPlayerData.push({ name: el.value, gender: gf && gf.checked ? 'F' : 'M' });
  }
  saveLadderState();
}

function saveLadderState() {
  const state = {
    ladderPlayerData,
    ladderConfig: {
      numCourts: ladderConfig.numCourts,
      courtNumbers: [...ladderConfig.courtNumbers],
      manualAssignment: ladderConfig.manualAssignment
        ? ladderConfig.manualAssignment.map(arr => [...arr])
        : null,
    },
    preferMixed: true,
    ladderState: ladderState ? { ...ladderState } : null,
    mode: document.getElementById('modeLadder').checked ? 'ladder' : 'rr',
  };
  try { localStorage.setItem(LADDER_STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreLadderState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(LADDER_STORAGE_KEY)); } catch(e) {}
  if (!state) return;

  ladderPlayerData = state.ladderPlayerData || [];
  const ma = state.ladderConfig && state.ladderConfig.manualAssignment;
  const maValid = ma == null || (Array.isArray(ma) && ma.every(row => Array.isArray(row)));
  if (state.ladderConfig
      && typeof state.ladderConfig.numCourts === 'number'
      && Array.isArray(state.ladderConfig.courtNumbers)
      && state.ladderConfig.numCourts >= 1
      && state.ladderConfig.numCourts <= 10
      && state.ladderConfig.courtNumbers.length === state.ladderConfig.numCourts
      && maValid) {
    ladderConfig = {
      numCourts: state.ladderConfig.numCourts,
      courtNumbers: [...state.ladderConfig.courtNumbers],
      manualAssignment: Array.isArray(ma) ? ma.map(arr => [...arr]) : null,
    };
  }
  if (state.ladderState) {
    ladderState = state.ladderState;
    if (!ladderState.roundTimer) {
      ladderState.roundTimer = newRoundTimerState(600);
    }
  }

  if (state.mode === 'ladder') {
    document.getElementById('modeLadder').checked = true;
    setMode('ladder');
    document.getElementById('ladderNumCourts').value = ladderConfig.numCourts;
    buildLadderPlayerGrid();
    buildLadderCourtInputs();
    buildLadderCourtAssignments();
    updateLadderSetupMessage();
    if (ladderState) {
      document.getElementById('ladderOutput').style.display = 'block';
      renderLadderCurrentRound();
      renderLadderLeaderboard();
      renderLadderHistory();
      resumeLadderTimerOnRestore();
    }
  }
  applyLadderSetupLock();
}

function clearLadderState() {
  try { localStorage.removeItem(LADDER_STORAGE_KEY); } catch(e) {}
}

(function initLadderSetupInputs() {
  const numCourtsEl = document.getElementById('ladderNumCourts');
  if (numCourtsEl) {
    numCourtsEl.addEventListener('input', function() {
      this.classList.remove('input-error');
      const v = parseInt(this.value);
      if (!isNaN(v) && v >= 1 && v <= 10) setLadderNumCourts(v);
    });
  }

  const reshuffleBtn = document.getElementById('ladderReshuffleBtn');
  if (reshuffleBtn) {
    reshuffleBtn.addEventListener('click', function() {
      ladderConfig.manualAssignment =
        randomGenderBalancedAssignment(getLadderGenders(), ladderConfig.numCourts);
      document.getElementById('ladderResizeBanner').style.display = 'none';
      buildLadderCourtAssignments();
      saveLadderState();
    });
  }
})();
