import os
import random
import string
import time
import threading

from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room

import database
import game_logic

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-prod')
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins='*')

database.init_db()

# rooms[room_id] = {
#   'slots': {1: slot_dict, 2: slot_dict},   player_num -> slot
#   'game':  GameRoom | None,
#   'loop_thread': Thread | None,
#   'phase': 'waiting' | 'select' | 'game' | 'done',
#   'stop_loop': bool,
# }
# slot_dict = {'nickname': str, 'character': str|None, 'sid': str|None}
rooms = {}
rooms_lock = threading.Lock()
sid_to = {}   # sid -> (room_id, player_num)

CHARACTER_COLORS = {
    'Fighter': '#4FC3F7',
    'Ninja':   '#66BB6A',
    'Boxer':   '#EF5350',
}


def make_room_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------------------------------------------------------------------------
# Static routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)


# ---------------------------------------------------------------------------
# Socket events
# ---------------------------------------------------------------------------

@socketio.on('connect')
def on_connect():
    pass


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    with rooms_lock:
        info = sid_to.pop(sid, None)
    if not info:
        return
    room_id, player_num = info

    with rooms_lock:
        if room_id not in rooms:
            return
        slot = rooms[room_id]['slots'].get(player_num)
        if slot:
            slot['sid'] = None

    # Grace period: clean up if player doesn't reconnect within 10 s
    t = threading.Timer(10.0, _cleanup_slot, args=(room_id, player_num))
    t.daemon = True
    t.start()


def _cleanup_slot(room_id, player_num):
    with rooms_lock:
        if room_id not in rooms:
            return
        room = rooms[room_id]
        slot = room['slots'].get(player_num)
        if not slot or slot['sid'] is not None:
            return  # Player reconnected within grace period

        room['slots'].pop(player_num, None)
        room['stop_loop'] = True

    socketio.emit('opponent_left', {}, room=room_id)

    with rooms_lock:
        if not rooms.get(room_id, {}).get('slots'):
            rooms.pop(room_id, None)


@socketio.on('create_room')
def on_create_room(data):
    nickname = str(data.get('nickname', 'Player')).strip()[:20] or 'Player'
    sid = request.sid

    with rooms_lock:
        room_id = make_room_id()
        while room_id in rooms:
            room_id = make_room_id()

        rooms[room_id] = {
            'slots': {1: {'nickname': nickname, 'character': None, 'sid': sid}},
            'game': None,
            'loop_thread': None,
            'phase': 'waiting',
            'stop_loop': False,
        }
        sid_to[sid] = (room_id, 1)

    join_room(room_id)
    emit('room_created', {'room_id': room_id, 'player_num': 1})


@socketio.on('join_room')
def on_join_room(data):
    nickname = str(data.get('nickname', 'Player')).strip()[:20] or 'Player'
    room_id = str(data.get('room_id', '')).upper()
    sid = request.sid

    with rooms_lock:
        if room_id not in rooms:
            emit('error', {'msg': '존재하지 않는 방입니다.'})
            return

        room = rooms[room_id]
        if room['phase'] != 'waiting':
            emit('error', {'msg': '이미 게임이 시작된 방입니다.'})
            return
        if len(room['slots']) >= 2:
            emit('error', {'msg': '방이 가득 찼습니다.'})
            return

        room['slots'][2] = {'nickname': nickname, 'character': None, 'sid': sid}
        sid_to[sid] = (room_id, 2)
        room['phase'] = 'select'
        p1_sid = room['slots'][1]['sid']

    join_room(room_id)
    socketio.emit('character_select', {'player_num': 1}, room=p1_sid)
    emit('character_select', {'player_num': 2})


