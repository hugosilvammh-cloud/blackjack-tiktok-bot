import express from 'express';
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from 'tiktok-live-connector';

import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// =====================================================
// PATH
// =====================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
// CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;
const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME não configurado.');
  process.exit(1);
}

// =====================================================
// SERVER
// =====================================================

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// GAME
// =====================================================

const game = {
  phase: 'waiting',

  players: [],

  dealerHand: [],
  dealerScore: 0,

  currentTurn: null,

  maxPlayers: 2,
  maxLives: 3,

  messages: []
};

// =====================================================
// CONNECTION CLIENTS - SSE
// =====================================================

const clients = new Set();

// =====================================================
// DECK
// =====================================================

function createDeck() {

  const suits = ['♥️', '♦️', '♣️', '♠️'];

  const values = [
    'A',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    'J',
    'Q',
    'K'
  ];

  const cards = [];

  for (const suit of suits) {

    for (const value of values) {

      cards.push({
        value,
        suit
      });

    }

  }

  // Shuffle
  for (let i = cards.length - 1; i > 0; i--) {

    const j = Math.floor(Math.random() * (i + 1));

    [cards[i], cards[j]] =
      [cards[j], cards[i]];

  }

  return cards;
}

let deck = createDeck();

// =====================================================
// DRAW CARD
// =====================================================

function drawCard() {

  if (deck.length === 0) {
    deck = createDeck();
  }

  return deck.pop();
}

// =====================================================
// SCORE
// =====================================================

function handScore(hand) {

  let total = 0;
  let aces = 0;

  for (const card of hand) {

    if (card.value === 'A') {

      total += 11;
      aces++;

    } else if (
      ['J', 'Q', 'K'].includes(card.value)
    ) {

      total += 10;

    } else {

      total += Number(card.value);

    }

  }

  while (total > 21 && aces > 0) {

    total -= 10;
    aces--;

  }

  return total;
}

// =====================================================
// SAFE PUBLIC STATE
// =====================================================

function getPublicState() {

  return {
    phase: game.phase,

    players: game.players.map(player => ({
      id: player.id,
      nickname: player.nickname,
      lives: player.lives,

      hand: player.hand,

      score: player.score,

      stand: player.stand,
      busted: player.busted,
      blackjack: player.blackjack
    })),

    dealerHand: game.dealerHand,

    dealerScore: game.dealerScore,

    currentTurn: game.currentTurn,

    maxPlayers: game.maxPlayers,

    messages: game.messages.slice(-20)
  };
}

// =====================================================
// BROADCAST STATE
// =====================================================

function broadcastState() {

  const payload = {
    type: 'state',
    data: getPublicState()
  };

  const message =
    `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of clients) {

    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }

  }
}

// =====================================================
// BROADCAST MESSAGE
// =====================================================

function broadcastMessage(text) {

  console.log(`📢 ${text}`);

  game.messages.push(text);

  if (game.messages.length > 50) {
    game.messages.shift();
  }

  const payload = {
    type: 'message',
    data: text
  };

  const message =
    `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of clients) {

    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }

  }

  broadcastState();
}

// =====================================================
// FIND PLAYER
// =====================================================

function findPlayer(userId) {

  return game.players.find(
    player => player.id === userId
  );

}

// =====================================================
// ADD PLAYER
// =====================================================

let startTimer = null;

