/**
 * FB Group Member Request Collector - Popup Script
 * Reads all state from chrome.storage.local, polls for live updates,
 * and provides scrape history with export functionality.
 */

(() => {
    // DOM elements - Collect tab
    const collectBtn = document.getElementById('collectBtn');
    const stopBtn = document.getElementById('stopBtn');
    const autoScrollToggle = document.getElementById('autoScrollToggle');
    const statusArea = document.getElementById('statusArea');
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');
    const progressLabel = document.getElementById('progressLabel');
    const resultsArea = document.getElementById('resultsArea');
    const resultsBody = document.getElementById('resultsBody');
    const resultCount = document.getElementById('resultCount');
    const copyBtn = document.getElementById('copyBtn');
    const csvBtn = document.getElementById('csvBtn');
    const excelBtn = document.getElementById('excelBtn');
    const clearBtn = document.getElementById('clearBtn');
    const toast = document.getElementById('toast');

    // DOM elements - History tab
    const historyList = document.getElementById('historyList');
    const historyDetail = document.getElementById('historyDetail');
    const historyBackBtn = document.getElementById('historyBackBtn');
    const historyDetailTitle = document.getElementById('historyDetailTitle');
    const historyResultsBody = document.getElementById('historyResultsBody');
    const historyCopyBtn = document.getElementById('historyCopyBtn');
    const historyCsvBtn = document.getElementById('historyCsvBtn');
    const historyExcelBtn = document.getElementById('historyExcelBtn');

    // DOM elements - Tabs
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    let collectedMembers = [];
    let historyViewMembers = []; // Members being viewed in history detail
    let pollInterval = null;

    // ========== TABS ==========

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(target + 'Tab').classList.add('active');

            if (target === 'history') {
                loadHistory();
            }
        });
    });

    // ========== STATE MANAGEMENT ==========

    function refreshFromStorage() {
        chrome.storage.local.get(
            ['status', 'statusMessage', 'collectedMembers', 'progressCurrent', 'progressTotal', 'lastUpdated'],
            (result) => {
                if (result.statusMessage) {
                    updateStatus(result.statusMessage);
                }

                if (result.progressTotal && result.progressTotal > 0) {
                    updateProgress(result.progressCurrent || 0, result.progressTotal);
                }

                if (result.collectedMembers && result.collectedMembers.length > 0) {
                    collectedMembers = result.collectedMembers;
                    renderResults(collectedMembers, resultsBody, resultCount);
                    resultsArea.classList.remove('hidden');
                }

                const isRunning = result.status === 'running' || result.status === 'scrolling' || result.status === 'collecting';
                collectBtn.disabled = isRunning;
                stopBtn.disabled = !isRunning;

                if (!isRunning && pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }

                if (isRunning && !pollInterval) {
                    startPolling();
                }
            }
        );
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(refreshFromStorage, 1000);
    }

    // Load state on popup open
    refreshFromStorage();

    // ========== UI HELPERS ==========

    function showToast(message) {
        toast.textContent = message;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, 2000);
    }

    function updateStatus(message) {
        statusArea.classList.remove('hidden');
        statusText.textContent = message;
    }

    function updateProgress(current, total) {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        progressBar.style.width = pct + '%';
        progressLabel.textContent = `${current} / ${total}`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Render members into a table body
     */
    function renderResults(members, tbody, countEl) {
        tbody.innerHTML = '';
        if (countEl) countEl.textContent = members.length;

        members.forEach((member, idx) => {
            const tr = document.createElement('tr');

            const tdIdx = document.createElement('td');
            tdIdx.textContent = idx + 1;
            tr.appendChild(tdIdx);

            const tdName = document.createElement('td');
            tdName.textContent = member.name;
            tdName.style.fontWeight = '600';
            tr.appendChild(tdName);

            const tdUrl = document.createElement('td');
            if (member.realProfileUrl) {
                const a = document.createElement('a');
                a.href = member.realProfileUrl;
                a.target = '_blank';
                a.textContent = member.realProfileUrl.replace('https://www.facebook.com/', 'fb.com/');
                tdUrl.appendChild(a);
            } else {
                tdUrl.textContent = '—';
                tdUrl.style.color = '#666';
            }
            tr.appendChild(tdUrl);

            const tdQA = document.createElement('td');
            if (member.qa && member.qa.length > 0) {
                member.qa.forEach(qa => {
                    const div = document.createElement('div');
                    div.className = 'qa-item';
                    div.innerHTML = `<div class="qa-question">${escapeHtml(qa.question)}</div>
                           <div class="qa-answer">${escapeHtml(qa.answer)}</div>`;
                    tdQA.appendChild(div);
                });
            } else {
                tdQA.textContent = '—';
                tdQA.style.color = '#666';
            }
            tr.appendChild(tdQA);

            tbody.appendChild(tr);
        });
    }

    // ========== ACTIONS ==========

    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }

    async function sendToContent(tab, message) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, message, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    collectBtn.addEventListener('click', async () => {
        const tab = await getActiveTab();

        if (!tab || !tab.url || !tab.url.includes('facebook.com/groups')) {
            showToast('⚠️ Navigate to a Facebook group requests page first!');
            return;
        }

        try {
            await sendToContent(tab, { action: 'ping' });
        } catch (e) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                await new Promise(r => setTimeout(r, 500));
            } catch (injErr) {
                showToast('⚠️ Could not inject script. Refresh the page.');
                return;
            }
        }

        collectBtn.disabled = true;
        stopBtn.disabled = false;
        statusArea.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressLabel.textContent = '';
        updateStatus('Starting collection...');

        try {
            await sendToContent(tab, {
                action: 'collect',
                options: { autoScroll: autoScrollToggle.checked }
            });
        } catch (err) {
            updateStatus(`❌ Error: ${err.message}`);
            collectBtn.disabled = false;
            stopBtn.disabled = true;
            return;
        }

        startPolling();
    });

    stopBtn.addEventListener('click', async () => {
        const tab = await getActiveTab();
        try {
            await sendToContent(tab, { action: 'stop' });
        } catch (e) { /* ignore */ }
        stopBtn.disabled = true;
        updateStatus('Stopping...');
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            collectedMembers = [];
            chrome.storage.local.remove([
                'status', 'statusMessage', 'collectedMembers',
                'progressCurrent', 'progressTotal', 'lastUpdated'
            ]);
            resultsArea.classList.add('hidden');
            statusArea.classList.add('hidden');
            progressBar.style.width = '0%';
            progressLabel.textContent = '';
            showToast('🗑️ Data cleared!');
        });
    }

    // ========== HISTORY ==========

    function loadHistory() {
        chrome.storage.local.get(['scrapeHistory'], (result) => {
            const history = result.scrapeHistory || [];
            historyDetail.classList.add('hidden');
            historyList.classList.remove('hidden');

            if (history.length === 0) {
                historyList.innerHTML = '<p class="empty-history">No scrape history yet. Run a collection first.</p>';
                return;
            }

            historyList.innerHTML = '';

            history.forEach((session, idx) => {
                const item = document.createElement('div');
                item.className = 'history-item';

                const date = new Date(session.date);
                const dateStr = date.toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                });
                const timeStr = date.toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit'
                });

                item.innerHTML = `
                    <div class="history-item-info">
                        <div class="history-item-date">${dateStr} at ${timeStr}</div>
                        <div class="history-item-meta">${session.memberCount} member(s)</div>
                    </div>
                    <span class="history-item-count">${session.memberCount}</span>
                    <div class="history-item-actions">
                        <button class="history-delete-btn" data-idx="${idx}" title="Delete">✕</button>
                    </div>
                `;

                // Click to view details (but not on delete button)
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('history-delete-btn')) return;
                    showHistoryDetail(session, dateStr, timeStr);
                });

                historyList.appendChild(item);
            });

            // Delete buttons
            historyList.querySelectorAll('.history-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    deleteHistoryItem(idx);
                });
            });
        });
    }

    function deleteHistoryItem(idx) {
        chrome.storage.local.get(['scrapeHistory'], (result) => {
            const history = result.scrapeHistory || [];
            history.splice(idx, 1);
            chrome.storage.local.set({ scrapeHistory: history }, () => {
                loadHistory();
                showToast('🗑️ Session deleted');
            });
        });
    }

    function showHistoryDetail(session, dateStr, timeStr) {
        historyList.classList.add('hidden');
        historyDetail.classList.remove('hidden');
        historyDetailTitle.textContent = `${dateStr} at ${timeStr} — ${session.memberCount} members`;
        historyViewMembers = session.members || [];
        renderResults(historyViewMembers, historyResultsBody, null);
    }

    historyBackBtn.addEventListener('click', () => {
        historyDetail.classList.add('hidden');
        historyList.classList.remove('hidden');
    });

    // ========== EXPORT FUNCTIONS ==========

    function buildExportData(members) {
        const rows = [];
        const headers = ['#', 'Name', 'Facebook Profile URL'];

        let maxQA = 0;
        members.forEach(m => {
            if (m.qa && m.qa.length > maxQA) maxQA = m.qa.length;
        });

        for (let i = 0; i < maxQA; i++) {
            headers.push(`Question ${i + 1}`);
            headers.push(`Answer ${i + 1}`);
        }
        rows.push(headers);

        members.forEach((member, idx) => {
            const row = [idx + 1, member.name, member.realProfileUrl || ''];
            for (let i = 0; i < maxQA; i++) {
                if (member.qa && member.qa[i]) {
                    row.push(member.qa[i].question);
                    row.push(member.qa[i].answer);
                } else {
                    row.push('');
                    row.push('');
                }
            }
            rows.push(row);
        });

        return rows;
    }

    function copyToClipboard(members) {
        if (members.length === 0) { showToast('No data to copy!'); return; }
        const data = buildExportData(members);
        const tsv = data.map(row => row.join('\t')).join('\n');
        navigator.clipboard.writeText(tsv).then(() => {
            showToast('✅ Copied to clipboard!');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = tsv;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('✅ Copied to clipboard!');
        });
    }

    function exportCSV(members) {
        if (members.length === 0) { showToast('No data to export!'); return; }
        const data = buildExportData(members);
        const csvContent = data.map(row =>
            row.map(cell => {
                const str = String(cell);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            }).join(',')
        ).join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, `fb_member_requests_${getTimestamp()}.csv`);
        showToast('✅ CSV downloaded!');
    }

    function exportExcel(members) {
        if (members.length === 0) { showToast('No data to export!'); return; }
        const data = buildExportData(members);

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<?mso-application progid="Excel.Sheet"?>\n';
        xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
        xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
        xml += '  <Styles>\n';
        xml += '    <Style ss:ID="header">\n';
        xml += '      <Interior ss:Color="#4472C4" ss:Pattern="Solid"/>\n';
        xml += '      <Font ss:Color="#FFFFFF" ss:Bold="1" ss:Size="11"/>\n';
        xml += '    </Style>\n';
        xml += '  </Styles>\n';
        xml += '  <Worksheet ss:Name="Member Requests">\n';
        xml += '    <Table>\n';

        data.forEach((row, rowIdx) => {
            xml += '      <Row>\n';
            row.forEach(cell => {
                const val = escapeXml(String(cell));
                const style = rowIdx === 0 ? ' ss:StyleID="header"' : '';
                const type = typeof cell === 'number' ? 'Number' : 'String';
                xml += `        <Cell${style}><Data ss:Type="${type}">${val}</Data></Cell>\n`;
            });
            xml += '      </Row>\n';
        });

        xml += '    </Table>\n';
        xml += '  </Worksheet>\n';
        xml += '</Workbook>';

        const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
        downloadBlob(blob, `fb_member_requests_${getTimestamp()}.xls`);
        showToast('✅ Excel downloaded!');
    }

    // Current session export buttons
    copyBtn.addEventListener('click', () => copyToClipboard(collectedMembers));
    csvBtn.addEventListener('click', () => exportCSV(collectedMembers));
    excelBtn.addEventListener('click', () => exportExcel(collectedMembers));

    // History detail export buttons
    historyCopyBtn.addEventListener('click', () => copyToClipboard(historyViewMembers));
    historyCsvBtn.addEventListener('click', () => exportCSV(historyViewMembers));
    historyExcelBtn.addEventListener('click', () => exportExcel(historyViewMembers));

    function escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function getTimestamp() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    }
})();
