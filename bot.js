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
// ESTADO DO BLACKJACK
// =====================================================

const MAX_SEATS = 2;
const MAX_LIVES = 3;

const players = new Map();

const seats = {
  1: null,
  2: null
};

let currentPlayer = null;
let gamePhase = 'waiting';


// =====================================================
// CLIENTES SSE
// =====================================================

const clients = new Set();


// =====================================================
// FUNÇÃO PARA ENVIAR EVENTO AO BLACKJACK
// =====================================================

function broadcast(type, data = {}) {

  const message = JSON.stringify({
    type,
    ...data
  });

  for (const client of clients) {

    try {

      client.write(
        `data: ${message}\n\n`
      );

    } catch (error) {

      clients.delete(client);

    }

  }

}


// =====================================================
// ESTADO PÚBLICO
// =====================================================

function getPublicState() {

  return {

    phase: gamePhase,

    currentPlayer,

    players: {

      1: seats[1]
        ? {
            seat: 1,
            username: seats[1].username,
            displayName: seats[1].displayName,
            lives: seats[1].lives,
            playing: seats[1].playing
          }
        : null,

      2: seats[2]
        ? {
            seat: 2,
            username: seats[2].username,
            displayName: seats[2].displayName,
            lives: seats[2].lives,
            playing: seats[2].playing
          }
        : null

    }

  };

}


// =====================================================
// ENCONTRAR ASSENTO
// =====================================================

function findSeat(username) {

  for (const seat of [1, 2]) {

    if (
      seats[seat] &&
      seats[seat].username === username
    ) {

      return seat;

    }

  }

  return null;

}


// =====================================================
// ENCONTRAR ASSENTO LIVRE
// =====================================================

function findFreeSeat() {

  for (const seat of [1, 2]) {

    if (!seats[seat]) {

      return seat;

    }

  }

  return null;

}


// =====================================================
// LIMPAR JOGADOR
// =====================================================

function removePlayer(username) {

  const player = players.get(username);

  if (!player) {
    return;
  }

  const seat = player.seat;

  if (seat && seats[seat]?.username === username) {
    seats[seat] = null;
  }

  players.delete(username);

  if (currentPlayer === username) {
    currentPlayer = null;
  }

  broadcast(
    'player_removed',
    {
      username,
      seat
    }
  );

  broadcast(
    'state',
    getPublicState()
  );

}


// =====================================================
// ADICIONAR JOGADOR
// =====================================================

function joinPlayer(username, displayName) {

  // Já está na mesa
  if (players.has(username)) {

    console.log(
      `ℹ️ @${username} já está na mesa.`
    );

    return;

  }

  const seat = findFreeSeat();

  if (!seat) {

    console.log(
      `🚫 Mesa cheia. @${username} não entrou.`
    );

    broadcast(
      'table_full',
      {
        username
      }
    );

    return;

  }

  const player = {

    username,

    displayName:
      displayName ||
      username,

    seat,

    lives: MAX_LIVES,

    playing: true

  };

  players.set(
    username,
    player
  );

  seats[seat] = player;

  console.log('');
  console.log('🪑 NOVO JOGADOR');
  console.log(`👤 @${username}`);
  console.log(`💺 SEAT ${seat}`);
  console.log('❤️❤️❤️ 3 vidas');
  console.log('');

  broadcast(
    'player_joined',
    {
      username,
      displayName: player.displayName,
      seat,
      lives: player.lives
    }
  );

  broadcast(
    'state',
    getPublicState()
  );

}


// =====================================================
// COMANDO HIT
// =====================================================

function playerHit(username) {

  const player = players.get(username);

  if (!player) {
    return;
  }

  if (!player.playing) {
    return;
  }

  if (currentPlayer !== username) {

    console.log(
      `⏳ @${username} tentou HIT, mas não é a vez dele.`
    );

    broadcast(
      'invalid_turn',
      {
        username,
        command: '1'
      }
    );

    return;

  }

  console.log(
    `🃏 @${username} → HIT`
  );

  broadcast(
    'command',
    {
      command: 'HIT',
      username,
      seat: player.seat
    }
  );

}


