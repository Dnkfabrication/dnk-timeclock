// DnK Time Clock — Google Apps Script Backend
// Deploy as Web App:
//   Execute as: Me (dylan@dnkfabrication.com)
//   Who has access: Anyone, even anonymous
// Then paste the Web App URL into the time clock Settings panel
// AND add it as GAS_URL in C:\DNK\config.env

// "DnK Automation" spreadsheet — owned by dylan@dnkfabrication.com,
// shared with the social-post bot's Approvals flow.
var SHEET_ID = '1etFthab1pajdqduJoOHth6iDPyDwxUqzhbP1YTv28uU';

// ─── ENTRY POINTS ──────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var data   = body.data;
    var result;

    if      (action === 'punch')                  result = handlePunch(data);
    else if (action === 'punchBatch')             result = handlePunchBatch(data);
    else if (action === 'exportWeek')             result = handleExportWeek(data);
    else if (action === 'updatePunch')            result = handleUpdatePunch(data);
    else if (action === 'deletePunch')            result = handleDeletePunch(data);
    else if (action === 'emailApproval')          result = handleEmailApprovalPost(data);
    else if (action === 'getPendingApprovals')    result = handleGetPendingApprovals();
    else if (action === 'markApprovalProcessed')  result = handleMarkApprovalProcessed(data);
    else                                          result = { ok: false, error: 'Unknown action: ' + action };

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
  var action = (e && e.parameter && e.parameter.action) || '';

  // Email approval buttons land here as GET requests
  if (action === 'approve') {
    return _handleEmailApprovalGet(e.parameter);
  }

  // "Write my own" button opens this form page
  if (action === 'custom_form') {
    return _serveCustomForm(e.parameter);
  }

  // Default: health check
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

// ─── TIME CLOCK HANDLERS ───────────────────────────────────────────────────────

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

// Upsert by id: punches with a known id update their row, new ones append.
// Idempotent — re-syncing the same punch never creates a duplicate.
function handlePunchBatch(punches) {
  if (!punches || !punches.length) return { ok: true, synced: 0 };
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Punches',
    ['timestamp', 'employee', 'type', 'note', 'id']);

  var data    = sheet.getDataRange().getValues();
  var iId     = data[0].indexOf('id');
  var rowById = {};
  for (var r = 1; r < data.length; r++) {
    if (data[r][iId]) rowById[data[r][iId]] = r + 1;
  }

  var appends = [];
  punches.forEach(function(p) {
    var vals = [p.timestamp, p.employee, p.type, p.note || '', p.id || ''];
    if (p.id && rowById[p.id]) {
      sheet.getRange(rowById[p.id], 1, 1, 5).setValues([vals]);
    } else {
      appends.push(vals);
    }
  });
  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, 5).setValues(appends);
  }
  return { ok: true, synced: punches.length };
}

// Update a single punch by id (used by the admin timesheet editor).
// Appends the punch if its id is not found.
function handleUpdatePunch(p) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Punches',
    ['timestamp', 'employee', 'type', 'note', 'id']);
  var data  = sheet.getDataRange().getValues();
  var iId   = data[0].indexOf('id');
  var vals  = [p.timestamp, p.employee, p.type, p.note || '', p.id || ''];
  for (var r = 1; r < data.length; r++) {
    if (data[r][iId] && data[r][iId] === p.id) {
      sheet.getRange(r + 1, 1, 1, 5).setValues([vals]);
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow(vals);
  return { ok: true, appended: true };
}

// Delete a single punch by id (used by the admin timesheet editor).
function handleDeletePunch(p) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Punches');
  if (!sheet) return { ok: true };
  var data  = sheet.getDataRange().getValues();
  var iId   = data[0].indexOf('id');
  for (var r = data.length - 1; r >= 1; r--) {
    if (data[r][iId] && data[r][iId] === p.id) {
      sheet.deleteRow(r + 1);
    }
  }
  return { ok: true };
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

// ─── EMAIL APPROVAL HANDLERS ───────────────────────────────────────────────────

// Called when Dylan clicks an approval button in the email (GET request)
function _handleEmailApprovalGet(params) {
  var draftId    = params.draft_id    || '';
  var option     = params.option      || '1';

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Approvals',
    ['timestamp', 'draft_id', 'option', 'custom_text', 'status']);
  sheet.appendRow([new Date().toISOString(), draftId, option, '', 'pending']);

  var isSkip  = (option === 'skip');
  var icon    = isSkip ? '⏭️' : '✅';
  var heading = isSkip ? 'Post Skipped'    : 'Option ' + option + ' Approved!';
  var color   = isSkip ? '#666'            : '#1877F2';
  var sub     = isSkip ? 'The draft has been discarded.' : 'Your caption is queued. The bot will post it within 30 seconds.';

  return HtmlService.createHtmlOutput(
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:-apple-system,Arial,sans-serif;text-align:center;padding:60px 20px;' +
    'max-width:480px;margin:0 auto;background:#fafafa;}' +
    '.icon{font-size:56px;margin-bottom:12px;}' +
    'h2{color:' + color + ';margin:0 0 8px;}' +
    'p{color:#555;margin:6px 0;}' +
    '.footer{color:#bbb;font-size:11px;margin-top:40px;}</style></head>' +
    '<body>' +
    '<div class="icon">' + icon + '</div>' +
    '<h2>' + heading + '</h2>' +
    '<p>' + sub + '</p>' +
    '<p class="footer">You can close this tab.</p>' +
    '</body></html>'
  ).setTitle('DNK — ' + (isSkip ? 'Skipped' : 'Approved'));
}

