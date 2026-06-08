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

let serverState  = null;
let gameState    = null;
let roundOverTimer = null;
let gameBg       = 'city';
const isSpectator = sessionStorage.getItem('spectator') === 'true';

function lerp(a, b, t) { return a + (b - a) * t; }

function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

// rAF 기반 60fps 렌더 루프 (서버 30fps 패킷 → 부드러운 보간)
function rafLoop() {
  if (serverState) {
    if (!gameState) {
      gameState = deepCopy(serverState);
    } else {
      // 위치만 보간, 나머지 상태는 즉시 반영
      serverState.players.forEach((sp, i) => {
        const dp = gameState.players[i];
        if (!dp) return;
        dp.x = lerp(dp.x, sp.x, 0.4);
        dp.y = lerp(dp.y, sp.y, 0.4);
        dp.state    = sp.state;
        dp.facing   = sp.facing;
        dp.hp       = sp.hp;
        dp.max_hp   = sp.max_hp;
        dp.anim_tick = sp.anim_tick;
        dp.color    = sp.color;
        dp.character = sp.character;
        dp.nickname = sp.nickname;
        dp.special_cooldown      = sp.special_cooldown;
        dp.special_cooldown_time = sp.special_cooldown_time;
      });
      gameState.timer       = serverState.timer;
      gameState.round       = serverState.round;
      gameState.scores      = serverState.scores;
      gameState.projectiles = serverState.projectiles;
    }
    render();
  }
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);

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

// 관전자는 입력 전송 안 함
if (!isSpectator) {
  setInterval(() => socket.emit('player_input', { keys }), 1000 / 20);
}

// ============================================================
// Chat
// ============================================================

const chatMsgs = document.getElementById('chat-msgs');
const chatIn   = document.getElementById('chat-in');
const chatBtn  = document.getElementById('chat-btn');

const PLAYER_COLORS = ['#4FC3F7', '#66BB6A', '#EF5350'];

function appendChat(line, cls) {
  const el = document.createElement('div');
  el.className = 'chat-line' + (cls ? ' ' + cls : '');
  el.innerHTML = line;
  chatMsgs.appendChild(el);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  // 메시지 최대 150줄 유지
  while (chatMsgs.children.length > 150) chatMsgs.removeChild(chatMsgs.firstChild);
}

function sendChat() {
  const msg = chatIn.value.trim();
  if (!msg) return;
  socket.emit('chat_message', { msg });
  chatIn.value = '';
}

if (isSpectator) {
  chatIn.placeholder = '관전자는 채팅에 참여할 수 없습니다';
  chatIn.disabled = true;
  chatBtn.disabled = true;
}

chatBtn.addEventListener('click', sendChat);

chatIn.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  if (e.key === 'Escape') { chatIn.blur(); }
  // 채팅 입력 중엔 게임 키 차단
  e.stopPropagation();
});

// Enter 키로 채팅창 포커스 (게임 키 처리 전에 확인)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement !== chatIn) {
    e.preventDefault();
    chatIn.focus();
  }
}, true);

socket.on('chat_message', data => {
  const color = PLAYER_COLORS[(data.player_num - 1)] || '#aaa';
  const nick  = data.nickname.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const msg   = data.msg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  appendChat(`<span style="color:${color};font-weight:700">${nick}</span>: ${msg}`);
});

// ============================================================
// Socket events
// ============================================================

socket.on('connect', () => {
  if (isSpectator) {
    socket.emit('spectate', { room_id: roomId });
  } else {
    socket.emit('reconnect_to_room', { room_id: roomId, player_num: myPlayerNum, nickname });
  }
});

socket.on('game_start', data => {
  myPlayerNum = data.player_num;
  gameBg = data.background || 'city';
  sessionStorage.setItem('player_num', myPlayerNum);
  hideOverlay();
  if (data.spectator) {
    // 관전 모드: 상단에 배지 표시
    const hint = document.getElementById('key-hint');
    if (hint) hint.textContent = `👁 관전 중 — ${data.p1_nick} vs ${data.p2_nick}`;
  }
});

socket.on('spec_error', data => {
  showOverlayFinal('관전 불가', data.msg || '게임이 이미 종료되었습니다.');
});

socket.on('game_state', data => {
  serverState = data;
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
  drawProjectiles();
  drawHUD();
  gameState.players.forEach(p => drawCharacter(ctx, p));
  drawSpecialCooldowns();
}

// ---- Background ----
function drawBackground() {
  switch (gameBg) {
    case 'desert': drawBgDesert(); break;
    case 'space':  drawBgSpace();  break;
    case 'ice':    drawBgIce();    break;
    default:       drawBgCity();   break;
  }
}

function floorLine(color, blur) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.shadowColor = color; ctx.shadowBlur = blur;
  ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBgCity() {
  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  g.addColorStop(0, '#0d0020'); g.addColorStop(1, '#1a0035');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, FLOOR_Y);
  ctx.fillStyle = '#120024'; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  floorLine('#b44aff', 12);
  ctx.strokeStyle = 'rgba(180,74,255,0.07)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = FLOOR_Y; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  drawGlow(200, 280, 100, 'rgba(100,0,255,0.07)');
  drawGlow(600, 280, 100, 'rgba(100,0,255,0.07)');
}