function addPlayer(userId, nickname) {

  if (!userId) {

    broadcastMessage(
      `❌ Não consegui identificar @${nickname}.`
    );

    return false;
  }

  // Already playing
  const existing = findPlayer(userId);

  if (existing) {

    broadcastMessage(
      `⚠️ @${nickname}, você já está na mesa.`
    );

    return false;
  }

  // Table full
  if (game.players.length >= game.maxPlayers) {

    broadcastMessage(
      `🚫 Mesa cheia! @${nickname}, aguarde a próxima rodada.`
    );

    return false;
  }

  // Game running
  if (
    game.phase !== 'waiting' &&
    game.phase !== 'result'
  ) {

    broadcastMessage(
      `⏳ Rodada em andamento. @${nickname}, aguarde a próxima.`
    );

    return false;
  }

  const player = {

    id: String(userId),

    nickname: nickname || 'Player',

    lives: game.maxLives,

    hand: [],

    score: 0,

    stand: false,

    busted: false,

    blackjack: false
  };

  game.players.push(player);

  broadcastMessage(
    `🃏 @${player.nickname} entrou na mesa! ` +
    `(${game.players.length}/${game.maxPlayers})`
  );

  broadcastState();

  // ===================================================
  // ONE PLAYER
  // ===================================================

  if (game.players.length === 1) {

    if (startTimer) {
      clearTimeout(startTimer);
    }

    startTimer = setTimeout(() => {

      startTimer = null;

      if (
        game.phase === 'waiting' &&
        game.players.length > 0
      ) {

        broadcastMessage(
          '🎯 Apenas um jogador. Vamos começar!'
        );

        startRound();

      }

    }, 5000);

  }

  // ===================================================
  // TWO PLAYERS
  // ===================================================

  if (
    game.players.length === game.maxPlayers
  ) {

    if (startTimer) {

      clearTimeout(startTimer);
      startTimer = null;

    }

    setTimeout(() => {

      if (
        game.phase === 'waiting' &&
        game.players.length === game.maxPlayers
      ) {

        startRound();

      }

    }, 1000);

  }

  return true;
}

// =====================================================
// START ROUND
// =====================================================

function startRound() {

  if (game.players.length === 0) {

    game.phase = 'waiting';
    game.currentTurn = null;

    broadcastState();

    return;
  }

  game.phase = 'dealing';

  game.currentTurn = null;

  game.dealerHand = [];
  game.dealerScore = 0;

  deck = createDeck();

  // Reset players
  for (const player of game.players) {

    player.hand = [];

    player.score = 0;

    player.stand = false;

    player.busted = false;

    player.blackjack = false;

  }

  // ===================================================
  // DEAL TWO CARDS
  // ===================================================

  for (let round = 0; round < 2; round++) {

    for (const player of game.players) {

      player.hand.push(
        drawCard()
      );

    }

  }

  // Dealer gets one visible card
  game.dealerHand = [
    drawCard()
  ];

  // ===================================================
  // CALCULATE PLAYERS
  // ===================================================

  for (const player of game.players) {

    player.score =
      handScore(player.hand);

    if (
      player.score === 21 &&
      player.hand.length === 2
    ) {

      player.blackjack = true;
      player.stand = true;

      broadcastMessage(
        `🃏 BLACKJACK! @${player.nickname}!`
      );

    }

  }

  game.dealerScore =
    handScore(game.dealerHand);

  game.phase = 'players';

  // ===================================================
  // FIRST TURN
  // ===================================================

  const firstPlayer =
    game.players.find(
      player =>
        !player.stand &&
        !player.busted
    );

  game.currentTurn =
    firstPlayer
      ? firstPlayer.id
      : null;

  broadcastState();

  if (firstPlayer) {

    broadcastMessage(
      `🎯 É a vez de @${firstPlayer.nickname}!`
    );

  } else {

    checkRoundEnd();

  }

}

// =====================================================
// NEXT PLAYER
// =====================================================

function nextPlayer() {

  if (game.players.length === 0) {

    game.currentTurn = null;

    game.phase = 'waiting';

    broadcastState();

    return;

  }

  const currentIndex =
    game.players.findIndex(
      player =>
        player.id === game.currentTurn
    );

  let startIndex =
    currentIndex >= 0
      ? currentIndex + 1
      : 0;

  for (
    let i = 0;
    i < game.players.length;
    i++
  ) {

    const index =
      (startIndex + i) %
      game.players.length;

    const player =
      game.players[index];

    if (
      !player.stand &&
      !player.busted
    ) {

      game.currentTurn =
        player.id;

      broadcastState();

      broadcastMessage(
        `🎯 É a vez de @${player.nickname}!`
      );

      return;

    }

  }

  game.currentTurn = null;

  checkRoundEnd();

}

