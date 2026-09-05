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
// CONFIGURAÇÃO
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
// CONFIGURAÇÃO DO JOGO
// =====================================================

const MAX_PLAYERS = 2;
const MAX_LIVES = 3;

const game = {
  phase: 'waiting',

  players: [],

  dealerHand: [],
  dealerScore: 0,

  currentTurn: null,

  maxPlayers: MAX_PLAYERS,

  messages: [],

  roundNumber: 0
};

// =====================================================
// CONTROLE DE TIMERS
// =====================================================

let startRoundTimer = null;
let nextRoundTimer = null;
let dealerTimer = null;

// =====================================================
// CLIENTES SSE
// =====================================================

const clients = [];

// =====================================================
// BARALHO
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

  const newDeck = [];

  for (const suit of suits) {
    for (const value of values) {
      newDeck.push({
        value,
        suit
      });
    }
  }

  // Fisher-Yates shuffle
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [newDeck[i], newDeck[j]] =
      [newDeck[j], newDeck[i]];
  }

  return newDeck;
}

let deck = createDeck();

// =====================================================
// COMPRAR CARTA
// =====================================================

function drawCard() {
  if (deck.length === 0) {
    deck = createDeck();
  }

  return deck.pop();
}

// =====================================================
// CALCULAR PONTUAÇÃO
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

  // Ajusta Ás de 11 para 1 quando necessário
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

// =====================================================
// NORMALIZAR ID DO USUÁRIO
// =====================================================

function getUserIdentity(data) {

  const user = data?.user || {};

  /*
   * O TikTok Live Connector fornece:
   *
   * data.user.uniqueId
   * data.user.nickname
   * data.user.userId
   *
   * Usamos userId primeiro e uniqueId como fallback.
   */

  const userId =
    user.userId ??
    user.uniqueId ??
    data?.userId ??
    data?.uniqueId ??
    null;

  const nickname =
    user.nickname ??
    user.uniqueId ??
    data?.nickname ??
    'player';

  if (!userId) {
    return null;
  }

  return {
    id: String(userId),
    nickname: String(nickname)
  };
}

// =====================================================
// NORMALIZAR MENSAGEM
// =====================================================

