import http from 'http';
import {
  TikTokLiveConnection,
  ControlEvent,
  WebcastEvent
} from 'tiktok-live-connector';

// =====================================================
// RENDER HTTP SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Blackjack TikTok Bot online!');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP ativo na porta ${PORT}`);
});

// =====================================================
// CONFIGURAÇÃO
// =====================================================

const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME não foi configurado.');
  process.exit(1);
}

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

// =====================================================
// CONEXÃO
// =====================================================

const connection = new TikTokLiveConnection(USERNAME);

// =====================================================
// JOGADORES
// =====================================================

const players = new Map();

let currentPlayer = null;

// =====================================================
// CONECTADO
// =====================================================

connection.on(ControlEvent.CONNECTED, (state) => {
  console.log('');
  console.log('🟢 CONECTADO À TIKTOK LIVE!');
  console.log(`🎥 Room ID: ${state?.roomId || 'desconhecido'}`);
  console.log('');
});

// =====================================================
// WEBSOCKET CONECTADO
// =====================================================

connection.on(ControlEvent.WEBSOCKET_CONNECTED, () => {
  console.log('🔌 WebSocket TikTok conectado.');
});

// =====================================================
// DESCONECTADO
// =====================================================

connection.on(ControlEvent.DISCONNECTED, () => {
  console.log('🔴 TikTok LIVE desconectada.');
});

// =====================================================
// ERRO
// =====================================================

connection.on(ControlEvent.ERROR, (error) => {
  console.error('❌ Erro do TikTok:');
  console.error(error);
});

// =====================================================
// CHAT
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {

  const username = data?.user?.uniqueId;
  const comment = data?.comment;

  // Ignorar evento incompleto
  if (!username || typeof comment !== 'string') {
    return;
  }

  const message = comment.trim().toUpperCase();

  console.log(`💬 @${username}: ${message}`);

  // ===================================================
  // BLACKJACK
  // ===================================================

  if (message === 'BLACKJACK') {

    if (players.has(username)) {
      console.log(`ℹ️ @${username} já está na mesa.`);
      return;
    }

    players.set(username, {
      username,
      lives: 3,
      playing: true
    });

    console.log('');
    console.log('🪑 NOVO JOGADOR');
    console.log(`👤 @${username}`);
    console.log('❤️❤️❤️ 3 vidas');
    console.log('');

    return;
  }

  // ===================================================
  // VERIFICAR JOGADOR
  // ===================================================

  if (!players.has(username)) {
    return;
  }

  const player = players.get(username);

  if (!player.playing) {
    return;
  }

  // ===================================================
  // 1 = HIT
  // ===================================================

  if (message === '1') {

    if (currentPlayer !== username) {
      console.log(
        `⏳ @${username} enviou 1, mas não é a vez dele.`
      );
      return;
    }

    console.log(`🃏 @${username} → HIT`);

    return;
  }

  // ===================================================
  // 2 = STAND
  // ===================================================

  if (message === '2') {

    if (currentPlayer !== username) {
      console.log(
        `⏳ @${username} enviou 2, mas não é a vez dele.`
      );
      return;
    }

    console.log(`🛑 @${username} → STAND`);

    return;
  }
});

// =====================================================
// MEMBER
// =====================================================

connection.on(WebcastEvent.MEMBER, (data) => {

  const username = data?.user?.uniqueId;

  if (!username) {
    return;
  }

  console.log(`👤 @${username} entrou na LIVE.`);
});

// =====================================================
// LIKE
// =====================================================

connection.on(WebcastEvent.LIKE, (data) => {

  const username = data?.user?.uniqueId;

  if (!username) {
    return;
  }

  console.log(`❤️ @${username} curtiu a LIVE.`);
});

// =====================================================
// FOLLOW
// =====================================================

connection.on(WebcastEvent.FOLLOW, (data) => {

  const username = data?.user?.uniqueId;

  if (!username) {
    return;
  }

  console.log(`➕ @${username} seguiu a LIVE.`);
});

// =====================================================
// SHARE
// =====================================================

connection.on(WebcastEvent.SHARE, (data) => {

  const username = data?.user?.uniqueId;

  if (!username) {
    return;
  }

  console.log(`📤 @${username} compartilhou a LIVE.`);
});

// =====================================================
// GIFT
// =====================================================

connection.on(WebcastEvent.GIFT, (data) => {

  const username = data?.user?.uniqueId;

  if (!username) {
    return;
  }

  console.log(`🎁 @${username} enviou um presente.`);
});

// =====================================================
// STREAM END
// =====================================================

connection.on(WebcastEvent.STREAM_END, () => {
  console.log('');
  console.log('🔴 A LIVE terminou.');
  console.log('');
});

// =====================================================
// CONECTAR
// =====================================================

async function start() {

  try {

    const state = await connection.connect();

    console.log('');
    console.log('🟢 CONEXÃO ESTABELECIDA!');
    console.log(`🎥 Room ID: ${state.roomId}`);
    console.log('');

  } catch (error) {

    console.error('❌ Falha ao conectar à LIVE:');
    console.error(error);

    console.log('🔄 Tentando novamente em 30 segundos...');

    setTimeout(start, 30000);
  }
}

start();
