// ============================================================
// FIGHT ZONE - game.js
// Canvas rendering + input handling + Socket.IO client
// ============================================================

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const W = 800, H = 500, FLOOR_Y = 400;

const socket = io();
const nickname  = sessionStorage.getItem('nickname')   || 'Player';
const roomId    = sessionStorage.getItem('room_id')    || '';
let myPlayerNum = parseInt(sessionStorage.getItem('player_num') || '1');

let gameState = null;
let roundOverTimer = null;

// --- Input ---
const keys = { left: false, right: false, jump: false, down: false, z: false, x: false, c: false };

document.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft')  { keys.left  = true; e.preventDefault(); }
  if (e.code === 'ArrowRight') { keys.right = true; e.preventDefault(); }
  if (e.code === 'Space')      { keys.jump  = true; e.preventDefault(); }
  if (e.code === 'ArrowDown')  { keys.down  = true; e.preventDefault(); }
  if (e.code === 'KeyZ')       keys.z = true;
  if (e.code === 'KeyX')       keys.x = true;
  if (e.code === 'KeyC')       keys.c = true;
});
document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft')  keys.left  = false;
  if (e.code === 'ArrowRight') keys.right = false;
  if (e.code === 'Space')      keys.jump  = false;
  if (e.code === 'ArrowDown')  keys.down  = false;
  if (e.code === 'KeyZ')       keys.z = false;
  if (e.code === 'KeyX')       keys.x = false;
  if (e.code === 'KeyC')       keys.c = false;
});

// Send input at 20 FPS
setInterval(() => socket.emit('player_input', { keys }), 1000 / 20);

// ============================================================
// Socket events
// ============================================================

socket.on('connect', () => {
  socket.emit('reconnect_to_room', { room_id: roomId, player_num: myPlayerNum, nickname });
});

socket.on('game_start', data => {
  myPlayerNum = data.player_num;
  sessionStorage.setItem('player_num', myPlayerNum);
  hideOverlay();
});

socket.on('game_state', data => {
  gameState = data;
  render();
});

socket.on('round_end', data => {
  if (data.draw) {
    showOverlayTemp('무승부', `라운드 ${data.round} — 시간 초과`, 2600);
  } else {
    const win = data.winner === myPlayerNum;
    showOverlayTemp(win ? 'ROUND WIN!' : 'ROUND LOSS',
      `스코어: ${data.scores[0]} - ${data.scores[1]}`, 2600);
  }
});

socket.on('round_start', () => hideOverlay());

socket.on('game_over', data => {
  const win = data.winner === myPlayerNum;
  showOverlayFinal(
    win ? '승리!' : '패배...',
    `${data.winner_nick} 승 | ${data.scores[0]} : ${data.scores[1]}`,
  );
});

socket.on('opponent_left', () => showOverlayFinal('상대방이 나갔습니다', '게임 종료'));
socket.on('error', () => {});

// ============================================================
// Overlay helpers
// ============================================================

function showOverlayTemp(title, sub, ms) {
  const ol = document.getElementById('overlay');
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent   = sub;
  document.getElementById('overlay-btn').style.display = 'none';
  ol.classList.remove('hidden');
  clearTimeout(roundOverTimer);
  roundOverTimer = setTimeout(hideOverlay, ms);
}

function showOverlayFinal(title, sub) {
  clearTimeout(roundOverTimer);
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent   = sub;
  document.getElementById('overlay-btn').style.display = 'inline-block';
  document.getElementById('overlay').classList.remove('hidden');
}

function hideOverlay() { document.getElementById('overlay').classList.add('hidden'); }

function goLobby() { window.location.href = '/'; }

// ============================================================
// Rendering
// ============================================================

function render() {
  if (!gameState) return;
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawHUD();
  gameState.players.forEach(p => drawCharacter(ctx, p));
  drawSpecialCooldowns();
}

// ---- Background ----
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  grad.addColorStop(0, '#0d0020');
  grad.addColorStop(1, '#1a0035');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, FLOOR_Y);

  ctx.fillStyle = '#120024';
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  ctx.strokeStyle = '#b44aff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#b44aff';
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(180,74,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = FLOOR_Y; y < H; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  drawGlow(200, 280, 100, 'rgba(100,0,255,0.07)');
  drawGlow(600, 280, 100, 'rgba(100,0,255,0.07)');
}