// =====================================================
// HIT
// =====================================================

function hitPlayer(userId) {

  const player =
    findPlayer(userId);

  if (!player) {

    console.log(
      `⚠️ HIT ignorado: jogador não encontrado ${userId}`
    );

    return false;
  }

  if (game.phase !== 'players') {

    broadcastMessage(
      `⏳ @${player.nickname}, a rodada não está recebendo jogadas agora.`
    );

    return false;
  }

  if (game.currentTurn !== player.id) {

    const current =
      findPlayer(game.currentTurn);

    broadcastMessage(
      `⏳ @${player.nickname}, não é sua vez. ` +
      `${current ? `Agora é a vez de @${current.nickname}.` : ''}`
    );

    return false;
  }

  if (
    player.stand ||
    player.busted
  ) {

    return false;
  }

  // Draw card
  const card = drawCard();

  player.hand.push(card);

  player.score =
    handScore(player.hand);

  console.log(
    `🃏 HIT -> @${player.nickname} recebeu ${card.value}${card.suit} = ${player.score}`
  );

  // ===================================================
  // BUST
  // ===================================================

  if (player.score > 21) {

    player.busted = true;

    player.lives =
      Math.max(
        0,
        player.lives - 1
      );

    broadcastMessage(
      `💥 @${player.nickname} estourou com ${player.score}! ` +
      `❤️ ${player.lives} vidas restantes.`
    );

    if (player.lives <= 0) {

      broadcastMessage(
        `💀 @${player.nickname} foi eliminado!`
      );

      game.players =
        game.players.filter(
          p => p.id !== player.id
        );

    }

    game.currentTurn = null;

    broadcastState();

    checkRoundEnd();

    return true;
  }

  // ===================================================
  // 21
  // ===================================================

  if (player.score === 21) {

    player.stand = true;

    broadcastMessage(
      `🎯 @${player.nickname} chegou a 21!`
    );

    broadcastState();

    checkRoundEnd();

    return true;
  }

  broadcastMessage(
    `🃏 @${player.nickname} pediu carta e ficou com ${player.score}.`
  );

  broadcastState();

  return true;
}

// =====================================================
// STAND
// =====================================================

function standPlayer(userId) {

  const player =
    findPlayer(userId);

  if (!player) {
    return false;
  }

  if (game.phase !== 'players') {
    return false;
  }

  if (game.currentTurn !== player.id) {

    const current =
      findPlayer(game.currentTurn);

    broadcastMessage(
      `⏳ @${player.nickname}, não é sua vez.` +
      `${current ? ` Agora é @${current.nickname}.` : ''}`
    );

    return false;
  }

  if (
    player.stand ||
    player.busted
  ) {

    return false;
  }

  player.stand = true;

  broadcastMessage(
    `🛑 @${player.nickname} parou com ${player.score} pontos.`
  );

  broadcastState();

  checkRoundEnd();

  return true;
}

// =====================================================
// CHECK ROUND END
// =====================================================

function checkRoundEnd() {

  if (game.players.length === 0) {

    game.phase = 'waiting';

    game.currentTurn = null;

    broadcastState();

    return;
  }

  const allDone =
    game.players.every(
      player =>
        player.stand ||
        player.busted
    );

  if (!allDone) {

    nextPlayer();

    return;
  }

  // ===================================================
  // DEALER
  // ===================================================

  game.currentTurn = null;

  game.phase = 'dealer';

  broadcastState();

  broadcastMessage(
    '🎩 Todos terminaram. Agora é a vez do Dealer.'
  );

}

// =====================================================
// HTTP - STATE
// =====================================================

app.get('/state', (req, res) => {

  res.json(
    getPublicState()
  );

});

