/**
 * FB Group Member Request Collector — Google Sheets receiver.
 *
 * Deploy this as a Web app (see README.md). The extension's "Push to Sheet"
 * button POSTs the collected members here, and this script appends them to the
 * sheet in the same layout as the extension's CSV export:
 *   # | Name | Facebook Profile URL | Question 1 | Answer 1 | Question 2 | Answer 2 | ...
 *
 * Members whose profile URL is already in the sheet are skipped, so pushing the
 * same batch twice does not create duplicates. The response says, per member,
 * whether it was added or already there, so the extension can approve exactly
 * the members that are safely recorded in the sheet.
 */

// The spreadsheet and tab to write to.
const SHEET_ID = '1AbU9PzM5f1wSxlfKbpqWIj2ggoBuP6BzlxupOmWak8U';
const SHEET_GID = 0; // the "gid=" in the sheet URL

// No token: the web app URL itself is the shared key, so only share it with the team.

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(appendMembers_(body.members || []));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Lets you open the web app URL in a browser to check it is deployed.
function doGet() {
  return json_({ ok: true, message: 'FB Member Collector receiver is running.' });
}

function appendMembers_(members) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID) || ss.getSheets()[0];

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 3);
  let header = lastRow > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
    : ['#', 'Name', 'Facebook Profile URL'];

  // Existing profiles (and the highest # so numbering continues)
  const seenUrls = new Set();
  const seenNamesWithoutUrl = new Set();
  let maxNum = 0;
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach(r => {
      const n = Number(r[0]);
      if (!isNaN(n) && n > maxNum) maxNum = n;
      const url = normalizeUrl_(r[2]);
      if (url) seenUrls.add(url);
      else if (r[1]) seenNamesWithoutUrl.add(String(r[1]).trim());
    });
  }

  const rows = [];
  let skipped = 0;
  // Per member (same order as sent): 'added', 'exists' (already in the sheet) or 'invalid'.
  // The extension approves only members that are 'added' or 'exists'.
  const statuses = [];
  members.forEach(m => {
    const name = String(m.name || '').trim();
    const url = normalizeUrl_(m.realProfileUrl);
    if (!name && !url) { statuses.push('invalid'); return; }
    if (url ? seenUrls.has(url) : seenNamesWithoutUrl.has(name)) { skipped++; statuses.push('exists'); return; }
    if (url) seenUrls.add(url); else seenNamesWithoutUrl.add(name);
    statuses.push('added');

    const row = [++maxNum, name, m.realProfileUrl || ''];
    (m.qa || []).forEach(q => { row.push(q.question || '', q.answer || ''); });
    rows.push(row);
  });

  if (rows.length === 0) {
    return { ok: true, added: 0, skipped: skipped, statuses: statuses };
  }

  // Grow the header if this batch has more questions than the sheet has columns for
  const width = Math.max(header.length, ...rows.map(r => r.length));
  if (lastRow === 0 || width > header.length) {
    for (let i = header.length; i < width; i++) {
      const k = Math.floor((i - 3) / 2) + 1;
      header.push((i - 3) % 2 === 0 ? 'Question ' + k : 'Answer ' + k);
    }
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    if (lastRow === 0) sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }

  const padded = rows.map(r => r.concat(new Array(width - r.length).fill('')));
  const startRow = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(startRow, 1, padded.length, width).setValues(padded);

  SpreadsheetApp.flush();
  return { ok: true, added: rows.length, skipped: skipped, statuses: statuses };
}

function normalizeUrl_(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  // profile.php?id=123 profiles are identified by their id, so keep it
  const id = s.match(/[?&]id=(\d+)/);
  const path = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.|m\.|web\.)?/i, '').toLowerCase();
  return id ? path + '?id=' + id[1] : path;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
