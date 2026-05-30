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

| Distro | Packages |
|--------|----------|
| Debian / Ubuntu | `python3` `python3-venv` `python3-pip` `libgl1` |
| Arch / Manjaro | `python` (includes venv and pip) |

## Installation

### Option A — Download a release (easiest)

Download the latest `.deb` from the [Releases](../../releases/latest) page, then:

```bash
sudo dpkg -i abrain_*.deb
sudo apt-get install -f   # resolve any missing system dependencies
```

### Option B — Build the Debian package locally

```bash
./build-deb.sh
sudo dpkg -i abrain_*.deb
sudo apt-get install -f
```

The package installs to `/opt/abrain/`, creates a Python virtualenv there, pip-installs all dependencies, and registers the app in the system application menu.

To uninstall:

```bash
sudo dpkg -r abrain
```

### Option C — Run from source (all distros, including Arch)

```bash
./install.sh
```

`install.sh` will:
1. Create a Python virtualenv at `.venv` (if not already present)
2. Install all Python dependencies from `requirements.txt`
3. Register the app in the system application launcher

The only prerequisite is `python3`. On Arch-based systems:

```bash
sudo pacman -S python   # if not already installed
./install.sh
```

To launch without using the app menu:

```bash
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

## Releasing a new version

1. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`
2. Update the `VERSION` file
3. Commit both files
4. Push a tag — GitHub Actions builds the `.deb` and publishes it as a release:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The release body is populated automatically from the matching `CHANGELOG.md` section.

## Integrations

Configure via the Settings panel inside the app.

**Jira** — enter your Jira base URL and a personal access token; ABrain fetches issues assigned to you.

**Google Calendar** — enter an ICS URL (from Google Calendar sharing settings); ABrain fetches upcoming events and expands recurring entries.
