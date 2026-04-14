// --- State variables (declared early for restore) ---
let totalRounds = 0;
let numCourtsInSchedule = 0;
let roundWinners = {};
let scheduleData = null;
let scheduleNames = null;
let roundNamesMap = {};  // roundNumber -> [...names], for per-round substitution tracking
let scheduleCourtNames = [];
let lastFullResult = null;

// --- Dynamic grid builders ---
let currentPlayerCount = 15;
let currentCourtCount = 3;

// Stores current values so they survive rebuilds
let playerData = []; // [{name, gender}]
let courtData = [];  // [number]

function buildPlayerGrid(count, skipSave) {
  const grid = document.getElementById('playerGrid');
  if (!skipSave) savePlayerData();
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'player-input';
    div.innerHTML = `<span class="player-num">${i + 1}.</span><input type="text" id="p${i}" placeholder="Player ${i + 1}">` +
      `<div class="gender-toggle">` +
      `<input type="radio" name="g${i}" id="g${i}m" value="M" checked>` +
      `<label for="g${i}m" class="g-m">M</label>` +
      `<input type="radio" name="g${i}" id="g${i}f" value="F">` +
      `<label for="g${i}f" class="g-f">F</label>` +
      `</div>`;
    grid.appendChild(div);
    // Restore saved data
    if (i < playerData.length) {
      document.getElementById(`p${i}`).value = playerData[i].name;
      if (playerData[i].gender === 'F') document.getElementById(`g${i}f`).checked = true;
    }
    document.getElementById(`p${i}`).addEventListener('input', function() {
      this.classList.remove('input-error');
      const g = guessGender(this.value);
      const idx = parseInt(this.id.slice(1));
      const toggle = this.parentElement.querySelector('.gender-toggle');
      if (g) {
        document.getElementById(`g${idx}${g.toLowerCase()}`).checked = true;
        toggle.classList.remove('gender-undetected');
        const hint = this.parentElement.querySelector('.gender-hint');
        if (hint) hint.remove();
        checkGenderWarning();
      } else if (this.value.trim()) {
        toggle.classList.add('gender-undetected');
        if (!this.parentElement.querySelector('.gender-hint')) {
          const hint = document.createElement('div');
          hint.className = 'gender-hint';
          hint.textContent = 'Gender not auto-detected — please verify M/F toggle';
          this.parentElement.appendChild(hint);
        }
      } else {
        toggle.classList.remove('gender-undetected');
        const hint = this.parentElement.querySelector('.gender-hint');
        if (hint) hint.remove();
      }
      // Live-update schedule if one exists (substitution: only current + future rounds)
      if (scheduleNames && idx < scheduleNames.length) {
        const newName = this.value || `Player ${idx + 1}`;
        // Warn if duplicate name exists (check all round names + current player inputs)
        const allNames = [];
        for (let r = 1; r <= totalRounds; r++) {
          const rn = roundNamesMap[r] || scheduleNames;
          rn.forEach((n, i) => { if (i !== idx) allNames.push(n); });
        }
        // Remove any existing warning
        const existingWarn = this.parentElement.querySelector('.dup-warning');
        if (existingWarn) existingWarn.remove();
        if (newName && allNames.includes(newName)) {
          this.style.outline = '2px solid #f59e0b';
          const warn = document.createElement('div');
          warn.className = 'dup-warning';
          warn.textContent = '"' + newName + '" already exists, please add a last name initial or else duplicate names will merge on the leaderboard!';
          this.parentElement.appendChild(warn);
        } else {
          this.style.outline = '';
        }
        scheduleNames[idx] = newName;
        // Find current round (first incomplete)
        let curRound = totalRounds + 1;
        for (let r = 1; r <= totalRounds; r++) {
          if (!isRoundComplete(r)) { curRound = r; break; }
        }
        // Update only current and future rounds in roundNamesMap
        for (let r = curRound; r <= totalRounds; r++) {
          if (!roundNamesMap[r]) roundNamesMap[r] = [...scheduleNames];
          roundNamesMap[r][idx] = newName;
        }
        debounce('scheduleRender', () => {
          renderSchedule({ schedule: scheduleData }, scheduleNames, scheduleCourtNames, true);
          if (lastFullResult) renderStats(lastFullResult, scheduleNames);
        }, 180);
      }
      saveState();
    });
    // Save on gender toggle change; dismiss undetected hint on manual toggle
    const dismissHint = function() {
      const pi = this.name.slice(1);
      const row = document.getElementById(`p${pi}`).parentElement;
      const toggle = row.querySelector('.gender-toggle');
      toggle.classList.remove('gender-undetected');
      const hint = row.querySelector('.gender-hint');
      if (hint) hint.remove();
      saveState();
      checkGenderWarning();
    };
    document.getElementById(`g${i}m`).addEventListener('change', dismissHint);
    document.getElementById(`g${i}f`).addEventListener('change', dismissHint);
  }
  currentPlayerCount = count;
}

