// --- State variables (declared early for restore) ---
let totalRounds = 0;
let numCourtsInSchedule = 0;
let roundWinners = {};
let scheduleData = null;
let scheduleNames = null;
let roundNamesMap = {};  // roundNumber -> [...names], for per-round substitution tracking
let scheduleCourtNames = [];
let lastFullResult = null;
// Round-Robin per-round timer (same widget/behavior as the ladder timer).
let rrRoundTimer = null;   // { durationSec, startedAt, pausedRemaining, expired, lastDurationSec }
let rrTimerInterval = null;
let rrCurrentRound = null;  // tracks the current round to auto-reset the timer on advance
// Round-Robin result entry. 'winner' = tap a team (default); 'scores' = enter game scores.
let rrScoringMode = 'winner';
let rrWinBy = 1;            // 1 = first to 11; 2 = must win by 2 (to 11, no cap)
let roundScores = {};       // { [round]: { [courtIdx]: { a, b, early } } }

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
      if (playerData[i].genderManual) div.dataset.genderManual = '1';
    }
    document.getElementById(`p${i}`).addEventListener('input', function() {
      this.classList.remove('input-error');
      const idx = parseInt(this.id.slice(1));
      const row = this.parentElement;
      const toggle = row.querySelector('.gender-toggle');
      const removeHint = () => { const h = row.querySelector('.gender-hint'); if (h) h.remove(); };
      if (!this.value.trim()) {
        // Cleared: re-enable auto-detect for the next name and drop any hint.
        row.dataset.genderManual = '';
        toggle.classList.remove('gender-undetected');
        removeHint();
      } else if (row.dataset.genderManual === '1') {
        // Gender was set by hand — never let auto-detect override it.
        toggle.classList.remove('gender-undetected');
        removeHint();
      } else {
        const g = guessGender(this.value);
        if (g) {
          document.getElementById(`g${idx}${g.toLowerCase()}`).checked = true;
          toggle.classList.remove('gender-undetected');
          removeHint();
          checkGenderWarning();
        } else {
          toggle.classList.add('gender-undetected');
          if (!row.querySelector('.gender-hint')) {
            const hint = document.createElement('div');
            hint.className = 'gender-hint';
            hint.textContent = 'Gender not auto-detected — please verify M/F toggle';
            row.appendChild(hint);
          }
        }
      }
      updatePlayerGenderCount();
      // Renaming the roster before anyone has played retires the schedule, so
      // it can only reappear via Generate. Runs first: it nulls scheduleNames,
      // which skips the substitution branch below.
      setupChanged();
      // Live-update schedule if one exists (substitution: only current + future rounds)
      if (scheduleNames && idx < scheduleNames.length) {
        const newName = this.value || `Player ${idx + 1}`;
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
        // Re-check the whole grid, not just this row: fixing one half of a
        // duplicate pair has to clear the warning on the other half too.
        refreshDuplicateNameWarnings();
        debounce('scheduleRender', () => {
          renderSchedule({ schedule: scheduleData }, scheduleNames, scheduleCourtNames, true);
          if (lastFullResult) renderStats(lastFullResult, scheduleNames);
        }, 180);
      }
      refreshValidationBanner();
      saveState();
    });
    // Save on gender toggle change; dismiss undetected hint on manual toggle
    const dismissHint = function() {
      const pi = this.name.slice(1);
      const row = document.getElementById(`p${pi}`).parentElement;
      row.dataset.genderManual = '1'; // user set gender by hand — make it sticky
      const toggle = row.querySelector('.gender-toggle');
      toggle.classList.remove('gender-undetected');
      const hint = row.querySelector('.gender-hint');
      if (hint) hint.remove();
      setupChanged();  // gender drives the pairing, so an unplayed schedule is stale
      saveState();
      checkGenderWarning();
      updatePlayerGenderCount();
    };
    document.getElementById(`g${i}m`).addEventListener('change', dismissHint);
    document.getElementById(`g${i}f`).addEventListener('change', dismissHint);
  }
  currentPlayerCount = count;
  updatePlayerGenderCount();
  // Rebuilding the rows discards their warnings — recompute so a restored or
  // resized grid still shows the clashes that are actually there.
  refreshDuplicateNameWarnings();
}

// Re-evaluates the inline duplicate-name warning for every player row.
//
// A slot conflicts when its current name matches a name some *other* slot has
// used, including in already-completed rounds: those keep their original names
// and get their own leaderboard row, so a name that has already played is
// still taken. Recomputing the whole grid — rather than only the row being
// typed in — is what lets a warning disappear once the clash is resolved.
function refreshDuplicateNameWarnings() {
  // No schedule (never generated, or just retired) means no slot identities to
  // collide, so the truthful state is "no warnings". Clearing rather than
  // returning early matters: otherwise a warning raised while a schedule was
  // live would outlive it with nothing left to ever take it down. Duplicates
  // are still caught at Generate time by collectValidationErrors().
  // Array-guarded because restore runs this before a payload has proven itself.
  if (!Array.isArray(scheduleNames)) {
    for (let i = 0; i < currentPlayerCount; i++) {
      const el = document.getElementById(`p${i}`);
      if (el) setDupNameWarning(el, false, '');
    }
    return;
  }
  const n = scheduleNames.length;
  const usedBySlot = Array.from({ length: n }, () => new Set());
  const note = (i, name) => { const k = normalizeName(name); if (k) usedBySlot[i].add(k); };
  for (let r = 1; r <= totalRounds; r++) {
    const rn = roundNamesMap[r] || scheduleNames;
    for (let i = 0; i < n; i++) note(i, rn[i]);
  }
  for (let i = 0; i < n; i++) note(i, scheduleNames[i]);

  for (let i = 0; i < n; i++) {
    const el = document.getElementById(`p${i}`);
    if (!el) continue;
    const key = normalizeName(scheduleNames[i]);
    const clash = !!key && usedBySlot.some((used, j) => j !== i && used.has(key));
    setDupNameWarning(el, clash, scheduleNames[i]);
  }
}

