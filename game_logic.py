import time
import random

GRAVITY = 0.8
FLOOR_Y = 400
WALL_LEFT = 30
WALL_RIGHT = 770

# frames at 30fps
ATTACK_DURATION = {'attack_z': 12, 'attack_x': 20, 'attack_c': 30}
HIT_DURATION = 10
DEAD_DURATION = 60
SPECIAL_INVINCIBLE_FRAMES = 9

ATTACK_RANGE = {'attack_z': 65, 'attack_x': 110, 'attack_c': 90}

class Projectile:
    def __init__(self, owner_num, x, y, vx, color, damage):
        self.owner_num = owner_num
        self.x = float(x)
        self.y = float(y)
        self.vx = float(vx)
        self.color = color
        self.damage = damage
        self.active = True

    def update(self):
        self.x += self.vx
        if self.x < -60 or self.x > 860:
            self.active = False

    def to_dict(self):
        return {'x': round(self.x), 'y': round(self.y), 'color': self.color}


class BotAI:
    """서버 사이드 봇 AI — 매 프레임 키 입력을 자동 생성한다."""

    THINK_INTERVAL = {'easy': 42, 'normal': 18, 'hard': 7}

    def __init__(self, difficulty='normal'):
        self.difficulty = difficulty
        self.cooldown = 0
        self.keys = {k: False for k in ('left', 'right', 'jump', 'down', 'z', 'x', 'c')}

    def update(self, bot, opponent):
        """game_loop 에서 매 프레임 호출 — 갱신된 keys 반환."""
        self.cooldown -= 1
        if self.cooldown > 0:
            return self.keys

        base = self.THINK_INTERVAL[self.difficulty]
        self.cooldown = base + random.randint(0, base // 2)
        self._plan(bot, opponent)
        return self.keys

    # ── 내부 헬퍼 ──────────────────────────────────────────────
    def _reset(self):
        for k in self.keys:
            self.keys[k] = False

    def _approach(self, bot, opponent):
        self.keys['right' if opponent.x > bot.x else 'left'] = True

    def _retreat(self, bot, opponent):
        self.keys['left' if opponent.x > bot.x else 'right'] = True

    # ── 난이도별 행동 ───────────────────────────────────────────
    def _plan(self, bot, opponent):
        self._reset()
        if bot.state == 'dead':
            return

        dist = abs(bot.x - opponent.x)

        if self.difficulty == 'easy':
            self._plan_easy(bot, opponent, dist)
        elif self.difficulty == 'normal':
            self._plan_normal(bot, opponent, dist)
        else:
            self._plan_hard(bot, opponent, dist)

    def _plan_easy(self, bot, opponent, dist):
        if dist > 200:
            if random.random() < 0.55:
                self._approach(bot, opponent)
        elif dist < 110:
            if random.random() < 0.30:
                self.keys['z'] = True          # 약공격만 사용
        else:
            if random.random() < 0.40:
                self._approach(bot, opponent)

    def _plan_normal(self, bot, opponent, dist):
        opp_atk = opponent.state in ('attack_z', 'attack_x', 'attack_c')
        if opp_atk and dist < 100 and random.random() < 0.40:
            self.keys['down'] = True           # 가끔 가드
            return
        if dist > 130:
            self._approach(bot, opponent)
            if random.random() < 0.12:
                self.keys['jump'] = True
        elif dist < 90:
            r = random.random()
            if r < 0.38:
                self.keys['z'] = True
            elif r < 0.65:
                self.keys['x'] = True
            elif r < 0.75 and bot.can_use_special():
                self.keys['c'] = True
            else:
                self.keys['down'] = True
        else:
            self._approach(bot, opponent)

    def _plan_hard(self, bot, opponent, dist):
        opp_atk = opponent.state in ('attack_z', 'attack_x', 'attack_c')
        # 공격 예측 가드
        if opp_atk and dist < 120 and random.random() < 0.72:
            self.keys['down'] = True
            return
        if dist > 120:
            self._approach(bot, opponent)
            if random.random() < 0.20:
                self.keys['jump'] = True
        elif dist <= 90:
            r = random.random()
            if bot.can_use_special() and r < 0.28:
                self.keys['c'] = True
            elif r < 0.55:
                self.keys['x'] = True
            else:
                self.keys['z'] = True
        else:
            # 중거리: 짧게 후퇴 후 접근
            if random.random() < 0.35:
                self._retreat(bot, opponent)
            else:
                self._approach(bot, opponent)


CHARACTER_STATS = {
    'Fighter': {
        'hp': 100, 'move_speed': 4, 'jump_force': -15, 'special_cooldown': 10.0,
        'damage':   {'attack_z': 5,  'attack_x': 12, 'attack_c': 20},
        'knockback':{'attack_z': 3,  'attack_x': 5,  'attack_c': 15},
    },
    'Ninja': {
        'hp': 90,  'move_speed': 6, 'jump_force': -18, 'special_cooldown': 6.0,
        'damage':   {'attack_z': 4,  'attack_x': 9,  'attack_c': 15},
        'knockback':{'attack_z': 2,  'attack_x': 4,  'attack_c': 11},
    },
    'Boxer': {
        'hp': 120, 'move_speed': 3.5, 'jump_force': -14, 'special_cooldown': 10.0,
        'damage':   {'attack_z': 6,  'attack_x': 13, 'attack_c': 24},
        'knockback':{'attack_z': 4,  'attack_x': 6,  'attack_c': 18},
    },
}


class Player:
    def __init__(self, player_num, x, nickname, color, character='Fighter'):
        stats = CHARACTER_STATS.get(character, CHARACTER_STATS['Fighter'])
        self.player_num = player_num
        self.nickname = nickname
        self.color = color
        self.character = character
        self.x = float(x)
        self.y = float(FLOOR_Y)
        self.vx = 0.0
        self.vy = 0.0
        self.facing = 'right' if player_num == 1 else 'left'
        self.hp = stats['hp']
        self.max_hp = stats['hp']
        self.move_speed = stats['move_speed']
        self.jump_force = stats['jump_force']
        self.special_cooldown_time = stats['special_cooldown']
        self.damage = stats['damage']
        self.knockback = stats['knockback']
        self.state = 'idle'
        self.state_frames = 0
        self.is_grounded = True
        self.hit_landed = False
        self.invincible_frames = 0
        self.special_last_used = 0.0
        self.keys = {}
        self.anim_tick = 0

    def can_use_special(self):
        return (time.time() - self.special_last_used) >= self.special_cooldown_time

    def special_cooldown_remaining(self):
        elapsed = time.time() - self.special_last_used
        return max(0.0, self.special_cooldown_time - elapsed)

    def to_dict(self):
        return {
            'player_num': self.player_num,
            'nickname': self.nickname,
            'color': self.color,
            'character': self.character,
            'x': round(self.x),
            'y': round(self.y),
            'hp': self.hp,
            'max_hp': self.max_hp,
            'state': self.state,
            'facing': self.facing,
            'is_grounded': self.is_grounded,
            'anim_tick': self.anim_tick,
            'special_cooldown': round(self.special_cooldown_remaining(), 1),
            'special_cooldown_time': self.special_cooldown_time,
        }


class GameRoom:
    def __init__(self, room_id, p1_nick, p2_nick, p1_color, p2_color, p1_char='Fighter', p2_char='Fighter', bot_difficulty=None):
        self.room_id = room_id
        self.p1_nick = p1_nick
        self.p2_nick = p2_nick
        self.p1_color = p1_color
        self.p2_color = p2_color
        self.p1_char = p1_char
        self.p2_char = p2_char
        self.bot_ai = BotAI(bot_difficulty) if bot_difficulty else None
        self.scores = [0, 0]
        self.round_num = 1
        self.active = True
        self.game_over = False
        self._init_round()

    def _init_round(self):
        self.players = [
            Player(1, 200, self.p1_nick, self.p1_color, self.p1_char),
            Player(2, 600, self.p2_nick, self.p2_color, self.p2_char),
        ]
        self.projectiles = []
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

        # 봇 키 자동 생성 (솔로 모드)
        if self.bot_ai:
            self.players[1].keys = self.bot_ai.update(self.players[1], self.players[0])

        for p in self.players:
            self._process_input(p)

        for p in self.players:
            self._update_physics(p)

        self._check_facing()
        self._check_hits()
        self._update_projectiles()

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
            p.special_last_used = time.time()

            if p.character == 'Fighter':
                # 장풍: 전방으로 에너지탄 발사 (이동 없음)
                p.invincible_frames = 0
                p.vx = 0
                vx = 9 if p.facing == 'right' else -9
                proj_x = p.x + (55 if p.facing == 'right' else -55)
                self.projectiles.append(
                    Projectile(p.player_num, proj_x, p.y - 45, vx, p.color, 20)
                )
            elif p.character == 'Ninja':
                # 분신술: 상대방 바로 옆으로 순간이동
                p.invincible_frames = SPECIAL_INVINCIBLE_FRAMES
                p.vx = 0
                opponent = self.players[1 if p.player_num == 1 else 0]
                gap = 38
                if opponent.x > p.x:
                    p.x = max(WALL_LEFT, opponent.x - gap)
                    p.facing = 'right'
                else:
                    p.x = min(WALL_RIGHT, opponent.x + gap)
                    p.facing = 'left'
            elif p.character == 'Boxer':
                # 슈퍼 어퍼컷: 상대방 향해 돌진 점프 후 강타
                p.invincible_frames = 0
                opponent = self.players[1 if p.player_num == 1 else 0]
                lunge_dir = 1 if opponent.x > p.x else -1
                p.vx = p.move_speed * 2.5 * lunge_dir
                p.vy = p.jump_force
                p.is_grounded = False
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
            p.vx = -p.move_speed
            p.facing = 'left'
            moving = True
        elif keys.get('right'):
            p.vx = p.move_speed
            p.facing = 'right'
            moving = True
        else:
            p.vx = 0

        if keys.get('jump') and p.is_grounded:
            p.vy = p.jump_force
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
            # Fighter 필살기는 장풍(projectile)으로 처리하므로 근접 판정 제외
            if attacker.state == 'attack_c' and attacker.character == 'Fighter':
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
            if attacker.character == 'Boxer' and attacker.state == 'attack_c':
                hit_range = 130  # 어퍼컷 돌진 범위
            if dist_x >= hit_range or dist_y >= 100:
                continue

            facing_defender = (
                (attacker.facing == 'right' and defender.x > attacker.x) or
                (attacker.facing == 'left' and defender.x < attacker.x)
            )
            if not facing_defender:
                continue

            dmg = attacker.damage[attacker.state]
            knockback = attacker.knockback[attacker.state]

            # 방어 판정: 블록 상태 + 공격자가 방어자의 정면 방향에 있는 경우
            is_blocking = (
                defender.state == 'block' and
                (
                    (defender.facing == 'right' and attacker.x > defender.x) or
                    (defender.facing == 'left'  and attacker.x < defender.x)
                )
            )
            if is_blocking and attacker.state != 'attack_c':
                # 필살기 제외 — 가드 시 피해 0, 약간의 넉백만
                kb_dir = 1 if attacker.facing == 'right' else -1
                defender.vx = kb_dir * 1
                attacker.hit_landed = True
                continue  # 데미지·hit 상태 없음

            defender.hp = max(0, defender.hp - dmg)
            kb_dir = 1 if attacker.facing == 'right' else -1
            # Boxer 슈퍼 어퍼컷: 수직으로 날려버림
            if attacker.character == 'Boxer' and attacker.state == 'attack_c':
                defender.vx = kb_dir * 2
                defender.vy = -30
            else:
                defender.vx = kb_dir * knockback
                defender.vy = -4
            defender.is_grounded = False
            defender.state = 'hit'
            defender.state_frames = 0
            attacker.hit_landed = True

    def _update_projectiles(self):
        for proj in self.projectiles[:]:
            proj.update()
            if not proj.active:
                self.projectiles.remove(proj)
                continue
            for p in self.players:
                if p.player_num == proj.owner_num:
                    continue
                if p.state == 'dead' or p.invincible_frames > 0:
                    continue
                if abs(proj.x - p.x) < 28 and abs(proj.y - p.y) < 60:
                    p.hp = max(0, p.hp - proj.damage)
                    kb_dir = 1 if proj.vx > 0 else -1
                    p.vx = kb_dir * 7
                    p.vy = -3
                    p.is_grounded = False
                    p.state = 'hit'
                    p.state_frames = 0
                    proj.active = False
                    self.projectiles.remove(proj)
                    break

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
            'projectiles': [p.to_dict() for p in self.projectiles],
            'timer': round(self.timer, 1),
            'round': self.round_num,
            'scores': self.scores[:],
        }
