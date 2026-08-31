import http from 'http';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

// =====================================================
// SERVIDOR HTTP — NECESSÁRIO PARA O RENDER FREE
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
// CONFIGURAÇÃO DO TIKTOK
// =====================================================

const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ A variável TIKTOK_USERNAME não foi configurada.');
  process.exit(1);
}

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

// =====================================================
// CONEXÃO COM A TIKTOK LIVE
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
// CONECTAR À LIVE
// =====================================================

async function connectToLive() {
  try {
    const state = await connection.connect();

    console.log('🟢 Conectado à TikTok LIVE!');
    console.log(`🎥 Room ID: ${state.roomId}`);

  } catch (error) {
    console.error('❌ Não foi possível conectar à LIVE:');
    console.error(error);

    // Tenta novamente depois de 30 segundos
    console.log('🔄 Tentando novamente em 30 segundos...');

    setTimeout(connectToLive, 30000);
  }
}

connectToLive();

// =====================================================
// CHAT
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    data?.uniqueId ||
    'unknown';

  const message =
    typeof data?.comment === 'string'
      ? data.comment.trim().toUpperCase()
      : '';

  console.log(`💬 @${username}: ${message}`);

  // ===================================================
  // BLACKJACK — ENTRAR NA MESA
  // ===================================================

  if (message === 'BLACKJACK') {

    if (!players.has(username)) {

      players.set(username, {
        username: username,
        lives: 3,
        playing: true
      });

      console.log(`🪑 @${username} entrou na mesa!`);
      console.log(`❤️ Vidas: 3`);

    } else {

      console.log(`ℹ️ @${username} já está na mesa.`);

    }

    return;
  }

  // ===================================================
  // IGNORAR COMANDOS DE QUEM NÃO ESTÁ NA MESA
  // ===================================================

  if (!players.has(username)) {
    return;
  }

  const player = players.get(username);

  if (!player.playing) {
    return;
  }

  // ===================================================
  // 1 — HIT / PEDIR CARTA
  // ===================================================

  if (message === '1') {

    if (currentPlayer !== username) {

      console.log(
        `⏳ @${username} tentou jogar, mas não é a vez dele.`
      );

      return;
    }

    console.log(`🃏 @${username} pediu carta!`);

    // FUTURA CONEXÃO COM O BLACKJACK LIVE
    return;
  }

  // ===================================================
  // 2 — STAND / PARAR
  // ===================================================

  if (message === '2') {

    if (currentPlayer !== username) {

      console.log(
        `⏳ @${username} tentou parar, mas não é a vez dele.`
      );

      return;
    }

    console.log(`🛑 @${username} parou!`);

    // FUTURA CONEXÃO COM O BLACKJACK LIVE
    return;
  }
});

// =====================================================
// MEMBRO / ENTRADA NA LIVE
// =====================================================

connection.on(WebcastEvent.MEMBER, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    data?.uniqueId ||
    'unknown';

  console.log(`👤 @${username} entrou na LIVE.`);
});

// =====================================================
// PRESENTES
// =====================================================

connection.on(WebcastEvent.GIFT, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    data?.uniqueId ||
    'unknown';

  console.log(`🎁 @${username} enviou um presente.`);
});

// =====================================================
// LIKES
// =====================================================

connection.on(WebcastEvent.LIKE, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.unique_id ||
    data?.uniqueId ||
    'unknown';

  console.log(`❤️ @${username} curtiu a LIVE.`);
});

// =====================================================
// DESCONEXÃO
// =====================================================

connection.on(WebcastEvent.DISCONNECT, () => {

  console.log('🔴 Bot desconectado da TikTok LIVE.');

});

// =====================================================
// ERROS
// =====================================================

connection.on('error', (error) => {

  console.error('❌ Erro na conexão TikTok:');
  console.error(error);

});
