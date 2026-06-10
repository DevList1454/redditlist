// ==UserScript==
// @name         Subreddit Info Scraper
// @namespace    http://tampermonkey.net/
// @version      1.11.0
// @description  Scrapes subreddit status, UI integrated into reddit, Pause/Resume, extracts ban dates.
// @match        https://old.reddit.com/*
// @grant        none
// @updateURL    https://github.com/DevList1454/redditlist/raw/refs/heads/main/infoscraper.user.js
// @downloadURL  https://github.com/DevList1454/redditlist/raw/refs/heads/main/infoscraper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // CONFIGURATION & CONSTANTS
    // ==========================================
    const CONFIG = {
        DELAY_MS: 2400,
        MAX_RETRIES: 5
    };

    const COLOR = {
        PRIMARY: "#0079D3",
        SUCCESS: "#28a745",
        WARNING: "#ffc107",
        ERROR: "#cc3600",
        DISABLED: "#ccc",
        TEXT_DARK: "#000",
        TEXT_LIGHT: "#fff"
    };

    // ==========================================
    // STATE MANAGEMENT
    // ==========================================
    const state = {
        subreddits: [],
        results: [],
        isRunning: false,
        isPaused: false,
        currentIndex: 0 // Track exact index for clean pausing/resuming
    };

    // Cache for DOM elements to avoid repeated queries
    const DOM = {};

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const calculateETA = (remainingItems) => {
        const estimatedSeconds = remainingItems * ((CONFIG.DELAY_MS + 100) / 1000);
        return estimatedSeconds > 60
            ? `${Math.floor(estimatedSeconds / 60)}m ${Math.round(estimatedSeconds % 60)}s`
            : `${Math.round(estimatedSeconds)}s`;
    };

    const addJitter = () => sleep(CONFIG.DELAY_MS + Math.floor(Math.random() * 200));

    // ==========================================
    // UI & DOM MANIPULATION
    // ==========================================
    function initUI() {
        // Create main panel
        const panel = document.createElement('div');
        panel.style.cssText = "display:none; flex-direction:column; position:fixed; top:60px; right:20px; width:350px; height:500px; background:white; color:black; z-index:999999; border:1px solid #ccc; padding:15px; box-sizing:border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <h3 style="margin:0; font-size:16px; font-weight:bold; color:#1c1c1c;">Subreddit Scraper</h3>
                <button id="close-panel-btn" style="background:none; border:none; color:#ff4500; font-weight:bold; cursor:pointer; font-size:16px; padding:0; display:flex; align-items:center; justify-content:center;" title="Close Panel">✖</button>
            </div>
            <hr style="margin: 15px 0; border: 0; border-top: 1px solid #eee; flex-shrink:0;">
            <label for="file-input" id="file-label" style="display:block; width:100%; box-sizing:border-box; padding:10px; text-align:center; font-family:inherit; font-size:14px; font-weight:600; background:#24a0ed; color:white; border-radius:4px; cursor:pointer; margin-bottom:10px; line-height:normal; flex-shrink:0;">📂 Upload Subreddit List</label>
            <input type="file" id="file-input" accept=".txt" style="display:none;">
            <button id="start-btn" disabled style="display:block; width:100%; box-sizing:border-box; padding:10px; text-align:center; font-family:inherit; font-size:14px; font-weight:600; cursor:not-allowed; background:#ccc; color:white; border:none; border-radius:4px; margin-bottom:10px; line-height:normal; flex-shrink:0;">▶ Start Scraper</button>
            <hr style="margin: 5px 0 15px 0; border: 0; border-top: 1px solid #eee; flex-shrink:0;">
            <div id="scraper-log" style="flex-grow:1; overflow-y:auto; font-size:12px; font-family: ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace; background:#f6f7f8; padding:10px; border-radius:4px; border: 1px solid #eee; color:#333; margin-bottom:15px;">
                <i>Please upload a .txt file containing one subreddit per line to begin.</i>
            </div>
            <button id="download-btn" disabled style="display:block; width:100%; box-sizing:border-box; padding:10px; text-align:center; font-family:inherit; font-size:14px; font-weight:600; cursor:not-allowed; background:#ccc; color:white; border:none; border-radius:4px; line-height:normal; flex-shrink:0;">📥 Download CSV File</button>
        `;
        document.body.appendChild(panel);

        // Cache DOM elements
        DOM.panel = panel;
        DOM.logDiv = document.getElementById('scraper-log');
        DOM.startBtn = document.getElementById('start-btn');
        DOM.fileInput = document.getElementById('file-input');
        DOM.fileLabel = document.getElementById('file-label');
        DOM.closePanelBtn = document.getElementById('close-panel-btn');
        DOM.downloadBtn = document.getElementById('download-btn');

        // Inject Tab Menu link
        const tabMenu = document.querySelector('#header-bottom-left ul.tabmenu');
        if (tabMenu) {
            const scraperTab = document.createElement('li');
            scraperTab.innerHTML = `<a href="javascript:void(0);" class="choice" style="color:#FF4500; font-weight:bold;">scraper</a>`;
            tabMenu.appendChild(scraperTab);
            scraperTab.querySelector('a').addEventListener('click', () => {
                DOM.panel.style.display = DOM.panel.style.display === "none" ? "flex" : "none";
            });
        }

        // Attach static Event Listeners
        DOM.closePanelBtn.addEventListener('click', () => {DOM.panel.style.display = "none"});
        DOM.fileInput.addEventListener('change', handleFileUpload);
        DOM.startBtn.addEventListener('click', handleScraperToggle);
        DOM.downloadBtn.addEventListener('click', () => generateAndDownloadCSV(state.results));
    }

    // Helper to centrally manage Start/Action button UI states
    function updateActionBtn(text, bgHex, colorHex, isDisabled = false) {
        DOM.startBtn.innerText = text;
        DOM.startBtn.style.background = bgHex;
        DOM.startBtn.style.color = colorHex;
        DOM.startBtn.disabled = isDisabled;
        DOM.startBtn.style.cursor = isDisabled ? "not-allowed" : "pointer";
    }

    // Helper to log messages and auto-scroll
    function logMessage(htmlContent) {
        DOM.logDiv.innerHTML += htmlContent;
        DOM.logDiv.scrollTop = DOM.logDiv.scrollHeight;
    }

    // Helper clear log window
    function clearLog() {
        DOM.logDiv.innerHTML = "";
    }

    // ==========================================
    // CORE LOGIC
    // ==========================================

    // File Upload & Parsing
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target.result;
            state.subreddits = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

            if (state.subreddits.length > 0) {
                clearLog();
                logMessage(`<span style="color:green; font-weight:bold;">Successfully loaded ${state.subreddits.length} subreddits!</span><br><br>Click "Start Scraper" to begin.`);
                updateActionBtn("▶ Start Scraper", COLOR.PRIMARY, COLOR.TEXT_LIGHT);

                // Reset states
                state.isRunning = false;
                state.isPaused = false;
                state.currentIndex = 0;
                state.results = [];

                // Reset Download UI
                DOM.downloadBtn.disabled = true;
                DOM.downloadBtn.style.background = COLOR.DISABLED;
                DOM.downloadBtn.style.cursor = "not-allowed";
            } else {
                logMessage(`<span style="color:red;">The uploaded file appears to be empty.</span><br>`);
                updateActionBtn("▶ Start Scraper", COLOR.DISABLED, COLOR.TEXT_LIGHT, true);
            }
        };
        reader.readAsText(file);
    }

    // Toggle logic (Play / Pause)
    function handleScraperToggle() {
        if (!state.isRunning) {
            state.isRunning = true;
            state.isPaused = false;

            // Lock UI inputs
            DOM.fileLabel.style.background = COLOR.DISABLED;
            DOM.fileLabel.style.cursor = "not-allowed";
            DOM.fileInput.disabled = true;
            DOM.logDiv.innerHTML = ""; // Clear log for new run

            updateActionBtn("Running...", COLOR.SUCCESS, COLOR.TEXT_LIGHT);
            startScrapingLoop();
        } else {
            state.isPaused = !state.isPaused;

            if (state.isPaused) {
                updateActionBtn("▶ Resume Scraper", COLOR.WARNING, COLOR.TEXT_DARK);
            } else {
                updateActionBtn("Resuming...", COLOR.SUCCESS, COLOR.TEXT_LIGHT);
            }
        }
    }

    // HTML Date Scraper
    async function fetchBanDate(subreddit) {
        try {
            const htmlResponse = await fetch(`https://old.reddit.com/r/${subreddit}/`);

            const htmlText = await htmlResponse.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            const timeEl = doc.querySelector('.note time');

            if (timeEl) {
                // Prefer datetime attribute as it's the most standard for Date parsing
                const rawDateStr = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.textContent;

                if (rawDateStr) {
                    const dateObj = new Date(rawDateStr);

                    // Check if the date parsed successfully
                    if (!isNaN(dateObj.getTime())) {
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        const month = String(dateObj.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
                        const year = dateObj.getFullYear();

                        return `${year}/${month}/${day}`;
                    }

                    // Fallback to the raw string if parsing somehow fails
                    return rawDateStr;
                }
            }
        } catch (err) {
            console.error(`Failed to scrape HTML ban date for r/${subreddit}:`, err);
        }
        return null;
    }

    // API Fetch abstraction
    async function fetchSubredditData(subreddit) {
        const response = await fetch(`https://old.reddit.com/r/${subreddit}/about.json`);
        let data = { statusText: "Unknown", members: 0, banDate: "", description: "" };

        if (response.ok) {
            const json = await response.json();
            data.statusText = json?.data?.subreddit_type || "Unknown";
            data.members = json?.data?.subscribers || 0;
            data.description = json?.data?.public_description || "";
        } else {
            try {
                const errorJson = await response.json();
                data.statusText = errorJson?.reason || errorJson?.message || `Error (${response.status})`;
            } catch {
                data.statusText = `HTTP Error (${response.status})`;
            }

            // Fallback: If it reports as banned or throws 404/403, crawl the main HTML container
            if (data.statusText === 'banned' || response.status === 404 || response.status === 403) {
                const scrapedBanDate = await fetchBanDate(subreddit);
                if (scrapedBanDate) {
                    data.banDate = scrapedBanDate;
                    data.statusText = "banned";
                }
            }
        }
        return { statusCode: response.status, ...data };
    }

    // The Main Loop
    async function startScrapingLoop() {
        const totalSubs = state.subreddits.length;

        // Loop using state index so it can resume exactly where it left off
        for (; state.currentIndex < totalSubs; state.currentIndex++) {
            let sub = state.subreddits[state.currentIndex];
            let retry = true;
            let attemptCount = 0;

            while (retry) {
                // Pause Gate
                while (state.isPaused) { await sleep(250); }

                attemptCount++;

                // UI Progress Update
                let remainingSubs = totalSubs - state.currentIndex;
                if (!state.isPaused) {
                    updateActionBtn(`⏸ Pause [${state.currentIndex + 1}/${totalSubs}] (~${calculateETA(remainingSubs)})`, COLOR.SUCCESS, COLOR.TEXT_LIGHT);
                }
                logMessage(`<div>Fetching <b>r/${sub}</b>...</div>`);

                try {
                    const data = await fetchSubredditData(sub);

                    // Rate Limit Handling
                    if (data.statusCode === 429) {
                        let retryDelay = 60 * attemptCount;
                        logMessage(`<div style="color:orange;">→ 429 Rate Limited. Waiting ${retryDelay}s...</div><br>`);
                        updateActionBtn("Rate Limited", COLOR.WARNING, COLOR.TEXT_DARK, true);

                        while (retryDelay > 0) {
                            updateActionBtn(`🛑 Paused for ${retryDelay}s...`, COLOR.WARNING, COLOR.TEXT_DARK, true);
                            await sleep(1000);
                            retryDelay--;
                        }

                        updateActionBtn("Resuming...", COLOR.SUCCESS, COLOR.TEXT_LIGHT);
                        continue; // Retry loop
                    }

                    // Success or HTTP Error logging
                    let logColor = data.statusCode === 200 ? "green" : (data.statusText === "banned" ? "red" : "orange");
                    let logText = data.statusCode === 200
                        ? `${data.statusText} (${data.members} members)`
                        : (data.banDate ? `banned (${data.banDate})` : `${data.statusText} (Status ${data.statusCode})`);

                    logMessage(`<div style="color:${logColor};">→ ${logText}</div><br>`);

                    // Save Result
                    state.results.push({
                        subreddit: sub,
                        statusCode: data.statusCode,
                        status: data.statusText,
                        members: data.members,
                        banDate: data.banDate,
                        description: data.description
                    });
                    retry = false;

                } catch (err) {
                    // Network Error Handling
                    let retryDelay = 5 * attemptCount;
                    if (!state.isPaused) {
                        updateActionBtn(`⚠️ Network Error. Paused for ${retryDelay}s...`, COLOR.ERROR, COLOR.TEXT_LIGHT);
                    }
                    logMessage(`<div style="color:red;">→ Network Error. Waiting ${retryDelay}s. Attempt ${attemptCount}</div><br>`);

                    await sleep(1000 * retryDelay);

                    if (attemptCount >= CONFIG.MAX_RETRIES) {
                        state.results.push({ subreddit: sub, statusCode: 0, status: "Network Error", members: 0, banDate: "", description: "" });
                        retry = false;
                    }
                }
            }
            await addJitter();
        }

        handleScrapeCompletion();
    }

    // Completion Cleanup
    function handleScrapeCompletion() {
        state.isRunning = false;
        state.isPaused = false;
        state.currentIndex = 0; // Reset for next file upload

        updateActionBtn("✓ Scrape Complete", COLOR.DISABLED, COLOR.TEXT_LIGHT, true);
        logMessage(`<div style="margin-top:10px;"><b>All Finished!</b></div>`);

        DOM.downloadBtn.disabled = false;
        DOM.downloadBtn.style.background = COLOR.SUCCESS;
        DOM.downloadBtn.style.cursor = "pointer";
    }

    // ==========================================
    // CSV EXPORT
    // ==========================================
    function generateAndDownloadCSV(data) {
        if (data.length === 0) return;

        const headers = ["Subreddit", "Status", "Members", "Ban Date", "Description"];
        const csvRows = [
            headers.join(','),
            ...data.map(row => {
                const safeStatus = String(row.status || "Unknown").replace(/"/g, '""');
                const safeBanDate = String(row.banDate || "").replace(/"/g, '""');
                const safeDesc = String(row.description || "").replace(/"/g, '""').replace(/\n/g, ' ');
                return [`"${row.subreddit}"`, `"${safeStatus}"`, row.members || 0, `"${safeBanDate}"`, `"${safeDesc}"`].join(',');
            })
        ];

        const csvString = csvRows.join("\n");
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `reddit_scrape_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    initUI();

})();
