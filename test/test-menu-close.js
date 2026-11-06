// Runs content.js against a mock member-requests page whose "..." menus behave
// like Facebook's: open on click, ignore untrusted Escape, close on an outside
// mousedown or on clicking the same "..." button again.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const members = ['Thành Lý', 'Anh Thanh', 'Minh Tú'];
const cards = members.map((n, i) => `
  <div class="card">
    <a href="https://www.facebook.com/groups/1/user/${100 + i}/">${n}</a>
    <div role="button" aria-label="Approve ${n}">Approve</div>
    <div role="button" aria-label="More options for ${n}" aria-expanded="false" data-user="${i}">...</div>
    <ul><li><span dir="auto">Q1?</span><div class="x1gslohp"><span dir="auto">answer ${i}</span></div></li></ul>
  </div>`).join('');

const dom = new JSDOM(`<body><div role="button" aria-label="Approve all">Approve all</div><div id="list">${cards}</div><div id="layer"></div></body>`,
  { url: 'https://www.facebook.com/groups/1/requests', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

const openMenus = new Map(); // button -> menu element
window.Element.prototype.scrollIntoView = function () {};
doc.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('[aria-label^="More options for"]');
  if (!btn) return;
  if (openMenus.has(btn)) { close(btn); return; }
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<a role="menuitem" href="https://www.facebook.com/real.user${btn.dataset.user}?__tn__=x">View profile</a><div role="menuitem">Limit activity</div>`;
  doc.getElementById('layer').appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  openMenus.set(btn, menu);
});
doc.addEventListener('mousedown', e => {
  for (const [btn, menu] of [...openMenus]) if (!menu.contains(e.target) && !btn.contains(e.target)) close(btn);
});
function close(btn) { openMenus.get(btn).remove(); openMenus.delete(btn); btn.setAttribute('aria-expanded', 'false'); }

let maxOpen = 0;
new window.MutationObserver(() => { maxOpen = Math.max(maxOpen, openMenus.size); })
  .observe(doc.getElementById('layer'), { childList: true });

const store = {};
let listener;
window.chrome = {
  storage: { local: {
    set: (o, cb) => { Object.assign(store, o); cb && cb(); },
    get: (k, cb) => cb(Object.fromEntries(k.map(x => [x, store[x]]))),
  } },
  runtime: { onMessage: { addListener: fn => { listener = fn; } } },
};
window.console.log = () => {};
window.eval(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'));

listener({ action: 'collect', options: { autoScroll: false } }, {}, () => {});
const t0 = Date.now();
const iv = setInterval(() => {
  if (store.status !== 'done' && store.status !== 'error' && Date.now() - t0 < 60000) return;
  clearInterval(iv);
  const got = (store.collectedMembers || []).map(m => `${m.name} -> ${m.realProfileUrl}`);
  console.log(store.statusMessage); got.forEach(g => console.log('  ' + g));
  const urlsOk = members.every((n, i) => store.collectedMembers?.[i]?.realProfileUrl === `https://www.facebook.com/real.user${i}`);
  const ok = store.status === 'done' && urlsOk && openMenus.size === 0 && maxOpen <= 1;
  console.log(`open menus at end: ${openMenus.size}, max open at once: ${maxOpen}`);
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}, 200);