function normalizeMessage(text) {

  if (typeof text !== 'string') {
    return '';
  }

  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

// =====================================================
// BROADCAST STATE
// =====================================================

function broadcastState() {

  const data = {
    type: 'state',
    data: game
  };

  const payload =
    `data: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {

    try {
      client.write(payload);
    } catch (error) {
      console.error(
        '❌ Erro enviando state:',
        error.message
      );
    }
  }
}

// =====================================================
// BROADCAST MESSAGE
// =====================================================

function broadcastMessage(text) {

  const message = {
    type: 'message',
    data: text
  };

  game.messages.push({
    text,
    time: Date.now()
  });

  // Mantém somente as últimas 30 mensagens
  if (game.messages.length > 30) {
    game.messages.shift();
  }

  const payload =
    `data: ${JSON.stringify(message)}\n\n`;

  for (const client of clients) {

    try {
      client.write(payload);
    } catch (error) {
      console.error(
        '❌ Erro enviando mensagem:',
        error.message
      );
    }
  }

  console.log(`📢 ${text}`);
}

// =====================================================
// ENCONTRAR JOGADOR
// =====================================================

function findPlayer(userId) {

  if (!userId) {
    return null;
  }

  return game.players.find(
    player => player.id === String(userId)
  ) || null;
}

// =====================================================
// PRÓXIMO JOGADOR
// =====================================================

function findNextActivePlayer(currentUserId) {

  if (game.players.length === 0) {
    return null;
  }

  const currentIndex =
    game.players.findIndex(
      player => player.id === currentUserId
    );

  let startIndex = 0;

  if (currentIndex >= 0) {
    startIndex =
      (currentIndex + 1) %
      game.players.length;
  }

  for (let i = 0; i < game.players.length; i++) {

    const index =
      (startIndex + i) %
      game.players.length;

    const player =
      game.players[index];

    if (
      !player.stand &&
      !player.busted
    ) {
      return player;
    }
  }

  return null;
}

// =====================================================
// DEFINIR PRÓXIMO TURNO
// =====================================================

function goToNextTurn(currentUserId) {

  const next =
    findNextActivePlayer(currentUserId);

  if (!next) {

    game.currentTurn = null;

    startDealerTurn();

    return;
  }

  game.currentTurn = next.id;

  broadcastState();

  broadcastMessage(
    `🎯 It's @${next.nickname}'s turn.`
  );
}

// =====================================================
// ADICIONAR JOGADOR
// =====================================================

function addPlayer(userId, nickname) {

  userId = String(userId);

  const existing =
    findPlayer(userId);

  if (existing) {

    broadcastMessage(
      `⚠️ @${nickname}, you're already at the table.`
    );

    return false;
  }

  if (game.players.length >= MAX_PLAYERS) {

    broadcastMessage(
      `🚫 Table full! @${nickname}, wait for the next round.`
    );

    return false;
  }

  /*
   * Só permite entrar enquanto estamos
   * esperando ou mostrando resultado.
   */

  if (
    game.phase !== 'waiting' &&
    game.phase !== 'result'
  ) {

    broadcastMessage(
      `⏳ Game in progress, @${nickname}. Wait for the next round.`
    );

    return false;
  }

  const player = {

    id: userId,

    nickname,

    lives: MAX_LIVES,

    hand: [],

    score: 0,

    stand: false,

    busted: false,

    blackjack: false
  };

  game.players.push(player);

  broadcastMessage(
    `🃏 @${nickname} joined the table! (${game.players.length}/${MAX_PLAYERS})`
  );

  broadcastState();

  // ===================================================
  // PRIMEIRO JOGADOR
  // ===================================================

  if (game.players.length === 1) {

    clearTimeout(startRoundTimer);

    startRoundTimer =
      setTimeout(() => {

        if (
          game.phase === 'waiting' &&
          game.players.length > 0
        ) {

          broadcastMessage(
            '🎯 Starting the round!'
          );

          startRound();
        }

      }, 3000);
  }

  // ===================================================
  // MESA CHEIA
  // ===================================================

  if (game.players.length === MAX_PLAYERS) {

    clearTimeout(startRoundTimer);

    startRoundTimer =
      setTimeout(() => {

        if (
          game.phase === 'waiting' &&
          game.players.length === MAX_PLAYERS
        ) {

          startRound();
        }

      }, 1000);
  }

  return true;
}

// =====================================================
// INICIAR RODADA
// =====================================================

