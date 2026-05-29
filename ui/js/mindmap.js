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
      const collapsed = _collapsedIds.has(id);
      return {
        id:            n.id,
        title:         n.title,
        status:        n.status,
        priority:      n.priority,
        color:         n.color,
        collapsed,
        hiddenChildCount: collapsed ? n.childIds.length : 0,
        crossMapLinks: n.crossMapLinks || [],
        children:      collapsed ? [] : n.childIds.map(buildNode).filter(Boolean),
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
    const nodeCount = root.descendants().length;

    // Scale radius by tree density — tighter base, slower growth
    const baseRadius = Math.min(_width, _height) * 0.28;
    const radius = nodeCount > 20 ? baseRadius * (1 + (nodeCount - 20) * 0.007) : baseRadius;

    // Radial tree layout — tighter separation
    const treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 0.7 : 1.1) / a.depth);

    treeLayout(root);

    // Polar → Cartesian
    root.each(d => {
      d.x_cart = d.y * Math.cos(d.x - Math.PI / 2);
      d.y_cart = d.y * Math.sin(d.x - Math.PI / 2);
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
        .attr("d", d3.linkRadial()
          .angle(d => d.x)
          .radius(d => d.y)
        );

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
        return `node-circle ${statusClass}${priorityClass}${selected}${dimmed}`;
      })
      .attr("r", d => d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2))
      .style("fill", d => d.data.color || null)
      .style("stroke", d => d.data.color || null);

    // Labels
    nodeG.append("text")
      .attr("class", d => "node-label" + (_dimmedIds.has(d.data.id) ? " dimmed" : ""))
      .attr("text-anchor", d => {
        if (d.depth === 0) return "middle";
        return d.x_cart > 0 ? "start" : "end";
      })
      .attr("dx", d => {
        if (d.depth === 0) return 0;
        const r = Math.max(6, 11 - d.depth * 1.2);
        return d.x_cart > 0 ? r + 4 : -(r + 4);
      })
      .attr("dy", d => d.depth === 0 ? 20 : 0)
      .attr("dominant-baseline", d => d.depth === 0 ? "hanging" : "central")
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
        return d.x_cart >= 0 ? r + 2 : -(r + 2);
      })
      .attr("dy", d => d.depth === 0 ? -6 : -8)
      .attr("text-anchor", d => d.x_cart >= 0 ? "start" : "end")
      .text(d => `+${d.data.hiddenChildCount}`);

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

  // ── Ghost nodes ───────────────────────────────────────────────────────

  function _renderGhostNodes(g, descendants) {
    const ghostG = g.append("g").attr("class", "ghosts");

    descendants.forEach(d => {
      if (!d.data.crossMapLinks || d.data.crossMapLinks.length === 0) return;

      d.data.crossMapLinks.forEach((link, i) => {
        // Place ghost as a satellite at an angular offset from the host node
        const angleOffset = (Math.PI / 4) + i * (Math.PI / 6);
        const ghostRadius = 60;
        const gx = d.x_cart + ghostRadius * Math.cos(d.x - Math.PI / 2 + angleOffset);
        const gy = d.y_cart + ghostRadius * Math.sin(d.x - Math.PI / 2 + angleOffset);

        // Dashed link from host to ghost
        ghostG.append("line")
          .attr("class", "ghost-link")
          .attr("x1", d.x_cart).attr("y1", d.y_cart)
          .attr("x2", gx).attr("y2", gy)
          .attr("stroke", STATUS_COLOR[null]);

        // Ghost circle — fill:transparent so the whole interior is clickable
        const ghostEl = ghostG.append("circle")
          .attr("class", "ghost-circle")
          .attr("cx", gx).attr("cy", gy)
          .attr("r", 12)
          .attr("stroke", "var(--accent)")
          .style("cursor", "pointer");

        // Tooltip (updated async)
        ghostEl.append("title").text("Loading…");

        // Visible label below the ghost circle (updated async)
        const ghostLabel = ghostG.append("text")
          .attr("x", gx)
          .attr("y", gy + 22)
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("fill", "var(--accent)")
          .attr("opacity", 0.75)
          .style("pointer-events", "none")
          .text("…");

        // Load title asynchronously
        window.pywebview.api.get_node_title(link.mapId, link.nodeId)
          .then(res => {
            const mapMeta = Maps.getMaps().find(m => m.id === link.mapId);
            const mapName = mapMeta ? mapMeta.name : "?";
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

        // Small arrow icon (non-interactive)
        ghostG.append("text")
          .attr("x", gx).attr("y", gy)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("fill", "var(--accent)")
          .attr("font-size", "10px")
          .style("pointer-events", "none")
          .text("↗");
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
    const k = 0.85;
    _svg.transition().duration(400)
      .call(_zoom.transform, d3.zoomIdentity
        .translate(_width / 2 * (1 - k), _height / 2 * (1 - k))
        .scale(k));
  }

  // ── Dim control (from search/filter) ─────────────────────────────────

  function setDimmed(idSet) {
    _dimmedIds = idSet || new Set();
    render();
  }

  return { init, render, focusNode, fitToScreen, setDimmed };
})();

// ── Initialise once DOM is ready (called after bridge bootstraps state) ──
document.addEventListener("DOMContentLoaded", () => MindMap.init());
