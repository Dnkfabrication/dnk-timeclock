// DnK Time Clock — app.js
// Version 1.0.0

const VERSION = '1.0.0';

const STORAGE_KEYS = {
  EMPLOYEES: 'dnk_employees',
  PUNCHES:   'dnk_punches',
  SETTINGS:  'dnk_settings',
  AUTH:      'dnk_auth',
  CONV_HISTORY: 'dnk_conv'
};

const PUNCH_TYPES = {
  CLOCK_IN:    'CLOCK_IN',
  LUNCH_START: 'LUNCH_START',
  LUNCH_END:   'LUNCH_END',
  CLOCK_OUT:   'CLOCK_OUT'
};

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_BASE  = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── DEFAULT CREDENTIALS (pre-filled; user can override in Settings) ───────────
const DEFAULT_CLIENT_ID = '587864224279-ni6hl6b8oedt5ctmvdptbtpl9al19nlr.apps.googleusercontent.com';
const DEFAULT_SHEET_ID  = '1TO6MVIHFgUx-WRK07nTv-ygwY-VOoFkZSuJ9FWg0-8E';

// ─── UUID HELPER ───────────────────────────────────────────────────────────────

function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ─── STORAGE LAYER ─────────────────────────────────────────────────────────────

function getEmployees() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.EMPLOYEES) || '[]'); }
  catch (e) { return []; }
}

function saveEmployees(arr) {
  localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(arr));
}

function getPunches() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PUNCHES) || '[]'); }
  catch (e) { return []; }
}

function savePunches(arr) {
  localStorage.setItem(STORAGE_KEYS.PUNCHES, JSON.stringify(arr));
}

function addPunch(employee, type, note = '') {
  const punches = getPunches();
  punches.push({
    id:        uuid(),
    timestamp: new Date().toISOString(),
    employee,
    type,
    note,
    synced:    false
  });
  savePunches(punches);
}

function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
    if (!s.clientId) s.clientId = DEFAULT_CLIENT_ID;
    if (!s.sheetId)  s.sheetId  = DEFAULT_SHEET_ID;
    return s;
  } catch (e) {
    return { clientId: DEFAULT_CLIENT_ID, sheetId: DEFAULT_SHEET_ID };
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
}

function getAuth() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.AUTH) || '{}'); }
  catch (e) { return {}; }
}

function saveAuth(a) {
  localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(a));
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────

let tokenClient = null;

function initAuth() {
  const { clientId } = getSettings();
  if (!clientId) return;
  if (typeof google === 'undefined' || !google.accounts) {
    // GIS not loaded yet — retry shortly
    setTimeout(initAuth, 500);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SHEETS_SCOPE,
    callback: (response) => {
      if (response.error) {
        updateAuthStatus(false, response.error);
        return;
      }
      const expiry = Date.now() + (response.expires_in * 1000) - 60000;
      saveAuth({ token: response.access_token, expiry });
      updateAuthStatus(true);
      syncOfflinePunches();
    }
  });
}

function getValidToken() {
  const auth = getAuth();
  if (auth.token && Date.now() < auth.expiry) return auth.token;
  return null;
}

function isAuthenticated() {
  return !!getValidToken();
}

function requestToken() {
  if (!tokenClient) {
    initAuth();
    // If still not ready after initAuth, warn
    if (!tokenClient) {
      alert('Enter your OAuth Client ID in Settings first.');
      return;
    }
  }
  tokenClient.requestAccessToken();
}

function updateAuthStatus(connected, error = '') {
  const el = document.getElementById('auth-status');
  if (connected) {
    el.textContent = '✓ Connected to Google Sheets';
    el.className = 'connected';
    document.getElementById('btn-sync').classList.add('hidden');
  } else {
    el.textContent = error ? `Error: ${error}` : 'Not connected — offline mode';
    el.className = '';
    checkOfflinePunches();
  }
  renderSettingsAuthState();
}

// ─── SHEETS API ────────────────────────────────────────────────────────────────