function startRound() {

  clearTimeout(startRoundTimer);
  clearTimeout(nextRoundTimer);
  clearTimeout(dealerTimer);

  if (game.players.length === 0) {

    game.phase = 'waiting';
    game.currentTurn = null;

    broadcastState();

    return;
  }

  if (
    game.phase === 'players' ||
    game.phase === 'dealing' ||
    game.phase === 'dealer'
  ) {
    return;
  }

  game.roundNumber++;

  game.phase = 'dealing';

  game.currentTurn = null;

  game.dealerHand = [];

  game.dealerScore = 0;

  deck = createDeck();

  // ===================================================
  // RESET DA RODADA
  // ===================================================

  for (const player of game.players) {

    player.hand = [];

    player.score = 0;

    player.stand = false;

    player.busted = false;

    player.blackjack = false;
  }

  // ===================================================
  // DISTRIBUI 2 CARTAS
  // ===================================================

  for (let i = 0; i < 2; i++) {

    for (const player of game.players) {

      player.hand.push(
        drawCard()
      );
    }
  }

  // ===================================================
  // DEALER
  // ===================================================

  /*
   * O dealer recebe inicialmente
   * somente uma carta visível.
   *
   * A segunda carta será comprada
   * quando o dealer começar sua vez.
   */

  game.dealerHand = [
    drawCard()
  ];

  // ===================================================
  // CALCULA JOGADORES
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
        `🃏🔥 @${player.nickname} has BLACKJACK!`
      );
    }
  }

  game.dealerScore =
    handScore(game.dealerHand);

  game.phase = 'players';

  // ===================================================
  // PRIMEIRO JOGADOR
  // ===================================================

  const firstPlayer =
    game.players.find(
      player =>
        !player.stand &&
        !player.busted
    );

  if (firstPlayer) {

    game.currentTurn =
      firstPlayer.id;

  } else {

    game.currentTurn = null;
  }

  broadcastState();

  if (firstPlayer) {

    broadcastMessage(
      `🎯 @${firstPlayer.nickname}'s turn. Type 1 = HIT or 2 = STAND.`
    );

  } else {

    // Todos deram blackjack
    startDealerTurn();
  }
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
      `⏳ @${player.nickname}, the game is not accepting HIT right now.`
    );

    return false;
  }

  if (game.currentTurn !== player.id) {

    broadcastMessage(
      `⚠️ @${player.nickname}, it's not your turn.`
    );

    return false;
  }

  if (
    player.stand ||
    player.busted
  ) {
    return false;
  }

  const card = drawCard();

  player.hand.push(card);

  player.score =
    handScore(player.hand);

  broadcastMessage(
    `🃏 @${player.nickname} drew ${card.value}${card.suit}.`
  );

  // ===================================================
  // BUST
  // ===================================================

  if (player.score > 21) {

    player.busted = true;

    player.lives =
      Math.max(0, player.lives - 1);

    broadcastMessage(
      `💥 @${player.nickname} busted with ${player.score}! ❤️ Lives: ${player.lives}`
    );

    // Elimina se chegou a zero
    if (player.lives <= 0) {

      broadcastMessage(
        `💀 @${player.nickname} has been eliminated!`
      );

      const eliminatedId =
        player.id;

      game.players =
        game.players.filter(
          p => p.id !== eliminatedId
        );

      game.currentTurn = null;

      broadcastState();

      if (game.players.length === 0) {

        game.phase = 'waiting';

        broadcastState();

        return true;
      }

      goToNextTurn(eliminatedId);

      return true;
    }

    broadcastState();

    goToNextTurn(player.id);

    return true;
  }

  // ===================================================
  // 21
  // ===================================================

  if (player.score === 21) {

    player.stand = true;

    broadcastMessage(
      `🎯 @${player.nickname} got 21!`
    );

    broadcastState();

    goToNextTurn(player.id);

    return true;
  }

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

    broadcastMessage(
      `⏳ @${player.nickname}, the game is not accepting STAND right now.`
    );

    return false;
  }

  if (game.currentTurn !== player.id) {

    broadcastMessage(
      `⚠️ @${player.nickname}, it's not your turn.`
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
    `🛑 @${player.nickname} stands with ${player.score}.`
  );

  broadcastState();

  goToNextTurn(player.id);

  return true;
}

// =====================================================
// DEALER
// =====================================================

function startDealerTurn() {

  if (game.phase === 'dealer') {
    return;
  }

  clearTimeout(dealerTimer);

  game.phase = 'dealer';

  game.currentTurn = null;

  broadcastState();

  broadcastMessage(
    '🎩 Dealer turn...'
  );

  /*
   * Pequena pausa para o frontend
   * mostrar a animação antes das cartas.
   */

  dealerTimer =
    setTimeout(
      playDealer,
      1000
    );
}

// =====================================================
// DEALER JOGA
// =====================================================

function playDealer() {

  if (game.phase !== 'dealer') {
    return;
  }

  /*
   * Dealer recebe a segunda carta.
   */

  if (game.dealerHand.length < 2) {

    game.dealerHand.push(
      drawCard()
    );

    game.dealerScore =
      handScore(game.dealerHand);

    broadcastState();

    broadcastMessage(
      `🎩 Dealer reveals the hidden card.`
    );
  }

  // ===================================================
  // DEALER COMPRA ATÉ 17
  // ===================================================

  while (game.dealerScore < 17) {

    const card = drawCard();

    game.dealerHand.push(card);

    game.dealerScore =
      handScore(game.dealerHand);

    broadcastState();

    broadcastMessage(
      `🎩 Dealer draws ${card.value}${card.suit}.`
    );
  }

  finishRound();
}

// =====================================================
// FINALIZAR RODADA
// =====================================================