function drawGlow(x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// ---- HUD ----
function drawHUD() {
  const [p1, p2] = gameState.players;
  drawHpBar(20, 16, 240, p1, false);
  drawHpBar(W - 260, 16, 240, p2, true);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px "Segoe UI", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(gameState.timer), W / 2, 42);

  drawRoundPips(W / 2 - 36, 52, gameState.scores[0]);
  drawRoundPips(W / 2 + 10, 52, gameState.scores[1]);

  ctx.font = '11px "Segoe UI"'; ctx.fillStyle = '#888';
  ctx.fillText(`ROUND ${gameState.round}`, W / 2, 78);
}

function drawHpBar(x, y, width, player, reversed) {
  const hp = Math.max(0, player.hp);
  const pct = hp / 100;

  ctx.font = 'bold 13px "Segoe UI"';
  ctx.fillStyle = '#ccc';
  ctx.textAlign = reversed ? 'right' : 'left';
  ctx.fillText(player.nickname, reversed ? x + width : x, y + 11);

  const barY = y + 16, barH = 14;
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(x, barY, width, barH);

  const fillW = width * pct;
  ctx.fillStyle = hp > 50 ? '#4caf50' : hp > 25 ? '#ff9800' : '#f44336';
  ctx.fillRect(reversed ? x + width - fillW : x, barY, fillW, barH);

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.strokeRect(x, barY, width, barH);

  ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff';
  ctx.textAlign = reversed ? 'right' : 'left';
  ctx.fillText(`${hp}`, reversed ? x + width - 4 : x + 4, barY + barH - 3);
}

function drawRoundPips(x, y, score) {
  for (let i = 0; i < 2; i++) {
    ctx.beginPath(); ctx.arc(x + i * 14, y + 6, 5, 0, Math.PI * 2);
    if (i < score) {
      ctx.fillStyle = '#b44aff'; ctx.shadowColor = '#b44aff'; ctx.shadowBlur = 8;
    } else {
      ctx.fillStyle = '#2a2a40'; ctx.shadowBlur = 0;
    }
    ctx.fill(); ctx.shadowBlur = 0;
  }
}

// ---- Special Cooldown Bars ----
function drawSpecialCooldowns() {
  const [p1, p2] = gameState.players;
  const barW = 120, barH = 8, y = H - 20;

  ctx.font = '10px "Segoe UI"'; ctx.fillStyle = '#555';
  ctx.textAlign = 'left'; ctx.fillText('C 필살기', 20, y - 4);
  drawCooldownBar(20, y, barW, barH, p1.special_cooldown, false);

  ctx.textAlign = 'right'; ctx.fillText('필살기 C', W - 20, y - 4);
  drawCooldownBar(W - 20 - barW, y, barW, barH, p2.special_cooldown, true);
}

function drawCooldownBar(x, y, w, h, remaining, reversed) {
  const pct = Math.max(0, Math.min(1, 1 - remaining / 10));
  ctx.fillStyle = '#1a1a2a'; ctx.fillRect(x, y, w, h);
  const fillW = w * pct;
  ctx.fillStyle = pct >= 1 ? '#4caf50' : '#b44aff';
  ctx.fillRect(reversed ? x + w - fillW : x, y, fillW, h);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  if (pct >= 1) {
    ctx.font = 'bold 9px "Segoe UI"'; ctx.fillStyle = '#4caf50';
    ctx.textAlign = reversed ? 'right' : 'left';
    ctx.fillText('READY', reversed ? x + w : x, y - 2);
  }
}

// ============================================================
// Character Drawing
// ============================================================

