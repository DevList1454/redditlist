# Subreddit Info Scraper v2

A Tampermonkey userscript that adds a control panel to **old.reddit.com** for tracking a list of subreddits over time: subscriber counts, ban/restriction status, week-over-week rank changes and generating ready-to-post Markdown reports.

## Features

- **Bulk scraping**: Check any number of subreddits via Reddit's `about.json` endpoint, with automatic rate-limit handling (`429` backoff with increasing delay) and network-error retries.
- **Ban detection**: When a subreddit returns banned/forbidden/not-found, the script falls back to scraping the subreddit's HTML page to pull the ban date and a reason (unmoderated, rule violation, spam).
- **Week-over-week diffing**: New data is compared against your last saved snapshot to compute rank movement (`+/-`), subscriber growth/loss, and status flags (new, banned, unbanned, restricted, etc).
- **One-click Markdown reports**: Generates three ready-to-paste tables (ranked "league" list, alphabetical list, and a banned-subs list) and copies them straight to your clipboard.
- **Local database**: Your subreddit list and last-known data persist in Tampermonkey storage (`GM_setValue`/`GM_getValue`), with import/export to CSV for backups or bulk editing in a spreadsheet.
- **Pause/resume scraping**: Long runs can be paused and resumed without losing progress, with a live ETA shown on the button.
- **Quick Add**: Add a single subreddit to the database without going through a CSV.
- **Configurable timing**: Request delay and rate-limit retry delays are all adjustable from the Settings tab.



## Prerequisites

To use this script, you will need a userscript manager installed in your browser.

* **Chrome/Edge/Brave:** Install [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* **Firefox:** Install [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

## Installation

1. Go to [https://github.com/DevList1454/redditlist/raw/refs/heads/dev/infoscraper.user.js](https://github.com/DevList1454/redditlist/raw/refs/heads/dev/infoscraper.user.js)
2. Click **Install**.
3. Go to [old.reddit.com](https://old.reddit.com)
4. Button "scraper v2" appears in top bar to open UI

## Browser Compatibility

This script works in both Firefox and Chrome, but Chrome requires a one-time
setup step before it will run.

### Chrome Setup (Required)

From Chrome 138, Google changed how userscripts are permitted to run. Rather
than a global Developer Mode toggle, each extension that runs userscripts now
has its own **Allow User Scripts** switch that defaults to **off** for any newly
installed extension, including Tampermonkey.

If the script appears to do nothing in Chrome (no nav link, no panel), this is
almost certainly why.

**To fix it:**

1. Go to `chrome://extensions`
2. Find **Tampermonkey** and click **Details**
3. Scroll down and enable the **Allow User Scripts** toggle
4. Reload any open old.reddit.com tabs

You only need to do this once. The setting persists across browser restarts.

> **Note:** If you installed Tampermonkey before Chrome 138 and already had
> Developer Mode enabled, Chrome may have migrated the setting for you
> automatically. If the script was working before and suddenly stopped after a
> Chrome update, revisit the steps above and check the toggle is still on.

### Firefox

No extra steps needed, the script installs and runs via Tampermonkey as normal.

For more detail on why Chrome made this change, see the
[Chrome developer blog post](https://developer.chrome.com/blog/chrome-userscript).

---

## Getting Started: First Run & Initial Setup

When you first install the script, your local database will be completely empty. To use it, you will need to populate it with a list of subreddits to track.

### Step 1: Open the Dashboard
Once the Tampermonkey script is active, navigate to any page on `https://old.reddit.com/`. 
Look at the top-left tab menu (next to "hot", "new", "wiki"). You will see a new orange link called **scraper v2**. Click it to open the Scraper Dashboard.

### Step 2: Prepare Your Subreddit List
To track a large number of subreddits immediately, the best method is to bulk-import a CSV file. 

Create a file in Excel, Google Sheets, or a plain text editor and save it as a `.csv`. 
* **Important:** The scraper requires a header row. 
* Do not include the `r/` prefix in the subreddit names.

**Example `database.csv` format:**
```csv
Subreddit,Description
askreddit,General questions and discussion
funny,You must be funny to post here
gaming,Number one gaming forum
```
*(Note: If you only have one or two subreddits to add, you can skip this step and use the **Quick Add** tab in the dashboard to type them in manually).*

### Step 3: Load the Database
1. Inside the dashboard, click on the **Data & Database** tab.
2. Click the **Load CSV Database** button and select the CSV file you just created.
3. **The "New" Prompt:** The app will ask: *"Flag new entries?"* * Click **OK** if you want these subreddits marked with the `[N]` (New) flag in your Markdown reports. 
   * Click **Cancel** if you want them treated as standard entries.
4. Your subreddits will now populate in the table below.

### Step 4: Run Your First Scrape

1. Navigate to the **Dashboard** tab.
2. Click **Start Scraper**. 
3. The app will begin pinging Reddit's API for subscriber counts, ban status, and restricted settings. You can watch the live database populate.
   * *Note:* If you are scraping a massive list, Reddit may temporarily rate-limit you (a `429` error). The scraper will automatically catch this, pause, count down a cooldown timer, and resume on its own.

### Step 5: Export & Commit
When the scrape finishes, the status will change to **DONE**. 

1. Use the **Report** buttons to generate and copy formatted Markdown tables to your clipboard for easy posting.
2. **Commit Your Baseline:** You **must** click the green **Save & Commit** button. This saves today's subscriber numbers and ranks to your local storage. Make sure to do this **after** generating reports, otherwise it will overwrite `+ / -` differences and rank changes.

## Notes & Limitations

- Ban-date/reason scraping relies on parsing the banned subreddit's HTML page, which depends on Reddit's current markup and wording. If Reddit changes either, ban detection may need updating.
- There's currently no "stop and discard" control mid-run  only pause/resume. To fully abandon a run before it finishes, reload the page.
- The script only works on **old.reddit.com**, not the redesigned reddit.com interface.
