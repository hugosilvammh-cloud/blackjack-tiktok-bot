import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME não foi configurado.');
  process.exit(1);
}

console.log('🤖 Blackjack TikTok Bot iniciando...');
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

const connection = new TikTokLiveConnection(USERNAME, {
  processInitialData: false
});

const players = new Map();

let currentPlayer = null;

// CONECTAR
connection.connect()
  .then((state) => {
    console.log('🟢 Conectado à TikTok LIVE!');
    console.log(`🎥 Room ID: ${state.roomId}`);
  })
  .catch((err) => {
    console.error('❌ Não foi possível conectar à LIVE:');
    console.error(err);
  });

// CHAT
connection.on(WebcastEvent.CHAT, (data) => {
  const username = data.user.uniqueId;
  const message = data.comment.trim().toUpperCase();

  console.log(`💬 @${username}: ${message}`);

  // BLACKJACK = ENTRAR
  if (message === 'BLACKJACK') {

    if (!players.has(username)) {
      players.set(username, {
        username: username,
        lives: 3,
        playing: true
      });

      console.log(`🪑 @${username} entrou na mesa!`);
    } else {
      console.log(`ℹ️ @${username} já está na mesa.`);
    }

    return;
  }

  // IGNORA SE NÃO ESTIVER NA MESA
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

    return;
  }

  // STAND
  if (message === '2') {

    if (currentPlayer !== username) {
      console.log(`⏳ Não é a vez de @${username}.`);
      return;
    }

    console.log(`🛑 @${username} parou!`);

    return;
  }
});

// NOVO MEMBRO
connection.on(WebcastEvent.MEMBER, (data) => {
  console.log(`👤 @${data.user.uniqueId} entrou na LIVE.`);
});

// PRESENTE
connection.on(WebcastEvent.GIFT, (data) => {
  console.log(`🎁 @${data.user.uniqueId} enviou um presente.`);
});

// LIKE
connection.on(WebcastEvent.LIKE, (data) => {
  console.log(`❤️ @${data.user.uniqueId} curtiu a LIVE.`);
});

// DESCONEXÃO
connection.on(WebcastEvent.DISCONNECT, () => {
  console.log('🔴 Bot desconectado da TikTok LIVE.');
});