function drawCharacter(ctx, player) {
  ctx.save();
  const { color = '#4FC3F7', x, y, facing, state, anim_tick: tick = 0 } = player;

  if (facing === 'left') {
    ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0);
  }

  switch (state) {
    case 'idle':     drawIdle(ctx, x, y, color, tick); break;
    case 'walk':     drawWalk(ctx, x, y, color, tick); break;
    case 'jump':     drawJump(ctx, x, y, color); break;
    case 'attack_z': drawAttackZ(ctx, x, y, color); break;
    case 'attack_x': drawAttackX(ctx, x, y, color); break;
    case 'attack_c': drawAttackC(ctx, x, y, color, tick); break;
    case 'hit':      drawHit(ctx, x, y, color); break;
    case 'dead':     drawDead(ctx, x, y, color); break;
    case 'block':    drawBlock(ctx, x, y, color); break;
    default:         drawIdle(ctx, x, y, color, tick);
  }
  ctx.restore();

  // Nickname label (unaffected by flip)
  ctx.save();
  ctx.font = 'bold 11px "Segoe UI"'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  ctx.fillRect(x - 28, y - 82, 56, 14);
  ctx.fillStyle = player.color;
  ctx.fillText(player.nickname.substring(0, 8), x, y - 71);
  ctx.restore();
}

// ---- Body helpers ----
function limb(ctx, x1, y1, x2, y2, color, lw) {
  ctx.strokeStyle = color; ctx.lineWidth = lw || 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function body(ctx, cx, top, h, w, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(cx - w / 2, top, w, h, 4); ctx.fill();
}

function head(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx + 5, cy - 2, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 11, cy - 2, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx + 6, cy - 1, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 12, cy - 1, 2, 0, Math.PI * 2); ctx.fill();
}

// ---- State drawings ----
function drawIdle(ctx, x, y, color, tick) {
  const bob = Math.sin(tick * 0.1) * 2;
  const cy = y + bob;
  limb(ctx, x - 6, cy - 20, x - 10, cy, color, 8);
  limb(ctx, x + 6, cy - 20, x + 10, cy, color, 8);
  body(ctx, x, cy - 52, 32, 22, color);
  limb(ctx, x - 11, cy - 46, x - 20, cy - 30, color, 7);
  limb(ctx, x + 11, cy - 46, x + 20, cy - 30, color, 7);
  head(ctx, x, cy - 64, 13, color);
}

function drawWalk(ctx, x, y, color, tick) {
  const s = Math.sin(tick * 0.25) * 14;
  limb(ctx, x - 6, y - 20, x - 10 + s, y, color, 8);
  limb(ctx, x + 6, y - 20, x + 10 - s, y, color, 8);
  body(ctx, x, y - 52, 32, 22, color);
  limb(ctx, x - 11, y - 46, x - 20 - s * 0.6, y - 30, color, 7);
  limb(ctx, x + 11, y - 46, x + 20 + s * 0.6, y - 30, color, 7);
  head(ctx, x, y - 64, 13, color);
}

function drawJump(ctx, x, y, color) {
  limb(ctx, x - 6, y - 22, x - 18, y - 14, color, 8);
  limb(ctx, x + 6, y - 22, x + 18, y - 14, color, 8);
  ctx.save();
  ctx.translate(x, y - 42); ctx.rotate(-0.15);
  body(ctx, 0, -15, 30, 22, color);
  ctx.restore();
  limb(ctx, x - 11, y - 52, x - 26, y - 68, color, 7);
  limb(ctx, x + 11, y - 52, x + 26, y - 68, color, 7);
  head(ctx, x, y - 70, 13, color);
}

function drawAttackZ(ctx, x, y, color) {
  limb(ctx, x - 6, y - 20, x - 10, y, color, 8);
  limb(ctx, x + 6, y - 20, x + 10, y, color, 8);
  body(ctx, x, y - 52, 32, 22, color);
  limb(ctx, x - 11, y - 46, x - 14, y - 42, color, 7);
  limb(ctx, x + 11, y - 46, x + 38, y - 44, color, 7);

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 40, y - 44, 6, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,100,.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + 42, y - 44, 11, 0, Math.PI * 2); ctx.stroke();

  head(ctx, x, y - 64, 13, color);
}

function drawAttackX(ctx, x, y, color) {
  limb(ctx, x - 6, y - 20, x - 10, y, color, 8);
  limb(ctx, x + 6, y - 20, x + 42, y - 24, color, 9);

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 44, y - 24, 7, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(255,180,50,.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + 46, y - 24, 13, 0, Math.PI * 2); ctx.stroke();

  body(ctx, x, y - 52, 32, 22, color);
  limb(ctx, x - 11, y - 46, x - 24, y - 36, color, 7);
  limb(ctx, x + 11, y - 46, x + 18, y - 62, color, 7);
  head(ctx, x, y - 64, 13, color);
}