function drawBgDesert() {
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, '#180500'); sky.addColorStop(0.5, '#6b2f00'); sky.addColorStop(1, '#bf5800');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, FLOOR_Y);

  // 태양
  ctx.save();
  ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 50;
  const sunG = ctx.createRadialGradient(660, 70, 0, 660, 70, 48);
  sunG.addColorStop(0, '#fff4a0'); sunG.addColorStop(1, '#ff8800');
  ctx.fillStyle = sunG; ctx.beginPath(); ctx.arc(660, 70, 48, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 모래 언덕 실루엣
  ctx.fillStyle = 'rgba(120,55,5,0.5)';
  ctx.beginPath(); ctx.moveTo(0, FLOOR_Y);
  ctx.bezierCurveTo(100, FLOOR_Y - 70, 250, FLOOR_Y - 80, 400, FLOOR_Y - 30);
  ctx.bezierCurveTo(550, FLOOR_Y + 20, 680, FLOOR_Y - 55, 800, FLOOR_Y);
  ctx.closePath(); ctx.fill();

  const sand = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  sand.addColorStop(0, '#c87820'); sand.addColorStop(1, '#7a3f08');
  ctx.fillStyle = sand; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  floorLine('#e8a030', 8);

  ctx.strokeStyle = 'rgba(255,180,80,0.12)'; ctx.lineWidth = 1;
  for (let y = FLOOR_Y + 18; y < H; y += 18) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function drawBgSpace() {
  ctx.fillStyle = '#00000c'; ctx.fillRect(0, 0, W, FLOOR_Y);

  // 별
  ctx.fillStyle = '#ffffff';
  const stars = [[40,25],[90,12],[160,38],[220,8],[300,28],[380,14],[460,32],[530,7],[610,22],
                 [680,40],[740,16],[770,33],[55,55],[130,48],[210,60],[330,52],[450,58],[570,45],[700,60]];
  stars.forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, y % 5 < 2 ? 1.5 : 0.8, 0, Math.PI * 2); ctx.fill();
  });

  // 성운
  drawGlow(180, 140, 140, 'rgba(100,0,180,0.1)');
  drawGlow(580, 90, 110, 'rgba(0,60,200,0.09)');

  // 행성
  ctx.save(); ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 24;
  const pg = ctx.createRadialGradient(700, 60, 4, 700, 60, 52);
  pg.addColorStop(0, '#88aaff'); pg.addColorStop(0.6, '#3366cc'); pg.addColorStop(1, '#0a1a44');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(700, 60, 52, 0, Math.PI * 2); ctx.fill();
  // 행성 고리
  ctx.strokeStyle = 'rgba(180,200,255,0.35)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(700, 60, 72, 16, -0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#07070f'; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  floorLine('#3366cc', 10);
  ctx.strokeStyle = 'rgba(50,100,200,0.07)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x, H); ctx.stroke(); }
}

function drawBgIce() {
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  sky.addColorStop(0, '#001020'); sky.addColorStop(1, '#002848');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, FLOOR_Y);

  // 오로라
  drawGlow(400, 100, 200, 'rgba(0,200,160,0.07)');
  drawGlow(200, 80, 160, 'rgba(80,100,255,0.06)');

  // 고드름
  ctx.fillStyle = 'rgba(180,235,255,0.55)';
  [30, 80, 145, 210, 290, 370, 450, 530, 610, 690, 755].forEach(x => {
    const h = 25 + (x * 7 % 35);
    ctx.beginPath(); ctx.moveTo(x - 7, 0); ctx.lineTo(x + 7, 0); ctx.lineTo(x, h); ctx.closePath(); ctx.fill();
  });

  const iceG = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  iceG.addColorStop(0, '#b0e0f8'); iceG.addColorStop(1, '#2880b0');
  ctx.fillStyle = iceG; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  floorLine('#cceeff', 14);

  // 얼음 균열
  ctx.strokeStyle = 'rgba(200,240,255,0.22)'; ctx.lineWidth = 1;
  [[60, FLOOR_Y+6, 140, FLOOR_Y+22], [220, FLOOR_Y+4, 300, FLOOR_Y+18],
   [400, FLOOR_Y+8, 520, FLOOR_Y+26], [590, FLOOR_Y+5, 660, FLOOR_Y+19],
   [710, FLOOR_Y+7, 780, FLOOR_Y+20]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });

  drawGlow(400, 250, 160, 'rgba(80,180,255,0.05)');
}