@socketio.on('reconnect_to_room')
def on_reconnect(data):
    room_id = str(data.get('room_id', '')).upper()
    player_num = int(data.get('player_num', 0))
    nickname = str(data.get('nickname', '')).strip()
    sid = request.sid

    with rooms_lock:
        if room_id not in rooms:
            emit('error', {'msg': '방이 존재하지 않습니다.'})
            return

        room = rooms[room_id]
        slot = room['slots'].get(player_num)
        if not slot or slot['nickname'] != nickname:
            emit('error', {'msg': '재연결 실패.'})
            return

        old_sid = slot['sid']
        if old_sid and old_sid != sid:
            sid_to.pop(old_sid, None)
        slot['sid'] = sid
        sid_to[sid] = (room_id, player_num)
        phase = room['phase']

    join_room(room_id)

    if phase == 'select':
        emit('character_select', {'player_num': player_num})
    elif phase == 'game':
        emit('game_start', {'player_num': player_num})


@socketio.on('select_character')
def on_select_character(data):
    sid = request.sid
    with rooms_lock:
        info = sid_to.get(sid)
    if not info:
        return
    room_id, player_num = info

    character = data.get('character', 'Fighter')
    should_start = False

    with rooms_lock:
        if room_id not in rooms:
            return
        room = rooms[room_id]
        slot = room['slots'].get(player_num)
        if slot:
            slot['character'] = character
        slots = room['slots']
        if (len(slots) == 2
                and slots.get(1) and slots[1].get('character')
                and slots.get(2) and slots[2].get('character')):
            should_start = True

    if should_start:
        _start_game(room_id)


def _start_game(room_id):
    with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        slots = room['slots']
        s1, s2 = slots[1], slots[2]
        p1_color = CHARACTER_COLORS.get(s1['character'], '#4FC3F7')
        p2_color = CHARACTER_COLORS.get(s2['character'], '#66BB6A')
        room['game'] = game_logic.GameRoom(
            room_id, s1['nickname'], s2['nickname'], p1_color, p2_color,
        )
        room['phase'] = 'game'
        room['stop_loop'] = False
        p1_sid, p2_sid = s1['sid'], s2['sid']

    socketio.emit('game_start', {'player_num': 1}, room=p1_sid)
    socketio.emit('game_start', {'player_num': 2}, room=p2_sid)

    t = threading.Thread(target=_game_loop, args=(room_id,), daemon=True)
    with rooms_lock:
        rooms[room_id]['loop_thread'] = t
    t.start()


def _game_loop(room_id):
    while True:
        with rooms_lock:
            room = rooms.get(room_id)
            if not room or room.get('stop_loop'):
                break
            game = room.get('game')
            if not game or not game.active:
                break

        result = game.update()

        if result:
            if result.get('game_over'):
                socketio.emit('game_over', {
                    'winner': result['winner'],
                    'winner_nick': result['winner_nick'],
                    'loser_nick': result['loser_nick'],
                    'scores': result['scores'],
                }, room=room_id)
                database.save_result(result['winner_nick'], result['loser_nick'])
                with rooms_lock:
                    if room_id in rooms:
                        rooms[room_id]['phase'] = 'done'
                        rooms.pop(room_id, None)
                break
            else:
                socketio.emit('round_end', {
                    'winner': result.get('winner', 0),
                    'scores': result['scores'],
                    'round': result['round'],
                    'draw': result.get('draw', False),
                }, room=room_id)
                time.sleep(3)
                with rooms_lock:
                    if room_id not in rooms:
                        break
                    rooms[room_id]['game'].start_next_round()
                    next_round = rooms[room_id]['game'].round_num
                socketio.emit('round_start', {'round': next_round}, room=room_id)
        else:
            socketio.emit('game_state', game.state_dict(), room=room_id)

        time.sleep(1 / 30)


@socketio.on('player_input')
def on_player_input(data):
    sid = request.sid
    with rooms_lock:
        info = sid_to.get(sid)
    if not info:
        return
    room_id, player_num = info

    with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        game = room.get('game')
        if not game:
            return
        player = game.players[player_num - 1]

    player.keys = data.get('keys', {})


@socketio.on('get_ranking')
def on_get_ranking():
    emit('ranking', {'data': database.get_ranking()})


@socketio.on('get_history')
def on_get_history(data):
    nickname = str(data.get('nickname', '')).strip()
    emit('history', {'data': database.get_recent_matches(nickname) if nickname else []})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
