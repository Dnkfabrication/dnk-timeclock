// DnK Time Clock — app.js v2.0
// Backend: Google Apps Script web app (no OAuth / no Google login required)

const VERSION = '2.0.0';

const STORAGE_KEYS = {
  EMPLOYEES: 'dnk_employees',
  PUNCHES:   'dnk_punches',
  SETTINGS:  'dnk_settings'
};

const PUNCH_TYPES = {
  CLOCK_IN:    'CLOCK_IN',
  LUNCH_START: 'LUNCH_START',
  LUNCH_END:   'LUNCH_END',
  CLOCK_OUT:   'CLOCK_OUT'
};

// ─── ADMIN STATE (in-memory — resets on every page refresh) ───────────────────
let adminUnlocked = false;

// ─── UUID ──────────────────────────────────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────

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
  const punch = {
    id:        uuid(),
    timestamp: new Date().toISOString(),
    employee,
    type,
    note,
    synced:    false
  };
  const punches = getPunches();
  punches.push(punch);
  savePunches(punches);
  return punch;
}

function getSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}'); }
  catch (e) { return {}; }
}
function saveSettings(s) {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
}

// ─── GAS SYNC ─────────────────────────────────────────────────────────────────
// Uses text/plain content-type to avoid CORS preflight on GAS web app endpoints

async function gasRequest(action, data) {
  const { gasUrl } = getSettings();
  if (!gasUrl) throw new Error('Apps Script URL not configured in Settings');
  const resp = await fetch(gasUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight
    body:    JSON.stringify({ action, data })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const result = await resp.json();
  if (!result.ok) throw new Error(result.error || 'GAS returned an error');
  return result;
}

// Fire-and-forget single punch sync
async function syncPunch(punch) {
  try {
    await gasRequest('punch', punch);
    const punches = getPunches();
    const idx = punches.findIndex(p => p.id === punch.id);
    if (idx !== -1) { punches[idx].synced = true; savePunches(punches); }
    checkOfflinePunches();
  } catch (e) {
    console.warn('Punch will sync later:', e.message);
  }
}

// Sync all unsynced punches at once
async function syncBatchToGAS() {
  const allPunches = getPunches();
  const unsynced   = allPunches.filter(p => !p.synced);
  if (!unsynced.length) {
    updateSheetStatus('✓ All punches synced');
    return;
  }
  const syncBtn = document.getElementById('btn-sync');
  try {
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'SYNCING…'; }
    await gasRequest('punchBatch', unsynced);
    const syncedIds = new Set(unsynced.map(p => p.id));
    const updated   = getPunches().map(p => syncedIds.has(p.id) ? { ...p, synced: true } : p);
    savePunches(updated);
    updateSheetStatus('✓ All punches synced');
    checkOfflinePunches();
  } catch (e) {
    updateSheetStatus('Sync failed: ' + e.message, true);
  } finally {
    checkOfflinePunches(); // re-renders sync btn label
    if (syncBtn) syncBtn.disabled = false;
  }
}