// =====================================================
// HTTP - GAME STATE
// =====================================================

app.post('/game-state', (req, res) => {

  const {
    action,
    userId
  } = req.body;

  console.log(
    `📥 POST /game-state`,
    req.body
  );

  if (action === 'hit') {

    const success =
      hitPlayer(String(userId));

    return res.json({
      success
    });

  }

  if (action === 'stand') {

    const success =
      standPlayer(String(userId));

    return res.json({
      success
    });

  }

  return res.status(400).json({
    success: false,
    error: 'Invalid action'
  });

});

// =====================================================
// SSE
// =====================================================

app.get('/events', (req, res) => {

  res.writeHead(200, {

    'Content-Type':
      'text/event-stream',

    'Cache-Control':
      'no-cache',

    'Connection':
      'keep-alive',

    'Access-Control-Allow-Origin':
      '*'

  });

  clients.add(res);

  console.log(
    `📡 Novo cliente SSE. Total: ${clients.size}`
  );

  // Send current state immediately
  res.write(
    `data: ${JSON.stringify({
      type: 'state',
      data: getPublicState()
    })}\n\n`
  );

  req.on('close', () => {

    clients.delete(res);

    console.log(
      `📡 Cliente SSE saiu. Total: ${clients.size}`
    );

  });

});

// =====================================================
// TIKTOK
// =====================================================

console.log('');
console.log('==============================================');
console.log('🤖 BLACKJACK TIKTOK BOT');
console.log('==============================================');
console.log(`🎯 Looking for @${USERNAME}`);
console.log(`👥 Maximum players: ${game.maxPlayers}`);
console.log(`❤️ Lives per player: ${game.maxLives}`);
console.log('==============================================');

const connection =
  new TikTokLiveConnection(
    USERNAME,
    {
      processInitialData: false
    }
  );

// =====================================================
// CONNECT
// =====================================================

let reconnectTimer = null;
let connected = false;

async function connectToLive() {

  if (connected) {
    return;
  }

  console.log(
    `🔌 Connecting to @${USERNAME}...`
  );

  try {

    const state =
      await connection.connect();

    connected = true;

    console.log('');
    console.log(
      '🟢 CONNECTED TO TIKTOK LIVE!'
    );

    console.log(
      `🏠 Room ID: ${state.roomId}`
    );

    console.log(
      '💬 Aguardando mensagens do chat...'
    );

  } catch (error) {

    connected = false;

    console.log(
      `⏳ @${USERNAME} is not online yet.`
    );

    console.log(
      '❌ TikTok connection error:',
      error?.message || error
    );

    scheduleReconnect();

  }

}

// =====================================================
// RECONNECT
// =====================================================

function scheduleReconnect() {

  if (reconnectTimer) {
    return;
  }

  reconnectTimer =
    setTimeout(() => {

      reconnectTimer = null;

      connectToLive();

    }, 30000);

  console.log(
    '🔁 Trying again in 30 seconds...'
  );

}

// =====================================================
// CHAT
// =====================================================

