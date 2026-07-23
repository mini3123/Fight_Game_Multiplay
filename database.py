import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'fighting_game.db')


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT UNIQUE NOT NULL,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                points INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # 기존 DB 마이그레이션: points 컬럼 없으면 추가
        try:
            conn.execute('ALTER TABLE players ADD COLUMN points INTEGER DEFAULT 0')
        except Exception:
            pass
        # 점수 기능 추가 전 게임 소급 적용: wins>0인데 points=0이면 wins*3 지급
        conn.execute(
            'UPDATE players SET points = wins * 3 WHERE points = 0 AND wins > 0'
        )
        conn.execute('''
            CREATE TABLE IF NOT EXISTS match_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player1 TEXT NOT NULL,
                player2 TEXT NOT NULL,
                winner TEXT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()


def ensure_player(conn, nickname):
    conn.execute(
        'INSERT OR IGNORE INTO players (nickname) VALUES (?)',
        (nickname,)
    )


def save_result(winner_nick, loser_nick):
    with get_conn() as conn:
        ensure_player(conn, winner_nick)
        ensure_player(conn, loser_nick)
        conn.execute(
            'UPDATE players SET wins = wins + 1, points = points + 3 WHERE nickname = ?',
            (winner_nick,)
        )
        conn.execute(
            'UPDATE players SET losses = losses + 1, points = MAX(0, points - 1) WHERE nickname = ?',
            (loser_nick,)
        )
        conn.execute(
            'INSERT INTO match_history (player1, player2, winner) VALUES (?, ?, ?)',
            (winner_nick, loser_nick, winner_nick)
        )
        conn.commit()


def get_ranking():
    with get_conn() as conn:
        rows = conn.execute('''
            SELECT nickname, wins, losses, points,
                   ROUND(wins * 100.0 / (wins + losses), 1) AS win_rate
            FROM players
            WHERE (wins + losses) > 0
            ORDER BY points DESC, wins DESC
            LIMIT 10
        ''').fetchall()
    return [dict(r) for r in rows]


def get_recent_matches(nickname, limit=10):
    with get_conn() as conn:
        rows = conn.execute('''
            SELECT player1, player2, winner, played_at
            FROM match_history
            WHERE player1 = ? OR player2 = ?
            ORDER BY played_at DESC
            LIMIT ?
        ''', (nickname, nickname, limit)).fetchall()
    return [dict(r) for r in rows]
