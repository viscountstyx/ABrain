# ABrain

A mind-mapping and note-taking desktop application built on PyWebView and Qt6, with native KDE Plasma integration.

## Features

- Interactive D3.js mind maps with zoom, pan, and drag
- Multiple maps with cross-map node linking
- Node metadata: status, priority, due dates, tags, notes, attachments
- Todo list with daily/weekly/monthly recurrence
- Jira integration: fetch your assigned issues
- Google Calendar integration: fetch events from an ICS URL
- Export to JSON, Markdown, and PNG
- Search and filter across nodes
- Native KDE Plasma launcher entry

## Requirements

- Python 3.10+
- KDE Plasma (Qt6 backend required)

Python dependencies (installed automatically via pip):

```
pywebview[qt]
PySide6
icalendar
recurring-ical-events
```

System packages required at runtime:

```
python3  python3-venv  python3-pip  libgl1
```

## Installation

### Option A — Debian package (recommended)

Build and install a `.deb` that handles everything including the KDE launcher entry:

```bash
./build-deb.sh
sudo dpkg -i abrain_1.0.0_amd64.deb
sudo apt-get install -f   # resolve any missing system dependencies
```

The package installs to `/opt/abrain/`, creates a Python virtualenv there, pip-installs all dependencies, and registers the app in the system application menu.

To uninstall:

```bash
sudo dpkg -r abrain
```

### Option B — Run from source

```bash
python3 -m venv .venv
.venv/bin/pip install pywebview[qt] PySide6 icalendar recurring-ical-events
./install.sh        # registers the KDE launcher entry
.venv/bin/python main.py
```

To remove the launcher entry:

```bash
./install.sh --uninstall
```

## Data storage

All user data is stored in `~/.local/share/abrain/`:

| File | Contents |
|------|----------|
| `maps.json` | Map index |
| `{mapId}.json` | Individual map data |
| `tasks.json` | Todo list |
| `config.json` | Integration credentials (mode 0600) |

## Integrations

Configure via the Settings panel inside the app.

**Jira** — enter your Jira base URL and a personal access token; ABrain fetches issues assigned to you.

**Google Calendar** — enter an ICS URL (from Google Calendar sharing settings); ABrain fetches upcoming events and expands recurring entries.