function buildCourtInputs(count, skipSave) {
  const container = document.getElementById('courtInputs');
  if (!skipSave) saveCourtData();
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const input = document.createElement('input');
    input.type = 'number'; input.className = 'court-num-input';
    input.id = `court${i}`; input.min = 1; input.max = 99;
    input.value = i < courtData.length ? courtData[i] : (i + 1);
    input.addEventListener('input', function() { this.classList.remove('input-error'); saveState(); });
    container.appendChild(input);
  }
  currentCourtCount = count;
}

function savePlayerData() {
  playerData = [];
  for (let i = 0; i < currentPlayerCount; i++) {
    const el = document.getElementById(`p${i}`);
    const gf = document.getElementById(`g${i}f`);
    if (el) playerData.push({ name: el.value, gender: gf && gf.checked ? 'F' : 'M' });
  }
}

function saveCourtData() {
  courtData = [];
  for (let i = 0; i < currentCourtCount; i++) {
    const el = document.getElementById(`court${i}`);
    if (el) courtData.push(el.value);
  }
}

// Rebuild grids when counts change
document.getElementById('numPlayers').addEventListener('input', function() {
  this.classList.remove('input-error');
  const v = parseInt(this.value);
  if (v >= 4 && v <= 40) buildPlayerGrid(v);
  saveState();
  checkGenderWarning();
});
document.getElementById('numCourts').addEventListener('input', function() {
  this.classList.remove('input-error');
  const v = parseInt(this.value);
  if (v >= 1 && v <= 10) buildCourtInputs(v);
  saveState();
  checkGenderWarning();
});
document.getElementById('numRounds').addEventListener('input', function() {
  this.classList.remove('input-error');
  saveState();
});
document.getElementById('preferMixed').addEventListener('change', () => { saveState(); checkGenderWarning(); });

function checkGenderWarning() {
  const warning = document.getElementById('genderWarning');
  if (!warning) return;
  const preferMixed = document.getElementById('preferMixed').checked;
  const numPlayers = parseInt(document.getElementById('numPlayers').value) || 0;
  const numCourts = parseInt(document.getElementById('numCourts').value) || 0;
  if (!preferMixed || numPlayers < 4 || numCourts < 1 || numPlayers < numCourts * 4) {
    warning.style.display = 'none';
    return;
  }
  let totalM = 0, totalF = 0;
  for (let i = 0; i < currentPlayerCount; i++) {
    const gf = document.getElementById(`g${i}f`);
    if (gf && gf.checked) totalF++; else totalM++;
  }
  if (totalM === 0 || totalF === 0) { warning.style.display = 'none'; return; }
  const numSitOuts = numPlayers - numCourts * 4;
  const lo = Math.max(0, numSitOuts - totalF);
  const hi = Math.min(numSitOuts, totalM);
  const needParity = totalM % 2; // sitM must match this parity for even playM
  let canAvoid = false;
  for (let sitM = lo; sitM <= hi; sitM++) {
    if (sitM % 2 === needParity) { canAvoid = true; break; }
  }
  if (!canAvoid) {
    warning.innerHTML = `<strong>Note:</strong> With ${totalM} male${totalM !== 1 ? 's' : ''} and ${numSitOuts === 0 ? 'no byes' : numSitOuts + ' bye' + (numSitOuts !== 1 ? 's' : '')}, some courts will have uneven gender splits (3M/1F or 1M/3F). This is mathematically unavoidable with an odd number of males playing.`;
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
  }
}