// Counts only rows where a name has been entered. Defaults are M, so we
// don't want to count empty rows or the indicator would always show
// "20M / 0F" on a fresh form.
function updatePlayerGenderCount() {
  const target = document.getElementById('playerGenderCount');
  if (!target) return;
  let m = 0, f = 0;
  for (let i = 0; i < currentPlayerCount; i++) {
    const nameEl = document.getElementById(`p${i}`);
    if (!nameEl || !nameEl.value.trim()) continue;
    const gf = document.getElementById(`g${i}f`);
    if (gf && gf.checked) f++; else m++;
  }
  const filled = m + f;
  if (filled === 0) { target.style.display = 'none'; return; }
  target.style.display = '';
  const progress = filled < currentPlayerCount
    ? `<span class="pgc-progress">(${filled} of ${currentPlayerCount})</span>`
    : '';
  target.innerHTML =
    `<span class="pgc-m">${m}M</span>` +
    `<span class="pgc-sep">·</span>` +
    `<span class="pgc-f">${f}F</span>` +
    progress;
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
    input.addEventListener('input', function() {
      this.classList.remove('input-error');
      setupChanged();
      refreshValidationBanner();
      saveState();
    });
    container.appendChild(input);
  }
  currentCourtCount = count;
}

function savePlayerData() {
  playerData = [];
  for (let i = 0; i < currentPlayerCount; i++) {
    const el = document.getElementById(`p${i}`);
    const gf = document.getElementById(`g${i}f`);
    if (el) playerData.push({ name: el.value, gender: gf && gf.checked ? 'F' : 'M', genderManual: el.parentElement.dataset.genderManual === '1' });
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
  setupChanged();
  const v = parseInt(this.value);
  if (v >= 4 && v <= 40) buildPlayerGrid(v);
  refreshValidationBanner();
  saveState();
  checkGenderWarning();
});
document.getElementById('numCourts').addEventListener('input', function() {
  this.classList.remove('input-error');
  setupChanged();
  const v = parseInt(this.value);
  if (v >= 1 && v <= 10) buildCourtInputs(v);
  refreshValidationBanner();
  saveState();
  checkGenderWarning();
});
document.getElementById('numRounds').addEventListener('input', function() {
  this.classList.remove('input-error');
  setupChanged();
  refreshValidationBanner();
  saveState();
});
document.getElementById('preferMixed').addEventListener('change', () => {
  setupChanged();
  saveState();
  checkGenderWarning();
});

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
  setupChanged();
  refreshDuplicateNameWarnings();
  saveState();
  checkGenderWarning();
  updatePlayerGenderCount();
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
// Messages currently on screen. Tracked so a live edit can retire the ones it
// resolved without also surfacing problems the user hasn't asked about yet —
// the banner only ever shrinks between Generate presses.
let shownErrors = [];

function clearValidation() {
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  const banner = document.getElementById('errorBanner');
  banner.style.display = 'none';
  banner.innerHTML = '';
  shownErrors = [];
}

