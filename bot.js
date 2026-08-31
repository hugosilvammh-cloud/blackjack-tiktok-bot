import http from 'http';
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
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
// CONEXÃO TIKTOK
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
// FUNÇÃO PARA PEGAR USUÁRIO
// =====================================================

function getUsername(data) {
  return data?.user?.uniqueId || null;
}

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

    console.error('❌ Não foi possível conectar à LIVE.');

    if (error?.name === 'UserOfflineError') {
      console.log('⏳ A conta não está ao vivo no momento.');
    } else {
      console.error(error);
    }

    console.log('🔄 Nova tentativa em 30 segundos...');

    setTimeout(connectToLive, 30000);
  }
}

// =====================================================
// EVENTO: CONECTADO
// =====================================================

connection.on(ControlEvent.CONNECTED, () => {
  console.log('🔌 WebSocket TikTok conectado.');
});

// =====================================================
// EVENTO: DESCONECTADO
// =====================================================

connection.on(ControlEvent.DISCONNECTED, () => {
  console.log('🔴 TikTok LIVE desconectada.');
});

// =====================================================
// EVENTO: ERRO
// =====================================================

connection.on(ControlEvent.ERROR, ({ info, exception }) => {

  console.error('❌ Erro do TikTok:');

  if (info) {
    console.error('Info:', info);
  }

  if (exception) {
    console.error(exception);
  }
});

// =====================================================
// CHAT
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {

  const username = getUsername(data);
  const comment = data?.comment;

  // Ignora eventos incompletos
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
      username: username,
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
  // VERIFICAR SE ESTÁ NA MESA
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
        `⏳ @${username} mandou 1, mas não é a vez dele.`
      );

      return;
    }

    console.log(`🃏 @${username} → HIT`);

    // FUTURA CONEXÃO COM O BLACKJACK LIVE

    return;
  }

  // ===================================================
  // 2 = STAND
  // ===================================================

  if (message === '2') {

    if (currentPlayer !== username) {

      console.log(
        `⏳ @${username} mandou 2, mas não é a vez dele.`
      );

      return;
    }

    console.log(`🛑 @${username} → STAND`);

    // FUTURA CONEXÃO COM O BLACKJACK LIVE

    return;
  }
});

// =====================================================
// NOVO MEMBRO
// =====================================================

connection.on(WebcastEvent.MEMBER, (data) => {

  const username = getUsername(data);

  // Não mostrar @undefined/@unknown
  if (!username) {
    return;
  }

  console.log(`👤 @${username} entrou na LIVE.`);
});

// =====================================================
// LIKE
// =====================================================

connection.on(WebcastEvent.LIKE, (data) => {

  const username = getUsername(data);

  if (!username) {
    return;
  }

  console.log(
    `❤️ @${username} curtiu!`
  );
});

// =====================================================
// PRESENTE
// =====================================================

connection.on(WebcastEvent.GIFT, (data) => {

  const username = getUsername(data);

  if (!username) {
    return;
  }

  const giftId = data?.giftId ?? 'desconhecido';

  console.log(
    `🎁 @${username} enviou presente ${giftId}`
  );
});

// =====================================================
// FOLLOW
// =====================================================

connection.on(WebcastEvent.FOLLOW, (data) => {

  const username = getUsername(data);

  if (!username) {
    return;
  }

  console.log(`➕ @${username} seguiu a LIVE.`);
});

// =====================================================
// SHARE
// =====================================================

connection.on(WebcastEvent.SHARE, (data) => {

  const username = getUsername(data);

  if (!username) {
    return;
  }

  console.log(`📤 @${username} compartilhou a LIVE.`);
});

// =====================================================
// FINAL DA LIVE
// =====================================================

connection.on(WebcastEvent.STREAM_END, () => {

  console.log('');
  console.log('🔴 A LIVE terminou.');
  console.log('⏳ Aguardando uma nova LIVE...');
  console.log('');

});

// =====================================================
// INICIAR
// =====================================================

connectToLive();
