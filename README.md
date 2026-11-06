# FB Group Member Request Collector

Chrome extension that collects pending member requests (name, real profile URL, answers) from a Facebook group's admin page. One click pushes them to Google Sheets and approves them in the group.

## Install (team members)

1. Get the latest `fb-member-collector-v<version>.zip` from the team and unzip it somewhere permanent (Chrome loads the extension from that folder, so don't delete it).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `fb-member-collector-v<version>` folder.
4. Pin the extension from the puzzle icon in the toolbar.

Nothing to configure: the team's Google Sheet connection is built in. To update, unzip the new version over the old folder and click the reload icon on the extension card.

## Use

1. Open the group's member requests page (`facebook.com/groups/<group>/requests`).
2. Click the extension icon, then **Collect Members**. It scrolls the page, reads each request card and opens each card's "..." menu to read the real profile link. Each menu is closed again before moving on.
3. Click **🟢 Push & Approve**:
   - The members are appended to the Google Sheet. Anyone whose profile URL is already in the sheet is skipped, so the sheet never gets duplicate rows.
   - Every member the sheet confirms (just added, or already there from an earlier push) is then approved in the group. A request that was pushed earlier but never approved gets approved on the next run.
   - Members not in the sheet are never approved. If the push fails, nothing is approved.
4. Turn off **Approve members in the group after pushing** (in the Google Sheet panel) to push without approving. The button then reads **🟢 Push to Sheet**.

The **Stop** button also stops an approval run that is under way. Approved members get an `approved` tag in the results table.

## Google Sheet setup (sheet owner, one time)

The sheet is https://docs.google.com/spreadsheets/d/1AbU9PzM5f1wSxlfKbpqWIj2ggoBuP6BzlxupOmWak8U/edit (tab `gid=0`). Every copy of the extension writes to it through one Apps Script web app that runs under the sheet owner's Google account, so team members don't need edit access to the sheet or any setup of their own.

1. Open the sheet, then **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and save.
3. **Deploy → New deployment →** type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**, allow access when Google asks, and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
4. Paste that URL into `SHEET_WEB_APP_URL` in [`config.js`](config.js).
5. Run `./scripts/package.sh` and share `dist/fb-member-collector-v<version>.zip` with the team.

Opening the web app URL in a browser should return `{"ok":true,...}`.

**When you change `Code.gs` later**, use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same and nobody has to reinstall.

There is no token: the web app URL is the key. Anyone who has it can add rows to the sheet, so only share the zip (and the URL) inside the team. If it leaks, create a new deployment, put the new URL in `config.js`, re-package, and archive the old deployment.

Rows use the same layout as the CSV export: `# | Name | Facebook Profile URL | Question 1 | Answer 1 | ...`. Question/Answer columns are added to the header when a request has more questions than before.

To test against a different sheet, open **🟢 Google Sheet → Advanced** in the popup and paste another web app URL. Leave it empty to go back to the team sheet.

## Releasing a new version

1. Bump `version` in `manifest.json`.
2. Run `./scripts/package.sh` and share the new zip.

## Tests

```bash
cd test && npm install
node test-menu-close.js     # "..." menus close after reading each member
node test-approve.js        # approves the right card (even with same-name members)
node test-apps-script.js    # sheet append + duplicate check
```
