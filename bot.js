import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== ESTADO DO JOGO ======
const gameState = {
  players: [],
  deck: [],
  dealerHand: [],
  gameActive: false,
  roundActive: false,
  maxPlayers: 2,
  currentTurn: null,
  playerLives: {},
  messages: [],
  phase: 'waiting'
};

// ====== BARALHO ======
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let suit of suits) {
    for (let value of values) {
      deck.push({ value, suit });
    }
  }
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function cardValue(card) {
  if (card.value === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  return parseInt(card.value);
}

function handValue(hand) {
  let value = 0;
  let aces = 0;
  for (let card of hand) {
    if (card.value === 'A') aces++;
    value += cardValue(card);
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function formatCard(card) {
  return `${card.value}${card.suit}`;
}

// ====== JOGO ======
function startGame() {
  gameState.deck = createDeck();
  gameState.dealerHand = [];
  gameState.roundActive = true;
  gameState.gameActive = true;
  gameState.phase = 'dealing';
  
  gameState.players.forEach(p => {
    p.hand = [drawCard(), drawCard()];
    p.stand = false;
    p.busted = false;
    p.blackjack = false;
    p.result = null;
  });

  gameState.dealerHand = [drawCard()];
  
  gameState.players.forEach(p => {
    if (handValue(p.hand) === 21) p.blackjack = true;
  });

  gameState.currentTurn = gameState.players[0]?.username || null;
  gameState.phase = 'players';
  
  broadcastState();
  broadcastMessage('🃏 Nova rodada começou!');
}

function drawCard() {
  if (gameState.deck.length === 0) {
    gameState.deck = createDeck();
  }
  return gameState.deck.pop();
}

function hitPlayer(username) {
  const player = gameState.players.find(p => p.username === username);
  if (!player || player.stand || player.busted) return false;
  
  player.hand.push(drawCard());
  const value = handValue(player.hand);
  
  if (value > 21) {
    player.busted = true;
    playerLoseLife(username);
    broadcastMessage(`${username} estourou! 💥`);
  }
  
  if (value === 21) {
    player.stand = true;
    broadcastMessage(`${username} fez 21! 🎯`);
  }
  
  broadcastState();
  checkRoundEnd();
  return true;
}

function standPlayer(username) {
  const player = gameState.players.find(p => p.username === username);
  if (!player) return false;
  player.stand = true;
  broadcastMessage(`${username} ficou! 🛑`);
  broadcastState();
  checkRoundEnd();
  return true;
}

function playerLoseLife(username) {
  if (!gameState.playerLives[username]) gameState.playerLives[username] = 3;
  gameState.playerLives[username]--;
  
  if (gameState.playerLives[username] <= 0) {
    broadcastMessage(`${username} perdeu todas as vidas! ❌`);
    removePlayer(username);
  }
}

function playerWinLife(username) {
  if (!gameState.playerLives[username]) gameState.playerLives[username] = 3;
  if (gameState.playerLives[username] < 3) {
    gameState.playerLives[username]++;
    broadcastMessage(`${username} ganhou uma vida! ❤️`);
  }
}

function removePlayer(username) {
  gameState.players = gameState.players.filter(p => p.username !== username);
  delete gameState.playerLives[username];
  if (gameState.currentTurn === username) {
    gameState.currentTurn = gameState.players[0]?.username || null;
  }
  broadcastState();
}

function checkRoundEnd() {
  const allFinished = gameState.players.every(p => p.stand || p.busted);
  if (!allFinished) return;
  
  gameState.phase = 'dealer';
  broadcastState();
  
  setTimeout(() => {
    let dealerValue = handValue(gameState.dealerHand);
    
    while (dealerValue < 17) {
      gameState.dealerHand.push(drawCard());
      dealerValue = handValue(gameState.dealerHand);
    }
    
    const dealerBusted = dealerValue > 21;
    
    gameState.players.forEach(p => {
      if (p.busted) {
        p.result = 'lose';
        return;
      }
      const playerValue = handValue(p.hand);
      
      if (dealerBusted) {
        p.result = 'win';
        playerWinLife(p.username);
        broadcastMessage(`${p.username} venceu! 🎉 Dealer estourou!`);
      } else if (playerValue > dealerValue) {
        p.result = 'win';
        playerWinLife(p.username);
        broadcastMessage(`${p.username} venceu! 🎉`);
      } else if (playerValue < dealerValue) {
        p.result = 'lose';
        playerLoseLife(p.username);
        broadcastMessage(`${p.username} perdeu! 😢`);
      } else {
        p.result = 'push';
        broadcastMessage(`${p.username} empatou! 🤝`);
      }
    });
    
    gameState.roundActive = false;
    gameState.phase = 'result';
    broadcastState();
    
    setTimeout(() => {
      if (gameState.players.length > 0) {
        startGame();
      } else {
        gameState.gameActive = false;
        gameState.phase = 'waiting';
        broadcastState();
      }
    }, 5000);
  }, 1000);
}

function broadcastState() {
  const state = {
    ...gameState,
    dealerHand: gameState.dealerHand.map(formatCard),
    dealerValue: handValue(gameState.dealerHand),
    players: gameState.players.map(p => ({
      ...p,
      hand: p.hand.map(formatCard),
      handValue: handValue(p.hand)
    }))
  };
  io.emit('gameState', state);
}

function broadcastMessage(msg) {
  gameState.messages.push({ text: msg, timestamp: Date.now() });
  if (gameState.messages.length > 50) gameState.messages.shift();
  io.emit('message', msg);
}

// ====== TIKTOK CONNECTION ======
let tiktokConn = null;

function connectTikTok(username) {
  if (tiktokConn) {
    tiktokConn.disconnect();
  }
  
  tiktokConn = new WebcastPushConnection(username);
  
  tiktokConn.connect().then(() => {
    console.log(`✅ Conectado ao live: ${username}`);
    broadcastMessage(`🎮 Bot conectado ao @${username}`);
  }).catch(err => {
    console.error('Erro ao conectar TikTok:', err);
    broadcastMessage(`❌ Erro ao conectar: ${err.message}`);
  });
  
  tiktokConn.on('chat', (data) => {
    const username = data.uniqueId;
    const message = data.comment.toUpperCase().trim();
    
    if (message === 'BLACKJACK' || message === 'BJ') {
      if (!gameState.gameActive || gameState.phase === 'waiting' || gameState.phase === 'end') {
        if (gameState.players.length >= gameState.maxPlayers) {
          broadcastMessage(`⏳ Mesa cheia, ${username}!`);
          return;
        }
        if (gameState.players.find(p => p.username === username)) {
          broadcastMessage(`⏳ ${username} já está na mesa!`);
          return;
        }
        gameState.players.push({ username, hand: [], stand: false, busted: false, blackjack: false, result: null });
        if (!gameState.playerLives[username]) gameState.playerLives[username] = 3;
        broadcastMessage(`${username} entrou na mesa! 🃏`);
        if (gameState.players.length === 1 && !gameState.roundActive) {
          setTimeout(startGame, 1000);
        }
        broadcastState();
      } else {
        broadcastMessage(`⏳ Jogo já começou, ${username}! Aguarde a próxima rodada.`);
      }
    }
    
    if (message === '1' && gameState.currentTurn === username) {
      hitPlayer(username);
    }
    
    if (message === '2' && gameState.currentTurn === username) {
      standPlayer(username);
    }
  });
}

// ====== ROTAS HTTP ======
app.get('/state', (req, res) => {
  res.json(gameState);
});

app.post('/game-state', (req, res) => {
  const { action, username } = req.body;
  
  if (action === 'hit' && username === gameState.currentTurn) {
    hitPlayer(username);
    res.json({ success: true });
  } else if (action === 'stand' && username === gameState.currentTurn) {
    standPlayer(username);
    res.json({ success: true });
  } else if (action === 'join') {
    if (gameState.players.length >= gameState.maxPlayers) {
      res.json({ success: false, error: 'Mesa cheia' });
      return;
    }
    if (gameState.players.find(p => p.username === username)) {
      res.json({ success: false, error: 'Já está na mesa' });
      return;
    }
    gameState.players.push({ username, hand: [], stand: false, busted: false, blackjack: false, result: null });
    if (!gameState.playerLives[username]) gameState.playerLives[username] = 3;
    broadcastMessage(`${username} entrou na mesa! 🃏`);
    if (gameState.players.length === 1 && !gameState.roundActive) {
      setTimeout(startGame, 1000);
    }
    broadcastState();
    res.json({ success: true });
  } else if (action === 'leave') {
    removePlayer(username);
    broadcastMessage(`${username} saiu da mesa.`);
    broadcastState();
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Ação inválida' });
  }
});

// ====== SSE ======
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'state', data: gameState });

  const listener = (state) => {
    sendEvent({ type: 'state', data: state });
  };
  
  io.on('gameState', listener);

  req.on('close', () => {
    io.off('gameState', listener);
  });
});

// ====== INICIALIZAÇÃO ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log('📡 SSE em /events');
  console.log('📡 GET /state');
  console.log('📡 POST /game-state');
});

// Conectar ao TikTok (substitua pelo usuário)
connectTikTok(theblackjackdealer);