function finishRound() {

  if (game.phase !== 'dealer') {
    return;
  }

  game.phase = 'result';

  game.currentTurn = null;

  const dealerScore =
    game.dealerScore;

  // ===================================================
  // RESULTADO
  // ===================================================

  for (const player of [...game.players]) {

    if (player.busted) {
      continue;
    }

    let result = '';

    // Dealer estourou
    if (dealerScore > 21) {

      result =
        `🎉 @${player.nickname} wins! Dealer busted.`;

    }

    // Jogador maior
    else if (player.score > dealerScore) {

      result =
        `🎉 @${player.nickname} wins with ${player.score}!`;

    }

    // Dealer maior
    else if (player.score < dealerScore) {

      player.lives =
        Math.max(0, player.lives - 1);

      result =
        `😢 @${player.nickname} loses. Dealer has ${dealerScore}. ❤️ Lives: ${player.lives}`;
    }

    // Empate
    else {

      result =
        `🤝 @${player.nickname} ties with the dealer at ${dealerScore}.`;
    }

    broadcastMessage(result);
  }

  // ===================================================
  // ELIMINA JOGADORES SEM VIDAS
  // ===================================================

  const eliminated =
    game.players.filter(
      player => player.lives <= 0
    );

  for (const player of eliminated) {

    broadcastMessage(
      `💀 @${player.nickname} has been eliminated!`
    );
  }

  game.players =
    game.players.filter(
      player => player.lives > 0
    );

  broadcastState();

  // ===================================================
  // PRÓXIMA RODADA
  // ===================================================

  nextRoundTimer =
    setTimeout(() => {

      if (game.players.length === 0) {

        game.phase = 'waiting';

        game.dealerHand = [];

        game.dealerScore = 0;

        game.currentTurn = null;

        broadcastMessage(
          '🪑 Table empty. Type BLACKJACK to join!'
        );

        broadcastState();

        return;
      }

      broadcastMessage(
        '🔄 Starting a new round...'
      );

      startRound();

    }, 5000);
}

// =====================================================
// HTTP - STATE
// =====================================================

app.get('/state', (req, res) => {

  res.json(game);
});

// =====================================================
// HTTP - GAME STATE
// =====================================================