connection.on(
  WebcastEvent.CHAT,
  (data) => {

    // =================================================
    // CORRECT TIKTOK FIELDS
    // =================================================

    const comment =
      typeof data?.comment === 'string'
        ? data.comment.trim()
        : '';

    const uniqueId =
      data?.uniqueId ||
      data?.user?.uniqueId ||
      null;

    const userId =
      data?.userId ||
      data?.user?.userId ||
      uniqueId ||
      null;

    const nickname =
      data?.nickname ||
      data?.user?.nickname ||
      uniqueId ||
      'anon';

    // =================================================
    // LOG RAW CHAT
    // =================================================

    console.log('');
    console.log('💬 ================================');
    console.log(`👤 @${nickname}`);
    console.log(`🆔 userId: ${userId}`);
    console.log(`🔑 uniqueId: ${uniqueId}`);
    console.log(`📝 comment: "${comment}"`);
    console.log('💬 ================================');

    // =================================================
    // NO COMMENT
    // =================================================

    if (!comment) {

      console.log(
        '⚠️ CHAT recebido sem comment.'
      );

      return;
    }

    // =================================================
    // IDENTIFICATION
    // =================================================

    if (!userId) {

      console.log(
        '❌ Não foi possível identificar o usuário.'
      );

      return;
    }

    // =================================================
    // NORMALIZE MESSAGE
    // =================================================

    const message =
      comment
        .trim()
        .toUpperCase();

    const playerId =
      String(userId);

    // =================================================
    // BLACKJACK
    // =================================================

    if (message === 'BLACKJACK') {

      console.log(
        `🃏 JOIN COMMAND -> @${nickname}`
      );

      addPlayer(
        playerId,
        nickname
      );

      return;
    }

    // =================================================
    // FIND PLAYER
    // =================================================

    const player =
      findPlayer(playerId);

    if (!player) {

      console.log(
        `ℹ️ @${nickname} não está na mesa.`
      );

      return;
    }

    // =================================================
    // HIT
    // =================================================

    if (message === '1') {

      console.log(
        `🟢 HIT COMMAND -> @${nickname}`
      );

      hitPlayer(playerId);

      return;
    }

    // =================================================
    // STAND
    // =================================================

    if (message === '2') {

      console.log(
        `🛑 STAND COMMAND -> @${nickname}`
      );

      standPlayer(playerId);

      return;
    }

    // =================================================
    // OTHER MESSAGE
    // =================================================

    console.log(
      `💭 Mensagem ignorada: "${comment}"`
    );

  }
);

// =====================================================
// TIKTOK ERROR
// =====================================================

connection.on(
  ControlEvent.ERROR,
  (error) => {

    connected = false;

    console.error(
      '❌ TikTok connection error:',
      error
    );

    scheduleReconnect();

  }
);

// =====================================================
// DISCONNECT
// =====================================================

connection.on(
  ControlEvent.DISCONNECTED,
  () => {

    connected = false;

    console.log(
      '🔴 TikTok disconnected.'
    );

    scheduleReconnect();

  }
);

// =====================================================
// MEMBER
// =====================================================

connection.on(
  WebcastEvent.MEMBER,
  (data) => {

    const name =
      data?.nickname ||
      data?.user?.nickname ||
      data?.uniqueId ||
      data?.user?.uniqueId ||
      'someone';

    console.log(
      `👤 @${name} entered the LIVE.`
    );

  }
);

// =====================================================
// LIKE
// =====================================================

connection.on(
  WebcastEvent.LIKE,
  (data) => {

    const name =
      data?.nickname ||
      data?.user?.nickname ||
      data?.uniqueId ||
      data?.user?.uniqueId ||
      'someone';

    console.log(
      `❤️ @${name} liked.`
    );

  }
);

// =====================================================
// GIFT
// =====================================================

connection.on(
  WebcastEvent.GIFT,
  (data) => {

    const name =
      data?.nickname ||
      data?.user?.nickname ||
      data?.uniqueId ||
      data?.user?.uniqueId ||
      'someone';

    console.log(
      `🎁 @${name} sent a gift.`
    );

  }
);

// =====================================================
// STREAM END
// =====================================================

connection.on(
  WebcastEvent.STREAM_END,
  () => {

    connected = false;

    console.log(
      '🔴 LIVE ended.'
    );

    broadcastMessage(
      '🔴 LIVE terminou. Aguardando a próxima LIVE.'
    );

    scheduleReconnect();

  }
);

// =====================================================
// SERVER
// =====================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log('');
    console.log(
      `🌐 Server running on port ${PORT}`
    );

    console.log(
      `📡 GET  /state`
    );

    console.log(
      `📡 GET  /events`
    );

    console.log(
      `📡 POST /game-state`
    );

    console.log('');

    connectToLive();

  }
);
