import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import webbrowser
import webview
from datetime import datetime, timezone, timedelta

try:
    from icalendar import Calendar as ICalendar
    import recurring_ical_events
    _ICAL_AVAILABLE = True
except ImportError:
    _ICAL_AVAILABLE = False

SCHEMA_VERSION = 1


def _atomic_write(path: str, data: dict) -> None:
    """Write JSON atomically: write to a temp file then rename."""
    dir_ = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _migrate_map(data: dict) -> dict:
    """Apply any schema migrations needed to bring data up to current version."""
    version = data.get("schemaVersion", 0)
    # Future migrations go here as: if version < N: ...
    data["schemaVersion"] = SCHEMA_VERSION
    return data


def _migrate_index(data: dict) -> dict:
    version = data.get("schemaVersion", 0)
    data["schemaVersion"] = SCHEMA_VERSION
    return data


class Api:
    def __init__(self, data_dir: str):
        self._data_dir = data_dir
        self._index_path = os.path.join(data_dir, "maps.json")
        self._tasks_path = os.path.join(data_dir, "tasks.json")
        self._config_path = os.path.join(data_dir, "config.json")
        self._window = None

    def set_window(self, window) -> None:
        self._window = window

    # ------------------------------------------------------------------
    # Map index
    # ------------------------------------------------------------------

    def load_maps(self) -> dict:
        """Return the maps index. Creates a default index if none exists."""
        if not os.path.exists(self._index_path):
            default = {
                "schemaVersion": SCHEMA_VERSION,
                "maps": [],
                "activeMapId": None,
            }
            _atomic_write(self._index_path, default)
            return default
        with open(self._index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return _migrate_index(data)

    def save_maps_index(self, data: dict) -> dict:
        _atomic_write(self._index_path, data)
        return {"ok": True}

    def create_map(self, name: str) -> dict:
        """Create a new empty map, update the index, return {mapMeta, mapData}."""
        map_id = str(uuid.uuid4())
        now = _now()
        root_id = str(uuid.uuid4())

        map_data = {
            "schemaVersion": SCHEMA_VERSION,
            "mapId": map_id,
            "mapName": name,
            "rootNodeId": root_id,
            "nodes": {
                root_id: {
                    "id": root_id,
                    "title": name,
                    "parentId": None,
                    "childIds": [],
                    "status": None,
                    "notes": "",
                    "tags": [],
                    "dueDate": None,
                    "priority": None,
                    "attachments": [],
                    "crossMapLinks": [],
                    "createdAt": now,
                    "updatedAt": now,
                }
            },
        }
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        _atomic_write(map_path, map_data)

        # Update index
        index = self.load_maps()
        map_meta = {"id": map_id, "name": name, "createdAt": now, "updatedAt": now}
        index["maps"].append(map_meta)
        _atomic_write(self._index_path, index)

        return {"mapMeta": map_meta, "mapData": map_data}

    def delete_map(self, map_id: str) -> dict:
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        if os.path.exists(map_path):
            os.unlink(map_path)
        index = self.load_maps()
        index["maps"] = [m for m in index["maps"] if m["id"] != map_id]
        if index.get("activeMapId") == map_id:
            index["activeMapId"] = index["maps"][0]["id"] if index["maps"] else None
        _atomic_write(self._index_path, index)
        return {"ok": True}

    def rename_map(self, map_id: str, name: str) -> dict:
        # Update index entry
        index = self.load_maps()
        for m in index["maps"]:
            if m["id"] == map_id:
                m["name"] = name
                m["updatedAt"] = _now()
                break
        _atomic_write(self._index_path, index)

        # Update map file header
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        if os.path.exists(map_path):
            with open(map_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["mapName"] = name
            _atomic_write(map_path, data)

        return {"ok": True}

    # ------------------------------------------------------------------
    # Map data
    # ------------------------------------------------------------------

    def load_map(self, map_id: str) -> dict:
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        if not os.path.exists(map_path):
            return {"error": "Map not found"}
        with open(map_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return _migrate_map(data)

    def save_map(self, map_id: str, data: dict) -> dict:
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        _atomic_write(map_path, data)
        # Touch updatedAt in index
        index = self.load_maps()
        for m in index["maps"]:
            if m["id"] == map_id:
                m["updatedAt"] = _now()
                break
        _atomic_write(self._index_path, index)
        return {"ok": True}

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def export_png(self, path: str, png_b64: str) -> dict:
        png_bytes = base64.b64decode(png_b64)
        with open(path, "wb") as f:
            f.write(png_bytes)
        return {"ok": True}

    def export_json(self, path: str, data: dict) -> dict:
        _atomic_write(path, data)
        return {"ok": True}

    def export_markdown(self, path: str, data: dict) -> dict:
        nodes = data.get("nodes", {})
        root_id = data.get("rootNodeId")
        lines = []

        def walk(node_id: str, depth: int):
            node = nodes.get(node_id)
            if not node:
                return
            prefix = "#" * min(depth + 1, 6) if depth == 0 else "  " * (depth - 1) + "-"
            status_str = f" `{node['status']}`" if node.get("status") else ""
            lines.append(f"{prefix} {node['title']}{status_str}")
            if node.get("notes"):
                for note_line in node["notes"].splitlines():
                    lines.append(f"{'  ' * depth}  {note_line}")
            for child_id in node.get("childIds", []):
                walk(child_id, depth + 1)

        walk(root_id, 0)
        content = "\n".join(lines) + "\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"ok": True}

    # ------------------------------------------------------------------
    # File / URL helpers
    # ------------------------------------------------------------------

    def open_url(self, url: str) -> dict:
        # Only open http/https URLs to prevent arbitrary command execution
        if url.startswith("http://") or url.startswith("https://"):
            webbrowser.open(url)
            return {"ok": True}
        return {"error": "Only http/https URLs are supported"}

    def open_file(self, path: str) -> dict:
        # Resolve and validate path is absolute and exists
        real = os.path.realpath(path)
        if not os.path.exists(real):
            return {"error": "File not found"}
        subprocess.Popen(["xdg-open", real])
        return {"ok": True}

    def pick_file(self) -> dict:
        """Open a native file picker via the pywebview window and return the chosen path."""
        if self._window is None:
            return {"error": "No window"}
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
        )
        if result:
            return {"path": result[0]}
        return {"path": None}

    def pick_save_path(self, default_name: str = "export") -> dict:
        if self._window is None:
            return {"error": "No window"}
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=default_name,
        )
        if result:
            # pywebview SAVE_DIALOG returns a string on Qt
            path = result[0] if isinstance(result, (list, tuple)) else result
            return {"path": path}
        return {"path": None}

    def get_node_title(self, map_id: str, node_id: str) -> dict:
        """Look up a node title in another map — used for cross-map link display."""
        map_path = os.path.join(self._data_dir, f"{map_id}.json")
        if not os.path.exists(map_path):
            return {"title": None}
        with open(map_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        node = data.get("nodes", {}).get(node_id)
        return {"title": node["title"] if node else None}

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def load_tasks(self) -> dict:
        if not os.path.exists(self._tasks_path):
            default = {"schemaVersion": SCHEMA_VERSION, "tasks": [], "order": []}
            _atomic_write(self._tasks_path, default)
            return default
        with open(self._tasks_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def add_task(self, title: str, recurrence: str = "none") -> dict:
        title = title.strip()
        if not title:
            return {"error": "Title is required"}
        data = self.load_tasks()
        task = {
            "id": str(uuid.uuid4()),
            "title": title,
            "done": False,
            "recurrence": recurrence if recurrence in ("daily", "weekly", "monthly") else "none",
            "createdAt": _now(),
        }
        data["tasks"].append(task)
        data["order"].append(task["id"])
        _atomic_write(self._tasks_path, data)
        return task

    def delete_task(self, task_id: str) -> dict:
        data = self.load_tasks()
        data["tasks"] = [t for t in data["tasks"] if t["id"] != task_id]
        data["order"] = [i for i in data["order"] if i != task_id]
        _atomic_write(self._tasks_path, data)
        return {"ok": True}

    def toggle_task(self, task_id: str) -> dict:
        data = self.load_tasks()
        new_task = None
        for task in data["tasks"]:
            if task["id"] == task_id:
                task["done"] = not task["done"]
                # If marking done and task recurs, spawn next occurrence
                if task["done"] and task.get("recurrence", "none") != "none":
                    from datetime import date, timedelta as td
                    delta = {"daily": td(days=1), "weekly": td(weeks=1), "monthly": td(days=30)}
                    d = delta.get(task["recurrence"])
                    if d:
                        new_task = {
                            "id": str(uuid.uuid4()),
                            "title": task["title"],
                            "done": False,
                            "recurrence": task["recurrence"],
                            "createdAt": _now(),
                        }
                break
        if new_task:
            data["tasks"].append(new_task)
            data["order"].append(new_task["id"])
        _atomic_write(self._tasks_path, data)
        return {"ok": True, "newTask": new_task}

    def save_task_order(self, order: list) -> dict:
        data = self.load_tasks()
        data["order"] = order
        _atomic_write(self._tasks_path, data)
        return {"ok": True}

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    def load_config(self) -> dict:
        if not os.path.exists(self._config_path):
            return {
                "firstRun": True,
                "jira": {"url": "", "username": "", "token": ""},
                "calendar": {"icsUrl": "", "email": ""},
            }
        with open(self._config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_config(self, data: dict) -> dict:
        dir_ = os.path.dirname(self._config_path)
        fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self._config_path)
            os.chmod(self._config_path, 0o600)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return {"ok": True}

    # ------------------------------------------------------------------
    # Connection tests (used by onboarding wizard)
    # ------------------------------------------------------------------

    def test_jira_connection(self, url: str, username: str, token: str) -> dict:
        url = url.rstrip("/")
        if not (url and username and token):
            return {"ok": False, "error": "All fields are required"}
        jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY priority ASC, created DESC"
        api_url = f"{url}/rest/api/2/search?jql={urllib.request.quote(jql)}&fields=summary&maxResults=1"
        req = urllib.request.Request(api_url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            count = data.get("total", 0)
            label = "issue" if count == 1 else "issues"
            return {"ok": True, "message": f"Connected. {count} open {label} assigned to you."}
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {"ok": False, "error": "Authentication failed. Check your username and token."}
            if e.code == 403:
                return {"ok": False, "error": "Access denied. Check your token permissions."}
            return {"ok": False, "error": f"HTTP {e.code}: {e.reason}"}
        except urllib.error.URLError as e:
            return {"ok": False, "error": f"Connection failed: {e.reason}"}

    def test_calendar_connection(self, ics_url: str) -> dict:
        if not ics_url:
            return {"ok": False, "error": "ICS URL is required"}
        if not _ICAL_AVAILABLE:
            return {"ok": False, "error": "icalendar library not installed"}
        try:
            req = urllib.request.Request(ics_url, headers={"User-Agent": "ABrain/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read()
            cal = ICalendar.from_ical(raw)
            count = sum(1 for c in cal.walk() if c.name == "VEVENT")
            label = "event" if count == 1 else "events"
            return {"ok": True, "message": f"Calendar loaded. {count} {label} found."}
        except urllib.error.URLError as e:
            return {"ok": False, "error": f"Connection failed: {e.reason}"}
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse calendar: {e}"}

    # ------------------------------------------------------------------
    # Jira
    # ------------------------------------------------------------------

    def fetch_jira_issues(self) -> dict:
        cfg = self.load_config().get("jira", {})
        url = cfg.get("url", "").rstrip("/")
        username = cfg.get("username", "")
        token = cfg.get("token", "")
        if not (url and username and token):
            return {"issues": [], "error": "Jira not configured"}

        jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY priority ASC, created DESC"
        fields = "summary,status,priority,issuetype"
        api_url = f"{url}/rest/api/2/search?jql={urllib.request.quote(jql)}&fields={fields}&maxResults=50"

        req = urllib.request.Request(api_url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.URLError as e:
            return {"issues": [], "error": str(e)}

        issues = []
        for item in data.get("issues", []):
            f = item.get("fields", {})
            issues.append({
                "key": item["key"],
                "summary": f.get("summary", ""),
                "status": f.get("status", {}).get("name", ""),
                "priority": f.get("priority", {}).get("name", "") if f.get("priority") else "",
                "issueType": f.get("issuetype", {}).get("name", "") if f.get("issuetype") else "",
                "url": f"{url}/browse/{item['key']}",
            })
        return {"issues": issues}

    # ------------------------------------------------------------------
    # Calendar
    # ------------------------------------------------------------------

    def fetch_calendar_events(self) -> dict:
        cfg = self.load_config().get("calendar", {})
        ics_url = cfg.get("icsUrl", "")
        if not ics_url:
            return {"events": [], "error": "Calendar not configured"}
        if not _ICAL_AVAILABLE:
            return {"events": [], "error": "icalendar library not installed"}

        try:
            req = urllib.request.Request(ics_url, headers={"User-Agent": "ABrain/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read()
        except urllib.error.URLError as e:
            return {"events": [], "error": str(e)}

        cal = ICalendar.from_ical(raw)
        now = datetime.now(timezone.utc)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        lookahead = int(cfg.get("lookaheadDays", 7))
        window_end = day_start + timedelta(days=lookahead)

        # recurring_ical_events expands RRULE/RDATE/EXDATE into individual occurrences
        occurrences = recurring_ical_events.of(cal).between(day_start, window_end)

        events = []
        for component in occurrences:
            dtstart = component.get("DTSTART")
            if not dtstart:
                continue
            start = dtstart.dt
            if not hasattr(start, "tzinfo"):
                start_dt = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
                all_day = True
            else:
                start_dt = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
                all_day = False

            dtend = component.get("DTEND")
            end_dt = None
            if dtend:
                end = dtend.dt
                if not hasattr(end, "tzinfo"):
                    end_dt = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
                else:
                    end_dt = end if end.tzinfo else end.replace(tzinfo=timezone.utc)

            # Detect declined events via PARTSTAT=DECLINED on any ATTENDEE
            declined = False
            attendees = component.get("ATTENDEE", [])
            if not isinstance(attendees, list):
                attendees = [attendees] if attendees else []
            for attendee in attendees:
                if getattr(attendee, "params", {}).get("PARTSTAT") == "DECLINED":
                    declined = True
                    break

            # Use uid+start as a unique key so recurring instances don't collide
            uid = str(component.get("UID", "")) + "@" + start_dt.isoformat()

            events.append({
                "uid": uid,
                "summary": str(component.get("SUMMARY", "")),
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat() if end_dt else None,
                "allDay": all_day,
                "location": str(component.get("LOCATION", "")) or "",
                "declined": declined,
            })

        events.sort(key=lambda e: e["start"])
        return {"events": events}


    def get_old_maps(self, days: int) -> dict:
        """Return maps not updated within the last `days` days, excluding the active map."""
        index = self.load_maps()
        active_id = index.get("activeMapId")
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(days))
        cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

        old_maps = []
        for m in index["maps"]:
            if m["id"] == active_id:
                continue
            updated = m.get("updatedAt") or m.get("createdAt", "")
            if updated and updated >= cutoff_str:
                continue  # recently updated — skip
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            node_count = 0
            if os.path.exists(map_path):
                with open(map_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                node_count = len(data.get("nodes", {}))
            old_maps.append({
                "id":        m["id"],
                "name":      m["name"],
                "nodeCount": node_count,
                "updatedAt": updated,
                "createdAt": m.get("createdAt", ""),
            })
        return {"maps": old_maps}

    def get_map_stats(self) -> dict:
        """Return node counts and metadata for all maps in the index."""
        index = self.load_maps()
        stats = []
        for m in index["maps"]:
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            node_count = 0
            if os.path.exists(map_path):
                with open(map_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                node_count = len(data.get("nodes", {}))
            stats.append({
                "id": m["id"],
                "name": m["name"],
                "nodeCount": node_count,
                "createdAt": m.get("createdAt", ""),
                "updatedAt": m.get("updatedAt", ""),
            })
        return {"maps": stats}

    def scan_broken_links(self) -> dict:
        """Scan all maps for cross-map links pointing to non-existent maps or nodes."""
        index = self.load_maps()
        known_map_ids = {m["id"] for m in index["maps"]}
        map_name_by_id = {m["id"]: m["name"] for m in index["maps"]}

        # Pre-load node IDs for all existing maps
        valid_nodes: dict[str, set] = {}
        for m in index["maps"]:
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            if os.path.exists(map_path):
                with open(map_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                valid_nodes[m["id"]] = set(data.get("nodes", {}).keys())

        broken = []
        for m in index["maps"]:
            if m["id"] not in valid_nodes:
                continue
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            with open(map_path, "r", encoding="utf-8") as f:
                map_data = json.load(f)
            for node in map_data.get("nodes", {}).values():
                for link in node.get("crossMapLinks", []):
                    tid_map = link.get("mapId", "")
                    tid_node = link.get("nodeId", "")
                    if tid_map not in known_map_ids:
                        broken.append({
                            "sourceMapId": m["id"],
                            "sourceMapName": m["name"],
                            "sourceNodeId": node["id"],
                            "sourceNodeTitle": node.get("title", ""),
                            "targetMapId": tid_map,
                            "targetMapName": None,
                            "targetNodeId": tid_node,
                            "reason": "map_missing",
                        })
                    elif tid_node not in valid_nodes.get(tid_map, set()):
                        broken.append({
                            "sourceMapId": m["id"],
                            "sourceMapName": m["name"],
                            "sourceNodeId": node["id"],
                            "sourceNodeTitle": node.get("title", ""),
                            "targetMapId": tid_map,
                            "targetMapName": map_name_by_id.get(tid_map),
                            "targetNodeId": tid_node,
                            "reason": "node_missing",
                        })
        return {"broken": broken}

    def fix_broken_links(self) -> dict:
        """Remove all broken cross-map links from every map file."""
        index = self.load_maps()
        known_map_ids = {m["id"] for m in index["maps"]}

        valid_nodes: dict[str, set] = {}
        for m in index["maps"]:
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            if os.path.exists(map_path):
                with open(map_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                valid_nodes[m["id"]] = set(data.get("nodes", {}).keys())

        fixed = 0
        for m in index["maps"]:
            if m["id"] not in valid_nodes:
                continue
            map_path = os.path.join(self._data_dir, f"{m['id']}.json")
            with open(map_path, "r", encoding="utf-8") as f:
                map_data = json.load(f)
            changed = False
            for node in map_data.get("nodes", {}).values():
                original = list(node.get("crossMapLinks", []))
                filtered = [
                    lnk for lnk in original
                    if lnk.get("mapId") in valid_nodes
                    and lnk.get("nodeId") in valid_nodes[lnk["mapId"]]
                ]
                if len(filtered) != len(original):
                    fixed += len(original) - len(filtered)
                    node["crossMapLinks"] = filtered
                    changed = True
            if changed:
                _atomic_write(map_path, map_data)

        return {"fixed": fixed}

    def open_data_dir(self) -> dict:
        subprocess.Popen(["xdg-open", self._data_dir])
        return {"ok": True}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
