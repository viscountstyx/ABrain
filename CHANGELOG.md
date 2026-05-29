# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
