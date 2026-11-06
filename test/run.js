const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = `
<div class="x1y1aw1k xv54qhq x18d9i69 xf7dkkf"><ul><li class="x1y1aw1k xyri2b xwib8y2 x1c1uobl"><span class="x193iq5w xeuugli x13faqbe x1vvkbs xlh3980 xvmahel x1n0sxbx x1lliihq x1s928wv xhkezso x1gmr53x x1cpjm7i x1fgarty x1943h6x x4zkp8e x3x7a5m x6prxxf xvq8zen x1s688f x12scifz" dir="auto">Email đăng ký của anh chị</span><div class="x1gslohp"><span class="x193iq5w xeuugli x13faqbe x1vvkbs xlh3980 xvmahel x1n0sxbx x1lliihq x1s928wv xhkezso x1gmr53x x1cpjm7i x1fgarty x1943h6x x4zkp8e x3x7a5m x6prxxf xvq8zen xo1l8bm xzsf02u" dir="auto">cuongpham.work@gmail.com</span></div></li></ul></div><div class="x1y1aw1k xv54qhq xwib8y2 xf7dkkf"><span class="x193iq5w xeuugli x13faqbe x1vvkbs xlh3980 xvmahel x1n0sxbx x1lliihq x1s928wv xhkezso x1gmr53x x1cpjm7i x1fgarty x1943h6x x4zkp8e x3x7a5m x6prxxf xvq8zen x1s688f x12scifz" dir="auto">Do you agree to the group rules from the admin?</span><div class="x1gslohp"><span class="x193iq5w xeuugli x13faqbe x1vvkbs xlh3980 xvmahel x1n0sxbx x1lliihq x1s928wv xhkezso x1gmr53x x1cpjm7i x1fgarty x1943h6x x4zkp8e x3x7a5m x6prxxf xvq8zen xo1l8bm xzsf02u" dir="auto">I agree</span></div></div>
`;

const dom = new JSDOM(html);
const document = dom.window.document;

function extractQA(card) {
    const qa = [];
    const answerDivs = card.querySelectorAll('.x1gslohp');

    answerDivs.forEach(answerDiv => {
        const answerText = answerDiv.textContent.trim();
        if (!answerText) return;

        let questionText = '';
        const parentLi = answerDiv.closest('li');

        console.log("Found answer div:", answerText);
        console.log("Parent li exists?", !!parentLi);

        if (parentLi) {
            const allSpans = Array.from(parentLi.querySelectorAll('span[dir="auto"]'));
            console.log("Spans in li:", allSpans.map(s => s.textContent));
            const questionSpan = allSpans.find(span => !answerDiv.contains(span));
            if (questionSpan) {
                questionText = questionSpan.textContent.trim();
            }
        }

        if (!questionText) {
            let prevSibling = answerDiv.previousElementSibling;
            console.log("Checking previous sibling:", prevSibling ? prevSibling.tagName : 'null');
            while (prevSibling) {
                if (prevSibling.tagName === 'SPAN') {
                    questionText = prevSibling.textContent.trim();
                    break;
                }
                prevSibling = prevSibling.previousElementSibling;
            }

            if (!questionText && answerDiv.previousElementSibling) {
                questionText = answerDiv.previousElementSibling.textContent.trim();
            }
        }

        console.log("Matched Question:", questionText);

        if (questionText && answerText) {
            qa.push({ question: questionText, answer: answerText });
        }
    });

    return qa;
}

function findMemberCards(document) {
    const cards = [];
    const buttons = document.querySelectorAll('[aria-label^="Approve "][role="button"]');

    buttons.forEach(btn => {
        const nameMatch = btn.getAttribute('aria-label').match(/Approve (.*)/);
        if (!nameMatch) return;
        const name = nameMatch[1];
        if (name === 'all') return; // Skip "Approve all"

        let card = btn;
        for (let i = 0; i < 15; i++) {
            card = card.parentElement;
            if (!card) break;

            const moreBtn = card.querySelector(`[aria-label="More options for ${name}"]`) ||
                card.querySelector('[aria-label^="More options for"]');

            if (moreBtn && card.querySelector('a[href*="/user/"]')) {
                cards.push({ element: card, name });
                break;
            }
        }
    });

    return cards;
}

const cards = findMemberCards(document);
console.log("Found cards:", cards.length);
cards.forEach(c => {
    console.log("Card HTML contains answers?", c.element.innerHTML.includes('cuongpham.work@gmail.com'));
    const res = extractQA(c.element);
    console.log("Extracted QA for", c.name, ":", res);
});

