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
  const indicator = document.getElementById('syncIndicator');
  const main = document.getElementById('syncMain');
  if (!indicator || !main) return;
  indicator.className = 'sync-indicator sync-' + status;
  if (status === 'live') {
    main.textContent = 'Live';
  } else if (status === 'connecting') {
    main.textContent = 'Connecting';
  } else {
    main.textContent = 'Offline';
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

// After a brief pause (long enough to type a two-digit score), moves focus
// to the next player's box for the same hole — so entering scores down a
// column doesn't require tapping each field by hand.
const AUTO_ADVANCE_DELAY = 250;

function holeInput(day, matchType, holeIndex, player, value, inputRefs, nextPlayer) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.inputMode = 'numeric';
  input.value = value === undefined || value === null ? '' : value;
  let advanceTimer = null;
  input.addEventListener('input', (e) => {
    handleScoreChange(day, matchType, holeIndex, player, e.target.value);
    if (advanceTimer) clearTimeout(advanceTimer);
    if (nextPlayer && e.target.value !== '') {
      advanceTimer = setTimeout(() => {
        const nextInput = inputRefs[`${matchType}|${holeIndex}|${nextPlayer}`];
        if (nextInput) nextInput.focus();
      }, AUTO_ADVANCE_DELAY);
    }
  });
  input.addEventListener('blur', () => {
    if (advanceTimer) clearTimeout(advanceTimer);
  });
  inputRefs[`${matchType}|${holeIndex}|${player}`] = input;
  return input;
}

