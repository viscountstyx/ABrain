/**
 * state.js — In-memory normalized store for the active map's nodes.
 *
 * Node shape:
 * {
 *   id, title, parentId, childIds[],
 *   status: null | "started" | "blocked" | "paused" | "resolved",
 *   notes, tags[], dueDate, priority: null | "high" | "medium" | "low",
 *   attachments[{ type: "url"|"file", value, label }],
 *   crossMapLinks[{ mapId, nodeId }],
 *   createdAt, updatedAt
 * }
 *
 * Exposes a subscriber pattern: State.subscribe(fn) — called after every mutation.
 */

const State = (() => {
  let _mapId = null;
  let _mapName = "";
  let _rootNodeId = null;
  let _nodes = {};          // { id: Node }
  let _selectedNodeId = null;
  let _subscribers = [];
  let _schemaVersion = 1;

  // ── Helpers ──────────────────────────────────────────────────────────

  function _now() {
    return new Date().toISOString();
  }

  function _uuid() {
    // crypto.randomUUID is available in modern WebKit/Chromium WebViews
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function _notify() {
    _subscribers.forEach(fn => fn());
  }

  function _isAncestor(potentialAncestorId, nodeId) {
    // Walk up from nodeId to check if potentialAncestorId is in the path
    let current = _nodes[nodeId];
    while (current && current.parentId) {
      if (current.parentId === potentialAncestorId) return true;
      current = _nodes[current.parentId];
    }
    return false;
  }

  // ── Load / snapshot ──────────────────────────────────────────────────

  function load(mapData) {
    _schemaVersion = mapData.schemaVersion || 1;
    _mapId         = mapData.mapId;
    _mapName       = mapData.mapName;
    _rootNodeId    = mapData.rootNodeId;
    _nodes         = {};
    // Deep-clone to avoid mutating the source object
    const raw = mapData.nodes || {};
    for (const id in raw) {
      _nodes[id] = Object.assign({}, raw[id]);
      // Ensure arrays are proper copies
      _nodes[id].childIds      = [...(raw[id].childIds || [])];
      _nodes[id].tags          = [...(raw[id].tags || [])];
      _nodes[id].attachments   = (raw[id].attachments || []).map(a => Object.assign({}, a));
      _nodes[id].crossMapLinks = (raw[id].crossMapLinks || []).map(l => Object.assign({}, l));
    }
    _selectedNodeId = null;
    _notify();
  }

  function snapshot() {
    // Return a plain-object copy suitable for JSON serialisation / saving
    const nodesCopy = {};
    for (const id in _nodes) {
      const n = _nodes[id];
      nodesCopy[id] = {
        id:            n.id,
        title:         n.title,
        parentId:      n.parentId,
        childIds:      [...n.childIds],
        status:        n.status,
        notes:         n.notes,
        tags:          [...n.tags],
        dueDate:       n.dueDate,
        priority:      n.priority,
        attachments:   n.attachments.map(a => Object.assign({}, a)),
        crossMapLinks: n.crossMapLinks.map(l => Object.assign({}, l)),
        color:         n.color || null,
        createdAt:     n.createdAt,
        updatedAt:     n.updatedAt,
      };
    }
    return {
      schemaVersion: _schemaVersion,
      mapId:         _mapId,
      mapName:       _mapName,
      rootNodeId:    _rootNodeId,
      nodes:         nodesCopy,
    };
  }

  // ── Getters ──────────────────────────────────────────────────────────

  function getMapId()        { return _mapId; }
  function getMapName()      { return _mapName; }
  function getRootNodeId()   { return _rootNodeId; }
  function getNode(id)       { return _nodes[id] || null; }
  function getAllNodes()      { return _nodes; }
  function getSelectedId()   { return _selectedNodeId; }
  function getSelectedNode() { return _selectedNodeId ? _nodes[_selectedNodeId] : null; }

  function isEmpty() {
    // "Empty" if the only node is the root with no children
    if (!_rootNodeId) return true;
    const root = _nodes[_rootNodeId];
    return !root || root.childIds.length === 0;
  }

  function getAllTags() {
    const tags = new Set();
    for (const id in _nodes) {
      (_nodes[id].tags || []).forEach(t => tags.add(t));
    }
    return [...tags].sort();
  }

  // ── Mutations ────────────────────────────────────────────────────────

  function addNode(parentId, title = "New thought") {
    const id = _uuid();
    const now = _now();
    _nodes[id] = {
      id,
      title,
      parentId,
      childIds:      [],
      status:        null,
      notes:         "",
      tags:          [],
      dueDate:       null,
      priority:      null,
      attachments:   [],
      crossMapLinks: [],
      createdAt:     now,
      updatedAt:     now,
    };
    if (parentId && _nodes[parentId]) {
      _nodes[parentId].childIds.push(id);
      _nodes[parentId].updatedAt = now;
    }
    _selectedNodeId = id;
    _notify();
    return id;
  }

  function updateNode(id, patch) {
    if (!_nodes[id]) return;
    Object.assign(_nodes[id], patch, { updatedAt: _now() });
    _notify();
  }

  function deleteNode(id) {
    if (!_nodes[id] || id === _rootNodeId) return; // prevent root deletion

    // Recursively collect all descendant IDs
    function collectDescendants(nodeId) {
      const node = _nodes[nodeId];
      if (!node) return;
      node.childIds.forEach(childId => collectDescendants(childId));
      delete _nodes[nodeId];
    }

    // Detach from parent first
    const parentId = _nodes[id].parentId;
    if (parentId && _nodes[parentId]) {
      _nodes[parentId].childIds = _nodes[parentId].childIds.filter(cid => cid !== id);
      _nodes[parentId].updatedAt = _now();
    }

    collectDescendants(id);

    if (_selectedNodeId === id || !_nodes[_selectedNodeId]) {
      _selectedNodeId = null;
    }
    _notify();
  }

  function moveNode(id, newParentId) {
    if (!_nodes[id] || !_nodes[newParentId]) return;
    if (id === newParentId) return;
    if (id === _rootNodeId) return; // root can't be moved
    // Circular reference guard: newParent must not be a descendant of id
    if (_isAncestor(id, newParentId)) return;

    const oldParentId = _nodes[id].parentId;
    if (oldParentId && _nodes[oldParentId]) {
      _nodes[oldParentId].childIds = _nodes[oldParentId].childIds.filter(c => c !== id);
      _nodes[oldParentId].updatedAt = _now();
    }
    _nodes[id].parentId = newParentId;
    _nodes[newParentId].childIds.push(id);
    _nodes[newParentId].updatedAt = _now();
    _nodes[id].updatedAt = _now();
    _notify();
  }

  function selectNode(id) {
    _selectedNodeId = id;
    _notify();
  }

  function deselectNode() {
    _selectedNodeId = null;
    _notify();
  }

  // ── Subscriber pattern ──────────────────────────────────────────────

  function subscribe(fn) {
    _subscribers.push(fn);
    return () => { _subscribers = _subscribers.filter(s => s !== fn); };
  }

  // ── Public API ───────────────────────────────────────────────────────

  return {
    load,
    snapshot,
    // Getters
    getMapId,
    getMapName,
    getRootNodeId,
    getNode,
    getAllNodes,
    getSelectedId,
    getSelectedNode,
    isEmpty,
    getAllTags,
    // Mutations
    addNode,
    updateNode,
    deleteNode,
    moveNode,
    selectNode,
    deselectNode,
    // Subscription
    subscribe,
  };
})();
