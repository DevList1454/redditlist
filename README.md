# Subreddit Info Scraper

A Tampermonkey userscript designed to check the status of subreddits directly from `old.reddit.com`. It processes a list of subreddits, determines their active status, subscriber counts, and descriptions, and extracts the exact ban dates for banned subreddits, outputting everything into a neat CSV file.

## Features

* **Bulk Processing:** Upload a `.txt` file containing a list of subreddits (one per line) to process hundreds or communities in a single run.
* **Ban Date Extraction:** Automatically to scrape the HTML frontend to extract the exact `datetime` a subreddit was banned.
* **Pause & Resume:** Pause the scraper at any time and resume right where you left off without losing your current progress.
* **Intelligent Rate Limiting (429):** Automatically detects Reddit's `429 Too Many Requests` errors, pauses execution, re-attempts
* **Integrated UI:** Features a clean, floating GUI injected directly into the page with a real-time log, ETA calculations, and visual color-coded feedback.
* **CSV Export:** Generates and downloads a `.csv` file upon completion containing all scraped data.

---

## Prerequisites

To use this script, you will need a userscript manager installed in your browser.

* **Chrome/Edge/Brave:** Install [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* **Firefox:** Install [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

---

## Installation

1. Go to https://github.com/DevList1454/redditlist/raw/refs/heads/main/infoscraper.user.js
2. Click **Install**.
3. Go to old.reddit.com
4. Button "scraper" appears in top bar to open UI

---

## Usage Guide

### Prepare Your Input File
Create a plain text file (`.txt`) containing the names of the subreddits you want to check. Place exactly **one subreddit name per line** without the `r/` prefix.

**Example `list.txt`:**
```text
AskReddit
technology
somebannedsubreddit
pics