function fillDefaults() {
  const picks = pickRandomNames(currentPlayerCount);
  for (let i = 0; i < currentPlayerCount; i++) {
    document.getElementById(`p${i}`).value = picks[i].name;
    document.getElementById(`g${i}${picks[i].gender.toLowerCase()}`).checked = true;
  }
  saveState();
  checkGenderWarning();
}

function newTournament() {
  if (!confirm('Reset everything? All player names, schedule, and results will be cleared.')) return;
  clearSavedState();
  clearLadderState();
  location.reload();
}

function getPlayerNames() {
  const names = [];
  for (let i = 0; i < currentPlayerCount; i++) {
    const v = document.getElementById(`p${i}`).value.trim();
    names.push(v || `Player ${i + 1}`);
  }
  return names;
}

function getGenders() {
  const genders = [];
  for (let i = 0; i < currentPlayerCount; i++) {
    genders.push(document.getElementById(`g${i}f`).checked ? 'F' : 'M');
  }
  return genders;
}

// --- Validation & Rendering ---
function clearValidation() {
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  const banner = document.getElementById('errorBanner');
  banner.style.display = 'none';
  banner.innerHTML = '';
}

function validate() {
  clearValidation();
  const errors = [];
  const flagField = (el) => el.classList.add('input-error');

  // Player count
  const numPlayersEl = document.getElementById('numPlayers');
  const numPlayers = parseInt(numPlayersEl.value);
  if (!numPlayersEl.value.trim() || isNaN(numPlayers) || numPlayers < 4 || numPlayers > 40) {
    flagField(numPlayersEl);
    errors.push('Players must be a number between 4 and 40');
  }

  // Court count
  const numCourtsEl = document.getElementById('numCourts');
  const numCourts = parseInt(numCourtsEl.value);
  if (!numCourtsEl.value.trim() || isNaN(numCourts) || numCourts < 1 || numCourts > 10) {
    flagField(numCourtsEl);
    errors.push('Courts must be a number between 1 and 10');
  }

  // Players vs courts: need at least courts * 4 players
  if (!isNaN(numPlayers) && !isNaN(numCourts) && numPlayers < numCourts * 4) {
    flagField(numPlayersEl);
    flagField(numCourtsEl);
    errors.push(`Need at least ${numCourts * 4} players for ${numCourts} court${numCourts > 1 ? 's' : ''} (4 per court)`);
  }

  // Player names: all must be non-empty
  const names = [];
  let emptyCount = 0;
  for (let i = 0; i < currentPlayerCount; i++) {
    const el = document.getElementById(`p${i}`);
    const v = el.value.trim();
    if (!v) { emptyCount++; flagField(el); }
    names.push(v);
  }
  if (emptyCount > 0) {
    errors.push(`${emptyCount} player name${emptyCount > 1 ? 's are' : ' is'} empty`);
  }

  // Player names: duplicates need a last initial to distinguish
  const seen = {};
  for (let i = 0; i < currentPlayerCount; i++) {
    const lower = names[i].toLowerCase();
    if (!lower) continue;
    if (seen[lower] !== undefined) {
      flagField(document.getElementById(`p${i}`));
      flagField(document.getElementById(`p${seen[lower]}`));
      errors.push(`"${esc(names[i])}" appears more than once \u2014 add a last name initial (e.g. "${esc(names[i])} A.")`);
    } else {
      seen[lower] = i;
    }
  }

  // Court numbers: must be valid positive integers
  for (let i = 0; i < currentCourtCount; i++) {
    const el = document.getElementById(`court${i}`);
    const v = parseInt(el.value);
    if (!el.value.trim() || isNaN(v) || v < 1 || v > 99) {
      flagField(el);
      errors.push(`Court ${i + 1} must be a number between 1 and 99`);
    }
  }

  // Court numbers: check for duplicates
  const courtVals = [];
  for (let i = 0; i < currentCourtCount; i++) courtVals.push(document.getElementById(`court${i}`).value.trim());
  for (let i = 0; i < currentCourtCount; i++) {
    for (let j = i + 1; j < currentCourtCount; j++) {
      if (courtVals[i] && courtVals[j] && courtVals[i] === courtVals[j]) {
        flagField(document.getElementById(`court${i}`));
        flagField(document.getElementById(`court${j}`));
        errors.push(`Duplicate court number: ${courtVals[i]}`);
      }
    }
  }

  // Rounds: must be 1-30
  const roundsEl = document.getElementById('numRounds');
  const rounds = parseInt(roundsEl.value);
  if (!roundsEl.value.trim() || isNaN(rounds) || rounds < 1 || rounds > 30) {
    flagField(roundsEl);
    errors.push('Rounds must be a number between 1 and 30');
  }

  if (errors.length > 0) {
    const banner = document.getElementById('errorBanner');
    const unique = [...new Set(errors)];
    banner.innerHTML = unique.length === 1
      ? unique[0]
      : '<ul>' + unique.map(e => `<li>${e}</li>`).join('') + '</ul>';
    banner.style.display = 'block';
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }

  return { names: names.map((n,i) => n || `Player ${i+1}`), rounds, numPlayers, numCourts };
}

