/**
 * resizer.js — Drag-to-resize handles for panel columns and section lists.
 *
 * Column resizers: sidebar right edge, agenda panel left edge.
 * Section resizers: bottom edge of Todos, Jira, Calendar list bodies.
 * All sizes persisted to localStorage.
 */

const Resizer = (() => {
  const STORAGE_KEY = "abrain-sizes";
  const MIN_COL = 160;
  const MAX_COL = 560;
  const MIN_SEC = 60;
  const MAX_SEC = 600;

  // ── Persistence ───────────────────────────────────────────────────────

  function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }

  function _save(key, val) {
    const s = _load();
    s[key] = val;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  // ── Apply saved sizes on startup ──────────────────────────────────────

  function _applySaved() {
    const s = _load();
    if (s.sidebarWidth) {
      document.documentElement.style.setProperty("--sidebar-width", s.sidebarWidth + "px");
    }
    if (s.agendaWidth) {
      document.documentElement.style.setProperty("--agenda-width", s.agendaWidth + "px");
    }
    ["todo-list", "jira-list", "cal-list"].forEach(id => {
      if (s[id]) {
        const el = document.getElementById(id);
        if (el) el.style.maxHeight = s[id] + "px";
      }
    });
  }

  // ── Column resizer ────────────────────────────────────────────────────

  function _makeColResizer(handle, getCurrent, apply, storageKey, sign) {
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const startX   = e.clientX;
      const startSize = getCurrent();
      handle.classList.add("dragging");
      document.body.style.cursor    = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(e) {
        const delta   = (e.clientX - startX) * sign;
        const newSize = Math.max(MIN_COL, Math.min(MAX_COL, startSize + delta));
        apply(newSize);
        _save(storageKey, newSize);
      }

      function onUp() {
        handle.classList.remove("dragging");
        document.body.style.cursor    = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  // ── Section height resizer ────────────────────────────────────────────

  function _makeSecResizer(handle, listEl, storageKey) {
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = listEl.getBoundingClientRect().height;
      handle.classList.add("dragging");
      document.body.style.cursor    = "row-resize";
      document.body.style.userSelect = "none";

      function onMove(e) {
        const newH = Math.max(MIN_SEC, Math.min(MAX_SEC, startH + (e.clientY - startY)));
        listEl.style.maxHeight = newH + "px";
        _save(storageKey, newH);
      }

      function onUp() {
        handle.classList.remove("dragging");
        document.body.style.cursor    = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    _applySaved();

    // Sidebar: drag right edge → wider/narrower
    _makeColResizer(
      document.getElementById("sidebar-resizer"),
      () => document.getElementById("sidebar").getBoundingClientRect().width,
      w  => document.documentElement.style.setProperty("--sidebar-width", w + "px"),
      "sidebarWidth",
      1   // positive: rightward drag = wider
    );

    // Agenda: drag left edge → wider/narrower
    _makeColResizer(
      document.getElementById("agenda-resizer"),
      () => document.getElementById("agenda-panel").getBoundingClientRect().width,
      w  => document.documentElement.style.setProperty("--agenda-width", w + "px"),
      "agendaWidth",
      -1  // negative: rightward drag = narrower (left edge)
    );

    // Section list height resizers
    [
      ["todo-list-resizer", "todo-list"],
      ["jira-list-resizer", "jira-list"],
      ["cal-list-resizer",  "cal-list"],
    ].forEach(([handleId, listId]) => {
      const handle = document.getElementById(handleId);
      const list   = document.getElementById(listId);
      if (handle && list) _makeSecResizer(handle, list, listId);
    });
  }

  return { init };
})();
