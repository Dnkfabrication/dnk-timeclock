# DnK Time Clock

Shop time clock for DnK Fabrication. Mobile-first, works offline, syncs to Google Sheets.

## Quick Start

1. Open `index.html` in any browser, or host at `https://Dnkfabrication.github.io/dnk-timeclock/`
2. Tap the gear icon → add employees (name, hourly rate, weekly deductions)
3. Select an employee from the dropdown → tap the big button to clock in/out
4. Add to home screen on mobile (iOS: Share → Add to Home Screen)

---

## Google Sheets Setup (optional — required for payroll export)

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **DnK Time Clock**
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**THIS_IS_THE_ID**`/edit`
4. Paste the Sheet ID into the app: gear icon → GOOGLE SHEETS → Sheet ID
5. The app will automatically create **Punches** and **Weekly** tabs on first sync

### 2. Create an OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **Google Sheets API**:
   APIs & Services → Enable APIs & Services → search "Google Sheets API" → Enable
4. Create OAuth credentials:
   APIs & Services → Credentials → Create Credentials → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Name: `DnK Time Clock`
7. Under **Authorized JavaScript origins**, add:
   - `https://Dnkfabrication.github.io` (for GitHub Pages hosting)
   - `http://localhost` (for local testing, if needed)
8. Click **Create** → copy the **Client ID** (ends in `.apps.googleusercontent.com`)
9. Paste the Client ID into the app: gear icon → GOOGLE SHEETS → OAuth Client ID

### 3. Sign In

1. Open the app → gear icon → tap **SIGN IN WITH GOOGLE**
2. Sign in as `dylan@dnkfabrication.com`
3. Auth status will change to **✓ Connected to Google Sheets**
4. Any offline punches sync automatically after sign-in

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

When you come back online and sign in to Google, tap **SYNC OFFLINE PUNCHES** to push any pending punches to the Google Sheet.

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
4. Make sure that origin is added to your OAuth Client ID's Authorized JavaScript origins

---

## Data & Privacy

All time data stays in the browser's `localStorage` unless you explicitly export to Google Sheets. Nothing is sent to any third-party server. Google OAuth tokens are stored locally and expire after 1 hour, requiring re-authentication.
