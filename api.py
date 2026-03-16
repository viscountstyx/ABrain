import json
import os
import subprocess
import tempfile
import time
import uuid
import webbrowser
import webview

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


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