function drawAttackC(ctx, x, y, color, tick) {
  const lunge = 10;
  limb(ctx, x - 6, y - 20, x - 8, y, color, 8);
  limb(ctx, x + 6, y - 20, x + 14, y, color, 8);
  body(ctx, x + lunge, y - 52, 32, 22, color);
  limb(ctx, x + lunge - 11, y - 46, x + lunge - 16, y - 42, color, 7);
  limb(ctx, x + lunge + 11, y - 46, x + lunge + 44, y - 46, color, 7);

  const p = Math.sin(tick * 0.4) * 4;
  const [r, g, b] = hexRgb(color);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 20 + p;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + lunge + 58, y - 46, 10 + p, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  for (let i = 1; i <= 3; i++) {
    ctx.strokeStyle = `rgba(${r},${g},${b},${1 - i * 0.3})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + lunge + 58, y - 46, 10 + i * 10 + p, 0, Math.PI * 2); ctx.stroke();
  }
  head(ctx, x + lunge, y - 64, 13, color);
}

function drawHit(ctx, x, y, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(0.15);
  limb(ctx, -6, -20, -14, 0, color, 8);
  limb(ctx, 6, -20, 14, 0, color, 8);
  body(ctx, 0, -52, 32, 22, color);
  limb(ctx, -11, -46, -28, -34, color, 7);
  limb(ctx, 11, -46, 22, -58, color, 7);
  ctx.fillStyle = 'rgba(255,80,80,.3)';
  ctx.beginPath(); ctx.arc(0, -40, 32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  head(ctx, x - 6, y - 62, 13, color);
}

function drawBlock(ctx, x, y, color) {
  const [r, g, b] = hexRgb(color);

  // 다리 구부림 (크라우치)
  limb(ctx, x - 5, y - 14, x - 12, y, color, 8);
  limb(ctx, x + 5, y - 14, x + 12, y, color, 8);

  // 몸통 (낮게)
  body(ctx, x, y - 40, 24, 20, color);

  // 두 팔을 앞으로 X자로 교차 (가드 폼)
  limb(ctx, x - 10, y - 36, x + 22, y - 50, color, 8);
  limb(ctx, x + 10, y - 36, x + 20, y - 28, color, 8);

  // 머리 (숙인 자세)
  head(ctx, x, y - 52, 11, color);

  // 방패 글로우 (3겹 원형)
  const sx = x + 22, sy = y - 40;
  for (let i = 3; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(sx, sy, 14 + i * 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.06 * i})`;
    ctx.fill();
  }
  // 방패 테두리 (밝게)
  ctx.beginPath();
  ctx.arc(sx, sy, 18, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // GUARD 텍스트
  ctx.font = 'bold 9px "Segoe UI"';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText('GUARD', x + 10, y - 72);
}

function drawDead(ctx, x, y, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(Math.PI / 2);
  body(ctx, 0, -26, 22, 32, color);
  ctx.restore();

  limb(ctx, x - 20, y - 4, x + 24, y - 6, color, 8);
  limb(ctx, x - 16, y - 8, x - 20, y - 22, color, 7);
  limb(ctx, x + 18, y - 8, x + 22, y - 22, color, 7);

  // Head
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 28, y - 10, 12, 0, Math.PI * 2); ctx.fill();
  // X eyes
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const hx = x + 28, hy = y - 10;
  ctx.beginPath(); ctx.moveTo(hx - 5, hy - 6); ctx.lineTo(hx + 1, hy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + 1, hy - 6); ctx.lineTo(hx - 5, hy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + 5, hy - 6); ctx.lineTo(hx + 11, hy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + 11, hy - 6); ctx.lineTo(hx + 5, hy); ctx.stroke();
}

// ============================================================
// Utilities
// ============================================================

function hexRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [255, 255, 255];
}

// Initial canvas state
(function () {
  ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#555'; ctx.font = 'bold 20px "Segoe UI"';
  ctx.textAlign = 'center'; ctx.fillText('서버 연결 중...', W / 2, H / 2);
})();
