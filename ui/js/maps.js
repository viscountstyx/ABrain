/**
 * maps.js — Multi-map management.
 *
 * Maintains the list of known maps and which one is active.
 * Communicates with the Python backend via the bridge (window.pywebview.api).
 * Renders the left sidebar map list and handles create/rename/delete/switch.
 */

const Maps = (() => {
  let _maps = [];          // [{ id, name, createdAt, updatedAt }]
  let _activeMapId = null;
  let _onSwitchCallbacks = [];

  // ── Getters ──────────────────────────────────────────────────────────

  function getMaps()       { return _maps; }
  function getActiveId()   { return _activeMapId; }
  function getActiveMap()  { return _maps.find(m => m.id === _activeMapId) || null; }

  function getOtherMaps() {
    return _maps.filter(m => m.id !== _activeMapId);
  }

  // ── Initialise from loaded index ─────────────────────────────────────

  function init(indexData) {
    _maps = indexData.maps || [];
    _activeMapId = indexData.activeMapId || (_maps[0] ? _maps[0].id : null);
  }

  // ── Switch active map ────────────────────────────────────────────────

  async function switchMap(mapId) {
    if (mapId === _activeMapId) return;

    // Save current map before switching
    await Bridge.forceSave();

    _activeMapId = mapId;

    // Persist active map selection
    const index = await window.pywebview.api.load_maps();
    index.activeMapId = mapId;
    await window.pywebview.api.save_maps_index(index);

    // Load new map data
    const mapData = await window.pywebview.api.load_map(mapId);
    State.load(mapData);

    renderMapList();
    _onSwitchCallbacks.forEach(fn => fn(mapId));
  }

  // ── Create ───────────────────────────────────────────────────────────

  async function createMap(name) {
    const result = await window.pywebview.api.create_map(name);
    _maps.push(result.mapMeta);
    await switchMap(result.mapMeta.id);
    renderMapList();
    return result;
  }

  // ── Delete ───────────────────────────────────────────────────────────

  async function deleteMap(mapId) {
    if (_maps.length <= 1) {
      alert("You cannot delete the last map.");
      return;
    }
    const map = _maps.find(m => m.id === mapId);
    if (!confirm(`Delete map "${map ? map.name : mapId}"? This cannot be undone.`)) return;

    await window.pywebview.api.delete_map(mapId);
    _maps = _maps.filter(m => m.id !== mapId);

    if (_activeMapId === mapId) {
      const next = _maps[0];
      if (next) await switchMap(next.id);
    }
    renderMapList();
  }

  // ── Rename ───────────────────────────────────────────────────────────

  async function renameMap(mapId, newName) {
    if (!newName || !newName.trim()) return;
    newName = newName.trim();
    await window.pywebview.api.rename_map(mapId, newName);
    const m = _maps.find(m => m.id === mapId);
    if (m) m.name = newName;
    // Also update root node title in active state if this is the active map
    if (mapId === _activeMapId) {
      const rootId = State.getRootNodeId();
      if (rootId) State.updateNode(rootId, { title: newName });
    }
    renderMapList();
  }

  // ── Render map list sidebar ──────────────────────────────────────────

  function renderMapList() {
    const ul = document.getElementById("map-list");
    ul.innerHTML = "";

    _maps.forEach(map => {
      const li = document.createElement("li");
      li.dataset.mapId = map.id;
      if (map.id === _activeMapId) li.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.className = "map-name";
      nameSpan.textContent = map.name;

      // Double-click to rename
      nameSpan.addEventListener("dblclick", e => {
        e.stopPropagation();
        startRename(li, map.id, nameSpan);
      });

      const actions = document.createElement("div");
      actions.className = "map-actions";

      const renameBtn = document.createElement("button");
      renameBtn.className = "map-action-btn";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename";
      renameBtn.addEventListener("click", e => {
        e.stopPropagation();
        startRename(li, map.id, nameSpan);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "map-action-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.title = "Delete map";
      deleteBtn.addEventListener("click", e => {
        e.stopPropagation();
        deleteMap(map.id);
      });

      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(nameSpan);
      li.appendChild(actions);

      li.addEventListener("click", () => switchMap(map.id));
      ul.appendChild(li);
    });
  }

  function startRename(li, mapId, nameSpan) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = nameSpan.textContent;
    input.style.flex = "1";
    input.style.minWidth = "0";

    li.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim() || nameSpan.textContent;
      li.replaceChild(nameSpan, input);
      renameMap(mapId, newName);
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { li.replaceChild(nameSpan, input); }
    });
  }

  // ── Button wiring ────────────────────────────────────────────────────

  function _wireUI() {
    document.getElementById("btn-new-map").addEventListener("click", () => {
      const modal = document.getElementById("new-map-modal");
      const input = document.getElementById("new-map-name");
      input.value = "";
      modal.classList.remove("hidden");
      input.focus();
    });

    document.getElementById("btn-new-map-confirm").addEventListener("click", async () => {
      const input = document.getElementById("new-map-name");
      const name = input.value.trim();
      if (!name) return;
      document.getElementById("new-map-modal").classList.add("hidden");
      await createMap(name);
    });

    document.getElementById("new-map-name").addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("btn-new-map-confirm").click();
    });

    // Close modal buttons
    document.querySelectorAll("#new-map-modal .modal-close").forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("new-map-modal").classList.add("hidden");
      });
    });
  }

  // ── Callback registration ────────────────────────────────────────────

  function onSwitch(fn) {
    _onSwitchCallbacks.push(fn);
  }

  // ── Navigate to a specific node (for cross-map link clicks) ──────────

  async function navigateTo(mapId, nodeId) {
    if (mapId !== _activeMapId) {
      await switchMap(mapId);
    }
    // Give the render a tick to settle before selecting
    setTimeout(() => {
      State.selectNode(nodeId);
      MindMap.focusNode(nodeId);
    }, 200);
  }

  return {
    init,
    getMaps,
    getActiveId,
    getActiveMap,
    getOtherMaps,
    switchMap,
    createMap,
    deleteMap,
    renameMap,
    renderMapList,
    onSwitch,
    navigateTo,
    _wireUI,
  };
})();
