# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.1] - 2026-05-29

### Added
- First-run onboarding wizard: four-step setup guide (Welcome → Jira → Calendar → Done) with live connection testing for both integrations

### Fixed
- GitHub Actions release workflow now has `permissions: contents: write` so the `.deb` is correctly attached to releases instead of only source tarballs appearing
- Debian package now declares all required Qt6 runtime dependencies (`libegl1`, `libxkbcommon0`, `libdbus-1-3`) and enforces `python3 (>= 3.9)` to prevent silent install failures on Ubuntu 20.04 and older
- `.claude/` directory excluded from version control via `.gitignore`

## [1.0.0] - 2026-05-29

### Added
- Interactive D3.js mind maps with zoom, pan, and drag
- Multi-map support with cross-map node linking
- Node metadata: status, priority, due dates, tags, notes, attachments
- Todo list with daily/weekly/monthly recurrence
- Jira integration: fetch assigned issues via personal access token
- Google Calendar integration: fetch events from an ICS URL
- Export to JSON, Markdown, and PNG
- Search and filter across nodes
- Settings panel with interface, data, and integration tabs
- KDE Plasma launcher integration via `.desktop` entry
- Debian package build script (`build-deb.sh`) and `debian/` directory
- GitHub Actions workflow: builds `.deb` on every push, publishes to release on version tag
