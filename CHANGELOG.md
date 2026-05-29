# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.2] - 2026-05-29

### Fixed
- Recurring todos no longer spawn a checkable duplicate immediately — the next occurrence is hidden until its due date arrives (tomorrow for daily, next week for weekly, etc.)
- Recurring todos now appear in the agenda under their due date (Today, Tomorrow, etc.) instead of being absent

## [1.1.1] - 2026-05-29

### Fixed
- Todo "Add a task…" input was too narrow — recurrence select now has a fixed compact width so the text field fills the remaining space

## [1.1.0] - 2026-05-29

### Added
- Custom node fill colours now render on the mind map (priority ring stroke is preserved)
- Keyboard shortcut help modal — press `?` anywhere on the canvas to open it
- Overdue nodes show a dashed red ring on the mind map
- Agenda: "Overdue" group pinned to the top for past-due items
- Agenda: recurring badge shown next to repeating todo items
- Duplicate node — right-click any node and choose "Duplicate" to create a sibling copy
- Jira and Calendar sidebar headers show a "last synced X min ago" timestamp; a ⚠ badge appears on fetch failure
- Settings Data tab auto-runs the broken-link scan on open and shows a count next to the section title
- Broken cross-map links in the detail panel are highlighted in red with a descriptive reason

### Changed
- Calendar lookahead window is now configurable in Settings → Integrations (7 / 14 / 30 / 60 days; default 7)

## [1.0.3] - 2026-05-29

### Fixed
- Resolved tasks with a due date no longer appear in the agenda

## [1.0.2] - 2026-05-29

### Added
- Jira "＋ map" button now opens a searchable parent-node picker instead of silently attaching to the selected or root node
- "Move to…" option in the right-click context menu to reparent any existing node via the same node picker (node and its descendants are excluded to prevent cycles)
- Node picker modal: indented tree view of all map nodes, live search filter, keyboard-friendly confirm/cancel

### Changed
- Mind map node circles now show a priority ring (high = red, medium = amber, low = blue stroke) so priority is visible without opening the detail panel
- Agenda panel priority badges are now coloured spans rather than plain text, matching the node priority colour scheme
- Settings save now immediately re-renders the mind map so visual changes take effect without a manual refresh
- Hard-coded `12px` font sizes converted to `0.857rem` so the UI respects system font-size preferences

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