async function sheetsRequest(method, path, body = null) {
  const token = getValidToken();
  if (!token) throw new Error('Not authenticated');
  const { sheetId } = getSettings();
  if (!sheetId) throw new Error('No Sheet ID configured');
  const url = `${SHEETS_BASE}/${sheetId}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function ensureSheetTabs() {
  try {
    const meta = await sheetsRequest('GET', '?fields=sheets.properties.title');
    const existing = meta.sheets.map(s => s.properties.title);
    const requests = [];
    if (!existing.includes('Punches')) {
      requests.push({ addSheet: { properties: { title: 'Punches' } } });
    }
    if (!existing.includes('Weekly')) {
      requests.push({ addSheet: { properties: { title: 'Weekly' } } });
    }
    if (requests.length) {
      await sheetsRequest('POST', ':batchUpdate', { requests });
      if (!existing.includes('Punches')) {
        await sheetsRequest(
          'PUT',
          '/values/Punches!A1:D1?valueInputOption=RAW',
          { values: [['timestamp', 'employee', 'type', 'note']] }
        );
      }
      if (!existing.includes('Weekly')) {
        await sheetsRequest(
          'PUT',
          '/values/Weekly!A1:K1?valueInputOption=RAW',
          { values: [['week_ending', 'employee', 'mon', 'tue', 'wed', 'thu', 'fri', 'total_hours', 'rate', 'deductions', 'gross', 'net']] }
        );
      }
    }
  } catch (e) {
    console.error('ensureSheetTabs:', e);
  }
}

async function appendPunchToSheet(punch) {
  const row = [punch.timestamp, punch.employee, punch.type, punch.note || ''];
  await sheetsRequest(
    'POST',
    '/values/Punches!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { values: [row] }
  );
}

async function getTodayPunchesFromSheet(employee) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const data = await sheetsRequest('GET', '/values/Punches!A:D');
    const rows = data.values || [];
    return rows.slice(1).filter(r => r[1] === employee && r[0].startsWith(today));
  } catch (e) {
    return [];
  }
}

async function writeWeeklySummary(rows) {
  const values = rows.map(r => [
    r.week_ending,
    r.employee,
    r.mon,
    r.tue,
    r.wed,
    r.thu,
    r.fri,
    r.totalHours,
    r.rate,
    r.deductions,
    r.gross,
    r.net
  ]);
  await sheetsRequest(
    'POST',
    '/values/Weekly!A:L:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { values }
  );
}

async function syncOfflinePunches() {
  const allPunches = getPunches();
  const unsynced = allPunches.filter(p => !p.synced);
  if (!unsynced.length) return;
  await ensureSheetTabs();
  const updated = [...allPunches];
  for (const p of unsynced) {
    try {
      await appendPunchToSheet(p);
      const idx = updated.findIndex(u => u.id === p.id);
      if (idx !== -1) updated[idx] = { ...updated[idx], synced: true };
    } catch (e) {
      console.error('sync error:', e);
      break;
    }
  }
  savePunches(updated);
  checkOfflinePunches();
}

// ─── STATE MACHINE ─────────────────────────────────────────────────────────────

function getEmployeeStateToday(employeeName) {
  const today = new Date().toISOString().slice(0, 10);
  const punches = getPunches()
    .filter(p => p.employee === employeeName && p.timestamp.startsWith(today))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let state = 'idle';
  let clockIn = null, lunchStart = null, lunchEnd = null, clockOut = null;

  for (const p of punches) {
    if (p.type === PUNCH_TYPES.CLOCK_IN) {
      state = 'clocked_in';
      clockIn = p.timestamp;
      // Reset these if clocking back in after clocking out (rare edge case)
      lunchStart = null;
      lunchEnd = null;
      clockOut = null;
    } else if (p.type === PUNCH_TYPES.LUNCH_START) {
      state = 'on_lunch';
      lunchStart = p.timestamp;
    } else if (p.type === PUNCH_TYPES.LUNCH_END) {
      state = 'clocked_in';
      lunchEnd = p.timestamp;
    } else if (p.type === PUNCH_TYPES.CLOCK_OUT) {
      state = 'clocked_out';
      clockOut = p.timestamp;
    }
  }

  return { state, clockIn, lunchStart, lunchEnd, clockOut };
}

function calcElapsedSeconds(fromISO, toISO = null) {
  const from = new Date(fromISO).getTime();
  const to = toISO ? new Date(toISO).getTime() : Date.now();
  return Math.max(0, Math.floor((to - from) / 1000));
}

function calcLunchSeconds(lunchStart, lunchEnd) {
  if (!lunchStart) return 0;
  return calcElapsedSeconds(lunchStart, lunchEnd || null);
}

function calcWorkedSeconds(st) {
  if (!st.clockIn) return 0;
  const toTime = st.clockOut || null;
  const total = calcElapsedSeconds(st.clockIn, toTime);
  const lunch = calcLunchSeconds(st.lunchStart, st.lunchEnd);
  return Math.max(0, total - lunch);
}

function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatHours(sec) {
  return (sec / 3600).toFixed(2);
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── PAYROLL ───────────────────────────────────────────────────────────────────

function getWeekDates(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  const days = {};
  const names = ['mon', 'tue', 'wed', 'thu', 'fri'];
  for (let i = 0; i < 5; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    days[names[i]] = dd.toISOString().slice(0, 10);
  }
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  days.weekEnding = friday.toISOString().slice(0, 10);
  return days;
}

function calcWeeklyPayroll() {
  const employees = getEmployees();
  const week = getWeekDates();
  const punches = getPunches();
  const results = [];

  for (const emp of employees) {
    const dayHours = {};
    const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri'];

    for (const dayName of dayNames) {
      const dateStr = week[dayName];
      const dayPunches = punches
        .filter(p => p.employee === emp.name && p.timestamp.startsWith(dateStr))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      let clockIn = null, lunchStart = null, lunchEnd = null, clockOut = null;
      for (const p of dayPunches) {
        if (p.type === 'CLOCK_IN') { clockIn = p.timestamp; lunchStart = null; lunchEnd = null; clockOut = null; }
        else if (p.type === 'LUNCH_START') lunchStart = p.timestamp;
        else if (p.type === 'LUNCH_END') lunchEnd = p.timestamp;
        else if (p.type === 'CLOCK_OUT') clockOut = p.timestamp;
      }

      if (!clockIn || !clockOut) {
        dayHours[dayName] = 0;
        continue;
      }
      const worked = calcWorkedSeconds({ clockIn, lunchStart, lunchEnd, clockOut });
      dayHours[dayName] = parseFloat(formatHours(worked));
    }

    const totalHours = Object.values(dayHours).reduce((a, b) => a + b, 0);
    const rate = parseFloat(emp.rate) || 0;
    const deductions = parseFloat(emp.deductions) || 0;
    const gross = parseFloat((totalHours * rate).toFixed(2));
    const net = parseFloat((gross - deductions).toFixed(2));

    results.push({
      employee:   emp.name,
      rate,
      deductions,
      ...dayHours,
      totalHours: parseFloat(totalHours.toFixed(2)),
      gross,
      net,
      overtime:   totalHours > 40,
      week_ending: week.weekEnding
    });
  }

  return results;
}

// ─── UI RENDERING ──────────────────────────────────────────────────────────────

function renderEmployeeSelect() {
  const sel = document.getElementById('employee-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Employee —</option>';
  getEmployees().forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderEmployeeList() {
  const list = document.getElementById('employee-list');
  list.innerHTML = '';
  const employees = getEmployees();
  if (!employees.length) {
    list.innerHTML = '<p style="font-family:var(--font-label);font-size:13px;color:var(--text-muted);padding:8px 0">No employees yet.</p>';
    return;
  }
  employees.forEach((emp, i) => {
    const div = document.createElement('div');
    div.className = 'employee-item';
    div.innerHTML = `
      <div class="emp-info">
        <div class="emp-name">${emp.name}</div>
        <div class="emp-rate">$${Number(emp.rate).toFixed(2)}/hr &nbsp;·&nbsp; -$${Number(emp.deductions).toFixed(2)}/wk</div>
      </div>
      <button class="btn-delete" data-index="${i}" title="Remove employee">✕</button>
    `;
    div.querySelector('.btn-delete').addEventListener('click', () => {
      if (!confirm(`Remove ${emp.name}?`)) return;
      const emps = getEmployees();
      emps.splice(i, 1);
      saveEmployees(emps);
      renderEmployeeList();
      renderEmployeeSelect();
    });
    list.appendChild(div);
  });
}

function renderMainScreen() {
  const empName = document.getElementById('employee-select').value;
  const btn = document.getElementById('btn-primary');
  const lunchRow = document.getElementById('lunch-row');
  const shiftElapsed = document.getElementById('shift-elapsed');
  const daySummary = document.getElementById('day-summary');

  if (!empName) {
    btn.disabled = true;
    btn.textContent = 'CLOCK IN';
    btn.className = 'btn-primary';
    lunchRow.classList.add('hidden');
    shiftElapsed.classList.add('hidden');
    daySummary.classList.add('hidden');
    return;
  }

  const st = getEmployeeStateToday(empName);
  btn.disabled = false;

  if (st.state === 'idle') {
    btn.textContent = 'CLOCK IN';
    btn.className = 'btn-primary';
    lunchRow.classList.add('hidden');
    shiftElapsed.classList.add('hidden');
    daySummary.classList.add('hidden');

  } else if (st.state === 'clocked_in') {
    btn.textContent = 'CLOCK OUT';
    btn.className = 'btn-primary clocked-in';
    btn.disabled = false;
    lunchRow.classList.remove('hidden');
    document.getElementById('btn-lunch').textContent = 'START LUNCH';
    shiftElapsed.classList.remove('hidden');
    shiftElapsed.style.color = 'var(--orange)';
    shiftElapsed.classList.remove('paused');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');

  } else if (st.state === 'on_lunch') {
    btn.textContent = 'CLOCK OUT';
    btn.className = 'btn-primary clocked-in';
    btn.disabled = true; // can't clock out during lunch
    lunchRow.classList.remove('hidden');
    document.getElementById('btn-lunch').textContent = 'END LUNCH';
    shiftElapsed.classList.remove('hidden');
    shiftElapsed.style.color = 'var(--text-muted)';
    shiftElapsed.classList.add('paused');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');

  } else if (st.state === 'clocked_out') {
    btn.textContent = 'CLOCKED OUT';
    btn.className = 'btn-primary';
    btn.disabled = true;
    lunchRow.classList.add('hidden');
    shiftElapsed.classList.add('hidden');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');
  }
}

function renderDaySummary(st) {
  document.getElementById('sum-clockin').textContent = formatTime(st.clockIn);
  const lunchSec = calcLunchSeconds(st.lunchStart, st.lunchEnd);
  document.getElementById('sum-lunch').textContent = lunchSec > 0 ? formatSeconds(lunchSec) : '—';
  const effectiveClockOut = st.clockOut || new Date().toISOString();
  const worked = calcWorkedSeconds({ ...st, clockOut: effectiveClockOut });
  document.getElementById('sum-hours').textContent = formatHours(worked) + ' hrs';
}

function renderPayrollScreen() {
  const rows = calcWeeklyPayroll();
  const week = getWeekDates();
  document.getElementById('week-label').textContent = `WEEK ENDING ${week.weekEnding}`;

  const container = document.getElementById('payroll-rows');
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-family:var(--font-label);padding:16px 0">No employees configured. Add employees in Settings.</p>';
    return;
  }

  rows.forEach(r => {
    const card = document.createElement('div');
    card.className = 'payroll-card';
    card.innerHTML = `
      <div class="payroll-name">${r.employee}</div>
      ${r.overtime ? '<div class="overtime-flag">&#9888; OVER 40 HOURS THIS WEEK</div>' : ''}
      <div class="payroll-row"><span>MON</span><span>${r.mon} hrs</span></div>
      <div class="payroll-row"><span>TUE</span><span>${r.tue} hrs</span></div>
      <div class="payroll-row"><span>WED</span><span>${r.wed} hrs</span></div>
      <div class="payroll-row"><span>THU</span><span>${r.thu} hrs</span></div>
      <div class="payroll-row"><span>FRI</span><span>${r.fri} hrs</span></div>
      <div class="payroll-row"><span>TOTAL HOURS</span><span>${r.totalHours} hrs</span></div>
      <div class="payroll-row"><span>RATE</span><span>$${r.rate.toFixed(2)}/hr</span></div>
      <div class="payroll-row"><span>GROSS</span><span>$${r.gross.toFixed(2)}</span></div>
      <div class="payroll-row"><span>DEDUCTIONS</span><span>-$${r.deductions.toFixed(2)}</span></div>
      <div class="payroll-row payroll-total"><span>NET PAY</span><span>$${r.net.toFixed(2)}</span></div>
    `;
    container.appendChild(card);
  });
}

function renderSettingsValues() {
  const s = getSettings();
  document.getElementById('input-sheet-id').value = s.sheetId || '';
  document.getElementById('input-client-id').value = s.clientId || '';
  // Reflect current auth state
  if (isAuthenticated()) {
    updateAuthStatus(true);
  }
}

function renderSettingsAuthState() {
  const connected = isAuthenticated();
  if (!connected) {
    checkOfflinePunches();
  }
}

function checkOfflinePunches() {
  const unsynced = getPunches().filter(p => !p.synced).length;
  const syncBtn = document.getElementById('btn-sync');
  const gearBtn = document.getElementById('btn-settings');

  if (unsynced > 0 && !isAuthenticated()) {
    syncBtn.classList.remove('hidden');
    syncBtn.textContent = `SYNC ${unsynced} OFFLINE PUNCH${unsynced > 1 ? 'ES' : ''}`;
    gearBtn.classList.add('has-pending');
  } else {
    syncBtn.classList.add('hidden');
    gearBtn.classList.remove('has-pending');
  }
}

// ─── TIMER LOOP ────────────────────────────────────────────────────────────────

let timerInterval = null;

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);
  tick();
}

function tick() {
  // Live clock
  const now = new Date();
  document.getElementById('live-clock').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  document.getElementById('live-date').textContent =
    now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  // Shift elapsed
  const empName = document.getElementById('employee-select').value;
  if (!empName) return;

  const st = getEmployeeStateToday(empName);
  const elapsedEl = document.getElementById('shift-elapsed');

  if (st.state === 'clocked_in') {
    elapsedEl.textContent = formatSeconds(calcWorkedSeconds(st));
  } else if (st.state === 'on_lunch') {
    // Show time worked before lunch started (paused)
    if (st.clockIn && st.lunchStart) {
      const workedBeforeLunch = calcElapsedSeconds(st.clockIn, st.lunchStart);
      elapsedEl.textContent = formatSeconds(workedBeforeLunch) + ' ⏸';
    }
  }

  // Lunch elapsed counter
  if (st.state === 'on_lunch' && st.lunchStart) {
    document.getElementById('lunch-elapsed').textContent =
      formatSeconds(calcElapsedSeconds(st.lunchStart));
  } else {
    document.getElementById('lunch-elapsed').textContent = '';
  }

  // Update day summary live while clocked in or on lunch
  if (st.state === 'clocked_in' || st.state === 'on_lunch') {
    renderDaySummary(st);
  }
}

// ─── EVENT HANDLERS ────────────────────────────────────────────────────────────

async function handlePrimaryButton() {
  const empName = document.getElementById('employee-select').value;
  if (!empName) return;
  const st = getEmployeeStateToday(empName);
  let type;
  if (st.state === 'idle') type = PUNCH_TYPES.CLOCK_IN;
  else if (st.state === 'clocked_in') type = PUNCH_TYPES.CLOCK_OUT;
  else return;

  addPunch(empName, type);
  renderMainScreen();

  // Async sync to sheets
  if (isAuthenticated()) {
    try {
      const allPunches = getPunches();
      const lastPunch = allPunches[allPunches.length - 1];
      await appendPunchToSheet(lastPunch);
      allPunches[allPunches.length - 1].synced = true;
      savePunches(allPunches);
    } catch (e) {
      console.error('sheet sync error:', e);
    }
  }
  checkOfflinePunches();
}

async function handleLunchButton() {
  const empName = document.getElementById('employee-select').value;
  if (!empName) return;
  const st = getEmployeeStateToday(empName);
  let type;
  if (st.state === 'clocked_in') type = PUNCH_TYPES.LUNCH_START;
  else if (st.state === 'on_lunch') type = PUNCH_TYPES.LUNCH_END;
  else return;

  addPunch(empName, type);
  renderMainScreen();

  if (isAuthenticated()) {
    try {
      const allPunches = getPunches();
      const lastPunch = allPunches[allPunches.length - 1];
      await appendPunchToSheet(lastPunch);
      allPunches[allPunches.length - 1].synced = true;
      savePunches(allPunches);
    } catch (e) {
      console.error('sheet sync error:', e);
    }
  }
  checkOfflinePunches();
}

async function handleExportWeek() {
  const rows = calcWeeklyPayroll();
  if (!rows.length) {
    alert('No payroll data to export.');
    return;
  }
  if (!isAuthenticated()) {
    alert('Sign in with Google first to export to Sheets.');
    return;
  }
  const btn = document.getElementById('btn-export-week');
  btn.disabled = true;
  btn.textContent = 'EXPORTING...';
  try {
    await ensureSheetTabs();
    await writeWeeklySummary(rows);
    alert('Week exported to Google Sheets!');
  } catch (e) {
    alert('Export failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'EXPORT WEEK TO SHEET';
  }
}

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const screenEl = document.getElementById(`screen-${name}`);
  screenEl.classList.remove('hidden');
  screenEl.classList.add('active');
  document.querySelector(`[data-screen="${name}"]`).classList.add('active');

  if (name === 'payroll') renderPayrollScreen();
}

function openSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.remove('hidden');
  // Force reflow so transition fires
  panel.offsetHeight; // eslint-disable-line no-unused-expressions
  panel.classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
  renderSettingsValues();
  renderEmployeeList();
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

// ─── INIT ──────────────────────────────────────────────────────────────────────

function init() {
  // Try to init auth (will retry if GIS not loaded yet)
  initAuth();

  // Render initial state
  renderEmployeeSelect();
  renderMainScreen();
  startTimer();
  checkOfflinePunches();
  renderSettingsAuthState();

  // Highlight payroll tab on Fridays
  if (new Date().getDay() === 5) {
    const payrollBtn = document.querySelector('[data-screen="payroll"]');
    payrollBtn.classList.add('friday-badge');
  }

  // ── Employee select ──
  document.getElementById('employee-select').addEventListener('change', () => {
    renderMainScreen();
  });

  // ── Clock In/Out ──
  document.getElementById('btn-primary').addEventListener('click', handlePrimaryButton);

  // ── Lunch ──
  document.getElementById('btn-lunch').addEventListener('click', handleLunchButton);

  // ── Settings open/close ──
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  // ── Bottom nav ──
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  // ── Settings inputs — save on change ──
  document.getElementById('input-sheet-id').addEventListener('change', e => {
    const s = getSettings();
    s.sheetId = e.target.value.trim();
    saveSettings(s);
  });

  document.getElementById('input-client-id').addEventListener('change', e => {
    const s = getSettings();
    s.clientId = e.target.value.trim();
    saveSettings(s);
    initAuth(); // Re-initialize with new client ID
  });

  // ── Google sign-in ──
  document.getElementById('btn-google-signin').addEventListener('click', requestToken);

  // ── Sync offline punches ──
  document.getElementById('btn-sync').addEventListener('click', () => {
    if (!isAuthenticated()) {
      requestToken(); // Will auto-sync after auth callback
    } else {
      syncOfflinePunches();
    }
  });

  // ── Add employee ──
  document.getElementById('btn-add-employee').addEventListener('click', () => {
    const name = document.getElementById('input-emp-name').value.trim();
    const rate = parseFloat(document.getElementById('input-emp-rate').value) || 0;
    const deductions = parseFloat(document.getElementById('input-emp-deductions').value) || 0;
    if (!name) {
      alert('Enter an employee name.');
      return;
    }
    const emps = getEmployees();
    if (emps.find(e => e.name.toLowerCase() === name.toLowerCase())) {
      alert('An employee with that name already exists.');
      return;
    }
    emps.push({ name, rate, deductions });
    saveEmployees(emps);
    renderEmployeeList();
    renderEmployeeSelect();
    // Clear form
    document.getElementById('input-emp-name').value = '';
    document.getElementById('input-emp-rate').value = '';
    document.getElementById('input-emp-deductions').value = '';
    document.getElementById('input-emp-name').focus();
  });

  // Allow pressing Enter in name field to submit
  document.getElementById('input-emp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-employee').click();
  });

  // ── Export week ──
  document.getElementById('btn-export-week').addEventListener('click', handleExportWeek);
}

document.addEventListener('DOMContentLoaded', init);
