import time

GRAVITY = 0.8
JUMP_FORCE = -15
MOVE_SPEED = 4
FLOOR_Y = 400
CANVAS_W = 800
WALL_LEFT = 30
WALL_RIGHT = 770

ATTACK_DAMAGE = {'attack_z': 5, 'attack_x': 12, 'attack_c': 20}
ATTACK_KNOCKBACK = {'attack_z': 3, 'attack_x': 8, 'attack_c': 15}
ATTACK_RANGE = {'attack_z': 65, 'attack_x': 110, 'attack_c': 90}

# frames at 30fps
ATTACK_DURATION = {'attack_z': 12, 'attack_x': 20, 'attack_c': 30}
HIT_DURATION = 10
DEAD_DURATION = 60
SPECIAL_COOLDOWN = 10.0   # seconds
SPECIAL_INVINCIBLE_FRAMES = 9


class Player:
    def __init__(self, player_num, x, nickname, color):
        self.player_num = player_num
        self.nickname = nickname
        self.color = color
        self.x = float(x)
        self.y = float(FLOOR_Y)
        self.vx = 0.0
        self.vy = 0.0
        self.facing = 'right' if player_num == 1 else 'left'
        self.hp = 100
        self.state = 'idle'
        self.state_frames = 0
        self.is_grounded = True
        self.hit_landed = False
        self.invincible_frames = 0
        self.special_last_used = 0.0
        self.keys = {}
        self.anim_tick = 0

    def can_use_special(self):
        return (time.time() - self.special_last_used) >= SPECIAL_COOLDOWN

    def special_cooldown_remaining(self):
        elapsed = time.time() - self.special_last_used
        return max(0.0, SPECIAL_COOLDOWN - elapsed)

    def to_dict(self):
        return {
            'player_num': self.player_num,
            'nickname': self.nickname,
            'color': self.color,
            'x': round(self.x),
            'y': round(self.y),
            'hp': self.hp,
            'state': self.state,
            'facing': self.facing,
            'is_grounded': self.is_grounded,
            'anim_tick': self.anim_tick,
            'special_cooldown': round(self.special_cooldown_remaining(), 1),
        }


