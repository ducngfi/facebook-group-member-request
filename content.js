/**
 * FB Group Member Request Collector - Content Script
 * Scrapes member request data from the Facebook group admin requests page.
 *
 * Architecture: All progress and collected data is saved to chrome.storage.local
 * so the popup can close/reopen without losing state.
 */

(() => {
  let isCollecting = false;
  let shouldStop = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save current state to chrome.storage.local
   */
  function saveState(state) {
    chrome.storage.local.set(state);
  }

  /**
   * Auto-scroll to load all member requests.
   */
  async function autoScroll() {
    let previousHeight = 0;
    let sameHeightCount = 0;
    const maxSameHeight = 5;

    saveState({ status: 'scrolling', statusMessage: 'Auto-scrolling to load all member requests...' });

    while (sameHeightCount < maxSameHeight && !shouldStop) {
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight === previousHeight) {
        sameHeightCount++;
      } else {
        sameHeightCount = 0;
      }
      previousHeight = currentHeight;
      window.scrollTo(0, currentHeight);
      await sleep(1500);
    }

    window.scrollTo(0, 0);
    await sleep(500);
    saveState({ status: 'collecting', statusMessage: 'Finished scrolling. Starting data collection...' });
  }

  /**
   * Find all member request cards.
   */
  function findMemberCards() {
    const cards = [];
    const seen = new Set();
    const buttons = document.querySelectorAll('[aria-label^="Approve "][role="button"], [aria-label^="Phê duyệt "][role="button"]');

    buttons.forEach(btn => {
      const rawLabel = btn.getAttribute('aria-label');
      if (rawLabel === 'Approve all' || rawLabel === 'Phê duyệt tất cả') return;

      const name = rawLabel.replace(/^Approve\s+/, '').replace(/^Phê duyệt\s+/, '');
      if (!name || name.length < 2) return;
      if (name.toLowerCase() === 'all') return;

      let card = btn;
      let highestCard = card;

      for (let i = 0; i < 20; i++) {
        const parent = card.parentElement;
        if (!parent) break;

        let approveCount = 0;
        const parentBtns = parent.querySelectorAll('[aria-label^="Approve "][role="button"], [aria-label^="Phê duyệt "][role="button"]');
        parentBtns.forEach(pb => {
          const pbLabel = pb.getAttribute('aria-label');
          if (pbLabel !== 'Approve all' && pbLabel !== 'Phê duyệt tất cả') {
            approveCount++;
          }
        });

        if (approveCount > 1) {
          // If we hit a container with multiple approve buttons, we've gone too far.
          break;
        }

        highestCard = parent;
        card = parent;
      }

      if (!seen.has(highestCard)) {
        seen.add(highestCard);
        cards.push({ element: highestCard, name });
      }
    });

    return cards;
  }

  /**
   * Extract the group profile URL from a card.
   */
  function extractGroupProfileUrl(card) {
    const links = card.querySelectorAll('a[href*="/user/"]');
    for (const link of links) {
      const text = link.textContent.trim();
      if (text.length > 0 && !text.includes('University') && !text.includes('Studied')) {
        return link.href;
      }
    }
    const first = card.querySelector('a[href*="/user/"]');
    return first ? first.href : '';
  }

  /**
   * Extract Q&A answers from a card.
   *
   * Based on precise DOM inspection:
   * Facebook always places the *Answer* inside a <div class="x1gslohp">.
   * The *Question* is the preceding <span> element, either as a direct sibling
   * or the first child of the parent <li> container.
   */
  function extractQA(card) {
    const qa = [];

    // Find all answer containers
    const answerDivs = card.querySelectorAll('.x1gslohp');

    answerDivs.forEach(answerDiv => {
      // The answer text is inside this div (usually a span)
      const answerText = answerDiv.textContent.trim();
      if (!answerText) return;

      let questionText = '';

      // Strategy 1: Custom questions are usually in a <ul><li> structure.
      // The <li> contains a <span> (the question) and then the x1gslohp <div> (the answer).
      const parentLi = answerDiv.closest('li');
      if (parentLi) {
        // Find the first span in the li that isn't inside the answer div
        const allSpans = Array.from(parentLi.querySelectorAll('span[dir="auto"]'));
        const questionSpan = allSpans.find(span => !answerDiv.contains(span));
        if (questionSpan) {
          questionText = questionSpan.textContent.trim();
        }
      }

      // Strategy 2: Standard questions (like Rules Agreement) are direct siblings.
      // The structure is <span>Question</span> <div class="x1gslohp">Answer</div>
      if (!questionText) {
        let prevSibling = answerDiv.previousElementSibling;
        while (prevSibling) {
          if (prevSibling.tagName === 'SPAN') {
            questionText = prevSibling.textContent.trim();
            break;
          }
          // Sometimes it might be wrapped in another div, so we check its textContent overall if it's the immediate sibling
          prevSibling = prevSibling.previousElementSibling;
        }

        // Fallback: If no previous sibling span, just grab the text of the previous element
        if (!questionText && answerDiv.previousElementSibling) {
          questionText = answerDiv.previousElementSibling.textContent.trim();
        }
      }

      if (questionText && answerText) {
        qa.push({
          question: questionText,
          answer: answerText
        });
      }
    });

    return qa;
  }

  /**
   * Click the 3-dot menu and extract the real profile URL from "View profile".
   */
  async function extractRealProfileUrl(card, memberName) {
    const moreBtn = card.querySelector(`[aria-label="More options for ${memberName}"]`) ||
      card.querySelector('[aria-label^="More options for"]');

    if (!moreBtn) {
      console.log('[FB Collector] Could not find "More options" button for', memberName);
      return '';
    }

    // Snapshot existing "View profile" hrefs BEFORE clicking
    const existingHrefs = new Set();
    document.querySelectorAll('a').forEach(a => {
      const text = a.textContent.trim();
      if (text === 'View profile' || text === 'Xem trang cá nhân') {
        existingHrefs.add(a.href);
      }
    });
    const existingLinks = new Set(
      document.querySelectorAll('[role="menuitem"] a, [role="menu"] a')
    );

    // Scroll and click
    moreBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(500);
    moreBtn.click();
    await sleep(2500);

    // Find the NEW "View profile" link
    let profileUrl = '';

    // Strategy A: New href
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent.trim();
      if ((text === 'View profile' || text === 'Xem trang cá nhân') && link.href) {
        if (!existingHrefs.has(link.href)) {
          profileUrl = link.href;
          break;
        }
      }
    }

    // Strategy B: New DOM element
    if (!profileUrl) {
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      for (const item of menuItems) {
        const text = item.textContent.trim();
        if (text === 'View profile' || text === 'Xem trang cá nhân') {
          if (!existingLinks.has(item)) {
            const link = item.tagName === 'A' ? item : (item.closest('a') || item.querySelector('a'));
            if (link && link.href) {
              profileUrl = link.href;
              break;
            }
          }
        }
      }
    }

    // Strategy C: Visible on screen
    if (!profileUrl) {
      for (const link of allLinks) {
        const text = link.textContent.trim();
        if ((text === 'View profile' || text === 'Xem trang cá nhân') && link.href) {
          const rect = link.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
            profileUrl = link.href;
            break;
          }
        }
      }
    }

    // Close the menu
    const activeEl = document.activeElement || document.body;
    activeEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(500);

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(300);

    try {
      const overlay = document.querySelector('[data-visualcompletion="ignore-dynamic"]');
      if (overlay && typeof overlay.click === 'function') {
        overlay.click();
      }
    } catch (e) { /* ignore */ }
    await sleep(200);

    document.body.click();
    await sleep(500);

    // Clean URL
    if (profileUrl) {
      try {
        const url = new URL(profileUrl);
        url.searchParams.delete('__tn__');
        url.searchParams.delete('__cft__[0]');
        profileUrl = url.toString();
      } catch (e) { /* ignore */ }
    }

    console.log(`[FB Collector] Profile URL for ${memberName}: ${profileUrl}`);
    return profileUrl;
  }

  /**
   * Main collection function.
   */
  async function collectMembers(options = {}) {
    if (isCollecting) {
      return { error: 'Collection already in progress' };
    }

    isCollecting = true;
    shouldStop = false;

    // Clear previous data and set initial state
    saveState({
      status: 'running',
      statusMessage: 'Starting collection...',
      collectedMembers: [],
      progressCurrent: 0,
      progressTotal: 0,
      lastUpdated: new Date().toISOString()
    });

    try {
      // Step 1: Auto-scroll
      if (options.autoScroll !== false) {
        await autoScroll();
      }

      if (shouldStop) {
        saveState({ status: 'stopped', statusMessage: 'Stopped by user.' });
        isCollecting = false;
        return;
      }

      // Step 2: Find all member cards
      const cards = findMemberCards();
      saveState({
        status: 'collecting',
        statusMessage: `Found ${cards.length} member request(s). Extracting data...`,
        progressCurrent: 0,
        progressTotal: cards.length
      });

      if (cards.length === 0) {
        saveState({
          status: 'error',
          statusMessage: 'No member request cards found. Make sure you are on the correct page.'
        });
        isCollecting = false;
        return;
      }

      // Step 3: Extract data from each card
      const members = [];

      for (let i = 0; i < cards.length; i++) {
        if (shouldStop) {
          saveState({
            status: 'stopped',
            statusMessage: `Stopped by user. Collected ${members.length} of ${cards.length} members.`,
            collectedMembers: members,
            lastUpdated: new Date().toISOString()
          });
          isCollecting = false;
          return;
        }

        const { element: card, name } = cards[i];

        saveState({
          status: 'collecting',
          statusMessage: `Processing ${name} (${i + 1}/${cards.length})...`,
          progressCurrent: i + 1,
          progressTotal: cards.length
        });

        const groupProfileUrl = extractGroupProfileUrl(card);
        const qa = extractQA(card);
        const realProfileUrl = await extractRealProfileUrl(card, name);

        members.push({
          name,
          groupProfileUrl,
          realProfileUrl,
          qa
        });

        // Save incrementally after each member
        saveState({
          collectedMembers: members,
          progressCurrent: i + 1,
          lastUpdated: new Date().toISOString()
        });

        await sleep(800);
      }

      // Done — save to history
      const session = {
        id: Date.now(),
        date: new Date().toISOString(),
        memberCount: members.length,
        members: members,
        groupUrl: window.location.href
      };

      // Append to history
      chrome.storage.local.get(['scrapeHistory'], (result) => {
        const history = result.scrapeHistory || [];
        history.unshift(session); // newest first
        // Keep last 50 sessions max
        if (history.length > 50) history.length = 50;
        chrome.storage.local.set({ scrapeHistory: history });
      });

      saveState({
        status: 'done',
        statusMessage: `✅ Successfully collected ${members.length} member(s).`,
        collectedMembers: members,
        progressCurrent: members.length,
        progressTotal: members.length,
        lastUpdated: new Date().toISOString()
      });

    } catch (error) {
      console.error('[FB Collector] Error:', error);
      saveState({
        status: 'error',
        statusMessage: `❌ Error: ${error.message}`
      });
    } finally {
      isCollecting = false;
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'collect') {
      collectMembers(request.options);
      sendResponse({ started: true });
      return true;
    }
    if (request.action === 'stop') {
      shouldStop = true;
      sendResponse({ ok: true });
      return true;
    }
    if (request.action === 'ping') {
      sendResponse({ ok: true, isCollecting });
      return true;
    }
  });

  console.log('[FB Member Collector] Content script loaded and ready.');
})();
