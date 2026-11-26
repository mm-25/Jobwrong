# Jobwrong development

This repository contains the public JobRight Local browser extension. Keep changes scoped to the requested task.

- Current development targets Chromium. Firefox/Zen work is paused; avoid rebuilding Firefox unless requested.
- Use `npm ci`, `npm run typecheck`, `npm test`, and `npm run build:chromium` for normal validation. Run relevant browser tests when UI behavior changes.
- New profiles must start blank. Never add inferred demographic, work-authorization, consent, or education facts. Preserve explicit saved and imported answers.
- Keep API keys, résumé files, profile exports, vault contents, browser profiles, and live application captures out of Git and logs. Tests must use synthetic identities and credentials.
- Never submit applications in automated tests. Real employer forms require explicit user authorization.
- Live Workday testing accepted repeated employment dates and both education records through Save and Continue. Version 0.8.8 questionnaire-country and numbered/native-select fixes have automated coverage; their installed Brave retest is pending. Passing synthetic tests does not establish complete platform compatibility.

## Layout

- `src/engine`: field discovery, matching, filling, and Undo.
- `src/services`: browser integration, storage, AI, and optional vault retrieval.
- `src/ui`, `public`: popup, profile page, and on-page controls.
- `native`, `scripts/install-native.mjs`: optional local Markdown helper.
- `tests`, `fixtures`: synthetic regression coverage.

Local research and development-session history are deliberately excluded from the public repository.