// Called from the custom-caption form via JS fetch (POST request)
function handleEmailApprovalPost(data) {
  var draftId    = data.draft_id    || '';
  var option     = data.option      || 'custom';
  var customText = data.custom_text || '';

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getOrCreateSheet(ss, 'Approvals',
    ['timestamp', 'draft_id', 'option', 'custom_text', 'status']);
  sheet.appendRow([new Date().toISOString(), draftId, option, customText, 'pending']);
  return { ok: true };
}

// Serves the "write your own caption" HTML form page
function _serveCustomForm(params) {
  var draftId = params.draft_id || '';
  var gasUrl  = ScriptApp.getService().getUrl();

  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DNK — Custom Caption</title>' +
    '<style>' +
    'body{font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;background:#fafafa;}' +
    'h2{color:#1a1a1a;margin-bottom:4px;}' +
    '.sub{color:#666;margin-bottom:20px;font-size:14px;}' +
    'textarea{width:100%;height:160px;font-size:15px;padding:12px;border:1px solid #ccc;' +
    'border-radius:8px;box-sizing:border-box;resize:vertical;font-family:inherit;}' +
    'button{background:#1877F2;color:#fff;border:none;padding:14px;font-size:16px;font-weight:600;' +
    'border-radius:8px;cursor:pointer;width:100%;margin-top:12px;}' +
    'button:disabled{background:#aac4f0;cursor:not-allowed;}' +
    '.hint{color:#999;font-size:12px;margin-top:8px;}' +
    '#done{display:none;text-align:center;padding:40px 0;}' +
    '#done .icon{font-size:52px;margin-bottom:12px;}' +
    '#done h2{color:#1877F2;}' +
    '#done p{color:#555;}' +
    '.footer{color:#ccc;font-size:11px;margin-top:48px;text-align:center;}' +
    '</style></head><body>' +
    '<h2>✏️ Write Your Own Caption</h2>' +
    '<p class="sub">Hashtags are optional — the bot adds them automatically if you leave them out.</p>' +
    '<div id="form-area">' +
    '<textarea id="caption" placeholder="Type your caption here..." required></textarea>' +
    '<p class="hint">Tip: End with 8176023512 if you want the phone number included.</p>' +
    '<button id="btn" onclick="submit()">✅ Queue for Posting</button>' +
    '</div>' +
    '<div id="done">' +
    '<div class="icon">✅</div>' +
    '<h2>Queued!</h2>' +
    '<p>Your caption is saved. The bot will post it within 30 seconds.</p>' +
    '<p class="footer">You can close this tab.</p>' +
    '</div>' +
    '<script>' +
    'var GAS_URL = "' + gasUrl + '";' +
    'var DRAFT_ID = "' + draftId + '";' +
    'function submit() {' +
    '  var text = document.getElementById("caption").value.trim();' +
    '  if (!text) { alert("Please enter a caption."); return; }' +
    '  var btn = document.getElementById("btn");' +
    '  btn.disabled = true; btn.textContent = "Submitting…";' +
    '  fetch(GAS_URL, {' +
    '    method: "POST",' +
    '    body: JSON.stringify({ action: "emailApproval", data: { draft_id: DRAFT_ID, option: "custom", custom_text: text } })' +
    '  })' +
    '  .then(function(r){ return r.json(); })' +
    '  .then(function(d){' +
    '    document.getElementById("form-area").style.display = "none";' +
    '    document.getElementById("done").style.display = "block";' +
    '  })' +
    '  .catch(function(err){' +
    '    btn.disabled = false; btn.textContent = "✅ Queue for Posting";' +
    '    alert("Something went wrong. Try again.");' +
    '  });' +
    '}' +
    '</script>' +
    '<p class="footer">DnK Fabrication Automation</p>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('DNK — Custom Caption');
}

// Called by social_post.py to check for pending email approvals
function handleGetPendingApprovals() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Approvals');
  if (!sheet) return { ok: true, approvals: [] };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, approvals: [] };

  var headers = data[0];
  var iDraftId    = headers.indexOf('draft_id');
  var iOption     = headers.indexOf('option');
  var iCustom     = headers.indexOf('custom_text');
  var iStatus     = headers.indexOf('status');

  var approvals = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][iStatus] === 'pending') {
      approvals.push({
        row_index:   i + 1,
        draft_id:    data[i][iDraftId]   || '',
        option:      String(data[i][iOption] || '1'),
        custom_text: data[i][iCustom]    || ''
      });
    }
  }
  return { ok: true, approvals: approvals };
}

// Called by social_post.py after processing an approval
function handleMarkApprovalProcessed(data) {
  var draftId = data.draft_id || '';
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var sheet   = ss.getSheetByName('Approvals');
  if (!sheet) return { ok: true };

  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var iDraftId = headers.indexOf('draft_id');
  var iStatus  = headers.indexOf('status');

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][iDraftId] === draftId && rows[i][iStatus] === 'pending') {
      sheet.getRange(i + 1, iStatus + 1).setValue('processed');
    }
  }
  return { ok: true };
}
