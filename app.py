from flask import Flask, jsonify, request, send_from_directory
import os
from datetime import date, timedelta, datetime
from pymongo import MongoClient
from bson import ObjectId
import certifi

_ROOT = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    static_folder=os.path.join(_ROOT, 'static'),
    template_folder=os.path.join(_ROOT, 'templates'),
)

# ── MongoDB connection ────────────────────────────────────────────────────────
MONGO_URI = os.environ.get(
    'MONGODB_URI',
    'mongodb+srv://khetesh:cRrQuK1rg8jtlXmE@cluster0.mjow3ex.mongodb.net/?appName=Cluster0'
)
_client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
_db     = _client['cosmicq']

users_col    = _db['users']
plans_col    = _db['plans']
reviews_col  = _db['reviews']
sessions_col = _db['sessions']


def to_dict(doc):
    """Convert a MongoDB document to a JSON-serialisable dict."""
    if doc is None:
        return None
    d = dict(doc)
    d['id'] = str(d.pop('_id'))
    return d


_indexes_created = False

def init_db():
    """Create indexes lazily on the first real request (not at import time)."""
    global _indexes_created
    if _indexes_created:
        return
    plans_col.create_index('date', unique=True)
    reviews_col.create_index('date', unique=True)
    sessions_col.create_index('date')
    _indexes_created = True


@app.before_request
def ensure_indexes():
    init_db()


# ── USER ─────────────────────────────────────────────────────────────────────

@app.route('/api/user', methods=['GET'])
def get_user():
    user = users_col.find_one({}, sort=[('_id', -1)])
    return jsonify(to_dict(user))


@app.route('/api/user', methods=['POST'])
def save_user():
    data = request.json
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    users_col.delete_many({})
    result = users_col.insert_one({'name': name, 'created_at': datetime.utcnow().isoformat()})
    user = users_col.find_one({'_id': result.inserted_id})
    return jsonify(to_dict(user))


# ── DAILY PLANS ───────────────────────────────────────────────────────────────

@app.route('/api/plans/<date_str>', methods=['GET'])
def get_plan(date_str):
    plan = plans_col.find_one({'date': date_str})
    return jsonify(to_dict(plan))


@app.route('/api/plans', methods=['POST'])
def save_plan():
    data = request.json
    date_str = data.get('date', str(date.today()))
    priorities = data.get('priorities', [])
    target = float(data.get('deep_work_target', 4.0))
    now = datetime.utcnow().isoformat()
    plans_col.update_one(
        {'date': date_str},
        {'$set':         {'priorities': priorities, 'deep_work_target': target, 'updated_at': now},
         '$setOnInsert': {'created_at': now}},
        upsert=True
    )
    plan = plans_col.find_one({'date': date_str})
    return jsonify(to_dict(plan))


# ── EOD REVIEWS ───────────────────────────────────────────────────────────────

@app.route('/api/reviews/<date_str>', methods=['GET'])
def get_review(date_str):
    review = reviews_col.find_one({'date': date_str})
    return jsonify(to_dict(review))


@app.route('/api/reviews/history', methods=['GET'])
def get_review_history():
    reviews = list(reviews_col.find(
        {},
        {'date': 1, 'execution_score': 1, 'deep_work_hours': 1, 'grade': 1, 'grade_letter': 1},
        sort=[('date', -1)],
    ).limit(30))
    return jsonify([to_dict(r) for r in reviews])


@app.route('/api/reviews', methods=['POST'])
def save_review():
    data = request.json
    date_str = data.get('date', str(date.today()))
    deep_work_hours = float(data.get('deep_work_hours', 0))
    priority_outcomes = data.get('priority_outcomes', [])
    main_blocker = data.get('main_blocker', '')
    tomorrow_focus = data.get('tomorrow_focus', '')

    result = _calculate_score(deep_work_hours, priority_outcomes)

    now = datetime.utcnow().isoformat()
    reviews_col.update_one(
        {'date': date_str},
        {'$set': {
            'deep_work_hours':  deep_work_hours,
            'priority_outcomes': priority_outcomes,
            'main_blocker':     main_blocker,
            'tomorrow_focus':   tomorrow_focus,
            'execution_score':  result['score'],
            'score_breakdown':  result['breakdown'],
            'feedback':         result['feedback'],
            'grade':            result['grade'],
            'grade_letter':     result['grade_letter'],
            'updated_at':       now,
        },
         '$setOnInsert': {'created_at': now}},
        upsert=True
    )
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
    sessions = list(sessions_col.find({'date': date_str}, sort=[('start_time', 1)]))
    return jsonify([to_dict(s) for s in sessions])


@app.route('/api/sessions', methods=['POST'])
def create_session():
    data = request.json
    result = sessions_col.insert_one({
        'date':       data['date'],
        'focus_area': data['focus_area'],
        'start_time': data['start_time'],
        'end_time':          None,
        'duration_minutes':  None,
        'outcome':           '',
    })
    s = sessions_col.find_one({'_id': result.inserted_id})
    return jsonify(to_dict(s))


@app.route('/api/sessions/<string:sid>', methods=['PATCH'])
def end_session(sid):
    data = request.json
    sessions_col.update_one(
        {'_id': ObjectId(sid)},
        {'$set': {
            'end_time':         data['end_time'],
            'duration_minutes': data['duration_minutes'],
            'outcome':          data.get('outcome', ''),
        }}
    )
    s = sessions_col.find_one({'_id': ObjectId(sid)})
    return jsonify(to_dict(s))


# ── STATS ─────────────────────────────────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
def get_stats():
    # Recent reviews for charts
    recent = list(reviews_col.find(
        {},
        {'date': 1, 'execution_score': 1, 'deep_work_hours': 1, 'grade_letter': 1},
        sort=[('date', -1)],
    ).limit(14))

    # Streak — count consecutive days backwards from today
    all_dates = {r['date'] for r in reviews_col.find({}, {'date': 1})}
    streak = 0
    check = date.today()
    while str(check) in all_dates:
        streak += 1
        check -= timedelta(days=1)

    # 7-day averages
    seven_ago = str(date.today() - timedelta(days=7))
    avg_pipeline = [
        {'$match': {'date': {'$gte': seven_ago}}},
        {'$group': {'_id': None,
                    'avg_dw':    {'$avg': '$deep_work_hours'},
                    'avg_score': {'$avg': '$execution_score'}}},
    ]
    avg_result = list(reviews_col.aggregate(avg_pipeline))
    avg_dw    = avg_result[0]['avg_dw']    if avg_result else 0
    avg_score = avg_result[0]['avg_score'] if avg_result else 0

    # Total deep work time across all sessions
    dw_pipeline = [
        {'$match': {'end_time': {'$ne': None}}},
        {'$group': {'_id': None, 'total': {'$sum': '$duration_minutes'}}},
    ]
    dw_result = list(sessions_col.aggregate(dw_pipeline))
    total_dw_min = dw_result[0]['total'] if dw_result else 0

    return jsonify({
        'recent_reviews':   [to_dict(r) for r in recent],
        'streak':           streak,
        'avg_deep_work_7d': round(avg_dw    or 0, 1),
        'avg_score_7d':     round(avg_score or 0, 1),
        'total_sessions':   sessions_col.count_documents({}),
        'total_dw_hours':   round((total_dw_min or 0) / 60, 1),
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
    print("Cosmic Q Ops running → http://localhost:5050")
    app.run(debug=True, port=5050, use_reloader=False)