function generate() {
  const result = validate();
  if (!result) return;

  const { names, rounds, numPlayers, numCourts } = result;
  const genders = getGenders();
  const preferMixed = document.getElementById('preferMixed').checked;
  const courtNames = [];
  for (let i = 0; i < numCourts; i++) {
    courtNames.push(`Court ${document.getElementById('court' + i).value || (i + 1)}`);
  }

  const overlay = document.createElement('div');
  overlay.className = 'generating-overlay';
  overlay.innerHTML = '<div class="generating-spinner"></div>' +
    '<div class="generating-text" id="genText">Optimizing schedule\u2026</div>' +
    '<div class="generating-progress"><div class="generating-progress-fill" id="genBar"></div></div>' +
    '<div class="generating-detail" id="genDetail"></div>';
  document.body.appendChild(overlay);

  generateBestScheduleAsync(numPlayers, numCourts, rounds, genders, preferMixed,
    function onProgress(info) {
      var bar = document.getElementById('genBar');
      var text = document.getElementById('genText');
      var detail = document.getElementById('genDetail');
      if (bar) bar.style.width = info.pct + '%';
      if (text) text.textContent = 'Optimizing\u2026 ' + info.pct + '% (' + info.iterations + ' iterations)';
      if (detail && info.score) {
        var parts = [];
        if (info.score.maxPartner <= 1) parts.push('\u2713 no partner repeats');
        else parts.push(info.score.maxPartner + '\u00d7 max partner');
        if (info.score.genderBadCourts === 0) parts.push('\u2713 gender balanced');
        else parts.push(info.score.genderBadCourts + ' uneven courts');
        parts.push(info.score.maxOpp + '\u00d7 max opponent');
        if (info.score.byeSpread <= 1) parts.push('\u2713 byes fair');
        detail.textContent = parts.join('  \u00b7  ');
      }
    },
    function onComplete(scheduleResult) {
      lastFullResult = scheduleResult;
      scheduleCourtNames = courtNames;
      renderSchedule(scheduleResult, names, courtNames);
      renderStats(scheduleResult, names);
      document.getElementById('output').style.display = 'block';
      document.getElementById('scheduleSection').scrollIntoView({ behavior: 'smooth' });
      saveState();
      overlay.remove();
    }
  );
}

// (totalRounds, numCourtsInSchedule, roundWinners, scheduleData, scheduleNames,
//  scheduleCourtNames, lastFullResult declared at top for hoisting)

function pickWinner(roundNum, courtIdx, team) {
  if (!roundWinners[roundNum]) roundWinners[roundNum] = {};
  if (roundWinners[roundNum][courtIdx] === team) {
    roundWinners[roundNum][courtIdx] = null;
  } else {
    roundWinners[roundNum][courtIdx] = team;
  }
  updateRoundStates();
  saveState();
}