app.post('/game-state', (req, res) => {

  const action =
    normalizeMessage(req.body?.action);

  const userId =
    req.body?.userId
      ? String(req.body.userId)
      : null;

  console.log(
    `📡 POST /game-state | action=${action} | userId=${userId}`
  );

  if (action === 'HIT') {

    const success =
      hitPlayer(userId);

    return res.json({
      success
    });
  }

  if (action === 'STAND') {

    const success =
      standPlayer(userId);

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

  clients.push(res);

  // Envia estado imediatamente
  try {

    res.write(
      `data: ${JSON.stringify({
        type: 'state',
        data: game
      })}\n\n`
    );

  } catch (error) {

    console.error(
      '❌ Erro enviando estado inicial:',
      error.message
    );
  }

  req.on('close', () => {

    const index =
      clients.indexOf(res);

    if (index !== -1) {
      clients.splice(index, 1);
    }

    console.log(
      `📡 SSE disconnected. Clients: ${clients.length}`
    );
  });

  console.log(
    `📡 SSE connected. Clients: ${clients.length}`
  );
});

// =====================================================
// TIKTOK LIVE
// =====================================================

console.log(
  '=============================================='
);

console.log(
  '🤖 BLACKJACK TIKTOK BOT'
);

console.log(
  '=============================================='
);

console.log(
  `🎯 Looking for @${USERNAME}`
);

console.log(
  `👥 Maximum players: ${MAX_PLAYERS}`
);

console.log(
  `❤️ Lives per player: ${MAX_LIVES}`
);

console.log(
  '=============================================='
);

// =====================================================
// CONNECTION
// =====================================================

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

let connecting = false;

async function connectToLive() {

  if (connecting) {
    return;
  }

  connecting = true;

  try {

    console.log(
      `🔌 Connecting to @${USERNAME}...`
    );

    const state =
      await connection.connect();

    console.log(
      `🟢 CONNECTED TO TIKTOK LIVE!`
    );

    console.log(
      `🏠 Room ID: ${state.roomId}`
    );

    connecting = false;

  } catch (error) {

    connecting = false;

    console.log(
      `⏳ @${USERNAME} is not online yet.`
    );

    console.log(
      `🔁 Trying again in 30 seconds...`
    );

    setTimeout(
      connectToLive,
      30000
    );
  }
}

// =====================================================
// TIKTOK CHAT
// =====================================================

connection.on(
  WebcastEvent.CHAT,
  (data) => {

    console.log(
      '----------------------------------------------'
    );

    console.log(
      '💬 CHAT EVENT RECEIVED'
    );

    /*
     * O connector já entrega diretamente:
     *
     * data.comment
     * data.user.uniqueId
     * data.user.nickname
     * data.user.userId
     */

    const identity =
      getUserIdentity(data);

    const comment =
      typeof data?.comment === 'string'
        ? data.comment.trim()
        : '';

    // =================================================
    // SEM IDENTIDADE
    // =================================================

    if (!identity) {

      console.log(
        '⚠️ Could not identify TikTok user.'
      );

      console.log(
        'Raw user:',
        data?.user
      );

      return;
    }

    // =================================================
    // SEM COMENTÁRIO
    // =================================================

    if (!comment) {

      console.log(
        `⚠️ Empty comment from @${identity.nickname}`
      );

      return;
    }

    const userId =
      identity.id;

    const nickname =
      identity.nickname;

    const message =
      normalizeMessage(comment);

    console.log(
      `👤 User: @${nickname}`
    );

    console.log(
      `🆔 ID: ${userId}`
    );

    console.log(
      `💬 Message: "${message}"`
    );

    // =================================================
    // BLACKJACK
    // =================================================

    if (message === 'BLACKJACK') {

      console.log(
        `🃏 JOIN COMMAND FROM @${nickname}`
      );

      addPlayer(
        userId,
        nickname
      );

      return;
    }

    // =================================================
    // ENCONTRA JOGADOR
    // =================================================

    const player =
      findPlayer(userId);

    // Pessoa que não está na mesa
    // não pode usar 1 ou 2.

    if (!player) {

      console.log(
        `ℹ️ @${nickname} is not a player.`
      );

      return;
    }

    // =================================================
    // HIT
    // =================================================

    if (message === '1') {

      console.log(
        `🃏 HIT from @${nickname}`
      );

      hitPlayer(userId);

      return;
    }

    // =================================================
    // STAND
    // =================================================

    if (message === '2') {

      console.log(
        `🛑 STAND from @${nickname}`
      );

      standPlayer(userId);

      return;
    }

    // =================================================
    // OUTROS COMANDOS
    // =================================================

    console.log(
      `ℹ️ Command ignored: "${message}"`
    );
  }
);

// =====================================================
// MEMBER
// =====================================================

connection.on(
  WebcastEvent.MEMBER,
  (data) => {

    const name =
      data?.user?.nickname ||
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
      data?.user?.nickname ||
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
      data?.user?.nickname ||
      data?.user?.uniqueId ||
      'someone';

    console.log(
      `🎁 @${name} sent a gift.`
    );
  }
);

// =====================================================
// CONNECTION ERROR
// =====================================================

connection.on(
  ControlEvent.ERROR,
  (error) => {

    console.error(
      '❌ TikTok connection error:',
      error
    );
  }
);

// =====================================================
// DISCONNECTED
// =====================================================

connection.on(
  ControlEvent.DISCONNECTED,
  () => {

    console.log(
      '🔌 TikTok connection disconnected.'
    );

    setTimeout(
      connectToLive,
      10000
    );
  }
);

// =====================================================
// STREAM END
// =====================================================

connection.on(
  WebcastEvent.STREAM_END,
  () => {

    console.log(
      '🔴 LIVE ended.'
    );

    broadcastMessage(
      '🔴 LIVE ended. Bot waiting for next LIVE.'
    );
  }
);

// =====================================================
// SERVER
// =====================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      '=============================================='
    );

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

    console.log(
      '=============================================='
    );

    connectToLive();
  }
);
