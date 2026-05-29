/**
 * onboarding.js — First-run setup wizard.
 *
 * Steps: Welcome → Jira → Calendar → Done
 *
 * Triggered by bridge.js when load_config() returns firstRun: true
 * (i.e. no config.json exists yet). Saving on the final step creates
 * the file, so the wizard won't reappear on next launch.
 */

const Onboarding = (() => {
  const STEPS = ['welcome', 'jira', 'calendar', 'done'];
  let _step = 0;
  let _jira     = { url: '', username: '', token: '' };
  let _calendar = { icsUrl: '' };

  // ── Public ────────────────────────────────────────────────────────────

  function show() {
    _step    = 0;
    _jira    = { url: '', username: '', token: '' };
    _calendar = { icsUrl: '' };
    _render();
    document.getElementById('onboarding-modal').classList.remove('hidden');
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  function _render() {
    const step = STEPS[_step];
    document.getElementById('ob-body').innerHTML   = _bodyHtml(step);
    document.getElementById('ob-footer').innerHTML = _footerHtml(step);
    _renderProgress();
    _wireStep(step);
  }

  function _renderProgress() {
    const integrationSteps = ['jira', 'calendar'];
    document.getElementById('ob-progress').innerHTML = integrationSteps.map(s => {
      const active = _step >= STEPS.indexOf(s);
      return `<div class="ob-dot${active ? ' ob-dot--active' : ''}"></div>`;
    }).join('');
  }

  function _bodyHtml(step) {
    if (step === 'welcome') {
      return `
        <div class="ob-welcome">
          <img src="icons/abrain.svg" alt="ABrain" class="ob-logo-img" />
          <h1 class="ob-title">Welcome to ABrain</h1>
          <p class="ob-subtitle">Your personal mind-mapping space.</p>
          <p class="ob-text">Let's set up a couple of optional integrations so your tasks and calendar appear alongside your maps. You can skip any step and update these later in Settings.</p>
        </div>`;
    }

    if (step === 'jira') {
      return `
        <div class="ob-step">
          <h2 class="ob-step-title">Jira Integration</h2>
          <p class="ob-step-desc">Connect Jira to see your assigned issues in the Tasks panel. Leave blank to skip.</p>
          <div class="ob-field">
            <label for="ob-jira-url">Jira URL</label>
            <input id="ob-jira-url" type="url" placeholder="https://yourcompany.atlassian.net" value="${_esc(_jira.url)}" />
          </div>
          <div class="ob-field">
            <label for="ob-jira-user">Username (email)</label>
            <input id="ob-jira-user" type="text" placeholder="you@example.com" value="${_esc(_jira.username)}" autocomplete="off" />
          </div>
          <div class="ob-field">
            <label for="ob-jira-token">API token</label>
            <input id="ob-jira-token" type="password" placeholder="••••••••" value="${_esc(_jira.token)}" autocomplete="off" />
            <span id="ob-jira-token-help" class="ob-help-link">How do I get an API token?</span>
          </div>
          <div class="ob-test-row">
            <button id="ob-test-jira" class="ob-test-btn">Test Connection</button>
            <span id="ob-jira-result" class="ob-result"></span>
          </div>
        </div>`;
    }

    if (step === 'calendar') {
      return `
        <div class="ob-step">
          <h2 class="ob-step-title">Google Calendar</h2>
          <p class="ob-step-desc">Connect your calendar to see upcoming events in the Tasks panel. Leave blank to skip.</p>
          <div class="ob-field">
            <label for="ob-cal-url">Calendar ICS URL</label>
            <input id="ob-cal-url" type="url" placeholder="https://calendar.google.com/…/basic.ics" value="${_esc(_calendar.icsUrl)}" />
            <span class="ob-field-hint">In Google Calendar → Settings → your calendar → "Integrate calendar" → copy the <em>Secret address in iCal format</em>.</span>
          </div>
          <div class="ob-test-row">
            <button id="ob-test-cal" class="ob-test-btn">Test URL</button>
            <span id="ob-cal-result" class="ob-result"></span>
          </div>
        </div>`;
    }

    if (step === 'done') {
      const parts = [];
      if (_jira.url)        parts.push('Jira');
      if (_calendar.icsUrl) parts.push('Google Calendar');
      const summary = parts.length
        ? `<p class="ob-text">Connected: <strong>${parts.join(' and ')}</strong>.</p>`
        : `<p class="ob-text">No integrations configured — you can add them any time via Settings.</p>`;
      return `
        <div class="ob-welcome">
          <div class="ob-done-check">✓</div>
          <h1 class="ob-title">You're all set!</h1>
          ${summary}
          <p class="ob-text">Use the mind map to organise your thoughts. Right-click nodes or press Tab to add children.</p>
        </div>`;
    }

    return '';
  }

  function _footerHtml(step) {
    if (step === 'welcome') {
      return `<button id="ob-next" class="ob-btn ob-btn--primary">Get Started →</button>`;
    }
    if (step === 'jira') {
      return `
        <div class="ob-footer-left"></div>
        <div class="ob-footer-right">
          <button id="ob-skip" class="ob-btn ob-btn--ghost">Skip</button>
          <button id="ob-next" class="ob-btn ob-btn--primary">Next →</button>
        </div>`;
    }
    if (step === 'calendar') {
      return `
        <button id="ob-back" class="ob-btn ob-btn--ghost">← Back</button>
        <div class="ob-footer-right">
          <button id="ob-skip" class="ob-btn ob-btn--ghost">Skip</button>
          <button id="ob-next" class="ob-btn ob-btn--primary">Next →</button>
        </div>`;
    }
    if (step === 'done') {
      return `<button id="ob-finish" class="ob-btn ob-btn--primary">Start using ABrain</button>`;
    }
    return '';
  }

  // ── Navigation ────────────────────────────────────────────────────────

  function _wireStep(step) {
    document.getElementById('ob-next')?.addEventListener('click',   _collectAndNext);
    document.getElementById('ob-skip')?.addEventListener('click',   _skipStep);
    document.getElementById('ob-back')?.addEventListener('click',   _back);
    document.getElementById('ob-finish')?.addEventListener('click', _finish);

    if (step === 'jira') {
      document.getElementById('ob-test-jira').addEventListener('click', _testJira);
      document.getElementById('ob-jira-token-help').addEventListener('click', () => {
        window.pywebview.api.open_url(
          'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/'
        );
      });
    }

    if (step === 'calendar') {
      document.getElementById('ob-test-cal').addEventListener('click', _testCalendar);
    }
  }

  function _collectCurrent() {
    const step = STEPS[_step];
    if (step === 'jira') {
      _jira = {
        url:      document.getElementById('ob-jira-url').value.trim(),
        username: document.getElementById('ob-jira-user').value.trim(),
        token:    document.getElementById('ob-jira-token').value.trim(),
      };
    }
    if (step === 'calendar') {
      _calendar = { icsUrl: document.getElementById('ob-cal-url').value.trim() };
    }
  }

  function _collectAndNext() {
    _collectCurrent();
    _step++;
    _render();
  }

  function _skipStep() {
    const step = STEPS[_step];
    if (step === 'jira')     _jira     = { url: '', username: '', token: '' };
    if (step === 'calendar') _calendar = { icsUrl: '' };
    _step++;
    _render();
  }

  function _back() {
    _collectCurrent();
    _step--;
    _render();
  }

  async function _finish() {
    const config = {
      ui: {},
      jira:     _jira,
      calendar: { icsUrl: _calendar.icsUrl, email: '' },
    };
    try {
      await window.pywebview.api.save_config(config);
    } catch (e) {
      console.error('Onboarding save failed:', e);
    }
    document.getElementById('onboarding-modal').classList.add('hidden');
    Tasks.init().catch(() => {});
  }

  // ── Test connections ──────────────────────────────────────────────────

  async function _testJira() {
    const btn    = document.getElementById('ob-test-jira');
    const result = document.getElementById('ob-jira-result');
    const url    = document.getElementById('ob-jira-url').value.trim();
    const user   = document.getElementById('ob-jira-user').value.trim();
    const token  = document.getElementById('ob-jira-token').value.trim();

    btn.disabled = true;
    btn.textContent = 'Testing…';
    result.textContent = '';
    result.className = 'ob-result';

    try {
      const res = await window.pywebview.api.test_jira_connection(url, user, token);
      result.textContent = (res.ok ? '✓ ' : '✗ ') + (res.ok ? res.message : res.error);
      result.classList.add(res.ok ? 'ob-result--ok' : 'ob-result--err');
    } catch (e) {
      result.textContent = '✗ Test failed';
      result.classList.add('ob-result--err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }

  async function _testCalendar() {
    const btn    = document.getElementById('ob-test-cal');
    const result = document.getElementById('ob-cal-result');
    const url    = document.getElementById('ob-cal-url').value.trim();

    btn.disabled = true;
    btn.textContent = 'Testing…';
    result.textContent = '';
    result.className = 'ob-result';

    try {
      const res = await window.pywebview.api.test_calendar_connection(url);
      result.textContent = (res.ok ? '✓ ' : '✗ ') + (res.ok ? res.message : res.error);
      result.classList.add(res.ok ? 'ob-result--ok' : 'ob-result--err');
    } catch (e) {
      result.textContent = '✗ Test failed';
      result.classList.add('ob-result--err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test URL';
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { show };
})();
