// DnK Time Clock — Google Apps Script Backend
// Deploy as Web App:
//   Execute as: Me (dylan@dnkfabrication.com)
//   Who has access: Anyone, even anonymous
// Then paste the Web App URL into the time clock Settings panel.

var SHEET_ID = '1TO6MVIHFgUx-WRK07nTv-ygwY-VOoFkZSuJ9FWg0-8E';

// ─── ENTRY POINTS ──────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var data   = body.data;
    var result;

    if      (action === 'punch')      result = handlePunch(data);
    else if (action === 'punchBatch') result = handlePunchBatch(data);
    else if (action === 'exportWeek') result = handleExportWeek(data);
    else                              result = { ok: false, error: 'Unknown action: ' + action };

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'DnK Time Clock backend running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── SHEET HELPERS ─────────────────────────────────────────────────────────────

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

function handlePunch(punch) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Punches',
    ['timestamp', 'employee', 'type', 'note', 'id']);
  sheet.appendRow([
    punch.timestamp,
    punch.employee,
    punch.type,
    punch.note || '',
    punch.id   || ''
  ]);
  return { ok: true };
}

function handlePunchBatch(punches) {
  if (!punches || !punches.length) return { ok: true, synced: 0 };
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Punches',
    ['timestamp', 'employee', 'type', 'note', 'id']);
  var rows  = punches.map(function(p) {
    return [p.timestamp, p.employee, p.type, p.note || '', p.id || ''];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  return { ok: true, synced: punches.length };
}

function handleExportWeek(rows) {
  if (!rows || !rows.length) return { ok: false, error: 'No rows to export' };
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Weekly',
    ['week_ending','employee','mon','tue','wed','thu','fri',
     'total_hours','rate','deductions','gross','net']);
  var values = rows.map(function(r) {
    return [
      r.week_ending, r.employee,
      r.mon, r.tue, r.wed, r.thu, r.fri,
      r.totalHours, r.rate, r.deductions, r.gross, r.net
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 12).setValues(values);
  return { ok: true, exported: rows.length };
}
