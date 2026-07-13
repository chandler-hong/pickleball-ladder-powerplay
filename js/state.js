// --- LocalStorage persistence ---
const STORAGE_KEY = 'pickleball_rr_state';

function saveState() {
  savePlayerData();
  saveCourtData();
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    numPlayers: currentPlayerCount,
    numCourts: currentCourtCount,
    numRounds: document.getElementById('numRounds').value,
    preferMixed: document.getElementById('preferMixed').checked,
    playerData,
    courtData,
    // Schedule state (if generated)
    hasSchedule: !!scheduleData,
    scheduleResult: scheduleData ? { schedule: scheduleData } : null,
    scheduleNames,
    roundNamesMap,
    scheduleCourtNames: scheduleCourtNames,
    roundWinners,
    // Also save the full generateSchedule result for stats
    fullResult: lastFullResult || null,
    rrRoundTimer: rrRoundTimer || null,
    rrScoringMode,
    rrWinBy,
    roundScores,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(e) {}
  if (!state) return false;
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) { clearSavedState(); return false; }

  try {
    // Restore setup values
    document.getElementById('numPlayers').value = state.numPlayers || 20;
    document.getElementById('numCourts').value = state.numCourts || 4;
    document.getElementById('numRounds').value = state.numRounds || 10;
    document.getElementById('preferMixed').checked = state.preferMixed !== false;

    // Restore Round-Robin scoring prefs + entered scores (before renderSchedule
    // so the schedule renders in the right mode with scores prefilled).
    rrScoringMode = (state.rrScoringMode === 'scores') ? 'scores' : 'winner';
    rrWinBy = (state.rrWinBy === 2) ? 2 : 1;
    roundScores = state.roundScores || {};
    renderRRScoringControls();

    // Restore grids (skipSave=true to avoid overwriting restored data)
    playerData = state.playerData || [];
    courtData = state.courtData || [];
    buildPlayerGrid(state.numPlayers || 20, true);
    buildCourtInputs(state.numCourts || 4, true);

    // Restore schedule if it was generated
    if (state.hasSchedule && state.scheduleResult && state.scheduleNames) {
      scheduleCourtNames = state.scheduleCourtNames || [];
      lastFullResult = state.fullResult || null;
      roundNamesMap = state.roundNamesMap || {};
      rrRoundTimer = state.rrRoundTimer || null; // set before renderSchedule so it's preserved
      renderSchedule(state.scheduleResult, state.scheduleNames, scheduleCourtNames, !!state.roundNamesMap);
      if (lastFullResult) renderStats(lastFullResult, state.scheduleNames);
      roundWinners = state.roundWinners || {};
      updateRoundStates();
      resumeRRTimerOnRestore();
      document.getElementById('output').style.display = 'block';
    }

    return true;
  } catch (e) {
    // Corrupt or incompatible payload — reset rather than brick the boot.
    clearSavedState();
    return false;
  }
}

function clearSavedState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

// --- Mode switching ---
function setMode(mode) {
  const rrSetup = document.getElementById('rrSetup');
  const ladderSetup = document.getElementById('ladderSetup');
  const ladderOutput = document.getElementById('ladderOutput');
  if (mode === 'ladder') {
    rrSetup.style.display = 'none';
    ladderSetup.style.display = 'block';
    if (ladderState) ladderOutput.style.display = 'block';
  } else {
    rrSetup.style.display = '';
    ladderSetup.style.display = 'none';
    ladderOutput.style.display = 'none';
  }
}
document.getElementById('modeRR').addEventListener('change', () => setMode('rr'));
document.getElementById('modeLadder').addEventListener('change', () => {
  setMode('ladder');
  if (!document.getElementById('ladderPlayerGrid').children.length) buildLadderPlayerGrid();
  buildLadderCourtInputs();
  buildLadderCourtAssignments();
  updateLadderSetupMessage();
});

// Boot code is in index.html after all scripts load