class GameRoom:
    def __init__(self, room_id, p1_nick, p2_nick, p1_color, p2_color):
        self.room_id = room_id
        self.p1_nick = p1_nick
        self.p2_nick = p2_nick
        self.p1_color = p1_color
        self.p2_color = p2_color
        self.scores = [0, 0]
        self.round_num = 1
        self.active = True
        self.game_over = False
        self._init_round()

    def _init_round(self):
        self.players = [
            Player(1, 200, self.p1_nick, self.p1_color),
            Player(2, 600, self.p2_nick, self.p2_color),
        ]
        self.timer = 99.0
        self.last_tick = time.time()
        self.round_ended = False
        self.round_end_data = None

    def update(self):
        now = time.time()
        dt = now - self.last_tick
        self.last_tick = now

        if self.round_ended:
            return None

        self.timer -= dt
        if self.timer <= 0:
            self.timer = 0
            return self._end_round_by_time()

        for p in self.players:
            self._process_input(p)

        for p in self.players:
            self._update_physics(p)

        self._check_facing()
        self._check_hits()

        for p in self.players:
            if p.hp <= 0 and p.state != 'dead':
                p.state = 'dead'
                p.state_frames = 0

        dead = [p for p in self.players if p.state == 'dead']
        if dead:
            dead_p = dead[0]
            dead_p.state_frames += 1
            if dead_p.state_frames >= DEAD_DURATION:
                winner_num = 2 if dead_p.player_num == 1 else 1
                return self._end_round(winner_num)

        return None

    def _process_input(self, p):
        keys = p.keys
        if p.state in ('dead',):
            return

        attacking = p.state in ('attack_z', 'attack_x', 'attack_c')
        in_hit = p.state == 'hit'

        # Advance attack/hit state frames
        if attacking or in_hit:
            p.state_frames += 1
            duration = ATTACK_DURATION.get(p.state, 10) if attacking else HIT_DURATION
            if p.state_frames >= duration:
                p.hit_landed = False
                p.state = 'idle'
                p.state_frames = 0
            if attacking:
                p.vx *= 0.5
            return

        # Block (아래 방향키, 지상에서만)
        if keys.get('down') and p.is_grounded:
            p.state = 'block'
            p.vx = 0
            return

        # Exit block state if key released
        if p.state == 'block':
            p.state = 'idle'

        # Attack inputs (priority: C > X > Z)
        if keys.get('c') and p.can_use_special():
            p.state = 'attack_c'
            p.state_frames = 0
            p.hit_landed = False
            p.invincible_frames = SPECIAL_INVINCIBLE_FRAMES
            p.special_last_used = time.time()
            p.vx = (MOVE_SPEED * 1.5) * (1 if p.facing == 'right' else -1)
            return
        if keys.get('x'):
            p.state = 'attack_x'
            p.state_frames = 0
            p.hit_landed = False
            return
        if keys.get('z'):
            p.state = 'attack_z'
            p.state_frames = 0
            p.hit_landed = False
            return

        # Movement
        moving = False
        if keys.get('left'):
            p.vx = -MOVE_SPEED
            p.facing = 'left'
            moving = True
        elif keys.get('right'):
            p.vx = MOVE_SPEED
            p.facing = 'right'
            moving = True
        else:
            p.vx = 0

        if keys.get('jump') and p.is_grounded:
            p.vy = JUMP_FORCE
            p.is_grounded = False

        if p.is_grounded:
            p.state = 'walk' if moving else 'idle'
        else:
            p.state = 'jump'

    def _update_physics(self, p):
        if p.state == 'dead':
            return

        if p.invincible_frames > 0:
            p.invincible_frames -= 1

        p.vy += GRAVITY
        p.x += p.vx
        p.y += p.vy

        # Floor
        if p.y >= FLOOR_Y:
            p.y = FLOOR_Y
            p.vy = 0
            p.is_grounded = True

        # Walls
        p.x = max(WALL_LEFT, min(WALL_RIGHT, p.x))

        p.anim_tick += 1

    def _check_facing(self):
        p1, p2 = self.players
        if p1.state not in ('attack_z', 'attack_x', 'attack_c', 'hit', 'dead', 'block'):
            p1.facing = 'right' if p2.x > p1.x else 'left'
        if p2.state not in ('attack_z', 'attack_x', 'attack_c', 'hit', 'dead', 'block'):
            p2.facing = 'left' if p1.x < p2.x else 'right'

    def _check_hits(self):
        for attacker, defender in [(self.players[0], self.players[1]),
                                   (self.players[1], self.players[0])]:
            if attacker.state not in ('attack_z', 'attack_x', 'attack_c'):
                continue
            if attacker.hit_landed:
                continue
            if defender.invincible_frames > 0:
                continue
            if defender.state == 'dead':
                continue

            dist_x = abs(attacker.x - defender.x)
            dist_y = abs(attacker.y - defender.y)
            hit_range = ATTACK_RANGE.get(attacker.state, 70)
            if dist_x >= hit_range or dist_y >= 80:
                continue

            facing_defender = (
                (attacker.facing == 'right' and defender.x > attacker.x) or
                (attacker.facing == 'left' and defender.x < attacker.x)
            )
            if not facing_defender:
                continue

            dmg = ATTACK_DAMAGE[attacker.state]
            knockback = ATTACK_KNOCKBACK[attacker.state]

            # 방어 판정: 블록 상태 + 공격자를 정면으로 보는 경우
            is_blocking = (
                defender.state == 'block' and
                (
                    (defender.facing == 'right' and attacker.x < defender.x) or
                    (defender.facing == 'left'  and attacker.x > defender.x)
                )
            )
            if is_blocking and attacker.state != 'attack_c':
                # 필살기 제외 — 피해 70% 감소, 넉백 최소화, hit 상태 없음
                dmg = max(1, int(dmg * 0.3))
                knockback = 1
                defender.hp = max(0, defender.hp - dmg)
                kb_dir = 1 if attacker.facing == 'right' else -1
                defender.vx = kb_dir * knockback
                attacker.hit_landed = True
                continue  # hit 상태로 전환하지 않음

            defender.hp = max(0, defender.hp - dmg)
            kb_dir = 1 if attacker.facing == 'right' else -1
            defender.vx = kb_dir * knockback
            defender.vy = -4
            defender.is_grounded = False
            defender.state = 'hit'
            defender.state_frames = 0
            attacker.hit_landed = True

    def _end_round(self, winner_num):
        self.round_ended = True
        self.scores[winner_num - 1] += 1
        data = {
            'winner': winner_num,
            'scores': self.scores[:],
            'round': self.round_num,
        }
        self.round_end_data = data

        if self.scores[winner_num - 1] >= 2:
            self.game_over = True
            self.active = False
            winner_nick = self.p1_nick if winner_num == 1 else self.p2_nick
            loser_nick = self.p2_nick if winner_num == 1 else self.p1_nick
            data['game_over'] = True
            data['winner_nick'] = winner_nick
            data['loser_nick'] = loser_nick
        else:
            self.round_num += 1

        return data

    def _end_round_by_time(self):
        p1, p2 = self.players
        if p1.hp > p2.hp:
            return self._end_round(1)
        elif p2.hp > p1.hp:
            return self._end_round(2)
        else:
            # Draw: neither gets a point, restart round
            self.round_ended = True
            data = {'winner': 0, 'scores': self.scores[:], 'round': self.round_num, 'draw': True}
            self.round_end_data = data
            return data

    def start_next_round(self):
        self._init_round()

    def state_dict(self):
        return {
            'players': [p.to_dict() for p in self.players],
            'timer': round(self.timer, 1),
            'round': self.round_num,
            'scores': self.scores[:],
        }
