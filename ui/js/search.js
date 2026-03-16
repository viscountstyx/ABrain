/**
 * search.js — Search and filter for the active map.
 *
 * - Debounced text search across node title and notes.
 * - Filter chips for status and priority.
 * - When a filter is active: non-matching nodes are dimmed in the canvas.
 * - Clicking a result in the list pans the canvas to that node and selects it.
 */

const Search = (() => {
  let _query         = "";
  let _filterStatus  = "";   // "" = all, "none" = null status, or status string
  let _filterPriority = "";  // "" = all, or priority string
  let _debounceTimer = null;
  const DEBOUNCE_MS  = 250;

  // ── Run search/filter ─────────────────────────────────────────────────

  function _run() {
    const nodes = State.getAllNodes();
    const allIds = Object.keys(nodes);

    if (!_query && !_filterStatus && !_filterPriority) {
      // Nothing active — clear all dimming
      MindMap.setDimmed(new Set());
      _renderResults([]);
      return;
    }

    const queryLower = _query.toLowerCase();

    const matchIds = allIds.filter(id => {
      const n = nodes[id];

      // Text match
      if (queryLower) {
        const inTitle = n.title && n.title.toLowerCase().includes(queryLower);
        const inNotes = n.notes && n.notes.toLowerCase().includes(queryLower);
        const inTags  = n.tags  && n.tags.some(t => t.toLowerCase().includes(queryLower));
        if (!inTitle && !inNotes && !inTags) return false;
      }

      // Status filter
      if (_filterStatus) {
        const nodeStatus = n.status || "";
        const effectiveFilter = _filterStatus === "none" ? "" : _filterStatus;
        if (nodeStatus !== effectiveFilter) return false;
      }

      // Priority filter
      if (_filterPriority) {
        if ((n.priority || "") !== _filterPriority) return false;
      }

      return true;
    });

    const matchSet  = new Set(matchIds);
    const dimmedSet = new Set(allIds.filter(id => !matchSet.has(id)));

    MindMap.setDimmed(dimmedSet);
    _renderResults(matchIds.map(id => nodes[id]));
  }

  // ── Render result list ────────────────────────────────────────────────

  const STATUS_DOT_COLOR = {
    "":         "var(--node-none)",
    started:    "var(--node-started)",
    blocked:    "var(--node-blocked)",
    paused:     "var(--node-paused)",
    resolved:   "var(--node-resolved)",
  };

  function _renderResults(matchNodes) {
    const container = document.getElementById("search-results");
    container.innerHTML = "";

    if (matchNodes.length === 0) {
      if (_query || _filterStatus || _filterPriority) {
        const empty = document.createElement("div");
        empty.style.cssText = "color:var(--text-muted);font-size:12px;padding:4px 0;";
        empty.textContent = "No results";
        container.appendChild(empty);
      }
      return;
    }

    matchNodes.slice(0, 60).forEach(node => {
      const item = document.createElement("div");
      item.className = "search-result-item";

      const dot = document.createElement("span");
      dot.className = "result-status-dot";
      dot.style.background = STATUS_DOT_COLOR[node.status || ""] || STATUS_DOT_COLOR[""];

      const text = document.createElement("span");
      text.textContent = node.title;

      item.appendChild(dot);
      item.appendChild(text);

      item.addEventListener("click", () => {
        State.selectNode(node.id);
        MindMap.focusNode(node.id);
      });

      container.appendChild(item);
    });

    if (matchNodes.length > 60) {
      const more = document.createElement("div");
      more.style.cssText = "color:var(--text-muted);font-size:11px;padding:4px 0;";
      more.textContent = `+${matchNodes.length - 60} more…`;
      container.appendChild(more);
    }
  }

  // ── Debounce ──────────────────────────────────────────────────────────

  function _schedule() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(_run, DEBOUNCE_MS);
  }

  // ── Wire UI ───────────────────────────────────────────────────────────

  function init() {
    // Search input
    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", e => {
      _query = e.target.value.trim();
      _schedule();
    });
    searchInput.addEventListener("search", () => {
      // Fires when the ✕ clear button is clicked
      _query = "";
      _schedule();
    });

    // Status filter chips
    document.querySelectorAll("[data-filter-status]").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("[data-filter-status]").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        _filterStatus = chip.dataset.filterStatus;
        _schedule();
      });
    });

    // Priority filter chips
    document.querySelectorAll("[data-filter-priority]").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("[data-filter-priority]").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        _filterPriority = chip.dataset.filterPriority;
        _schedule();
      });
    });

    // Re-run on map switch (state change resets search results automatically
    // because the node set changes; we just clear our query state)
    Maps.onSwitch(() => {
      _query = "";
      _filterStatus = "";
      _filterPriority = "";
      document.getElementById("search-input").value = "";
      document.querySelectorAll("[data-filter-status]").forEach(c =>
        c.classList.toggle("active", c.dataset.filterStatus === ""));
      document.querySelectorAll("[data-filter-priority]").forEach(c =>
        c.classList.toggle("active", c.dataset.filterPriority === ""));
      _renderResults([]);
      MindMap.setDimmed(new Set());
    });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => Search.init());