function renderErrorBanner(errors) {
  const banner = document.getElementById('errorBanner');
  shownErrors = errors;
  if (errors.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.innerHTML = errors.length === 1
    ? errors[0]
    : '<ul>' + errors.map(e => `<li>${e}</li>`).join('') + '</ul>';
  banner.style.display = 'block';
}

// Exactly the fields collectValidationErrors() can flag. Listed explicitly
// rather than swept with '.input-error' because the schedule's score inputs
// live inside #rrSetup too, and they own their own error state (rrSyncCourt).
const RR_SETUP_FIELDS = '#numPlayers, #numCourts, #numRounds, #playerGrid input, #courtInputs input';

// Called while the user edits: re-runs the checks, drops any message that no
// longer applies, and re-flags the fields that are still wrong. Without this
// the banner (and the other half of a duplicate pair) stayed marked until the
// next Generate press.
function refreshValidationBanner() {
  if (shownErrors.length === 0) return;
  document.querySelectorAll(RR_SETUP_FIELDS)
    .forEach(el => el.classList.remove('input-error'));
  const still = new Set(collectValidationErrors().errors);
  renderErrorBanner(shownErrors.filter(e => still.has(e)));
}

function validate() {
  clearValidation();
  const { errors, result } = collectValidationErrors();
  if (errors.length > 0) {
    renderErrorBanner([...new Set(errors)]);
    document.getElementById('errorBanner').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  return result;
}

// Runs every setup check, flagging offending fields, and returns the messages
// plus the parsed config. Does not touch the banner — callers decide how to
// present the result.
function collectValidationErrors() {
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
  const dupNames = duplicateNameIndices(names);
  const reported = new Set();
  dupNames.forEach(i => {
    flagField(document.getElementById(`p${i}`));
    const key = normalizeName(names[i]);
    if (reported.has(key)) return;
    reported.add(key);
    errors.push(`"${esc(names[i])}" appears more than once \u2014 add a last name initial (e.g. "${esc(names[i])} A.")`);
  });

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

  return {
    errors,
    result: { names: names.map((n, i) => n || `Player ${i + 1}`), rounds, numPlayers, numCourts }
  };
}

// True once any court has a recorded winner or a complete score — i.e. the
// tournament is genuinely underway rather than merely generated. Accepts the
// maps explicitly so restoreState can ask the same question of a saved payload
// before it commits to showing anything.
function hasEnteredResults(winners, scores) {
  const w = winners || roundWinners;
  const s = scores || roundScores;
  for (const r in w) {
    if (w[r] && Object.keys(w[r]).some(c => w[r][c])) return true;
  }
  for (const r in s) {
    if (s[r] && Object.keys(s[r]).length > 0) return true;
  }
  return false;
}

// Drops a generated-but-not-started schedule and hides the output. The schedule
// is derived from the roster, so once the roster changes it is no longer the
// schedule the user asked for — it must come back through Generate, not through
// a stray keystroke. A tournament with results entered is left strictly alone
// (see setupChanged): substituting a player mid-event is a supported flow.
function retireSchedule() {
  scheduleData = null;
  scheduleNames = null;
  lastFullResult = null;
  roundNamesMap = {};
  scheduleCourtNames = [];
  roundWinners = {};
  roundScores = {};
  totalRounds = 0;
  numCourtsInSchedule = 0;
  rrCurrentRound = null;
  stopRRTimerInterval();
  // Keep the chosen duration so the next schedule starts with the same default.
  rrRoundTimer = newRoundTimerState(rrRoundTimer ? (rrRoundTimer.lastDurationSec || 600) : 600);
  document.getElementById('output').style.display = 'none';
  document.getElementById('scheduleSection').innerHTML = '';
  document.getElementById('leaderboardSection').innerHTML = '';
  document.getElementById('statsSection').innerHTML = '';
  // Slot-identity warnings are meaningless without a schedule, and nothing else
  // would ever clear them once scheduleNames is gone.
  refreshDuplicateNameWarnings();
}

// Call from every setup control. Retires a schedule that hasn't been played
// yet; leaves an in-progress one untouched so live substitution still works.
// Returns true when the schedule was retired.
function setupChanged() {
  if (!scheduleData || hasEnteredResults()) return false;
  retireSchedule();
  return true;
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
  // A tap is authoritative for winner mode; drop any stale score for this court.
  if (roundScores[roundNum]) delete roundScores[roundNum][courtIdx];
  updateRoundStates(true);
  saveState();
}

// --- Round-Robin score entry ---
// The controls live in the Setup card (#rrScoringControls) so they sit near the
// top, independent of whether a schedule has been generated yet.
function rrScoringControlsHTML() {
  const winnerActive = rrScoringMode !== 'scores';
  return `<div class="rr-scoring-group">
      <span class="rr-scoring-label">Results</span>
      <div class="seg-toggle">
        <button type="button" class="seg-btn ${winnerActive ? 'active' : ''}" onclick="setRRScoringMode('winner')">Pick winner</button>
        <button type="button" class="seg-btn ${!winnerActive ? 'active' : ''}" onclick="setRRScoringMode('scores')">Enter scores</button>
      </div>
    </div>
    <div class="rr-scoring-group"${winnerActive ? ' style="display:none;"' : ''}>
      <span class="rr-scoring-label">Win by</span>
      <div class="seg-toggle">
        <button type="button" class="seg-btn ${rrWinBy === 1 ? 'active' : ''}" onclick="setRRWinBy(1)">1</button>
        <button type="button" class="seg-btn ${rrWinBy === 2 ? 'active' : ''}" onclick="setRRWinBy(2)">2</button>
      </div>
      <span class="rr-scoring-hint">${rrWinBy === 2 ? 'to 11, win by 2' : 'first to 11'}</span>
    </div>`;
}

function renderRRScoringControls() {
  const el = document.getElementById('rrScoringControls');
  if (el) el.innerHTML = rrScoringControlsHTML();
}

function rerenderRRSchedule() {
  if (!scheduleData) return;
  renderSchedule({ schedule: scheduleData }, scheduleNames, scheduleCourtNames, true);
}

function setRRScoringMode(mode) {
  rrScoringMode = (mode === 'scores') ? 'scores' : 'winner';
  renderRRScoringControls();
  rerenderRRSchedule();
  saveState();
}

function setRRWinBy(n) {
  rrWinBy = (n === 2) ? 2 : 1;
  renderRRScoringControls();
  rerenderRRSchedule();  // re-renders and re-validates every stored score under the new rule
  saveState();
}

// Validates a court's two score inputs under the current win-by rule, updates
// the inline error + "Complete Game Early" affordance, and records the score +
// derived winner. UI/state sync only (no re-render, no save) so it can run in a
// loop during rendering.
function rrSyncCourt(round, ci) {
  const aEl = document.getElementById(`rs${round}c${ci}a`);
  const bEl = document.getElementById(`rs${round}c${ci}b`);
  if (!aEl || !bEl) return;
  const errSlot = document.getElementById(`rrErr${round}c${ci}`);
  const earlyBtn = document.getElementById(`rrEarly${round}c${ci}`);
  aEl.classList.remove('input-error');
  bEl.classList.remove('input-error');
  if (errSlot) errSlot.innerHTML = '';

  const a = parseInt(aEl.value, 10);
  const b = parseInt(bEl.value, 10);
  const bothEntered = aEl.value.trim() !== '' && bEl.value.trim() !== '' && !isNaN(a) && !isNaN(b);

  const prev = (roundScores[round] && roundScores[round][ci]) || null;
  let early = !!(prev && prev.early);

  if (!bothEntered) {
    // Incomplete entry: drop this court's score but leave any tap-set winner intact.
    if (roundScores[round]) delete roundScores[round][ci];
    if (earlyBtn) earlyBtn.style.display = 'none';
    return;
  }

  const err = pickleballScoreError(a, b, rrWinBy);
  const validFinal = pickleballResult(a, b, rrWinBy); // 'A' | 'B' | null
  if (validFinal !== null) early = false;              // a real result supersedes early completion
  const inProgressLeader = validFinal === null && !err && a !== b;

  if (err) {
    aEl.classList.add('input-error');
    bEl.classList.add('input-error');
    if (errSlot) errSlot.innerHTML = `<div class="ladder-score-error">${esc(err)}</div>`;
  }

  let winner = validFinal;
  if (early && inProgressLeader) winner = a > b ? 'A' : 'B';

  if (earlyBtn) {
    earlyBtn.style.display = (inProgressLeader || early) ? '' : 'none';
    earlyBtn.textContent = early ? 'Undo Early Completion' : 'Complete Game Early';
    earlyBtn.classList.toggle('btn-early-active', early);
  }

  if (!roundScores[round]) roundScores[round] = {};
  roundScores[round][ci] = { a, b, early };
  if (!roundWinners[round]) roundWinners[round] = {};
  roundWinners[round][ci] = winner; // null when invalid/unfinished → blocks round completion
}

function rrCheckCourtScore(round, ci) {
  rrSyncCourt(round, ci);
  updateRoundStates(true);
  saveState();
}

function rrCompleteEarly(round, ci) {
  if (!roundScores[round]) roundScores[round] = {};
  const cur = roundScores[round][ci] || {};
  cur.early = !cur.early;
  roundScores[round][ci] = cur;
  rrCheckCourtScore(round, ci);
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

// --- Round-Robin round timer (same behavior as the ladder timer) ---
function getRRTimerState() {
  if (!rrRoundTimer) return 'idle';
  const t = rrRoundTimer;
  if (t.expired) return 'expired';
  if (t.pausedRemaining !== null) return 'paused';
  if (t.startedAt !== null) return 'running';
  return 'idle';
}
function getRRTimerRemainingSec() {
  if (!rrRoundTimer) return 0;
  const t = rrRoundTimer;
  if (t.expired) return 0;
  if (t.pausedRemaining !== null) return t.pausedRemaining;
  if (t.startedAt !== null) return Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  return t.durationSec;
}
function stopRRTimerInterval() {
  if (rrTimerInterval !== null) { clearInterval(rrTimerInterval); rrTimerInterval = null; }
}
function startRRTimerInterval() {
  stopRRTimerInterval();
  rrTimerInterval = setInterval(tickRRTimer, 500);
}
function tickRRTimer() {
  if (!rrRoundTimer || rrRoundTimer.startedAt === null) { stopRRTimerInterval(); return; }
  const remaining = rrRoundTimer.durationSec - (Date.now() - rrRoundTimer.startedAt) / 1000;
  const display = document.getElementById('rrRoundTimerDisplay');
  if (display) display.textContent = formatTimerMMSS(remaining);
  if (remaining <= 0) expireRRTimer();
}
function startRRTimer() {
  if (!rrRoundTimer) return;
  const input = document.getElementById('rrRoundTimerMinutes');
  const minutes = parseInt(input && input.value);
  if (isNaN(minutes) || minutes < 1 || minutes > 60) {
    if (input) { input.classList.add('input-error'); setTimeout(() => input.classList.remove('input-error'), 1200); }
    return;
  }
  const seconds = minutes * 60;
  rrRoundTimer.durationSec = seconds;
  rrRoundTimer.lastDurationSec = seconds;
  rrRoundTimer.startedAt = Date.now();
  rrRoundTimer.pausedRemaining = null;
  rrRoundTimer.expired = false;
  renderRRRoundTimer();
  startRRTimerInterval();
  saveState();
}
function pauseRRTimer() {
  if (!rrRoundTimer || rrRoundTimer.startedAt === null) return;
  const t = rrRoundTimer;
  t.pausedRemaining = Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  t.startedAt = null;
  stopRRTimerInterval();
  renderRRRoundTimer();
  saveState();
}
function resumeRRTimer() {
  if (!rrRoundTimer || rrRoundTimer.pausedRemaining === null) return;
  const t = rrRoundTimer;
  t.durationSec = t.pausedRemaining;
  t.startedAt = Date.now();
  t.pausedRemaining = null;
  renderRRRoundTimer();
  startRRTimerInterval();
  saveState();
}
function resetRRTimer() {
  if (!rrRoundTimer) return;
  stopRRTimerInterval();
  rrRoundTimer = newRoundTimerState(rrRoundTimer.lastDurationSec || 600);
  renderRRRoundTimer();
  saveState();
}
function expireRRTimer() {
  if (!rrRoundTimer) return;
  const t = rrRoundTimer;
  t.expired = true; t.startedAt = null; t.pausedRemaining = null;
  stopRRTimerInterval();
  renderRRRoundTimer();
  saveState();
}
function resumeRRTimerOnRestore() {
  if (!rrRoundTimer) return;
  const t = rrRoundTimer;
  if (t.expired || t.pausedRemaining !== null || t.startedAt === null) return;
  const remaining = t.durationSec - (Date.now() - t.startedAt) / 1000;
  if (remaining <= 0) {
    t.expired = true; t.startedAt = null; t.pausedRemaining = null;
    saveState(); renderRRRoundTimer(); return;
  }
  startRRTimerInterval();
}
function renderRRRoundTimer() {
  const container = document.getElementById('rrRoundTimer');
  if (!container || !rrRoundTimer) { if (container) container.innerHTML = ''; return; }
  const t = rrRoundTimer;
  const state = getRRTimerState();
  const lastMin = Math.max(1, Math.round((t.lastDurationSec || 600) / 60));
  let html = `<div class="round-timer round-timer-${state}">`;
  if (state === 'idle') {
    html += `<span class="round-timer-label">Round Timer</span>
      <input type="number" class="round-timer-input" id="rrRoundTimerMinutes" min="1" max="60" value="${lastMin}">
      <span class="round-timer-unit">min</span>
      <button class="btn-timer btn-timer-start" id="rrRoundTimerStartBtn" type="button">Start</button>`;
  } else {
    html += `<span class="round-timer-label">Round Timer</span>
      <span class="round-timer-display" id="rrRoundTimerDisplay">${formatTimerMMSS(getRRTimerRemainingSec())}</span>`;
    if (state === 'paused') html += `<span class="round-timer-tag">paused</span>`;
    if (state === 'running') html += `<button class="btn-timer btn-timer-pause" id="rrRoundTimerPauseBtn" type="button">Pause</button>`;
    else if (state === 'paused') html += `<button class="btn-timer btn-timer-resume" id="rrRoundTimerResumeBtn" type="button">Resume</button>`;
    html += `<button class="btn-timer btn-timer-reset" id="rrRoundTimerResetBtn" type="button">Reset</button>`;
  }
  html += `</div>`;
  container.innerHTML = html;

  const sb = document.getElementById('rrRoundTimerStartBtn'); if (sb) sb.addEventListener('click', startRRTimer);
  const pb = document.getElementById('rrRoundTimerPauseBtn'); if (pb) pb.addEventListener('click', pauseRRTimer);
  const rb = document.getElementById('rrRoundTimerResumeBtn'); if (rb) rb.addEventListener('click', resumeRRTimer);
  const xb = document.getElementById('rrRoundTimerResetBtn'); if (xb) xb.addEventListener('click', resetRRTimer);
  const mi = document.getElementById('rrRoundTimerMinutes');
  if (mi) {
    mi.addEventListener('input', function() { this.classList.remove('input-error'); });
    mi.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); startRRTimer(); } });
  }
}

