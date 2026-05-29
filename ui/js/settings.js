/**
 * settings.js — Application settings modal.
 *
 * Tabs:
 *  • Interface    — appearance, behaviour, panel visibility, history
 *  • Data & Maps  — map list, broken-link scanner, maintenance actions
 *  • Integrations — Jira + Calendar credentials
 */

const Settings = (() => {
  let _config = null;
  let _ui = {};  // always in sync with loaded/saved config; used by getters

  const FONT_SIZES = { small: "12px", medium: "14px", large: "16px" };

  // ── Public getters (consumed by other modules) ────────────────────────

  function getAutosaveDelay()   { return _ui.autosaveDelay   ?? 1200;           }
  function getNodeLabelLength() { return _ui.nodeLabelLength ?? 26;             }
  function getMaxRecentItems()  { return _ui.maxRecentItems  ?? 8;              }
  function getDefaultNodeText() { return _ui.defaultNodeText || "New thought";  }
  function getConfirmDelete()   { return _ui.confirmDelete   !== false;         }
  function getAutoFit()         { return _ui.autoFit         === true;          }

  // ── Apply saved UI settings to the DOM ───────────────────────────────

  function applyUiSettings(ui = {}) {
    _ui = { ...ui };

    // Font size
    document.documentElement.style.fontSize =
      FONT_SIZES[ui.fontSize] || FONT_SIZES.medium;

    // Agenda panel
    document.getElementById("app")
      .classList.toggle("no-agenda", ui.showAgenda === false);

    // Sidebar sections
    const tasksEl  = document.getElementById("tasks-section");
    const recentEl = document.getElementById("recent-section");
    if (tasksEl)  tasksEl.classList.toggle("hidden",  ui.showTasks  === false);
    if (recentEl) recentEl.classList.toggle("hidden", ui.showRecent === false);
  }

  // ── Open / close ──────────────────────────────────────────────────────

  async function open(tab = "interface") {
    _config = await window.pywebview.api.load_config();
    _populateFields();
    _switchTab(tab);
    document.getElementById("settings-broken-links-result").innerHTML = "";
    document.getElementById("btn-fix-broken-links").classList.add("hidden");
    document.getElementById("settings-old-maps-result").innerHTML = "";
    document.getElementById("btn-delete-old-maps").classList.add("hidden");
    document.getElementById("settings-data-feedback").textContent = "";
    _oldMapIds = [];
    document.getElementById("settings-modal").classList.remove("hidden");
  }

  function close() {
    document.getElementById("settings-modal").classList.add("hidden");
  }

  // ── Populate form fields ──────────────────────────────────────────────

  function _populateFields() {
    const ui   = _config.ui       || {};
    const jira = _config.jira     || {};
    const cal  = _config.calendar || {};

    // Appearance
    document.getElementById("settings-font-size").value         = ui.fontSize        || "medium";
    const lblLen = ui.nodeLabelLength ?? 26;
    document.getElementById("settings-label-length").value      = lblLen;
    document.getElementById("settings-label-length-display").textContent = `${lblLen} chars`;

    // Behaviour
    const delay = ui.autosaveDelay ?? 1200;
    document.getElementById("settings-autosave").value          = delay;
    document.getElementById("settings-autosave-display").textContent = `${delay}ms`;
    document.getElementById("settings-default-node-text").value = ui.defaultNodeText || "";
    document.getElementById("settings-confirm-delete").checked  = ui.confirmDelete   !== false;
    document.getElementById("settings-auto-fit").checked        = ui.autoFit         === true;

    // Panels
    document.getElementById("settings-show-agenda").checked     = ui.showAgenda  !== false;
    document.getElementById("settings-show-tasks").checked      = ui.showTasks   !== false;
    document.getElementById("settings-show-recent").checked     = ui.showRecent  !== false;

    // History
    document.getElementById("settings-max-recent").value        = ui.maxRecentItems ?? 8;

    // Integrations
    document.getElementById("settings-int-jira-url").value      = jira.url      || "";
    document.getElementById("settings-int-jira-user").value     = jira.username || "";
    document.getElementById("settings-int-jira-token").value    = jira.token    || "";
    document.getElementById("settings-int-cal-url").value       = cal.icsUrl    || "";
    document.getElementById("settings-int-cal-days").value      = String(cal.lookaheadDays ?? 7);
  }

  // ── Tab switching ─────────────────────────────────────────────────────

  function _switchTab(tab) {
    document.querySelectorAll(".settings-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".settings-panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== `settings-panel-${tab}`);
    });
    if (tab === "data") _loadDataTab();
  }

  // ── Data & Maps tab ───────────────────────────────────────────────────

  async function _loadDataTab() {
    const el = document.getElementById("settings-maps-list");
    el.innerHTML = "<div class='settings-loading'>Loading…</div>";
    try {
      const result = await window.pywebview.api.get_map_stats();
      _renderMapStats(result.maps || []);
    } catch (e) {
      el.innerHTML = "<div class='settings-error'>Failed to load map stats.</div>";
    }
    _refreshBrokenCount();
  }

  async function _refreshBrokenCount() {
    const countEl = document.getElementById("settings-broken-count");
    if (!countEl) return;
    try {
      const result = await window.pywebview.api.scan_broken_links();
      const n = (result.broken || []).length;
      if (n > 0) {
        countEl.textContent = n;
        countEl.title = `${n} broken link${n !== 1 ? "s" : ""} found`;
        countEl.className = "settings-broken-count settings-broken-count--warn";
      } else {
        countEl.textContent = "";
        countEl.className = "settings-broken-count";
      }
    } catch {
      countEl.textContent = "";
    }
  }

  function _renderMapStats(maps) {
    const el = document.getElementById("settings-maps-list");
    if (!maps.length) {
      el.innerHTML = "<div class='settings-empty'>No maps found.</div>";
      return;
    }
    const activeId = Maps.getActiveId();
    el.innerHTML = maps.map(m => {
      const isActive  = m.id === activeId;
      const nodeLabel = `${m.nodeCount} node${m.nodeCount !== 1 ? "s" : ""}`;
      const updated   = m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : "";
      return `
        <div class="settings-map-row" data-id="${_esc(m.id)}">
          <div class="settings-map-info">
            <span class="settings-map-name">${_esc(m.name)}</span>
            <span class="settings-map-meta">${nodeLabel}${updated ? " · " + updated : ""}</span>
          </div>
          <div class="settings-map-actions">
            ${isActive
              ? `<span class="settings-map-active">active</span>`
              : `<button class="settings-map-delete" data-id="${_esc(m.id)}" title="Delete map">✕</button>`
            }
          </div>
        </div>`;
    }).join("");

    el.querySelectorAll(".settings-map-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id   = btn.dataset.id;
        const row  = el.querySelector(`.settings-map-row[data-id="${id}"]`);
        const name = row ? row.querySelector(".settings-map-name").textContent : id;
        if (!confirm(`Delete map "${name}"?\n\nThis cannot be undone.`)) return;
        await Maps.deleteMap(id);
        _loadDataTab();
      });
    });
  }

  // ── Old maps scan / delete ────────────────────────────────────────────

  let _oldMapIds = [];  // populated by scan, consumed by delete

  async function _scanOldMaps() {
    const resultEl = document.getElementById("settings-old-maps-result");
    const scanBtn  = document.getElementById("btn-scan-old-maps");
    const delBtn   = document.getElementById("btn-delete-old-maps");
    const days     = parseInt(document.getElementById("settings-old-maps-days").value, 10);

    scanBtn.disabled = true;
    scanBtn.textContent = "Searching…";
    resultEl.innerHTML = "";
    delBtn.classList.add("hidden");
    _oldMapIds = [];

    try {
      const result = await window.pywebview.api.get_old_maps(days);
      const maps = result.maps || [];
      scanBtn.disabled = false;
      scanBtn.textContent = "Find old maps";

      if (!maps.length) {
        resultEl.innerHTML = "<div class='settings-ok'>No maps found older than the threshold.</div>";
        return;
      }

      _oldMapIds = maps.map(m => m.id);
      resultEl.innerHTML = `
        <div class="settings-broken-list">
          ${maps.map(m => {
            const age = m.updatedAt
              ? new Date(m.updatedAt).toLocaleDateString()
              : "unknown date";
            const nodes = `${m.nodeCount} node${m.nodeCount !== 1 ? "s" : ""}`;
            return `<div class="settings-broken-item">
              <span class="settings-broken-src" title="${_esc(m.name)}">${_esc(m.name)}</span>
              <span class="settings-broken-arrow">·</span>
              <span class="settings-broken-reason">${nodes}, last updated ${age}</span>
            </div>`;
          }).join("")}
        </div>`;
      delBtn.classList.remove("hidden");
    } catch (e) {
      scanBtn.disabled = false;
      scanBtn.textContent = "Find old maps";
      resultEl.innerHTML = "<div class='settings-error'>Scan failed.</div>";
    }
  }

  async function _deleteOldMaps() {
    const delBtn   = document.getElementById("btn-delete-old-maps");
    const resultEl = document.getElementById("settings-old-maps-result");
    if (!_oldMapIds.length) return;

    const count = _oldMapIds.length;
    if (!confirm(`Permanently delete ${count} map${count !== 1 ? "s" : ""}?\n\nThis cannot be undone.`)) return;

    delBtn.disabled = true;
    let deleted = 0;
    for (const id of _oldMapIds) {
      try {
        await window.pywebview.api.delete_map(id);
        deleted++;
      } catch (e) {
        console.error("Failed to delete map", id, e);
      }
    }

    _oldMapIds = [];
    delBtn.classList.add("hidden");
    resultEl.innerHTML =
      `<div class='settings-ok'>Deleted ${deleted} map${deleted !== 1 ? "s" : ""}.</div>`;

    // Refresh the maps list above and the sidebar
    _loadDataTab();
    Maps.init(await window.pywebview.api.load_maps());
    Maps.renderMapList();
  }

  async function _scanBrokenLinks() {
    const resultEl = document.getElementById("settings-broken-links-result");
    const scanBtn  = document.getElementById("btn-scan-broken-links");
    const fixBtn   = document.getElementById("btn-fix-broken-links");
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning…";
    resultEl.innerHTML = "";
    fixBtn.classList.add("hidden");

    try {
      const result = await window.pywebview.api.scan_broken_links();
      const broken = result.broken || [];
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan for broken links";

      if (!broken.length) {
        resultEl.innerHTML = "<div class='settings-ok'>No broken links found.</div>";
        return;
      }

      resultEl.innerHTML = `
        <div class="settings-broken-list">
          ${broken.map(b => {
            const src    = `${_esc(b.sourceMapName)} / ${_esc(b.sourceNodeTitle)}`;
            const reason = b.reason === "map_missing"
              ? "deleted map"
              : `missing node in "${_esc(b.targetMapName || b.targetMapId)}"`;
            return `<div class="settings-broken-item">
              <span class="settings-broken-src" title="${src}">${src}</span>
              <span class="settings-broken-arrow">→</span>
              <span class="settings-broken-reason">${reason}</span>
            </div>`;
          }).join("")}
        </div>`;
      fixBtn.classList.remove("hidden");
    } catch (e) {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan for broken links";
      resultEl.innerHTML = "<div class='settings-error'>Scan failed.</div>";
    }
  }

  async function _fixBrokenLinks() {
    const fixBtn   = document.getElementById("btn-fix-broken-links");
    const resultEl = document.getElementById("settings-broken-links-result");
    fixBtn.disabled = true;
    try {
      const result = await window.pywebview.api.fix_broken_links();
      const n = result.fixed || 0;
      resultEl.innerHTML =
        `<div class='settings-ok'>Removed ${n} broken link${n !== 1 ? "s" : ""}.</div>`;
      fixBtn.classList.add("hidden");
      _refreshBrokenCount();
    } catch (e) {
      fixBtn.disabled = false;
      resultEl.innerHTML = "<div class='settings-error'>Fix failed.</div>";
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────

  async function _save() {
    const ui = {
      fontSize:        document.getElementById("settings-font-size").value,
      nodeLabelLength: parseInt(document.getElementById("settings-label-length").value, 10),
      autosaveDelay:   parseInt(document.getElementById("settings-autosave").value, 10),
      defaultNodeText: document.getElementById("settings-default-node-text").value.trim(),
      confirmDelete:   document.getElementById("settings-confirm-delete").checked,
      autoFit:         document.getElementById("settings-auto-fit").checked,
      showAgenda:      document.getElementById("settings-show-agenda").checked,
      showTasks:       document.getElementById("settings-show-tasks").checked,
      showRecent:      document.getElementById("settings-show-recent").checked,
      maxRecentItems:  parseInt(document.getElementById("settings-max-recent").value, 10),
    };

    const updated = {
      ...(_config || {}),
      ui,
      jira: {
        url:      document.getElementById("settings-int-jira-url").value.trim(),
        username: document.getElementById("settings-int-jira-user").value.trim(),
        token:    document.getElementById("settings-int-jira-token").value.trim(),
      },
      calendar: {
        icsUrl:        document.getElementById("settings-int-cal-url").value.trim(),
        lookaheadDays: parseInt(document.getElementById("settings-int-cal-days").value, 10),
        email:         ((_config || {}).calendar || {}).email || "",
      },
    };

    await window.pywebview.api.save_config(updated);
    _config = updated;
    applyUiSettings(ui);
    if (typeof MindMap !== "undefined") MindMap.render();
    close();
  }

  // ── Wire UI ───────────────────────────────────────────────────────────

  function init() {
    const modal = document.getElementById("settings-modal");

    modal.querySelectorAll(".settings-tab").forEach(btn => {
      btn.addEventListener("click", () => _switchTab(btn.dataset.tab));
    });

    modal.querySelectorAll(".modal-close").forEach(btn => {
      btn.addEventListener("click", close);
    });
    modal.addEventListener("click", e => { if (e.target === modal) close(); });

    // Slider live displays
    document.getElementById("settings-autosave").addEventListener("input", e => {
      document.getElementById("settings-autosave-display").textContent = `${e.target.value}ms`;
    });
    document.getElementById("settings-label-length").addEventListener("input", e => {
      document.getElementById("settings-label-length-display").textContent = `${e.target.value} chars`;
    });

    document.getElementById("btn-settings-save").addEventListener("click", _save);
    document.getElementById("btn-open-settings").addEventListener("click", () => open());

    // Data tab — old maps
    document.getElementById("btn-scan-old-maps").addEventListener("click", _scanOldMaps);
    document.getElementById("btn-delete-old-maps").addEventListener("click", _deleteOldMaps);

    // Data tab — broken links
    document.getElementById("btn-scan-broken-links").addEventListener("click", _scanBrokenLinks);
    document.getElementById("btn-fix-broken-links").addEventListener("click", _fixBrokenLinks);

    document.getElementById("btn-clear-recent").addEventListener("click", () => {
      localStorage.removeItem("abrain-recent");
      if (typeof Detail !== "undefined" && Detail.renderRecentList) Detail.renderRecentList();
      _setFeedback("Recently visited history cleared.");
    });

    document.getElementById("btn-clear-collapsed").addEventListener("click", () => {
      localStorage.removeItem("abrain-collapsed");
      if (typeof MindMap !== "undefined" && MindMap.render) MindMap.render();
      _setFeedback("Collapsed node state reset.");
    });

    document.getElementById("btn-reset-sizes").addEventListener("click", () => {
      localStorage.removeItem("abrain-sizes");
      document.documentElement.style.removeProperty("--sidebar-width");
      document.documentElement.style.removeProperty("--agenda-width");
      _setFeedback("Panel sizes reset to defaults.");
    });

    document.getElementById("btn-open-data-dir").addEventListener("click", async () => {
      await window.pywebview.api.open_data_dir();
    });
  }

  function _setFeedback(msg) {
    const el = document.getElementById("settings-data-feedback");
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
  }

  function _esc(s) {
    return String(s || "")
      .replace(/&/g,  "&amp;")
      .replace(/</g,  "&lt;")
      .replace(/>/g,  "&gt;")
      .replace(/"/g,  "&quot;");
  }

  return {
    init,
    open,
    applyUiSettings,
    getAutosaveDelay,
    getNodeLabelLength,
    getMaxRecentItems,
    getDefaultNodeText,
    getConfirmDelete,
    getAutoFit,
  };
})();
