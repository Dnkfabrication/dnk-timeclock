# DnK Time Clock

Shop time clock for DnK Fabrication. Mobile-first, works offline, syncs to Google Sheets.

## Quick Start

1. Open `index.html` in any browser, or host at `https://Dnkfabrication.github.io/dnk-timeclock/`
2. Tap the gear icon → add employees (name, hourly rate, weekly deductions)
3. Select an employee from the dropdown → tap the big button to clock in/out
4. Add to home screen on mobile (iOS: Share → Add to Home Screen)

---

## Google Sheets Sync

The app syncs punches and payroll to a Google Sheet through a Google Apps
Script web app. This is already set up — there is nothing to configure.

- **Spreadsheet:** "DnK Automation" (owned by dylan@dnkfabrication.com)
- **Backend:** the Apps Script in `apps-script/Code.gs`, deployed as a web app
- **Endpoint:** hardcoded as `GAS_URL` in `js/app.js` — the single source of truth

The app writes three tabs automatically: **Punches** (raw log), **Weekly**
(payroll summaries, written on export), and **Approvals** (shared with the DnK
social-post bot).

### Re-deploying the backend

If you edit `apps-script/Code.gs`, paste it into the Apps Script editor for the
"DnK Time Clock" project, then **Deploy → Manage deployments → Edit → Deploy**
to publish a new version. Keep the deploy settings as:

- **Execute as:** Me (dylan@dnkfabrication.com)
- **Who has access:** Anyone

If the `/exec` URL ever changes, update `GAS_URL` at the top of `js/app.js`.

---

## Usage

| Action | How |
|--------|-----|
| Clock In | Select employee → tap **CLOCK IN** |
| Clock Out | Tap **CLOCK OUT** (same big button) |
| Start Lunch | Tap **START LUNCH** while clocked in |
| End Lunch | Tap **END LUNCH** |
| View Payroll | Tap **PAYROLL** tab in the bottom nav |
| Export to Sheets | PAYROLL tab → **EXPORT WEEK TO SHEET** |
| Add Employee | Gear icon → EMPLOYEES section |

The payroll tab auto-highlights in orange on Fridays as a reminder.

The gear icon shows an orange dot when there are unsynced offline punches.

---

## Offline Mode

The app works fully offline. All punches are saved to the browser's `localStorage` immediately.

When you come back online, open Settings and tap **SYNC OFFLINE PUNCHES** to push any pending punches to the Google Sheet.

> **Important:** Punches are stored per-browser/device. If an employee clocks in on a different phone or computer, those punches live on that device. Sync to Sheets regularly to consolidate data across devices.

---

## Sheet Structure

### Punches tab — raw punch log

| timestamp | employee | type | note |
|-----------|----------|------|------|
| ISO 8601 datetime | Employee name | CLOCK_IN / LUNCH_START / LUNCH_END / CLOCK_OUT | optional |

### Weekly tab — computed summaries (written on export)

| week_ending | employee | mon | tue | wed | thu | fri | total_hours | rate | deductions | gross | net |
|-------------|----------|-----|-----|-----|-----|-----|-------------|------|------------|-------|-----|
| YYYY-MM-DD | Name | hrs | hrs | hrs | hrs | hrs | hrs | $/hr | $ | $ | $ |

---

## Hosting on GitHub Pages

1. Push this folder to a GitHub repo (e.g., `Dnkfabrication/dnk-timeclock`)
2. Repo Settings → Pages → Source: `main` branch, root `/`
3. Site publishes at `https://Dnkfabrication.github.io/dnk-timeclock/`

---

## Data & Privacy

All time data stays in the browser's `localStorage` until it syncs to Google Sheets. Sync goes only to your own Apps Script web app — no third-party servers are involved.