// --- Round-advance transition helpers ---------------------------------------
// The visual order of the round cards comes from CSS `order` (see
// css/styles.css): current round -1, upcoming 0, the completed divider 1,
// completed rounds 2. One step is roughly one card height; anything further
// crosses the whole upcoming block.
function rrOrderBucket(done, isCurrent) {
  if (done) return 2;
  return isCurrent ? -1 : 0;
}

// Fixed names a stylesheet can address. `rr-round-<N>` cannot be targeted by
// static CSS because N varies with the round, so cards needing the fade-only
// treatment are renamed into this pool for the duration of the transition.
// Four slots is well past what one result tap can move (at most one card
// leaves the current slot and one arrives), so the overflow branch below is
// defensive only. Keep this list and the rr-leaving-N rules in styles.css in
// step: a name with no rule would morph across the page again.
const RR_LEAVING_NAMES = ['rr-leaving-1', 'rr-leaving-2', 'rr-leaving-3', 'rr-leaving-4'];

// Bumped per transition so a superseded transition's settle handler cannot
// clobber the names the next one just assigned: starting a transition while
// one is in flight skips (and so rejects) the old one, and that rejection
// lands after the new transition has already renamed its cards.
let rrVtGeneration = 0;

// Puts every round card back on its own `rr-round-<N>`. The name is derived
// from the element rather than remembered, so this doubles as the
// post-transition restore and as a pre-flight sweep for stale rr-leaving-*
// names, and it can never itself leave a duplicate behind. Duplicates matter:
// view-transition-name has to be unique in the document, or the browser skips
// the transition outright.
function rrResetRoundTransitionNames() {
  for (let i = 1; i <= totalRounds; i++) {
    const el = document.getElementById(`round-${i}`);
    if (el && el.style.viewTransitionName !== `rr-round-${i}`) {
      el.style.viewTransitionName = `rr-round-${i}`;
    }
  }
}

