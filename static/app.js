/* ═══════════════════════════════════════════════════════════════
   COSMIC Q OPS — Frontend SPA
   No mercy. Pure signal.
═══════════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────

const S = {
  user: null,
  view: 'dashboard',
  today: new Date().toISOString().split('T')[0],
  plan: null,
  review: null,
  sessions: [],
  stats: null,

  // Morning plan wizard
  planStep: 0,
  planDraft: {
    priorities: [
      { text: '', area: '', why: '' },
      { text: '', area: '', why: '' },
      { text: '', area: '', why: '' },
    ],
    deep_work_target: 4,
  },

  // Deep work
  activeSession: null,   // { id, start_ms, focus_area }
  timerInterval: null,

  // EOD wizard
  eodStep: 0,
  eodData: {
    deep_work_hours: '',
    priority_outcomes: [],   // [{ text, completed, outcome }]
    main_blocker: '',
    tomorrow_focus: '',
  },
  eodErrors: {},
};

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
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild((typeof c === 'string' || typeof c === 'number') ? document.createTextNode(String(c)) : c);
  }
  return e;
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
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

function areaClass(area) {
  return area ? `area-${area.toLowerCase()}` : '';
}

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
  if (text.trim().length < 30) {
    errors.push('Too short. What specifically was the output? Min 30 characters.');
  }
  const vague = VAGUE_CHECK(text);
  if (vague.length > 0) {
    errors.push(`Vague language: "${vague.join('", "')}" — activities ≠ outcomes. What exactly was produced, decided, or shipped?`);
  }
  return errors;
}

// ── RENDER ENGINE ─────────────────────────────────────────────────────────────

// ── HEADER / NAV ──────────────────────────────────────────────────────────────

function renderHeader() {
  const streak = S.stats ? S.stats.streak : 0;
  const hdr = h('div', { class: 'header' },
    h('div', { class: 'logo' },
      h('div', { class: 'logo-mark' }, 'CQ'),
      'COSMIC Q OPS'
    ),
    h('div', { class: 'header-meta' },
      streak > 0 ? h('span', { class: 'streak-badge' }, `🔥 ${streak}d streak`) : null,
      h('span', {}, S.user.name),
      h('span', {}, fmtDate(S.today)),
    )
  );
  return hdr;
}

function renderNav() {
  const items = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'plan',      label: 'Morning Kickoff' },
    { id: 'deepwork',  label: 'Deep Work' },
    { id: 'eod',       label: 'EOD Review' },
    { id: 'warroom',   label: 'War Room' },
  ];
  const nav = h('div', { class: 'nav' },
    ...items.map(({ id, label }) =>
      h('button', {
        class: `nav-btn ${S.view === id ? 'active' : ''}`,
        onClick: () => navigate(id),
      }, label)
    )
  );
  return nav;
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
          class: 'btn btn-primary btn-lg landing-cta', style: 'width:100%;margin-top:12px',
          onClick: doLanding,
        }, 'Start →'),
      )
    )
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
  await Promise.all([
    loadTodayPlan(),
    loadTodayReview(),
    loadTodaySessions(),
    loadStats(),
  ]);
}

async function loadTodayPlan() {
  S.plan = await API.get(`/api/plans/${S.today}`);
}

async function loadTodayReview() {
  S.review = await API.get(`/api/reviews/${S.today}`);
}

async function loadTodaySessions() {
  S.sessions = await API.get(`/api/sessions?date=${S.today}`);
}

async function loadStats() {
  S.stats = await API.get('/api/stats');
}

async function navigate(view) {
  if (view === 'eod' && S.plan) {
    // Pre-fill EOD with today's priorities
    S.eodData.priority_outcomes = (S.plan.priorities || []).map(p => ({
      text: p.text, completed: '', outcome: '',
    }));
  }
  if (view === 'plan' && S.plan) {
    // Restore existing plan into draft
    S.planDraft.priorities = (S.plan.priorities || []).map(p => ({
      text: p.text || '', area: p.area || '', why: p.why || '',
    }));
    while (S.planDraft.priorities.length < 3) {
      S.planDraft.priorities.push({ text: '', area: '', why: '' });
    }
    S.planDraft.deep_work_target = S.plan.deep_work_target || 4;
  }
  S.eodStep = 0;
  S.planStep = 0;
  S.view = view;
  render();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  const dw_today = S.sessions.reduce((acc, s) => acc + (s.duration_minutes || 0), 0) / 60;
  const dw_target = S.plan?.deep_work_target || 4;
  const dw_pct = Math.min(100, Math.round((dw_today / dw_target) * 100));

  const greeting = getGreeting();

  const wrap = document.createDocumentFragment();

  // Greeting
  wrap.appendChild(h('div', { class: 'dashboard-greeting' },
    h('h1', {}, `${greeting}, ${S.user.name}.`),
    h('p', { class: 'dashboard-date' }, fmtDate(S.today)),
  ));

  // Status cards
  const planStatus = S.plan ? 'Set' : 'Not set';
  const planBadge = S.plan
    ? h('span', { class: 'badge badge-green' }, '✓ Set')
    : h('span', { class: 'badge badge-red' }, '✗ Missing');

  const reviewStatus = S.review
    ? h('span', { class: `badge badge-${gradeColor(S.review.grade_letter)}` }, S.review.grade)
    : h('span', { class: 'badge badge-gray' }, 'Pending');

  const dwColor = dw_pct >= 100 ? 'green' : dw_pct >= 60 ? '' : 'red';

  wrap.appendChild(h('div', { class: 'status-grid' },
    h('div', { class: 'status-card' },
      h('div', { class: 'status-card-label' }, "Today's Plan"),
      planBadge,
      h('div', { class: 'status-card-sub' },
        S.plan ? `${(S.plan.priorities || []).length} priorities` : 'Click Morning Kickoff'
      ),
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
      reviewStatus,
      h('div', { class: 'status-card-sub' },
        S.review ? `Score: ${S.review.execution_score}/100` : 'Not submitted'
      ),
    ),
  ));

  // Priorities
  const priCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, "Today's Priorities"),
  );
  if (!S.plan || !S.plan.priorities || S.plan.priorities.length === 0) {
    priCard.appendChild(h('div', { class: 'empty-state', style: 'padding:24px' },
      h('div', { class: 'empty-title' }, 'No plan yet.'),
      h('p', { class: 'empty-sub' }, "You haven't set your priorities for today."),
      h('button', { class: 'btn btn-primary', onClick: () => navigate('plan') }, 'Start Morning Kickoff →'),
    ));
  } else {
    const completed = S.review ? S.review.priority_outcomes : [];
    const list = h('ul', { class: 'priority-list' },
      ...(S.plan.priorities.map((p, i) => {
        const oc = completed[i];
        const isDone = oc?.completed === 'yes';
        const isPartial = oc?.completed === 'partial';
        return h('li', { class: 'priority-item' },
          h('div', { class: `priority-check ${isDone ? 'done' : isPartial ? 'partial' : ''}` },
            isDone ? '✓' : isPartial ? '~' : '',
          ),
          h('span', { class: 'priority-text' }, p.text),
          h('span', { class: `priority-area ${areaClass(p.area)}` }, p.area || '—'),
        );
      }))
    );
    priCard.appendChild(list);
  }
  wrap.appendChild(priCard);

  // Quick actions
  wrap.appendChild(h('div', { class: 'quick-actions' },
    !S.plan
      ? h('button', { class: 'btn btn-primary', onClick: () => navigate('plan') }, '📋 Set Today\'s Plan')
      : null,
    h('button', { class: 'btn btn-secondary', onClick: () => navigate('deepwork') }, '⚡ Start Deep Work'),
    !S.review
      ? h('button', { class: 'btn btn-secondary', onClick: () => navigate('eod') }, '🔍 EOD Review')
      : h('button', { class: 'btn btn-ghost', onClick: () => navigate('eod') }, '✓ View EOD Report'),
  ));

  // Stats
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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Still at it';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Late night';
}

// ── MORNING PLAN WIZARD ───────────────────────────────────────────────────────

function renderPlanWizard() {
  const wrap = document.createElement('div');
  const steps = ['Priorities', 'Deep Work Target', 'Confirm'];

  // Step dots
  const dots = h('div', { class: 'wizard-steps' },
    ...steps.map((_, i) => h('div', {
      class: `wizard-step-dot ${i < S.planStep ? 'done' : i === S.planStep ? 'active' : ''}`,
    })),
  );

  if (S.planStep === 0) renderPlanStep0(wrap, dots);
  else if (S.planStep === 1) renderPlanStep1(wrap, dots);
  else if (S.planStep === 2) renderPlanStep2(wrap, dots);

  return wrap;
}

function renderPlanStep0(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Set Your 3 Priorities'),
    h('p', { class: 'wizard-subtitle' },
      'What must get done today for Cosmic Q to move forward? Be ruthless. If it doesn\'t matter, cut it.'
    ),
  ));

  S.planDraft.priorities.forEach((p, idx) => {
    const block = h('div', { class: 'priority-block' },
      h('div', { class: 'priority-block-num' }, `Priority ${idx + 1}`),
      h('div', { class: 'form-group' },
        h('label', { class: 'label' }, 'What exactly will you deliver?'),
        h('input', {
          class: 'input', type: 'text', id: `pri-text-${idx}`,
          value: p.text, placeholder: 'e.g. Ship onboarding flow v1 to staging',
          onInput: (e) => { S.planDraft.priorities[idx].text = e.target.value; },
        }),
      ),
      h('div', { class: 'form-group' },
        h('label', { class: 'label' }, 'Area'),
        h('div', { class: 'area-selector' },
          ...['Product', 'Tech', 'People', 'Admin'].map(area =>
            h('button', {
              class: `area-btn ${p.area === area ? `selected-${area.toLowerCase()}` : ''}`,
              onClick: () => {
                S.planDraft.priorities[idx].area = area;
                render();
              },
            }, area)
          ),
        ),
      ),
      h('div', { class: 'form-group', style: 'margin-bottom:0' },
        h('label', { class: 'label' },
          'First Principles: ',
          h('span', { class: 'label-hint' }, 'Why does this matter for Cosmic Q\'s mission?'),
        ),
        h('textarea', {
          class: 'textarea', id: `pri-why-${idx}`,
          placeholder: 'Because without this, [specific impact on building the learning layer]...',
          style: 'min-height:60px',
          onInput: (e) => { S.planDraft.priorities[idx].why = e.target.value; },
        }, p.why),
      ),
    );
    wrap.appendChild(block);
  });

  const adminCount = S.planDraft.priorities.filter(p => p.area === 'Admin').length;
  if (adminCount > 1) {
    wrap.appendChild(h('div', { class: 'alert alert-orange' },
      '⚠ More than one Admin priority. Admin doesn\'t build Cosmic Q. Are you sure these can\'t be delegated or deferred?'
    ));
  }

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => navigate('dashboard') }, '← Cancel'),
    h('button', {
      class: 'btn btn-primary',
      onClick: () => {
        // Validate
        const errors = [];
        S.planDraft.priorities.forEach((p, i) => {
          if (!p.text.trim()) errors.push(`Priority ${i + 1}: Enter what you'll deliver.`);
          if (!p.area) errors.push(`Priority ${i + 1}: Select an area.`);
          if (!p.why.trim() || p.why.trim().length < 20) errors.push(`Priority ${i + 1}: Explain the 'why' (min 20 chars).`);
        });
        if (errors.length > 0) {
          alert(errors.join('\n'));
          return;
        }
        S.planStep = 1; render();
      },
    }, 'Next → Deep Work Target'),
  ));
}

function renderPlanStep1(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Set Your Deep Work Target'),
    h('p', { class: 'wizard-subtitle' },
      'How many hours of uninterrupted, focused work will you commit to today? Not aspirational — realistic commitment.'
    ),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('label', { class: 'label', style: 'margin-bottom:16px' }, 'Deep Work Hours (recommended: 4+)'),
    h('div', { class: 'dw-input-wrapper' },
      h('input', {
        type: 'number', id: 'dw-target',
        value: S.planDraft.deep_work_target,
        min: '1', max: '12', step: '0.5',
        onInput: (e) => { S.planDraft.deep_work_target = parseFloat(e.target.value) || 4; },
      }),
      h('span', { class: 'dw-unit' }, 'hours'),
    ),
    S.planDraft.deep_work_target < 3
      ? h('div', { class: 'pushback-box' },
          `${S.planDraft.deep_work_target}h is not enough to build Cosmic Q. You need at least 3-4 hours of deep work every single day to make meaningful progress. Reconsider.`
        )
      : S.planDraft.deep_work_target >= 4
        ? h('div', { class: 'alert alert-green', style: 'margin-top:12px' },
            `✓ ${S.planDraft.deep_work_target}h commitment. This is what building requires.`
          )
        : h('div', { class: 'alert alert-orange', style: 'margin-top:12px' },
            `${S.planDraft.deep_work_target}h. Acceptable, push for 4.`
          ),
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
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Review & Lock In'),
    h('p', { class: 'wizard-subtitle' }, 'This is your contract with yourself for today.'),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Today\'s Priorities'),
    h('ul', { class: 'priority-list', style: 'margin-bottom:16px' },
      ...S.planDraft.priorities.map(p =>
        h('li', { class: 'priority-item' },
          h('div', { class: 'priority-check' }),
          h('div', { style: 'flex:1' },
            h('div', { class: 'priority-text fw-600' }, p.text),
            h('div', { class: 'text-muted mt-4' }, p.why),
          ),
          h('span', { class: `priority-area ${areaClass(p.area)}` }, p.area),
        )
      ),
    ),
    h('div', { class: 'flex-between', style: 'padding-top:12px;border-top:1px solid var(--border)' },
      h('span', { class: 'text-muted' }, 'Deep Work Target'),
      h('span', { class: 'fw-700' }, `${S.planDraft.deep_work_target} hours`),
    ),
  ));

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.planStep = 1; render(); } }, '← Back'),
    h('button', {
      class: 'btn btn-primary btn-lg', id: 'lock-btn',
      onClick: savePlan,
    }, 'Lock In →'),
  ));
}

async function savePlan() {
  const btn = el('lock-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    S.plan = await API.post('/api/plans', {
      date: S.today,
      priorities: S.planDraft.priorities,
      deep_work_target: S.planDraft.deep_work_target,
    });
    await loadStats();
    S.view = 'dashboard';
    S.planStep = 0;
    render();
  } catch (e) {
    alert('Failed to save: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Lock In →'; }
  }
}

// ── DEEP WORK TIMER ───────────────────────────────────────────────────────────

function renderDeepWork() {
  // Restore active session from localStorage
  if (!S.activeSession) {
    const stored = localStorage.getItem('cq_active_session');
    if (stored) S.activeSession = JSON.parse(stored);
  }

  const today_dw = S.sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const target = S.plan?.deep_work_target || 4;

  const wrap = document.createElement('div');

  wrap.appendChild(h('div', { class: 'flex-between mb-16' },
    h('h2', {}, 'Deep Work'),
    h('div', { class: 'badge badge-' + (today_dw / 60 >= target ? 'green' : 'gray') },
      `${(today_dw / 60).toFixed(1)}h / ${target}h today`
    ),
  ));

  // Focus area selector
  if (!S.activeSession) {
    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Select Focus Area'),
      h('div', { class: 'focus-area-grid' },
        ...['Product', 'Tech', 'People', 'Admin'].map(area => {
          const key = area.toLowerCase();
          return h('button', {
            id: `area-${key}`,
            class: `focus-area-btn ${S._selectedArea === area ? `active-${key}` : ''}`,
            onClick: () => {
              S._selectedArea = area;
              document.querySelectorAll('.focus-area-btn').forEach(b => {
                const bArea = b.id.replace('area-', '');
                b.className = `focus-area-btn${b.id === `area-${key}` ? ` active-${key}` : ''}`;
              });
            },
          }, area);
        }),
      ),
    ));

    wrap.appendChild(h('div', { class: 'timer-display' },
      h('div', { class: 'timer-digits', id: 'timer-display' }, '00:00:00'),
      h('p', { class: 'timer-status' }, 'Select an area and start your session'),
    ));

    wrap.appendChild(h('div', { class: 'timer-controls' },
      h('button', {
        class: 'btn btn-primary btn-lg', id: 'start-btn',
        onClick: startSession,
      }, '▶ Start Session'),
    ));

  } else {
    // Active session
    const area = S.activeSession.focus_area;
    const aKey = area.toLowerCase();

    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Active Session'),
      h('div', { class: 'flex-between' },
        h('span', { class: `badge badge-${aKey === 'product' ? 'blue' : aKey === 'tech' ? 'green' : aKey === 'people' ? 'gray' : 'orange'}` }, area),
        h('span', { class: 'text-muted' }, `Started at ${new Date(S.activeSession.start_ms).toLocaleTimeString()}`),
      ),
    ));

    wrap.appendChild(h('div', { class: 'timer-display' },
      h('div', { class: 'timer-digits', id: 'timer-display' }, fmtTime(Date.now() - S.activeSession.start_ms)),
      h('p', { class: 'timer-status' }, `Focusing on ${area} — stay locked in.`),
    ));

    wrap.appendChild(h('div', { class: 'form-group mt-16' },
      h('label', { class: 'label' }, 'Session Outcome (fill before ending)'),
      h('textarea', {
        class: 'textarea', id: 'session-outcome',
        placeholder: 'What specifically will you have produced when this session ends?',
        style: 'min-height:70px',
      }),
    ));

    wrap.appendChild(h('div', { class: 'timer-controls' },
      h('button', {
        class: 'btn btn-red btn-lg', onClick: endSession,
      }, '■ End Session'),
    ));

    // Start ticker
    if (S.timerInterval) clearInterval(S.timerInterval);
    S.timerInterval = setInterval(() => {
      const d = el('timer-display');
      if (d) d.textContent = fmtTime(Date.now() - S.activeSession.start_ms);
      else clearInterval(S.timerInterval);
    }, 1000);
  }

  // Sessions log
  if (S.sessions.length > 0) {
    wrap.appendChild(h('div', { class: 'card mt-20' },
      h('div', { class: 'card-title' }, 'Today\'s Sessions'),
      h('ul', { class: 'sessions-list' },
        ...S.sessions.filter(s => s.end_time).map(s =>
          h('li', { class: 'session-item' },
            h('span', { class: 'session-area' }, s.focus_area),
            h('span', { class: 'session-time' },
              `${new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            ),
            h('span', { class: 'session-dur' }, fmtDuration(s.duration_minutes)),
          )
        ),
      ),
    ));
  }

  return wrap;
}

async function startSession() {
  const area = S._selectedArea;
  if (!area) { alert('Select a focus area first.'); return; }
  const btn = el('start-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

  const now = new Date().toISOString();
  try {
    const session = await API.post('/api/sessions', {
      date: S.today, focus_area: area, start_time: now,
    });
    S.activeSession = { id: session.id, start_ms: Date.now(), focus_area: area };
    localStorage.setItem('cq_active_session', JSON.stringify(S.activeSession));
    render();
  } catch (e) {
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start Session'; }
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
    S._selectedArea = null;
    await loadTodaySessions();
    await loadStats();
    render();
  } catch (e) {
    alert('Error ending session: ' + e.message);
  }
}

// ── EOD REVIEW ────────────────────────────────────────────────────────────────

function renderEOD() {
  // If review already submitted, show results
  if (S.review) {
    return renderVerdict(S.review);
  }

  const steps = ['Deep Work', 'Outcomes', 'Blocker', 'Tomorrow', 'Verdict'];

  const wrap = document.createElement('div');

  const dots = h('div', { class: 'wizard-steps' },
    ...steps.map((_, i) => h('div', {
      class: `wizard-step-dot ${i < S.eodStep ? 'done' : i === S.eodStep ? 'active' : ''}`,
    })),
  );

  if (S.eodStep === 0) renderEODStep0(wrap, dots);
  else if (S.eodStep === 1) renderEODStep1(wrap, dots);
  else if (S.eodStep === 2) renderEODStep2(wrap, dots);
  else if (S.eodStep === 3) renderEODStep3(wrap, dots);
  else if (S.eodStep === 4) renderEODVerdictStep(wrap);

  return wrap;
}

function renderEODStep0(wrap, dots) {
  const actual_dw = S.sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0) / 60;
  const target = S.plan?.deep_work_target || 4;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'End of Day Review'),
    h('p', { class: 'wizard-subtitle' },
      `It's ${time}. Time to account for your day. No vague answers. No excuses.`
    ),
  ));

  if (!S.plan) {
    wrap.appendChild(h('div', { class: 'alert alert-orange' },
      'No plan set for today. You can still log your deep work and outcomes.'
    ));
  }

  wrap.appendChild(h('div', { class: 'card' },
    h('label', { class: 'label' },
      'How many hours of UNINTERRUPTED deep work did you do today?',
      h('span', { class: 'label-hint' }, ' (Timer logged: ' + actual_dw.toFixed(1) + 'h)'),
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
        if (isNaN(hrs) || hrs < 0 || hrs > 16) {
          alert('Enter a valid number of hours (0–16).');
          return;
        }
        S.eodData.deep_work_hours = hrs;

        // Init priority outcomes from plan
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

  // Live pushback on DW hours
  const inp = wrap.querySelector('#eod-dw');
  if (inp) {
    inp.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      const pb = wrap.querySelector('#dw-pushback');
      if (!pb) return;
      if (isNaN(v)) { pb.innerHTML = ''; return; }
      if (v < 1) {
        pb.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'pushback-box';
        div.textContent = `${v}h of deep work. That's not building Cosmic Q — that's surviving. What specifically robbed your focus today?`;
        pb.appendChild(div);
      } else if (v < 3) {
        pb.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'pushback-box';
        div.textContent = `${v}h. You're operating below the minimum viable focus level for a founder. Tomorrow: first 4 hours are non-negotiable deep work.`;
        pb.appendChild(div);
      } else {
        pb.innerHTML = '';
      }
    });
  }
}

function renderEODStep1(wrap, dots) {
  const priorities = S.eodData.priority_outcomes;

  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Priority Outcomes'),
    h('p', { class: 'wizard-subtitle' },
      'For each priority, state the SPECIFIC outcome. What exists now that didn\'t exist this morning? Activities are not outcomes.'
    ),
  ));

  priorities.forEach((p, idx) => {
    const errId = `err-${idx}`;
    const block = h('div', { class: 'priority-block' },
      h('div', { class: 'priority-block-num' },
        S.plan ? `Priority ${idx + 1} · ${S.plan.priorities[idx]?.area || ''}` : `Priority ${idx + 1}`,
      ),
      h('div', { class: 'fw-600', style: 'margin-bottom:10px;font-size:13px' }, p.text),

      h('div', { class: 'form-group' },
        h('label', { class: 'label' }, 'Completion Status'),
        h('div', { class: 'outcome-status-group' },
          ...['yes', 'partial', 'no'].map(status =>
            h('button', {
              class: `outcome-status-btn ${p.completed === status ? `sel-${status}` : ''}`,
              onClick: () => {
                S.eodData.priority_outcomes[idx].completed = status;
                render();
              },
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
          placeholder: 'e.g. "Shipped onboarding flow v1 to staging. 3 edge cases fixed. Design reviewed with Priya."',
          onInput: (e) => {
            S.eodData.priority_outcomes[idx].outcome = e.target.value;
            el(errId) && (el(errId).innerHTML = '');
          },
        }, p.outcome),
        h('div', { id: errId }),
      ),
    );
    wrap.appendChild(block);
  });

  wrap.appendChild(h('div', { class: 'wizard-nav' },
    h('button', { class: 'btn btn-ghost', onClick: () => { S.eodStep = 0; render(); } }, '← Back'),
    h('button', {
      class: 'btn btn-primary', onClick: () => {
        let hasErrors = false;
        S.eodData.priority_outcomes.forEach((p, idx) => {
          const errEl = el(`err-${idx}`);
          const errors = [];

          if (!p.completed) {
            errors.push('Select a completion status.');
            hasErrors = true;
          }
          const outcomeErrors = validateOutcome(p.outcome);
          if (outcomeErrors.length > 0) {
            errors.push(...outcomeErrors);
            hasErrors = true;
          }

          if (errEl) {
            if (errors.length > 0) {
              errEl.innerHTML = '';
              errors.forEach(e => {
                const div = document.createElement('div');
                div.className = 'eod-validation-error';
                div.textContent = '❌ ' + e;
                errEl.appendChild(div);
              });
              // Update textarea with current value
              const ta = el(`outcome-${idx}`);
              if (ta) {
                S.eodData.priority_outcomes[idx].outcome = ta.value;
                ta.classList.add('error');
              }
            } else {
              const ta = el(`outcome-${idx}`);
              if (ta) ta.classList.remove('error');
            }
          }
        });

        if (!hasErrors) { S.eodStep = 2; render(); }
        else {
          // Scroll to first error
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
    h('p', { class: 'wizard-subtitle' },
      'What ONE thing blocked you the most today? Be specific. "Distractions" is not an answer.'
    ),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('textarea', {
      class: 'textarea', id: 'blocker-input', style: 'min-height:100px',
      placeholder: 'e.g. "Spent 2 hours in unplanned investor call. No agenda, no outcome. Need to gate-keep calendar better."',
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
        if (v.trim().length < 20) errs.push('Be specific. What exactly blocked you? Min 20 characters.');
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
        } else {
          S.eodStep = 3; render();
        }
      },
    }, 'Next →'),
  ));
}

function renderEODStep3(wrap, dots) {
  wrap.appendChild(h('div', { class: 'wizard-header' },
    dots,
    h('h2', { class: 'wizard-title' }, 'Tomorrow\'s Focus'),
    h('p', { class: 'wizard-subtitle' },
      'What is the SINGLE most critical thing you must do tomorrow? Not a list. ONE thing that moves the needle most.'
    ),
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
    h('button', {
      class: 'btn btn-primary btn-lg', id: 'submit-eod-btn',
      onClick: submitEOD,
    }, 'Submit & Get Verdict →'),
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
      d.textContent = '❌ Be specific. What exactly is the ONE thing? Min 10 characters.';
      errEl.appendChild(d);
    }
    return;
  }

  const btn = el('submit-eod-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Calculating…'; }

  try {
    S.review = await API.post('/api/reviews', {
      date: S.today,
      deep_work_hours: S.eodData.deep_work_hours,
      priority_outcomes: S.eodData.priority_outcomes,
      main_blocker: S.eodData.main_blocker,
      tomorrow_focus: S.eodData.tomorrow_focus,
    });
    await loadStats();
    S.eodStep = 4; render();
  } catch (e) {
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit & Get Verdict →'; }
  }
}

function renderEODVerdictStep(wrap) {
  wrap.appendChild(renderVerdict(S.review));
}

function renderVerdict(review) {
  const wrap = document.createElement('div');
  const letter = review.grade_letter || review.grade?.[0] || '?';
  const feedback = typeof review.feedback === 'string'
    ? JSON.parse(review.feedback) : (review.feedback || []);
  const breakdown = typeof review.score_breakdown === 'string'
    ? JSON.parse(review.score_breakdown) : (review.score_breakdown || {});

  wrap.appendChild(h('div', { class: 'flex-between mb-16' },
    h('h2', {}, 'EOD Verdict'),
    h('span', { class: 'text-muted' }, fmtDate(review.date)),
  ));

  // Grade circle
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
          `Priorities (${breakdown.priorities?.completed || 0}+${breakdown.priorities?.partial || 0}/${breakdown.priorities?.total || 3})`
        ),
      ),
      h('div', { class: 'breakdown-item' },
        h('div', { class: 'breakdown-val' }, `${breakdown.quality?.score || 0}/${breakdown.quality?.max || 25}`),
        h('div', { class: 'breakdown-lbl' }, `Quality (${breakdown.quality?.label || '—'})`),
      ),
    ),
  ));

  // Feedback
  wrap.appendChild(h('div', { class: 'card mt-16' },
    h('div', { class: 'card-title' }, 'Verdict'),
    h('ul', { class: 'feedback-list' },
      ...feedback.map(f => h('li', { class: 'feedback-item' }, f)),
    ),
  ));

  // Blocker
  wrap.appendChild(h('div', { class: 'card mt-16' },
    h('div', { class: 'card-title' }, 'Main Blocker Today'),
    h('p', { style: 'font-size:13px;color:var(--text-2)' }, review.main_blocker),
  ));

  // Tomorrow
  wrap.appendChild(h('div', { class: 'tomorrow-box' },
    h('div', { class: 'tomorrow-label' }, 'Tomorrow\'s #1 Priority'),
    h('div', { class: 'tomorrow-text' }, review.tomorrow_focus),
  ));

  // Action
  wrap.appendChild(h('div', { class: 'mt-20', style: 'display:flex;gap:10px' },
    h('button', {
      class: 'btn btn-primary',
      onClick: () => navigate('plan'),
    }, '📋 Plan Tomorrow'),
    h('button', {
      class: 'btn btn-ghost',
      onClick: () => navigate('warroom'),
    }, '📊 War Room'),
  ));

  return wrap;
}

// ── WAR ROOM ──────────────────────────────────────────────────────────────────

async function renderWarRoom() {
  const wrap = document.createElement('div');

  wrap.appendChild(h('h2', { class: 'mb-16' }, 'War Room'));

  if (!S.stats) {
    wrap.appendChild(h('p', { class: 'text-muted' }, 'Loading…'));
    loadStats().then(render);
    return wrap;
  }

  const reviews = (S.stats.recent_reviews || []).slice().reverse();

  // Metrics
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

  if (reviews.length > 0) {
    // Deep work chart
    wrap.appendChild(h('div', { class: 'card mb-16' },
      h('div', { class: 'card-title' }, 'Deep Work Hours (last 14 days)'),
      renderChart(reviews, 'dw'),
    ));

    // Score chart
    wrap.appendChild(h('div', { class: 'card mb-16' },
      h('div', { class: 'card-title' }, 'Execution Score (last 14 days)'),
      renderChart(reviews, 'score'),
    ));

    // History table
    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Review History'),
      h('table', { class: 'history-table' },
        h('thead', {},
          h('tr', {},
            h('th', {}, 'Date'),
            h('th', {}, 'Grade'),
            h('th', {}, 'Score'),
            h('th', {}, 'Deep Work'),
          ),
        ),
        h('tbody', {},
          ...[...(S.stats.recent_reviews || [])].map(r => {
            const gc = gradeColor(r.grade_letter);
            return h('tr', {
              style: 'cursor:pointer',
              onClick: async () => {
                const full = await API.get(`/api/reviews/${r.date}`);
                showHistoryReview(full);
              },
            },
              h('td', {}, fmtDate(r.date)),
              h('td', {},
                h('span', {
                  class: `grade-chip grade-${r.grade_letter}`,
                  style: `background:var(--${gc}-bg);color:var(--${gc});border:1px solid var(--${gc}-border)`,
                }, r.grade_letter),
              ),
              h('td', {}, r.execution_score + '/100'),
              h('td', {}, `${r.deep_work_hours}h`),
            );
          }),
        ),
      ),
    ));
  } else {
    wrap.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, '📊'),
      h('div', { class: 'empty-title' }, 'No reviews yet.'),
      h('p', { class: 'empty-sub' }, 'Complete your first EOD review to start tracking performance.'),
      h('button', { class: 'btn btn-primary', onClick: () => navigate('eod') }, 'Start EOD Review'),
    ));
  }

  return wrap;
}

function renderChart(reviews, type) {
  const maxVal = type === 'dw'
    ? Math.max(8, ...reviews.map(r => r.deep_work_hours || 0))
    : 100;

  return h('div', { class: 'chart-container' },
    h('div', { class: 'chart-bars' },
      ...reviews.slice(-14).map(r => {
        const val = type === 'dw' ? (r.deep_work_hours || 0) : (r.execution_score || 0);
        const pct = Math.max(3, Math.round((val / maxVal) * 100));
        const grade = r.grade_letter || 'F';
        const barClass = grade === 'S' || grade === 'A' ? 'good'
          : grade === 'B' ? 'filled'
          : grade === 'C' ? 'warn' : 'bad';
        const dateStr = r.date ? r.date.slice(5) : '';
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

function showHistoryReview(review) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.5);z-index:1000;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background:#fff;border-radius:12px;max-width:600px;width:100%;
    max-height:80vh;overflow-y:auto;padding:24px;
  `;

  box.appendChild(renderVerdict(review));

  const closeBtn = h('button', {
    class: 'btn btn-ghost btn-sm', style: 'margin-top:16px',
    onClick: () => modal.remove(),
  }, '✕ Close');
  box.appendChild(closeBtn);

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.appendChild(box);
  document.body.appendChild(modal);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    S.user = await API.get('/api/user');
    if (S.user) {
      await loadAll();
    }
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
    renderWarRoom().then(el => main.appendChild(el));
  } else {
    const views = {
      dashboard: renderDashboard,
      plan:      renderPlanWizard,
      deepwork:  renderDeepWork,
      eod:       renderEOD,
    };
    const viewFn = views[S.view] || renderDashboard;
    const result = viewFn();
    if (result) main.appendChild(result);
  }
}

window.addEventListener('DOMContentLoaded', init);
