// ==UserScript==
// @name         Reddit Info Scraper
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Scrapes subreddit status, UI integrated into reddit, Pause/Resume, extracts ban dates and reason, generate reports in Markdown format.
// @match        https://old.reddit.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @require      https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @require      https://unpkg.com/htm@3.1.1/dist/htm.js
// @updateURL    https://github.com/DevList1454/redditlist/raw/refs/heads/dev/infoscraper.user.js
// @downloadURL  https://github.com/DevList1454/redditlist/raw/refs/heads/dev/infoscraper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. SETUP & UTILITIES
    // ==========================================
    const html = htm.bind(React.createElement);
    const { useState, useEffect, useRef, useMemo } = React;

    const COLOR = { PRIMARY: "#0079D3", SUCCESS: "#28a745", WARNING: "#ffc107", ERROR: "#cc3600", DISABLED: "#ccc" };
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const style = document.createElement('style');
    style.textContent = `
        .rs-panel { position: fixed; top: 60px; right: 20px; width: 900px; height: 650px; background: white; z-index: 999999; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
        .rs-header { display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid #eee; }
        .rs-header h3 { margin: 0; font-size: 18px; color: #1c1c1c; }
        .rs-close { background: none; border: none; color: #ff4500; font-size: 18px; cursor: pointer; font-weight: bold; }
        .rs-tabs { display: flex; border-bottom: 2px solid #eee; background: #fafafa; }
        .rs-tab { flex: 1; padding: 10px; border: none; background: none; cursor: pointer; color: #666; font-weight: 500; }
        .rs-tab.active { border-bottom: 2px solid ${COLOR.PRIMARY}; color: ${COLOR.PRIMARY}; font-weight: bold; }
        .rs-content { padding: 15px; flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }

        .rs-btn { display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 10px; border: none; border-radius: 4px; color: white; font-weight: bold; cursor: pointer; text-align: center; font-family: inherit; font-size: 13px; margin-bottom: 5px; }
        .rs-btn:disabled { background: ${COLOR.DISABLED} !important; cursor: not-allowed; color: #666 !important; }

        .rs-log { flex-grow: 1; background: #f6f7f8; padding: 10px; border-radius: 4px; border: 1px solid #eee; overflow-y: auto; font-family: monospace; font-size: 12px; margin: 10px 0; }
        .rs-table-container { overflow: auto; flex-grow: 1; border: 1px solid #eee; border-radius: 4px; }
        .rs-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
        .rs-table th { background: #f6f7f8; position: sticky; top: 0; padding: 8px; border-bottom: 1px solid #ddd; z-index: 2; }
        .rs-table td { padding: 8px; border-bottom: 1px solid #eee; }
        .rs-input-group { margin-bottom: 15px; }
        .rs-input-group label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; }
        .rs-input-group input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-family: inherit; }

        .rs-action-row { display: flex; gap: 10px; margin-top: 10px; }
        .rs-action-row .rs-btn { flex: 1; margin-bottom: 0; }
    `;
    document.head.appendChild(style);

    // ==========================================
    // 2. HELPER FUNCTIONS
    // ==========================================
    const processSubredditData = (current, previous, currentRank, prevRank) => {
        let flags = [];
        const prevWasBanned = previous && (previous.isBanned || previous.status === 'banned');
        // A subreddit is new if it has no previous history, OR if it was explicitly flagged as a new addition
        const isNew = !previous || Object.keys(previous).length === 0 || previous._isNewAddition;

        if (current.isRestricted) flags.push('R');
        if (current.isBanned) flags.push('B');
        if (current.isQuarantined) flags.push('Q');
        if (current.isPrivate) flags.push('P');
        if (isNew) flags.push('N');
        else if (prevWasBanned && !current.isBanned) flags.push('U');

        const L = prevRank || '-';
        const diff = L !== '-' ? L - currentRank : '-';
        const subDiff = (current.members || 0) - ((previous && previous.members) || 0);

        return { ...current, prevMembers: previous.members, currentRank, prevRank: L, diff, subDiff, flags: flags.join('') };
    };

    const formatMarkdownRow = (item, listType) => {
        // Remove newlines and | since they break Markdown tables
        const safeDesc = String(item.description || "").replace(/\n/g, ' ').replace(/\|/g, '-').trim();
        // If there's a description and it's a new addition, make it bold
        const formattedDesc = (item._isNewAddition && safeDesc) ? `**${safeDesc}**` : safeDesc;
        // Format as a link to the subreddit
        const subLink = `[r/${item.subreddit}](/r/${item.subreddit})`;

        if (listType === 'banned') {
            return `|${subLink}|${item.flags}|${formattedDesc}|${item.banDate || 'Unknown'}|${item.banReason || 'Unknown'}`;
        }

        if (listType === 'alphabetical') {
            return `|${subLink}|${item.members || 0}|${item.prevMembers || 0}|${item.flags}|${formattedDesc}|`;
        }

        const diffStr = item.diff !== '-' && item.diff > 0 ? `+${item.diff}` : item.diff;
        return `|${item.currentRank}|${item.prevRank}|${diffStr}|${item.members || 0}|${subLink}|${item.flags}|${formattedDesc}|`;
    };

    // ==========================================
    // 3. UI COMPONENTS
    // ==========================================
    function Header({ setIsVisible }) {
        return html`
            <div className="rs-header">
                <h3>Scraper Dashboard</h3>
                <button className="rs-close" onClick=${() => setIsVisible(false)}>✖</button>
            </div>
        `;
    }

    function Tabs({ activeTab, setActiveTab }) {
        return html`
            <div className="rs-tabs">
                <button className=${`rs-tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick=${() => setActiveTab('dashboard')}>Dashboard</button>
                <button className=${`rs-tab ${activeTab === 'quickAdd' ? 'active' : ''}`} onClick=${() => setActiveTab('quickAdd')}>Quick Add</button>
                <button className=${`rs-tab ${activeTab === 'data' ? 'active' : ''}`} onClick=${() => setActiveTab('data')}>Data & Database</button>
                <button className=${`rs-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick=${() => setActiveTab('settings')}>⚙️ Settings</button>
            </div>
        `;
    }

    function DashboardTab({ subCount, status, btnBg, textColor, btnText, handleToggle, logs, generateMarkdown, commitResults, hasResults }) {
        return html`
            <div className="rs-content">
                <button className="rs-btn" style=${{ background: subCount === 0 ? COLOR.DISABLED : btnBg, color: textColor }} disabled=${subCount === 0} onClick=${handleToggle}>
                    ${subCount === 0 ? 'No Data Loaded' : btnText}
                </button>
                <div className="rs-log">
                    ${subCount > 0 && logs.length === 0 ? html`<i>Loaded ${subCount} subreddits from local database. Ready to scrape.</i>` : ''}
                    ${logs.map(log => html`<div key=${log.id} style=${{ color: log.color, marginBottom: '4px' }}>${log.msg}</div>`)}
                </div>

                <div className="rs-action-row">
                    <button className="rs-btn" style=${{ background: hasResults ? COLOR.PRIMARY : COLOR.DISABLED }} disabled=${!hasResults} onClick=${() => generateMarkdown('active')}>
                        📝 League Report
                    </button>
                    <button className="rs-btn" style=${{ background: hasResults ? COLOR.PRIMARY : COLOR.DISABLED }} disabled=${!hasResults} onClick=${() => generateMarkdown('alphabetical')}>
                        📝 Alphabetical Report
                    </button>
                    <button className="rs-btn" style=${{ background: hasResults ? COLOR.PRIMARY : COLOR.DISABLED }} disabled=${!hasResults} onClick=${() => generateMarkdown('banned')}>
                        📝 Banned Report
                    </button>
                    <button className="rs-btn" style=${{ background: status === 'DONE' && hasResults ? COLOR.SUCCESS : COLOR.DISABLED }} disabled=${status !== 'DONE' || !hasResults} onClick=${commitResults}>
                        💾 Save & Commit
                    </button>
                </div>
            </div>
        `;
    }

    function DataTab({ handleCSVUpload, handleDownloadCSV, subCount, processedList }) {
        return html`
            <div className="rs-content">
                <div style=${{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <label className="rs-btn" style=${{ flex: 1, background: COLOR.PRIMARY, cursor: 'pointer' }}>
                        📂 Load CSV Database
                        <input type="file" accept=".csv" style=${{ display: 'none' }} onChange=${handleCSVUpload} />
                    </label>
                    <button className="rs-btn" style=${{ flex: 1, background: COLOR.PRIMARY }} disabled=${subCount === 0} onClick=${handleDownloadCSV}>
                        💾 Save CSV Database
                    </button>
                </div>
            <div className="rs-table-container">
            <table className="rs-table">
                <thead>
                    <tr>
                        <th style=${{textAlign: 'center'}}>P</th>
                        <th style=${{textAlign: 'center'}}>L</th>
                        <th style=${{textAlign: 'center'}}>+/-</th>
                        <th>Subreddit</th>
                        <th>Subs</th>
                        <th style=${{textAlign: 'right'}}>+/- Subs</th>
                        <th style=${{textAlign: 'center'}}>F</th>
                        <th>Ban Reason</th>
                        <th>Description</th>
                    </tr>
                </thead>
                        <tbody>
                            ${processedList.map((row, i) => {
                                let diffColor = row.diff > 0 ? 'green' : (row.diff < 0 ? 'red' : '#999');
                                let subDiffColor = row.subDiff > 0 ? 'green' : (row.subDiff < 0 ? 'red' : '#555');
                                let subDiffText = row.subDiff > 0 ? `+${row.subDiff.toLocaleString()}` : row.subDiff;
                                if (row.subDiff === 0) subDiffText = '0';

                                return html`
                                    <tr key=${i}>
                                        <td style=${{textAlign: 'center', fontWeight: 'bold'}}>${row.currentRank}</td>
                                        <td style=${{textAlign: 'center', color: '#555'}}>${row.prevRank}</td>
                                        <td style=${{textAlign: 'center', color: diffColor, fontWeight: 'bold'}}>${row.diff > 0 ? `+${row.diff}` : row.diff}</td>
                                        <td><a href="https://old.reddit.com/r/${row.subreddit}" target="_blank" style=${{ color: COLOR.PRIMARY, fontWeight: 'bold' }}>r/${row.subreddit}</a></td>
                                        <td>${(row.members || 0).toLocaleString()}</td>
                                        <td style=${{textAlign: 'right', color: subDiffColor, fontWeight: 'bold'}}>${subDiffText}</td>
                                        <td style=${{textAlign: 'center', color: '#d32f2f', fontWeight: 'bold'}}>${row.flags}</td>
                                        <td style=${{ maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title=${row.banReason}>${row.banReason || '-'}</td>
                                        <td style=${{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title=${row.description}>${row.description || '-'}</td>
                                    </tr>
                                `;
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function SettingsTab({ config, setConfig, saveSettings }) {
        return html`
            <div className="rs-content">
                <div className="rs-input-group">
                    <label>Request Delay (ms):</label>
                    <input type="number" value=${config.delay} onChange=${e => setConfig({...config, delay: parseInt(e.target.value)})} />
                </div>
                <div className="rs-input-group">
                    <label>Initial 429 Retry Delay (ms):</label>
                    <input type="number" value=${config.retry} onChange=${e => setConfig({...config, retry: parseInt(e.target.value)})} />
                </div>
                <div className="rs-input-group">
                    <label>Extra 429 Retry Delay (ms):</label>
                    <input type="number" value=${config.addRetry} onChange=${e => setConfig({...config, addRetry: parseInt(e.target.value)})} />
                </div>
                <div style=${{ flexGrow: 1 }}></div>
                <button className="rs-btn" style=${{ background: COLOR.SUCCESS }} onClick=${saveSettings}>
                    💾 Save Settings
                </button>
            </div>
        `;
    }

    function QuickAddTab({ quickAddData, setQuickAddData, handleQuickAdd }) {
        return html`
            <div className="rs-content">
                <div className="rs-input-group">
                    <label>Subreddit Name:</label>
                    <input
                        type="text"
                        value=${quickAddData.subName}
                        onChange=${e => setQuickAddData({...quickAddData, subName: e.target.value})}
                        placeholder="e.g., askreddit (without the r/)"
                    />
                </div>
                <div className="rs-input-group">
                    <label>Description:</label>
                    <input
                        type="text"
                        value=${quickAddData.description}
                        onChange=${e => setQuickAddData({...quickAddData, description: e.target.value})}
                        placeholder="Enter an optional description..."
                    />
                </div>
                <div style=${{ flexGrow: 1 }}></div>
                <button className="rs-btn" style=${{ background: COLOR.PRIMARY }} onClick=${handleQuickAdd}>
                    💾 Add to Database
                </button>
            </div>
        `;
    }

    // ==========================================
    // 4. MAIN APPLICATION COMPONENT
    // ==========================================
    function ScraperApp() {
        const [isVisible, setIsVisible] = useState(false);
        const [activeTab, setActiveTab] = useState('dashboard');
        const [history, setHistory] = useState(() => JSON.parse(GM_getValue('redditScraperHistory', '{}')));
        const [results, setResults] = useState([]);
        const [logs, setLogs] = useState([]);
        const [progress, setProgress] = useState({ current: 0, total: 0 });
        const [waitMessage, setWaitMessage] = useState("");
        const [quickAddData, setQuickAddData] = useState({ subName: "", description: "" });

        // Settings state
        const [config, setConfig] = useState({
            delay: parseInt(GM_getValue('redditDelay', 2400)),
            retry: parseInt(GM_getValue('redditRetryDelay', 60)),
            addRetry: parseInt(GM_getValue('redditAddRetryDelay', 30))
        });
        // useRef to store value not linked to UI renders
        const configRef = useRef(config);
        useEffect(() => {
            configRef.current = config;
        }, [config]);

        // Status state
        const [status, setStatus] = useState('IDLE');
        const statusRef = useRef('IDLE');
        // Keep status and statusRef sync
        const setSyncStatus = (newStatus) => {
            setStatus(newStatus);
            statusRef.current = newStatus;
        };

        useEffect(() => {
            const tabMenu = document.querySelector('#header-bottom-left ul.tabmenu');
            if (tabMenu && !document.getElementById('rs-nav-btn')) {
                const li = document.createElement('li');
                li.id = 'rs-nav-btn';
                li.innerHTML = `<a href="javascript:void(0)" style="color:#FF4500; font-weight:bold;">scraper dashboard</a>`;
                li.addEventListener('click', () => setIsVisible(v => !v));
                tabMenu.appendChild(li);
            }
        }, []);

        const addLog = (msg, color = "#333") => {
            setLogs(prev => [...prev, { msg, color, id: Date.now() + Math.random() }]);
        };

        const fetchBanData = async (subreddit) => {
            let banData = { banDate: "", banReason: ""};
            try {
                // We parse the text to get the ban date
                const htmlResponse = await fetch(`https://old.reddit.com/r/${subreddit}/`);
                const htmlText = await htmlResponse.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');

                const timeEl = doc.querySelector('.note time');
                if (timeEl) {
                    const rawDateStr = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent;
                    if (rawDateStr) {
                        const dateObj = new Date(rawDateStr);
                        if (!isNaN(dateObj.getTime())) {
                            const day = String(dateObj.getDate()).padStart(2, '0');
                            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                            const year = dateObj.getFullYear();
                            banData.banDate = `${year}/${month}/${day}`;
                        } else {
                            banData.banDate = rawDateStr;
                        }
                    }
                }

                const reasonEl = doc.querySelector('.md p')
                if (reasonEl) {
                    if (reasonEl.textContent.includes('unmoderated')) {
                        banData.banReason = "Unmoderated";
                    } else if (reasonEl.textContent.includes('violating')) {
                        banData.banReason = "Violating Reddit rules";
                    } else if (reasonEl.textContent.includes('spam')) {
                        banData.banReason = "Used for spam";
                    } else {
                        banData.banReason = "Unknown";
                    }
                }
            } catch (err) {
                console.error(`Failed to scrape HTML ban date for r/${subreddit}:`, err);
            }

            return banData;
        };

        const fetchSubredditData = async (subreddit) => {
            const response = await fetch(`https://old.reddit.com/r/${subreddit}/about.json`);
            let data = { members: 0, banDate: "", banReason: "", description: "", isBanned: false, isRestricted: false, isPrivate: false, isQuarantined: false, errorText: "" };
            let statusText = "Unknown";

            if (response.ok) {
                const json = await response.json();
                statusText = json?.data?.subreddit_type || "Unknown";
                data.members = json?.data?.subscribers || 0;
                data.description = json?.data?.public_description || "";
            } else {
                try {
                    const errorJson = await response.json();
                    statusText = errorJson?.reason || errorJson?.message || `Error (${response.status})`;
                } catch {
                    statusText = `HTTP Error (${response.status})`;
                }

                if (statusText.toLowerCase() === 'banned' || response.status === 404 || response.status === 403) {
                    const scrapedBanData = await fetchBanData(subreddit);
                    if (scrapedBanData.banDate) {
                        data.banDate = scrapedBanData.banDate;
                        statusText = "banned";
                        if (scrapedBanData.banReason) data.banReason = scrapedBanData.banReason;
                    } else if (response.status === 404) {
                        data.errorText = "Not Found / Deleted";
                    }
                }
            }

            const lowerStatus = statusText.toLowerCase();
            if (lowerStatus === 'banned') data.isBanned = true;
            if (lowerStatus === 'restricted') data.isRestricted = true;
            if (lowerStatus === 'private') data.isPrivate = true;
            if (lowerStatus === 'quarantined') data.isQuarantined = true;

            if (!response.ok && !data.isBanned && !data.isPrivate && !data.isQuarantined && !data.errorText) {
                data.errorText = statusText;
            }

            return { statusCode: response.status, ...data };
        };

        const runScraper = async () => {
            const subs = Object.keys(history);
            if (subs.length === 0) return;

            setSyncStatus('RUNNING');

            setWaitMessage("");
            setResults([]);
            setLogs([]);
            let currentResults = [];

            for (let i = 0; i < subs.length; i++) {
                const sub = subs[i];
                setProgress({ current: i + 1, total: subs.length });

                let retry = true;
                let attempt = 0;

                while (retry) {
                    while (statusRef.current === 'PAUSED') { await sleep(250); }
                    if (statusRef.current === 'IDLE' || statusRef.current === 'DONE') return;

                    attempt++;
                    addLog(`Fetching r/${sub}...`);

                    try {
                        const data = await fetchSubredditData(sub);

                        if (data.statusCode === 429) {
                            let delay = configRef.current.retry + (configRef.current.addRetry * (attempt - 1));
                            addLog(`429 Rate Limited. Waiting ${delay}s...`, "orange");
                            // Pause logic, we count down the delay in 1000ms chunks so we can update the button every second
                            while (delay > 0 && statusRef.current !== 'IDLE') {
                                setWaitMessage(`⏳ Rate Limited: Waiting ${delay}s...`);
                                await sleep(1000);
                                delay--;
                            }
                            setWaitMessage("");
                            continue;
                        }

                        let flagLogs = [];
                        if (data.isBanned) flagLogs.push(`Banned`);
                        if (data.isRestricted) flagLogs.push('Restricted');
                        if (data.isQuarantined) flagLogs.push('Quarantined');
                        if (data.isPrivate) flagLogs.push('Private');

                        let c = data.isBanned ? "red" : (flagLogs.length > 0 ? "orange" : "green");
                        let t = flagLogs.length > 0 ? `${flagLogs.join(', ')} (${data.members})` : `Public (${data.members})`;
                        if (data.errorText) { t = data.errorText; c = "red"; }

                        addLog(`→ ${t}`, c);

                        const newResult = { subreddit: sub, ...data, description: history[sub]?.description || data.description };
                        currentResults.push(newResult);
                        setResults([...currentResults]);
                        retry = false;

                    } catch (err) {
                        let delay = 5 * attempt;
                        addLog(`Network Error. Waiting ${delay}s...`, "red");
                        while (delay > 0 && statusRef.current !== 'IDLE') {
                            setWaitMessage(`⏳ Network Error: Waiting ${delay}s...`);
                            await sleep(1000);
                            delay--;
                        }
                        setWaitMessage("");
                        if (attempt >= 5) {
                            currentResults.push({ subreddit: sub, errorText: "Max Retries Hit" });
                            retry = false;
                        }
                    }
                }

                let normalDelay = configRef.current.delay + Math.floor(Math.random() * 200);
                while (statusRef.current === 'PAUSED') { await sleep(250); }
                if (statusRef.current !== 'IDLE') { await sleep(normalDelay); }
            }

            if (statusRef.current !== 'IDLE') {
                setSyncStatus('DONE');
                setWaitMessage("");
                addLog("✓ Scrape Complete! Reports ready to generate. Don't forget to commit your results to the database AFTER running reports.", "green");
            }
        };

        const handleQuickAdd = () => {
            const cleanName = quickAddData.subName.trim().replace(/^r\//i, '');

            if (!cleanName) {
                alert("Please enter a subreddit name.");
                return;
            }

            if (history[cleanName] && !confirm(`r/${cleanName} already exists. Overwrite its description and flag as new?`)) {
                return;
            }

            const newHistory = {
                ...history,
                [cleanName]: {
                    ...(history[cleanName] || {}),
                    subreddit: cleanName,
                    description: quickAddData.description.trim(),
                    _isNewAddition: true
                }
            };

            setHistory(newHistory);
            GM_setValue('redditScraperHistory', JSON.stringify(newHistory));

            // Clear inputs and confirm
            setQuickAddData({ subName: "", description: "" });
            addLog(`✓ r/${cleanName} successfully added to the database!`, "green");
        };

        const handleToggle = () => {
            if (status === 'IDLE' || status === 'DONE') {
                setSyncStatus('RUNNING');
                runScraper();
            } else if (status === 'RUNNING') {
                setSyncStatus('PAUSED');
            } else if (status === 'PAUSED') {
                setSyncStatus('RUNNING');
            }
        };

        const commitResults = () => {
            if (results.length === 0) return;
            const newHistory = { ...history };

            results.forEach(r => {
                const { _isNewAddition, ...cleanR } = r; // Strips out the new addition flag
                newHistory[r.subreddit] = cleanR;
            });

            setHistory(newHistory);
            GM_setValue('redditScraperHistory', JSON.stringify(newHistory));
            setResults([]);

            setSyncStatus('IDLE');

            addLog("✓ Data successfully saved and committed to local database.", "green");
        };

        // --- Streamlined Data Computation ---
        const { processedList } = useMemo(() => {
            const combinedDataMap = { ...history };
            results.forEach(r => { combinedDataMap[r.subreddit] = r });
            const dataToProcess = Object.values(combinedDataMap);

            const prevArray = Object.entries(history).map(([sub, d]) => ({
                subreddit: sub, members: d.members || 0
            })).sort((a, b) => b.members - a.members || a.subreddit.localeCompare(b.subreddit));

            const prevRankMap = Object.fromEntries(
                prevArray.map((item, index) => [item.subreddit, index + 1])
            );

            const sortedData = [...dataToProcess].sort((a, b) => (b.members || 0) - (a.members || 0) || String(a.subreddit).localeCompare(String(b.subreddit)));

            const currentRankMap = Object.fromEntries(
                sortedData.map((item, index) => [item.subreddit, index + 1])
            );

            const processed = sortedData.map(item => processSubredditData(item, history[item.subreddit] || {}, currentRankMap[item.subreddit], prevRankMap[item.subreddit]));

            return { processedList: processed };
        }, [results, history]);

        // --- Streamlined Post Generator ---
        const generateMarkdown = (type) => {
            if (processedList.length === 0) return;

            const activeSubs = processedList.filter(d => !d.isBanned);
            const bannedSubs = processedList.filter(d => d.isBanned);
            const alphaSubs = [...activeSubs].sort((a, b) => String(a.subreddit).toLowerCase().localeCompare(String(b.subreddit).toLowerCase()));
            const activeNewSubs = activeSubs.filter(d => d.flags.includes('N'));
            const alphaNewSubs = alphaSubs.filter(d => d.flags.includes('N'));

            let postContent = "";

            if (type === 'active') {
                postContent = `These lists are ranked by subscriber count. Subs marked as restricted may be restricted by the moderators, so try contacting them to ask about that sub.\n
### Notes
* **P:** Current position/rank.
* **L:** Last week's position/rank.
* **+ / -:** Rank climbed or fallen since last week.
* **Subs:** Number of subscribers at the time this list was compiled.
* **Subname:** Name of the subreddit, clickable.
* **F:** Flags indicating the status of the sub. These are **R** (Restricted), **B** (Banned), **Q** (Quarantined), **P** (Private), **N** (New to this list), **U** (Unbanned).
* **Description:** A description of the sub or my interpretation of it. Please contact me if it's your sub and you want to change this.
* **Ban Date:** The date the subreddit was banned (if applicable).\n
### League Table List
| P | L | +- | Subs | Subname | F | Description |
|---|---|---|---|---|---|---|
${activeSubs.map(item => formatMarkdownRow(item, 'active')).join('\n')}`.trim();

                if (activeNewSubs.length > 0) {
                    postContent += `\n### These subs are new to this list
| P | L | +- | Subs | Subname | F | Description |
|---|---|---|---|---|---|---|
${activeNewSubs.map(item => formatMarkdownRow(item, 'active')).join('\n')}`;
                }
            }
            else if (type === 'alphabetical') {
                postContent = `
### Alphabetical List
| Subname | Subs | Prev | F | Description |
|---|---|---|---|---|
${alphaSubs.map(item => formatMarkdownRow(item, 'alphabetical')).join('\n')}`.trim();

                if (alphaNewSubs.length > 0) {
                    postContent += `\n### These subs are new to this list
| Subname | Subs | Prev | F | Description |
|---|---|---|---|---|
${alphaNewSubs.map(item => formatMarkdownRow(item, 'alphabetical')).join('\n')}`;
                }
            }
            else if (type === 'banned') {
                postContent = `### Banned Subs
| Subname | F | Description | Ban Date | Reason for Ban
|---|---|---|---|---|
${bannedSubs.map(item => formatMarkdownRow(item, 'banned')).join('\n')}`.trim();
            }

            GM_setClipboard(postContent, "text");

            let alertText = "";
            if ( type === 'alphabetical' ) {
                alertText = 'Alphabetical';
            } else if ( type === 'banned' ) {
                alertText = 'Banned';
            } else {
                alertText = 'League';
            }
            addLog(`✓ ${alertText} Markdown copied to clipboard!`, COLOR.PRIMARY);
        };

        const handleCSVUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const parseResult = Papa.parse(evt.target.result, { header: true, skipEmptyLines: true });
                // Fetch the existing database before we overwrite it
                const existingHistory = JSON.parse(GM_getValue('redditScraperHistory', '{}'));
                // Do we want to flag new entries
                const flagNew = confirm("Flag new entries?");

                let newHistory = {};
                parseResult.data.forEach(row => {
                    const subname = (row.Subreddit || row[Object.keys(row)[0]] || "").trim().replace(/^r\//i, '');
                    if (subname) {
                        // Tag it as new if it wasn't in the database previously (and this isn't a fresh install)
                        const isNewAddition = !existingHistory[subname] && flagNew;

                        newHistory[subname] = {
                            subreddit: subname,
                            members: row.Members !== '' ? parseInt(row.Members) : undefined,
                            isBanned: String(row.Banned).toUpperCase() === "TRUE",
                            isRestricted: String(row.Restricted).toUpperCase() === "TRUE",
                            isQuarantined: String(row.Quarantined).toUpperCase() === "TRUE",
                            isPrivate: String(row.Private).toUpperCase() === "TRUE",
                            banDate: row["Ban Date"] || "",
                            banReason: row.banReason || "",
                            description: row.Description || "",
                            errorText: row.Error || "",
                            _isNewAddition: isNewAddition
                        };
                    }
                });
                setSyncStatus('IDLE');
                setHistory(newHistory);
                setResults([]);
                setLogs([]);
                GM_setValue('redditScraperHistory', JSON.stringify(newHistory));
                //setActiveTab('dashboard');
            };
            reader.readAsText(file);
        };

        const handleDownloadCSV = () => {
            const exportData = processedList.map(r => ({
                "Subreddit": r.subreddit, "Members": r.members || "",
                "Banned": r.isBanned ? "TRUE" : "FALSE",
                "Restricted": r.isRestricted ? "TRUE" : "FALSE",
                "Quarantined": r.isQuarantined ? "TRUE" : "FALSE",
                "Private": r.isPrivate ? "TRUE" : "FALSE",
                "Ban Date": r.banDate || "",
                "Ban Reason": r.banReason || "",
                "Description": r.description || "",
                "Error": r.errorText || ""
            }));
            const blob = new Blob([Papa.unparse(exportData)], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url; link.download = `reddit_database_${Date.now()}.csv`;
            link.click(); URL.revokeObjectURL(url);
        };

        const saveSettings = () => {
            GM_setValue('redditDelay', config.delay);
            GM_setValue('redditRetryDelay', config.retry);
            GM_setValue('redditAddRetryDelay', config.addRetry);
            alert("Settings saved successfully.");
        };

        const calculateETA = (remainingItems) => {
            const estimatedSeconds = remainingItems * ((config.delay + 100) / 1000);
            return estimatedSeconds > 60
                ? `${Math.floor(estimatedSeconds / 60)}m ${Math.round(estimatedSeconds % 60)}s`
            : `${Math.round(estimatedSeconds)}s`;
        };

        if (!isVisible) return null;

        const subCount = Object.keys(history).length;

        let btnText = "▶ Start Scraper";
        let btnBg = COLOR.PRIMARY;
        let textColor = "white";

        if (waitMessage) {
            btnText = waitMessage;
            btnBg = COLOR.WARNING;
            textColor = "black";
        } else if (status === 'RUNNING') {
            btnText = `⏸ Pause Scraper (${progress.current}/${progress.total}) (~${calculateETA(progress.total - progress.current)})`;
            btnBg = COLOR.SUCCESS;
        } else if (status === 'PAUSED') {
            btnText = `▶ Resume Scraper`;
            btnBg = COLOR.WARNING;
            textColor = "black";
        } else if (status === 'DONE') {
            btnText = `↺ Run Again`;
            btnBg = COLOR.PRIMARY;
        }

        return html`
            <div className="rs-panel">
                <${Header} setIsVisible=${setIsVisible} />
                <${Tabs} activeTab=${activeTab} setActiveTab=${setActiveTab} />

                ${activeTab === 'dashboard' && html`
                    <${DashboardTab}
                        subCount=${subCount} status=${status} btnBg=${btnBg}
                        textColor=${textColor} btnText=${btnText}
                        handleToggle=${handleToggle} logs=${logs}
                        generateMarkdown=${generateMarkdown}
                        commitResults=${commitResults}
                        hasResults=${results.length > 0}
                    />
                `}

                ${activeTab === 'quickAdd' && html`
                    <${QuickAddTab}
                        quickAddData=${quickAddData}
                        setQuickAddData=${setQuickAddData}
                        handleQuickAdd=${handleQuickAdd}
                    />
                `}

                ${activeTab === 'data' && html`
                    <${DataTab}
                        handleCSVUpload=${handleCSVUpload} handleDownloadCSV=${handleDownloadCSV}
                        subCount=${subCount} processedList=${processedList}
                    />
                `}

                ${activeTab === 'settings' && html`
                    <${SettingsTab} config=${config} setConfig=${setConfig} saveSettings=${saveSettings} />
                `}
            </div>
        `;
    }

    // ==========================================
    // 5. RENDER ROOT
    // ==========================================
    const mountNode = document.createElement('div');
    mountNode.id = 'react-scraper-root';
    document.body.appendChild(mountNode);

    const root = ReactDOM.createRoot(mountNode);
    root.render(html`<${ScraperApp} />`);

})();
