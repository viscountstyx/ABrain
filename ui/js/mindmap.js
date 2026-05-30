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
      const today = new Date().toISOString().slice(0, 10);
      return {
        id:            n.id,
        title:         n.title,
        status:        n.status,
        priority:      n.priority,
        color:         n.color,
        overdue:       !!n.dueDate && n.dueDate < today && n.status !== "resolved",
        collapsed,
        hiddenChildCount: collapsed ? n.childIds.length : 0,
        crossMapLinks: n.crossMapLinks || [],
        relatedLinks:  n.relatedLinks  || [],
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

    // ── Bilateral mind-map layout ─────────────────────────────────────
    // Split root's children into right (first half) and left (second half)
    // so the map fans symmetrically from the centre like a traditional mind map.
    const allChildren = root.children || [];
    const nRight = Math.ceil(allChildren.length / 2);

    function _tagSide(node, side) {
      node._side = side;
      (node.children || []).forEach(c => _tagSide(c, side));
    }
    root._side = 'center';
    allChildren.slice(0, nRight).forEach(c => _tagSide(c, 'right'));
    allChildren.slice(nRight).forEach(c => _tagSide(c, 'left'));

    // nodeSize gives each node a fixed vertical slot → no crowding
    const V_SPACING = 52;   // vertical gap between sibling rows (px)
    const H_SPACING = 170;  // horizontal distance per depth level (px)
    d3.tree().nodeSize([V_SPACING, H_SPACING])(root);

    // d3.tree: d.x = vertical position, d.y = depth * H_SPACING
    // Map to screen: x_cart = horizontal, y_cart = vertical
    root.each(d => {
      const xSign = d._side === 'left' ? -1 : 1;
      d.x_cart = d.y * xSign;
      d.y_cart = d.x;
    });

    // Translate so root sits at (0, 0) in the centred group
    const rootXC = root.x_cart, rootYC = root.y_cart;
    root.each(d => { d.x_cart -= rootXC; d.y_cart -= rootYC; });

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
        return `node-circle ${statusClass}${priorityClass}${selected}${dimmed}${overdue}`;
      })
      .attr("r", d => d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2))
      .style("fill", d => d.data.color || null);

    // Labels
    nodeG.append("text")
      .attr("class", d => {
        const dimmed   = _dimmedIds.has(d.data.id) ? " dimmed" : "";
        const selected = d.data.id === selectedId ? " selected" : "";
        return "node-label" + dimmed + selected;
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

    // Hover "+" button — adds a child node on click
    nodeG.append("text")
      .attr("class", "node-add-btn")
      .attr("dx", d => {
        const r = d.depth === 0 ? 14 : Math.max(6, 11 - d.depth * 1.2);
        return d._side === 'left' ? -(r + 16) : (r + 16);
      })
      .attr("dy", 0)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .text("＋")
      .on("click", (e, d) => {
        e.stopPropagation();
        ContextMenu.hide();
        const newId = State.addNode(d.data.id, Settings.getDefaultNodeText());
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

    // Build a position map and deduplicate bidirectional pairs
    const pos = {};
    descendants.forEach(d => { pos[d.data.id] = { x: d.x_cart, y: d.y_cart }; });

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
        // Quadratic bezier arc that bows perpendicular to the straight line
        const mx = (sx + tx) / 2 - (ty - sy) * 0.25;
        const my = (sy + ty) / 2 + (tx - sx) * 0.25;

        relG.append("path")
          .attr("class", "related-link")
          .attr("d", `M${sx},${sy} Q${mx},${my} ${tx},${ty}`);

        if (link.label) {
          relG.append("text")
            .attr("class", "related-link-label")
            .attr("x", mx)
            .attr("y", my - 5)
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

      d.data.crossMapLinks.forEach((link, i) => {
        // Place ghost as a satellite above/below the host node on its outward side
        const ghostRadius = 55;
        const xSign = d._side === 'left' ? -1 : 1;
        const gx = d.x_cart + xSign * ghostRadius * 0.7;
        const gy = d.y_cart + (i % 2 === 0 ? -ghostRadius : ghostRadius) * 0.7;

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