// =====================================================
// COMANDO STAND
// =====================================================

function playerStand(username) {

  const player = players.get(username);

  if (!player) {
    return;
  }

  if (!player.playing) {
    return;
  }

  if (currentPlayer !== username) {

    console.log(
      `⏳ @${username} tentou STAND, mas não é a vez dele.`
    );

    broadcast(
      'invalid_turn',
      {
        username,
        command: '2'
      }
    );

    return;

  }

  console.log(
    `🛑 @${username} → STAND`
  );

  broadcast(
    'command',
    {
      command: 'STAND',
      username,
      seat: player.seat
    }
  );

}


// =====================================================
// RECEBER ESTADO DO JOGO
// O HTML informa ao servidor de quem é a vez.
// =====================================================

function updateGameState(body) {

  if (
    typeof body !== 'object' ||
    body === null
  ) {
    return;
  }

  if (
    typeof body.phase === 'string'
  ) {

    gamePhase = body.phase;

  }

  if (
    body.currentPlayer === null ||
    typeof body.currentPlayer === 'string'
  ) {

    currentPlayer =
      body.currentPlayer;

  }

}


// =====================================================
// PROCURAR TEXTOS NO EVENTO
// =====================================================

function findTextValues(
  obj,
  path = '',
  result = []
) {

  if (
    !obj ||
    typeof obj !== 'object'
  ) {

    return result;

  }

  for (
    const [key, value]
    of Object.entries(obj)
  ) {

    const currentPath =
      path
        ? `${path}.${key}`
        : key;

    if (
      typeof value === 'string'
    ) {

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

    }

    else if (
      value &&
      typeof value === 'object'
    ) {

      findTextValues(
        value,
        currentPath,
        result
      );

    }

  }

  return result;

}


// =====================================================
// HTTP SERVER
// =====================================================

const server = http.createServer(
  async (req, res) => {

    // -------------------------------------------------
    // CORS
    // -------------------------------------------------

    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,OPTIONS'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type'
    );


    // -------------------------------------------------
    // OPTIONS
    // -------------------------------------------------

    if (req.method === 'OPTIONS') {

      res.writeHead(
        204
      );

      res.end();

      return;

    }


    // -------------------------------------------------
    // STATUS
    // -------------------------------------------------

    if (
      req.method === 'GET' &&
      req.url === '/'
    ) {

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/html; charset=utf-8'
        }
      );

      res.end(`

        <!DOCTYPE html>

        <html>

        <head>

          <meta charset="UTF-8">

          <title>
            Blackjack TikTok Bot
          </title>

        </head>

        <body>

          <h1>
            🃏 Blackjack TikTok Bot
          </h1>

          <p>
            🟢 Server online
          </p>

          <p>
            TikTok:
            @${USERNAME}
          </p>

        </body>

        </html>

      `);

      return;

    }


    // -------------------------------------------------
    // ESTADO
    // -------------------------------------------------

    if (
      req.method === 'GET' &&
      req.url === '/state'
    ) {

      res.writeHead(
        200,
        {
          'Content-Type':
            'application/json; charset=utf-8'
        }
      );

      res.end(
        JSON.stringify(
          getPublicState()
        )
      );

      return;

    }


    // -------------------------------------------------
    // SSE
    // -------------------------------------------------

    if (
      req.method === 'GET' &&
      req.url === '/events'
    ) {

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/event-stream; charset=utf-8',

          'Cache-Control':
            'no-cache',

          'Connection':
            'keep-alive',

          'Access-Control-Allow-Origin':
            '*'
        }
      );

      res.write(
        `data: ${JSON.stringify({
          type: 'state',
          ...getPublicState()
        })}\n\n`
      );

      clients.add(res);

      console.log(
        `🖥️ Blackjack conectado. Clientes: ${clients.size}`
      );

      req.on(
        'close',
        () => {

          clients.delete(res);

          console.log(
            `🖥️ Blackjack desconectado. Clientes: ${clients.size}`
          );

        }
      );

      return;

    }


    // -------------------------------------------------
    // GAME STATE
    // -------------------------------------------------

    if (
      req.method === 'POST' &&
      req.url === '/game-state'
    ) {

      let body = '';

      req.on(
        'data',
        chunk => {

          body += chunk.toString();

        }
      );

      req.on(
        'end',
        () => {

          try {

            const data =
              JSON.parse(body);

            updateGameState(data);

            res.writeHead(
              200,
              {
                'Content-Type':
                  'application/json'
              }
            );

            res.end(
              JSON.stringify({
                ok: true,
                state:
                  getPublicState()
              })
            );

          }

          catch (error) {

            res.writeHead(
              400,
              {
                'Content-Type':
                  'application/json'
              }
            );

            res.end(
              JSON.stringify({
                ok: false,
                error:
                  'Invalid JSON'
              })
            );

          }

        }
      );

      return;

    }


    // -------------------------------------------------
    // 404
    // -------------------------------------------------

    res.writeHead(
      404,
      {
        'Content-Type':
          'text/plain; charset=utf-8'
      }
    );

    res.end(
      'Not found'
    );

  }
);