function updateSheetStatus(msg, isError = false) {
  const el = document.getElementById('sheet-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = isError ? 'error' : (msg.startsWith('✓') ? 'connected' : '');
}

// ─── ADMIN PIN ────────────────────────────────────────────────────────────────

function promptPin(message) {
  return new Promise(resolve => resolve(prompt(message)));
}

async function verifyAdminPin() {
  if (adminUnlocked) return true;

  const s = getSettings();

  if (!s.adminPin) {
    // First launch — create a PIN
    const pin1 = await promptPin('Create an admin PIN (numbers only, 4+ digits):');
    if (!pin1 || !/^\d{4,}$/.test(pin1.trim())) {
      alert('PIN must be at least 4 digits. Try again.');
      return false;
    }
    const pin2 = await promptPin('Confirm admin PIN:');
    if (pin1.trim() !== pin2?.trim()) {
      alert('PINs do not match. Try again.');
      return false;
    }
    s.adminPin = pin1.trim();
    saveSettings(s);
    adminUnlocked = true;
    return true;
  }

  const entered = await promptPin('Enter admin PIN:');
  if (entered === null) return false; // cancelled
  if (entered.trim() !== s.adminPin) {
    alert('Incorrect PIN.');
    return false;
  }
  adminUnlocked = true;
  return true;
}

// ─── STATE MACHINE ────────────────────────────────────────────────────────────

function getEmployeeStateToday(employeeName) {
  const today   = new Date().toISOString().slice(0, 10);
  const punches = getPunches()
    .filter(p => p.employee === employeeName && p.timestamp.startsWith(today))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let state = 'idle';
  let clockIn = null, lunchStart = null, lunchEnd = null, clockOut = null;

  for (const p of punches) {
    if (p.type === PUNCH_TYPES.CLOCK_IN) {
      state = 'clocked_in'; clockIn = p.timestamp;
      lunchStart = null; lunchEnd = null; clockOut = null;
    } else if (p.type === PUNCH_TYPES.LUNCH_START) {
      state = 'on_lunch'; lunchStart = p.timestamp;
    } else if (p.type === PUNCH_TYPES.LUNCH_END) {
      state = 'clocked_in'; lunchEnd = p.timestamp;
    } else if (p.type === PUNCH_TYPES.CLOCK_OUT) {
      state = 'clocked_out'; clockOut = p.timestamp;
    }
  }
  return { state, clockIn, lunchStart, lunchEnd, clockOut };
}

function calcElapsedSeconds(fromISO, toISO = null) {
  const from = new Date(fromISO).getTime();
  const to   = toISO ? new Date(toISO).getTime() : Date.now();
  return Math.max(0, Math.floor((to - from) / 1000));
}

function calcLunchSeconds(lunchStart, lunchEnd) {
  if (!lunchStart) return 0;
  return calcElapsedSeconds(lunchStart, lunchEnd || null);
}

function calcWorkedSeconds(st) {
  if (!st.clockIn) return 0;
  const total = calcElapsedSeconds(st.clockIn, st.clockOut || null);
  const lunch = calcLunchSeconds(st.lunchStart, st.lunchEnd);
  return Math.max(0, total - lunch);
}

function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatHours(sec) { return (sec / 3600).toFixed(2); }
function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── PAYROLL ──────────────────────────────────────────────────────────────────

function getWeekDates(referenceDate = new Date()) {
  const d      = new Date(referenceDate);
  const day    = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  const days  = {};
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
  const week      = getWeekDates();
  const punches   = getPunches();
  const results   = [];

  for (const emp of employees) {
    const dayHours = {};
    const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri'];

    for (const dayName of dayNames) {
      const dateStr   = week[dayName];
      const dayPunches = punches
        .filter(p => p.employee === emp.name && p.timestamp.startsWith(dateStr))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      let clockIn = null, lunchStart = null, lunchEnd = null, clockOut = null;
      for (const p of dayPunches) {
        if      (p.type === 'CLOCK_IN')    { clockIn = p.timestamp; lunchStart = null; lunchEnd = null; clockOut = null; }
        else if (p.type === 'LUNCH_START')   lunchStart = p.timestamp;
        else if (p.type === 'LUNCH_END')     lunchEnd   = p.timestamp;
        else if (p.type === 'CLOCK_OUT')     clockOut   = p.timestamp;
      }

      if (!clockIn || !clockOut) { dayHours[dayName] = 0; continue; }
      dayHours[dayName] = parseFloat(formatHours(calcWorkedSeconds({ clockIn, lunchStart, lunchEnd, clockOut })));
    }

    const totalHours = Object.values(dayHours).reduce((a, b) => a + b, 0);
    const rate       = parseFloat(emp.rate)       || 0;
    const deductions = parseFloat(emp.deductions) || 0;
    const gross      = parseFloat((totalHours * rate).toFixed(2));
    const net        = parseFloat((gross - deductions).toFixed(2));

    results.push({
      employee:   emp.name,
      rate, deductions,
      ...dayHours,
      totalHours: parseFloat(totalHours.toFixed(2)),
      gross, net,
      overtime:    totalHours > 40,
      week_ending: week.weekEnding
    });
  }
  return results;
}

// ─── UI RENDERING ─────────────────────────────────────────────────────────────

function renderEmployeeSelect() {
  const sel     = document.getElementById('employee-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Employee —</option>';
  getEmployees().forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name; opt.textContent = e.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderEmployeeList() {
  const list      = document.getElementById('employee-list');
  list.innerHTML  = '';
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
  const empName    = document.getElementById('employee-select').value;
  const btn        = document.getElementById('btn-primary');
  const lunchRow   = document.getElementById('lunch-row');
  const shiftEl    = document.getElementById('shift-elapsed');
  const daySummary = document.getElementById('day-summary');

  if (!empName) {
    btn.disabled = true; btn.textContent = 'CLOCK IN'; btn.className = 'btn-primary';
    lunchRow.classList.add('hidden');
    shiftEl.classList.add('hidden');
    daySummary.classList.add('hidden');
    return;
  }

  const st  = getEmployeeStateToday(empName);
  btn.disabled = false;

  if (st.state === 'idle') {
    btn.textContent = 'CLOCK IN'; btn.className = 'btn-primary';
    lunchRow.classList.add('hidden');
    shiftEl.classList.add('hidden');
    daySummary.classList.add('hidden');

  } else if (st.state === 'clocked_in') {
    btn.textContent = 'CLOCK OUT'; btn.className = 'btn-primary clocked-in';
    lunchRow.classList.remove('hidden');
    document.getElementById('btn-lunch').textContent = 'START LUNCH';
    shiftEl.classList.remove('hidden');
    shiftEl.style.color = 'var(--orange)';
    shiftEl.classList.remove('paused');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');

  } else if (st.state === 'on_lunch') {
    btn.textContent = 'CLOCK OUT'; btn.className = 'btn-primary clocked-in'; btn.disabled = true;
    lunchRow.classList.remove('hidden');
    document.getElementById('btn-lunch').textContent = 'END LUNCH';
    shiftEl.classList.remove('hidden');
    shiftEl.style.color = 'var(--text-muted)';
    shiftEl.classList.add('paused');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');

  } else if (st.state === 'clocked_out') {
    btn.textContent = 'CLOCKED OUT'; btn.className = 'btn-primary'; btn.disabled = true;
    lunchRow.classList.add('hidden');
    shiftEl.classList.add('hidden');
    renderDaySummary(st);
    daySummary.classList.remove('hidden');
  }
}

function renderDaySummary(st) {
  document.getElementById('sum-clockin').textContent = formatTime(st.clockIn);
  const lunchSec = calcLunchSeconds(st.lunchStart, st.lunchEnd);
  document.getElementById('sum-lunch').textContent = lunchSec > 0 ? formatSeconds(lunchSec) : '—';
  const effectiveOut = st.clockOut || new Date().toISOString();
  document.getElementById('sum-hours').textContent =
    formatHours(calcWorkedSeconds({ ...st, clockOut: effectiveOut })) + ' hrs';
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
  const s       = getSettings();
  document.getElementById('input-gas-url').value = s.gasUrl || '';

  const unsynced = getPunches().filter(p => !p.synced).length;
  if (!s.gasUrl) {
    updateSheetStatus('Not configured — punches saved locally');
  } else if (unsynced > 0) {
    updateSheetStatus(`${unsynced} punch${unsynced > 1 ? 'es' : ''} pending sync`);
  } else {
    updateSheetStatus('✓ All punches synced');
  }
}

function checkOfflinePunches() {
  const unsynced = getPunches().filter(p => !p.synced).length;
  const syncBtn  = document.getElementById('btn-sync');
  const gearBtn  = document.getElementById('btn-settings');

  if (unsynced > 0) {
    if (syncBtn) {
      syncBtn.classList.remove('hidden');
      syncBtn.textContent = `SYNC ${unsynced} OFFLINE PUNCH${unsynced > 1 ? 'ES' : ''}`;
    }
    gearBtn.classList.add('has-pending');
  } else {
    if (syncBtn) syncBtn.classList.add('hidden');
    gearBtn.classList.remove('has-pending');
  }
}

// ─── TIMER ────────────────────────────────────────────────────────────────────

let timerInterval = null;

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);
  tick();
}

function tick() {
  const now = new Date();
  document.getElementById('live-clock').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  document.getElementById('live-date').textContent =
    now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const empName = document.getElementById('employee-select').value;
  if (!empName) return;

  const st      = getEmployeeStateToday(empName);
  const elapsedEl = document.getElementById('shift-elapsed');

  if (st.state === 'clocked_in') {
    elapsedEl.textContent = formatSeconds(calcWorkedSeconds(st));
  } else if (st.state === 'on_lunch' && st.clockIn && st.lunchStart) {
    elapsedEl.textContent = formatSeconds(calcElapsedSeconds(st.clockIn, st.lunchStart)) + ' ⏸';
  }

  if (st.state === 'on_lunch' && st.lunchStart) {
    document.getElementById('lunch-elapsed').textContent =
      formatSeconds(calcElapsedSeconds(st.lunchStart));
  } else {
    document.getElementById('lunch-elapsed').textContent = '';
  }

  if (st.state === 'clocked_in' || st.state === 'on_lunch') renderDaySummary(st);
}

// ─── EVENT HANDLERS ───────────────────────────────────────────────────────────

async function handlePrimaryButton() {
  const empName = document.getElementById('employee-select').value;
  if (!empName) return;
  const st = getEmployeeStateToday(empName);
  let type;
  if      (st.state === 'idle')      type = PUNCH_TYPES.CLOCK_IN;
  else if (st.state === 'clocked_in') type = PUNCH_TYPES.CLOCK_OUT;
  else return;

  const punch = addPunch(empName, type);
  renderMainScreen();
  syncPunch(punch); // fire-and-forget
  checkOfflinePunches();
}

async function handleLunchButton() {
  const empName = document.getElementById('employee-select').value;
  if (!empName) return;
  const st = getEmployeeStateToday(empName);
  let type;
  if      (st.state === 'clocked_in') type = PUNCH_TYPES.LUNCH_START;
  else if (st.state === 'on_lunch')   type = PUNCH_TYPES.LUNCH_END;
  else return;

  const punch = addPunch(empName, type);
  renderMainScreen();
  syncPunch(punch); // fire-and-forget
  checkOfflinePunches();
}

async function handleExportWeek() {
  const rows = calcWeeklyPayroll();
  if (!rows.length) { alert('No payroll data to export.'); return; }

  const { gasUrl } = getSettings();
  if (!gasUrl) { alert('Configure the Apps Script URL in Settings first.'); return; }

  const btn = document.getElementById('btn-export-week');
  btn.disabled = true; btn.textContent = 'EXPORTING…';
  try {
    await gasRequest('exportWeek', rows);
    alert('Week exported to Google Sheets!');
  } catch (e) {
    alert('Export failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'EXPORT WEEK TO SHEET';
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

async function openSettings() {
  const ok = await verifyAdminPin();
  if (!ok) return;

  const panel = document.getElementById('settings-panel');
  panel.classList.remove('hidden');
  panel.offsetHeight; // force reflow for CSS transition
  panel.classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
  renderSettingsValues();
  renderEmployeeList();
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function init() {
  renderEmployeeSelect();
  renderMainScreen();
  startTimer();
  checkOfflinePunches();

  // Highlight payroll tab on Fridays
  if (new Date().getDay() === 5) {
    document.querySelector('[data-screen="payroll"]').classList.add('friday-badge');
  }

  // Employee select
  document.getElementById('employee-select').addEventListener('change', renderMainScreen);

  // Clock in / out
  document.getElementById('btn-primary').addEventListener('click', handlePrimaryButton);

  // Lunch
  document.getElementById('btn-lunch').addEventListener('click', handleLunchButton);

  // Settings open / close
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  // GAS URL input
  document.getElementById('input-gas-url').addEventListener('change', e => {
    const s  = getSettings();
    s.gasUrl = e.target.value.trim();
    saveSettings(s);
    renderSettingsValues();
  });

  // Sync offline punches
  document.getElementById('btn-sync').addEventListener('click', syncBatchToGAS);

  // Change PIN
  document.getElementById('btn-change-pin').addEventListener('click', async () => {
    const newPin = await promptPin('Enter new admin PIN (4+ digits):');
    if (!newPin || !/^\d{4,}$/.test(newPin.trim())) {
      alert('PIN must be at least 4 digits.');
      return;
    }
    const confirm = await promptPin('Confirm new PIN:');
    if (newPin.trim() !== confirm?.trim()) { alert('PINs do not match.'); return; }
    const s   = getSettings();
    s.adminPin = newPin.trim();
    saveSettings(s);
    alert('Admin PIN updated.');
  });

  // Add employee
  document.getElementById('btn-add-employee').addEventListener('click', () => {
    const name       = document.getElementById('input-emp-name').value.trim();
    const rate       = parseFloat(document.getElementById('input-emp-rate').value)       || 0;
    const deductions = parseFloat(document.getElementById('input-emp-deductions').value) || 0;
    if (!name) { alert('Enter an employee name.'); return; }
    const emps = getEmployees();
    if (emps.find(e => e.name.toLowerCase() === name.toLowerCase())) {
      alert('An employee with that name already exists.');
      return;
    }
    emps.push({ name, rate, deductions });
    saveEmployees(emps);
    renderEmployeeList();
    renderEmployeeSelect();
    document.getElementById('input-emp-name').value    = '';
    document.getElementById('input-emp-rate').value    = '';
    document.getElementById('input-emp-deductions').value = '';
    document.getElementById('input-emp-name').focus();
  });

  document.getElementById('input-emp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-employee').click();
  });

  // Export week
  document.getElementById('btn-export-week').addEventListener('click', handleExportWeek);
}

document.addEventListener('DOMContentLoaded', init);