function swapRRPartners(roundNum, courtIdx) {
  const round = scheduleData.find(r => r.round === roundNum);
  if (!round) return;
  const court = round.courts[courtIdx];
  const [A, B, C, D] = [...court.teamA, ...court.teamB];
  const pairings = [
    { teamA: [A, B], teamB: [C, D] },
    { teamA: [A, C], teamB: [B, D] },
    { teamA: [A, D], teamB: [B, C] },
  ];
  const curKey = Math.min(court.teamA[0], court.teamA[1]) + '-' + Math.max(court.teamA[0], court.teamA[1]);
  let idx = pairings.findIndex(p => Math.min(p.teamA[0], p.teamA[1]) + '-' + Math.max(p.teamA[0], p.teamA[1]) === curKey);
  idx = (idx + 1) % 3;
  court.teamA = pairings[idx].teamA;
  court.teamB = pairings[idx].teamB;

  const rNames = roundNamesMap[roundNum] || scheduleNames;
  const teamAEl = document.getElementById(`r${roundNum}c${courtIdx}a`);
  const teamBEl = document.getElementById(`r${roundNum}c${courtIdx}b`);
  teamAEl.innerHTML = `<span class="serve-badge">SERVE</span>${esc(rNames[court.teamA[0]])} &amp; ${esc(rNames[court.teamA[1]])}`;
  teamBEl.innerHTML = `${esc(rNames[court.teamB[0]])} &amp; ${esc(rNames[court.teamB[1]])}`;
  saveState();
}

function isRoundComplete(roundNum) {
  if (!roundWinners[roundNum]) return false;
  for (let c = 0; c < numCourtsInSchedule; c++) {
    if (!roundWinners[roundNum][c]) return false;
  }
  return true;
}

function updateRoundStates() {
  // Find current round (first non-completed)
  let currentRound = null;
  for (let i = 1; i <= totalRounds; i++) {
    if (!isRoundComplete(i)) { currentRound = i; break; }
  }

  // Update banner
  const banner = document.getElementById('currentRoundBanner');
  if (currentRound) {
    banner.innerHTML = `<span class="current-round-dot"></span>
      <span class="current-round-text">Current Round: <span>${currentRound}</span> of ${totalRounds}</span>`;
  } else {
    banner.innerHTML = `<span class="all-done-text">All ${totalRounds} rounds complete</span>`;
  }

  // Update round cards and team states
  for (let i = 1; i <= totalRounds; i++) {
    const el = document.getElementById(`round-${i}`);
    if (!el) continue;
    const done = isRoundComplete(i);
    el.classList.toggle('round-completed', done);
    el.classList.toggle('current-round', i === currentRound);
    el.classList.toggle('round-future', currentRound !== null && i > currentRound);

    for (let c = 0; c < numCourtsInSchedule; c++) {
      const teamAEl = document.getElementById(`r${i}c${c}a`);
      const teamBEl = document.getElementById(`r${i}c${c}b`);
      if (!teamAEl || !teamBEl) continue;
      const winner = roundWinners[i] && roundWinners[i][c];
      teamAEl.classList.toggle('winner', winner === 'A');
      teamAEl.classList.toggle('loser', winner === 'B');
      teamBEl.classList.toggle('winner', winner === 'B');
      teamBEl.classList.toggle('loser', winner === 'A');
    }
  }

  renderLeaderboard();
}

