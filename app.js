const firebaseConfig = {
  apiKey: 'AIzaSyC9X3Y9xi_nVJCCaaChAT5v-o2fIVuITIM',
  authDomain: 'closed2026-e85d4.firebaseapp.com',
  databaseURL: 'https://closed2026-e85d4-default-rtdb.firebaseio.com',
  projectId: 'closed2026-e85d4',
  storageBucket: 'closed2026-e85d4.firebasestorage.app',
  messagingSenderId: '740505943872',
  appId: '1:740505943872:web:d10b72ffb138baabae04a5',
};

const TEAMS = {
  A: ['Pete', 'Shane', 'Bush'],
  B: ['Cole', 'Scarr', 'Jordy'],
};

const DAYS = [
  {
    id: 1,
    name: 'Day 1',
    course: 'Ridge',
    bestBall: { teamA: ['Pete', 'Shane'], teamB: ['Jordy', 'Cole'] },
    singles: { a: 'Bush', b: 'Scarr' },
    par: [4, 4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 3, 4, 5, 4, 5, 3, 4],
  },
  {
    id: 2,
    name: 'Day 2',
    course: 'Mill',
    bestBall: { teamA: ['Pete', 'Bush'], teamB: ['Cole', 'Scarr'] },
    singles: { a: 'Shane', b: 'Jordy' },
    par: [4, 3, 5, 3, 5, 3, 4, 4, 4, 4, 3, 4, 4, 4, 4, 4, 3, 5],
  },
  {
    id: 3,
    name: 'Day 3',
    course: 'Wissota',
    bestBall: { teamA: ['Shane', 'Bush'], teamB: ['Scarr', 'Jordy'] },
    singles: { a: 'Pete', b: 'Cole' },
    par: [4, 3, 5, 3, 4, 4, 5, 4, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4],
  },
];

const STORAGE_KEY = 'closed715-tournament-v1';
const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);
const FRONT = HOLES.slice(0, 9);
const BACK = HOLES.slice(9, 18);

function emptyHole() {
  return {};
}

// Normalizes raw hole data (from localStorage or a Firebase snapshot, which
// may be null, partial, or array-shaped) into a fixed 18-entry array.
function normalizeHoles(raw) {
  const holes = HOLES.map(emptyHole);
  if (!raw) return holes;
  Object.keys(raw).forEach((key) => {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < 18 && raw[key]) {
      holes[idx] = { ...raw[key] };
    }
  });
  return holes;
}

function normalizeState(rawDays) {
  const state = { days: {} };
  DAYS.forEach((d) => {
    const rd = rawDays && rawDays[d.id];
    state.days[d.id] = {
      bestBall: { holes: normalizeHoles(rd && rd.bestBall && rd.bestBall.holes) },
      singles: { holes: normalizeHoles(rd && rd.singles && rd.singles.holes) },
    };
  });
  return state;
}

function loadCachedState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    saved = null;
  }
  return normalizeState(saved && saved.days);
}

function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadCachedState();
let activeDay = 1;

// References to DOM nodes that need lightweight updates after a score
// changes, without rebuilding the input tables (which would drop focus
// mid-keystroke, or clobber a value someone else is entering on another
// device right now). Rebuilt only when the visible day changes.
let refs = null;

// Firebase wiring. Loaded dynamically (not a static top-level import) so
// that if the CDN is unreachable — spotty course wifi, a blocked network —
// the app still boots from local storage instead of failing to load.
let fbDb = null;
let fbRef = null;
let fbOnValue = null;
let fbSet = null;
let fbRemove = null;
let firebaseReady = false;