// =====================================================
// START HTTP
// =====================================================

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log('');
    console.log(
      `🌐 Servidor HTTP ativo na porta ${PORT}`
    );
    console.log('');

  }
);


// =====================================================
// TIKTOK
// =====================================================

console.log(
  '🤖 Blackjack TikTok Bot iniciando...'
);

console.log(
  `🎯 Procurando a LIVE de @${USERNAME}`
);

const connection =
  new TikTokLiveConnection(
    USERNAME,
    {
      processInitialData: false
    }
  );


// =====================================================
// CONEXÃO TIKTOK
// =====================================================

async function connectToLive() {

  try {

    const state =
      await connection.connect();

    console.log('');
    console.log(
      '🟢 CONECTADO À TIKTOK LIVE!'
    );

    console.log(
      `🎥 Room ID: ${state.roomId}`
    );

    console.log('');

  }

  catch (error) {

    console.error(
      '❌ Não foi possível conectar à LIVE:'
    );

    if (
      error?.name ===
      'UserOfflineError'
    ) {

      console.log(
        `⏳ @${USERNAME} não está ao vivo.`
      );

    }

    else {

      console.error(
        error
      );

    }

    console.log(
      '🔄 Tentando novamente em 30 segundos...'
    );

    setTimeout(
      connectToLive,
      30000
    );

  }

}


// =====================================================
// CHAT
// =====================================================

