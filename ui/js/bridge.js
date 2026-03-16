/**
 * bridge.js — Bootstraps the app and wires up auto-save.
 *
 * Responsibilities:
 *  1. Wait for pywebview to make window.pywebview.api available.
 *  2. Load the maps index and the last-active map from Python.
 *  3. Register a debounced auto-save subscriber on State.
 *  4. Wire up toolbar export buttons.
 *  5. Wire up keyboard shortcuts.
 */

const Bridge = (() => {
  let _saveTimer = null;
  const SAVE_DELAY_MS = 1200;

  // ── Auto-save ────────────────────────────────────────────────────────

  function _scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_doSave, SAVE_DELAY_MS);
  }

  async function _doSave() {
    const mapId = State.getMapId();
    if (!mapId) return;
    try {
      await window.pywebview.api.save_map(mapId, State.snapshot());
    } catch (e) {
      console.error("Auto-save failed:", e);
    }
  }

  async function forceSave() {
    clearTimeout(_saveTimer);
    await _doSave();
  }

  // ── Bootstrap ────────────────────────────────────────────────────────

  async function _bootstrap() {
    // Load maps index
    const index = await window.pywebview.api.load_maps();
    Maps.init(index);

    let activeId = index.activeMapId;

    if (index.maps.length === 0) {
      // First launch — create a default map
      const result = await window.pywebview.api.create_map("My Map");
      index.maps.push(result.mapMeta);
      activeId = result.mapMeta.id;
      Maps.init({ ...index, maps: index.maps, activeMapId: activeId });
      State.load(result.mapData);
    } else {
      if (!activeId || !index.maps.find(m => m.id === activeId)) {
        activeId = index.maps[0].id;
      }
      const mapData = await window.pywebview.api.load_map(activeId);
      State.load(mapData);
      // Sync active id into Maps
      Maps.init({ ...index, activeMapId: activeId });
    }

    Maps.renderMapList();
    Maps._wireUI();

    // Register auto-save on every state change
    State.subscribe(_scheduleSave);

    _wireExportButtons();
    _wireKeyboardShortcuts();
  }

  // ── Export buttons ────────────────────────────────────────────────────

  function _wireExportButtons() {
    document.getElementById("btn-export-json").addEventListener("click", async () => {
      const result = await window.pywebview.api.pick_save_path(
        `${State.getMapName() || "map"}.json`
      );
      if (!result.path) return;
      await window.pywebview.api.export_json(result.path, State.snapshot());
    });

    document.getElementById("btn-export-md").addEventListener("click", async () => {
      const result = await window.pywebview.api.pick_save_path(
        `${State.getMapName() || "map"}.md`
      );
      if (!result.path) return;
      await window.pywebview.api.export_markdown(result.path, State.snapshot());
    });
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────

  function _wireKeyboardShortcuts() {
    document.addEventListener("keydown", async e => {
      const tag = document.activeElement ? document.activeElement.tagName : "";
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);

      // Ctrl+S — force save
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        await forceSave();
        return;
      }

      // Ctrl+F — focus search
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        document.getElementById("search-input").focus();
        return;
      }

      // Ctrl+N — add child to selected node (or child of root)
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        const parentId = State.getSelectedId() || State.getRootNodeId();
        if (parentId) {
          const newId = State.addNode(parentId, "New thought");
          setTimeout(() => Detail.focusTitleInput(), 30);
        }
        return;
      }

      if (inInput) return; // don't intercept typing in fields

      // Escape — deselect
      if (e.key === "Escape") {
        State.deselectNode();
        ContextMenu.hide();
        return;
      }

      // Delete — remove selected node
      if (e.key === "Delete") {
        const node = State.getSelectedNode();
        if (!node) return;
        if (node.id === State.getRootNodeId()) return;
        const hasChildren = node.childIds && node.childIds.length > 0;
        if (hasChildren) {
          if (!confirm(`Delete "${node.title}" and all its children?`)) return;
        }
        State.deleteNode(node.id);
        return;
      }
    });
  }

  // ── Entry point ───────────────────────────────────────────────────────

  function init() {
    // pywebview injects window.pywebview after the DOM loads.
    // We poll briefly until it's ready then bootstrap.
    function waitForApi(retries) {
      if (window.pywebview && window.pywebview.api) {
        _bootstrap().catch(err => {
          console.error("Bootstrap error:", err);
          document.body.innerHTML = `<div style="padding:40px;color:#f38ba8;font-family:monospace">
            <h2>Failed to initialise</h2><pre>${err}</pre></div>`;
        });
      } else if (retries > 0) {
        setTimeout(() => waitForApi(retries - 1), 100);
      } else {
        console.error("pywebview.api not available after waiting.");
      }
    }
    waitForApi(50);
  }

  return { init, forceSave };
})();

// ── Context menu singleton (used across modules) ──────────────────────

const ContextMenu = (() => {
  const el = document.getElementById("context-menu");

  function show(x, y, nodeId) {
    State.selectNode(nodeId);
    el.style.left = x + "px";
    el.style.top  = y + "px";
    el.classList.remove("hidden");

    // Prevent context menu going off-screen
    const rect = el.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  el.style.left = (x - rect.width)  + "px";
    if (rect.bottom > window.innerHeight) el.style.top  = (y - rect.height) + "px";
  }

  function hide() {
    el.classList.add("hidden");
  }

  // Wire items
  document.getElementById("ctx-add-child").addEventListener("click", () => {
    const id = State.getSelectedId();
    if (id) { State.addNode(id, "New thought"); setTimeout(() => Detail.focusTitleInput(), 30); }
    hide();
  });

  document.getElementById("ctx-add-sibling").addEventListener("click", () => {
    const node = State.getSelectedNode();
    if (node && node.parentId) { State.addNode(node.parentId, "New thought"); setTimeout(() => Detail.focusTitleInput(), 30); }
    hide();
  });

  document.getElementById("ctx-delete").addEventListener("click", () => {
    const node = State.getSelectedNode();
    if (!node || node.id === State.getRootNodeId()) { hide(); return; }
    const hasChildren = node.childIds && node.childIds.length > 0;
    if (!hasChildren || confirm(`Delete "${node.title}" and all its children?`)) {
      State.deleteNode(node.id);
    }
    hide();
  });

  document.getElementById("ctx-add-crosslink").addEventListener("click", () => {
    hide();
    Detail.openCrossLinkModal(State.getSelectedId());
  });

  // Dismiss on click outside
  document.addEventListener("click", e => {
    if (!el.contains(e.target)) hide();
  });
  document.addEventListener("contextmenu", () => hide());

  return { show, hide };
})();

// ── Start ─────────────────────────────────────────────────────────────
window.addEventListener("load", () => Bridge.init());