function renderLeaderboard() {
  const section = document.getElementById('leaderboardSection');
  if (!scheduleData || !scheduleNames) { section.innerHTML = ''; return; }

  // Compute wins/losses keyed by (slotIndex, name) to avoid merging stats
  // when a substitute shares a name with a player in a different slot
  const identityStats = {};  // "slotIdx:name" -> {name, wins, losses}

  for (const round of scheduleData) {
    const rw = roundWinners[round.round];
    if (!rw) continue;
    const rNames = roundNamesMap[round.round] || scheduleNames;
    round.courts.forEach((court, ci) => {
      const w = rw[ci];
      if (!w) return;
      const winTeam = w === 'A' ? court.teamA : court.teamB;
      const loseTeam = w === 'A' ? court.teamB : court.teamA;
      winTeam.forEach(p => {
        const key = p + ':' + rNames[p];
        if (!identityStats[key]) identityStats[key] = { name: rNames[p], wins: 0, losses: 0 };
        identityStats[key].wins++;
      });
      loseTeam.forEach(p => {
        const key = p + ':' + rNames[p];
        if (!identityStats[key]) identityStats[key] = { name: rNames[p], wins: 0, losses: 0 };
        identityStats[key].losses++;
      });
    });
  }
  const playerStats = identityStats;

  // Check if any results exist
  const totalGames = Object.values(playerStats).reduce((a, b) => a + b.wins, 0);
  if (totalGames === 0) {
    section.innerHTML = `<div class="leaderboard"><h2>Leaderboard</h2>
      <div class="card" style="text-align:center;padding:2rem;">
        <span style="color:#4b5c72;font-size:0.85rem;">Select game winners to populate the leaderboard</span>
      </div></div>`;
    return;
  }

  // Build player rows sorted by win%, then wins, then fewer losses
  const players = Object.values(playerStats).map(s => ({
    name: s.name, wins: s.wins, losses: s.losses,
    total: s.wins + s.losses,
    pct: (s.wins + s.losses) > 0 ? s.wins / (s.wins + s.losses) : 0
  }));
  players.sort((a, b) => b.pct - a.pct || b.wins - a.wins || a.losses - b.losses);

  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

  rrLeaderboardData = players;

  let html = '<div class="leaderboard"><div class="schedule-header"><h2>Leaderboard</h2><button class="btn-export-pdf" onclick="exportPDF()">Export PDF</button><button class="btn-export-csv" onclick="exportCSV()">Export CSV</button></div>';
  html += '<table class="leaderboard-table"><thead><tr>';
  html += '<th>Player</th><th>W</th><th>L</th><th>Win %</th><th class="lb-bar-cell"></th>';
  html += '</tr></thead><tbody>';

  players.forEach((p, idx) => {
    const pct = p.total > 0 ? (p.pct * 100).toFixed(0) : '\u2014';
    const wPct = p.total > 0 ? (p.wins / p.total * 100).toFixed(1) : 0;
    const lPct = p.total > 0 ? (p.losses / p.total * 100).toFixed(1) : 0;
    const medal = idx < 3 && p.total > 0 ? `<span class="lb-medal">${medals[idx]}</span>` : '';
    const rank = idx + 1;

    html += `<tr>
      <td>${medal}<span class="lb-rank">${rank}.</span><span class="lb-name">${esc(p.name)}</span></td>
      <td class="lb-wins">${p.wins}</td>
      <td class="lb-losses">${p.losses}</td>
      <td class="lb-pct">${p.total > 0 ? pct + '%' : '<span class="lb-empty">\u2014</span>'}</td>
      <td class="lb-bar-cell"><div class="lb-bar">
        <div class="lb-bar-w" style="width:${wPct}%"></div>
        <div class="lb-bar-l" style="width:${lPct}%"></div>
      </div></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  section.innerHTML = html;
}

function renderSchedule(result, names, courtNames, preserveWinners) {
  const section = document.getElementById('scheduleSection');
  totalRounds = result.schedule.length;
  numCourtsInSchedule = courtNames.length;
  if (!preserveWinners) {
    roundWinners = {};
    roundNamesMap = {};
    // Initialize per-round names from the original names
    for (let r = 1; r <= totalRounds; r++) {
      roundNamesMap[r] = [...names];
    }
  }
  scheduleData = result.schedule;
  scheduleNames = names;

  let html = `<div class="schedule-header"><h2>Schedule</h2></div>`;
  html += '<div id="currentRoundBanner" class="current-round-banner"></div>';

  for (const round of result.schedule) {
    const rNames = roundNamesMap[round.round] || names;
    const sitOutNames = round.sitOuts.map(i => esc(rNames[i])).join(', ');
    html += `<div class="round" id="round-${round.round}">
      <div class="round-header">
        <span class="round-title">Round ${round.round}</span>
        <div class="round-header-right">
          ${round.sitOuts.length > 0 ? `<span class="sit-out">On bye: ${sitOutNames}</span>` : ''}
        </div>
      </div>
      <div class="courts">`;

    round.courts.forEach((court, ci) => {
      html += `<div class="court">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.4rem;">
          <div class="court-label" style="margin-bottom:0;">${courtNames[ci]}</div>
          <button class="btn-swap" onclick="swapRRPartners(${round.round},${ci})">Swap Partners</button>
        </div>
        <div class="matchup">
          <span class="team team-a" role="button" tabindex="0" id="r${round.round}c${ci}a" onclick="pickWinner(${round.round},${ci},'A')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickWinner(${round.round},${ci},'A')}"><span class="serve-badge">SERVE</span>${esc(rNames[court.teamA[0]])} &amp; ${esc(rNames[court.teamA[1]])}</span>
          <span class="vs">vs</span>
          <span class="team team-b" role="button" tabindex="0" id="r${round.round}c${ci}b" onclick="pickWinner(${round.round},${ci},'B')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickWinner(${round.round},${ci},'B')}">${esc(rNames[court.teamB[0]])} &amp; ${esc(rNames[court.teamB[1]])}</span>
        </div>
      </div>`;
    });

    html += '</div></div>';
  }

  section.innerHTML = html;
  updateRoundStates();
}

function exportPDF() {
  const d = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('printDate').textContent = d.toLocaleDateString('en-US', opts);
  document.getElementById('printMode').textContent = 'Round Robin';
  document.body.classList.remove('print-ladder');
  const orig = document.title;
  document.title = `round-robin-results-${fileDate()}`;
  window.print();
  document.title = orig;
}

// --- CSV Export ---
let rrLeaderboardData = [];

function fileDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCSV() {
  let csv = '';

  // Leaderboard
  if (rrLeaderboardData.length) {
    csv += 'LEADERBOARD\nRank,Player,W,L,Win %\n';
    rrLeaderboardData.forEach((p, i) => {
      const pct = p.total > 0 ? (p.pct * 100).toFixed(0) + '%' : '';
      csv += `${i + 1},"${p.name}",${p.wins},${p.losses},${pct}\n`;
    });
  }

  // Round history
  if (scheduleData) {
    csv += '\nROUND HISTORY\n';
    for (const round of scheduleData) {
      const rNames = roundNamesMap[round.round] || scheduleNames;
      const rw = roundWinners[round.round];
      csv += `\nRound ${round.round}\n`;
      csv += 'Court,Team A,Team B,Winner\n';
      round.courts.forEach((court, ci) => {
        const tA = `${rNames[court.teamA[0]]} & ${rNames[court.teamA[1]]}`;
        const tB = `${rNames[court.teamB[0]]} & ${rNames[court.teamB[1]]}`;
        const winner = rw && rw[ci] ? (rw[ci] === 'A' ? tA : tB) : '';
        csv += `${ci + 1},"${tA}","${tB}","${winner}"\n`;
      });
      if (round.sitOuts.length > 0) {
        csv += `Bye:,"${round.sitOuts.map(i => rNames[i]).join(', ')}"\n`;
      }
    }
  }

  downloadCSV(`round-robin-results-${fileDate()}.csv`, csv);
}

function renderStats(result, names) {
  const section = document.getElementById('statsSection');
  const { partnerCount, opponentCount, courtCount, sitOutCount, playCount } = result;
  const n = names.length;

  let totalPartnerPairs = 0, uniquePartnerPairs = 0;
  let totalOpponentPairs = 0, uniqueOpponentPairs = 0;
  let uniqueCourtPairs = 0;
  let maxPartner = 0, maxOpponent = 0, maxCourt = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (partnerCount[i][j] > 0) { uniquePartnerPairs++; totalPartnerPairs += partnerCount[i][j]; }
      if (partnerCount[i][j] > maxPartner) maxPartner = partnerCount[i][j];
      if (opponentCount[i][j] > 0) { uniqueOpponentPairs++; totalOpponentPairs += opponentCount[i][j]; }
      if (opponentCount[i][j] > maxOpponent) maxOpponent = opponentCount[i][j];
      if (courtCount && courtCount[i][j] > 0) uniqueCourtPairs++;
      if (courtCount && courtCount[i][j] > maxCourt) maxCourt = courtCount[i][j];
    }
  }

  const possiblePairs = n * (n - 1) / 2;
  const partnerDiversity = (uniquePartnerPairs / possiblePairs * 100).toFixed(1);
  const opponentDiversity = (uniqueOpponentPairs / possiblePairs * 100).toFixed(1);
  const courtDiversity = courtCount ? (uniqueCourtPairs / possiblePairs * 100).toFixed(1) : null;

  let html = `<div class="stats-toggle collapsed" onclick="this.classList.toggle('collapsed');this.nextElementSibling.classList.toggle('collapsed')">
    <h2>Statistics</h2><span class="stats-chevron">&#9660;</span>
  </div><div class="stats-body collapsed"><div class="stats-grid">`;

  // Summary card
  html += `<div class="stat-card">
    <h3>Diversity Scores</h3>
    <div class="stat-row"><span class="stat-name">Unique partner pairs</span>
      <span class="stat-value">${uniquePartnerPairs} / ${possiblePairs} (${partnerDiversity}%)</span></div>
    <div class="diversity-bar"><div class="diversity-fill" style="width:${partnerDiversity}%;background:linear-gradient(90deg,#818cf8,#a5b4fc)"></div></div>
    <div class="stat-row" style="margin-top:0.5rem"><span class="stat-name">Unique opponent pairs</span>
      <span class="stat-value">${uniqueOpponentPairs} / ${possiblePairs} (${opponentDiversity}%)</span></div>
    <div class="diversity-bar"><div class="diversity-fill" style="width:${opponentDiversity}%;background:linear-gradient(90deg,#c4b5fd,#ddd6fe)"></div></div>
    ${courtDiversity !== null ? `<div class="stat-row" style="margin-top:0.5rem"><span class="stat-name">Unique court pairings</span>
      <span class="stat-value">${uniqueCourtPairs} / ${possiblePairs} (${courtDiversity}%)</span></div>
    <div class="diversity-bar"><div class="diversity-fill" style="width:${courtDiversity}%;background:linear-gradient(90deg,#10b981,#34d399)"></div></div>` : ''}
    <div class="stat-row" style="margin-top:0.5rem"><span class="stat-name">Max times as partners</span>
      <span class="stat-value">${maxPartner}</span></div>
    <div class="stat-row"><span class="stat-name">Max times as opponents</span>
      <span class="stat-value">${maxOpponent}</span></div>
    ${courtDiversity !== null ? `<div class="stat-row"><span class="stat-name">Max times on same court</span>
      <span class="stat-value">${maxCourt}</span></div>` : ''}
  </div>`;

  // Per-player card
  html += `<div class="stat-card"><h3>Player Summary</h3>`;
  for (let i = 0; i < n; i++) {
    const partners = new Set(), opponents = new Set();
    for (let j = 0; j < n; j++) {
      if (j !== i && partnerCount[i][j] > 0) partners.add(j);
      if (j !== i && opponentCount[i][j] > 0) opponents.add(j);
    }
    html += `<div class="stat-row">
      <span class="stat-name">${esc(names[i])}</span>
      <span class="stat-value">${playCount[i]} games, ${partners.size} partners, ${opponents.size} opp${sitOutCount[i] > 0 ? `, ${sitOutCount[i]} byes` : ''}</span>
    </div>`;
  }
  html += '</div></div>';

  html += renderMatrix('Partner Count Matrix', partnerCount, names, n, maxPartner);
  html += renderMatrix('Opponent Count Matrix', opponentCount, names, n, maxOpponent);
  if (courtCount) html += renderMatrix('Court Co-occurrence Matrix', courtCount, names, n, maxCourt);

  html += '</div>'; // close stats-body
  section.innerHTML = html;
}

function renderMatrix(title, matrix, names, n, maxVal) {
  // Short names for headers
  const short = names.map(nm => esc(nm.length > 6 ? nm.slice(0, 5) + '.' : nm));
  let html = `<div class="matrix-container"><h3>${title}</h3><table class="matrix"><thead><tr><th></th>`;
  for (let j = 0; j < n; j++) html += `<th>${short[j]}</th>`;
  html += '</tr></thead><tbody>';

  for (let i = 0; i < n; i++) {
    html += `<tr><th>${short[i]}</th>`;
    for (let j = 0; j < n; j++) {
      if (i === j) {
        html += '<td class="diag">-</td>';
      } else {
        const v = matrix[i][j];
        const heat = maxVal > 0 ? Math.min(5, Math.round(v / maxVal * 5)) : 0;
        html += `<td class="heat-${heat}">${v}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// Initial build (default — may be overridden by restoreState at end of script)
buildPlayerGrid(20);
buildCourtInputs(4);