connection.on(
  WebcastEvent.CHAT,
  (data) => {

    console.log('');
    console.log(
      '📨 EVENTO DE CHAT RECEBIDO!'
    );


    // -------------------------------------------------
    // USUÁRIO
    // -------------------------------------------------

    const user =
      data?.user;


    const userId =
      user?.id ||
      user?.uid ||
      null;


    const uniqueId =
      user?.uniqueId ||
      user?.unique_id ||
      null;


    const nickname =
      user?.nickname ||
      null;


    const username =
      uniqueId ||
      nickname ||
      (
        userId
          ? `user_${userId}`
          : 'unknown_user'
      );


    const displayName =
      nickname ||
      uniqueId ||
      username;


    console.log(
      '👤 ID:',
      userId ||
        'não encontrado'
    );

    console.log(
      '👤 UNIQUE ID:',
      uniqueId ||
        'não encontrado'
    );

    console.log(
      '👤 NICKNAME:',
      nickname ||
        'não encontrado'
    );


    // -------------------------------------------------
    // TEXTO
    // -------------------------------------------------

    const texts =
      findTextValues(data);


    console.log(
      '🔎 TEXTOS ENCONTRADOS:'
    );


    for (
      const item
      of texts.slice(0, 30)
    ) {

      console.log(
        `   ${item.path} = "${item.value}"`
      );

    }


    // -------------------------------------------------
    // COMENTÁRIO
    // -------------------------------------------------

    const possibleComment =
      data?.comment ??
      data?.content ??
      data?.text ??
      data?.message ??
      data?.common?.describe ??
      null;


    if (
      possibleComment === null ||
      possibleComment === undefined
    ) {

      console.log(
        '⚠️ Texto não encontrado.'
      );

      return;

    }


    const message =
      String(
        possibleComment
      )
      .trim()
      .toUpperCase();


    console.log(
      `💬 @${username}: ${message}`
    );


    // =================================================
    // BLACKJACK
    // =================================================

    if (
      message === 'BLACKJACK'
    ) {

      joinPlayer(
        username,
        displayName
      );

      return;

    }


    // =================================================
    // PLAYER PRECISA ESTAR NA MESA
    // =================================================

    if (
      !players.has(username)
    ) {

      console.log(
        `ℹ️ @${username} não está na mesa.`
      );

      return;

    }


    const player =
      players.get(username);


    if (
      !player.playing
    ) {

      return;

    }


    // =================================================
    // HIT
    // =================================================

    if (
      message === '1'
    ) {

      playerHit(
        username
      );

      return;

    }


    // =================================================
    // STAND
    // =================================================

    if (
      message === '2'
    ) {

      playerStand(
        username
      );

      return;

    }

  }
);


// =====================================================
// MEMBER
// =====================================================

connection.on(
  WebcastEvent.MEMBER,
  (data) => {

    const username =
      data?.user?.uniqueId ||
      data?.user?.nickname ||
      `user_${data?.user?.id || 'unknown'}`;

    console.log(
      `👤 @${username} entrou na LIVE.`
    );

  }
);


// =====================================================
// LIKE
// =====================================================

connection.on(
  WebcastEvent.LIKE,
  (data) => {

    const username =
      data?.user?.uniqueId ||
      data?.user?.nickname ||
      `user_${data?.user?.id || 'unknown'}`;

    console.log(
      `❤️ @${username} curtiu a LIVE.`
    );

  }
);


// =====================================================
// FOLLOW
// =====================================================

connection.on(
  WebcastEvent.FOLLOW,
  (data) => {

    const username =
      data?.user?.uniqueId ||
      data?.user?.nickname ||
      `user_${data?.user?.id || 'unknown'}`;

    console.log(
      `➕ @${username} seguiu a LIVE.`
    );

  }
);


// =====================================================
// SHARE
// =====================================================

connection.on(
  WebcastEvent.SHARE,
  (data) => {

    const username =
      data?.user?.uniqueId ||
      data?.user?.nickname ||
      `user_${data?.user?.id || 'unknown'}`;

    console.log(
      `📤 @${username} compartilhou a LIVE.`
    );

  }
);


// =====================================================
// GIFT
// =====================================================

connection.on(
  WebcastEvent.GIFT,
  (data) => {

    const username =
      data?.user?.uniqueId ||
      data?.user?.nickname ||
      `user_${data?.user?.id || 'unknown'}`;

    console.log(
      `🎁 @${username} enviou um presente.`
    );

  }
);


// =====================================================
// STREAM END
// =====================================================

connection.on(
  WebcastEvent.STREAM_END,
  () => {

    console.log('');
    console.log(
      '🔴 A LIVE terminou.'
    );
    console.log('');

    gamePhase =
      'waiting';

    currentPlayer =
      null;

    broadcast(
      'stream_end'
    );

  }
);


// =====================================================
// INICIAR
// =====================================================

connectToLive();
