import http from 'http';
import express from 'express';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

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
// EXPRESS + SSE
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// ESTADO DO JOGO
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
// BARALHO
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
// FUNÇÕES DO JOGO
// =====================================================

function resetGame() {
  deck = createDeck();
  game.phase = 'waiting';
  game.players = [];
  game.dealerHand = [];
  game.dealerScore = 0;
  game.currentTurn = null;
  broadcastState();
}

function addPlayer(userId, nickname) {
  if (game.players.find(p => p.id === userId)) {
    broadcastMessage(`@${nickname} já está na mesa.`);
    return false;
  }
  if (game.players.length >= game.maxPlayers) {
    broadcastMessage(`Mesa cheia! @${nickname} não pode entrar.`);
    return false;
  }
  if (game.phase !== 'waiting' && game.phase !== 'result') {
    broadcastMessage(`⏳ Jogo em andamento, @${nickname}. Aguarde a próxima rodada.`);
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

  broadcastMessage(`🃏 @${nickname} entrou na mesa! (${game.players.length}/${game.maxPlayers})`);
  broadcastState();

  // 🚀 NOVO: Começa com 1 jogador também
  if (game.players.length === 1) {
    setTimeout(() => {
      if (game.phase === 'waiting' || game.phase === 'result') {
        broadcastMessage('🎯 Apenas um jogador? Vamos começar!');
        startRound();
      }
    }, 3000);
  }

  if (game.players.length === game.maxPlayers) {
    setTimeout(startRound, 1500);
  }
  return true;
}

function removePlayer(userId) {
  const player = game.players.find(p => p.id === userId);
  if (!player) return;
  game.players = game.players.filter(p => p.id !== userId);
  if (game.currentTurn === userId) {
    game.currentTurn = game.players.length > 0 ? game.players[0].id : null;
  }
  broadcastMessage(`❌ @${player.nickname} saiu da mesa.`);
  broadcastState();
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

  // Distribui 2 cartas para cada jogador
  for (let i = 0; i < 2; i++) {
    for (const p of game.players) {
      p.hand.push(drawCard());
    }
  }

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

  // Define o primeiro turno
  const firstPlayer = game.players.find(p => !p.stand && !p.busted);
  game.currentTurn = firstPlayer ? firstPlayer.id : null;

  broadcastState();

  if (game.currentTurn) {
    const currentPlayer = game.players.find(p => p.id === game.currentTurn);
    broadcastMessage(`🎯 Nova rodada! Vez de @${currentPlayer.nickname}`);
  } else {
    broadcastMessage(`🎯 Nova rodada!`);
    // Se todos já tiverem blackjack, vai direto pro dealer
    checkRoundEnd();
  }
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
    broadcastMessage(`💥 @${player.nickname} estourou! Perdeu uma vida.`);
    if (player.lives <= 0) {
      broadcastMessage(`💀 @${player.nickname} foi eliminado!`);
      game.players = game.players.filter(p => p.id !== userId);
      if (game.currentTurn === userId) {
        const next = game.players.find(p => !p.stand && !p.busted);
        game.currentTurn = next ? next.id : null;
      }
    }
  } else if (player.score === 21) {
    player.stand = true;
    broadcastMessage(`🎯 @${player.nickname} fez 21!`);
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
  broadcastMessage(`🛑 @${player.nickname} parou com ${player.score} pontos.`);
  broadcastState();
  checkRoundEnd();
}

function checkRoundEnd() {
  // Verifica se todos os jogadores pararam ou estouraram
  const allDone = game.players.every(p => p.stand || p.busted);

  if (!allDone) {
    // Avança para o próximo jogador ativo
    const currentIndex = game.players.findIndex(p => p.id === game.currentTurn);
    let nextIndex = (currentIndex + 1) % game.players.length;
    let attempts = 0;
    while (attempts < game.players.length) {
      const next = game.players[nextIndex];
      if (!next.stand && !next.busted) {
        game.currentTurn = next.id;
        broadcastState();
        broadcastMessage(`🎯 Vez de @${next.nickname}`);
        return;
      }
      nextIndex = (nextIndex + 1) % game.players.length;
      attempts++;
    }
    // Se chegou aqui, ninguém mais pode jogar
  }

  // ROUND END - Dealer joga
  game.phase = 'dealer';
  broadcastState();
  broadcastMessage('🎩 Vez do dealer...');

  setTimeout(() => {
    // Dealer compra até 17
    while (game.dealerScore < 17) {
      game.dealerHand.push(drawCard());
      game.dealerScore = handScore(game.dealerHand);
    }

    const dealerBusted = game.dealerScore > 21;

    // Avalia resultados
    for (const p of game.players) {
      if (p.busted) continue;
      if (dealerBusted || p.score > game.dealerScore) {
        p.lives++;
        broadcastMessage(`🏆 @${p.nickname} venceu! +1 vida`);
      } else if (p.score < game.dealerScore) {
        p.lives--;
        broadcastMessage(`😢 @${p.nickname} perdeu! -1 vida`);
        if (p.lives <= 0) {
          broadcastMessage(`💀 @${p.nickname} foi eliminado!`);
        }
      } else {
        broadcastMessage(`🤝 @${p.nickname} empatou!`);
      }
    }

    // Remove eliminados
    game.players = game.players.filter(p => p.lives > 0);
    game.phase = 'result';
    broadcastState();

    // Inicia nova rodada automaticamente
    setTimeout(() => {
      if (game.players.length > 0) {
        startRound();
      } else {
        game.phase = 'waiting';
        broadcastState();
        broadcastMessage('🟢 Aguardando jogadores...');
      }
    }, 5000);

  }, 2000);
}

// =====================================================
// BROADCAST
// =====================================================

let clients = [];

function broadcastState() {
  const data = {
    type: 'state',
    data: game,
  };
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

function broadcastMessage(text) {
  const data = {
    type: 'message',
    data: text,
  };
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
  console.log(`📢 ${text}`);
}

// =====================================================
// ROTAS HTTP
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
    res.json({ success: false, error: 'Ação inválida' });
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

console.log(`🤖 Blackjack TikTok Bot iniciando...`);
console.log(`🎯 Procurando a LIVE de @${USERNAME}`);

const connection = new TikTokLiveConnection(USERNAME, {
  processInitialData: false,
});

async function connectToLive() {
  try {
    const state = await connection.connect();
    console.log(`✅ Conectado à LIVE! Room ID: ${state.roomId}`);
  } catch (error) {
    console.error('❌ Erro ao conectar:', error.message);
    setTimeout(connectToLive, 30000);
  }
}

// =====================================================
// CHAT - VERSÃO CORRIGIDA
// =====================================================

connection.on(WebcastEvent.CHAT, (data) => {
  const userId = data?.user?.id || data?.userId || null;
  const nickname = data?.user?.nickname || data?.user?.uniqueId || data?.nickname || 'anon';
  
  let comment = null;
  
  if (data?.comment) comment = data.comment;
  else if (data?.text) comment = data.text;
  else if (data?.content) comment = data.content;
  else if (data?.message) comment = data.message;
  else {
    const possibleTexts = [];
    const searchForText = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 500) {
          if (!value.match(/^\d+$/) && !value.startsWith('http') && !value.includes('2026')) {
            possibleTexts.push({ path: `${path}.${key}`, value });
          }
        } else if (value && typeof value === 'object') {
          searchForText(value, `${path}.${key}`);
        }
      }
    };
    searchForText(data);
    if (possibleTexts.length > 0) {
      const priorityPaths = ['comment', 'text', 'content', 'message', 'describe'];
      for (const priority of priorityPaths) {
        const found = possibleTexts.find(p => p.path.includes(priority));
        if (found) {
          comment = found.value;
          break;
        }
      }
      if (!comment) {
        comment = possibleTexts[0]?.value || null;
      }
    }
  }

  if (!comment || comment.trim() === '') {
    console.log(`⚠️ Comentário vazio ou não encontrado para @${nickname}`);
    return;
  }

  const message = comment.trim().toUpperCase();
  console.log(`💬 @${nickname} (${userId || 'sem ID'}): ${message}`);

  const finalUserId = userId || data?.user?.uniqueId || data?.uniqueId || `user_${Date.now()}`;

  if (message === 'BLACKJACK') {
    addPlayer(finalUserId, nickname);
    return;
  }

  const player = game.players.find(p => p.id === finalUserId);
  if (!player) return;

  if (message === '1') {
    hitPlayer(finalUserId);
  } else if (message === '2') {
    standPlayer(finalUserId);
  }
});

// =====================================================
// OUTROS EVENTOS
// =====================================================

connection.on(WebcastEvent.MEMBER, (data) => {
  const name = data?.user?.nickname || 'alguém';
  console.log(`👤 @${name} entrou na LIVE.`);
});

connection.on(WebcastEvent.LIKE, (data) => {
  const name = data?.user?.nickname || 'alguém';
  console.log(`❤️ @${name} curtiu.`);
});

connection.on(WebcastEvent.GIFT, (data) => {
  const name = data?.user?.nickname || 'alguém';
  console.log(`🎁 @${name} enviou presente.`);
});

connection.on(WebcastEvent.STREAM_END, () => {
  console.log('🔴 A LIVE terminou.');
  broadcastMessage('🔴 LIVE encerrada. O bot aguarda a próxima.');
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP ativo na porta ${PORT}`);
  console.log(`📡 SSE em /events`);
  console.log(`📡 GET /state`);
  console.log(`📡 POST /game-state`);
  connectToLive();
});
