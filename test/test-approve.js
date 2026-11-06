// Mock requests page: two members share a name, so approval must use the /user/<id> link.
// Clicking Approve replaces the button with "Approved" text, like Facebook does.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const people = [
  { name: 'Anh Thanh', id: 201 },
  { name: 'Anh Thanh', id: 202 },
  { name: 'Thành Lý', id: 203 },
  { name: 'Minh Tú', id: 204 },
];
const cards = people.map(p => `
  <div class="card" data-id="${p.id}">
    <a href="https://www.facebook.com/groups/1/user/${p.id}/">${p.name}</a>
    <div role="button" aria-label="Approve ${p.name}">Approve</div>
    <div role="button" aria-label="Decline ${p.name}">Decline</div>
  </div>`).join('');
const dom = new JSDOM(`<body><div role="button" aria-label="Approve all">Approve all</div><div id="list">${cards}</div></body>`,
  { url: 'https://www.facebook.com/groups/1/requests', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom; const doc = window.document;
window.Element.prototype.scrollIntoView = function () {};
const approvedIds = [];
doc.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('[aria-label^="Approve "]');
  if (!btn || btn.getAttribute('aria-label') === 'Approve all') return;
  const card = btn.closest('.card');
  approvedIds.push(Number(card.dataset.id));
  setTimeout(() => { btn.parentElement.querySelectorAll('[role="button"]').forEach(b => b.remove()); card.append(' Approved'); }, 300);
});

const store = { collectedMembers: people.map(p => ({ name: p.name, groupProfileUrl: `https://www.facebook.com/groups/1/user/${p.id}/` })) };
let listener;
window.CSS = { escape: s => s.replace(/["\\]/g, '\\$&') };
window.chrome = {
  storage: { local: {
    set: (o, cb) => { Object.assign(store, o); cb && cb(); },
    get: (k, cb) => cb(Object.fromEntries(k.map(x => [x, store[x]]))),
  } },
  runtime: { onMessage: { addListener: fn => { listener = fn; } } },
};
window.console.log = () => {};
window.eval(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'));

// Approve the second "Anh Thanh" (id 202) and Minh Tú, plus someone who is not on the page.
const toApprove = [
  { name: 'Anh Thanh', groupProfileUrl: 'https://www.facebook.com/groups/1/user/202/' },
  { name: 'Minh Tú', groupProfileUrl: 'https://www.facebook.com/groups/1/user/204/' },
  { name: 'Ghost Person', groupProfileUrl: 'https://www.facebook.com/groups/1/user/999/' },
];
let resp;
listener({ action: 'approve', members: toApprove }, {}, r => { resp = r; });
const t0 = Date.now();
const iv = setInterval(() => {
  if (store.status === 'approving' && Date.now() - t0 < 60000) return;
  if (!store.approveResult) return;
  clearInterval(iv);
  setTimeout(() => {
    console.log(store.statusMessage);
    console.log('clicked approve on ids:', approvedIds.join(', '));
    const marked = store.collectedMembers.filter(m => m.approved).map(m => m.groupProfileUrl.match(/\d+/g).pop());
    console.log('marked approved in storage:', marked.join(', '));
    const ok = resp.started && approvedIds.join() === '202,204' && marked.join() === '202,204'
      && store.approveResult.approved === 2 && store.approveResult.not_found === 1;
    console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
  }, 100);
}, 200);