function drawProjectiles() {
  const projs = gameState.projectiles;
  if (!projs || !projs.length) return;
  projs.forEach(proj => {
    const [r, g, b] = hexRgb(proj.color);
    ctx.save();
    ctx.shadowColor = proj.color;
    ctx.shadowBlur = 22;
    // 외곽 링 3개
    for (let i = 3; i >= 1; i--) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.25 * i})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 7 + i * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 코어 그라디언트
    const grad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, 13);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.35, proj.color);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
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
  const pct = hp / (player.max_hp || 100);

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
  ctx.fillText(`${hp}/${player.max_hp || 100}`, reversed ? x + width - 4 : x + 4, barY + barH - 3);
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
    case 'attack_c': drawAttackC(ctx, x, y, color, tick, player.character); break;
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

function drawAttackC(ctx, x, y, color, tick, character) {
  if (character === 'Ninja')  { drawNinjaSpecial(ctx, x, y, color, tick); return; }
  if (character === 'Boxer')  { drawBoxerSpecial(ctx, x, y, color, tick); return; }
  drawFighterSpecial(ctx, x, y, color, tick); // Fighter 장풍 포즈
}

// Fighter: 두 손 모아 기 모으는 포즈 (장풍은 서버에서 projectile로 처리)
function drawFighterSpecial(ctx, x, y, color, tick) {
  const [r, g, b] = hexRgb(color);
  const pulse = Math.sin(tick * 0.35) * 3;

  limb(ctx, x - 6, y - 20, x - 10, y, color, 8);
  limb(ctx, x + 6, y - 20, x + 10, y, color, 8);
  body(ctx, x, y - 52, 32, 22, color);
  // 두 팔 앞으로 뻗어 합장
  limb(ctx, x - 11, y - 44, x + 26, y - 46, color, 8);
  limb(ctx, x + 11, y - 44, x + 26, y - 42, color, 8);
  // 손끝 에너지
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 18 + pulse;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x + 30, y - 44, 5 + pulse * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 30, y - 44, 9 + pulse, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 링 이펙트
  for (let i = 1; i <= 2; i++) {
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.5 - i * 0.15})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + 30, y - 44, 9 + pulse + i * 9, 0, Math.PI * 2); ctx.stroke();
  }
  head(ctx, x, y - 64, 13, color);
}

// Ninja: 잔상 남기며 순간이동 포즈
function drawNinjaSpecial(ctx, x, y, color, tick) {
  const [r, g, b] = hexRgb(color);
  // 잔상 2개
  for (let i = 1; i <= 2; i++) {
    ctx.save();
    ctx.globalAlpha = 0.18 * (3 - i);
    drawIdle(ctx, x - i * 22, y, color, tick);
    ctx.restore();
  }
  // 속도선
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 18 - i * 14, y - 20 - i * 8);
    ctx.lineTo(x - 36 - i * 14, y - 20 - i * 8);
    ctx.stroke();
  }
  // 본체 — 공격 자세
  limb(ctx, x - 5, y - 18, x - 8, y, color, 8);
  limb(ctx, x + 5, y - 18, x + 8, y, color, 8);
  body(ctx, x, y - 50, 28, 20, color);
  limb(ctx, x - 10, y - 44, x - 18, y - 52, color, 7);
  limb(ctx, x + 10, y - 44, x + 34, y - 40, color, 8);
  // 주먹 이펙트
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 36, y - 40, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  head(ctx, x + 3, y - 62, 12, color);
}

// Boxer: 점프 슈퍼 어퍼컷
function drawBoxerSpecial(ctx, x, y, color, tick) {
  const [r, g, b] = hexRgb(color);
  const lift = Math.max(0, Math.sin(tick * 0.18) * 10);
  // 다리 접음
  limb(ctx, x - 6, y - 22 - lift, x - 18, y - 12 - lift, color, 8);
  limb(ctx, x + 6, y - 22 - lift, x + 18, y - 12 - lift, color, 8);
  // 몸
  ctx.save();
  ctx.translate(x, y - 44 - lift); ctx.rotate(0.18);
  body(ctx, 0, -14, 32, 22, color);
  ctx.restore();
  // 어퍼컷 팔 (위로 뻗음)
  limb(ctx, x + 10, y - 48 - lift, x + 16, y - 78 - lift, color, 10);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 18, y - 80 - lift, 9, 0, Math.PI * 2); ctx.fill();
  // 주먹 임팩트 라인
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 22;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`; ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + 18 + Math.cos(a) * 9, y - 80 - lift + Math.sin(a) * 9);
    ctx.lineTo(x + 18 + Math.cos(a) * 20, y - 80 - lift + Math.sin(a) * 20);
    ctx.stroke();
  }
  ctx.restore();
  // 반대 팔 (밸런스)
  limb(ctx, x - 10, y - 48 - lift, x - 22, y - 40 - lift, color, 7);
  head(ctx, x, y - 66 - lift, 13, color);
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
