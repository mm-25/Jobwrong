# Jobwrong

A personal job-application autofill extension. It appears in your browser as **JobRight Local** and uses your saved profile, résumé, and answers, with optional Claude support.

**Status:** Chromium build 0.8.3. Chrome, Brave, and Edge are the current targets. Workday dates and some education fields still need manual entry. Firefox/Zen development is paused.

## Install on your device

Install Git and Node.js 22 or newer (including npm), then run:

```sh
git clone https://github.com/mm-25/Jobwrong.git
cd Jobwrong
npm ci
npm run build:chromium
```

1. Open `chrome://extensions`, `brave://extensions`, or `edge://extensions`.
2. Enable **Developer mode** and click **Load unpacked**.
3. Select the `dist/chromium` folder inside your cloned repository.
4. Pin **JobRight Local**, open it, and choose **Profile**.

Keep the repository folder on your device; the browser loads the extension from there. A private repository requires signing in to a GitHub account with access before cloning.

## Set up and use

1. Add your contact details, employment, education, skills, and résumé, then **Save profile**. Résumés must be PDF, DOC, or DOCX and no larger than 2 MiB. Enter skills separately; uploading a résumé does not extract them.
2. Review **Application defaults** before using Autofill. New profiles start blank. Enter your own work authorization, sponsorship, demographics, and privacy acknowledgment preferences; leave anything unknown unanswered.
3. Open a job application and click **Autofill** in the toolbar popup or corner panel.
4. Review every answer. Click a question in the remaining-fields list to jump to it, or use **Undo last fill**. Run Autofill again on each new application step.

The extension never submits applications. Existing answers are preserved by default, and unsupported or uncertain fields may need manual entry.

**Optional AI:** In **Profile → AI settings**, select Claude, enter your own API key, enable AI, and save. Profile-based filling works without AI. Obsidian integration requires a separate [local helper setup](docs/obsidian-autofill.md) on each device; it is not required for basic Autofill.

## Move your profile to another device

On your current device, open **Profile → Export JSON**. Transfer that JSON file privately, then use **Import JSON** on the new device and click **Save profile**. The export includes your saved profile and attached résumé; AI settings and API keys must be entered separately. Do not commit the export to GitHub.

## Update

```sh
git pull --ff-only
npm ci
npm run build:chromium
```

Click **Reload** for JobRight Local in your browser's Extensions page, then refresh application pages after preserving any unsaved work. Keep the extension installed to retain its local profile.

## Development

```sh
npm run typecheck
npm test
```

Build output, dependencies, personal exports, local setup, and research captures are excluded from Git. Saved browser data does not sync through this repository.
