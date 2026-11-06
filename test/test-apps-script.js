// Runs google-apps-script/Code.gs against an in-memory sheet.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let grid = [
  ['#', 'Name', 'Facebook Profile URL', 'Question 1', 'Answer 1', 'Question 2', 'Answer 2'],
  [1, 'Thành Lý', 'https://www.facebook.com/lecongthanhtn', 'Q1', '1', 'Rules?', 'No response'],
  [2, 'Anh Thanh', 'https://www.facebook.com/profile.php?id=111', 'Q1', 'hr', '', ''],
];
const sheet = {
  getSheetId: () => 0,
  getLastRow: () => grid.length,
  getLastColumn: () => Math.max(...grid.map(r => r.length)),
  getRange: (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }),
    setFontWeight: () => {},
  }),
};
const ctx = {
  SpreadsheetApp: { openById: () => ({ getSheets: () => [sheet] }), flush: () => {} },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
};
vm.createContext(ctx);
const code = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
vm.runInContext(code, ctx);
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }));

const empty = post({ members: [] });
const members = [
  { name: 'Thành Lý', realProfileUrl: 'https://www.facebook.com/lecongthanhtn/' },          // exists (trailing slash)
  { name: 'Someone', realProfileUrl: 'https://www.facebook.com/profile.php?id=111' },      // exists (id url)
  { name: 'Other', realProfileUrl: 'https://www.facebook.com/profile.php?id=222' },        // new, different id
  { name: 'New Guy', realProfileUrl: 'https://www.facebook.com/newguy', qa: [1, 2, 3].map(i => ({ question: 'Q' + i, answer: 'A' + i })) },
  { name: 'New Guy', realProfileUrl: 'https://www.facebook.com/newguy' },                  // duplicate inside batch
];
const r1 = post({ members });
const r2 = post({ members });
console.log('empty push:', JSON.stringify(empty));
console.log('first push:', JSON.stringify(r1));
console.log('second push:', JSON.stringify(r2));
console.log('header:', grid[0].join(' | '));
grid.slice(1).forEach(r => console.log('  ', r.slice(0, 3).join(' | ')));
const ok = empty.ok && empty.added === 0 && r1.added === 2 && r1.statuses.join() === 'exists,exists,added,added,exists'
  && r2.added === 0 && r2.statuses.every(s => s === 'exists') && grid.length === 5
  && grid[0].length === 9 && grid[4][0] === 4;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
