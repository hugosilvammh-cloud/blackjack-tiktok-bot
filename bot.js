import express from 'express';
import http from 'http';
import { WebcastPushConnection } from 'tiktok-live-connector';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
// CONFIGURATION
// =====================================================

const PORT = process.env.PORT || 10000;
const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME not configured.');
  process.exit(1);
}

// =====================================================
// EXPRESS + SSE
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// GAME STATE
// =====================================================

const game = {
  phase: 'waiting', // waiting | dealing | players | dealer | result
  players: [],
  dealerHand: [],
  dealerScore: 0,
  currentTurn: null,
  maxPlayers: 2,
  messages: [],
};

// =====================================================
// DECK
// =====================================================

function createDeck() {
  const suits = ['♥️', '♦️', '♣️', '♠️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ value, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

let deck = createDeck();

function drawCard() {
  if (deck.length === 0) deck = createDeck();
  return deck.pop();
}

function handScore(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.value === 'A') { total += 11; aces++; }
    else if (['J', 'Q', 'K'].includes(card.value)) total += 10;
    else total += parseInt(card.value);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

// =====================================================
// GAME FUNCTIONS
// =====================================================

function addPlayer(userId, nickname) {
  if (game.players.find(p => p.id === userId)) {
    broadcastMessage(`@${nickname} is already at the table.`);
    return false;
  }
  if (game.players.length >= game.maxPlayers) {
    broadcastMessage(`Table is full! @${nickname} cannot join.`);
    return false;
  }
  if (game.phase !== 'waiting' && game.phase !== 'result') {
    broadcastMessage(`⏳ Game in progress, @${nickname}. Wait for the next round.`);
    return false;
  }

  game.players.push({
    id: userId,
    nickname: nickname,
    lives: 3,
    hand: [],
    score: 0,
    stand: false,
    busted: false,
    blackjack: false,
  });

  broadcastMessage(`🃏 @${nickname} joined the table! (${game.players.length}/${game.maxPlayers})`);
  broadcastState();

  if (game.players.length === 1) {
    setTimeout(() => {
      if (game.phase === 'waiting' || game.phase === 'result') {
        broadcastMessage('🎯 Only one player? Let\'s start!');
        startRound();
      }
    }, 3000);
  }

  if (game.players.length === game.maxPlayers) {
    setTimeout(startRound, 1500);
  }
  return true;
}

function startRound() {
  if (game.players.length === 0) {
    game.phase = 'waiting';
    broadcastState();
    return;
  }

  game.phase = 'dealing';
  game.dealerHand = [];
  deck = createDeck();

  for (const p of game.players) {
    p.hand = [];
    p.score = 0;
    p.stand = false;
    p.busted = false;
    p.blackjack = false;
  }

  for (let i = 0; i < 2; i++) {
    for (const p of game.players) {
      p.hand.push(drawCard());
    }
  }

  // DEALER RECEIVES ONLY 1 CARD (face up)
  game.dealerHand = [drawCard()];

  for (const p of game.players) {
    p.score = handScore(p.hand);
    if (p.score === 21 && p.hand.length === 2) {
      p.blackjack = true;
      p.stand = true;
    }
  }

  game.dealerScore = handScore(game.dealerHand);
  game.phase = 'players';
  const firstPlayer = game.players.find(p => !p.stand && !p.busted);
  game.currentTurn = firstPlayer ? firstPlayer.id : null;

  broadcastState();
  broadcastMessage(`🎯 New round! It's @${game.currentTurn ? game.players.find(p => p.id === game.currentTurn).nickname : 'no one'}'s turn.`);
}

function hitPlayer(userId) {
  const player = game.players.find(p => p.id === userId);
  if (!player) return;
  if (game.phase !== 'players' || game.currentTurn !== userId) return;
  if (player.stand || player.busted) return;

  player.hand.push(drawCard());
  player.score = handScore(player.hand);

  if (player.score > 21) {
    player.busted = true;
    player.lives--;
    broadcastMessage(`💥 @${player.nickname} busted! Lost a life.`);
    if (player.lives <= 0) {
      broadcastMessage(`💀 @${player.nickname} was eliminated!`);
      game.players = game.players.filter(p => p.id !== userId);
      if (game.currentTurn === userId) {
        const next = game.players.find(p => !p.stand && !p.busted);
        game.currentTurn = next ? next.id : null;
      }
    }
  } else if (player.score === 21) {
    player.stand = true;
    broadcastMessage(`🎯 @${player.nickname} got 21!`);
  }

  broadcastState();
  checkRoundEnd();
}

function standPlayer(userId) {
  const player = game.players.find(p => p.id === userId);
  if (!player) return;
  if (game.phase !== 'players' || game.currentTurn !== userId) return;
  if (player.stand || player.busted) return;

  player.stand = true;
  broadcastMessage(`🛑 @${player.nickname} stands with ${player.score} points.`);
  broadcastState();
  checkRoundEnd();
}

function checkRoundEnd() {
  const allDone = game.players.every(p => p.stand || p.busted);

  if (!allDone) {
    const currentIndex = game.players.findIndex(p => p.id === game.currentTurn);
    let nextIndex = (currentIndex + 1) % game.players.length;
    let attempts = 0;
    while (attempts < game.players.length) {
      const next = game.players[nextIndex];
      if (!next.stand && !next.busted) {
        game.currentTurn = next.id;
        broadcastState();
        broadcastMessage(`🎯 It's @${next.nickname}'s turn.`);
        return;
      }
      nextIndex = (nextIndex + 1) % game.players.length;
      attempts++;
    }
  }

  game.phase = 'dealer';
  broadcastState();
  broadcastMessage('🎩 Dealer\'s turn. Use the Dealer Control buttons.');
}

// =====================================================
// BROADCAST
// =====================================================

let clients = [];

function broadcastState() {
  const data = { type: 'state', data: game };
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

function broadcastMessage(text) {
  const data = { type: 'message', data: text };
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
  console.log(`📢 ${text}`);
}

// =====================================================
// HTTP ROUTES
// =====================================================

app.get('/state', (req, res) => {
  res.json(game);
});

app.post('/game-state', (req, res) => {
  const { action, userId } = req.body;
  if (action === 'hit') {
    hitPlayer(userId);
    res.json({ success: true });
  } else if (action === 'stand') {
    standPlayer(userId);
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Invalid action' });
  }
});

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  clients.push(res);
  broadcastState();
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

// =====================================================
// TIKTOK LIVE
// =====================================================

console.log(`🤖 Blackjack TikTok Bot starting...`);
console.log(`🎯 Looking for LIVE of @${USERNAME}`);

const connection = new WebcastPushConnection(USERNAME);

async function connectToLive() {
  try {
    const state = await connection.connect();
    console.log(`✅ Connected to LIVE! Room ID: ${state.roomId}`);
  } catch (error) {
    console.error('❌ Connection error:', error.message);
    console.log('🔄 Retrying in 30 seconds...');
    setTimeout(connectToLive, 30000);
  }
}

// =====================================================
// CHAT
// =====================================================

connection.on('chat', (data) => {
  const userId = data.userId || data?.user?.id || null;
  const nickname = data.uniqueId || data?.user?.nickname || 'anon';
  const comment = data.comment || '';

  if (!userId) {
    console.log('⚠️ User without ID, ignoring.');
    return;
  }

  const message = comment.trim().toUpperCase();
  console.log(`💬 @${nickname} (${userId}): ${message}`);

  if (message === 'BLACKJACK') {
    addPlayer(userId, nickname);
    return;
  }

  const player = game.players.find(p => p.id === userId);
  if (!player) return;

  if (message === '1') {
    hitPlayer(userId);
  } else if (message === '2') {
    standPlayer(userId);
  }
});

connection.on('disconnected', () => {
  console.log('⚠️ Disconnected from TikTok. Retrying...');
  setTimeout(connectToLive, 5000);
});

// =====================================================
// START SERVER
// =====================================================

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
  console.log(`📡 SSE at /events`);
  console.log(`📡 GET /state`);
  console.log(`📡 POST /game-state`);
  connectToLive();
});
