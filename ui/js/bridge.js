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

  // ── Auto-save ────────────────────────────────────────────────────────

  function _scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_doSave, Settings.getAutosaveDelay());
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

    // Load saved UI config and apply before anything renders
    try {
      const cfg = await window.pywebview.api.load_config();
      Settings.applyUiSettings(cfg.ui || {});
      if (cfg.firstRun) Onboarding.show();
    } catch (_) { /* non-fatal — use defaults */ }

    // Register auto-save on every state change
    State.subscribe(_scheduleSave);

    Tasks.init().catch(err => console.error("Tasks init failed:", err));
    Agenda.init();
    Resizer.init();
    Settings.init();

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

    document.getElementById("btn-export-png").addEventListener("click", async () => {
      const result = await window.pywebview.api.pick_save_path(
        `${State.getMapName() || "map"}.png`
      );
      if (!result.path) return;
      const svg = document.getElementById("mindmap-svg");
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement("canvas");
      const rect = svg.getBoundingClientRect();
      canvas.width  = rect.width  || 1200;
      canvas.height = rect.height || 800;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg-base").trim() || "#1e1e2e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const img = new Image();
      img.onload = async () => {
        ctx.drawImage(img, 0, 0);
        const dataUrl  = canvas.toDataURL("image/png");
        const b64      = dataUrl.split(",")[1];
        await window.pywebview.api.export_png(result.path, b64);
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
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
          const newId = State.addNode(parentId, Settings.getDefaultNodeText());
          Detail.open(newId);
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
        if (Settings.getConfirmDelete() && hasChildren) {
          if (!confirm(`Delete "${node.title}" and all its children?`)) return;
        }
        State.deleteNode(node.id);
        return;
      }

      // Enter — open detail for selected node
      if (e.key === "Enter") {
        const sel = State.getSelectedId();
        if (sel) { Detail.open(sel); setTimeout(() => Detail.focusTitleInput(), 30); }
        return;
      }

      // Arrow keys — navigate the tree
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const node = State.getSelectedNode();
        if (!node) {
          // Nothing selected — select root
          const rootId = State.getRootNodeId();
          if (rootId) { State.selectNode(rootId); MindMap.focusNode(rootId); }
          return;
        }
        const allNodes = State.getAllNodes();
        let targetId = null;
        if (e.key === "ArrowLeft") {
          // Move to parent
          targetId = node.parentId || null;
        } else if (e.key === "ArrowRight") {
          // Move to first child
          targetId = (node.childIds && node.childIds[0]) || null;
        } else {
          // Up/Down — move to prev/next sibling
          const parent = node.parentId ? allNodes[node.parentId] : null;
          const siblings = parent ? parent.childIds : [];
          const idx = siblings.indexOf(node.id);
          if (idx !== -1) {
            targetId = e.key === "ArrowUp"
              ? (siblings[idx - 1] || null)
              : (siblings[idx + 1] || null);
          }
        }
        if (targetId) {
          State.selectNode(targetId);
          MindMap.focusNode(targetId);
        }
        return;
      }

      // ? — show keyboard shortcuts help
      if (e.key === "?") {
        e.preventDefault();
        document.getElementById("shortcuts-modal").classList.remove("hidden");
        return;
      }

      // Tab — add child to selected node
      if (e.key === "Tab") {
        e.preventDefault();
        const parentId = State.getSelectedId() || State.getRootNodeId();
        if (parentId) {
          const newId = State.addNode(parentId, Settings.getDefaultNodeText());
          Detail.open(newId);
          setTimeout(() => Detail.focusTitleInput(), 30);
        }
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

const NodePicker = (() => {
  const backdrop   = document.getElementById("node-picker-modal");
  const titleEl    = document.getElementById("node-picker-title");
  const searchEl   = document.getElementById("node-picker-search");
  const listEl     = document.getElementById("node-picker-list");
  const confirmBtn = document.getElementById("btn-node-picker-confirm");

  let _resolve    = null;
  let _selectedId = null;
  let _allItems   = [];

  function _flattenNodes(excludeIds) {
    const rootId = State.getRootNodeId();
    if (!rootId) return [];
    const nodes = State.getAllNodes();
    const items = [];
    function walk(id, depth) {
      if (excludeIds.has(id)) return;
      const n = nodes[id];
      if (!n) return;
      items.push({ id: n.id, title: n.title, depth });
      (n.childIds || []).forEach(cid => walk(cid, depth + 1));
    }
    walk(rootId, 0);
    return items;
  }

  function _render(filter) {
    listEl.innerHTML = "";
    const q = (filter || "").toLowerCase();
    _allItems
      .filter(item => !q || item.title.toLowerCase().includes(q))
      .forEach(item => {
        const li = document.createElement("li");
        li.className = "node-picker-item" + (item.id === _selectedId ? " selected" : "");
        li.style.paddingLeft = (10 + item.depth * 14) + "px";
        li.textContent = item.title || "(untitled)";
        li.dataset.id = item.id;
        li.addEventListener("click", () => {
          _selectedId = item.id;
          listEl.querySelectorAll(".node-picker-item").forEach(l => l.classList.remove("selected"));
          li.classList.add("selected");
          confirmBtn.disabled = false;
        });
        listEl.appendChild(li);
      });
  }

  function pick(title, excludeIds = new Set()) {
    titleEl.textContent = title || "Choose Parent Node";
    _selectedId = null;
    confirmBtn.disabled = true;
    searchEl.value = "";
    _allItems = _flattenNodes(excludeIds);
    _render();
    backdrop.classList.remove("hidden");
    setTimeout(() => searchEl.focus(), 50);
    return new Promise(resolve => { _resolve = resolve; });
  }

  function _confirm() {
    backdrop.classList.add("hidden");
    if (_resolve) { _resolve(_selectedId); _resolve = null; }
  }

  function _cancel() {
    backdrop.classList.add("hidden");
    if (_resolve) { _resolve(null); _resolve = null; }
  }

  searchEl.addEventListener("input", () => _render(searchEl.value));
  confirmBtn.addEventListener("click", _confirm);
  backdrop.querySelectorAll(".modal-close").forEach(btn => btn.addEventListener("click", _cancel));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) _cancel(); });

  return { pick };
})();

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
    if (id) {
      const newId = State.addNode(id, Settings.getDefaultNodeText());
      Detail.open(newId);
      setTimeout(() => Detail.focusTitleInput(), 30);
    }
    hide();
  });

  document.getElementById("ctx-add-sibling").addEventListener("click", () => {
    const node = State.getSelectedNode();
    if (node && node.parentId) {
      const newId = State.addNode(node.parentId, Settings.getDefaultNodeText());
      Detail.open(newId);
      setTimeout(() => Detail.focusTitleInput(), 30);
    }
    hide();
  });

  document.getElementById("ctx-add-calendar").addEventListener("click", () => {
    const id = State.getSelectedId();
    if (id) {
      const now   = new Date();
      const start = now.toISOString().slice(0, 16);
      const end   = new Date(now.getTime() + 3_600_000).toISOString().slice(0, 16);
      const newId = State.addNode(id, "New event");
      State.updateNode(newId, { nodeType: "calendar", calStart: start, calEnd: end });
      Detail.open(newId);
      setTimeout(() => Detail.focusTitleInput(), 30);
    }
    hide();
  });

  document.getElementById("ctx-delete").addEventListener("click", () => {
    const node = State.getSelectedNode();
    if (!node || node.id === State.getRootNodeId()) { hide(); return; }
    const hasChildren = node.childIds && node.childIds.length > 0;
    const needsConfirm = Settings.getConfirmDelete() && hasChildren;
    if (!needsConfirm || confirm(`Delete "${node.title}" and all its children?`)) {
      State.deleteNode(node.id);
    }
    hide();
  });

  document.getElementById("ctx-add-jira").addEventListener("click", () => {
    const id = State.getSelectedId();
    hide();
    JiraSearch.open(id);
  });

  document.getElementById("ctx-add-crosslink").addEventListener("click", () => {
    hide();
    Detail.openCrossLinkModal(State.getSelectedId());
  });

  document.getElementById("ctx-duplicate").addEventListener("click", () => {
    const id = State.getSelectedId();
    if (id) {
      const newId = State.duplicateNode(id);
      if (newId) Detail.open(newId);
    }
    hide();
  });

  document.getElementById("ctx-move-to").addEventListener("click", async () => {
    const node = State.getSelectedNode();
    hide();
    if (!node || node.id === State.getRootNodeId()) return;
    const excludeIds = new Set([node.id]);
    function collectDescendants(id) {
      const n = State.getNode(id);
      if (!n) return;
      (n.childIds || []).forEach(cid => { excludeIds.add(cid); collectDescendants(cid); });
    }
    collectDescendants(node.id);
    const newParentId = await NodePicker.pick("Move to…", excludeIds);
    if (newParentId) State.moveNode(node.id, newParentId);
  });

  // Dismiss on click outside
  document.addEventListener("click", e => {
    if (!el.contains(e.target)) hide();
  });
  document.addEventListener("contextmenu", () => hide());

  return { show, hide };
})();

// ── Shortcuts modal ───────────────────────────────────────────────────
(() => {
  const modal = document.getElementById("shortcuts-modal");
  const close = () => modal.classList.add("hidden");
  modal.querySelectorAll(".modal-close").forEach(btn => btn.addEventListener("click", close));
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) { close(); e.stopPropagation(); }
  }, true);
})();

// ── Start ─────────────────────────────────────────────────────────────
window.addEventListener("load", () => Bridge.init());
