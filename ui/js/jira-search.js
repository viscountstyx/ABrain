/**
 * jira-search.js — Modal for searching Jira issues and adding them to the map.
 */

const JiraSearch = (() => {
  const backdrop  = document.getElementById("jira-search-modal");
  const inputEl   = document.getElementById("jira-search-input");
  const listEl    = document.getElementById("jira-search-list");
  const statusEl  = document.getElementById("jira-search-status");

  const KEY_RE     = /^[A-Z]+-\d+$/;
  const DEBOUNCE   = 350;

  let _parentId   = null;
  let _timer      = null;

  // ── Search ────────────────────────────────────────────────────────────

  async function _search(query) {
    query = query.trim();
    if (!query) { listEl.innerHTML = ""; statusEl.textContent = ""; return; }

    statusEl.textContent = "Searching…";
    listEl.innerHTML = "";

    let result;
    try {
      result = await window.pywebview.api.search_jira_issues(query);
    } catch {
      statusEl.textContent = "Search failed.";
      return;
    }

    if (result.error) { statusEl.textContent = result.error; return; }

    statusEl.textContent = result.issues.length === 0 ? "No results." : "";
    _render(result.issues);
  }

  function _render(issues) {
    listEl.innerHTML = "";
    issues.forEach(issue => {
      const item = document.createElement("li");
      item.className = "jira-item jira-search-item";

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
      dot.style.background = _priorityColor(issue.priority);

      const status = document.createElement("span");
      status.className = "jira-status";
      status.textContent = issue.status;

      const type = document.createElement("span");
      type.className = "jira-type";
      type.textContent = issue.issueType;

      const addBtn = document.createElement("button");
      addBtn.className = "jira-add-map-btn";
      addBtn.textContent = "＋ Add";
      addBtn.title = "Add as node in current map";

      bottom.appendChild(dot);
      bottom.appendChild(status);
      bottom.appendChild(type);
      bottom.appendChild(addBtn);

      item.appendChild(top);
      item.appendChild(bottom);

      const doAdd = e => { e && e.stopPropagation(); _addIssue(issue); };
      addBtn.addEventListener("click", doAdd);
      item.addEventListener("click", doAdd);

      listEl.appendChild(item);
    });
  }

  async function _addIssue(issue) {
    let parentId = _parentId;
    if (!parentId) {
      parentId = await NodePicker.pick("Add Jira Issue — Choose Parent");
    }
    if (!parentId) return;

    const title = issue.key + ": " + issue.summary.substring(0, 60);
    const newId = State.addNode(parentId, title);
    State.updateNode(newId, {
      status:      "started",
      attachments: [{ type: "url", value: issue.url, label: issue.key }],
    });
    _close();
  }

  function _priorityColor(priority) {
    const p = (priority || "").toLowerCase();
    if (p === "highest" || p === "blocker") return "#f38ba8";
    if (p === "high")   return "#fab387";
    if (p === "medium") return "#f9e2af";
    if (p === "low")    return "#a6e3a1";
    if (p === "lowest") return "#89b4fa";
    return "#6c7086";
  }

  // ── Open / close ─────────────────────────────────────────────────────

  function open(parentId = null) {
    _parentId = parentId;
    inputEl.value = "";
    listEl.innerHTML = "";
    statusEl.textContent = "";
    backdrop.classList.remove("hidden");
    setTimeout(() => inputEl.focus(), 50);
  }

  function _close() {
    backdrop.classList.add("hidden");
    _parentId = null;
    clearTimeout(_timer);
  }

  // ── Events ────────────────────────────────────────────────────────────

  inputEl.addEventListener("input", () => {
    clearTimeout(_timer);
    const q = inputEl.value.trim();
    if (!q) { listEl.innerHTML = ""; statusEl.textContent = ""; return; }
    if (KEY_RE.test(q)) {
      _search(q);
    } else {
      _timer = setTimeout(() => _search(q), DEBOUNCE);
    }
  });

  inputEl.addEventListener("keydown", e => {
    if (e.key === "Escape") { _close(); e.stopPropagation(); }
  });

  backdrop.querySelectorAll(".modal-close").forEach(b => b.addEventListener("click", _close));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) _close(); });

  return { open };
})();