// The cards whose order bucket moves more than one step — the ones that
// would travel the height of the whole upcoming block (~1830px measured at 16
// players / 3 courts / 10 rounds). View Transitions paint the moving snapshot
// in an overlay above the page, so such a morph reads as a card rocketing
// across the header and the leaderboard. Direction-agnostic on purpose:
// completing the current round drops it below the divider (-1 -> 2), and
// un-tapping a winner brings a completed round back up (2 -> -1, or 2 -> 0 for
// a completed round that is not the new current one). The old bucket is read
// from the classes still on the card, the new one from the state about to be
// applied.
function rrFarMovingRoundCards(currentRound) {
  const far = [];
  for (let i = 1; i <= totalRounds; i++) {
    const el = document.getElementById(`round-${i}`);
    if (!el) continue;
    const from = rrOrderBucket(el.classList.contains('round-completed'),
                               el.classList.contains('current-round'));
    const to = rrOrderBucket(isRoundComplete(i), i === currentRound);
    if (Math.abs(to - from) > 1) far.push(el);
  }
  return far;
}

function updateRoundStates(animateChange) {
  // Find current round (first non-completed)
  let currentRound = null;
  for (let i = 1; i <= totalRounds; i++) {
    if (!isRoundComplete(i)) { currentRound = i; break; }
  }

  // Whether to animate is opt-in from the caller, never inferred from state:
  // pickWinner and rrCheckCourtScore are the only places a human action can
  // move the round, so only they pass animateChange=true. renderSchedule's
  // internal call and restoreState's call always omit it, so first paint and
  // page load stay instant — restoreState renders before roundWinners comes
  // back (see js/state.js), so a state-only comparison there would see a
  // spurious advance. Captured before rrCurrentRound is overwritten below.
  // Comparing plainly, without a `rrCurrentRound !== null` guard, also
  // animates un-tapping the final round's winner (currentRound moving from
  // null back to N).
  const roundAdvanced = !!animateChange && currentRound !== rrCurrentRound;

  // Auto-reset the round timer when the current round advances (mirrors the
  // ladder timer resetting on each new round). Reset in place so the freshly
  // built banner slot renders the idle timer below.
  if (rrRoundTimer && rrCurrentRound !== null && currentRound !== rrCurrentRound) {
    stopRRTimerInterval();
    rrRoundTimer = newRoundTimerState(rrRoundTimer.lastDurationSec || 600);
  }
  rrCurrentRound = currentRound;

  // Update banner. Absent once a schedule has been retired — the whole
  // schedule section is emptied then, so there is nothing to update.
  const banner = document.getElementById('currentRoundBanner');
  if (!banner) { stopRRTimerInterval(); renderLeaderboard(); return; }
  if (currentRound) {
    banner.innerHTML = `<span class="current-round-dot"></span>
      <span class="current-round-text">Current Round: <span>${currentRound}</span> of ${totalRounds}</span>
      <span class="current-round-timer-slot" id="rrRoundTimer"></span>`;
  } else {
    banner.innerHTML = `<span class="all-done-text">All ${totalRounds} rounds complete</span>`;
    stopRRTimerInterval();
  }
  renderRRRoundTimer();

  // Update round cards and team states
  const applyRoundClasses = () => {
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

    // Count after the toggles above, so this reflects the state just applied.
    const dividerText = document.querySelector('#roundsDivider .rounds-divider-text');
    if (dividerText) {
      let doneCount = 0;
      for (let i = 1; i <= totalRounds; i++) if (isRoundComplete(i)) doneCount++;
      dividerText.textContent = 'Completed · ' + doneCount +
        (doneCount === 1 ? ' round' : ' rounds');
    }
  };

  // Animate only a real round change, and only where the API exists. Everything
  // else — first paint, restore, editing a score without finishing a round —
  // applies instantly, exactly as before.
  if (roundAdvanced && document.startViewTransition) {
    // Never trust the previous transition's cleanup: a leaked rr-leaving-*
    // would be a duplicate of the one assigned below, and the browser skips a
    // transition whose names are not unique.
    rrResetRoundTransitionNames();
    const farCards = rrFarMovingRoundCards(currentRound);
    if (farCards.length > RR_LEAVING_NAMES.length) {
      // More long hops than fade slots: apply the change instantly rather than
      // animate some cards and let the leftovers rocket across the page.
      applyRoundClasses();
    } else {
      farCards.forEach((el, i) => { el.style.viewTransitionName = RR_LEAVING_NAMES[i]; });
      const gen = ++rrVtGeneration;
      const restore = () => { if (gen === rrVtGeneration) rrResetRoundTransitionNames(); };
      // Both handlers, not just a success one: a transition that is skipped
      // (another one started, tab hidden) or that rejects has to hand the real
      // names back too, or the next transition inherits a duplicate
      // rr-leaving-* and gets skipped itself. then(f, f) rather than
      // finally(), so the rejection is handled instead of re-raised.
      document.startViewTransition(applyRoundClasses).finished.then(restore, restore);
    }
  } else {
    applyRoundClasses();
  }

  renderLeaderboard();
}

