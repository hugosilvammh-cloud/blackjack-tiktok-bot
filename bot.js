import http from 'http';
import {
  TikTokLiveConnection,
  WebcastEvent
} from 'tiktok-live-connector';

// =====================================================
// RENDER
// =====================================================

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Blackjack TikTok Bot online!');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP ativo na porta ${PORT}`);
});

// =====================================================
// CONFIGURAÇÃO
// =====================================================

const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME não configurado.');
  process.exit(1);
}

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

// =====================================================
// TIKTOK
// =====================================================

const connection = new TikTokLiveConnection(USERNAME, {
  processInitialData: false
});

// =====================================================
// JOGADORES
// =====================================================

const players = new Map();

let currentPlayer = null;

// =====================================================
// CONECTAR
// =====================================================

async function connectToLive() {

  try {

    const state = await connection.connect();

    console.log('');
    console.log('🟢 CONECTADO À TIKTOK LIVE!');
    console.log(`🎥 Room ID: ${state.roomId}`);
    console.log('');

  } catch (error) {

    console.error('❌ Não foi possível conectar à LIVE:');

    console.error(error);

    console.log('🔄 Tentando novamente em 30 segundos...');

    setTimeout(connectToLive, 30000);
  }
}

// =====================================================
// CHAT
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {

  console.log('📨 EVENTO DE CHAT RECEBIDO!');

  console.log(
    '📦 Dados:',
    JSON.stringify(data, null, 2)
  );

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    null;

  const comment =
    typeof data?.comment === 'string'
      ? data.comment
      : null;

  if (!username || comment === null) {

    console.log(
      '⚠️ Evento recebido, mas usuário/comentário não encontrado.'
    );

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
  // JOGADOR
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

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    null;

  if (!username) {
    return;
  }

  console.log(`👤 @${username} entrou na LIVE.`);
});

// =====================================================
// GIFT
// =====================================================

connection.on(WebcastEvent.GIFT, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    null;

  if (!username) {
    return;
  }

  console.log(`🎁 @${username} enviou um presente.`);
});

// =====================================================
// LIKE
// =====================================================

connection.on(WebcastEvent.LIKE, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    null;

  if (!username) {
    return;
  }

  console.log(`❤️ @${username} curtiu a LIVE.`);
});

// =====================================================
// INICIAR
// =====================================================

connectToLive();
