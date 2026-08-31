const { TikTokLiveConnection, ControlEvent } = require('tiktok-live-connector');

const USERNAME = process.env.TIKTOK_USERNAME || 'SEU_USUARIO';

const connection = new TikTokLiveConnection(USERNAME);

const players = new Map();

let currentPlayer = null;

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

connection.connect()
  .then(() => {
    console.log('🟢 Conectado à TikTok LIVE!');
  })
  .catch((err) => {
    console.error('❌ Não foi possível conectar à LIVE:', err);
  });

connection.on('chat', (data) => {
  const username = data.uniqueId;
  const message = data.comment.trim().toUpperCase();

  console.log(`💬 @${username}: ${message}`);

  // BLACKJACK = entrar na mesa
  if (message === 'BLACKJACK') {
    if (!players.has(username)) {
      players.set(username, {
        username,
        lives: 3,
        playing: true
      });

      console.log(`🪑 @${username} entrou na mesa!`);
    } else {
      console.log(`ℹ️ @${username} já está na mesa.`);
    }

    return;
  }

  // Se não estiver jogando, ignora 1 e 2
  if (!players.has(username)) {
    return;
  }

  // HIT
  if (message === '1') {
    if (currentPlayer !== username) {
      console.log(`⏳ Não é a vez de @${username}.`);
      return;
    }

    console.log(`🃏 @${username} pediu carta!`);

    // Aqui vamos conectar ao Blackjack Live
    return;
  }

  // STAND
  if (message === '2') {
    if (currentPlayer !== username) {
      console.log(`⏳ Não é a vez de @${username}.`);
      return;
    }

    console.log(`🛑 @${username} parou!`);

    // Aqui vamos conectar ao Blackjack Live
    return;
  }
});

connection.on('member', (data) => {
  console.log(`👤 Novo membro: @${data.uniqueId}`);
});

connection.on('like', (data) => {
  console.log(`❤️ @${data.uniqueId} curtiu a LIVE!`);
});

connection.on('gift', (data) => {
  console.log(`🎁 @${data.uniqueId} enviou um presente!`);
});

connection.on('disconnected', () => {
  console.log('🔴 Bot desconectado da TikTok LIVE.');
});

connection.on('error', (err) => {
  console.error('❌ Erro:', err);
});
