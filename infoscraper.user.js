// ==UserScript==
// @name         Subreddit Info Scraper v2
// @namespace    http://tampermonkey.net/
// @version      2.1.5
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

    // htm lets us write JSX-like syntax in plain JS template literals, bound to React.createElement
    const html = htm.bind(React.createElement);
    const { useState, useEffect, useRef, useMemo } = React;

    // For keyword matching when fetching ban data
    const BAN_REASONS = [
        { keyword: 'unmoderated', reason: 'Unmoderated' },
        { keyword: 'violating', reason: 'Violating Reddit rules' },
        { keyword: 'spam', reason: 'Used for spam' },
    ];

    // Reports UI labels
    const REPORTS = [
        { type: 'active', label: '📝 League Report' },
        { type: 'alphabetical', label: '📝 Alphabetical Report' },
        { type: 'banned', label: '📝 Banned Report' },
    ];

    // Labels for making reports
    const REPORT_LABELS = {
        active:       'League',
        alphabetical: 'Alphabetical',
        banned:       'Banned'
    };

    // Simple promise-based delay helper, used for rate-limit backoff and network retry waits
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    // Return true if string "TRUE"
    const parseBool = (val) => String(val).toUpperCase() === "TRUE";


    // ==========================================
    // 2. STYLES
    // ==========================================

    const style = document.createElement('style');
    style.textContent = `
        .rs-panel {
            /* Light theme defaults */
            --rs-bg:               #ffffff;
            --rs-surface:          #f8fafc;
            --rs-surface-alt:      #f1f5f9;
            --rs-border:           #e2e8f0;
            --rs-border-strong:    #cbd5e1;
            --rs-border-table:     #e2e8f0;
            --rs-text:             #1e293b;
            --rs-text-muted:       #64748b;
            --rs-text-secondary:   #475569;
            --rs-text-heading:     #0f172a;
            --rs-input-bg:         #ffffff;
            --rs-input-border:     #cbd5e1;
            --rs-link:             #3b82f6;
            --rs-shadow:           rgba(15, 23, 42, 0.12);

            /* Action colours — same across both themes */
            --rs-primary:          #3b82f6;
            --rs-success:          #10b981;
            --rs-warning:          #f59e0b;
            --rs-error:            #ef4444;
            --rs-disabled:         #e2e8f0;
            --rs-disabled-text:    #94a3b8;

            /* Semantic colours for log entries and diff columns */
            --rs-color-positive:   #16a34a;
            --rs-color-negative:   #dc2626;
            --rs-color-caution:    #d97706;
            --rs-color-flags:      #dc2626;
        }

        .rs-panel.rs-dark {
            /* Dark theme overrides */
            --rs-bg:               #0f172a;
            --rs-surface:          #1e293b;
            --rs-surface-alt:      #162032;
            --rs-border:           #334155;
            --rs-border-strong:    #475569;
            --rs-border-table:     #334155;
            --rs-text:             #e2e8f0;
            --rs-text-muted:       #94a3b8;
            --rs-text-secondary:   #94a3b8;
            --rs-text-heading:     #f8fafc;
            --rs-input-bg:         #1e293b;
            --rs-input-border:     #475569;
            --rs-link:             #60a5fa;
            --rs-shadow:           rgba(0, 0, 0, 0.4);
            --rs-disabled:         #334155;
            --rs-disabled-text:    #64748b;

            /* Brighter variants that read clearly on dark backgrounds */
            --rs-color-positive:   #4ade80;
            --rs-color-negative:   #f87171;
            --rs-color-caution:    #fbbf24;
            --rs-color-flags:      #f87171;
        }

        /* Outer panel — fixed so it floats above the Reddit page */
        .rs-panel {
            position: fixed;
            top: 60px;
            right: 20px;
            width: 900px;
            height: 650px;
            background: var(--rs-bg);
            color: var(--rs-text);
            z-index: 999999;
            border: 1px solid var(--rs-border-strong);
            border-radius: 8px;
            box-shadow: 0 4px 16px var(--rs-shadow);
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        /* Title bar */
        .rs-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid var(--rs-border);
        }
        .rs-header h3 { margin: 0; font-size: 18px; color: var(--rs-text-heading); }
        .rs-close { background: none; border: none; color: #ff4500; font-size: 18px; cursor: pointer; font-weight: bold; }

        /* Tab bar */
        .rs-tabs { display: flex; border-bottom: 2px solid var(--rs-border); background: var(--rs-surface-alt); }
        .rs-tab { flex: 1; padding: 10px; border: none; background: none; cursor: pointer; color: var(--rs-text-muted); font-weight: 500; }
        .rs-tab.active { border-bottom: 2px solid var(--rs-primary); color: var(--rs-primary); font-weight: bold; }

        /* Main content area — each tab fills this space */
        .rs-content { padding: 15px; flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }

        /* Generic action button used throughout the panel */
        .rs-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            padding: 10px;
            border: none;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            cursor: pointer;
            text-align: center;
            font-family: inherit;
            font-size: 13px;
            margin-bottom: 5px;
        }
        .rs-btn:disabled {
            background: var(--rs-disabled) !important;
            cursor: not-allowed;
            color: var(--rs-disabled-text) !important;
        }

        /* Scrollable log output on the Dashboard tab */
        .rs-log {
            flex-grow: 1;
            background: var(--rs-surface);
            padding: 10px;
            border-radius: 4px;
            border: 1px solid var(--rs-border);
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
            margin: 10px 0;
        }

        /* Scrollable data table on the Data tab */
        .rs-table-container { overflow: auto; flex-grow: 1; border: 1px solid var(--rs-border); border-radius: 4px; }
        .rs-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
        .rs-table th { background: var(--rs-surface); color: var(--rs-text); position: sticky; top: 0; padding: 8px; border-bottom: 1px solid var(--rs-border-table); z-index: 2; }
        .rs-table td { padding: 8px; border-bottom: 1px solid var(--rs-border); }

        /* Labelled input fields used in Quick Add and Settings */
        .rs-input-group { margin-bottom: 15px; }
        .rs-input-group label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: var(--rs-text); }
        .rs-input-group input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--rs-input-border);
            border-radius: 4px;
            box-sizing: border-box;
            font-family: inherit;
            background: var(--rs-input-bg);
            color: var(--rs-text);
        }

        /* Row of equally-spaced action buttons pinned to the bottom of a tab */
        .rs-action-row { display: flex; gap: 10px; margin-top: 10px; }
        .rs-action-row .rs-btn { flex: 1; margin-bottom: 0; }

        /* Theme toggle button pair in Settings */
        .rs-theme-toggle { display: flex; gap: 10px; }
        .rs-theme-toggle .rs-btn { flex: 1; margin-bottom: 0; }
    `;
    document.head.appendChild(style);


    // ==========================================
    // 3. HELPER FUNCTIONS
    // ==========================================

    /**
     * Merges raw scraped data with the previous snapshot to produce a single
     * enriched record ready for display and Markdown output.
     *
     * Computes:
     *   - Status flags  (R / B / Q / P / N / U)
     *   - Rank change   vs. the previous scrape
     *   - Subscriber delta vs. the previous scrape
     *
     * @param {object} current     - Data freshly scraped for this subreddit.
     * @param {object} previous    - Last committed snapshot (may be an empty object).
     * @param {number} currentRank - Position in this scrape's sorted list.
     * @param {number} prevRank    - Position in the previous snapshot's sorted list.
     * @returns {object} Enriched record.
     */
    const processSubredditData = (current, previous, currentRank, prevRank) => {
        const flags = [];

        // A sub is "previously banned" only if its stored boolean says so
        const prevWasBanned = previous && previous.isBanned;

        // A sub is "new" if it has no history at all, or was explicitly marked as a new addition
        const isNew = !previous || Object.keys(previous).length === 0 || previous._isNewAddition;

        // Build the flag string in a consistent display order
        if (current.isRestricted) flags.push('R');
        if (current.isBanned) flags.push('B');
        if (current.isQuarantined) flags.push('Q');
        if (current.isPrivate) flags.push('P');
        if (isNew) flags.push('N');
        else if (prevWasBanned && !current.isBanned) flags.push('U'); // Unbanned since last scrape

        // Rank diff: positive = climbed, negative = fell, '-' = no prior data to compare
        const L = prevRank || '-';
        const diff = L !== '-' ? L - currentRank : '-';

        // Subscriber count change vs. last committed snapshot
        const subDiff = (current.members || 0) - ((previous && previous.members) || 0);

        return {
            ...current,
            prevMembers: previous.members,
            currentRank,
            prevRank: L,
            diff,
            subDiff,
            flags: flags.join('')
        };
    };

    /**
     * Formats a single subreddit record as a pipe-delimited Markdown table row.
     * The columns rendered depend on which report type is being generated.
     *
     * @param {object} item     - Enriched record from processSubredditData.
     * @param {string} listType - 'active' | 'alphabetical' | 'banned'
     * @returns {string} A single Markdown table row.
     */
    const formatMarkdownRow = (item, listType) => {
        // Strip characters that would break a Markdown table cell
        const safeDesc = String(item.description || "")
            .replace(/\n/g, ' ')
            .replace(/\|/g, '-')
            .trim();

        // Bold the description for new additions so they stand out in the posted report
        const formattedDesc = (item._isNewAddition && safeDesc) ? `**${safeDesc}**` : safeDesc;

        // Render as a relative link — works correctly when pasted into a Reddit post
        const subLink = `[r/${item.subreddit}](/r/${item.subreddit})`;

        if (listType === 'banned') {
            return `|${subLink}|${item.flags}|${formattedDesc}|${item.banDate || 'Unknown'}|${item.banReason || 'Unknown'}|`;
        }

        if (listType === 'alphabetical') {
            return `|${subLink}|${item.members || 0}|${item.prevMembers || 0}|${item.flags}|${formattedDesc}|`;
        }

        // Default: ranked/active list — prefix positive rank changes with a "+" sign
        const diffStr = item.diff !== '-' && item.diff > 0 ? `+${item.diff}` : item.diff;
        return `|${item.currentRank}|${item.prevRank}|${diffStr}|${item.members || 0}|${subLink}|${item.flags}|${formattedDesc}|`;
    };


    // ==========================================
    // 4. UI COMPONENTS
    // ==========================================

    /** Fixed title bar with the close button. */
    function Header({ setIsVisible }) {
        // Grab the version from Tampermonkey, with a fallback just in case
        const version = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

        return html`
            <div className="rs-header">
                <h3>Subreddit Info Scraper v${version}</h3>
                <button className="rs-close" onClick=${() => setIsVisible(false)}>✖</button>
            </div>
        `;
    }

    /** Horizontal tab bar — clicking a tab updates activeTab in the parent. */
    const TABS = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'quickAdd', label: 'Quick Add' },
        { id: 'data', label: 'Data & Database' },
        { id: 'settings', label: '⚙️ Settings' },
    ];

    function Tabs({ activeTab, setActiveTab }) {
        return html`
            <div className="rs-tabs">
                ${TABS.map(tab => html`
                    <button key=${tab.id}
                            className=${`rs-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick=${() => setActiveTab(tab.id)}>
                        ${tab.label}
                    </button>
                `)}
            </div>
        `;
    }

    /**
     * Main scraper control tab.
     * Shows the start/pause/resume button, a live log pane, and the report/commit action row.
     */
    function DashboardTab({ subCount, status, btnBg, textColor, btnText, handleToggle, logs, generateMarkdown, commitResults, hasResults }) {
        // Ref attached to the log container so we can control its scroll position
        const logRef = useRef(null);

        // Scroll to the bottom every time a new log entry is added
        useEffect(() => {
            if (logRef.current) {
                logRef.current.scrollTop = logRef.current.scrollHeight;
            }
        }, [logs]);

        return html`
            <div className="rs-content">

                <button
                    className="rs-btn"
                    style=${{ background: subCount === 0 ? 'var(--rs-disabled)' : btnBg, color: textColor }}
                    disabled=${subCount === 0}
                    onClick=${handleToggle}
                >
                    ${subCount === 0 ? 'No Data Loaded' : btnText}
                </button>

                <div className="rs-log" ref=${logRef}>
                    ${subCount > 0 && logs.length === 0
                        ? html`<i>Loaded ${subCount} subreddits from local database. Ready to scrape.</i>`
                        : ''
                    }
                    ${logs.map(log => html`
                        <div key=${log.id} style=${{ color: log.color, marginBottom: '4px' }}>${log.msg}</div>
                    `)}
                </div>

                <div className="rs-action-row">

                    ${REPORTS.map(({ type, label }) => html`
                        <button key=${type}
                                className="rs-btn"
                                style=${{ background: hasResults ? 'var(--rs-primary)' : 'var(--rs-disabled)' }}
                                disabled=${!hasResults}
                                onClick=${() => generateMarkdown(type)}>
                            ${label}
                        </button>
                    `)}

                    <button
                        className="rs-btn"
                        style=${{ background: status === 'DONE' && hasResults ? 'var(--rs-success)' : 'var(--rs-disabled)' }}
                        disabled=${status !== 'DONE' || !hasResults}
                        onClick=${commitResults}
                    >
                        💾 Save & Commit
                    </button>

                </div>

            </div>
        `;
    }

    /**
     * Data & Database tab.
     * Handles CSV import/export and renders the full current dataset as a scrollable table.
     */
    function DataTab({ handleCSVUpload, handleDownloadCSV, subCount, processedList }) {
        return html`
            <div className="rs-content">

                <div style=${{ display: 'flex', gap: '10px', marginBottom: '15px' }}>

                    <label className="rs-btn" style=${{ flex: 1, background: 'var(--rs-primary)', cursor: 'pointer' }}>
                        📂 Load CSV Database
                        <input type="file" accept=".csv" style=${{ display: 'none' }} onChange=${handleCSVUpload} />
                    </label>

                    <button
                        className="rs-btn"
                        style=${{ flex: 1, background: 'var(--rs-primary)' }}
                        disabled=${subCount === 0}
                        onClick=${handleDownloadCSV}
                    >
                        💾 Save CSV Database
                    </button>

                </div>

                <div className="rs-table-container">
                    <table className="rs-table">
                        <thead>
                            <tr>
                                <th style=${{ textAlign: 'center' }}>P</th>
                                <th style=${{ textAlign: 'center' }}>L</th>
                                <th style=${{ textAlign: 'center' }}>+/-</th>
                                <th>Subreddit</th>
                                <th>Subs</th>
                                <th style=${{ textAlign: 'right' }}>+/- Subs</th>
                                <th style=${{ textAlign: 'center' }}>F</th>
                                <th>Ban Reason</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${processedList.map((row) => {
                                // Colour-code diffs: green = up/gain, red = down/loss, muted = no change
                                const diffColor = row.diff > 0 ? 'var(--rs-color-positive)' : (row.diff < 0 ? 'var(--rs-color-negative)' : 'var(--rs-text-muted)');
                                const subDiffColor = row.subDiff > 0 ? 'var(--rs-color-positive)' : (row.subDiff < 0 ? 'var(--rs-color-negative)' : 'var(--rs-text-secondary)');

                                const subDiffText = row.subDiff > 0
                                    ? `+${row.subDiff.toLocaleString()}`
                                    : row.subDiff.toLocaleString();

                                return html`
                                    <tr key=${row.subreddit}>
                                        <td style=${{ textAlign: 'center', fontWeight: 'bold' }}>${row.currentRank}</td>
                                        <td style=${{ textAlign: 'center', color: 'var(--rs-text-secondary)' }}>${row.prevRank}</td>
                                        <td style=${{ textAlign: 'center', color: diffColor, fontWeight: 'bold' }}>
                                            ${row.diff > 0 ? `+${row.diff}` : row.diff}
                                        </td>
                                        <td>
                                            <a href="https://old.reddit.com/r/${row.subreddit}" target="_blank" style=${{ color: 'var(--rs-link)', fontWeight: 'bold' }}>
                                                r/${row.subreddit}
                                            </a>
                                        </td>
                                        <td>${(row.members || 0).toLocaleString()}</td>
                                        <td style=${{ textAlign: 'right', color: subDiffColor, fontWeight: 'bold' }}>${subDiffText}</td>
                                        <td style=${{ textAlign: 'center', color: 'var(--rs-color-flags)', fontWeight: 'bold' }}>${row.flags}</td>
                                        <td
                                            style=${{ maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                            title=${row.banReason}
                                        >
                                            ${row.banReason || '-'}
                                        </td>
                                        <td
                                            style=${{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                            title=${row.description}
                                        >
                                            ${row.description || '-'}
                                        </td>
                                    </tr>
                                `;
                            })}
                        </tbody>
                    </table>
                </div>

            </div>
        `;
    }

    /**
     * Settings tab — request timing controls, theme toggle, and a save button.
     *
     * Theme changes apply instantly and save automatically.
     * Timing settings require clicking Save Settings.
     */
    function SettingsTab({ config, setConfig, saveSettings, theme, setThemeAndSave }) {
        return html`
            <div className="rs-content">

                <div className="rs-input-group">
                    <label>Theme:</label>
                    <div className="rs-theme-toggle">
                        <button
                            className="rs-btn"
                            style=${{ background: theme === 'light' ? 'var(--rs-primary)' : 'var(--rs-disabled)' }}
                            onClick=${() => setThemeAndSave('light')}
                        >
                            ☀️ Light
                        </button>
                        <button
                            className="rs-btn"
                            style=${{ background: theme === 'dark' ? 'var(--rs-primary)' : 'var(--rs-disabled)' }}
                            onClick=${() => setThemeAndSave('dark')}
                        >
                            🌙 Dark
                        </button>
                    </div>
                </div>

                <div className="rs-input-group">
                    <label>Request Delay (ms):</label>
                    <input
                        type="number"
                        value=${config.delay}
                        onChange=${e => setConfig({ ...config, delay: parseInt(e.target.value) })}
                    />
                </div>

                <div className="rs-input-group">
                    <label>Initial 429 Retry Delay (ms):</label>
                    <input
                        type="number"
                        value=${config.retry}
                        onChange=${e => setConfig({ ...config, retry: parseInt(e.target.value) })}
                    />
                </div>

                <div className="rs-input-group">
                    <label>Extra 429 Retry Delay (ms):</label>
                    <input
                        type="number"
                        value=${config.addRetry}
                        onChange=${e => setConfig({ ...config, addRetry: parseInt(e.target.value) })}
                    />
                </div>

                <div style=${{ flexGrow: 1 }}></div>

                <button className="rs-btn" style=${{ background: 'var(--rs-success)' }} onClick=${saveSettings}>
                    💾 Save Settings
                </button>

            </div>
        `;
    }

    /** Quick Add tab — adds a single subreddit to the database without a CSV round-trip. */
    function QuickAddTab({ quickAddData, setQuickAddData, handleQuickAdd }) {
        return html`
            <div className="rs-content">

                <div className="rs-input-group">
                    <label>Subreddit Name:</label>
                    <input
                        type="text"
                        value=${quickAddData.subName}
                        onChange=${e => setQuickAddData({ ...quickAddData, subName: e.target.value })}
                        placeholder="e.g., askreddit (without the r/)"
                    />
                </div>

                <div className="rs-input-group">
                    <label>Description:</label>
                    <input
                        type="text"
                        value=${quickAddData.description}
                        onChange=${e => setQuickAddData({ ...quickAddData, description: e.target.value })}
                        placeholder="Enter an optional description..."
                    />
                </div>

                <div style=${{ flexGrow: 1 }}></div>

                <button className="rs-btn" style=${{ background: 'var(--rs-primary)' }} onClick=${handleQuickAdd}>
                    💾 Add to Database
                </button>

            </div>
        `;
    }


    // ==========================================
    // 5. MAIN APPLICATION COMPONENT
    // ==========================================

    function ScraperApp() {

        // --- Persistent state (survives page refreshes via GM storage) ---
        const [history, setHistory] = useState(
            () => JSON.parse(GM_getValue('redditScraperHistory', '{}'))
        );

        // --- Scrape session state (reset at the start of each run) ---
        const [results, setResults] = useState([]);
        const [logs, setLogs] = useState([]);
        const [progress, setProgress] = useState({ current: 0, total: 0 });
        const [waitMessage, setWaitMessage] = useState("");

        // --- UI state ---
        const [isVisible, setIsVisible] = useState(false);
        const [activeTab, setActiveTab] = useState('dashboard');
        const [quickAddData, setQuickAddData] = useState({ subName: "", description: "" });

        // --- Theme — persisted separately and applies instantly without needing Save ---
        const [theme, setTheme] = useState(GM_getValue('redditTheme', 'light'));

        const setThemeAndSave = (newTheme) => {
            setTheme(newTheme);
            GM_setValue('redditTheme', newTheme);
        };

        // --- Settings (each persisted individually in GM storage) ---
        const [config, setConfig] = useState({
            delay:    parseInt(GM_getValue('redditDelay', 2400)),
            retry:    parseInt(GM_getValue('redditRetryDelay', 60)),
            addRetry: parseInt(GM_getValue('redditAddRetryDelay', 30))
        });

        // configRef mirrors `config` so the async scraper loop always reads the latest
        // values without needing to be restarted due to a stale closure
        const configRef = useRef(config);
        useEffect(() => {
            configRef.current = config;
        }, [config]);

        // --- Scraper status — state machine: IDLE → RUNNING ⇄ PAUSED → DONE → IDLE ---
        const [status, setStatus] = useState('IDLE');

        // statusRef mirrors `status` for the same stale-closure reason as configRef:
        // the async scraper loop reads it every iteration to check for pause/stop signals
        const statusRef = useRef('IDLE');

        // Always update both the React state (drives re-renders) and the ref (drives the loop)
        const setSyncStatus = (newStatus) => {
            setStatus(newStatus);
            statusRef.current = newStatus;
        };

        // Inject a "scraper dashboard" link into old Reddit's top nav bar on first mount
        useEffect(() => {
            const tabMenu = document.querySelector('#header-bottom-left ul.tabmenu');
            if (tabMenu && !document.getElementById('rs-nav-btn')) {
                const li = document.createElement('li');
                li.id = 'rs-nav-btn';
                li.innerHTML = `<a href="javascript:void(0)" style="color:#FF4500; font-weight:bold;">scraper v2</a>`;
                li.addEventListener('click', () => setIsVisible(v => !v));
                tabMenu.appendChild(li);
            }
        }, []);

        /** Appends a coloured entry to the log pane. */
        const addLog = (msg, color = 'var(--rs-text)') => {
            setLogs(prev => [...prev, { msg, color, id: crypto.randomUUID() }]);
        };

        /**
         * Scrapes the HTML of a banned subreddit page to extract the ban date and inferred reason.
         * The JSON API returns no useful data for banned subs, so we fall back to HTML parsing.
         *
         * @param   {string}  subreddit
         * @returns {Promise<{banDate: string, banReason: string}>}
         */
        const fetchBanData = async (subreddit) => {
            let banData = { banDate: "", banReason: "" };

            try {
                const htmlResponse = await fetch(`https://old.reddit.com/r/${subreddit}/`);
                const htmlText = await htmlResponse.text();
                const doc = new DOMParser().parseFromString(htmlText, 'text/html');

                // The ban date lives in a <time> element inside the .note container
                const timeEl = doc.querySelector('.note time');
                if (timeEl) {
                    const rawDateStr = timeEl.getAttribute('datetime')
                        || timeEl.getAttribute('title')
                        || timeEl.textContent;

                    if (rawDateStr) {
                        const dateObj = new Date(rawDateStr);

                        if (!isNaN(dateObj.getTime())) {
                            // Normalise to YYYY/MM/DD for consistent sorting
                            const day = String(dateObj.getDate()).padStart(2, '0');
                            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                            const year = dateObj.getFullYear();
                            banData.banDate = `${year}/${month}/${day}`;
                        } else {
                            // Date couldn't be parsed — store the raw string as a fallback
                            banData.banDate = rawDateStr;
                        }
                    }
                }

                // The ban reason is inferred by keyword-matching the first paragraph of the ban notice
                const reasonEl = doc.querySelector('.md p');
                if (reasonEl) {
                    const text = reasonEl.textContent;
                    const matched = BAN_REASONS.find(({ keyword }) => text.includes(keyword));
                    banData.banReason = matched?.reason ?? 'Unknown';
                }

            } catch (err) {
                console.error(`Failed to scrape HTML ban data for r/${subreddit}:`, err);
            }

            return banData;
        };

        /**
         * Fetches subreddit metadata via the JSON API endpoint.
         * If the sub appears banned, falls back to fetchBanData for date/reason details.
         *
         * @param   {string}  subreddit
         * @returns {Promise<object>} Normalised data object with boolean status flags.
         */
        const fetchSubredditData = async (subreddit) => {
            const response = await fetch(`https://old.reddit.com/r/${subreddit}/about.json`);

            // Default result shape — only the relevant fields are overwritten below
            let data = {
                members:       0,
                banDate:       "",
                banReason:     "",
                description:   "",
                isBanned:      false,
                isRestricted:  false,
                isPrivate:     false,
                isQuarantined: false,
                errorText:     ""
            };
            let statusText = "Unknown";

            if (response.ok) {
                const json = await response.json();
                statusText = json?.data?.subreddit_type || "Unknown";
                data.members = json?.data?.subscribers || 0;
                data.description = json?.data?.public_description || "";

            } else {
                // Try to extract a meaningful reason from the error response body
                try {
                    const errorJson = await response.json();
                    statusText = errorJson?.reason || errorJson?.message || `Error (${response.status})`;
                } catch {
                    statusText = `HTTP Error (${response.status})`;
                }

                // Banned subs often return 403 or 404 — attempt an HTML scrape for ban details
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

            // Map the status string to individual boolean flags for easier downstream use
            const lowerStatus = statusText.toLowerCase();
            if (lowerStatus === 'banned') data.isBanned = true;
            if (lowerStatus === 'restricted') data.isRestricted = true;
            if (lowerStatus === 'private') data.isPrivate = true;
            if (lowerStatus === 'quarantined') data.isQuarantined = true;

            // Anything still unexplained gets stored as a generic error string
            if (!response.ok && !data.isBanned && !data.isPrivate && !data.isQuarantined && !data.errorText) {
                data.errorText = statusText;
            }

            return { statusCode: response.status, ...data };
        };

        /**
         * Main scraper loop. Iterates through every subreddit in `history`, fetching
         * fresh data for each one. Handles 429 rate-limits with progressive backoff,
         * and respects pause/stop signals from statusRef each iteration.
         */
        const runScraper = async () => {
            const subs = Object.keys(history);
            if (subs.length === 0) return;

            setSyncStatus('RUNNING');
            setWaitMessage("");
            setResults([]);
            setLogs([]);
            setProgress({ current: 0, total: 0 });

            // Accumulate results locally so we can push incremental updates to state
            let currentResults = [];

            for (const [i, sub] of subs.entries()) {
                setProgress({ current: i + 1, total: subs.length });

                let retry = true;
                let attempt = 0;

                // Keep retrying this subreddit until we get a clean result or exhaust attempts
                while (retry) {

                    // Block here while paused — poll every 250ms to stay responsive
                    while (statusRef.current === 'PAUSED') { await sleep(250); }

                    // If the user stopped the scraper entirely, exit the loop immediately
                    if (statusRef.current === 'IDLE' || statusRef.current === 'DONE') return;

                    attempt++;
                    addLog(`Fetching r/${sub}...`);

                    try {
                        const data = await fetchSubredditData(sub);

                        // Rate limited — wait with progressive backoff then retry the same sub
                        if (data.statusCode === 429) {
                            let delay = configRef.current.retry + (configRef.current.addRetry * (attempt - 1));
                            addLog(`429 Rate Limited. Waiting ${delay}s...`, 'var(--rs-color-caution)');

                            // Count down in 1s steps so the button label updates each second
                            while (delay > 0 && statusRef.current !== 'IDLE') {
                                setWaitMessage(`⏳ Rate Limited: Waiting ${delay}s...`);
                                await sleep(1000);
                                delay--;
                            }
                            setWaitMessage("");
                            continue; // Retry the same subreddit
                        }

                        // Build a human-readable status string for the log entry
                        let flagLogs = [];
                        if (data.isBanned) flagLogs.push('Banned');
                        if (data.isRestricted) flagLogs.push('Restricted');
                        if (data.isQuarantined) flagLogs.push('Quarantined');
                        if (data.isPrivate) flagLogs.push('Private');

                        // Outputting subreddit status to log
                        // Determine the color and text for the UI log based on the subreddit's state
                        let logColor = 'var(--rs-color-positive)'; // Default assumption: the sub is public and accessible
                        let logText = `Public (${data.members})`;

                        if (data.errorText) {
                            // Hard API errors (e.g., 404 Not Found, 403 Forbidden)
                            logColor = 'var(--rs-color-negative)';
                            logText = data.errorText;

                        } else if (data.isBanned) {
                            // Banned Status: Combines ban date and reason, dropping any empty values
                            logColor = 'var(--rs-color-negative)';
                            const banDetails = [data.banDate, data.banReason].filter(Boolean).join(' - ');
                            logText = banDetails ? `Banned (${banDetails})` : "Banned";

                        } else if (flagLogs.length > 0) {
                            // Flagged Status: Exists, but is Private, Restricted, or Quarantined
                            logColor = 'var(--rs-color-caution)';
                            // Only show subscriber count if available
                            logText = data.members ? `${flagLogs.join(', ')} (${data.members})`: `${flagLogs.join(', ')}`;
                        }

                        // Push the final formatted string to the dashboard display
                        addLog(`→ ${logText}`, logColor);

                        // Prefer the stored description — users may have customised it
                        const newResult = {
                            subreddit: sub,
                            ...data,
                            description: history[sub]?.description || data.description
                        };

                        currentResults.push(newResult);
                        setResults([...currentResults]);
                        retry = false; // Success — exit the retry loop

                    } catch (err) {
                        // Network error — wait with an escalating delay, max 5 attempts
                        let delay = 5 * attempt;
                        addLog(`Network Error. Waiting ${delay}s...`, 'var(--rs-color-negative)');

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

                // Inter-request delay with a small random jitter to avoid a predictable pattern
                const normalDelay = configRef.current.delay + Math.floor(Math.random() * 200);
                while (statusRef.current === 'PAUSED') { await sleep(250); }
                if (statusRef.current !== 'IDLE') { await sleep(normalDelay); }
            }

            // Only mark as done if the user didn't manually stop the run
            if (statusRef.current !== 'IDLE') {
                setSyncStatus('DONE');
                setWaitMessage("");
                addLog("✓ Scrape Complete! Reports ready to generate. Don't forget to commit your results to the database AFTER running reports.", 'var(--rs-color-positive)');
            }
        };

        /**
         * Adds or updates a single entry in the database from the Quick Add form.
         * Strips any "r/" prefix the user may have typed, and marks the entry as new.
         */
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
                    subreddit:      cleanName,
                    description:    quickAddData.description.trim() || history[cleanName]?.description || "",
                    _isNewAddition: true
                }
            };

            setHistory(newHistory);
            GM_setValue('redditScraperHistory', JSON.stringify(newHistory));

            setQuickAddData({ subName: "", description: "" });
            setActiveTab('dashboard');
            addLog(`✓ r/${cleanName} successfully added to the database!`, 'var(--rs-color-positive)');
        };

        /**
         * Drives the start/pause/resume button.
         * State transitions: IDLE/DONE → RUNNING → PAUSED → RUNNING (cycle until DONE)
         */
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

        /**
         * Writes fresh scrape results into the persistent history object (the "commit" step).
         *
         * IMPORTANT: generate all reports before committing — committing overwrites the
         * "previous" snapshot that diffs are calculated against.
         *
         * Also strips _isNewAddition so subs aren't permanently flagged as "N".
         */
        const commitResults = () => {
            if (results.length === 0) return;

            const newHistory = { ...history };

            results.forEach(r => {
                // Remove the temporary new-addition flag before writing to persistent storage
                const { _isNewAddition, ...cleanR } = r;
                newHistory[r.subreddit] = cleanR;
            });

            setHistory(newHistory);
            GM_setValue('redditScraperHistory', JSON.stringify(newHistory));

            setResults([]);
            setProgress({ current: 0, total: 0 });
            setSyncStatus('IDLE');
            addLog("✓ Data successfully saved and committed to local database.", 'var(--rs-color-positive)');
        };

        /**
         * Merges history and fresh results, computes ranks for both snapshots, and returns
         * a fully enriched, sorted list ready for the data table and Markdown generation.
         *
         * Memoised so it only recalculates when `results` or `history` actually change.
         */
        const processedList = useMemo(() => {

            // Overlay fresh results onto history — results take priority on any conflict
            const combinedDataMap = { ...history };
            results.forEach(r => { combinedDataMap[r.subreddit] = r; });
            const dataToProcess = Object.values(combinedDataMap);

            // Build the previous rank map from stored history (the snapshot before this scrape)
            const prevArray = Object.entries(history)
                .map(([sub, d]) => ({ subreddit: sub, members: d.members || 0 }))
                .sort((a, b) => b.members - a.members || a.subreddit.localeCompare(b.subreddit));

            const prevRankMap = Object.fromEntries(
                prevArray.map((item, index) => [item.subreddit, index + 1])
            );

            // Sort combined data by subscribers descending to establish current ranks
            const sortedData = [...dataToProcess].sort(
                (a, b) => (b.members || 0) - (a.members || 0) || String(a.subreddit).localeCompare(String(b.subreddit))
            );

            const currentRankMap = Object.fromEntries(
                sortedData.map((item, index) => [item.subreddit, index + 1])
            );

            // Enrich each item with ranks, diffs, and flags
            return sortedData.map(item =>
                processSubredditData(
                    item,
                    history[item.subreddit] || {},
                    currentRankMap[item.subreddit],
                    prevRankMap[item.subreddit]
                )
            );

        }, [results, history]);

        /**
         * Generates a Markdown report of the requested type and copies it to the clipboard.
         *
         * @param {'active'|'alphabetical'|'banned'} type
         */
        const generateMarkdown = (type) => {
            if (processedList.length === 0) return;

            // Partition the full list into the subsets each report uses
            const activeSubs = processedList.filter(d => !d.isBanned);
            const bannedSubs = processedList.filter(d => d.isBanned);
            const alphaSubs = [...activeSubs].sort((a, b) =>
                String(a.subreddit).toLowerCase().localeCompare(String(b.subreddit).toLowerCase())
            );

            // New subs get a second listing at the bottom of active and alphabetical reports
            const activeNewSubs = activeSubs.filter(d => d.flags.includes('N'));
            const alphaNewSubs = alphaSubs.filter(d => d.flags.includes('N'));

            let postContent = "";

            if (type === 'active') {
                postContent = `
### League Table List
| P | L | +- | Subs | Subname | F | Description |
|---|---|---|---|---|---|---|
${activeSubs.map(item => formatMarkdownRow(item, 'active')).join('\n')}`.trim();

                // Append a "new subs" repeat section if there are any this run
                if (activeNewSubs.length > 0) {
                    postContent += `
\n### These subs are new to this list
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
                    postContent += `
\n### These subs are new to this list
| Subname | Subs | Prev | F | Description |
|---|---|---|---|---|
${alphaNewSubs.map(item => formatMarkdownRow(item, 'alphabetical')).join('\n')}`;
                }
            }

            else if (type === 'banned') {
                postContent = `
### Banned Subs
| Subname | F | Description | Ban Date | Reason for Ban |
|---|---|---|---|---|
${bannedSubs.map(item => formatMarkdownRow(item, 'banned')).join('\n')}`.trim();
            }

            GM_setClipboard(postContent, "text");

            // Confirm in the log which report type was just copied
            const alertText = REPORT_LABELS[type] ?? 'League'; // Default to league table
            addLog(`✓ ${alertText} Markdown copied to clipboard!`, 'var(--rs-primary)');
        };

        /**
         * Parses an uploaded CSV and replaces the current database entirely.
         * Prompts the user whether to flag entries that are new to the existing database.
         */
        const handleCSVUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                const parseResult = Papa.parse(evt.target.result, { header: true, skipEmptyLines: true });
                const existingHistory = JSON.parse(GM_getValue('redditScraperHistory', '{}'));
                const flagNew = confirm("Flag new entries?");

                let newHistory = {};
                parseResult.data.forEach(row => {
                    // Support CSV files where the first-column header name varies
                    const rawName = row.Subreddit || row[Object.keys(row)[0]] || "";
                    const subname = rawName.trim().replace(/^r\//i, '');
                    if (!subname) return;

                    // Only mark as new if this sub wasn't already in the database
                    const isNewAddition = !existingHistory[subname] && flagNew;

                    newHistory[subname] = {
                        subreddit:      subname,
                        members:        parseInt(row.Members) || undefined,
                        isBanned:       parseBool(row.Banned),
                        isRestricted:   parseBool(row.Restricted),
                        isQuarantined:  parseBool(row.Quarantined),
                        isPrivate:      parseBool(row.Private),
                        banDate:        row["Ban Date"] || "",
                        banReason:      row["Ban Reason"] || "",
                        description:    row.Description || "",
                        errorText:      row.Error || "",
                        _isNewAddition: isNewAddition
                    };
                });

                // Reset any ongoing run and load new data
                setSyncStatus('IDLE');
                setHistory(newHistory);
                GM_setValue('redditScraperHistory', JSON.stringify(newHistory));
                setResults([]);
                setLogs([]);
                setActiveTab('dashboard');
            };
            reader.readAsText(file);
        };

        /** Exports the current processed list to a CSV download. */
        const handleDownloadCSV = async () => {
            const csv = Papa.unparse(processedList.map(r => ({
                "Subreddit":   r.subreddit,
                "Description": r.description || "",
                "Members":     r.members || "",
                "Banned":      r.isBanned ? "TRUE" : "FALSE",
                "Restricted":  r.isRestricted ? "TRUE" : "FALSE",
                "Quarantined": r.isQuarantined ? "TRUE" : "FALSE",
                "Private":     r.isPrivate ? "TRUE" : "FALSE",
                "Ban Date":    r.banDate || "",
                "Ban Reason":  r.banReason || "",
                "Error":       r.errorText || ""
            })));

            // showSaveFilePicker may be unavailable, so check for it
            if (typeof window.showSaveFilePicker === 'function') {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: `reddit_database_${Date.now()}.csv`,
                        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(csv);
                    await writable.close();
                    return;

                } catch (err) {
                    // AbortError means the user cancelled the dialog — don't fall through to auto-download
                    if (err.name === 'AbortError') return;
                }
            }

            // Fallback: standard blob download.
            // The URL must not be revoked until after the download has started.
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `reddit_database_${Date.now()}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        /** Persists the current config values to GM storage. */
        const saveSettings = () => {
            GM_setValue('redditDelay', config.delay);
            GM_setValue('redditRetryDelay', config.retry);
            GM_setValue('redditAddRetryDelay', config.addRetry);
            alert("Settings saved successfully.");
        };

        /**
         * Estimates remaining scrape time based on configured delay and remaining item count.
         *
         * @param   {number} remainingItems
         * @returns {string} Human-readable string, e.g. "2m 30s" or "45s".
         */
        const calculateETA = (remainingItems) => {
            const estimatedSeconds = remainingItems * ((config.delay + 100) / 1000);
            return estimatedSeconds > 60
                ? `${Math.floor(estimatedSeconds / 60)}m ${Math.round(estimatedSeconds % 60)}s`
                : `${Math.round(estimatedSeconds)}s`;
        };

        // Don't render the panel at all when hidden — avoids unnecessary DOM work
        if (!isVisible) return null;

        const subCount = Object.keys(history).length;

        // Derive the action button's label and colour from the current scraper status
        let btnText = "▶ Start Scraper";
        let btnBg = 'var(--rs-primary)';
        let textColor = "white";

        if (waitMessage) {
            // A rate-limit or network-error countdown is actively ticking
            btnText = waitMessage;
            btnBg = 'var(--rs-warning)';
            textColor = "black";
        } else if (status === 'RUNNING') {
            btnText = `⏸ Pause Scraper (${progress.current}/${progress.total}) (~${calculateETA(progress.total - progress.current)})`;
            btnBg = 'var(--rs-success)';
        } else if (status === 'PAUSED') {
            btnText = `▶ Resume Scraper`;
            btnBg = 'var(--rs-warning)';
            textColor = "black";
        } else if (status === 'DONE') {
            btnText = `↺ Run Again`;
            btnBg = 'var(--rs-primary)';
        }

        return html`
            <div className=${`rs-panel ${theme === 'dark' ? 'rs-dark' : ''}`}>
                <${Header} setIsVisible=${setIsVisible} />
                <${Tabs} activeTab=${activeTab} setActiveTab=${setActiveTab} />

                ${activeTab === 'dashboard' && html`
                    <${DashboardTab}
                        subCount=${subCount}
                        status=${status}
                        btnBg=${btnBg}
                        textColor=${textColor}
                        btnText=${btnText}
                        handleToggle=${handleToggle}
                        logs=${logs}
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
                        handleCSVUpload=${handleCSVUpload}
                        handleDownloadCSV=${handleDownloadCSV}
                        subCount=${subCount}
                        processedList=${processedList}
                    />
                `}

                ${activeTab === 'settings' && html`
                    <${SettingsTab}
                        config=${config}
                        setConfig=${setConfig}
                        saveSettings=${saveSettings}
                        theme=${theme}
                        setThemeAndSave=${setThemeAndSave}
                    />
                `}
            </div>
        `;
    }


    // ==========================================
    // 6. RENDER ROOT
    // ==========================================

    // Mount into an isolated node so the script's DOM doesn't interfere with Reddit's own markup
    const mountNode = document.createElement('div');
    mountNode.id = 'react-scraper-root';
    document.body.appendChild(mountNode);

    ReactDOM.createRoot(mountNode).render(html`<${ScraperApp} />`);

})();
