from flask import Flask, jsonify, request, send_from_directory
import sqlite3
import json
import os
from datetime import date, timedelta

app = Flask(__name__, static_folder='static', template_folder='templates')
DB_PATH = os.path.join(os.path.dirname(__file__), 'cosmicq.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS daily_plans (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            priorities TEXT NOT NULL,
            deep_work_target REAL DEFAULT 4.0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS eod_reviews (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            deep_work_hours REAL NOT NULL,
            priority_outcomes TEXT NOT NULL,
            main_blocker TEXT NOT NULL,
            tomorrow_focus TEXT NOT NULL,
            execution_score INTEGER NOT NULL,
            score_breakdown TEXT NOT NULL,
            feedback TEXT NOT NULL,
            grade TEXT NOT NULL,
            grade_letter TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS deep_work_sessions (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            focus_area TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes INTEGER,
            outcome TEXT DEFAULT ''
        );
    ''')
    conn.commit()
    conn.close()


# ── USER ─────────────────────────────────────────────────────────────────────

@app.route('/api/user', methods=['GET'])
def get_user():
    conn = get_db()
    user = conn.execute('SELECT * FROM user ORDER BY id DESC LIMIT 1').fetchone()
    conn.close()
    return jsonify(dict(user) if user else None)


@app.route('/api/user', methods=['POST'])
def save_user():
    data = request.json
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    conn = get_db()
    conn.execute('DELETE FROM user')
    conn.execute('INSERT INTO user (name) VALUES (?)', (name,))
    conn.commit()
    user = conn.execute('SELECT * FROM user ORDER BY id DESC LIMIT 1').fetchone()
    conn.close()
    return jsonify(dict(user))


# ── DAILY PLANS ───────────────────────────────────────────────────────────────

@app.route('/api/plans/<date_str>', methods=['GET'])
def get_plan(date_str):
    conn = get_db()
    plan = conn.execute('SELECT * FROM daily_plans WHERE date = ?', (date_str,)).fetchone()
    conn.close()
    if not plan:
        return jsonify(None)
    p = dict(plan)
    p['priorities'] = json.loads(p['priorities'])
    return jsonify(p)


@app.route('/api/plans', methods=['POST'])
def save_plan():
    data = request.json
    date_str = data.get('date', str(date.today()))
    priorities = json.dumps(data.get('priorities', []))
    target = float(data.get('deep_work_target', 4.0))
    conn = get_db()
    conn.execute('''
        INSERT INTO daily_plans (date, priorities, deep_work_target, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(date) DO UPDATE SET
            priorities = excluded.priorities,
            deep_work_target = excluded.deep_work_target,
            updated_at = CURRENT_TIMESTAMP
    ''', (date_str, priorities, target))
    conn.commit()
    plan = conn.execute('SELECT * FROM daily_plans WHERE date = ?', (date_str,)).fetchone()
    conn.close()
    p = dict(plan)
    p['priorities'] = json.loads(p['priorities'])
    return jsonify(p)


# ── EOD REVIEWS ───────────────────────────────────────────────────────────────

@app.route('/api/reviews/<date_str>', methods=['GET'])
def get_review(date_str):
    conn = get_db()
    review = conn.execute('SELECT * FROM eod_reviews WHERE date = ?', (date_str,)).fetchone()
    conn.close()
    if not review:
        return jsonify(None)
    r = dict(review)
    r['priority_outcomes'] = json.loads(r['priority_outcomes'])
    r['score_breakdown'] = json.loads(r['score_breakdown'])
    r['feedback'] = json.loads(r['feedback'])
    return jsonify(r)


@app.route('/api/reviews/history', methods=['GET'])
def get_review_history():
    conn = get_db()
    reviews = conn.execute('''
        SELECT date, execution_score, deep_work_hours, grade, grade_letter
        FROM eod_reviews ORDER BY date DESC LIMIT 30
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in reviews])


@app.route('/api/reviews', methods=['POST'])
def save_review():
    data = request.json
    date_str = data.get('date', str(date.today()))
    deep_work_hours = float(data.get('deep_work_hours', 0))
    priority_outcomes = data.get('priority_outcomes', [])
    main_blocker = data.get('main_blocker', '')
    tomorrow_focus = data.get('tomorrow_focus', '')

    result = _calculate_score(deep_work_hours, priority_outcomes)

    conn = get_db()
    conn.execute('''
        INSERT INTO eod_reviews
            (date, deep_work_hours, priority_outcomes, main_blocker, tomorrow_focus,
             execution_score, score_breakdown, feedback, grade, grade_letter)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            deep_work_hours = excluded.deep_work_hours,
            priority_outcomes = excluded.priority_outcomes,
            main_blocker = excluded.main_blocker,
            tomorrow_focus = excluded.tomorrow_focus,
            execution_score = excluded.execution_score,
            score_breakdown = excluded.score_breakdown,
            feedback = excluded.feedback,
            grade = excluded.grade,
            grade_letter = excluded.grade_letter
    ''', (
        date_str, deep_work_hours,
        json.dumps(priority_outcomes),
        main_blocker, tomorrow_focus,
        result['score'],
        json.dumps(result['breakdown']),
        json.dumps(result['feedback']),
        result['grade'],
        result['grade_letter']
    ))
    conn.commit()
    conn.close()
    return jsonify({**data, **result})


def _calculate_score(deep_work_hours, priority_outcomes):
    score = 0
    breakdown = {}
    feedback = []

    # ── Deep Work (35 pts) ────────────────────────────────────────────────────
    if deep_work_hours >= 5:
        dw = 35; dw_lbl = 'Elite'
        feedback.append(f"Deep Work · {deep_work_hours}h — Elite level. This is what building Cosmic Q requires.")
    elif deep_work_hours >= 4:
        dw = 28; dw_lbl = 'Strong'
        feedback.append(f"Deep Work · {deep_work_hours}h — Strong. Push for 5+ tomorrow.")
    elif deep_work_hours >= 3:
        dw = 20; dw_lbl = 'Below Target'
        feedback.append(f"Deep Work · {deep_work_hours}h — Below target. 3 hours won't build a company. What fragmented your time?")
    elif deep_work_hours >= 2:
        dw = 12; dw_lbl = 'Weak'
        feedback.append(f"Deep Work · {deep_work_hours}h — Weak. You're in reactive mode. Block the first 4 hours tomorrow. No exceptions.")
    elif deep_work_hours >= 1:
        dw = 5; dw_lbl = 'Critical'
        feedback.append(f"Deep Work · {deep_work_hours}h — Critical failure. You cannot build a learning layer for humanity with 1 hour of focus. Fix this first.")
    else:
        dw = 0; dw_lbl = 'Zero'
        feedback.append("Deep Work · 0h — Unacceptable. Zero deep work. Tomorrow this does not happen. Period.")
    score += dw
    breakdown['deep_work'] = {'score': dw, 'max': 35, 'label': dw_lbl}

    # ── Priority Completion (40 pts) ──────────────────────────────────────────
    total = len(priority_outcomes) or 1
    completed = sum(1 for p in priority_outcomes if p.get('completed') == 'yes')
    partial = sum(1 for p in priority_outcomes if p.get('completed') == 'partial')
    pri_score = int(((completed + partial * 0.5) / total) * 40)
    score += pri_score
    rate = (completed + partial * 0.5) / total
    if rate >= 1.0:
        feedback.append(f"Priorities · {completed}/{total} completed — Perfect delivery.")
    elif rate >= 0.67:
        feedback.append(f"Priorities · {completed}/{total} done ({partial} partial) — Close. What specifically blocked the last priority?")
    elif rate >= 0.34:
        feedback.append(f"Priorities · {completed}/{total} done — You either over-planned or under-executed. Be honest: which one?")
    else:
        feedback.append(f"Priorities · {completed}/{total} done — Execution failure. Cut tomorrow's list to 2 and deliver them fully.")
    breakdown['priorities'] = {'score': pri_score, 'max': 40, 'completed': completed, 'partial': partial, 'total': total}

    # ── Outcome Quality (25 pts) ──────────────────────────────────────────────
    vague_words = ['tried', 'worked on', 'attempted', 'looked at', 'thought about',
                   'explored', 'discussed', 'went through', 'reviewing', 'going through',
                   'was working', 'have been', 'kind of', 'sort of', 'basically', 'stuff']
    all_text = ' '.join(p.get('outcome', '') for p in priority_outcomes).lower()
    vague_hits = [w for w in vague_words if w in all_text]
    char_count = len(all_text)

    if not vague_hits and char_count > 200:
        q = 25; q_lbl = 'Specific'
        feedback.append("Outcome quality — Specific and substantial. You know what you shipped.")
    elif len(vague_hits) <= 1 and char_count > 100:
        q = 18; q_lbl = 'Mostly Specific'
        feedback.append(f"Outcome quality — Mostly specific. Watch '{vague_hits[0] if vague_hits else ''}' — activities are not outcomes.")
    elif len(vague_hits) <= 3:
        q = 8; q_lbl = 'Vague'
        feedback.append(f"Outcome quality — Vague: '{', '.join(vague_hits[:3])}'. What was the EXACT output? A decision, a shipped thing, a rejected hypothesis — be precise.")
    else:
        q = 0; q_lbl = 'Activity Log'
        feedback.append("Outcome quality — This is an activity log, not an outcome list. Every entry is vague. What EXISTS now that didn't exist this morning?")
    score += q
    breakdown['quality'] = {'score': q, 'max': 25, 'label': q_lbl, 'vague_hits': vague_hits}

    # ── Grade ─────────────────────────────────────────────────────────────────
    if score >= 90:
        letter, grade = 'S', 'S — Elite Execution'
    elif score >= 80:
        letter, grade = 'A', 'A — Strong Execution'
    elif score >= 70:
        letter, grade = 'B', 'B — Decent Execution'
    elif score >= 60:
        letter, grade = 'C', 'C — Below Standard'
    elif score >= 40:
        letter, grade = 'D', 'D — Weak Execution'
    else:
        letter, grade = 'F', 'F — Unacceptable'

    return {'score': score, 'breakdown': breakdown, 'feedback': feedback, 'grade': grade, 'grade_letter': letter}


# ── DEEP WORK SESSIONS ────────────────────────────────────────────────────────

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    date_str = request.args.get('date', str(date.today()))
    conn = get_db()
    sessions = conn.execute(
        'SELECT * FROM deep_work_sessions WHERE date = ? ORDER BY start_time',
        (date_str,)
    ).fetchall()
    conn.close()
    return jsonify([dict(s) for s in sessions])


@app.route('/api/sessions', methods=['POST'])
def create_session():
    data = request.json
    conn = get_db()
    conn.execute(
        'INSERT INTO deep_work_sessions (date, focus_area, start_time) VALUES (?, ?, ?)',
        (data['date'], data['focus_area'], data['start_time'])
    )
    conn.commit()
    s = conn.execute('SELECT * FROM deep_work_sessions ORDER BY id DESC LIMIT 1').fetchone()
    conn.close()
    return jsonify(dict(s))


@app.route('/api/sessions/<int:sid>', methods=['PATCH'])
def end_session(sid):
    data = request.json
    conn = get_db()
    conn.execute(
        'UPDATE deep_work_sessions SET end_time=?, duration_minutes=?, outcome=? WHERE id=?',
        (data['end_time'], data['duration_minutes'], data.get('outcome', ''), sid)
    )
    conn.commit()
    s = conn.execute('SELECT * FROM deep_work_sessions WHERE id=?', (sid,)).fetchone()
    conn.close()
    return jsonify(dict(s))


# ── STATS ─────────────────────────────────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db()

    recent = conn.execute('''
        SELECT date, execution_score, deep_work_hours, grade_letter
        FROM eod_reviews ORDER BY date DESC LIMIT 14
    ''').fetchall()

    all_dates = [r['date'] for r in conn.execute(
        'SELECT date FROM eod_reviews ORDER BY date DESC'
    ).fetchall()]

    streak = 0
    check = date.today()
    date_set = set(all_dates)
    while str(check) in date_set:
        streak += 1
        check -= timedelta(days=1)

    avg_row = conn.execute('''
        SELECT AVG(deep_work_hours) as avg_dw, AVG(execution_score) as avg_score
        FROM eod_reviews WHERE date >= date('now', '-7 days')
    ''').fetchone()

    total_sessions = conn.execute('SELECT COUNT(*) as c FROM deep_work_sessions').fetchone()
    total_dw = conn.execute(
        'SELECT SUM(duration_minutes) as s FROM deep_work_sessions WHERE end_time IS NOT NULL'
    ).fetchone()

    conn.close()
    return jsonify({
        'recent_reviews': [dict(r) for r in recent],
        'streak': streak,
        'avg_deep_work_7d': round(avg_row['avg_dw'] or 0, 1),
        'avg_score_7d': round(avg_row['avg_score'] or 0, 1),
        'total_sessions': total_sessions['c'],
        'total_dw_hours': round((total_dw['s'] or 0) / 60, 1),
    })


# ── SERVE FRONTEND ────────────────────────────────────────────────────────────

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.template_folder, 'index.html')


if __name__ == '__main__':
    init_db()
    print("Cosmic Q Ops running → http://localhost:5050")
    app.run(debug=True, port=5050, use_reloader=False)
