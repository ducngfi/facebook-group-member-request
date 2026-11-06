const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

const rawCode = fs.readFileSync('run.js', 'utf8');
const htmlMatch = rawCode.match(/const html = \`([\s\S]*?)\`;/);

if (!htmlMatch) {
    console.log("Could not extract HTML from run.js");
    process.exit(1);
}

const html = htmlMatch[1];
const dom = new JSDOM(html);
const document = dom.window.document;

const btns = document.querySelectorAll('[aria-label^="Approve "][role="button"]');
console.log('Buttons found:', btns.length);
btns.forEach(btn => {
    let card = btn;
    let found = false;
    for (let i = 0; i < 20; i++) { // Increased to 20 for safety
        card = card.parentElement;
        if (!card) break;
        const moreBtn = card.querySelector('[aria-label^="More options for"]');
        if (moreBtn && card.querySelector('a[href*="/user/"]')) {
            console.log('Found card at level', i);
            found = true;
            break;
        }
    }
    console.log('Valid card found?', found);
});
