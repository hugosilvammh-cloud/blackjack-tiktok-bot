import http from 'http';
import {
  TikTokLiveConnection,
  WebcastEvent
} from 'tiktok-live-connector';

const PORT = process.env.PORT || 10000;
const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME não configurado.');
  process.exit(1);
}

// =====================================================
// SERVIDOR RENDER
// =====================================================

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Blackjack TikTok Bot online!');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP ativo na porta ${PORT}`);
});

// =====================================================
// TIKTOK
// =====================================================

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

const connection = new TikTokLiveConnection(USERNAME, {
  processInitialData: false
});

// =====================================================
// JOGADORES
// =====================================================

const players = new Map();

let currentPlayer = null;

// =====================================================
// FUNÇÃO PARA PROCURAR TEXTOS
// =====================================================

function findTextValues(obj, path = '', result = []) {

  if (!obj || typeof obj !== 'object') {
    return result;
  }

  for (const [key, value] of Object.entries(obj)) {

    const currentPath = path
      ? `${path}.${key}`
      : key;

    if (typeof value === 'string') {

      if (
        value.length > 0 &&
        value.length < 500 &&
        !value.startsWith('http') &&
        !value.includes('2026') &&
        !value.includes('1788')
      ) {

        result.push({
          path: currentPath,
          value
        });
      }

    } else if (
      value &&
      typeof value === 'object'
    ) {

      findTextValues(value, currentPath, result);
    }
  }

  return result;
}

// =====================================================
// CONEXÃO
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

    if (error?.name === 'UserOfflineError') {
      console.log(`⏳ @${USERNAME} não está ao vivo.`);
    } else {
      console.error(error);
    }

    console.log('🔄 Tentando novamente em 30 segundos...');

    setTimeout(connectToLive, 30000);
  }
}

// =====================================================
// CHAT
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {

  console.log('');
  console.log('📨 EVENTO DE CHAT RECEBIDO!');

  // ---------------------------------------------------
  // USUÁRIO
  // ---------------------------------------------------

  const user = data?.user;

  console.log(
    '👤 ID:',
    user?.id || 'não encontrado'
  );

  console.log(
    '👤 NICKNAME:',
    user?.nickname || 'não encontrado'
  );

  console.log(
    '👤 UNIQUE ID:',
    user?.uniqueId || 'não encontrado'
  );

  // ---------------------------------------------------
  // PROCURAR TEXTOS
  // ---------------------------------------------------

  const texts = findTextValues(data);

  console.log('🔎 TEXTOS ENCONTRADOS:');

  for (const item of texts.slice(0, 30)) {

    console.log(
      `   ${item.path} = "${item.value}"`
    );
  }

  // ---------------------------------------------------
  // TENTATIVAS DE EXTRAIR COMENTÁRIO
  // ---------------------------------------------------

  const possibleComment =
    data?.comment ??
    data?.content ??
    data?.text ??
    data?.message ??
    data?.common?.describe ??
    null;

  const username =
    user?.uniqueId ??
    user?.unique_id ??
    user?.nickname ??
    `user_${user?.id || 'unknown'}`;

  if (!possibleComment) {

    console.log(
      '⚠️ Texto não encontrado nos campos conhecidos.'
    );

    console.log(
      '👉 Os TEXTOS ENCONTRADOS acima mostram onde o comentário está.'
    );

    return;
  }

  const message = String(possibleComment)
    .trim()
    .toUpperCase();

  console.log(`💬 @${username}: ${message}`);

  // ===================================================
  // BLACKJACK
  // ===================================================

  if (message === 'BLACKJACK') {

    if (players.has(username)) {

      console.log(
        `ℹ️ @${username} já está na mesa.`
      );

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
  // HIT
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
  // STAND
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
// OUTROS EVENTOS
// =====================================================

connection.on(WebcastEvent.MEMBER, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    `user_${data?.user?.id || 'unknown'}`;

  console.log(`👤 @${username} entrou na LIVE.`);
});

connection.on(WebcastEvent.LIKE, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    `user_${data?.user?.id || 'unknown'}`;

  console.log(`❤️ @${username} curtiu a LIVE.`);
});

connection.on(WebcastEvent.FOLLOW, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    `user_${data?.user?.id || 'unknown'}`;

  console.log(`➕ @${username} seguiu a LIVE.`);
});

connection.on(WebcastEvent.SHARE, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    `user_${data?.user?.id || 'unknown'}`;

  console.log(`📤 @${username} compartilhou a LIVE.`);
});

connection.on(WebcastEvent.GIFT, (data) => {

  const username =
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    `user_${data?.user?.id || 'unknown'}`;

  console.log(`🎁 @${username} enviou um presente.`);
});

connection.on(WebcastEvent.STREAM_END, () => {

  console.log('');
  console.log('🔴 A LIVE terminou.');
  console.log('');

});

// =====================================================
// INICIAR
// =====================================================

connectToLive();
