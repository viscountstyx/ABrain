/**
 * agenda.js — Right-hand unified agenda panel.
 *
 * Interleaves calendar events, map nodes (with due date or active status),
 * and local todos into a single chronologically-ordered list.
 *
 * Nodes are loaded from ALL maps, not just the currently active one.
 * The active map's cache is kept in sync with live State (unsaved changes included).
 */

const Agenda = (() => {
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  const STATUS_BORDER = {
    started:  "var(--node-started)",
    blocked:  "var(--node-blocked)",
    paused:   "var(--node-paused)",
    resolved: "var(--node-resolved)",
  };

  // Cache of all maps: { [mapId]: { mapName, mapId, nodes, rootId } }
  let _mapCache = {};

  // ── Map cache management ─────────────────────────────────────────────

  async function _loadAllMaps() {
    try {
      const index = await window.pywebview.api.load_maps();
      const maps  = index.maps || [];

      await Promise.all(maps.map(async meta => {
        try {
          const data = await window.pywebview.api.load_map(meta.id);
          _mapCache[meta.id] = {
            mapName: meta.name,
            mapId:   meta.id,
            nodes:   data.nodes  || {},
            rootId:  data.rootNodeId,
          };
        } catch (e) {
          console.error("Agenda: failed to load map", meta.id, e);
        }
      }));
    } catch (e) {
      console.error("Agenda: failed to load map index", e);
    }

    // Override active map's entry with live state (includes unsaved edits)
    _syncActiveMap();
    render();
  }

  function _syncActiveMap() {
    const mapId = State.getMapId();
    if (!mapId) return;
    const entry = _mapCache[mapId];
    if (entry) {
      entry.nodes  = State.getAllNodes();
      entry.rootId = State.getRootNodeId();
      entry.mapName = State.getMapName();
    } else {
      _mapCache[mapId] = {
        mapName: State.getMapName(),
        mapId,
        nodes:  State.getAllNodes(),
        rootId: State.getRootNodeId(),
      };
    }
  }

  // ── Breadcrumb path ──────────────────────────────────────────────────

  function _buildPath(cacheEntry, nodeId) {
    const { mapName, nodes, rootId } = cacheEntry;
    const path = [];
    let current = nodes[nodeId];

    // Walk up from the node's parent, stopping before the root
    while (current && current.parentId) {
      current = nodes[current.parentId];
      if (current && current.id !== rootId) {
        path.unshift(current.title);
      }
    }
    return [mapName, ...path].join(" › ");
  }

  // ── Build flat item list ─────────────────────────────────────────────

  function _isOverdue(sortDate) {
    if (!sortDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return sortDate < today;
  }

  function _buildItems() {
    const items = [];

    // Calendar events
    Tasks.getCalEvents().forEach(event => {
      if (event.declined) return;
      items.push({
        type:     "cal",
        id:       "cal:" + event.uid,
        title:    event.summary,
        sortDate: event.start ? new Date(event.start) : null,
        allDay:   event.allDay,
        location: event.location || "",
        start:    event.start,
        priority: null,
      });
    });

    // Nodes from ALL maps
    Object.values(_mapCache).forEach(entry => {
      const { mapId, nodes, rootId } = entry;

      Object.values(nodes).forEach(node => {
        if (node.id === rootId) return;
        if (node.status === "resolved") return;
        const hasStatus = !!node.status;
        const hasDue    = !!node.dueDate;
        if (!hasStatus && !hasDue) return;

        const sd = node.dueDate ? new Date(node.dueDate + "T00:00:00") : null;
        items.push({
          type:     "node",
          id:       `node:${mapId}:${node.id}`,
          nodeId:   node.id,
          mapId,
          title:    node.title,
          path:     _buildPath(entry, node.id),
          sortDate: sd,
          overdue:  _isOverdue(sd),
          status:   node.status,
          priority: node.priority,
        });
      });
    });

    // Todos
    const { todos, order } = Tasks.getTodosWithOrder();
    const todoMap = Object.fromEntries(todos.map(t => [t.id, t]));
    order.forEach((id, idx) => {
      const todo = todoMap[id];
      if (!todo) return;
      items.push({
        type:      "todo",
        id:        "todo:" + todo.id,
        todoId:    todo.id,
        title:     todo.title,
        sortDate:  null,
        done:      todo.done,
        recurrence: todo.recurrence && todo.recurrence !== "none" ? todo.recurrence : null,
        priority:  null,
        orderIdx:  idx,
      });
    });

    return items;
  }

  // ── Group into date buckets ──────────────────────────────────────────

  function _dayStr(date) {
    return date.toISOString().slice(0, 10);
  }

  function _groupItems(items) {
    const now      = new Date();
    const today    = _dayStr(now);
    const tomorrow = _dayStr(new Date(now.getTime() + 86_400_000));

    const overdue = items.filter(i => i.overdue);
    const dated   = items.filter(i => i.sortDate && !i.overdue);
    const undated = items.filter(i => !i.sortDate);

    overdue.sort((a, b) => a.sortDate - b.sortDate);
    dated.sort((a, b) => a.sortDate - b.sortDate);

    undated.sort((a, b) => {
      if (a.type !== b.type) return a.type === "todo" ? 1 : -1;
      const pa = PRIORITY_RANK[a.priority] ?? 3;
      const pb = PRIORITY_RANK[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return (a.orderIdx ?? 999) - (b.orderIdx ?? 999);
    });

    const groups = new Map();

    if (overdue.length > 0) groups.set("Overdue", overdue);

    dated.forEach(item => {
      const key = _dayStr(item.sortDate);
      let label;
      if (key === today)         label = "Today";
      else if (key === tomorrow) label = "Tomorrow";
      else {
        const diffDays = Math.floor((item.sortDate - now) / 86_400_000);
        label = diffDays < 7
          ? item.sortDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
          : item.sortDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    });

    if (undated.length > 0) groups.set("No date", undated);

    return groups;
  }

  // ── Render ───────────────────────────────────────────────────────────

  function render() {
    const list = document.getElementById("agenda-list");
    if (!list) return;
    list.innerHTML = "";

    const items = _buildItems();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "agenda-empty";
      empty.textContent = "Nothing scheduled.";
      list.appendChild(empty);
      return;
    }

    const groups = _groupItems(items);

    groups.forEach((groupItems, label) => {
      const header = document.createElement("div");
      header.className = "agenda-group-header" + (label === "Overdue" ? " agenda-group-header--overdue" : "");
      header.textContent = label;
      list.appendChild(header);
      groupItems.forEach(item => list.appendChild(_renderItem(item)));
    });
  }

  function _renderItem(item) {
    const el = document.createElement("div");
    el.className = `agenda-item agenda-item--${item.type}`;
    if (item.status)  el.classList.add(`status-${item.status}`);
    if (item.overdue) el.classList.add("overdue");

    if (item.type === "todo") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.done;
      cb.className = "agenda-todo-cb";
      cb.addEventListener("change", async () => {
        await window.pywebview.api.toggle_task(item.todoId);
        await Tasks.reload();
      });

      const body = document.createElement("div");
      body.className = "agenda-item-body";
      const title = document.createElement("div");
      title.className = "agenda-item-title" + (item.done ? " done" : "");
      title.textContent = item.title;
      body.appendChild(title);

      if (item.recurrence) {
        const badge = document.createElement("span");
        badge.className = "recur-badge agenda-recur-badge";
        badge.textContent = item.recurrence[0].toUpperCase();
        badge.title = item.recurrence;
        body.appendChild(badge);
      }

      const del = document.createElement("button");
      del.className = "agenda-todo-del";
      del.textContent = "✕";
      del.title = "Delete";
      del.addEventListener("click", async e => {
        e.stopPropagation();
        await window.pywebview.api.delete_task(item.todoId);
        await Tasks.reload();
      });

      el.appendChild(cb);
      el.appendChild(body);
      el.appendChild(del);

    } else if (item.type === "cal") {
      const dot = document.createElement("div");
      dot.className = "agenda-dot";
      dot.style.background = "var(--node-resolved)";

      const body = document.createElement("div");
      body.className = "agenda-item-body";

      const title = document.createElement("div");
      title.className = "agenda-item-title";
      title.textContent = item.title;

      const meta = document.createElement("div");
      meta.className = "agenda-item-meta";
      const parts = [];
      if (!item.allDay && item.start) {
        parts.push(new Date(item.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } else if (item.allDay) {
        parts.push("All day");
      }
      if (item.location) parts.push(item.location);
      meta.textContent = parts.join(" · ");

      body.appendChild(title);
      if (meta.textContent) body.appendChild(meta);
      el.appendChild(dot);
      el.appendChild(body);

    } else if (item.type === "node") {
      const dot = document.createElement("div");
      dot.className = "agenda-dot";
      dot.style.background = STATUS_BORDER[item.status] || "var(--node-none)";

      const body = document.createElement("div");
      body.className = "agenda-item-body";

      const title = document.createElement("div");
      title.className = "agenda-item-title";
      title.textContent = item.title;

      const path = document.createElement("div");
      path.className = "agenda-item-path";
      path.textContent = item.path;

      const meta = document.createElement("div");
      meta.className = "agenda-item-meta";
      if (item.status) {
        const s = document.createElement("span");
        s.textContent = item.status;
        meta.appendChild(s);
      }
      if (item.priority) {
        if (item.status) meta.appendChild(document.createTextNode(" · "));
        const badge = document.createElement("span");
        badge.className = `agenda-priority-badge agenda-priority-badge--${item.priority}`;
        badge.textContent = item.priority;
        meta.appendChild(badge);
      }

      body.appendChild(title);
      body.appendChild(path);
      if (meta.textContent) body.appendChild(meta);
      el.appendChild(dot);
      el.appendChild(body);

      // Snooze buttons (only for nodes with a due date in the active map)
      if (item.sortDate && item.mapId === Maps.getActiveId()) {
        const snoozeWrap = document.createElement("div");
        snoozeWrap.className = "agenda-snooze";
        [["＋1d", 1], ["＋1w", 7]].forEach(([label, days]) => {
          const btn = document.createElement("button");
          btn.className = "agenda-snooze-btn";
          btn.textContent = label;
          btn.title = `Postpone ${days === 1 ? "1 day" : "1 week"}`;
          btn.addEventListener("click", e => {
            e.stopPropagation();
            const d = new Date(item.sortDate);
            d.setDate(d.getDate() + days);
            const newDue = d.toISOString().slice(0, 10);
            State.updateNode(item.nodeId, { dueDate: newDue });
          });
          snoozeWrap.appendChild(btn);
        });
        el.appendChild(snoozeWrap);
      }

      el.addEventListener("click", () => {
        if (item.mapId === Maps.getActiveId()) {
          State.selectNode(item.nodeId);
          MindMap.focusNode(item.nodeId);
          Detail.open(item.nodeId);
        } else {
          Maps.navigateTo(item.mapId, item.nodeId);
        }
      });
    }

    return el;
  }

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    // Quick-add node to active map
    const quickInput = document.getElementById("agenda-quick-input");
    quickInput.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const title = quickInput.value.trim();
      if (!title) return;
      const parentId = State.getSelectedId() || State.getRootNodeId();
      if (parentId) {
        const newId = State.addNode(parentId, title);
        Detail.open(newId);
      }
      quickInput.value = "";
    });

    // Keep active map cache in sync with live state changes
    State.subscribe(() => {
      _syncActiveMap();
      render();
    });

    // Reload all maps when the active map switches
    Maps.onSwitch(() => _loadAllMaps());

    // Reload when tasks/calendar update
    Tasks.onUpdate(render);

    // Initial load of all map data
    _loadAllMaps();
  }

  return { init };
})();