// Sums a player's entered scores over [start, start+count). Returns null
// (rendered as a blank cell) if nothing has been entered in that range yet.
function sumRange(holes, start, count, player) {
  let total = 0;
  let any = false;
  for (let i = start; i < start + count; i++) {
    const v = numOrNull(holes[i][player]);
    if (v !== null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function sumPar(par, start, count) {
  let total = 0;
  for (let i = start; i < start + count; i++) total += par[i];
  return total;
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
  if (holesSubset === FRONT) {
    const td = document.createElement('td');
    td.className = 'total-cell';
    td.textContent = sumPar(day.par, 0, 9);
    parRow.appendChild(td);
  } else if (holesSubset === BACK) {
    const inTd = document.createElement('td');
    inTd.className = 'total-cell';
    inTd.textContent = sumPar(day.par, 9, 9);
    parRow.appendChild(inTd);
    const totTd = document.createElement('td');
    totTd.className = 'total-cell';
    totTd.textContent = sumPar(day.par, 0, 18);
    parRow.appendChild(totTd);
  }
  return parRow;
}

// FRONT gets an "OUT" total column, BACK gets "IN" and "TOT" columns,
// mirroring a physical scorecard. totalsRefs accumulates per-player DOM
// refs across both the front and back table builds so refreshDerived can
// update out/in/tot together later.
function totalHeaderHtml(holesSubset) {
  if (holesSubset === FRONT) return '<th>OUT</th>';
  if (holesSubset === BACK) return '<th>IN</th><th>TOT</th>';
  return '';
}

function appendTotalCells(row, holesSubset, totalsRefs, player) {
  totalsRefs[player] = totalsRefs[player] || {};
  if (holesSubset === FRONT) {
    const td = document.createElement('td');
    td.className = 'total-cell';
    row.appendChild(td);
    totalsRefs[player].out = td;
  } else if (holesSubset === BACK) {
    const inTd = document.createElement('td');
    inTd.className = 'total-cell';
    row.appendChild(inTd);
    const totTd = document.createElement('td');
    totTd.className = 'total-cell';
    row.appendChild(totTd);
    totalsRefs[player].in = inTd;
    totalsRefs[player].tot = totTd;
  }
}

function appendResultSpacerCells(resultRow, holesSubset) {
  if (holesSubset === FRONT) {
    resultRow.appendChild(document.createElement('td'));
  } else if (holesSubset === BACK) {
    resultRow.appendChild(document.createElement('td'));
    resultRow.appendChild(document.createElement('td'));
  }
}

function buildBestBallTable(day, holesSubset, startIdx, resultCellRefs, inputRefs, totalsRefs) {
  const table = document.createElement('table');
  table.className = 'holes';
  const players = [...day.bestBall.teamA, ...day.bestBall.teamB];

  const headRow = document.createElement('tr');
  headRow.innerHTML =
    '<th class="player-label">Hole</th>' + holesSubset.map((h) => `<th>${h}</th>`).join('') + totalHeaderHtml(holesSubset);
  table.appendChild(headRow);
  table.appendChild(buildParRow(day, holesSubset, startIdx));

  players.forEach((p, playerIdx) => {
    const row = document.createElement('tr');
    row.className = 'player-row' + (playerIdx % 2 === 1 ? ' zebra' : '');
    const label = document.createElement('td');
    const team = day.bestBall.teamA.includes(p) ? 'A' : 'B';
    label.className = 'player-label ' + (team === 'A' ? 'label-team-a' : 'label-team-b');
    label.textContent = p;
    row.appendChild(label);
    const nextPlayer = players[playerIdx + 1];
    holesSubset.forEach((h, i) => {
      const idx = startIdx + i;
      const td = document.createElement('td');
      const holeData = state.days[day.id].bestBall.holes[idx];
      td.appendChild(holeInput(day, 'bestBall', idx, p, holeData[p], inputRefs, nextPlayer));
      row.appendChild(td);
    });
    appendTotalCells(row, holesSubset, totalsRefs, p);
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
  appendResultSpacerCells(resultRow, holesSubset);
  table.appendChild(resultRow);

  return table;
}

function buildSinglesTable(day, holesSubset, startIdx, resultCellRefs, inputRefs, totalsRefs) {
  const table = document.createElement('table');
  table.className = 'holes';
  const players = [day.singles.a, day.singles.b, 'Jov'];

  const headRow = document.createElement('tr');
  headRow.innerHTML =
    '<th class="player-label">Hole</th>' + holesSubset.map((h) => `<th>${h}</th>`).join('') + totalHeaderHtml(holesSubset);
  table.appendChild(headRow);
  table.appendChild(buildParRow(day, holesSubset, startIdx));

  players.forEach((p, playerIdx) => {
    const row = document.createElement('tr');
    row.className = 'player-row' + (playerIdx % 2 === 1 ? ' zebra' : '');
    const label = document.createElement('td');
    let labelClass = 'label-jov';
    if (p === day.singles.a) labelClass = 'label-team-a';
    else if (p === day.singles.b) labelClass = 'label-team-b';
    label.className = 'player-label ' + labelClass;
    label.textContent = p;
    row.appendChild(label);
    const nextPlayer = players[playerIdx + 1];
    holesSubset.forEach((h, i) => {
      const idx = startIdx + i;
      const td = document.createElement('td');
      const holeData = state.days[day.id].singles.holes[idx];
      td.appendChild(holeInput(day, 'singles', idx, p, holeData[p], inputRefs, nextPlayer));
      row.appendChild(td);
    });
    appendTotalCells(row, holesSubset, totalsRefs, p);
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
  appendResultSpacerCells(resultRow, holesSubset);
  table.appendChild(resultRow);

  return table;
}

// Builds a collapsible match card: header (title, Thru badge, subtitle) and
// a scoreline row (team names stacked either side of the running score) are
// always visible; the hole tables are hidden until the toggle bar is
// clicked. Tables stay in the DOM while collapsed (just hidden via CSS) so
// score updates keep flowing to them regardless of open/closed state.
// sideANames/sideBNames are arrays of player names, stacked one per line.
function buildMatchCardShell(title, subtitleHtml, sideANames, sideBNames) {
  const card = document.createElement('div');
  card.className = 'match-card';

  const header = document.createElement('div');
  header.className = 'match-header';
  header.innerHTML = `
    <div class="match-header-left">
      <div class="match-title-row">
        <h2>${title}</h2>
        <span class="live-badge" hidden>Live</span>
      </div>
      ${subtitleHtml ? `<p class="match-sub">${subtitleHtml}</p>` : ''}
    </div>
    <span class="match-thru" hidden></span>
  `;
  const liveBadge = header.querySelector('.live-badge');
  const thruText = header.querySelector('.match-thru');

  function buildSide(names, align) {
    const wrap = document.createElement('div');
    wrap.className = 'scoreline-side scoreline-' + align;
    names.forEach((name) => {
      const line = document.createElement('div');
      line.className = 'scoreline-name';
      line.textContent = name;
      wrap.appendChild(line);
    });
    return wrap;
  }

  const scoreline = document.createElement('div');
  scoreline.className = 'match-scoreline';
  const sideA = buildSide(sideANames, 'a');
  const scoreChip = document.createElement('div');
  scoreChip.className = 'match-score-chip';
  const spanA = document.createElement('span');
  spanA.className = 'chip-a';
  const sep = document.createElement('span');
  sep.className = 'chip-sep';
  sep.textContent = '–';
  const spanB = document.createElement('span');
  spanB.className = 'chip-b';
  scoreChip.appendChild(spanA);
  scoreChip.appendChild(sep);
  scoreChip.appendChild(spanB);
  const sideB = buildSide(sideBNames, 'b');
  scoreline.appendChild(sideA);
  scoreline.appendChild(scoreChip);
  scoreline.appendChild(sideB);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'match-toggle';
  toggleBtn.textContent = 'Score this match';

  const body = document.createElement('div');
  body.className = 'match-body';

  toggleBtn.addEventListener('click', () => {
    const expanded = card.classList.toggle('expanded');
    toggleBtn.textContent = expanded ? 'Hide scorecard' : 'Score this match';
  });

  card.appendChild(header);
  card.appendChild(scoreline);
  card.appendChild(toggleBtn);
  card.appendChild(body);

  return { card, body, spanA, spanB, liveBadge, thruText };
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
    bestBallTotals: {},
    singlesTotals: {},
  };

  // Best ball card
  const bbShell = buildMatchCardShell(
    'Best Ball',
    '',
    day.bestBall.teamA,
    day.bestBall.teamB
  );
  refs.bestBallSummary = bbShell;
  const bbFront = document.createElement('div');
  bbFront.className = 'nine-block';
  bbFront.appendChild(buildBestBallTable(day, FRONT, 0, refs.bestBallCells, refs.inputs, refs.bestBallTotals));
  const bbBack = document.createElement('div');
  bbBack.className = 'nine-block';
  bbBack.appendChild(buildBestBallTable(day, BACK, 9, refs.bestBallCells, refs.inputs, refs.bestBallTotals));
  bbShell.body.appendChild(bbFront);
  bbShell.body.appendChild(bbBack);
  app.appendChild(bbShell.card);

  // Singles card
  const sgShell = buildMatchCardShell(
    'Singles',
    'Jov can back up either player',
    [day.singles.a],
    [day.singles.b]
  );
  refs.singlesSummary = sgShell;
  const sgFront = document.createElement('div');
  sgFront.className = 'nine-block';
  sgFront.appendChild(buildSinglesTable(day, FRONT, 0, refs.singlesCells, refs.inputs, refs.singlesTotals));
  const sgBack = document.createElement('div');
  sgBack.className = 'nine-block';
  sgBack.appendChild(buildSinglesTable(day, BACK, 9, refs.singlesCells, refs.inputs, refs.singlesTotals));
  sgShell.body.appendChild(sgFront);
  sgShell.body.appendChild(sgBack);
  app.appendChild(sgShell.card);

  refreshDerived(day);
}

// Updates each player's OUT/IN/TOT total cells for the currently visible
// day, based on whatever scores are entered so far.
function updateTotals(day) {
  if (!refs) return;

  function updateFor(holes, totalsRefs, players) {
    players.forEach((p) => {
      const t = totalsRefs[p];
      if (!t) return;
      const out = sumRange(holes, 0, 9, p);
      const inn = sumRange(holes, 9, 9, p);
      const tot = sumRange(holes, 0, 18, p);
      if (t.out) t.out.textContent = out === null ? '' : out;
      if (t.in) t.in.textContent = inn === null ? '' : inn;
      if (t.tot) t.tot.textContent = tot === null ? '' : tot;
    });
  }

  updateFor(state.days[day.id].bestBall.holes, refs.bestBallTotals, [...day.bestBall.teamA, ...day.bestBall.teamB]);
  updateFor(state.days[day.id].singles.holes, refs.singlesTotals, [day.singles.a, day.singles.b, 'Jov']);
}

// Shows a "Live" badge once any score has been entered for a match, which
// switches to "Completed" once every hole has a result, plus a "Thru N"
// readout counting holes where every required score is in.
function updateMatchStatus(shell, anyScore, completedHoles) {
  const isComplete = completedHoles === HOLES.length;
  shell.liveBadge.hidden = !anyScore;
  shell.liveBadge.textContent = isComplete ? 'Completed' : 'Live';
  shell.liveBadge.classList.toggle('badge-completed', isComplete);
  shell.thruText.hidden = completedHoles === 0;
  if (completedHoles > 0) {
    shell.thruText.textContent = `Thru ${completedHoles}`;
  }
}

function resultCellClassAndLabel(status) {
  if (status === 'a') return ['res-a', 'A'];
  if (status === 'b') return ['res-b', 'B'];
  if (status === 'halve') return ['res-halve', '½'];
  if (status === 'push-beer') return ['res-push', 'PSH'];
  return ['res-pending', ''];
}

const SCORE_REL_CLASSES = ['score-eagle', 'score-birdie', 'score-bogey'];

// Eagle-or-better -> yellow circle, birdie -> blue circle, par -> untouched,
// bogey-or-worse -> red square (classic scorecard marks).
function scoreRelClass(score, par) {
  const diff = score - par;
  if (diff <= -2) return 'score-eagle';
  if (diff === -1) return 'score-birdie';
  if (diff >= 1) return 'score-bogey';
  return null;
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
      const cls = scoreRelClass(val, day.par[idx]);
      if (cls) input.classList.add(cls);
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
  let bbCompleted = 0;
  let bbAny = false;
  state.days[day.id].bestBall.holes.forEach((holeData, idx) => {
    const r = bestBallHoleResult(holeData, day.bestBall.teamA, day.bestBall.teamB);
    bbA += r.aPts;
    bbB += r.bPts;
    if (r.status !== 'pending') bbCompleted += 1;
    if (Object.keys(holeData).length > 0) bbAny = true;
    const td = refs.bestBallCells[idx];
    if (td) {
      const [cls, label] = resultCellClassAndLabel(r.status);
      td.className = cls;
      td.textContent = label;
    }
  });
  refs.bestBallSummary.spanA.textContent = fmtPts(bbA);
  refs.bestBallSummary.spanB.textContent = fmtPts(bbB);
  updateMatchStatus(refs.bestBallSummary, bbAny, bbCompleted);

  let sgA = 0;
  let sgB = 0;
  let sgCompleted = 0;
  let sgAny = false;
  state.days[day.id].singles.holes.forEach((holeData, idx) => {
    const r = singlesHoleResult(holeData, day.singles.a, day.singles.b);
    sgA += r.aPts;
    sgB += r.bPts;
    if (r.status !== 'pending') sgCompleted += 1;
    if (Object.keys(holeData).length > 0) sgAny = true;
    const td = refs.singlesCells[idx];
    if (td) {
      const [cls, label] = resultCellClassAndLabel(r.status);
      td.className = cls;
      td.textContent = label;
    }
  });
  refs.singlesSummary.spanA.textContent = fmtPts(sgA);
  refs.singlesSummary.spanB.textContent = fmtPts(sgB);
  updateMatchStatus(refs.singlesSummary, sgAny, sgCompleted);

  updateScoreStyles(day);
  updateTotals(day);
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

document.getElementById('refreshBtn').addEventListener('click', () => {
  location.reload();
});

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
