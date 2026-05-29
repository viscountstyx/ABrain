/**
 * detail.js — Right-panel node detail editor.
 *
 * Shown when a node is selected. All field changes are applied
 * immediately via State.updateNode(), which triggers auto-save.
 */

const Detail = (() => {
  const panel     = () => document.getElementById("node-modal");

  // Field elements
  const titleInput   = () => document.getElementById("detail-title");
  const notesInput   = () => document.getElementById("detail-notes");
  const prioritySel  = () => document.getElementById("detail-priority");
  const dueInput     = () => document.getElementById("detail-due");
  const colorInput   = () => document.getElementById("detail-color");
  const tagInput     = () => document.getElementById("detail-tag-input");
  const tagPills     = () => document.getElementById("detail-tags-pills");
  const attachList   = () => document.getElementById("detail-attachments-list");
  const crossList    = () => document.getElementById("detail-crosslinks-list");
  const urlInput     = () => document.getElementById("attach-url-input");
  const statusBtns   = () => document.querySelectorAll(".status-btn");
  const deleteBtn    = () => document.getElementById("btn-delete-node");

  let _currentId = null;
  let _suppressUpdate = false; // prevent re-entrant updates while populating

  // ── Recently visited ──────────────────────────────────────────────────
  const RECENT_KEY = "abrain-recent";

  function _pushRecent(id) {
    const node = State.getNode(id);
    if (!node || !node.title) return;
    const maxRecent = Settings.getMaxRecentItems();
    let recents = _loadRecents();
    recents = recents.filter(r => !(r.id === id && r.mapId === Maps.getActiveId()));
    recents.unshift({ id, mapId: Maps.getActiveId(), title: node.title });
    if (recents.length > maxRecent) recents = recents.slice(0, maxRecent);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
    _renderRecents();
  }

  function _loadRecents() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
    catch { return []; }
  }

  function _renderRecents() {
    const list = document.getElementById("recent-list");
    if (!list) return;
    list.innerHTML = "";
    const recents = _loadRecents();
    if (recents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "recent-empty";
      empty.textContent = "No recent nodes.";
      list.appendChild(empty);
      return;
    }
    recents.forEach(r => {
      const item = document.createElement("div");
      item.className = "recent-item";
      item.textContent = r.title;
      item.title = r.title;
      item.addEventListener("click", () => Maps.navigateTo(r.mapId, r.id));
      list.appendChild(item);
    });
  }

  // ── Show / hide panel ────────────────────────────────────────────────

  function _show() {
    panel().classList.remove("hidden");
  }

  function _hide() {
    panel().classList.add("hidden");
    _currentId = null;
  }

  // ── Populate from node ────────────────────────────────────────────────

  function _populate(node) {
    _suppressUpdate = true;

    titleInput().value    = node.title   || "";
    notesInput().value    = node.notes   || "";
    prioritySel().value   = node.priority || "";
    dueInput().value      = node.dueDate  || "";
    colorInput().value    = node.color   || "#89b4fa";

    // Show "Inherit from parent" only when the parent has a due date
    const inheritBtn = document.getElementById("btn-inherit-due");
    if (inheritBtn) {
      const parent = node.parentId ? State.getNode(node.parentId) : null;
      const parentDue = parent && parent.dueDate;
      inheritBtn.hidden = !parentDue;
      if (parentDue) {
        inheritBtn.dataset.parentDue = parentDue;
        const fmt = new Date(parentDue + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        inheritBtn.title = `Use parent's due date (${fmt})`;
      }
    }

    // Status buttons
    statusBtns().forEach(btn => {
      const s = btn.dataset.status;
      btn.classList.toggle("active", s === (node.status || ""));
    });

    _renderTags(node.tags || []);
    _renderAttachments(node.attachments || []);
    _renderCrossLinks(node.crossMapLinks || []);

    _suppressUpdate = false;
  }

  // ── Tags ──────────────────────────────────────────────────────────────

  function _renderTags(tags) {
    const container = tagPills();
    container.innerHTML = "";
    tags.forEach(tag => {
      const pill = document.createElement("span");
      pill.className = "tag-pill";
      pill.innerHTML = `<span>${_escHtml(tag)}</span>
        <button class="tag-remove" title="Remove tag">✕</button>`;
      pill.querySelector(".tag-remove").addEventListener("click", () => {
        const node = State.getNode(_currentId);
        if (!node) return;
        State.updateNode(_currentId, { tags: node.tags.filter(t => t !== tag) });
      });
      container.appendChild(pill);
    });
  }

  function _setupTagInput() {
    const input = tagInput();
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        _addTag(input.value);
      }
      if (e.key === "Backspace" && input.value === "") {
        // Remove last tag on backspace in empty input
        const node = State.getNode(_currentId);
        if (node && node.tags.length > 0) {
          State.updateNode(_currentId, { tags: node.tags.slice(0, -1) });
        }
      }
    });
    input.addEventListener("blur", () => {
      if (input.value.trim()) _addTag(input.value);
    });
  }

  function _addTag(raw) {
    const tag = raw.trim().replace(/,/g, "").toLowerCase();
    if (!tag || !_currentId) {
      tagInput().value = "";
      return;
    }
    const node = State.getNode(_currentId);
    if (!node) return;
    if (!node.tags.includes(tag)) {
      State.updateNode(_currentId, { tags: [...node.tags, tag] });
    }
    tagInput().value = "";
  }

  // ── Attachments ───────────────────────────────────────────────────────

  function _renderAttachments(attachments) {
    const list = attachList();
    list.innerHTML = "";
    attachments.forEach((att, idx) => {
      const row = document.createElement("div");
      row.className = "attachment-item";

      const label = document.createElement("span");
      label.className = "attach-label";
      label.textContent = att.label || att.value;
      label.title = att.value;
      label.addEventListener("click", () => {
        if (att.type === "url") {
          window.pywebview.api.open_url(att.value);
        } else {
          window.pywebview.api.open_file(att.value);
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "attach-remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => {
        const node = State.getNode(_currentId);
        if (!node) return;
        const updated = node.attachments.filter((_, i) => i !== idx);
        State.updateNode(_currentId, { attachments: updated });
      });

      row.appendChild(label);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  function _setupAttachmentButtons() {
    document.getElementById("btn-attach-url").addEventListener("click", () => {
      const val = urlInput().value.trim();
      if (!val || !_currentId) return;
      // Basic URL validation
      if (!val.startsWith("http://") && !val.startsWith("https://")) {
        alert("Please enter a valid http:// or https:// URL.");
        return;
      }
      const node = State.getNode(_currentId);
      if (!node) return;
      State.updateNode(_currentId, {
        attachments: [...node.attachments, { type: "url", value: val, label: val }]
      });
      urlInput().value = "";
    });

    urlInput().addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("btn-attach-url").click();
    });

    document.getElementById("btn-attach-file").addEventListener("click", async () => {
      if (!_currentId) return;
      const result = await window.pywebview.api.pick_file();
      if (!result.path) return;
      const node = State.getNode(_currentId);
      if (!node) return;
      const label = result.path.split("/").pop();
      State.updateNode(_currentId, {
        attachments: [...node.attachments, { type: "file", value: result.path, label }]
      });
    });
  }

  // ── Cross-map links ───────────────────────────────────────────────────

  function _renderCrossLinks(links) {
    const list = crossList();
    list.innerHTML = "";
    links.forEach((link, idx) => {
      const row = document.createElement("div");
      row.className = "crosslink-item";

      const mapMeta = Maps.getMaps().find(m => m.id === link.mapId);
      const mapMissing = !mapMeta;

      const label = document.createElement("span");
      label.className = "crosslink-label";
      label.textContent = `${link.mapId.slice(0, 6)}… / ${link.nodeId.slice(0, 6)}…`;
      label.title = "Click to navigate";

      if (mapMissing) {
        row.classList.add("crosslink-item--broken");
        label.textContent = "(deleted map)";
        label.title = "This map no longer exists";
      } else {
        // Fetch human-readable label; mark broken if node is gone
        window.pywebview.api.get_node_title(link.mapId, link.nodeId)
          .then(res => {
            const mapName = mapMeta.name;
            if (!res.title) {
              row.classList.add("crosslink-item--broken");
              label.textContent = `${mapName} → (missing node)`;
              label.title = "This node no longer exists";
            } else {
              label.textContent = `${mapName} → ${res.title}`;
            }
          })
          .catch(() => {
            row.classList.add("crosslink-item--broken");
            label.textContent = "(error resolving link)";
          });
      }

      label.addEventListener("click", () => Maps.navigateTo(link.mapId, link.nodeId));

      const removeBtn = document.createElement("button");
      removeBtn.className = "crosslink-remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove link";
      removeBtn.addEventListener("click", async () => {
        const node = State.getNode(_currentId);
        if (!node) return;
        State.updateNode(_currentId, {
          crossMapLinks: node.crossMapLinks.filter((_, i) => i !== idx)
        });
        // Remove backlink from the target map
        try {
          const targetData = await window.pywebview.api.load_map(link.mapId);
          const targetNode = targetData.nodes && targetData.nodes[link.nodeId];
          if (targetNode && targetNode.crossMapLinks) {
            const sourceMapId  = Maps.getActiveId();
            const sourceNodeId = _currentId;
            targetNode.crossMapLinks = targetNode.crossMapLinks.filter(
              l => !(l.mapId === sourceMapId && l.nodeId === sourceNodeId)
            );
            await window.pywebview.api.save_map(link.mapId, targetData);
          }
        } catch (e) {
          console.error("Failed to remove backlink:", e);
        }
      });

      row.appendChild(label);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  // ── Cross-link modal ──────────────────────────────────────────────────

  function openCrossLinkModal(nodeId) {
    if (!nodeId) return;
    _currentId = nodeId; // ensure current when called from context menu before selection

    const modal      = document.getElementById("crosslink-modal");
    const mapSelect  = document.getElementById("crosslink-map-select");
    const nodeSelect = document.getElementById("crosslink-node-select");

    // Populate map dropdown (exclude active map)
    mapSelect.innerHTML = "";
    const otherMaps = Maps.getOtherMaps();
    if (otherMaps.length === 0) {
      alert("No other maps to link to. Create another map first.");
      return;
    }
    otherMaps.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      mapSelect.appendChild(opt);
    });

    // Load nodes for the first map
    async function loadNodesForMap(mapId) {
      nodeSelect.innerHTML = '<option>Loading…</option>';
      try {
        const data = await window.pywebview.api.load_map(mapId);
        nodeSelect.innerHTML = "";
        const nodes = data.nodes || {};
        Object.values(nodes).forEach(n => {
          const opt = document.createElement("option");
          opt.value = n.id;
          opt.textContent = n.title;
          nodeSelect.appendChild(opt);
        });
      } catch (e) {
        nodeSelect.innerHTML = '<option>Error loading nodes</option>';
      }
    }

    mapSelect.addEventListener("change", () => loadNodesForMap(mapSelect.value));
    loadNodesForMap(mapSelect.value);

    modal.classList.remove("hidden");

    document.getElementById("btn-crosslink-confirm").onclick = async () => {
      const targetMapId  = mapSelect.value;
      const targetNodeId = nodeSelect.value;
      if (!targetMapId || !targetNodeId) return;

      const sourceMapId  = Maps.getActiveId();
      const sourceNodeId = _currentId;
      const node = State.getNode(sourceNodeId);
      if (!node) return;

      // Forward link: source → target
      const exists = node.crossMapLinks.some(
        l => l.mapId === targetMapId && l.nodeId === targetNodeId
      );
      if (!exists) {
        State.updateNode(sourceNodeId, {
          crossMapLinks: [...node.crossMapLinks, { mapId: targetMapId, nodeId: targetNodeId }]
        });
      }

      // Backlink: target → source
      try {
        const targetData = await window.pywebview.api.load_map(targetMapId);
        const targetNode = targetData.nodes && targetData.nodes[targetNodeId];
        if (targetNode) {
          const links = targetNode.crossMapLinks || [];
          const backExists = links.some(
            l => l.mapId === sourceMapId && l.nodeId === sourceNodeId
          );
          if (!backExists) {
            targetNode.crossMapLinks = [...links, { mapId: sourceMapId, nodeId: sourceNodeId }];
            await window.pywebview.api.save_map(targetMapId, targetData);
          }
        }
      } catch (e) {
        console.error("Failed to create backlink:", e);
      }

      modal.classList.add("hidden");
    };
  }

  function _setupCrossLinkModal() {
    document.getElementById("btn-add-crosslink").addEventListener("click", () => {
      openCrossLinkModal(_currentId);
    });

    document.querySelectorAll("#crosslink-modal .modal-close").forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("crosslink-modal").classList.add("hidden");
      });
    });
  }

  // ── Delete button ─────────────────────────────────────────────────────

  function _setupDeleteButton() {
    deleteBtn().addEventListener("click", () => {
      const node = State.getNode(_currentId);
      if (!node || node.id === State.getRootNodeId()) return;
      const hasChildren = node.childIds && node.childIds.length > 0;
      const needsConfirm = Settings.getConfirmDelete() && hasChildren;
      if (!needsConfirm || confirm(`Delete "${node.title}" and all its children?`)) {
        State.deleteNode(node.id);
      }
    });
  }

  // ── Field change listeners ────────────────────────────────────────────

  function _setupFieldListeners() {
    titleInput().addEventListener("input", () => {
      if (_suppressUpdate || !_currentId) return;
      State.updateNode(_currentId, { title: titleInput().value });
    });

    notesInput().addEventListener("input", () => {
      if (_suppressUpdate || !_currentId) return;
      State.updateNode(_currentId, { notes: notesInput().value });
    });

    prioritySel().addEventListener("change", () => {
      if (_suppressUpdate || !_currentId) return;
      State.updateNode(_currentId, { priority: prioritySel().value || null });
    });

    dueInput().addEventListener("change", () => {
      if (_suppressUpdate || !_currentId) return;
      State.updateNode(_currentId, { dueDate: dueInput().value || null });
    });

    colorInput().addEventListener("input", () => {
      if (_suppressUpdate || !_currentId) return;
      State.updateNode(_currentId, { color: colorInput().value });
    });

    document.getElementById("btn-clear-color").addEventListener("click", () => {
      if (!_currentId) return;
      colorInput().value = "#89b4fa";
      State.updateNode(_currentId, { color: null });
    });

    document.getElementById("btn-inherit-due").addEventListener("click", () => {
      if (!_currentId) return;
      const parentDue = document.getElementById("btn-inherit-due").dataset.parentDue;
      if (!parentDue) return;
      dueInput().value = parentDue;
      State.updateNode(_currentId, { dueDate: parentDue });
    });

    // Status buttons
    statusBtns().forEach(btn => {
      btn.addEventListener("click", () => {
        if (!_currentId) return;
        const newStatus = btn.dataset.status || null;
        State.updateNode(_currentId, { status: newStatus });
        statusBtns().forEach(b => b.classList.toggle("active", b.dataset.status === btn.dataset.status));
      });
    });

    document.getElementById("btn-close-detail").addEventListener("click", () => {
      State.deselectNode();
    });

    document.getElementById("btn-done-node").addEventListener("click", () => {
      State.deselectNode();
    });
  }

  // ── State subscriber ──────────────────────────────────────────────────

  function _onStateChange() {
    const selectedId = State.getSelectedId();

    // Auto-close if nothing is selected
    if (!selectedId) {
      _hide();
      return;
    }

    // If the modal is already open, keep it in sync with the current node
    if (!panel().classList.contains("hidden")) {
      const node = State.getNode(selectedId);
      if (!node) { _hide(); return; }
      _currentId = selectedId;
      _populate(node);
    }
  }

  // ── Public ────────────────────────────────────────────────────────────

  function open(id) {
    const node = State.getNode(id);
    if (!node) return;
    _currentId = id;
    _populate(node);
    _show();
    _pushRecent(id);
  }

  function focusTitleInput() {
    if (!panel().classList.contains("hidden")) {
      titleInput().focus();
      titleInput().select();
    }
  }

  function init() {
    _setupFieldListeners();
    _setupTagInput();
    _setupAttachmentButtons();
    _setupCrossLinkModal();
    _setupDeleteButton();

    // Close modal when clicking the backdrop (outside the card)
    panel().addEventListener("click", e => {
      if (e.target === panel()) State.deselectNode();
    });

    State.subscribe(_onStateChange);
    _renderRecents();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, open, focusTitleInput, openCrossLinkModal, renderRecentList: _renderRecents };
})();

document.addEventListener("DOMContentLoaded", () => Detail.init());
