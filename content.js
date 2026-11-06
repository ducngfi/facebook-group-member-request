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
   * Visible Facebook dropdown menus currently on screen.
   */
  function findVisibleMenus() {
    return Array.from(document.querySelectorAll('[role="menu"]')).filter(el => {
      if (!el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    });
  }

  function isMenuOpen(moreBtn) {
    if (moreBtn && moreBtn.getAttribute('aria-expanded') === 'true') return true;
    return findVisibleMenus().length > 0;
  }

  function pressEscape(target) {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  /**
   * Simulate a full outside click (pointer + mouse events). Facebook closes
   * menus on an outside pointerdown/mousedown, which a bare .click() never sends.
   */
  function clickOutside() {
    // Dispatch on <body> itself (never on a link/button that happens to be under a point)
    const x = 5, y = Math.round(window.innerHeight / 2);
    const target = document.body;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    target.dispatchEvent(new Pointer('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', base));
    target.dispatchEvent(new Pointer('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', base));
    target.dispatchEvent(new MouseEvent('click', base));
  }

  /**
   * Close any open "More options" menu and verify it is actually gone.
   * Tries Escape, then toggling the "..." button, then an outside click.
   */
  async function closeOpenMenus(moreBtn) {
    if (!isMenuOpen(moreBtn)) return true;

    const attempts = [
      () => {
        // Focus sits inside the open menu, so send Escape there first
        const menu = findVisibleMenus()[0];
        pressEscape(document.activeElement && document.activeElement !== document.body
          ? document.activeElement
          : (menu || document.body));
      },
      () => pressEscape(document),
      () => {
        // Clicking the same "..." button again toggles its menu closed
        if (moreBtn && moreBtn.isConnected && moreBtn.getAttribute('aria-expanded') !== 'false') {
          moreBtn.click();
        }
      },
      () => clickOutside(),
    ];

    for (const attempt of attempts) {
      try { attempt(); } catch (e) { /* ignore */ }
      await sleep(400);
      if (!isMenuOpen(moreBtn)) return true;
    }

    // Last resort: blur whatever is focused and try Escape + outside click once more
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) { /* ignore */ }
    pressEscape(document.body);
    clickOutside();
    await sleep(500);

    const closed = !isMenuOpen(moreBtn);
    if (!closed) console.warn('[FB Collector] Menu still open after all close attempts');
    return closed;
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

    // Make sure no menu from a previous member is still open
    await closeOpenMenus(null);

    // Scroll and click
    moreBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(500);
    moreBtn.click();

    // Wait for the menu to render (up to ~3s)
    for (let t = 0; t < 15; t++) {
      await sleep(200);
      if (findVisibleMenus().length > 0 || moreBtn.getAttribute('aria-expanded') === 'true') break;
    }
    await sleep(400);

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

    // Close the menu we opened (verified, with fallbacks)
    await closeOpenMenus(moreBtn);

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

      await closeOpenMenus(null);

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

  // ========== APPROVE ==========

  const APPROVED_TEXT = /(^|\s)(Approved|Đã phê duyệt|Đã duyệt)(\s|$|\.)/i;

  function memberKey(m) {
    return m.groupProfileUrl || m.realProfileUrl || m.name;
  }

  function userIdFromUrl(u) {
    const match = String(u || '').match(/\/user\/(\d+)/);
    return match ? match[1] : '';
  }

  /**
   * Find the pending request card for a member. Same-name members are told
   * apart by the /user/<id> link in their card.
   */
  function findCardForMember(member) {
    const candidates = findMemberCards().filter(c => c.name === member.name);
    if (candidates.length === 0) return null;
    const wantId = userIdFromUrl(member.groupProfileUrl);
    if (wantId) {
      const exact = candidates.find(c => userIdFromUrl(extractGroupProfileUrl(c.element)) === wantId);
      if (exact) return exact;
      // An id was recorded but no card matches it: don't guess between namesakes
      if (candidates.length > 1) return null;
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function findApproveButton(card, name) {
    return card.querySelector(`[role="button"][aria-label="Approve ${CSS.escape(name)}"]`) ||
      card.querySelector(`[role="button"][aria-label="Phê duyệt ${CSS.escape(name)}"]`);
  }

  /** If Facebook asks to confirm, click the dialog's approve/confirm button. */
  function confirmDialogIfAny() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter(d => d.getBoundingClientRect().height > 0);
    for (const d of dialogs) {
      const btn = Array.from(d.querySelectorAll('[role="button"], button')).find(b => {
        const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
        return /^(Approve|Confirm|Phê duyệt|Xác nhận)$/i.test(label);
      });
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  /** Click Approve for one member and wait until Facebook shows it went through. */
  async function approveOne(member) {
    const found = findCardForMember(member);
    if (!found) return 'not_found';
    const card = found.element;
    const btn = findApproveButton(card, member.name);
    if (!btn) return APPROVED_TEXT.test(card.textContent) ? 'approved' : 'not_found';

    btn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(400);
    btn.click();

    for (let t = 0; t < 25; t++) {
      await sleep(200);
      if (t === 3) confirmDialogIfAny();
      if (!btn.isConnected || !card.isConnected) return 'approved';
      if (btn.getAttribute('aria-disabled') === 'true') return 'approved';
      if (APPROVED_TEXT.test(card.textContent)) return 'approved';
    }
    return 'unconfirmed';
  }

  /** Mark approved members in the current results and in history. */
  function markApproved(keys) {
    if (keys.size === 0) return;
    chrome.storage.local.get(['collectedMembers', 'scrapeHistory'], (r) => {
      const mark = list => (list || []).map(m => keys.has(memberKey(m)) ? { ...m, approved: true } : m);
      const update = { collectedMembers: mark(r.collectedMembers) };
      if (r.scrapeHistory) {
        update.scrapeHistory = r.scrapeHistory.map(s => ({ ...s, members: mark(s.members) }));
      }
      chrome.storage.local.set(update);
    });
  }

  async function approveMembers(members) {
    if (isCollecting) return;
    isCollecting = true;
    shouldStop = false;
    const counts = { approved: 0, not_found: 0, unconfirmed: 0 };
    const approvedKeys = new Set();

    saveState({
      status: 'approving',
      statusMessage: `Approving ${members.length} member(s) in the group...`,
      progressCurrent: 0,
      progressTotal: members.length
    });

    try {
      await closeOpenMenus(null);
      for (let i = 0; i < members.length; i++) {
        if (shouldStop) break;
        const m = members[i];
        saveState({
          status: 'approving',
          statusMessage: `Approving ${m.name} (${i + 1}/${members.length})...`,
          progressCurrent: i + 1
        });
        const result = await approveOne(m);
        counts[result]++;
        if (result === 'approved') approvedKeys.add(memberKey(m));
        console.log(`[FB Collector] Approve ${m.name}: ${result}`);
        // Pause between approvals so Facebook doesn't rate-limit the admin
        await sleep(1200 + Math.random() * 1300);
      }
    } catch (error) {
      console.error('[FB Collector] Approve error:', error);
    } finally {
      markApproved(approvedKeys);
      const parts = [`✅ Approved ${counts.approved}`];
      if (counts.not_found) parts.push(`${counts.not_found} not found on page`);
      if (counts.unconfirmed) parts.push(`${counts.unconfirmed} not confirmed (check the page)`);
      saveState({
        status: shouldStop ? 'stopped' : 'done',
        statusMessage: (shouldStop ? 'Stopped. ' : '') + parts.join(', ') + '.',
        approveResult: { ...counts, at: new Date().toISOString() }
      });
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
    if (request.action === 'approve') {
      if (isCollecting) {
        sendResponse({ started: false, error: 'Busy: a collection or approval is already running' });
        return true;
      }
      approveMembers(request.members || []);
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