async function initFirebase() {
  try {
    const [{ initializeApp }, { getDatabase, ref, onValue, set, remove }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    fbDb = getDatabase(app);
    fbRef = ref;
    fbOnValue = onValue;
    fbSet = set;
    fbRemove = remove;
    firebaseReady = true;
    setSyncStatus('connecting');

    fbOnValue(
      fbRef(fbDb, 'days'),
      (snapshot) => {
        state = normalizeState(snapshot.val());
        saveCache();
        syncFromRemote();
        setSyncStatus('live');
      },
      (err) => {
        console.error('Firebase read failed', err);
        setSyncStatus('offline');
      }
    );
  } catch (err) {
    console.error('Firebase unavailable, using local-only storage', err);
    setSyncStatus('offline');
  }
}

function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  if (status === 'live') {
    el.textContent = 'Live — synced with everyone';
    el.className = 'sync-status sync-live';
  } else if (status === 'connecting') {
    el.textContent = 'Connecting…';
    el.className = 'sync-status sync-connecting';
  } else {
    el.textContent = 'Offline — scores saved on this device only';
    el.className = 'sync-status sync-offline';
  }
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bestBallHoleResult(holeData, teamAPlayers, teamBPlayers) {
  const aVals = teamAPlayers.map((p) => numOrNull(holeData[p])).filter((v) => v !== null);
  const bVals = teamBPlayers.map((p) => numOrNull(holeData[p])).filter((v) => v !== null);
  if (aVals.length === 0 || bVals.length === 0) return { status: 'pending', aPts: 0, bPts: 0 };
  const aScore = Math.min(...aVals);
  const bScore = Math.min(...bVals);
  if (aScore < bScore) return { status: 'a', aPts: 1, bPts: 0, aScore, bScore };
  if (bScore < aScore) return { status: 'b', aPts: 0, bPts: 1, aScore, bScore };
  return { status: 'halve', aPts: 0.5, bPts: 0.5, aScore, bScore };
}

function singlesHoleResult(holeData, playerA, playerB) {
  const rawA = numOrNull(holeData[playerA]);
  const rawB = numOrNull(holeData[playerB]);
  const rawJov = numOrNull(holeData['Jov']);
  if (rawA === null || rawB === null) return { status: 'pending', aPts: 0, bPts: 0 };
  if (rawJov !== null && rawJov < rawA && rawJov < rawB) {
    return { status: 'push-beer', aPts: 0, bPts: 0 };
  }
  const effA = rawJov !== null ? Math.min(rawA, rawJov) : rawA;
  const effB = rawJov !== null ? Math.min(rawB, rawJov) : rawB;
  if (effA < effB) return { status: 'a', aPts: 1, bPts: 0, usedJovA: rawJov !== null && rawJov < rawA };
  if (effB < effA) return { status: 'b', aPts: 0, bPts: 1, usedJovB: rawJov !== null && rawJov < rawB };
  return { status: 'halve', aPts: 0.5, bPts: 0.5 };
}

function computeTotals() {
  let teamA = 0;
  let teamB = 0;
  const beerEvents = [];

  DAYS.forEach((day) => {
    const dayState = state.days[day.id];
    dayState.bestBall.holes.forEach((holeData) => {
      const r = bestBallHoleResult(holeData, day.bestBall.teamA, day.bestBall.teamB);
      teamA += r.aPts;
      teamB += r.bPts;
    });
    dayState.singles.holes.forEach((holeData, idx) => {
      const r = singlesHoleResult(holeData, day.singles.a, day.singles.b);
      teamA += r.aPts;
      teamB += r.bPts;
      if (r.status === 'push-beer') {
        beerEvents.push({ day, hole: idx + 1, a: day.singles.a, b: day.singles.b });
      }
    });
  });

  return { teamA, teamB, beerEvents };
}

function fmtPts(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderTabs() {
  const nav = document.getElementById('dayTabs');
  nav.innerHTML = '';
  DAYS.forEach((day) => {
    const tab = document.createElement('div');
    tab.className = 'day-tab' + (day.id === activeDay ? ' active' : '');
    tab.innerHTML = `${day.name}<span class="course">${day.course}</span>`;
    tab.addEventListener('click', () => {
      if (activeDay === day.id) return;
      activeDay = day.id;
      renderTabs();
      renderMain();
    });
    nav.appendChild(tab);
  });
}

function handleScoreChange(day, matchType, holeIndex, player, rawValue) {
  const holeData = state.days[day.id][matchType].holes[holeIndex];
  if (rawValue === '') {
    delete holeData[player];
  } else {
    holeData[player] = rawValue;
  }
  saveCache();

  if (firebaseReady) {
    const path = `days/${day.id}/${matchType}/holes/${holeIndex}/${player}`;
    const op = rawValue === '' ? fbRemove(fbRef(fbDb, path)) : fbSet(fbRef(fbDb, path), rawValue);
    op.catch((err) => {
      console.error('Sync failed', err);
      setSyncStatus('offline');
    });
  }

  refreshDerived(day);
}

function holeInput(day, matchType, holeIndex, player, value, inputRefs) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.inputMode = 'numeric';
  input.value = value === undefined || value === null ? '' : value;
  input.addEventListener('input', (e) => {
    handleScoreChange(day, matchType, holeIndex, player, e.target.value);
  });
  inputRefs[`${matchType}|${holeIndex}|${player}`] = input;
  return input;
}

function buildParRow(day, holesSubset, startIdx) {
  const parRow = document.createElement('tr');
  parRow.className = 'par-row';
  const parLabel = document.createElement('td');
  parLabel.className = 'player-label';
  parLabel.textContent = 'Par';
  parRow.appendChild(parLabel);
  holesSubset.forEach((h, i) => {
    const idx = startIdx + i;
    const td = document.createElement('td');
    td.textContent = day.par[idx];
    parRow.appendChild(td);
  });
  return parRow;
}

function buildBestBallTable(day, holesSubset, startIdx, resultCellRefs, inputRefs) {
  const table = document.createElement('table');
  table.className = 'holes';
  const players = [...day.bestBall.teamA, ...day.bestBall.teamB];

  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th class="player-label">Hole</th>' + holesSubset.map((h) => `<th>${h}</th>`).join('');
  table.appendChild(headRow);
  table.appendChild(buildParRow(day, holesSubset, startIdx));

  players.forEach((p) => {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    const team = day.bestBall.teamA.includes(p) ? 'A' : 'B';
    label.className = 'player-label ' + (team === 'A' ? 'label-team-a' : 'label-team-b');
    label.textContent = p;
    row.appendChild(label);
    holesSubset.forEach((h, i) => {
      const idx = startIdx + i;
      const td = document.createElement('td');
      const holeData = state.days[day.id].bestBall.holes[idx];
      td.appendChild(holeInput(day, 'bestBall', idx, p, holeData[p], inputRefs));
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  const resultRow = document.createElement('tr');
  resultRow.className = 'result-row';
  const resLabel = document.createElement('td');
  resLabel.className = 'player-label';
  resLabel.textContent = 'Hole';
  resultRow.appendChild(resLabel);
  holesSubset.forEach((h, i) => {
    const idx = startIdx + i;
    const td = document.createElement('td');
    td.classList.add('res-pending');
    resultRow.appendChild(td);
    resultCellRefs[idx] = td;
  });
  table.appendChild(resultRow);

  return table;
}

function buildSinglesTable(day, holesSubset, startIdx, resultCellRefs, inputRefs) {
  const table = document.createElement('table');
  table.className = 'holes';
  const players = [day.singles.a, day.singles.b, 'Jov'];

  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th class="player-label">Hole</th>' + holesSubset.map((h) => `<th>${h}</th>`).join('');
  table.appendChild(headRow);
  table.appendChild(buildParRow(day, holesSubset, startIdx));

  players.forEach((p) => {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    let labelClass = 'label-jov';
    if (p === day.singles.a) labelClass = 'label-team-a';
    else if (p === day.singles.b) labelClass = 'label-team-b';
    label.className = 'player-label ' + labelClass;
    label.textContent = p;
    row.appendChild(label);
    holesSubset.forEach((h, i) => {
      const idx = startIdx + i;
      const td = document.createElement('td');
      const holeData = state.days[day.id].singles.holes[idx];
      td.appendChild(holeInput(day, 'singles', idx, p, holeData[p], inputRefs));
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  const resultRow = document.createElement('tr');
  resultRow.className = 'result-row';
  const resLabel = document.createElement('td');
  resLabel.className = 'player-label';
  resLabel.textContent = 'Hole';
  resultRow.appendChild(resLabel);
  holesSubset.forEach((h, i) => {
    const idx = startIdx + i;
    const td = document.createElement('td');
    td.classList.add('res-pending');
    resultRow.appendChild(td);
    resultCellRefs[idx] = td;
  });
  table.appendChild(resultRow);

  return table;
}

function matchPointsSummary(aLabel, bLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'match-points';
  const spanA = document.createElement('span');
  spanA.style.color = 'var(--team-a)';
  const spanB = document.createElement('span');
  spanB.style.color = 'var(--team-b)';
  wrap.appendChild(spanA);
  wrap.appendChild(spanB);
  return { wrap, spanA, spanB, aLabel, bLabel };
}

function renderMain() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const day = DAYS.find((d) => d.id === activeDay);

  refs = {
    bestBallCells: {},
    singlesCells: {},
    inputs: {},
    bestBallSummary: null,
    singlesSummary: null,
  };

  // Best ball card
  const bbCard = document.createElement('div');
  bbCard.className = 'match-card';
  bbCard.innerHTML = `<h2>Best Ball</h2><p class="match-sub">${day.bestBall.teamA.join('/')} vs ${day.bestBall.teamB.join('/')} &mdash; ${day.course}</p>`;
  const bbSummary = matchPointsSummary(day.bestBall.teamA.join('/'), day.bestBall.teamB.join('/'));
  refs.bestBallSummary = bbSummary;
  bbCard.appendChild(bbSummary.wrap);
  const bbFront = document.createElement('div');
  bbFront.className = 'nine-block';
  bbFront.appendChild(buildBestBallTable(day, FRONT, 0, refs.bestBallCells, refs.inputs));
  const bbBack = document.createElement('div');
  bbBack.className = 'nine-block';
  bbBack.appendChild(buildBestBallTable(day, BACK, 9, refs.bestBallCells, refs.inputs));
  bbCard.appendChild(bbFront);
  bbCard.appendChild(bbBack);
  app.appendChild(bbCard);

  // Singles card
  const sgCard = document.createElement('div');
  sgCard.className = 'match-card';
  sgCard.innerHTML = `<h2>Singles</h2><p class="match-sub">${day.singles.a} vs ${day.singles.b} &mdash; Jov can back up either player &mdash; ${day.course}</p>`;
  const sgSummary = matchPointsSummary(day.singles.a, day.singles.b);
  refs.singlesSummary = sgSummary;
  sgCard.appendChild(sgSummary.wrap);
  const sgFront = document.createElement('div');
  sgFront.className = 'nine-block';
  sgFront.appendChild(buildSinglesTable(day, FRONT, 0, refs.singlesCells, refs.inputs));
  const sgBack = document.createElement('div');
  sgBack.className = 'nine-block';
  sgBack.appendChild(buildSinglesTable(day, BACK, 9, refs.singlesCells, refs.inputs));
  sgCard.appendChild(sgFront);
  sgCard.appendChild(sgBack);
  app.appendChild(sgCard);

  refreshDerived(day);
}

function resultCellClassAndLabel(status) {
  if (status === 'a') return ['res-a', 'A'];
  if (status === 'b') return ['res-b', 'B'];
  if (status === 'halve') return ['res-halve', '½'];
  if (status === 'push-beer') return ['res-push', 'PSH'];
  return ['res-pending', ''];
}

const SCORE_REL_CLASSES = ['score-eagle', 'score-birdie', 'score-par', 'score-bogey', 'score-double'];

function scoreRelClass(score, par) {
  const diff = score - par;
  if (diff <= -2) return 'score-eagle';
  if (diff === -1) return 'score-birdie';
  if (diff === 0) return 'score-par';
  if (diff === 1) return 'score-bogey';
  return 'score-double';
}

// Colors each score input relative to par (birdie, bogey, etc.) for the
// currently visible day.
function updateScoreStyles(day) {
  if (!refs) return;
  Object.keys(refs.inputs).forEach((key) => {
    const input = refs.inputs[key];
    const [matchType, idxStr, player] = key.split('|');
    const idx = Number(idxStr);
    const val = numOrNull(state.days[day.id][matchType].holes[idx][player]);
    input.classList.remove(...SCORE_REL_CLASSES);
    if (val !== null) {
      input.classList.add(scoreRelClass(val, day.par[idx]));
    }
  });
}

// Updates only text/class of already-built cells (no DOM rebuild), so
// inputs never lose focus while someone is mid-keystroke.
function refreshDerived(day) {
  if (!refs || DAYS.find((d) => d.id === activeDay).id !== day.id) {
    // Viewing a different day than the one that changed; only totals/beer
    // list need to move.
    renderScoreboard();
    return;
  }

  let bbA = 0;
  let bbB = 0;
  state.days[day.id].bestBall.holes.forEach((holeData, idx) => {
    const r = bestBallHoleResult(holeData, day.bestBall.teamA, day.bestBall.teamB);
    bbA += r.aPts;
    bbB += r.bPts;
    const td = refs.bestBallCells[idx];
    if (td) {
      const [cls, label] = resultCellClassAndLabel(r.status);
      td.className = cls;
      td.textContent = label;
    }
  });
  refs.bestBallSummary.spanA.textContent = `${refs.bestBallSummary.aLabel}: ${fmtPts(bbA)}`;
  refs.bestBallSummary.spanB.textContent = `${refs.bestBallSummary.bLabel}: ${fmtPts(bbB)}`;

  let sgA = 0;
  let sgB = 0;
  state.days[day.id].singles.holes.forEach((holeData, idx) => {
    const r = singlesHoleResult(holeData, day.singles.a, day.singles.b);
    sgA += r.aPts;
    sgB += r.bPts;
    const td = refs.singlesCells[idx];
    if (td) {
      const [cls, label] = resultCellClassAndLabel(r.status);
      td.className = cls;
      td.textContent = label;
    }
  });
  refs.singlesSummary.spanA.textContent = `${refs.singlesSummary.aLabel}: ${fmtPts(sgA)}`;
  refs.singlesSummary.spanB.textContent = `${refs.singlesSummary.bLabel}: ${fmtPts(sgB)}`;

  updateScoreStyles(day);
  renderScoreboard();
}

// Called when new data arrives from Firebase (possibly entered by someone
// else's phone). Pushes fresh values into any input the local user isn't
// actively typing into, then refreshes results/totals.
function syncFromRemote() {
  const day = DAYS.find((d) => d.id === activeDay);
  if (refs) {
    const active = document.activeElement;
    Object.keys(refs.inputs).forEach((key) => {
      const input = refs.inputs[key];
      if (input === active) return;
      const [matchType, idxStr, player] = key.split('|');
      const idx = Number(idxStr);
      const holeData = state.days[day.id][matchType].holes[idx];
      const v = holeData[player];
      const newVal = v === undefined || v === null ? '' : v;
      if (input.value !== newVal) input.value = newVal;
    });
  }
  refreshDerived(day);
}

function renderScoreboard() {
  const { teamA, teamB, beerEvents } = computeTotals();
  document.getElementById('teamAPoints').textContent = fmtPts(teamA);
  document.getElementById('teamBPoints').textContent = fmtPts(teamB);

  const beerList = document.getElementById('beerList');
  beerList.innerHTML = '';
  if (beerEvents.length === 0) {
    const p = document.createElement('p');
    p.className = 'beer-empty';
    p.textContent = 'No pushes yet.';
    beerList.appendChild(p);
  } else {
    beerEvents.forEach((ev) => {
      const item = document.createElement('div');
      item.className = 'beer-item';
      item.textContent = `${ev.day.name} (${ev.day.course}), Hole ${ev.hole}: Jov beat both ${ev.a} and ${ev.b} — shotgun time.`;
      beerList.appendChild(item);
    });
  }
}

function render() {
  renderTabs();
  renderMain();
}

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Reset all scores for the entire tournament? This cannot be undone.')) {
    if (firebaseReady) {
      fbRemove(fbRef(fbDb, 'days')).catch((err) => console.error('Reset sync failed', err));
    }
    localStorage.removeItem(STORAGE_KEY);
    state = normalizeState(null);
    activeDay = 1;
    render();
  }
});

render();
initFirebase();