function renderLeaderboard() {
  const section = document.getElementById('leaderboardSection');
  if (!scheduleData || !scheduleNames) { section.innerHTML = ''; return; }

  // Compute wins/losses keyed by (slotIndex, name) to avoid merging stats
  // when a substitute shares a name with a player in a different slot
  const identityStats = {};  // "slotIdx:name" -> {name, wins, losses, diff}

  for (const round of scheduleData) {
    const rw = roundWinners[round.round];
    if (!rw) continue;
    const rNames = roundNamesMap[round.round] || scheduleNames;
    const rs = roundScores[round.round] || {};
    round.courts.forEach((court, ci) => {
      const w = rw[ci];
      if (!w) return;
      const winTeam = w === 'A' ? court.teamA : court.teamB;
      const loseTeam = w === 'A' ? court.teamB : court.teamA;
      const sc = rs[ci];
      const margin = sc && sc.a != null && sc.b != null ? Math.abs(sc.a - sc.b) : 0;
      const stat = p => {
        const key = p + ':' + rNames[p];
        if (!identityStats[key]) identityStats[key] = { name: rNames[p], wins: 0, losses: 0, diff: 0 };
        return identityStats[key];
      };
      winTeam.forEach(p => { const s = stat(p); s.wins++; s.diff += margin; });
      loseTeam.forEach(p => { const s = stat(p); s.losses++; s.diff -= margin; });
    });
  }
  const playerStats = identityStats;
  const anyScores = Object.keys(roundScores).some(r => roundScores[r] && Object.keys(roundScores[r]).length > 0);

  // Check if any results exist
  const totalGames = Object.values(playerStats).reduce((a, b) => a + b.wins, 0);
  if (totalGames === 0) {
    section.innerHTML = `<div class="leaderboard"><h2>Leaderboard</h2>
      <div class="card" style="text-align:center;padding:2rem;">
        <span style="color:#4b5c72;font-size:0.85rem;">Select winners or enter scores to populate the leaderboard</span>
      </div></div>`;
    return;
  }

  // Build player rows sorted by win%, then wins, then fewer losses
  const players = Object.values(playerStats).map(s => ({
    name: s.name, wins: s.wins, losses: s.losses, diff: s.diff || 0,
    total: s.wins + s.losses,
    pct: (s.wins + s.losses) > 0 ? s.wins / (s.wins + s.losses) : 0
  }));
  players.sort((a, b) => b.pct - a.pct || (anyScores ? b.diff - a.diff : 0) || b.wins - a.wins || a.losses - b.losses);

  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

  rrLeaderboardData = players;

  let html = '<div class="leaderboard"><div class="schedule-header"><h2>Leaderboard</h2><button class="btn-export-pdf" onclick="exportPDF()">Export PDF</button><button class="btn-export-csv" onclick="exportCSV()">Export CSV</button></div>';
  html += '<table class="leaderboard-table"><thead><tr>';
  html += '<th>Player</th><th>W</th><th>L</th><th>Win %</th>' + (anyScores ? '<th>Diff</th>' : '') + '<th class="lb-bar-cell"></th>';
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
      ${anyScores ? `<td class="lb-diff ${p.diff > 0 ? 'lb-diff-pos' : p.diff < 0 ? 'lb-diff-neg' : ''}">${p.diff > 0 ? '+' : ''}${p.diff}</td>` : ''}
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
    roundScores = {};
    roundNamesMap = {};
    // Initialize per-round names from the original names
    for (let r = 1; r <= totalRounds; r++) {
      roundNamesMap[r] = [...names];
    }
    // Fresh schedule → fresh round timer (keep the last chosen duration as default).
    stopRRTimerInterval();
    rrRoundTimer = newRoundTimerState(rrRoundTimer ? (rrRoundTimer.lastDurationSec || 600) : 600);
    rrCurrentRound = null;
  }
  if (!rrRoundTimer) rrRoundTimer = newRoundTimerState(600);
  scheduleData = result.schedule;
  scheduleNames = names;

  let html = `<div class="schedule-header"><h2>Schedule</h2></div>`;
  html += '<div id="currentRoundBanner" class="current-round-banner"></div>';
  // Sits between the upcoming and completed blocks via order: 1. CSS decides
  // whether it is visible; updateRoundStates fills in the count.
  html += '<div id="roundsDivider" class="rounds-divider">' +
    '<span class="rounds-divider-check">✓</span>' +
    '<span class="rounds-divider-text"></span></div>';

  for (const round of result.schedule) {
    const rNames = roundNamesMap[round.round] || names;
    const sitOutNames = round.sitOuts.map(i => esc(rNames[i])).join(', ');
    // A unique, stable view-transition-name lets the browser pair this card's
    // before/after snapshots and animate it individually when order changes.
    html += `<div class="round" id="round-${round.round}" style="view-transition-name:rr-round-${round.round}">
      <div class="round-header">
        <span class="round-title">Round ${round.round}</span>
        <div class="round-header-right">
          ${round.sitOuts.length > 0 ? `<span class="sit-out">On bye: ${sitOutNames}</span>` : ''}
        </div>
      </div>
      <div class="courts">`;

    round.courts.forEach((court, ci) => {
      const nameA = `<span class="serve-badge">SERVE</span>${esc(rNames[court.teamA[0]])} &amp; ${esc(rNames[court.teamA[1]])}`;
      const nameB = `${esc(rNames[court.teamB[0]])} &amp; ${esc(rNames[court.teamB[1]])}`;
      html += `<div class="court">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.4rem;">
          <div class="court-label" style="margin-bottom:0;">${esc(courtNames[ci])}</div>
          <button class="btn-swap" onclick="swapRRPartners(${round.round},${ci})">Swap Partners</button>
        </div>`;
      if (rrScoringMode === 'scores') {
        const sc = (roundScores[round.round] && roundScores[round.round][ci]) || null;
        const va = sc && sc.a != null ? sc.a : '';
        const vb = sc && sc.b != null ? sc.b : '';
        html += `<div class="ladder-matchup">
          <div class="ladder-score-group">
            <span class="team team-a" id="r${round.round}c${ci}a">${nameA}</span>
            <input type="number" class="ladder-score-input" id="rs${round.round}c${ci}a" min="0" max="99" placeholder="0" inputmode="numeric" pattern="[0-9]*" value="${va}" onkeydown="return(event.key.length>1||/[0-9]/.test(event.key))" oninput="rrCheckCourtScore(${round.round},${ci})">
          </div>
          <span class="vs">vs</span>
          <div class="ladder-score-group">
            <span class="team team-b" id="r${round.round}c${ci}b">${nameB}</span>
            <input type="number" class="ladder-score-input" id="rs${round.round}c${ci}b" min="0" max="99" placeholder="0" inputmode="numeric" pattern="[0-9]*" value="${vb}" onkeydown="return(event.key.length>1||/[0-9]/.test(event.key))" oninput="rrCheckCourtScore(${round.round},${ci})">
          </div>
        </div>
        <button class="btn-early" id="rrEarly${round.round}c${ci}" onclick="rrCompleteEarly(${round.round},${ci})" style="display:none;">Complete Game Early</button>
        <div class="rr-score-error-slot" id="rrErr${round.round}c${ci}"></div>`;
      } else {
        html += `<div class="matchup">
          <span class="team team-a" role="button" tabindex="0" id="r${round.round}c${ci}a" onclick="pickWinner(${round.round},${ci},'A')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickWinner(${round.round},${ci},'A')}">${nameA}</span>
          <span class="vs">vs</span>
          <span class="team team-b" role="button" tabindex="0" id="r${round.round}c${ci}b" onclick="pickWinner(${round.round},${ci},'B')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickWinner(${round.round},${ci},'B')}">${nameB}</span>
        </div>`;
      }
      html += `</div>`;
    });

    html += '</div></div>';
  }

  section.innerHTML = html;
  if (rrScoringMode === 'scores') {
    for (const r of result.schedule) {
      for (let ci = 0; ci < numCourtsInSchedule; ci++) rrSyncCourt(r.round, ci);
    }
  }
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
  const anyScores = Object.keys(roundScores).some(r => roundScores[r] && Object.keys(roundScores[r]).length > 0);

  // Leaderboard
  if (rrLeaderboardData.length) {
    csv += 'LEADERBOARD\nRank,Player,W,L,Win %' + (anyScores ? ',Diff' : '') + '\n';
    rrLeaderboardData.forEach((p, i) => {
      const pct = p.total > 0 ? (p.pct * 100).toFixed(0) + '%' : '';
      const diff = anyScores ? ',' + csvCell((p.diff > 0 ? '+' : '') + p.diff) : '';
      csv += `${i + 1},${csvCell(p.name)},${p.wins},${p.losses},${pct}${diff}\n`;
    });
  }

  // Round history
  if (scheduleData) {
    csv += '\nROUND HISTORY\n';
    for (const round of scheduleData) {
      const rNames = roundNamesMap[round.round] || scheduleNames;
      const rw = roundWinners[round.round];
      const rs = roundScores[round.round] || {};
      csv += `\nRound ${round.round}\n`;
      csv += 'Court,Team A,Team B,Score,Winner\n';
      round.courts.forEach((court, ci) => {
        const tA = `${rNames[court.teamA[0]]} & ${rNames[court.teamA[1]]}`;
        const tB = `${rNames[court.teamB[0]]} & ${rNames[court.teamB[1]]}`;
        const winner = rw && rw[ci] ? (rw[ci] === 'A' ? tA : tB) : '';
        const sc = rs[ci];
        const score = sc && sc.a != null && sc.b != null ? `${sc.a}-${sc.b}` : '';
        csv += `${ci + 1},${csvCell(tA)},${csvCell(tB)},${csvCell(score)},${csvCell(winner)}\n`;
      });
      if (round.sitOuts.length > 0) {
        csv += `Bye:,${csvCell(round.sitOuts.map(i => rNames[i]).join(', '))}\n`;
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
renderRRScoringControls();
