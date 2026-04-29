// --- LocalStorage persistence ---
const STORAGE_KEY = 'powerplay_pickleball_state';

function saveState() {
  savePlayerData();
  saveCourtData();
  const state = {
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
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(e) {}
  if (!state) return false;

  // Restore setup values
  document.getElementById('numPlayers').value = state.numPlayers || 20;
  document.getElementById('numCourts').value = state.numCourts || 4;
  document.getElementById('numRounds').value = state.numRounds || 10;
  document.getElementById('preferMixed').checked = state.preferMixed !== false;

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
    renderSchedule(state.scheduleResult, state.scheduleNames, scheduleCourtNames, !!state.roundNamesMap);
    if (lastFullResult) renderStats(lastFullResult, state.scheduleNames);
    roundWinners = state.roundWinners || {};
    updateRoundStates();
    document.getElementById('output').style.display = 'block';
  }

  return true;
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
  updateLadderSetupMessage();
});

// Boot code is in index.html after all scripts load
