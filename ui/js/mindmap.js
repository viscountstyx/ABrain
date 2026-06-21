/**
 * mindmap.js — D3-powered radial mind map renderer.
 *
 * Renders the active map as a radial tree using d3-hierarchy.
 * Handles: node circles (coloured by status), labels, links,
 * ghost nodes for cross-map links, zoom/pan, node interactions.
 */

const MindMap = (() => {
  const SVG_SEL  = "#mindmap-svg";
  const ROOT_SEL = "#mindmap-root";

  let _svg, _root, _zoom;
  let _width = 800, _height = 600;
  let _dimmedIds   = new Set(); // node IDs to dim (from search/filter)
  let _highlightId = null;      // node to pan to
  let _collapsedIds = new Set(); // node IDs whose children are hidden
  let _showHidden  = false;      // when true, manually-hidden resolved nodes are shown
  let _lastMapId   = null;       // detect map changes for auto-fit

  const COLLAPSED_KEY = "abrain-collapsed";

  const STATUS_COLOR = {
    null:      "var(--node-none)",
    started:   "var(--node-started)",
    blocked:   "var(--node-blocked)",
    paused:    "var(--node-paused)",
    resolved:  "var(--node-resolved)",
  };

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    _svg  = d3.select(SVG_SEL);
    _root = d3.select(ROOT_SEL);

    // Measure the canvas container
    _resize();
    window.addEventListener("resize", () => { _resize(); render(); });

    // Zoom behaviour
    _zoom = d3.zoom()
      .scaleExtent([0.15, 4])
      .on("zoom", e => _root.attr("transform", e.transform));

    _svg.call(_zoom);
    _svg.on("dblclick.zoom", null); // prevent zoom on double-click

    // Click on SVG background → deselect
    _svg.on("click", e => {
      if (e.target === _svg.node() || e.target.id === "mindmap-svg") {
        State.deselectNode();
        ContextMenu.hide();
      }
    });

    // Prevent browser context menu on the SVG
    _svg.on("contextmenu", e => e.preventDefault());

    // Toolbar zoom buttons
    document.getElementById("btn-zoom-in").addEventListener("click",
      () => _svg.transition().duration(250).call(_zoom.scaleBy, 1.3));
    document.getElementById("btn-zoom-out").addEventListener("click",
      () => _svg.transition().duration(250).call(_zoom.scaleBy, 0.77));
    document.getElementById("btn-zoom-fit").addEventListener("click", fitToScreen);

    // Empty-state button
    document.getElementById("btn-add-root-node").addEventListener("click", () => {
      const rootId = State.getRootNodeId();
      if (rootId) {
        const newId = State.addNode(rootId, "New thought");
        Detail.open(newId);
      }
    });

    // Subscribe to state changes
    State.subscribe(() => { _loadCollapsed(); render(); });
    _loadCollapsed();

    // Un-hide recurring nodes when their hiddenUntil time arrives (check every minute)
    setInterval(() => {
      const now = new Date();
      Object.values(State.getAllNodes()).forEach(n => {
        if (n.hiddenUntil && new Date(n.hiddenUntil) <= now) {
          State.updateNode(n.id, { hiddenUntil: null });
        }
      });
    }, 60_000);
  }

  function _resize() {
    const el = document.getElementById("canvas-area");
    if (!el) return;
    const toolbar   = document.getElementById("canvas-toolbar");
    const filterBar = document.getElementById("filter-bar");
    const toolbarH  = toolbar   ? toolbar.clientHeight   : 0;
    const filterH   = filterBar && !filterBar.classList.contains("hidden") ? filterBar.clientHeight : 0;
    _width  = el.clientWidth;
    _height = el.clientHeight - toolbarH - filterH;
  }

  // ── Collapse persistence ──────────────────────────────────────────────

  function _loadCollapsed() {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}");
      const mapId = State.getMapId();
      _collapsedIds = new Set(saved[mapId] || []);
    } catch { _collapsedIds = new Set(); }
  }

  function _saveCollapsed() {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}");
      saved[State.getMapId()] = [..._collapsedIds];
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(saved));
    } catch {}
  }

  function _toggleCollapse(nodeId) {
    if (_collapsedIds.has(nodeId)) _collapsedIds.delete(nodeId);
    else _collapsedIds.add(nodeId);
    _saveCollapsed();
    render();
  }

  // ── Build D3 hierarchy from flat node store ───────────────────────────

  function _buildHierarchy() {
    const rootId = State.getRootNodeId();
    if (!rootId) return null;
    const nodes = State.getAllNodes();

    function buildNode(id) {
      const n = nodes[id];
      if (!n) return null;
      // Skip expired calendar events
      if (n.nodeType === "calendar" && n.calEnd && new Date(n.calEnd) < new Date()) return null;
      // Skip recurring nodes waiting for their next instance (unless show-hidden is on)
      const isWaiting = !!(n.hiddenUntil && new Date(n.hiddenUntil) > new Date());
      if (isWaiting && !_showHidden) return null;
      // Skip manually-hidden nodes unless "show hidden" is active
      if (n.manuallyHidden && !_showHidden) return null;
      const collapsed = _collapsedIds.has(id);
      const today = new Date().toISOString().slice(0, 10);
      return {
        id:             n.id,
        title:          n.title,
        status:         n.status,
        priority:       n.priority,
        color:          n.color,
        nodeType:       n.nodeType       || null,
        recurrenceType: n.recurrenceType || null,
        manuallyHidden: n.manuallyHidden || null,
        hiddenUntil:    n.hiddenUntil    || null,
        isWaiting,
        overdue:        !!n.dueDate && n.dueDate < today && n.status !== "resolved",
        collapsed,
        hiddenChildCount: collapsed ? n.childIds.length : 0,
        crossMapLinks:  n.crossMapLinks || [],
        relatedLinks:   n.relatedLinks  || [],
        children:       collapsed ? [] : n.childIds.map(buildNode).filter(Boolean),
      };
    }
    return buildNode(rootId);
  }

  // ── Main render ───────────────────────────────────────────────────────

  function render() {
    if (!_svg) return;
    _root.selectAll("*").remove();

    const hierarchyData = _buildHierarchy();
    const selectedId = State.getSelectedId();

    // Empty state
    const empty = State.isEmpty();
    document.getElementById("empty-state").classList.toggle("hidden", !empty);
    if (empty) return;

    if (!hierarchyData) return;

    const root = d3.hierarchy(hierarchyData);

    // Auto-fit when the active map changes
    const currentMapId = State.getMapId();
    const mapChanged = currentMapId !== _lastMapId;
    _lastMapId = currentMapId;

    // ── Bilateral mind-map layout ─────────────────────────────────────

    // Helper: count leaf nodes reachable from a d3 hierarchy node.
    // Collapsed nodes have no children in the hierarchy, so they count as 1.
    function _subtreeLeaves(node) {
      if (!node.children || node.children.length === 0) return 1;
      return node.children.reduce((s, c) => s + _subtreeLeaves(c), 0);
    }

    const allChildren = root.children || [];

    // Weight-balanced bilateral split: scan every possible split index
    // (preserving insertion order) and pick the one that minimises the
    // difference in leaf count between the two arms.
    let nRight = Math.ceil(allChildren.length / 2);
    if (allChildren.length > 1) {
      const weights  = allChildren.map(c => _subtreeLeaves(c));
      const total    = weights.reduce((a, b) => a + b, 0);
      let bestDiff   = Infinity, cumLeft = 0;
      for (let i = 1; i < allChildren.length; i++) {
        cumLeft += weights[i - 1];
        const diff = Math.abs(cumLeft - (total - cumLeft));
        if (diff < bestDiff) { bestDiff = diff; nRight = i; }
      }
    }

    function _tagSide(node, side) {
      node._side = side;
      (node.children || []).forEach(c => _tagSide(c, side));
    }
    root._side = 'center';
    allChildren.slice(0, nRight).forEach(c => _tagSide(c, 'right'));
    allChildren.slice(nRight).forEach(c => _tagSide(c, 'left'));

    // V_SPACING: base it on the heavier arm's leaf count, not the total.
    // With per-arm centering (below) the visible height is maxArmLeaves×VS,
    // so that is the quantity that must fit the canvas — not totalLeaves×VS.
    const rightLeaves  = allChildren.slice(0, nRight).reduce((s, c) => s + _subtreeLeaves(c), 0);
    const leftLeaves   = allChildren.slice(nRight).reduce((s, c) => s + _subtreeLeaves(c), 0);
    const maxArmLeaves = Math.max(rightLeaves, leftLeaves, 1);
    const V_SPACING    = Math.max(24, Math.min(52, Math.floor((_height * 0.88) / maxArmLeaves)));
    const H_SPACING    = 170;  // horizontal distance per depth level (px)
    d3.tree().nodeSize([V_SPACING, H_SPACING])(root);

    // Map d3.tree coordinates → Cartesian screen coordinates.
    // d.y is depth × H_SPACING (horizontal); d.x is the vertical slot.
    root.each(d => {
      const xSign = d._side === 'left' ? -1 : 1;
      d.x_cart = d.y * xSign;
      d.y_cart = d.x;
    });

    // Translate so root sits at (0, 0).
    const rootXC = root.x_cart, rootYC = root.y_cart;
    root.each(d => { d.x_cart -= rootXC; d.y_cart -= rootYC; });

    // Per-arm vertical centering: d3.tree assigns sequential positions to ALL
    // leaves together, so the arms are stacked (right arm above root, left arm
    // below) rather than mirrored. Fix: shift each arm independently so its
    // vertical midpoint lands at y=0, giving a true bilateral mind-map layout.
    ['right', 'left'].forEach(side => {
      const arm = root.descendants().filter(d => d._side === side);
      if (arm.length === 0) return;
      const ys  = arm.map(d => d.y_cart);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      arm.forEach(d => { d.y_cart -= mid; });
    });

    // Centre the tree in the SVG
    const g = _root.append("g")
      .attr("transform", `translate(${_width / 2},${_height / 2})`);

    // ── Links ──
    g.append("g").attr("class", "links")
      .selectAll("path")
      .data(root.links())
      .join("path")
        .attr("class", d => {
          const dimmed = _dimmedIds.has(d.target.data.id) || _dimmedIds.has(d.source.data.id);
          return "node-link" + (dimmed ? " dimmed" : "");
        })
        .attr("d", d => {
          const sx = d.source.x_cart, sy = d.source.y_cart;
          const tx = d.target.x_cart, ty = d.target.y_cart;
          const mx = (sx + tx) / 2;
          return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
        });

    // ── Nodes ──
    const nodeG = g.append("g").attr("class", "nodes")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
        .attr("class", "node-group")
        .attr("transform", d => `translate(${d.x_cart},${d.y_cart})`)
        .style("cursor", "pointer");

    // Node circles
    nodeG.append("circle")
      .attr("class", d => {
        const statusClass   = "status-" + (d.data.status || "none");
        const priorityClass = d.data.priority ? ` priority-${d.data.priority}` : "";
        const selected      = d.data.id === selectedId ? " selected" : "";
        const dimmed        = _dimmedIds.has(d.data.id) ? " dimmed" : "";
        const overdue       = d.data.overdue ? " overdue" : "";
        const calClass      = d.data.nodeType === "calendar" ? " node-calendar" : "";
        const recurClass    = d.data.recurrenceType ? " node-recurring" : "";
        const hiddenClass   = d.data.manuallyHidden ? " node-manually-hidden" : "";
        const waitingClass  = d.data.isWaiting ? " node-hidden-until" : "";
        return `node-circle ${statusClass}${priorityClass}${selected}${dimmed}${overdue}${calClass}${recurClass}${hiddenClass}${waitingClass}`;
      })
      .attr("r", d => d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2))
      .style("fill", d => d.data.color || null);

    // Labels
    nodeG.append("text")
      .attr("class", d => {
        const dimmed      = _dimmedIds.has(d.data.id) ? " dimmed" : "";
        const selected    = d.data.id === selectedId ? " selected" : "";
        const hiddenClass = d.data.manuallyHidden ? " node-manually-hidden" : "";
        const waitingClass = d.data.isWaiting ? " node-hidden-until" : "";
        return "node-label" + dimmed + selected + hiddenClass + waitingClass;
      })
      .attr("text-anchor", d => {
        if (d.depth === 0) return "middle";
        return d._side === 'left' ? "end" : "start";
      })
      .attr("dx", d => {
        if (d.depth === 0) return 0;
        const r = Math.max(6, 11 - d.depth * 1.2);
        return d._side === 'left' ? -(r + 6) : (r + 6);
      })
      .attr("dy", d => d.depth === 0 ? -(14 + 6) : 0)
      .attr("dominant-baseline", d => d.depth === 0 ? "auto" : "central")
      .text(d => {
        const max = Settings.getNodeLabelLength();
        return d.data.title.length > max ? d.data.title.slice(0, max) + "…" : d.data.title;
      });

    // Tooltips (title attribute)
    nodeG.append("title").text(d => {
      const suffix = d.data.collapsed && d.data.hiddenChildCount > 0
        ? ` [${d.data.hiddenChildCount} hidden — Ctrl+click to expand]`
        : (d.data.childIds?.length > 0 && d.depth > 0 ? " [Ctrl+click to collapse]" : "");
      return d.data.title + suffix;
    });

    // Collapse badge (shown when node has hidden children)
    nodeG.filter(d => d.data.collapsed && d.data.hiddenChildCount > 0)
      .append("text")
      .attr("class", "collapse-badge")
      .attr("dx", d => {
        const r = Math.max(6, 11 - d.depth * 1.2);
        return d._side === 'left' ? -(r + 2) : (r + 2);
      })
      .attr("dy", -8)
      .attr("text-anchor", d => d._side === 'left' ? "end" : "start")
      .text(d => `+${d.data.hiddenChildCount}`);

    // ── Floating add-child button (separate layer → always on top) ─────────────
    const _addOverlay = g.append("g");
    const _addBtnEl   = _addOverlay.append("text")
      .attr("class", "node-add-btn-float")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .style("opacity", 0)
      .style("pointer-events", "none")
      .text("＋");
    let _hoveredAddNode = null;
    let _addHideTimer   = null;
    function _schedAddHide() {
      _addHideTimer = setTimeout(() => {
        _addBtnEl.style("opacity", 0).style("pointer-events", "none");
        _hoveredAddNode = null;
      }, 120);
    }
    nodeG
      .on("mouseenter.addbtn", (e, d) => {
        if (_addHideTimer) { clearTimeout(_addHideTimer); _addHideTimer = null; }
        _hoveredAddNode = d;
        const r = d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2);
        _addBtnEl
          .attr("x", d.x_cart)
          .attr("y", d.y_cart - (r + 13))
          .style("opacity", 1)
          .style("pointer-events", "all");
      })
      .on("mouseleave.addbtn", _schedAddHide);
    _addBtnEl
      .on("mouseenter", () => { if (_addHideTimer) { clearTimeout(_addHideTimer); _addHideTimer = null; } })
      .on("mouseleave", _schedAddHide)
      .on("click", e => {
        e.stopPropagation();
        if (!_hoveredAddNode) return;
        ContextMenu.hide();
        const newId = State.addNode(_hoveredAddNode.data.id, Settings.getDefaultNodeText());
        Detail.open(newId);
        setTimeout(() => Detail.focusTitleInput(), 30);
      });

    // ── Related links (same-map lateral connections) ──
    _renderRelatedLinks(g, root.descendants());

    // ── Ghost nodes (cross-map links) ──
    _renderGhostNodes(g, root.descendants());

    // ── Interaction ──
    nodeG
      .on("click", (e, d) => {
        e.stopPropagation();
        ContextMenu.hide();
        // Ctrl+click toggles collapse; plain click always opens detail
        if (e.ctrlKey) {
          const hasChildren = (State.getNode(d.data.id)?.childIds?.length || 0) > 0;
          if (hasChildren && d.depth > 0) {
            _toggleCollapse(d.data.id);
            return;
          }
        }
        State.selectNode(d.data.id);
        Detail.open(d.data.id);
      })
      .on("dblclick", (e, d) => {
        e.stopPropagation();
        State.selectNode(d.data.id);
        Detail.open(d.data.id);
        setTimeout(() => Detail.focusTitleInput(), 20);
      })
      .on("contextmenu", (e, d) => {
        e.preventDefault();
        e.stopPropagation();
        State.selectNode(d.data.id);
        ContextMenu.show(e.clientX, e.clientY, d.data.id);
      })
      .call(_makeDrag(root));

    // Auto-fit when the map changes (new map opened or first load)
    if (mapChanged) setTimeout(fitToScreen, 50);
  }

  // ── Drag-to-reparent ──────────────────────────────────────────────────

  function _makeDrag(root) {
    let _dragNodeId   = null;
    let _dropTargetId = null;
    let _dragEl       = null;

    function _nodeAtPoint(svgEl, x, y, excludeId) {
      let best = null, bestDist = 40; // snap radius px
      root.descendants().forEach(d => {
        if (d.data.id === excludeId) return;
        const t = d3.zoomTransform(svgEl);
        const sx = t.x + t.k * (_width  / 2 + d.x_cart);
        const sy = t.y + t.k * (_height / 2 + d.y_cart);
        const dist = Math.hypot(sx - x, sy - y);
        if (dist < bestDist) { bestDist = dist; best = d; }
      });
      return best;
    }

    const DRAG_THRESHOLD = 8; // px — ignore tiny mouse wobbles
    let _dragMoved = false;

    return d3.drag()
      .filter(e => !e.ctrlKey && !e.button) // Ctrl+click is collapse, not drag
      .on("start", function(e, d) {
        if (d.depth === 0) return; // root not draggable
        _dragMoved = false;
        _dragNodeId = d.data.id;
        _dragEl = d3.select(this);
        // Don't stopPropagation here — that was blocking click events
      })
      .on("drag", function(e, d) {
        if (!_dragNodeId) return;
        const dist = Math.hypot(e.dx, e.dy);
        if (!_dragMoved && dist < DRAG_THRESHOLD) return; // ignore tiny movements
        _dragMoved = true;
        _dragEl.raise().classed("dragging", true);
        // Move the dragged group visually
        _dragEl.attr("transform", `translate(${d.x_cart + e.dx},${d.y_cart + e.dy})`);
        d.x_cart += e.dx;
        d.y_cart += e.dy;
        // Highlight nearest valid drop target
        const candidate = _nodeAtPoint(_svg.node(), e.sourceEvent.clientX, e.sourceEvent.clientY, _dragNodeId);
        if (candidate && candidate.data.id !== _dropTargetId) {
          _svg.selectAll(".node-circle").classed("drop-target", false);
          _dropTargetId = candidate.data.id;
          _svg.selectAll(".node-group")
            .filter(nd => nd.data.id === _dropTargetId)
            .select("circle").classed("drop-target", true);
        } else if (!candidate) {
          _svg.selectAll(".node-circle").classed("drop-target", false);
          _dropTargetId = null;
        }
      })
      .on("end", function(e) {
        if (!_dragNodeId) return;
        _dragEl.classed("dragging", false);
        _svg.selectAll(".node-circle").classed("drop-target", false);
        if (_dragMoved && _dropTargetId && _dropTargetId !== _dragNodeId) {
          State.moveNode(_dragNodeId, _dropTargetId);
        } else if (_dragMoved) {
          render(); // revert visual position if dropped on nothing
        }
        _dragNodeId = _dropTargetId = _dragEl = null;
        _dragMoved = false;
      });
  }

  // ── Related links (same-map lateral connections) ──────────────────────

  function _renderRelatedLinks(g, descendants) {
    const relG = g.insert("g", ".nodes").attr("class", "related-links");

    // Build a position map that also carries the node's arm side.
    const pos = {};
    descendants.forEach(d => {
      pos[d.data.id] = { x: d.x_cart, y: d.y_cart, side: d._side || 'center' };
    });

    const drawn = new Set();
    descendants.forEach(d => {
      (d.data.relatedLinks || []).forEach(link => {
        const pairKey = [d.data.id, link.targetId].sort().join("\0");
        if (drawn.has(pairKey)) return;
        drawn.add(pairKey);

        const tp = pos[link.targetId];
        if (!tp) return;

        const sx = d.x_cart, sy = d.y_cart;
        const tx = tp.x,     ty = tp.y;
        const srcSide = pos[d.data.id].side;
        const tgtSide = tp.side;

        let mx, my;
        if (srcSide === tgtSide && srcSide !== 'center') {
          // Same arm: the default perpendicular-bow formula bows INWARD, routing
          // the arc straight through the tree.  Instead, bow OUTWARD so the link
          // clears all nodes cleanly.
          const bowDir = srcSide === 'right' ? 1 : -1;
          mx = (sx + tx) / 2 + bowDir * Math.abs(ty - sy) * 0.4;
          my = (sy + ty) / 2;
        } else {
          // Cross-arm or either end at root: perpendicular bow (original formula).
          mx = (sx + tx) / 2 - (ty - sy) * 0.25;
          my = (sy + ty) / 2 + (tx - sx) * 0.25;
        }

        relG.append("path")
          .attr("class", "related-link")
          .attr("d", `M${sx},${sy} Q${mx},${my} ${tx},${ty}`);

        if (link.label) {
          // Place label at the actual midpoint of the quadratic bezier (t=0.5),
          // not at the control point, which can be far off the visible curve.
          const lx = 0.25 * sx + 0.5 * mx + 0.25 * tx;
          const ly = 0.25 * sy + 0.5 * my + 0.25 * ty;
          relG.append("text")
            .attr("class", "related-link-label")
            .attr("x", lx)
            .attr("y", ly - 5)
            .attr("text-anchor", "middle")
            .text(link.label);
        }
      });
    });
  }

  // ── Ghost nodes ───────────────────────────────────────────────────────

  function _renderGhostNodes(g, descendants) {
    const ghostG = g.append("g").attr("class", "ghosts");

    descendants.forEach(d => {
      if (!d.data.crossMapLinks || d.data.crossMapLinks.length === 0) return;

      const xSign  = d._side === 'left' ? -1 : 1;
      const hostR  = d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2);
      const ghostR = 10;
      const nLinks = d.data.crossMapLinks.length;

      d.data.crossMapLinks.forEach((link, i) => {
        // Stack ghosts horizontally outward from the host (beyond the host
        // circle), distributed vertically and centred on the host's y position.
        // This keeps ghosts well clear of sibling nodes in the tree.
        const gx = d.x_cart + xSign * (hostR + ghostR + 18);
        const gy = d.y_cart + (i - (nLinks - 1) / 2) * 24;

        // Dashed link from host to ghost
        ghostG.append("line")
          .attr("class", "ghost-link")
          .attr("x1", d.x_cart).attr("y1", d.y_cart)
          .attr("x2", gx).attr("y2", gy)
          .attr("stroke", STATUS_COLOR[null]);

        // Ghost circle
        const ghostEl = ghostG.append("circle")
          .attr("class", "ghost-circle")
          .attr("cx", gx).attr("cy", gy)
          .attr("r", ghostR)
          .attr("stroke", "var(--accent)")
          .style("cursor", "pointer");

        // SVG tooltip (updated once title loads)
        ghostEl.append("title").text("Loading…");

        // Label on the outward side of the ghost circle, matching the host's
        // side convention so it never overlaps the tree content.
        const ghostLabel = ghostG.append("text")
          .attr("x", gx + xSign * (ghostR + 5))
          .attr("y", gy)
          .attr("text-anchor", xSign > 0 ? "start" : "end")
          .attr("dominant-baseline", "central")
          .attr("font-size", "9px")
          .attr("fill", "var(--accent)")
          .attr("opacity", 0.75)
          .style("pointer-events", "none")
          .text("…");

        // Arrow icon centred in the ghost circle
        ghostG.append("text")
          .attr("x", gx).attr("y", gy)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("fill", "var(--accent)")
          .attr("font-size", "9px")
          .style("pointer-events", "none")
          .text("↗");

        // Load remote node title asynchronously
        window.pywebview.api.get_node_title(link.mapId, link.nodeId)
          .then(res => {
            const mapMeta   = Maps.getMaps().find(m => m.id === link.mapId);
            const mapName   = mapMeta ? mapMeta.name : "?";
            const nodeTitle = res.title || "(unknown)";
            ghostEl.select("title").text(`${mapName} → ${nodeTitle}`);
            const truncated = nodeTitle.length > 14 ? nodeTitle.slice(0, 14) + "…" : nodeTitle;
            ghostLabel.text(truncated);
          })
          .catch(() => { ghostLabel.text("?"); });

        // Click ghost → navigate to linked node
        ghostEl.on("click", e => {
          e.stopPropagation();
          Maps.navigateTo(link.mapId, link.nodeId);
        });
      });
    });
  }

  // ── Zoom to a specific node ───────────────────────────────────────────

  function focusNode(nodeId) {
    // Re-render first so we can find the DOM element
    render();
    // Pan to the selected node group
    _svg.selectAll(".node-group").each(function(d) {
      if (d.data.id === nodeId) {
        const transform = d3.zoomTransform(_svg.node());
        // Nodes are in a group offset by (_width/2, _height/2), so canvas
        // position = (_width/2 + x_cart, _height/2 + y_cart). Solve for the
        // zoom translate that places that point at screen centre.
        const cx = _width  / 2 - transform.k * (_width  / 2 + d.x_cart);
        const cy = _height / 2 - transform.k * (_height / 2 + d.y_cart);
        _svg.transition().duration(450)
          .call(_zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(transform.k));
      }
    });
  }

  function fitToScreen() {
    const pad = 50;
    const pts = [];
    _root.selectAll(".node-group").each(d => pts.push([d.x_cart, d.y_cart]));
    // Ghost nodes extend beyond the tree bounding box — include them so they
    // are never clipped after a fit-to-screen.
    _root.selectAll(".ghost-circle").each(function() {
      pts.push([+d3.select(this).attr("cx"), +d3.select(this).attr("cy")]);
    });
    if (pts.length === 0) {
      _svg.transition().duration(400)
        .call(_zoom.transform, d3.zoomIdentity.translate(_width / 2, _height / 2));
      return;
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const treeW = (maxX - minX) || 1;
    const treeH = (maxY - minY) || 1;
    const k  = Math.min(0.95, Math.min((_width - pad * 2) / treeW, (_height - pad * 2) / treeH));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // The render group is offset by (width/2, height/2), so:
    // screen_pos = translate + k × (width/2 + x_cart, height/2 + y_cart)
    // Solve for translate that centres the bounding box midpoint on screen:
    const tx = _width  / 2 * (1 - k) - k * cx;
    const ty = _height / 2 * (1 - k) - k * cy;
    _svg.transition().duration(400)
      .call(_zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  // ── Dim control (from search/filter) ─────────────────────────────────

  function setDimmed(idSet) {
    _dimmedIds = idSet || new Set();
    render();
  }

  function setShowHidden(val) {
    _showHidden = !!val;
    render();
  }

  function getShowHidden() {
    return _showHidden;
  }

  return { init, render, focusNode, fitToScreen, setDimmed, setShowHidden, getShowHidden };
})();

// ── Initialise once DOM is ready (called after bridge bootstraps state) ──
document.addEventListener("DOMContentLoaded", () => MindMap.init());
