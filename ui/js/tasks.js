/**
 * tasks.js — Sidebar task panel: local todos, Jira issues, Calendar events.
 */

const Tasks = (() => {
  let _todos = [];
  let _order = [];
  let _jiraIssues = [];
  let _calEvents = [];
  let _refreshTimer = null;
  let _updateListeners = [];
  let _jiraSyncedAt = null;
  let _jiraError    = null;
  let _calSyncedAt  = null;
  let _calError     = null;

  const REFRESH_MS = 5 * 60 * 1000;
  const COLLAPSE_KEY = "abrain-tasks-collapse";

  function _notifyUpdate() {
    _updateListeners.forEach(fn => fn());
  }

  // ── Collapse state ────────────────────────────────────────────────────

  function _getCollapse() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); }
    catch { return {}; }
  }

  function _setCollapse(key, val) {
    const c = _getCollapse();
    c[key] = val;
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(c));
  }

  // ── Subsection toggle setup ───────────────────────────────────────────

  function _setupSubsectionToggles() {
    document.querySelectorAll(".tasks-sub-header").forEach(header => {
      const key = header.dataset.key;
      const body = document.getElementById(`${key}-body`);
      const arrow = header.querySelector(".tasks-sub-arrow");

      // Restore saved state
      if (_getCollapse()[key]) {
        body.classList.add("collapsed");
        arrow.classList.add("collapsed");
      }

      header.addEventListener("click", () => {
        const isCollapsed = body.classList.toggle("collapsed");
        arrow.classList.toggle("collapsed", isCollapsed);
        _setCollapse(key, isCollapsed);
      });
    });
  }

  // ── Todos ─────────────────────────────────────────────────────────────

  async function _loadTasks() {
    const data = await window.pywebview.api.load_tasks();
    _todos = data.tasks || [];
    _order = data.order || _todos.map(t => t.id);
    // Ensure order only contains valid IDs
    const ids = new Set(_todos.map(t => t.id));
    _order = _order.filter(id => ids.has(id));
    _todos.forEach(t => { if (!_order.includes(t.id)) _order.push(t.id); });
    _renderTodos();
    _notifyUpdate();
  }

  function _orderedTodos() {
    const map = Object.fromEntries(_todos.map(t => [t.id, t]));
    const today = new Date().toISOString().slice(0, 10);
    return _order.map(id => map[id]).filter(t => {
      if (!t) return false;
      // Hide future recurring occurrences until their due date arrives
      if (t.dueDate && t.dueDate > today) return false;
      return true;
    });
  }

  function _renderTodos() {
    const list = document.getElementById("todo-list");
    const countEl = document.getElementById("todos-count");
    const ordered = _orderedTodos();
    const pending = ordered.filter(t => !t.done).length;

    countEl.textContent = pending > 0 ? pending : "";
    list.innerHTML = "";

    if (ordered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tasks-sub-empty";
      empty.textContent = "No tasks yet.";
      list.appendChild(empty);
      return;
    }

    ordered.forEach(todo => {
      const item = document.createElement("div");
      item.className = "todo-item" + (todo.done ? " done" : "");
      item.dataset.id = todo.id;
      item.draggable = true;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = todo.done;
      cb.addEventListener("change", async () => {
        await window.pywebview.api.toggle_task(todo.id);
        await _loadTasks();
      });

      const title = document.createElement("span");
      title.className = "todo-title";
      title.textContent = todo.title;
      title.title = todo.title;

      if (todo.recurrence && todo.recurrence !== "none") {
        const badge = document.createElement("span");
        badge.className = "recur-badge";
        badge.textContent = todo.recurrence[0].toUpperCase(); // D/W/M
        badge.title = todo.recurrence;
        title.appendChild(badge);
      }

      const del = document.createElement("button");
      del.className = "todo-delete";
      del.textContent = "✕";
      del.title = "Delete";
      del.addEventListener("click", async e => {
        e.stopPropagation();
        await window.pywebview.api.delete_task(todo.id);
        await _loadTasks();
      });

      item.appendChild(cb);
      item.appendChild(title);
      item.appendChild(del);
      list.appendChild(item);
    });

    _setupDragDrop(list);
  }

  // ── Drag-and-drop for todos ───────────────────────────────────────────

  let _dragId = null;

  function _setupDragDrop(list) {
    list.querySelectorAll(".todo-item").forEach(item => {
      item.addEventListener("dragstart", e => {
        _dragId = item.dataset.id;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => item.classList.add("dragging"), 0);
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        list.querySelectorAll(".todo-item").forEach(i => i.classList.remove("drag-over"));
        _dragId = null;
      });

      item.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        list.querySelectorAll(".todo-item").forEach(i => i.classList.remove("drag-over"));
        if (item.dataset.id !== _dragId) item.classList.add("drag-over");
      });

      item.addEventListener("drop", async e => {
        e.preventDefault();
        item.classList.remove("drag-over");
        if (!_dragId || _dragId === item.dataset.id) return;

        const fromIdx = _order.indexOf(_dragId);
        const toIdx   = _order.indexOf(item.dataset.id);
        if (fromIdx === -1 || toIdx === -1) return;

        _order.splice(fromIdx, 1);
        _order.splice(toIdx, 0, _dragId);

        await window.pywebview.api.save_task_order([..._order]);
        _renderTodos();
      });
    });
  }

  function _setupAddTodo() {
    const input = document.getElementById("todo-add-input");
    const recurSel = document.getElementById("todo-add-recur");
    input.addEventListener("keydown", async e => {
      if (e.key !== "Enter") return;
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      await window.pywebview.api.add_task(title, recurSel ? recurSel.value : "none");
      await _loadTasks();
    });
  }

  // ── Sync status display ───────────────────────────────────────────────

  function _setSyncStatus(elId, syncedAt, error) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (error) {
      el.textContent = "⚠";
      el.title = "Sync failed: " + error;
      el.className = "sync-status sync-status--error";
    } else if (syncedAt) {
      const mins = Math.floor((Date.now() - syncedAt) / 60000);
      el.textContent = mins < 1 ? "just now" : `${mins}m ago`;
      el.title = "Last synced " + new Date(syncedAt).toLocaleTimeString();
      el.className = "sync-status";
    } else {
      el.textContent = "";
      el.className = "sync-status";
    }
  }

  // ── Jira ──────────────────────────────────────────────────────────────

  let _prevJiraKeys = new Set();

  async function _loadJira() {
    const prevKeys = new Set(_prevJiraKeys);
    try {
      const result = await window.pywebview.api.fetch_jira_issues();
      if (result.error) {
        _jiraError = result.error;
      } else {
        _jiraIssues = result.issues || [];
        _jiraError  = null;
        _jiraSyncedAt = Date.now();
      }
    } catch (e) {
      _jiraError = String(e);
      _jiraIssues = [];
    }
    const newKeys = new Set(_jiraIssues.map(i => i.key));
    _prevJiraKeys = newKeys;

    // Auto-resolve nodes whose linked Jira issue has been resolved
    if (prevKeys.size > 0) {
      const resolved = [...prevKeys].filter(k => !newKeys.has(k));
      if (resolved.length > 0) _syncJiraResolved(resolved);
    }

    _renderJira();
    _setSyncStatus("jira-sync-status", _jiraSyncedAt, _jiraError);
  }

  function _syncJiraResolved(resolvedKeys) {
    const nodes = State.getAllNodes();
    resolvedKeys.forEach(key => {
      Object.values(nodes).forEach(node => {
        if (node.status === "resolved") return;
        const linked = (node.attachments || []).some(
          a => a.type === "url" && a.value && a.value.includes("/browse/" + key)
        );
        if (linked) State.updateNode(node.id, { status: "resolved" });
      });
    });
  }

  function _renderJira() {
    const list = document.getElementById("jira-list");
    const countEl = document.getElementById("jira-count");
    countEl.textContent = _jiraIssues.length > 0 ? _jiraIssues.length : "";
    list.innerHTML = "";

    if (_jiraIssues.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tasks-sub-empty";
      empty.textContent = "No issues or not configured.";
      list.appendChild(empty);
      return;
    }

    _jiraIssues.forEach(issue => {
      const item = document.createElement("div");
      item.className = "jira-item";
      item.title = issue.summary;

      const top = document.createElement("div");
      top.className = "jira-item-top";

      const key = document.createElement("span");
      key.className = "jira-key";
      key.textContent = issue.key;

      const summary = document.createElement("span");
      summary.className = "jira-summary";
      summary.textContent = issue.summary;

      top.appendChild(key);
      top.appendChild(summary);

      const bottom = document.createElement("div");
      bottom.className = "jira-item-bottom";

      const dot = document.createElement("span");
      dot.className = "jira-priority-dot";
      dot.style.background = _jiraPriorityColor(issue.priority);

      const status = document.createElement("span");
      status.className = "jira-status";
      status.textContent = issue.status;

      const type = document.createElement("span");
      type.className = "jira-type";
      type.textContent = issue.issueType;

      const addBtn = document.createElement("button");
      addBtn.className = "jira-add-map-btn";
      addBtn.textContent = "＋ map";
      addBtn.title = "Add as node in current map";
      addBtn.addEventListener("click", async e => {
        e.stopPropagation();
        if (!State.getRootNodeId()) return;
        const parentId = await NodePicker.pick("Add to Map — Choose Parent");
        if (!parentId) return;
        const nodeTitle = issue.key + ": " + issue.summary.substring(0, 60);
        const newId = State.addNode(parentId, nodeTitle);
        State.updateNode(newId, {
          status: "started",
          attachments: [{ type: "url", value: issue.url, label: issue.key }],
        });
      });

      bottom.appendChild(dot);
      bottom.appendChild(status);
      bottom.appendChild(type);
      bottom.appendChild(addBtn);

      item.appendChild(top);
      item.appendChild(bottom);

      item.addEventListener("click", () => {
        if (issue.url) window.pywebview.api.open_url(issue.url);
      });

      list.appendChild(item);
    });
  }

  function _jiraPriorityColor(priority) {
    switch ((priority || "").toLowerCase()) {
      case "highest":
      case "critical":
      case "blocker":  return "var(--priority-high)";
      case "high":     return "var(--priority-high)";
      case "medium":   return "var(--priority-medium)";
      case "low":
      case "lowest":   return "var(--priority-low)";
      default:         return "var(--text-muted)";
    }
  }

  // ── Calendar ──────────────────────────────────────────────────────────

  async function _loadCal() {
    try {
      const result = await window.pywebview.api.fetch_calendar_events();
      if (result.error) {
        _calError = result.error;
      } else {
        _calEvents = result.events || [];
        _calError  = null;
        _calSyncedAt = Date.now();
      }
    } catch (e) {
      _calError = String(e);
      _calEvents = [];
    }
    _renderCal();
    _setSyncStatus("cal-sync-status", _calSyncedAt, _calError);
    _notifyUpdate();
  }

  function _renderCal() {
    const list = document.getElementById("cal-list");
    const countEl = document.getElementById("cal-count");
    countEl.textContent = _calEvents.length > 0 ? _calEvents.length : "";
    list.innerHTML = "";

    if (_calEvents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tasks-sub-empty";
      empty.textContent = "No upcoming events or not configured.";
      list.appendChild(empty);
      return;
    }

    _calEvents.forEach(event => {
      const item = document.createElement("div");
      item.className = "cal-item" + (event.declined ? " declined" : "");
      item.title = event.summary;

      const timeEl = document.createElement("div");
      timeEl.className = "cal-time";
      timeEl.textContent = _formatCalTime(event);

      const info = document.createElement("div");
      info.className = "cal-info";

      const title = document.createElement("div");
      title.className = "cal-title";
      title.textContent = event.summary;

      info.appendChild(title);

      if (event.location) {
        const loc = document.createElement("div");
        loc.className = "cal-location";
        loc.textContent = event.location;
        info.appendChild(loc);
      }

      item.appendChild(timeEl);
      item.appendChild(info);
      list.appendChild(item);
    });
  }

  function _formatCalTime(event) {
    if (event.allDay) return "All day";
    const d = new Date(event.start);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────

  function _startAutoRefresh() {
    clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async () => {
      await _loadJira();
      await _loadCal();
    }, REFRESH_MS);
    // Refresh the "X min ago" labels every minute without re-fetching
    setInterval(() => {
      _setSyncStatus("jira-sync-status", _jiraSyncedAt, _jiraError);
      _setSyncStatus("cal-sync-status",  _calSyncedAt,  _calError);
    }, 60_000);
  }

  // ── Public ────────────────────────────────────────────────────────────

  async function init() {
    _setupSubsectionToggles();
    _setupAddTodo();

    const refreshBtn = document.getElementById("btn-tasks-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("spinning");
        refreshBtn.disabled = true;
        try {
          await Promise.all([_loadJira(), _loadCal()]);
        } finally {
          refreshBtn.classList.remove("spinning");
          refreshBtn.disabled = false;
        }
      });
    }

    await _loadTasks();
    await Promise.all([_loadJira(), _loadCal()]);
    _startAutoRefresh();
  }

  async function reload() {
    await _loadTasks();
  }

  function getTodosWithOrder() {
    const today = new Date().toISOString().slice(0, 10);
    const visible = _todos.filter(t => !t.dueDate || t.dueDate <= today);
    const visibleIds = new Set(visible.map(t => t.id));
    return { todos: visible, order: _order.filter(id => visibleIds.has(id)) };
  }

  function getCalEvents() {
    return _calEvents;
  }

  function onUpdate(fn) {
    _updateListeners.push(fn);
  }

  return { init, reload, getTodosWithOrder, getCalEvents, onUpdate };
})();
