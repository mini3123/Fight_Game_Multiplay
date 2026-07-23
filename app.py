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

GAME_TICK_HZ = 30
STATE_BROADCAST_HZ = 20

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
sid_to = {}        # sid -> (room_id, player_num)
spectators = {}    # room_id -> set of sids

CHARACTER_COLORS = {
    'Fighter': '#4FC3F7',
    'Ninja':   '#66BB6A',
    'Boxer':   '#EF5350',
    'Wizard':  '#CE93D8',
    'Tank':    '#78909C',
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
    # 관전자 정리
    for rid in list(spectators.keys()):
        spectators[rid].discard(sid)

    gen = None
    room_id = None
    player_num = None
    with rooms_lock:
        info = sid_to.pop(sid, None)
        if not info:
            return
        room_id, player_num = info
        if room_id not in rooms:
            return
        slot = rooms[room_id]['slots'].get(player_num)
        # sid가 이미 새 연결로 교체됐으면 타이머 시작 안 함
        if slot and slot['sid'] == sid:
            slot['sid'] = None
            slot['_gen'] = slot.get('_gen', 0) + 1
            gen = slot['_gen']

    if gen is None:
        return
    # Grace period: 10초 안에 재연결 안 하면 정리
    t = threading.Timer(10.0, _cleanup_slot, args=(room_id, player_num, gen))
    t.daemon = True
    t.start()


def _cleanup_slot(room_id, player_num, gen):
    with rooms_lock:
        if room_id not in rooms:
            return
        room = rooms[room_id]
        slot = room['slots'].get(player_num)
        # sid가 복구됐거나 더 최신 타이머가 있으면 무시
        if not slot or slot['sid'] is not None or slot.get('_gen', 0) != gen:
            return

        room['slots'].pop(player_num, None)
        room['stop_loop'] = True

        # 솔로 방은 봇 슬롯(sid=None)이 남아 방이 삭제되지 않으므로 함께 제거
        if room.get('solo'):
            room['slots'].clear()

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


@socketio.on('create_solo_room')
def on_create_solo_room(data):
    nickname   = str(data.get('nickname', 'Player')).strip()[:20] or 'Player'
    difficulty = data.get('difficulty', 'normal')
    if difficulty not in ('easy', 'normal', 'hard'):
        difficulty = 'normal'
    sid = request.sid

    BOT_CHARS = {'easy': 'Fighter', 'normal': 'Ninja', 'hard': 'Boxer'}
    BOT_NICKS = {'easy': '봇(쉬움)', 'normal': '봇(보통)', 'hard': '봇(어려움)'}
    bot_char = BOT_CHARS[difficulty]
    bot_nick = BOT_NICKS[difficulty]

    with rooms_lock:
        room_id = make_room_id()
        while room_id in rooms:
            room_id = make_room_id()

        rooms[room_id] = {
            'slots': {
                1: {'nickname': nickname,  'character': None,     'sid': sid},
                2: {'nickname': bot_nick,  'character': bot_char, 'sid': None},
            },
            'game': None, 'loop_thread': None,
            'phase': 'select', 'stop_loop': False,
            'background': 'city',
            'solo': True, 'difficulty': difficulty,
        }
        sid_to[sid] = (room_id, 1)

    join_room(room_id)
    emit('character_select', {'player_num': 1, 'room_id': room_id,
                              'solo': True, 'difficulty': difficulty, 'bot_nick': bot_nick})


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
            emit('reconnect_failed', {'msg': '방이 만료되었습니다.'})
            return

        room = rooms[room_id]
        slot = room['slots'].get(player_num)
        if not slot or slot['nickname'] != nickname:
            emit('reconnect_failed', {'msg': '재연결 실패.'})
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
        with rooms_lock:
            bg = rooms.get(room_id, {}).get('background', 'city')
        emit('game_start', {'player_num': player_num, 'background': bg})


@socketio.on('preview_character')
def on_preview_character(data):
    sid = request.sid
    with rooms_lock:
        info = sid_to.get(sid)
        if not info:
            return
        room_id, player_num = info
        if room_id not in rooms:
            return
        slots = rooms[room_id]['slots']
        other_num = 2 if player_num == 1 else 1
        other_slot = slots.get(other_num)
        other_sid = other_slot['sid'] if other_slot else None

    if other_sid:
        socketio.emit('opponent_preview', {
            'player_num': player_num,
            'character': data.get('character', ''),
        }, room=other_sid)


@socketio.on('select_character')
def on_select_character(data):
    sid = request.sid
    with rooms_lock:
        info = sid_to.get(sid)
    if not info:
        return
    room_id, player_num = info

    character  = data.get('character', 'Fighter')
    background = data.get('background', 'city')
    should_start = False

    with rooms_lock:
        if room_id not in rooms:
            return
        room = rooms[room_id]
        if room['phase'] != 'select':
            return
        slot = room['slots'].get(player_num)
        if slot:
            slot['character'] = character
            if player_num == 1:
                room['background'] = background
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
        # 선택 완료 이벤트가 중복 도착해도 게임 루프는 방마다 하나만 만든다.
        if not room or room['phase'] != 'select':
            return
        slots = room['slots']
        s1, s2 = slots[1], slots[2]
        p1_color = CHARACTER_COLORS.get(s1['character'], '#4FC3F7')
        p2_color = CHARACTER_COLORS.get(s2['character'], '#66BB6A')
        is_solo   = room.get('solo', False)
        difficulty = room.get('difficulty', 'normal') if is_solo else None
        room['game'] = game_logic.GameRoom(
            room_id, s1['nickname'], s2['nickname'], p1_color, p2_color,
            s1['character'], s2['character'],
            bot_difficulty=difficulty,
        )
        room['phase'] = 'game'
        room['stop_loop'] = False
        p1_sid = s1['sid']
        p2_sid = s2['sid']  # 솔로면 None
        bg = room.get('background', 'city')

    socketio.emit('game_start', {'player_num': 1, 'background': bg}, room=p1_sid)
    if p2_sid:
        socketio.emit('game_start', {'player_num': 2, 'background': bg}, room=p2_sid)

    t = threading.Thread(target=_game_loop, args=(room_id,), daemon=True)
    with rooms_lock:
        rooms[room_id]['loop_thread'] = t
    t.start()


def _game_loop(room_id):
    tick_interval = 1.0 / GAME_TICK_HZ
    broadcast_interval = 1.0 / STATE_BROADCAST_HZ
    next_broadcast = time.monotonic()
    try:
        while True:
            t0 = time.monotonic()

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
                    try:
                        database.save_result(result['winner_nick'], result['loser_nick'])
                    except Exception:
                        pass
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
            elif t0 >= next_broadcast:
                socketio.emit('game_state', game.state_dict(), room=room_id)
                # 30Hz 게임 틱과 독립된 평균 20Hz 일정으로 전송한다.
                next_broadcast += broadcast_interval
                if next_broadcast < t0:
                    next_broadcast = t0 + broadcast_interval

            # 틱 소요 시간을 빼고 정확히 30fps 유지
            elapsed = time.monotonic() - t0
            wait = tick_interval - elapsed
            if wait > 0:
                time.sleep(wait)
    except Exception:
        # 예외 발생 시에도 방 반드시 삭제
        with rooms_lock:
            if room_id in rooms:
                rooms.pop(room_id, None)


@socketio.on('chat_message')
def on_chat_message(data):
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
        slot = room['slots'].get(player_num)
        nickname = slot['nickname'] if slot else 'Unknown'

    msg = str(data.get('msg', '')).strip()[:100]
    if not msg:
        return

    socketio.emit('chat_message', {
        'nickname': nickname,
        'msg': msg,
        'player_num': player_num,
    }, room=room_id)


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


def _get_room_list():
    result = []
    with rooms_lock:
        for rid, room in rooms.items():
            if room['phase'] in ('done',):
                continue
            # 봇전(솔로) 방은 로비에 표시하지 않음
            if room.get('solo'):
                continue
            slots = room['slots']
            # 실제 접속 중인 사람이 한 명도 없으면 목록에서 제외
            if not any(s.get('sid') for s in slots.values()):
                continue
            game  = room.get('game')
            result.append({
                'room_id': rid,
                'phase':   room['phase'],
                'solo':    room.get('solo', False),
                'p1':      slots.get(1, {}).get('nickname', '?'),
                'p2':      slots.get(2, {}).get('nickname', '?'),
                'scores':  game.scores[:] if game else [0, 0],
                'round':   game.round_num if game else 1,
            })
    return result


@socketio.on('get_rooms')
def on_get_rooms():
    emit('rooms_list', {'rooms': _get_room_list()})


@socketio.on('spectate')
def on_spectate(data):
    room_id = str(data.get('room_id', '')).upper()
    sid = request.sid

    with rooms_lock:
        room = rooms.get(room_id)
        if not room or room['phase'] != 'game':
            emit('spec_error', {'msg': '관전할 수 없는 방입니다.'})
            return
        bg    = room.get('background', 'city')
        slots = room['slots']
        p1_nick = slots.get(1, {}).get('nickname', '?')
        p2_nick = slots.get(2, {}).get('nickname', '?')
        game = room.get('game')
        scores = game.scores[:] if game else [0, 0]

    join_room(room_id)
    with rooms_lock:
        if room_id not in spectators:
            spectators[room_id] = set()
        spectators[room_id].add(sid)

    # to=sid 를 명시해 join_room 이후에도 방 전체가 아닌 관전자에게만 전송
    socketio.emit('game_start', {
        'player_num': 0,
        'spectator':  True,
        'background': bg,
        'p1_nick':    p1_nick,
        'p2_nick':    p2_nick,
        'scores':     scores,
    }, to=sid)


@socketio.on('get_ranking')
def on_get_ranking():
    emit('ranking', {'data': database.get_ranking()})


@socketio.on('get_history')
def on_get_history(data):
    nickname = str(data.get('nickname', '')).strip()
    emit('history', {'data': database.get_recent_matches(nickname) if nickname else []})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
