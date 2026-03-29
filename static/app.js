/* ═══════════════════════════════════════════════════════════════
   COSMIC Q OPS — Frontend SPA
   No mercy. Pure signal.
═══════════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────

const S = {
  user:     null,
  view:     'dashboard',
  today:    new Date().toISOString().split('T')[0],
  plan:     null,
  review:   null,
  sessions: [],
  stats:    null,

  // Morning plan wizard
  planStep: 0,
  planDraft: {
    priorities: [
      { text: '', area: '', why: '', expected_hours: 1, is_tentative: false },
      { text: '', area: '', why: '', expected_hours: 1, is_tentative: false },
      { text: '', area: '', why: '', expected_hours: 1, is_tentative: false },
    ],
    deep_work_target: 4,
  },

  // Deep work setup (pre-session, 2-step)
  dwSetupStep: 0,        // 0 = pick priority, 1 = set domains
  dwSetupData: {
    priority_index:  null, // null=unset, -1=other, 0/1/2=priority index
    focus_area:      null,
    allowed_domains: [],
  },
  dwDomainInput: '',

  // Active deep-work session
  activeSession:  null,  // { id, start_ms, focus_area, priority_index, priority_text, allowed_domains }
  timerInterval:  null,

  // EOD wizard
  eodStep: 0,
  eodData: {
    deep_work_hours:   '',
    priority_outcomes: [],
    main_blocker:      '',
    tomorrow_focus:    '',
  },
  eodErrors: {},

  // War Room internal tabs
  warRoomTab:   'charts', // 'charts' | 'log'
  dailyLogData: {},       // date -> { plan, review, sessions }
};

// ── DRAFT PERSISTENCE ─────────────────────────────────────────────────────────

function DRAFT_KEY() { return `cq_draft_${S.today}`; }

function savePlanDraft() {
  try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(S.planDraft)); } catch (_) {}
}
function loadPlanDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY());
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.priorities)) return d;
  } catch (_) {}
  return null;
}
function clearPlanDraft() {
  try { localStorage.removeItem(DRAFT_KEY()); } catch (_) {}
}

// ── API ───────────────────────────────────────────────────────────────────────

const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(path, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

// ── UTILS ─────────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if      (k === 'class')       e.className = v;
    else if (k === 'style')       e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else                          e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(
      (typeof c === 'string' || typeof c === 'number')
        ? document.createTextNode(String(c)) : c
    );
  }
  return e;
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
function fmtDateShort(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
function fmtTime(ms) {
  const s  = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
function fmtDuration(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function gradeColor(g) {
  if (!g) return 'gray';
  const l = g[0];
  if (l === 'S' || l === 'A') return 'green';
  if (l === 'B') return 'blue';
  if (l === 'C') return 'orange';
  return 'red';
}
function areaClass(area) { return area ? `area-${area.toLowerCase()}` : ''; }

function VAGUE_CHECK(text) {
  const VAGUE = [
    'tried', 'worked on', 'attempted', 'looked at', 'thought about',
    'explored', 'discussed', 'went through', 'reviewing', 'going through',
    'was working', 'have been', 'kind of', 'sort of', 'basically',
  ];
  const lower = text.toLowerCase();
  return VAGUE.filter(v => lower.includes(v));
}
function validateOutcome(text) {
  const errors = [];
  if (text.trim().length < 30)
    errors.push('Too short. What specifically was the output? Min 30 characters.');
  const vague = VAGUE_CHECK(text);
  if (vague.length > 0)
    errors.push(`Vague language: "${vague.join('", "')}" — activities ≠ outcomes.`);
  return errors;
}

function DOMAIN_SUGGESTIONS(area) {
  const map = {
    'Product': ['figma.com', 'notion.so', 'miro.com', 'loom.com', 'productboard.com'],
    'Tech':    ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'docs.python.org', 'vercel.com'],
    'People':  ['meet.google.com', 'zoom.us', 'calendar.google.com', 'slack.com'],
    'Admin':   ['mail.google.com', 'notion.so', 'drive.google.com', 'calendar.google.com'],
  };
  return (area && map[area]) ? map[area] : [];
}

function totalExpectedHours() {
  return S.planDraft.priorities.reduce((s, p) => s + (parseFloat(p.expected_hours) || 0), 0);
}
function getGreeting() {
  const hr = new Date().getHours();
  if (hr < 5)  return 'Still at it';
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  if (hr < 21) return 'Good evening';
  return 'Late night';
}

// ── HEADER / NAV ──────────────────────────────────────────────────────────────

function renderHeader() {
  const streak = S.stats ? S.stats.streak : 0;
  return h('div', { class: 'header' },
    h('div', { class: 'logo' },
      h('div', { class: 'logo-mark' }, 'CQ'),
      'COSMIC Q OPS',
    ),
    h('div', { class: 'header-meta' },
      streak > 0 ? h('span', { class: 'streak-badge' }, `🔥 ${streak}d streak`) : null,
      h('span', {}, S.user.name),
      h('span', {}, fmtDate(S.today)),
    )
  );
}

function renderNav() {
  const items = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'plan',      label: 'Morning Kickoff' },
    { id: 'deepwork',  label: 'Deep Work' },
    { id: 'eod',       label: 'EOD Review' },
    { id: 'warroom',   label: 'War Room' },
  ];
  return h('div', { class: 'nav' },
    ...items.map(({ id, label }) =>
      h('button', {
        class: `nav-btn ${S.view === id ? 'active' : ''}`,
        onClick: () => navigate(id),
      }, label)
    )
  );
}

// ── LANDING ───────────────────────────────────────────────────────────────────

function renderLanding() {
  const wrap = h('div', { class: 'landing' },
    h('div', { class: 'landing-box' },
      h('div', { class: 'landing-logo' },
        h('div', { class: 'landing-logo-mark' }, 'CQ'),
        h('div', { class: 'landing-logo-text' }, 'COSMIC Q OPS'),
      ),
      h('p', { class: 'landing-tagline' },
        'Your ruthless execution system. No excuses. Pure signal.',
      ),
      h('div', { class: 'landing-form' },
        h('label', { class: 'label' }, 'Your name'),
        h('input', {
          id: 'landing-name', class: 'input', type: 'text',
          placeholder: 'Khetesh', autocomplete: 'off',
          onKeydown: (e) => { if (e.key === 'Enter') doLanding(); },
        }),
        h('button', {
          class: 'btn btn-primary btn-lg landing-cta',
          style: 'width:100%;margin-top:12px',
          onClick: doLanding,
        }, 'Start →'),
      ),
    ),
  );
  setTimeout(() => { const inp = el('landing-name'); if (inp) inp.focus(); }, 50);
  return wrap;
}
async function doLanding() {
  const name = (el('landing-name')?.value || '').trim();
  if (!name) return;
  S.user = await API.post('/api/user', { name });
  await loadAll();
  render();
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────

async function loadAll() {
  await Promise.all([loadTodayPlan(), loadTodayReview(), loadTodaySessions(), loadStats()]);
}
async function loadTodayPlan()     { S.plan     = await API.get(`/api/plans/${S.today}`); }
async function loadTodayReview()   { S.review   = await API.get(`/api/reviews/${S.today}`); }
async function loadTodaySessions() { S.sessions = await API.get(`/api/sessions?date=${S.today}`); }
async function loadStats()         { S.stats    = await API.get('/api/stats'); }

// ── NAVIGATE ──────────────────────────────────────────────────────────────────

async function navigate(view) {
  // EOD: pre-fill outcomes from today's plan
  if (view === 'eod' && S.plan) {
    S.eodData.priority_outcomes = (S.plan.priorities || []).map(p => ({
      text: p.text, completed: '', outcome: '',
    }));
  }

  // Plan: restore from saved plan OR localStorage draft
  if (view === 'plan') {
    S.planStep = 0;
    if (S.plan) {
      // Saved plan → populate wizard from backend
      S.planDraft.priorities = (S.plan.priorities || []).map(p => ({
        text:           p.text           || '',
        area:           p.area           || '',
        why:            p.why            || '',
        expected_hours: p.expected_hours || 1,
        is_tentative:   p.is_tentative   || false,
      }));
      while (S.planDraft.priorities.length < 3)
        S.planDraft.priorities.push({ text: '', area: '', why: '', expected_hours: 1, is_tentative: false });
      S.planDraft.deep_work_target = S.plan.deep_work_target || 4;
    } else {
      // No saved plan → try localStorage draft (survives refresh)
      const draft = loadPlanDraft();
      if (draft) {
        S.planDraft = draft;
        S.planDraft.priorities = S.planDraft.priorities.map(p => ({
          text: p.text || '', area: p.area || '', why: p.why || '',
          expected_hours: p.expected_hours || 1, is_tentative: p.is_tentative || false,
        }));
        while (S.planDraft.priorities.length < 3)
          S.planDraft.priorities.push({ text: '', area: '', why: '', expected_hours: 1, is_tentative: false });
      }
    }
  }

  // Deep Work: reset setup only when no active session
  if (view === 'deepwork' && !S.activeSession) {
    S.dwSetupStep = 0;
    S.dwSetupData = { priority_index: null, focus_area: null, allowed_domains: [] };
    S.dwDomainInput = '';
  }

  S.eodStep = 0;
  S.view = view;
  render();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  const dw_today  = S.sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0) / 60;
  const dw_target = S.plan?.deep_work_target || 4;
  const dw_pct    = Math.min(100, Math.round((dw_today / dw_target) * 100));
  const wrap      = document.createDocumentFragment();

  wrap.appendChild(h('div', { class: 'dashboard-greeting' },
    h('h1', {}, `${getGreeting()}, ${S.user.name}.`),
    h('p',  { class: 'dashboard-date' }, fmtDate(S.today)),
  ));

  const dwColor = dw_pct >= 100 ? 'green' : dw_pct >= 60 ? '' : 'red';
  wrap.appendChild(h('div', { class: 'status-grid' },
    h('div', { class: 'status-card' },
      h('div', { class: 'status-card-label' }, "Today's Plan"),
      S.plan ? h('span', { class: 'badge badge-green' }, '✓ Set')
             : h('span', { class: 'badge badge-red'   }, '✗ Missing'),
      h('div', { class: 'status-card-sub' },
        S.plan ? `${(S.plan.priorities || []).length} priorities` : 'Click Morning Kickoff'),
    ),
    h('div', { class: 'status-card' },
      h('div', { class: 'status-card-label' }, 'Deep Work'),
      h('div', { class: 'status-card-value' }, `${dw_today.toFixed(1)}h`),
      h('div', { class: 'status-card-sub' }, `Target: ${dw_target}h`),
      h('div', { class: 'progress-bar' },
        h('div', { class: `progress-fill ${dwColor}`, style: `width:${dw_pct}%` }),
      ),
    ),
    h('div', { class: 'status-card' },
      h('div', { class: 'status-card-label' }, 'EOD Review'),
      S.review
        ? h('span', { class: `badge badge-${gradeColor(S.review.grade_letter)}` }, S.review.grade)
        : h('span', { class: 'badge badge-gray' }, 'Pending'),
      h('div', { class: 'status-card-sub' },
        S.review ? `Score: ${S.review.execution_score}/100` : 'Not submitted'),
    ),
  ));

  // Priorities
  const priCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, "Today's Priorities"),
  );
  if (!S.plan?.priorities?.length) {
    priCard.appendChild(h('div', { class: 'empty-state', style: 'padding:24px' },
      h('div', { class: 'empty-title' }, 'No plan yet.'),
      h('p',   { class: 'empty-sub'   }, "You haven't set your priorities for today."),
      h('button', { class: 'btn btn-primary', onClick: () => navigate('plan') }, 'Start Morning Kickoff →'),
    ));
  } else {
    const completed = S.review ? S.review.priority_outcomes : [];
    priCard.appendChild(h('ul', { class: 'priority-list' },
      ...S.plan.priorities.map((p, i) => {
        const oc = completed[i];
        const isDone    = oc?.completed === 'yes';
        const isPartial = oc?.completed === 'partial';
        const hrs = p.expected_hours ? `${p.expected_hours}h${p.is_tentative ? '~' : ''}` : '';
        return h('li', { class: 'priority-item' },
          h('div', { class: `priority-check ${isDone ? 'done' : isPartial ? 'partial' : ''}` },
            isDone ? '✓' : isPartial ? '~' : ''),
          h('div', { style: 'flex:1' },
            h('span', { class: 'priority-text' }, `P${i + 1} · ${p.text}`),
          ),
          hrs ? h('span', { class: 'text-muted', style: 'font-size:11px;margin-right:6px;flex-shrink:0' }, hrs) : null,
          h('span', { class: `priority-area ${areaClass(p.area)}` }, p.area || '—'),
        );
      }),
    ));
  }
  wrap.appendChild(priCard);

  wrap.appendChild(h('div', { class: 'quick-actions' },
    !S.plan ? h('button', { class: 'btn btn-primary',   onClick: () => navigate('plan')     }, '📋 Set Today\'s Plan') : null,
    h('button', { class: 'btn btn-secondary', onClick: () => navigate('deepwork') }, '⚡ Start Deep Work'),
    !S.review
      ? h('button', { class: 'btn btn-secondary', onClick: () => navigate('eod') }, '🔍 EOD Review')
      : h('button', { class: 'btn btn-ghost',     onClick: () => navigate('eod') }, '✓ View EOD Report'),
  ));

  if (S.stats) {
    wrap.appendChild(h('div', { class: 'card', style: 'margin-top:20px' },
      h('div', { class: 'card-title' }, '7-Day Performance'),
      h('div', { class: 'metrics-row' },
        h('div', { class: 'metric' },
          h('div', { class: 'metric-val' }, `${S.stats.avg_deep_work_7d}h`),
          h('div', { class: 'metric-lbl' }, 'Avg Deep Work'),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'metric-val' }, S.stats.avg_score_7d || '—'),
          h('div', { class: 'metric-lbl' }, 'Avg Score'),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'metric-val' }, S.stats.streak || 0),
          h('div', { class: 'metric-lbl' }, 'Day Streak'),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'metric-val' }, `${S.stats.total_dw_hours}h`),
          h('div', { class: 'metric-lbl' }, 'Total Deep Work'),
        ),
      ),
    ));
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(wrap);
  return wrapper;
}

// ── MORNING PLAN WIZARD ───────────────────────────────────────────────────────

function renderPlanWizard() {
  const wrap  = document.createElement('div');
  const steps = ['Priorities', 'Deep Work', 'Confirm'];
  const dots  = h('div', { class: 'wizard-steps' },
    ...steps.map((_, i) => h('div', {
      class: `wizard-step-dot ${i < S.planStep ? 'done' : i === S.planStep ? 'active' : ''}`,
    })),
  );
  if      (S.planStep === 0) renderPlanStep0(wrap, dots);
  else if (S.planStep === 1) renderPlanStep1(wrap, dots);
  else if (S.planStep === 2) renderPlanStep2(wrap, dots);
  return wrap;
}

function renderPlanStep0(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Set Your 3 Priorities'),
    h('p',  { class: 'wizard-subtitle' },
      'What must ship today for Cosmic Q to move forward? Rank ruthlessly. P1 gets done no matter what.'
    ),
  ));

  const rankLabels = ['— Must deliver', '— Should deliver', '— Best effort'];
  const placeholders = [
    'e.g. Ship onboarding flow v1 to staging',
    'e.g. Finalize user interview script',
    'e.g. Fix 3 critical bugs in auth module',
  ];

  S.planDraft.priorities.forEach((p, idx) => {
    const block = h('div', { class: 'priority-block' },

      h('div', { class: 'priority-block-num' }, `Priority ${idx + 1} ${rankLabels[idx]}`),

      // Task text
      h('div', { class: 'form-group' },
        h('label', { class: 'label' }, 'What exactly will you deliver?'),
        h('input', {
          class: 'input', type: 'text', id: `pri-text-${idx}`,
          value: p.text, placeholder: placeholders[idx],
          onInput: (e) => { S.planDraft.priorities[idx].text = e.target.value; savePlanDraft(); },
        }),
      ),

      // Area + Expected hours row
      h('div', { class: 'form-row', style: 'align-items:flex-start' },
        h('div', { class: 'form-group', style: 'flex:2;margin-bottom:0' },
          h('label', { class: 'label' }, 'Area'),
          h('div', { class: 'area-selector' },
            ...['Product', 'Tech', 'People', 'Admin'].map(area =>
              h('button', {
                class: `area-btn ${p.area === area ? `selected-${area.toLowerCase()}` : ''}`,
                onClick: () => {
                  S.planDraft.priorities[idx].area = area;
                  savePlanDraft();
                  render();
                },
              }, area)
            ),
          ),
        ),
        h('div', { class: 'form-group', style: 'flex:1;margin-bottom:0' },
          h('label', { class: 'label' }, 'Expected hours'),
          h('div', { class: 'hrs-input-row' },
            h('input', {
              class: 'input hrs-input', type: 'number',
              id: `pri-hrs-${idx}`,
              value: p.expected_hours || 1,
              min: '0.5', max: '8', step: '0.5',
              onInput: (e) => {
                S.planDraft.priorities[idx].expected_hours = parseFloat(e.target.value) || 1;
                savePlanDraft();
              },
            }),
            h('label', { class: 'tentative-label' },
              h('input', {
                type: 'checkbox',
                ...(p.is_tentative ? { checked: 'checked' } : {}),
                onChange: (e) => {
                  S.planDraft.priorities[idx].is_tentative = e.target.checked;
                  savePlanDraft();
                },
              }),
              ' ~Tentative',
            ),
          ),
        ),
      ),

      // First Principles Why
      h('div', { class: 'form-group', style: 'margin-bottom:0;margin-top:12px' },
        h('label', { class: 'label' },
          '⚡ First Principles: ',
          h('span', { class: 'label-hint' }, 'Why does THIS task move Cosmic Q forward more than anything else today?'),
        ),
        h('textarea', {
          class: 'textarea', id: `pri-why-${idx}`,
          placeholder: "Strip all assumptions. What breaks if this doesn't happen? What does it unlock?",
          style: 'min-height:64px',
          onInput: (e) => { S.planDraft.priorities[idx].why = e.target.value; savePlanDraft(); },
        }, p.why),
      ),
    );
    wrap.appendChild(block);
  });

  const adminCount = S.planDraft.priorities.filter(p => p.area === 'Admin').length;
  if (adminCount > 1) {
    wrap.appendChild(h('div', { class: 'alert alert-orange' },
      '⚠ More than one Admin priority. Admin doesn\'t build Cosmic Q. Delegate or defer.'
    ));
  }

  wrap.appendChild(h('div', { class: 'text-muted', style: 'font-size:11px;margin-top:8px;text-align:right' },
    '✓ Draft auto-saved — safe to close and return'
  ));

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => navigate('dashboard') }, '← Cancel'),
    h('button', {
      class: 'btn btn-primary',
      onClick: () => {
        const errors = [];
        S.planDraft.priorities.forEach((p, i) => {
          if (!p.text.trim())                               errors.push(`P${i+1}: Enter what you'll deliver.`);
          if (!p.area)                                      errors.push(`P${i+1}: Select an area.`);
          if (!p.why.trim() || p.why.trim().length < 20)   errors.push(`P${i+1}: First Principles must be ≥20 chars.`);
          if (!p.expected_hours || p.expected_hours < 0.5) errors.push(`P${i+1}: Set expected hours (min 0.5h).`);
        });
        if (errors.length > 0) { alert(errors.join('\n')); return; }
        S.planStep = 1; render();
      },
    }, 'Next → Deep Work Target'),
  ));
}

function renderPlanStep1(wrap, dots) {
  const totalHrs = totalExpectedHours();

  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Set Your Deep Work Target'),
    h('p',  { class: 'wizard-subtitle' },
      'Your priorities have an estimated time cost. Set your deep work commitment accordingly.'
    ),
  ));

  // Priority hours breakdown
  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('div', { class: 'card-title' }, 'Time Budget by Priority'),
    ...S.planDraft.priorities.map((p, i) =>
      h('div', { class: 'priority-hours-row' },
        h('span', { class: 'priority-hours-num' }, `P${i+1}`),
        h('span', { class: 'priority-hours-text' }, p.text || '—'),
        h('span', { class: `priority-area ${areaClass(p.area)}`, style: 'flex-shrink:0;font-size:10px;padding:1px 5px' }, p.area || ''),
        h('span', { class: 'priority-hours-val' }, `${p.expected_hours || 0}h${p.is_tentative ? '~' : ''}`),
      )
    ),
    h('div', { class: 'priority-hours-total' },
      h('span', {}, 'Total committed hours'),
      h('span', { class: 'fw-700' }, `${totalHrs.toFixed(1)}h`),
    ),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('label', { class: 'label', style: 'margin-bottom:16px' },
      'Deep Work Commitment',
      h('span', { class: 'label-hint' }, ' — recommended: 4+h'),
    ),
    h('div', { class: 'dw-input-wrapper' },
      h('input', {
        type: 'number', id: 'dw-target',
        value: S.planDraft.deep_work_target,
        min: '1', max: '12', step: '0.5',
        onInput: (e) => {
          S.planDraft.deep_work_target = parseFloat(e.target.value) || 4;
          savePlanDraft();
          render();
        },
      }),
      h('span', { class: 'dw-unit' }, 'hours'),
    ),
    (() => {
      const t = S.planDraft.deep_work_target;
      if (t < totalHrs)
        return h('div', { class: 'pushback-box', style: 'margin-top:12px' },
          `⚠ Priorities need ${totalHrs.toFixed(1)}h but you're committing only ${t}h. Cut a priority or increase target.`);
      if (t < 3)
        return h('div', { class: 'pushback-box', style: 'margin-top:12px' },
          `${t}h is not enough to build Cosmic Q. Minimum viable focus is 3-4h every day.`);
      if (t >= 4)
        return h('div', { class: 'alert alert-green', style: 'margin-top:12px' },
          `✓ ${t}h commitment. Deep work starts with P1 — highest priority first.`);
      return h('div', { class: 'alert alert-orange', style: 'margin-top:12px' },
        `${t}h. Acceptable, push for 4.`);
    })(),
  ));

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.planStep = 0; render(); } }, '← Back'),
    h('button', {
      class: 'btn btn-primary',
      onClick: () => { S.planStep = 2; render(); },
    }, 'Next → Review & Lock In'),
  ));
}

function renderPlanStep2(wrap, dots) {
  const totalHrs = totalExpectedHours();

  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Review & Lock In'),
    h('p',  { class: 'wizard-subtitle' }, 'This is your contract with yourself. P1 gets done. No excuses.'),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, "Today's Priorities"),
    h('ul', { class: 'priority-list', style: 'margin-bottom:16px' },
      ...S.planDraft.priorities.map((p, i) =>
        h('li', { class: 'priority-item', style: 'align-items:flex-start' },
          h('div', { class: 'priority-check' }, ''),
          h('div', { style: 'flex:1' },
            h('div', { class: 'priority-text fw-600' }, `P${i+1} · ${p.text}`),
            h('div', { class: 'text-muted mt-4', style: 'font-size:12px;font-style:italic' }, `"${p.why}"`),
          ),
          h('div', { style: 'text-align:right;flex-shrink:0' },
            h('span', { class: `priority-area ${areaClass(p.area)}` }, p.area),
            h('div', { class: 'text-muted', style: 'font-size:11px;margin-top:3px' },
              `${p.expected_hours}h${p.is_tentative ? '~' : ''}`),
          ),
        )
      ),
    ),
    h('div', { class: 'flex-between', style: 'padding-top:8px;border-top:1px solid var(--border)' },
      h('span', { class: 'text-muted' }, 'Priority hours needed'),
      h('span', { class: 'fw-600' }, `${totalHrs.toFixed(1)}h`),
    ),
    h('div', { class: 'flex-between', style: 'padding-top:6px' },
      h('span', { class: 'text-muted' }, 'Deep Work Target'),
      h('span', { class: 'fw-700' }, `${S.planDraft.deep_work_target}h`),
    ),
  ));

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.planStep = 1; render(); } }, '← Back'),
    h('button', { class: 'btn btn-primary btn-lg', id: 'lock-btn', onClick: savePlan }, '🔒 Lock In →'),
  ));
}

async function savePlan() {
  const btn = el('lock-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    S.plan = await API.post('/api/plans', {
      date:             S.today,
      priorities:       S.planDraft.priorities,
      deep_work_target: S.planDraft.deep_work_target,
    });
    clearPlanDraft();
    await loadStats();
    S.view = 'dashboard';
    S.planStep = 0;
    render();
  } catch (e) {
    alert('Failed to save: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Lock In →'; }
  }
}

// ── DEEP WORK ─────────────────────────────────────────────────────────────────

function renderDeepWork() {
  if (!S.activeSession) {
    const stored = localStorage.getItem('cq_active_session');
    if (stored) { try { S.activeSession = JSON.parse(stored); } catch (_) {} }
  }

  const today_min = S.sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const target    = S.plan?.deep_work_target || 4;
  const wrap      = document.createElement('div');

  wrap.appendChild(h('div', { class: 'flex-between mb-16' },
    h('h2', {}, 'Deep Work'),
    h('div', { class: `badge badge-${today_min / 60 >= target ? 'green' : 'gray'}` },
      `${(today_min / 60).toFixed(1)}h / ${target}h today`),
  ));

  if (!S.activeSession) {
    if (S.dwSetupStep === 0) renderDWStep0(wrap);
    else                     renderDWStep1(wrap);
  } else {
    renderDWActive(wrap);
  }

  // Sessions log
  const done = S.sessions.filter(s => s.end_time);
  if (done.length > 0) {
    wrap.appendChild(h('div', { class: 'card mt-20' },
      h('div', { class: 'card-title' }, "Today's Sessions"),
      h('ul', { class: 'sessions-list' },
        ...done.map(s => {
          const pLabel = s.priority_text
            ? `P${(s.priority_index ?? 0) + 1} · ${s.priority_text.slice(0, 35)}${s.priority_text.length > 35 ? '…' : ''}`
            : s.focus_area;
          return h('li', { class: 'session-item' },
            h('div', { style: 'flex:1' },
              h('div', { class: 'flex-between' },
                h('span', { class: 'session-area' }, pLabel),
                h('span', { class: 'session-dur'  }, fmtDuration(s.duration_minutes)),
              ),
              h('div', { class: 'session-time' },
                `${new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                s.allowed_domains?.length
                  ? h('span', { class: 'text-muted', style: 'margin-left:8px;font-size:11px' },
                      `· ${s.allowed_domains.slice(0, 3).join(', ')}`)
                  : null,
              ),
            ),
          );
        }),
      ),
    ));
  }

  return wrap;
}

// DW Setup Step 0 — pick which priority to work on
function renderDWStep0(wrap) {
  const priorities = S.plan?.priorities || [];

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Which Priority Are You Starting?'),
    h('p', { class: 'text-muted', style: 'margin-bottom:16px;font-size:13px' },
      "Deep work starts with your highest priority. Don't rearrange unless you have a first-principles reason."
    ),

    !S.plan
      ? h('div', { class: 'alert alert-orange', style: 'margin-bottom:12px' },
          '⚠ No morning plan set. Set priorities first for maximum focus.')
      : null,

    // Priority cards
    ...priorities.map((p, idx) => {
      const isSelected = S.dwSetupData.priority_index === idx;
      return h('div', {
        class: `priority-select-card ${isSelected ? 'selected' : ''}`,
        onClick: () => {
          S.dwSetupData.priority_index = idx;
          S.dwSetupData.focus_area = p.area;
          render();
        },
      },
        h('div', { class: 'priority-select-header' },
          h('div', { class: 'priority-select-rank' }, `P${idx+1}`),
          h('div', { style: 'flex:1;min-width:0' },
            h('div', { class: 'priority-select-text' }, p.text),
            p.why
              ? h('div', { class: 'priority-select-why' },
                  `"${p.why.slice(0, 90)}${p.why.length > 90 ? '…' : ''}"`)
              : null,
          ),
          h('div', { style: 'text-align:right;flex-shrink:0;margin-left:8px' },
            h('span', { class: `priority-area ${areaClass(p.area)}` }, p.area),
            h('div', { class: 'text-muted', style: 'font-size:11px;margin-top:4px' },
              `${p.expected_hours || '?'}h${p.is_tentative ? '~' : ''}`),
          ),
        ),
      );
    }),

    // Other option
    h('div', {
      class: `priority-select-card ${S.dwSetupData.priority_index === -1 ? 'selected' : ''}`,
      style: 'margin-top:8px;border-style:dashed',
      onClick: () => {
        S.dwSetupData.priority_index = -1;
        if (!S.dwSetupData.focus_area) S.dwSetupData.focus_area = null;
        render();
      },
    },
      h('div', { class: 'priority-select-header' },
        h('div', { class: 'priority-select-rank', style: 'background:var(--bg-muted);color:var(--text-3)' }, '?'),
        h('div', { style: 'flex:1' },
          h('div', { class: 'priority-select-text' }, 'Other work (not in today\'s priorities)'),
          h('div', { class: 'priority-select-why' }, 'Select area →'),
        ),
      ),
      S.dwSetupData.priority_index === -1
        ? h('div', { class: 'focus-area-grid', style: 'margin-top:12px' },
            ...['Product', 'Tech', 'People', 'Admin'].map(area => {
              const key = area.toLowerCase();
              return h('button', {
                class: `focus-area-btn ${S.dwSetupData.focus_area === area ? `active-${key}` : ''}`,
                onClick: (e) => { e.stopPropagation(); S.dwSetupData.focus_area = area; render(); },
              }, area);
            }),
          )
        : null,
    ),
  ));

  const canNext = S.dwSetupData.priority_index !== null &&
    (S.dwSetupData.priority_index !== -1 || S.dwSetupData.focus_area !== null);

  wrap.appendChild(h('div', { class: 'mt-16', style: 'text-align:right' },
    h('button', {
      class: 'btn btn-primary',
      ...(canNext ? {} : { disabled: 'disabled' }),
      onClick: () => {
        if (!canNext) return;
        const idx  = S.dwSetupData.priority_index;
        const area = idx >= 0
          ? (S.plan?.priorities?.[idx]?.area || S.dwSetupData.focus_area)
          : S.dwSetupData.focus_area;
        S.dwSetupData.focus_area      = area;
        S.dwSetupData.allowed_domains = DOMAIN_SUGGESTIONS(area).slice(0, 2);
        S.dwSetupStep = 1;
        render();
      },
    }, 'Next → Set Focus Zones →'),
  ));
}

// DW Setup Step 1 — set allowed domains
function renderDWStep1(wrap) {
  const area      = S.dwSetupData.focus_area || '';
  const suggestions = DOMAIN_SUGGESTIONS(area);
  const pidx      = S.dwSetupData.priority_index;
  const priority  = pidx >= 0 ? S.plan?.priorities?.[pidx] : null;

  if (priority) {
    wrap.appendChild(h('div', { class: 'card', style: 'background:var(--bg-subtle);margin-bottom:16px' },
      h('div', { class: 'flex-between' },
        h('div', { style: 'min-width:0' },
          h('div', { class: 'text-muted', style: 'font-size:10px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase' },
            `Working on P${pidx+1}`),
          h('div', { class: 'fw-600', style: 'margin-top:4px;font-size:14px' }, priority.text),
          priority.why
            ? h('div', { class: 'text-muted', style: 'font-size:12px;font-style:italic;margin-top:4px;border-left:2px solid var(--border);padding-left:8px' },
                `"${priority.why}"`)
            : null,
        ),
        h('span', { class: `priority-area ${areaClass(area)}`, style: 'flex-shrink:0;margin-left:12px' }, area),
      ),
    ));
  }

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, '🔒 Focus Zones — Allowed Sites'),
    h('p', { class: 'text-muted', style: 'margin-bottom:12px;font-size:13px' },
      'Define which domains you may visit during this session. Everything else is off-limits.',
      h('br', {}),
      'Enforce with ', h('strong', {}, 'StayFocusd'), ' on Chrome or ',
      h('strong', {}, 'Cold Turkey'), ' on Comet before starting.',
    ),

    h('div', { class: 'domain-tags', id: 'domain-tags' },
      ...S.dwSetupData.allowed_domains.map(d =>
        h('span', { class: 'domain-tag' },
          d,
          h('button', {
            class: 'domain-tag-remove',
            onClick: () => {
              S.dwSetupData.allowed_domains = S.dwSetupData.allowed_domains.filter(x => x !== d);
              render();
            },
          }, '✕'),
        )
      ),
      S.dwSetupData.allowed_domains.length === 0
        ? h('span', { class: 'text-muted', style: 'font-size:12px' }, 'No domains added yet')
        : null,
    ),

    h('div', { class: 'domain-input-row', style: 'margin-top:12px' },
      h('input', {
        class: 'input', id: 'domain-input', type: 'text',
        placeholder: 'github.com',
        value: S.dwDomainInput,
        onInput:   (e) => { S.dwDomainInput = e.target.value; },
        onKeydown: (e) => { if (e.key === 'Enter') { addDomain(); e.preventDefault(); } },
      }),
      h('button', { class: 'btn btn-secondary btn-sm', onClick: addDomain }, '+ Add'),
    ),

    suggestions.filter(s => !S.dwSetupData.allowed_domains.includes(s)).length > 0
      ? h('div', { class: 'domain-suggestions', style: 'margin-top:10px' },
          h('span', { class: 'text-muted', style: 'font-size:11px;margin-right:6px' }, 'Quick add:'),
          ...suggestions
            .filter(s => !S.dwSetupData.allowed_domains.includes(s))
            .map(s =>
              h('button', {
                class: 'domain-suggest-btn',
                onClick: () => {
                  if (!S.dwSetupData.allowed_domains.includes(s))
                    S.dwSetupData.allowed_domains.push(s);
                  render();
                },
              }, `+ ${s}`)
            ),
        )
      : null,

    h('div', { class: 'alert alert-orange', style: 'margin-top:14px' },
      '⚠ This logs your intended focus zones. Open your blocking tool NOW before starting.'),
  ));

  wrap.appendChild(h('div', { class: 'flex-between mt-16' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.dwSetupStep = 0; render(); } }, '← Back'),
    h('button', { class: 'btn btn-primary btn-lg', id: 'start-btn', onClick: startSession }, '▶ Start Deep Work'),
  ));
}

function addDomain() {
  const inp = el('domain-input');
  const raw = (inp?.value || S.dwDomainInput || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!raw) return;
  if (!S.dwSetupData.allowed_domains.includes(raw))
    S.dwSetupData.allowed_domains.push(raw);
  S.dwDomainInput = '';
  render();
}

// Active session view
function renderDWActive(wrap) {
  const area     = S.activeSession.focus_area    || '';
  const aKey     = area.toLowerCase();
  const pidx     = S.activeSession.priority_index;
  const ptext    = S.activeSession.priority_text  || '';
  const domains  = S.activeSession.allowed_domains || [];
  const priority = (pidx >= 0) ? S.plan?.priorities?.[pidx] : null;

  // Priority context card
  wrap.appendChild(h('div', { class: 'card', style: 'background:var(--bg-subtle);margin-bottom:16px' },
    h('div', { class: 'card-title' },
      pidx >= 0 ? `Active: P${pidx+1} Deep Work` : `Active: ${area} Deep Work`),
    h('div', { class: 'fw-600', style: 'font-size:15px;margin-bottom:6px' }, ptext),
    priority?.why
      ? h('div', { class: 'text-muted', style: 'font-size:12px;font-style:italic;border-left:2px solid var(--border);padding-left:8px' },
          `"${priority.why}"`)
      : null,
    h('div', { class: 'flex-between', style: 'margin-top:10px' },
      h('span', {
        class: `badge badge-${aKey === 'tech' ? 'green' : aKey === 'product' ? 'blue' : aKey === 'people' ? 'gray' : 'orange'}`,
      }, area),
      h('span', { class: 'text-muted' },
        `Started ${new Date(S.activeSession.start_ms).toLocaleTimeString()}`),
    ),
  ));

  // Timer
  wrap.appendChild(h('div', { class: 'timer-display' },
    h('div', { class: 'timer-digits', id: 'timer-display' },
      fmtTime(Date.now() - S.activeSession.start_ms)),
    h('p', { class: 'timer-status' }, `${area} · stay locked in.`),
  ));

  // Allowed domains reminder
  if (domains.length > 0) {
    wrap.appendChild(h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'flex-between mb-8' },
        h('span', { class: 'card-title', style: 'margin-bottom:0' }, '🔒 Focus Zones Active'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: showBlockedSiteModal }, '🚨 Need another site?'),
      ),
      h('div', { class: 'domain-tags' },
        ...domains.map(d => h('span', { class: 'domain-tag domain-tag-active' }, d)),
      ),
    ));
  }

  // Outcome
  wrap.appendChild(h('div', { class: 'form-group mt-16' },
    h('label', { class: 'label' }, 'Session Outcome (fill before ending)'),
    h('textarea', {
      class: 'textarea', id: 'session-outcome',
      placeholder: 'What specifically will you have produced when this session ends?',
      style: 'min-height:70px',
    }),
  ));

  wrap.appendChild(h('div', { class: 'timer-controls' },
    h('button', { class: 'btn btn-red btn-lg', onClick: endSession }, '■ End Session'),
  ));

  if (S.timerInterval) clearInterval(S.timerInterval);
  S.timerInterval = setInterval(() => {
    const d = el('timer-display');
    if (d) d.textContent = fmtTime(Date.now() - S.activeSession.start_ms);
    else   clearInterval(S.timerInterval);
  }, 1000);
}

function showBlockedSiteModal() {
  const modal = h('div', {
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px',
    onClick: (e) => { if (e.target === modal) modal.remove(); },
  },
    h('div', { style: 'background:#fff;border-radius:12px;max-width:440px;width:100%;padding:24px' },
      h('h3', { style: 'margin-bottom:12px' }, '🚨 Accessing a Blocked Site'),
      h('p', { class: 'text-muted', style: 'margin-bottom:16px;font-size:13px' },
        "If it's genuinely necessary, justify it. What site and why is it critical right now?"),
      h('textarea', {
        class: 'textarea', id: 'blocked-justify',
        placeholder: "e.g. Need to review a PR comment directly related to this session's task",
        style: 'min-height:80px;margin-bottom:12px',
      }),
      h('div', { class: 'flex-between' },
        h('button', { class: 'btn btn-ghost', onClick: () => modal.remove() }, 'Cancel — stay focused'),
        h('button', { class: 'btn btn-primary', onClick: () => modal.remove() }, 'Log & Proceed'),
      ),
    ),
  );
  document.body.appendChild(modal);
}

async function startSession() {
  const btn = el('start-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  const pidx     = S.dwSetupData.priority_index;
  const priority = pidx >= 0 ? S.plan?.priorities?.[pidx] : null;
  const area     = S.dwSetupData.focus_area || priority?.area || 'Other';
  const ptext    = priority?.text || '';
  const domains  = [...S.dwSetupData.allowed_domains];
  try {
    const session = await API.post('/api/sessions', {
      date: S.today, focus_area: area,
      priority_index: pidx, priority_text: ptext,
      allowed_domains: domains, start_time: new Date().toISOString(),
    });
    S.activeSession = {
      id: session.id, start_ms: Date.now(),
      focus_area: area, priority_index: pidx,
      priority_text: ptext, allowed_domains: domains,
    };
    localStorage.setItem('cq_active_session', JSON.stringify(S.activeSession));
    render();
  } catch (e) {
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start Deep Work'; }
  }
}

async function endSession() {
  if (!S.activeSession) return;
  const outcome = el('session-outcome')?.value || '';
  if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
  const end = new Date().toISOString();
  const dur = Math.round((Date.now() - S.activeSession.start_ms) / 60000);
  try {
    await API.patch(`/api/sessions/${S.activeSession.id}`, {
      end_time: end, duration_minutes: dur, outcome,
    });
    localStorage.removeItem('cq_active_session');
    S.activeSession = null;
    S.dwSetupStep   = 0;
    S.dwSetupData   = { priority_index: null, focus_area: null, allowed_domains: [] };
    await loadTodaySessions();
    await loadStats();
    render();
  } catch (e) {
    alert('Error ending session: ' + e.message);
  }
}

// ── EOD REVIEW ────────────────────────────────────────────────────────────────

function renderEOD() {
  if (S.review) return renderVerdict(S.review);
  const steps = ['Deep Work', 'Outcomes', 'Blocker', 'Tomorrow', 'Verdict'];
  const wrap  = document.createElement('div');
  const dots  = h('div', { class: 'wizard-steps' },
    ...steps.map((_, i) => h('div', {
      class: `wizard-step-dot ${i < S.eodStep ? 'done' : i === S.eodStep ? 'active' : ''}`,
    })),
  );
  if      (S.eodStep === 0) renderEODStep0(wrap, dots);
  else if (S.eodStep === 1) renderEODStep1(wrap, dots);
  else if (S.eodStep === 2) renderEODStep2(wrap, dots);
  else if (S.eodStep === 3) renderEODStep3(wrap, dots);
  else if (S.eodStep === 4) wrap.appendChild(renderVerdict(S.review));
  return wrap;
}

function renderEODStep0(wrap, dots) {
  const actual_dw = S.sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0) / 60;
  const time      = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'End of Day Review'),
    h('p',  { class: 'wizard-subtitle' },
      `It's ${time}. Time to account for your day. No vague answers. No excuses.`),
  ));
  if (!S.plan) {
    wrap.appendChild(h('div', { class: 'alert alert-orange' },
      'No plan set for today. You can still log your deep work and outcomes.'));
  }
  wrap.appendChild(h('div', { class: 'card' },
    h('label', { class: 'label' },
      'How many hours of UNINTERRUPTED deep work did you do today?',
      h('span', { class: 'label-hint' }, ` (Timer logged: ${actual_dw.toFixed(1)}h)`),
    ),
    h('div', { class: 'dw-input-wrapper', style: 'margin-top:10px' },
      h('input', {
        type: 'number', id: 'eod-dw', min: '0', max: '16', step: '0.5',
        value: S.eodData.deep_work_hours || actual_dw.toFixed(1),
        onInput: (e) => { S.eodData.deep_work_hours = e.target.value; },
      }),
      h('span', { class: 'dw-unit' }, 'hours'),
    ),
    h('div', { id: 'dw-pushback' }),
  ));
  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('span'),
    h('button', {
      class: 'btn btn-primary', onClick: () => {
        const hrs = parseFloat(S.eodData.deep_work_hours);
        if (isNaN(hrs) || hrs < 0 || hrs > 16) { alert('Enter a valid number (0–16).'); return; }
        S.eodData.deep_work_hours = hrs;
        if (S.plan && S.eodData.priority_outcomes.length === 0) {
          S.eodData.priority_outcomes = (S.plan.priorities || []).map(p => ({
            text: p.text, completed: '', outcome: '',
          }));
        } else if (!S.plan && S.eodData.priority_outcomes.length === 0) {
          S.eodData.priority_outcomes = [
            { text: 'Priority 1', completed: '', outcome: '' },
            { text: 'Priority 2', completed: '', outcome: '' },
            { text: 'Priority 3', completed: '', outcome: '' },
          ];
        }
        S.eodStep = 1; render();
      },
    }, 'Next →'),
  ));
  const inp = wrap.querySelector('#eod-dw');
  if (inp) {
    inp.addEventListener('input', (e) => {
      const v  = parseFloat(e.target.value);
      const pb = wrap.querySelector('#dw-pushback');
      if (!pb) return;
      pb.innerHTML = '';
      if (isNaN(v)) return;
      const div = document.createElement('div');
      div.className = 'pushback-box';
      if (v < 1)      div.textContent = `${v}h of deep work. That's surviving, not building. What robbed your focus?`;
      else if (v < 3) div.textContent = `${v}h. Below minimum viable focus. Tomorrow: first 4 hours are non-negotiable.`;
      else return;
      pb.appendChild(div);
    });
  }
}

function renderEODStep1(wrap, dots) {
  const priorities = S.eodData.priority_outcomes;
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Priority Outcomes'),
    h('p',  { class: 'wizard-subtitle' },
      "For each priority, state the SPECIFIC outcome. Activities are not outcomes."),
  ));
  priorities.forEach((p, idx) => {
    const errId  = `err-${idx}`;
    const plan_p = S.plan?.priorities?.[idx];
    wrap.appendChild(h('div', { class: 'priority-block' },
      h('div', { class: 'priority-block-num' },
        S.plan ? `P${idx+1} · ${plan_p?.area || ''}` : `Priority ${idx+1}`),
      h('div', { class: 'fw-600', style: 'margin-bottom:10px;font-size:13px' }, p.text),
      h('div', { class: 'form-group' },
        h('label', { class: 'label' }, 'Completion Status'),
        h('div', { class: 'outcome-status-group' },
          ...['yes', 'partial', 'no'].map(status =>
            h('button', {
              class: `outcome-status-btn ${p.completed === status ? `sel-${status}` : ''}`,
              onClick: () => { S.eodData.priority_outcomes[idx].completed = status; render(); },
            }, status === 'yes' ? '✓ Done' : status === 'partial' ? '~ Partial' : '✗ Not done')
          ),
        ),
      ),
      h('div', { class: 'form-group', style: 'margin-bottom:0' },
        h('label', { class: 'label' },
          'Specific Output',
          h('span', { class: 'label-hint' }, ' — what exactly was produced, decided, or shipped?'),
        ),
        h('textarea', {
          class: 'textarea', id: `outcome-${idx}`,
          placeholder: 'e.g. "Shipped onboarding flow v1 to staging. 3 edge cases fixed."',
          onInput: (e) => {
            S.eodData.priority_outcomes[idx].outcome = e.target.value;
            el(errId) && (el(errId).innerHTML = '');
          },
        }, p.outcome),
        h('div', { id: errId }),
      ),
    ));
  });
  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.eodStep = 0; render(); } }, '← Back'),
    h('button', {
      class: 'btn btn-primary', onClick: () => {
        let hasErrors = false;
        S.eodData.priority_outcomes.forEach((p, idx) => {
          const errEl = el(`err-${idx}`);
          const errors = [];
          if (!p.completed) { errors.push('Select a completion status.'); hasErrors = true; }
          const oe = validateOutcome(p.outcome);
          if (oe.length > 0) { errors.push(...oe); hasErrors = true; }
          if (errEl) {
            errEl.innerHTML = '';
            if (errors.length > 0) {
              errors.forEach(e => {
                const d = document.createElement('div');
                d.className = 'eod-validation-error';
                d.textContent = '❌ ' + e;
                errEl.appendChild(d);
              });
              const ta = el(`outcome-${idx}`);
              if (ta) { S.eodData.priority_outcomes[idx].outcome = ta.value; ta.classList.add('error'); }
            } else {
              const ta = el(`outcome-${idx}`);
              if (ta) ta.classList.remove('error');
            }
          }
        });
        if (!hasErrors) { S.eodStep = 2; render(); }
        else {
          const firstErr = wrap.querySelector('.eod-validation-error');
          if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },
    }, 'Next →'),
  ));
}

function renderEODStep2(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Main Blocker'),
    h('p',  { class: 'wizard-subtitle' }, "What ONE thing blocked you most today? 'Distractions' is not an answer."),
  ));
  wrap.appendChild(h('div', { class: 'card' },
    h('textarea', {
      class: 'textarea', id: 'blocker-input', style: 'min-height:100px',
      placeholder: 'e.g. "Spent 2h in unplanned investor call. No agenda. Need to gate-keep calendar."',
      onInput: (e) => { S.eodData.main_blocker = e.target.value; },
    }, S.eodData.main_blocker),
    h('div', { id: 'blocker-err' }),
  ));
  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.eodStep = 1; render(); } }, '← Back'),
    h('button', {
      class: 'btn btn-primary', onClick: () => {
        const v = el('blocker-input')?.value || '';
        S.eodData.main_blocker = v;
        const errs = [];
        if (v.trim().length < 20) errs.push('Be specific. Min 20 characters.');
        const vague = VAGUE_CHECK(v);
        if (vague.length > 0) errs.push(`Vague: "${vague.join('", "')}". Name the exact blocker.`);
        const errEl = el('blocker-err');
        if (errs.length > 0) {
          errEl.innerHTML = '';
          errs.forEach(e => {
            const d = document.createElement('div');
            d.className = 'eod-validation-error';
            d.textContent = '❌ ' + e;
            errEl.appendChild(d);
          });
        } else { S.eodStep = 3; render(); }
      },
    }, 'Next →'),
  ));
}

function renderEODStep3(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, "Tomorrow's Focus"),
    h('p',  { class: 'wizard-subtitle' }, 'What is the SINGLE most critical thing tomorrow? Not a list. ONE thing.'),
  ));
  wrap.appendChild(h('div', { class: 'card' },
    h('input', {
      class: 'input', id: 'tomorrow-input', type: 'text',
      style: 'font-size:15px;padding:12px',
      placeholder: 'e.g. Ship curriculum module v1 to 5 beta users',
      onInput: (e) => { S.eodData.tomorrow_focus = e.target.value; },
    }),
    h('div', { id: 'tomorrow-err' }),
  ));
  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.eodStep = 2; render(); } }, '← Back'),
    h('button', { class: 'btn btn-primary btn-lg', id: 'submit-eod-btn', onClick: submitEOD }, 'Submit & Get Verdict →'),
  ));
}

async function submitEOD() {
  const v = el('tomorrow-input')?.value || '';
  S.eodData.tomorrow_focus = v;
  if (!v.trim() || v.trim().length < 10) {
    const errEl = el('tomorrow-err');
    if (errEl) {
      errEl.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'eod-validation-error';
      d.textContent = '❌ Be specific. Min 10 characters.';
      errEl.appendChild(d);
    }
    return;
  }
  const btn = el('submit-eod-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating…'; }
  try {
    S.review = await API.post('/api/reviews', {
      date: S.today,
      deep_work_hours:   S.eodData.deep_work_hours,
      priority_outcomes: S.eodData.priority_outcomes,
      main_blocker:      S.eodData.main_blocker,
      tomorrow_focus:    S.eodData.tomorrow_focus,
    });
    await loadStats();
    S.eodStep = 4; render();
  } catch (e) {
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit & Get Verdict →'; }
  }
}

function renderVerdict(review) {
  const wrap      = document.createElement('div');
  const letter    = review.grade_letter || review.grade?.[0] || '?';
  const feedback  = typeof review.feedback === 'string'
    ? JSON.parse(review.feedback) : (review.feedback || []);
  const breakdown = typeof review.score_breakdown === 'string'
    ? JSON.parse(review.score_breakdown) : (review.score_breakdown || {});

  wrap.appendChild(h('div', { class: 'flex-between mb-16' },
    h('h2', {}, 'EOD Verdict'),
    h('span', { class: 'text-muted' }, fmtDate(review.date)),
  ));
  wrap.appendChild(h('div', { class: 'verdict-score card' },
    h('div', { class: `grade-circle grade-${letter}` }, letter),
    h('div', { class: 'verdict-grade-label' }, review.grade),
    h('div', { class: 'verdict-score-num' }, `${review.execution_score}/100 execution score`),
    h('div', { class: 'score-breakdown', style: 'margin-top:20px' },
      h('div', { class: 'breakdown-item' },
        h('div', { class: 'breakdown-val' }, `${breakdown.deep_work?.score || 0}/${breakdown.deep_work?.max || 35}`),
        h('div', { class: 'breakdown-lbl' }, `Deep Work (${review.deep_work_hours}h)`),
      ),
      h('div', { class: 'breakdown-item' },
        h('div', { class: 'breakdown-val' }, `${breakdown.priorities?.score || 0}/${breakdown.priorities?.max || 40}`),
        h('div', { class: 'breakdown-lbl' },
          `Priorities (${breakdown.priorities?.completed || 0}+${breakdown.priorities?.partial || 0}/${breakdown.priorities?.total || 3})`),
      ),
      h('div', { class: 'breakdown-item' },
        h('div', { class: 'breakdown-val' }, `${breakdown.quality?.score || 0}/${breakdown.quality?.max || 25}`),
        h('div', { class: 'breakdown-lbl' }, `Quality (${breakdown.quality?.label || '—'})`),
      ),
    ),
  ));
  wrap.appendChild(h('div', { class: 'card mt-16' },
    h('div', { class: 'card-title' }, 'Verdict'),
    h('ul', { class: 'feedback-list' },
      ...feedback.map(f => h('li', { class: 'feedback-item' }, f)),
    ),
  ));
  wrap.appendChild(h('div', { class: 'card mt-16' },
    h('div', { class: 'card-title' }, 'Main Blocker Today'),
    h('p', { style: 'font-size:13px;color:var(--text-2)' }, review.main_blocker),
  ));
  wrap.appendChild(h('div', { class: 'tomorrow-box' },
    h('div', { class: 'tomorrow-label' }, "Tomorrow's #1 Priority"),
    h('div', { class: 'tomorrow-text' }, review.tomorrow_focus),
  ));
  wrap.appendChild(h('div', { class: 'mt-20', style: 'display:flex;gap:10px' },
    h('button', { class: 'btn btn-primary', onClick: () => navigate('plan')    }, '📋 Plan Tomorrow'),
    h('button', { class: 'btn btn-ghost',   onClick: () => navigate('warroom') }, '📊 War Room'),
  ));
  return wrap;
}

// ── WAR ROOM ──────────────────────────────────────────────────────────────────

async function renderWarRoom() {
  const wrap = document.createElement('div');

  wrap.appendChild(h('div', { class: 'flex-between mb-16' },
    h('h2', {}, 'War Room'),
    h('div', { class: 'tab-row' },
      h('button', {
        class: `tab-btn ${S.warRoomTab === 'charts' ? 'active' : ''}`,
        onClick: () => { S.warRoomTab = 'charts'; render(); },
      }, '📊 Charts'),
      h('button', {
        class: `tab-btn ${S.warRoomTab === 'log' ? 'active' : ''}`,
        onClick: () => { S.warRoomTab = 'log'; render(); },
      }, '📅 Daily Log'),
    ),
  ));

  if (!S.stats) {
    wrap.appendChild(h('p', { class: 'text-muted' }, 'Loading…'));
    loadStats().then(render);
    return wrap;
  }

  wrap.appendChild(h('div', { class: 'metrics-row', style: 'margin-bottom:20px' },
    h('div', { class: 'metric' },
      h('div', { class: 'metric-val' }, `${S.stats.avg_deep_work_7d}h`),
      h('div', { class: 'metric-lbl' }, 'Avg Deep Work / Day'),
    ),
    h('div', { class: 'metric' },
      h('div', { class: 'metric-val' }, S.stats.avg_score_7d || '—'),
      h('div', { class: 'metric-lbl' }, 'Avg Score (7d)'),
    ),
    h('div', { class: 'metric' },
      h('div', { class: 'metric-val' }, S.stats.streak),
      h('div', { class: 'metric-lbl' }, 'Review Streak'),
    ),
    h('div', { class: 'metric' },
      h('div', { class: 'metric-val' }, `${S.stats.total_dw_hours}h`),
      h('div', { class: 'metric-lbl' }, 'Total Deep Work'),
    ),
  ));

  if (S.warRoomTab === 'charts') {
    renderWarRoomCharts(wrap);
  } else {
    await renderWarRoomLog(wrap);
  }
  return wrap;
}

function renderWarRoomCharts(wrap) {
  const reviews = (S.stats.recent_reviews || []).slice().reverse();
  if (reviews.length === 0) {
    wrap.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, '📊'),
      h('div', { class: 'empty-title' }, 'No reviews yet.'),
      h('p',   { class: 'empty-sub' }, 'Complete your first EOD review to start tracking.'),
      h('button', { class: 'btn btn-primary', onClick: () => navigate('eod') }, 'Start EOD Review'),
    ));
    return;
  }
  wrap.appendChild(h('div', { class: 'card mb-16' },
    h('div', { class: 'card-title' }, 'Deep Work Hours (last 14 days)'),
    renderChart(reviews, 'dw'),
  ));
  wrap.appendChild(h('div', { class: 'card mb-16' },
    h('div', { class: 'card-title' }, 'Execution Score (last 14 days)'),
    renderChart(reviews, 'score'),
  ));
}

async function renderWarRoomLog(wrap) {
  const reviews = S.stats.recent_reviews || [];
  if (reviews.length === 0) {
    wrap.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, '📅'),
      h('div', { class: 'empty-title' }, 'No days logged yet.'),
      h('p',   { class: 'empty-sub' }, 'Complete your first EOD review to start your daily log.'),
    ));
    return;
  }

  const logList = h('div', { class: 'daily-log-list' });
  for (const r of reviews) {
    const isExpanded = !!S.dailyLogData[r.date];
    const gc = gradeColor(r.grade_letter);

    const header = h('div', { class: 'daily-log-header',
      onClick: async () => {
        if (S.dailyLogData[r.date]) {
          delete S.dailyLogData[r.date];
          render();
        } else {
          try {
            S.dailyLogData[r.date] = await API.get(`/api/daily-log/${r.date}`);
            render();
          } catch (e) { alert('Error: ' + e.message); }
        }
      },
    },
      h('div', { class: 'daily-log-date' },
        h('span', { class: 'fw-600' }, fmtDateShort(r.date)),
        h('span', {
          class: `grade-chip grade-${r.grade_letter}`,
          style: `background:var(--${gc}-bg);color:var(--${gc});border:1px solid var(--${gc}-border);margin-left:10px`,
        }, r.grade_letter || '?'),
      ),
      h('div', { class: 'daily-log-meta' },
        h('span', {}, `${r.execution_score || 0}/100`),
        h('span', {}, `${r.deep_work_hours || 0}h DW`),
        h('span', { class: 'daily-log-toggle' }, isExpanded ? '▲' : '▼'),
      ),
    );

    const item = h('div', { class: `daily-log-item ${isExpanded ? 'expanded' : ''}` }, header);
    if (isExpanded && S.dailyLogData[r.date]) {
      item.appendChild(renderDailyLogDetail(S.dailyLogData[r.date]));
    }
    logList.appendChild(item);
  }
  wrap.appendChild(logList);
}

function renderDailyLogDetail(data) {
  const detail = h('div', { class: 'daily-log-detail' });

  // Priorities
  if (data.plan?.priorities?.length > 0) {
    const outcomes = data.review?.priority_outcomes || [];
    detail.appendChild(h('div', { class: 'log-section' },
      h('div', { class: 'log-section-title' }, '📋 Priorities'),
      ...data.plan.priorities.map((p, i) => {
        const oc     = outcomes[i];
        const status = oc?.completed || 'pending';
        const icon   = { yes: '✓', partial: '~', no: '✗', pending: '·' }[status] || '·';
        return h('div', { class: 'log-priority-row' },
          h('span', { class: `log-status log-status-${status}` }, icon),
          h('div', { style: 'flex:1;min-width:0' },
            h('div', { class: 'fw-600', style: 'font-size:13px' }, `P${i+1}: ${p.text}`),
            p.why
              ? h('div', { class: 'text-muted', style: 'font-size:11px;font-style:italic;margin-top:2px' },
                  `"${p.why}"`)
              : null,
            oc?.outcome
              ? h('div', { class: 'text-muted', style: 'font-size:12px;margin-top:4px;padding-left:6px;border-left:2px solid var(--border)' },
                  oc.outcome)
              : null,
          ),
          h('div', { style: 'text-align:right;flex-shrink:0;margin-left:8px' },
            h('span', { class: `priority-area ${areaClass(p.area)}`, style: 'font-size:10px' }, p.area),
            h('div', { class: 'text-muted', style: 'font-size:11px;margin-top:2px' },
              `${p.expected_hours || '?'}h${p.is_tentative ? '~' : ''}`),
          ),
        );
      }),
    ));
  }

  // Sessions
  const doneSessions = (data.sessions || []).filter(s => s.end_time);
  if (doneSessions.length > 0) {
    detail.appendChild(h('div', { class: 'log-section' },
      h('div', { class: 'log-section-title' }, '⚡ Deep Work Sessions'),
      ...doneSessions.map(s =>
        h('div', { class: 'log-session-row' },
          h('span', { class: 'session-dur', style: 'width:52px;flex-shrink:0' }, fmtDuration(s.duration_minutes)),
          h('div', { style: 'flex:1;min-width:0' },
            h('div', { style: 'font-size:12px;font-weight:600' },
              s.priority_text
                ? `P${(s.priority_index ?? 0)+1} · ${s.priority_text.slice(0,45)}${s.priority_text.length > 45 ? '…' : ''}`
                : s.focus_area,
              h('span', { class: 'text-muted', style: 'font-weight:400;margin-left:6px' },
                `${new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`),
            ),
            s.allowed_domains?.length
              ? h('div', { class: 'text-muted', style: 'font-size:11px' }, s.allowed_domains.join(', '))
              : null,
            s.outcome
              ? h('div', { class: 'text-muted', style: 'font-size:11px;margin-top:2px' }, s.outcome)
              : null,
          ),
        )
      ),
    ));
  }

  // Review summary
  if (data.review) {
    const r = data.review;
    detail.appendChild(h('div', { class: 'log-section' },
      h('div', { class: 'log-section-title' }, '📝 EOD Summary'),
      r.main_blocker
        ? h('div', { class: 'text-muted', style: 'font-size:12px;margin-bottom:4px' },
            `Blocker: ${r.main_blocker}`)
        : null,
      r.tomorrow_focus
        ? h('div', { class: 'text-muted', style: 'font-size:12px' },
            `Tomorrow: ${r.tomorrow_focus}`)
        : null,
    ));
  }

  return detail;
}

function renderChart(reviews, type) {
  const maxVal = type === 'dw' ? Math.max(8, ...reviews.map(r => r.deep_work_hours || 0)) : 100;
  return h('div', { class: 'chart-container' },
    h('div', { class: 'chart-bars' },
      ...reviews.slice(-14).map(r => {
        const val      = type === 'dw' ? (r.deep_work_hours || 0) : (r.execution_score || 0);
        const pct      = Math.max(3, Math.round((val / maxVal) * 100));
        const grade    = r.grade_letter || 'F';
        const barClass = grade === 'S' || grade === 'A' ? 'good'
          : grade === 'B' ? 'filled' : grade === 'C' ? 'warn' : 'bad';
        const dateStr  = r.date ? r.date.slice(5) : '';
        return h('div', { class: 'chart-bar-wrap' },
          h('div', {
            class: `chart-bar ${barClass}`,
            style: `height:${pct}%`,
            title: `${dateStr}: ${val}${type === 'dw' ? 'h' : ''}`,
          }),
          h('span', { class: 'chart-bar-date' }, dateStr),
        );
      }),
    ),
  );
}

// ── INIT + RENDER ─────────────────────────────────────────────────────────────

async function init() {
  try {
    S.user = await API.get('/api/user');
    if (S.user) await loadAll();
  } catch (e) {
    console.error('Init error:', e);
  }
  render();
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  if (!S.user) {
    app.appendChild(renderLanding());
    return;
  }

  app.appendChild(renderHeader());
  app.appendChild(renderNav());

  const main = document.createElement('div');
  main.className = 'main';
  app.appendChild(main);

  if (S.view === 'warroom') {
    renderWarRoom().then(frag => main.appendChild(frag));
  } else {
    const views = {
      dashboard: renderDashboard,
      plan:      renderPlanWizard,
      deepwork:  renderDeepWork,
      eod:       renderEOD,
    };
    const result = (views[S.view] || renderDashboard)();
    if (result) main.appendChild(result);
  }
}

document.addEventListener('DOMContentLoaded', init);
