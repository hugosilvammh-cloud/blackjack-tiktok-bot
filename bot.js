import http from 'http';
import {
  TikTokLiveConnection,
  WebcastEvent
} from 'tiktok-live-connector';


// =====================================================
// CONFIGURAÇÃO
// =====================================================

const PORT = process.env.PORT || 10000;
const USERNAME = process.env.TIKTOK_USERNAME;

if (!USERNAME) {
  console.error('');
  console.error('❌ TIKTOK_USERNAME não configurado.');
  console.error('');
  process.exit(1);
}


// =====================================================
// BLACKJACK
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
// BROADCAST
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
// ENCONTRAR JOGADOR
// =====================================================

function findPlayer(username) {

  if (!username) {
    return null;
  }

  return players.get(username) || null;

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
// ASSENTO LIVRE
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
// REMOVER JOGADOR
// =====================================================

function removePlayer(username) {

  const player = players.get(username);

  if (!player) {
    return;
  }

  const seat = player.seat;

  if (
    seat &&
    seats[seat] &&
    seats[seat].username === username
  ) {

    seats[seat] = null;

  }

  players.delete(username);

  if (currentPlayer === username) {

    currentPlayer = null;

  }

  console.log('');
  console.log(`🚪 Jogador removido: @${username}`);
  console.log(`💺 Seat: ${seat}`);
  console.log('');

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

  if (!username) {
    return;
  }


  // ---------------------------------------------------
  // JÁ ESTÁ NA MESA
  // ---------------------------------------------------

  if (players.has(username)) {

    console.log(
      `ℹ️ @${username} já está na mesa.`
    );

    broadcast(
      'already_joined',
      {
        username
      }
    );

    return;

  }


  // ---------------------------------------------------
  // PROCURAR VAGA
  // ---------------------------------------------------

  const seat = findFreeSeat();


  // ---------------------------------------------------
  // MESA CHEIA
  // ---------------------------------------------------

  if (!seat) {

    console.log('');
    console.log(
      `🚫 Mesa cheia. @${username} não entrou.`
    );
    console.log('');

    broadcast(
      'table_full',
      {
        username,
        maxSeats: MAX_SEATS
      }
    );

    return;

  }


  // ---------------------------------------------------
  // CRIAR JOGADOR
  // ---------------------------------------------------

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


  // ---------------------------------------------------
  // LOG
  // ---------------------------------------------------

  console.log('');
  console.log('🪑 NOVO JOGADOR');
  console.log(`👤 @${username}`);
  console.log(`💬 ${player.displayName}`);
  console.log(`💺 SEAT ${seat}`);
  console.log('❤️❤️❤️ 3 vidas');
  console.log('');


  // ---------------------------------------------------
  // AVISAR HTML
  // ---------------------------------------------------

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
// HIT
// =====================================================

function playerHit(username) {

  const player = findPlayer(username);

  if (!player) {

    console.log(
      `⚠️ HIT ignorado: @${username} não está na mesa.`
    );

    return;

  }


  if (!player.playing) {

    return;

  }


  // ---------------------------------------------------
  // VERIFICAR VEZ
  // ---------------------------------------------------

  if (currentPlayer !== username) {

    console.log(
      `⏳ @${username} tentou HIT, mas não é a vez dele.`
    );

    broadcast(
      'invalid_turn',
      {
        username,
        command: '1',
        currentPlayer
      }
    );

    return;

  }


  // ---------------------------------------------------
  // HIT
  // ---------------------------------------------------

  console.log('');
  console.log(`🃏 @${username} → HIT`);
  console.log(`💺 Seat ${player.seat}`);
  console.log('');


  broadcast(
    'command',
    {
      command: 'HIT',
      username,
      displayName: player.displayName,
      seat: player.seat
    }
  );

}


// =====================================================
// STAND
// =====================================================

function playerStand(username) {

  const player = findPlayer(username);

  if (!player) {

    console.log(
      `⚠️ STAND ignorado: @${username} não está na mesa.`
    );

    return;

  }


  if (!player.playing) {

    return;

  }


  // ---------------------------------------------------
  // VERIFICAR VEZ
  // ---------------------------------------------------

  if (currentPlayer !== username) {

    console.log(
      `⏳ @${username} tentou STAND, mas não é a vez dele.`
    );

    broadcast(
      'invalid_turn',
      {
        username,
        command: '2',
        currentPlayer
      }
    );

    return;

  }


  // ---------------------------------------------------
  // STAND
  // ---------------------------------------------------

  console.log('');
  console.log(`🛑 @${username} → STAND`);
  console.log(`💺 Seat ${player.seat}`);
  console.log('');


  broadcast(
    'command',
    {
      command: 'STAND',
      username,
      displayName: player.displayName,
      seat: player.seat
    }
  );

}


// =====================================================
// ATUALIZAR ESTADO DO JOGO
// O HTML envia essas informações.
// =====================================================

function updateGameState(body) {

  if (
    typeof body !== 'object' ||
    body === null
  ) {

    return;

  }


  // ---------------------------------------------------
  // FASE
  // ---------------------------------------------------

  if (
    typeof body.phase === 'string'
  ) {

    gamePhase = body.phase;

  }


  // ---------------------------------------------------
  // JOGADOR ATUAL
  // ---------------------------------------------------

  if (
    body.currentPlayer === null ||
    typeof body.currentPlayer === 'string'
  ) {

    currentPlayer =
      body.currentPlayer;

  }


  // ---------------------------------------------------
  // SE O HTML MANDAR O SEAT
  // ---------------------------------------------------

  if (
    body.currentSeat !== undefined &&
    body.currentSeat !== null
  ) {

    const seat =
      Number(body.currentSeat);

    if (
      seat === 1 ||
      seat === 2
    ) {

      if (seats[seat]) {

        currentPlayer =
          seats[seat].username;

      }

    }

  }


  // ---------------------------------------------------
  // BROADCAST DO ESTADO
  // ---------------------------------------------------

  broadcast(
    'state',
    getPublicState()
  );

}


// =====================================================
// ENCONTRAR TEXTOS DENTRO DO EVENTO
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
        !value.startsWith('http')
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

const server =
  http.createServer(
    async (req, res) => {


      // =================================================
      // CORS
      // =================================================

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


      // =================================================
      // OPTIONS
      // =================================================

      if (
        req.method === 'OPTIONS'
      ) {

        res.writeHead(204);

        res.end();

        return;

      }


      // =================================================
      // HOME
      // =================================================

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

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>Blackjack TikTok Bot</title>

</head>

<body>

<h1>🃏 Blackjack TikTok Bot</h1>

<p>🟢 Server online</p>

<p>
TikTok:
<strong>@${USERNAME}</strong>
</p>

<p>
Players:
<strong>${players.size}/${MAX_SEATS}</strong>
</p>

<p>
Phase:
<strong>${gamePhase}</strong>
</p>

</body>

</html>

        `);

        return;

      }


      // =================================================
      // STATE
      // =================================================

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


      // =================================================
      // SSE
      // =================================================

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
              'no-cache, no-transform',

            'Connection':
              'keep-alive',

            'Access-Control-Allow-Origin':
              '*'
          }
        );


        // -------------------------------------------------
        // PRIMEIRO ESTADO
        // -------------------------------------------------

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


        // -------------------------------------------------
        // KEEP ALIVE
        // -------------------------------------------------

        const keepAlive =
          setInterval(
            () => {

              try {

                res.write(': ping\n\n');

              } catch {

                clearInterval(
                  keepAlive
                );

                clients.delete(res);

              }

            },
            15000
          );


        // -------------------------------------------------
        // DESCONECTOU
        // -------------------------------------------------

        req.on(
          'close',
          () => {

            clearInterval(
              keepAlive
            );

            clients.delete(res);

            console.log(
              `🖥️ Blackjack desconectado. Clientes: ${clients.size}`
            );

          }
        );


        return;

      }


      // =================================================
      // GAME STATE
      // =================================================

      if (
        req.method === 'POST' &&
        req.url === '/game-state'
      ) {

        let body = '';


        req.on(
          'data',
          chunk => {

            body +=
              chunk.toString();

          }
        );


        req.on(
          'end',
          () => {

            try {

              const data =
                JSON.parse(body);


              updateGameState(
                data
              );


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

              console.error(
                '❌ Erro no /game-state:',
                error
              );


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


      // =================================================
      // 404
      // =================================================

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
      '======================================'
    );
    console.log(
      '🃏 BLACKJACK TIKTOK BOT'
    );
    console.log(
      '======================================'
    );
    console.log(
      `🌐 HTTP: porta ${PORT}`
    );
    console.log(
      `🎯 TikTok: @${USERNAME}`
    );
    console.log(
      '======================================'
    );
    console.log('');

  }
);


// =====================================================
// TIKTOK CONNECTION
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
// CONECTAR À LIVE
// =====================================================

let connecting = false;

async function connectToLive() {

  if (connecting) {
    return;
  }

  connecting = true;


  try {

    console.log('');
    console.log(
      `🔄 Conectando à LIVE de @${USERNAME}...`
    );


    const state =
      await connection.connect();


    connecting = false;


    console.log('');
    console.log(
      '🟢 CONECTADO À TIKTOK LIVE!'
    );

    console.log(
      `🎥 Room ID: ${state.roomId}`
    );

    console.log(
      `👤 @${USERNAME}`
    );

    console.log('');


    broadcast(
      'tiktok_connected',
      {
        username: USERNAME,
        roomId: state.roomId
      }
    );

  }

  catch (error) {

    connecting = false;


    console.error('');
    console.error(
      '❌ Não foi possível conectar à LIVE.'
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
        error?.message ||
        error
      );

    }


    console.log(
      '🔄 Nova tentativa em 30 segundos...'
    );

    console.log('');


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
      '📨 CHAT RECEBIDO'
    );


    // =================================================
    // USUÁRIO
    // =================================================

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


    // -------------------------------------------------
    // IDENTIDADE PRINCIPAL
    // -------------------------------------------------

    const username =
      uniqueId ||
      (
        userId
          ? `user_${userId}`
          : nickname
            ? nickname
            : 'unknown_user'
      );


    const displayName =
      nickname ||
      uniqueId ||
      username;


    console.log(
      `👤 ID: ${userId || 'não encontrado'}`
    );

    console.log(
      `👤 UNIQUE ID: ${uniqueId || 'não encontrado'}`
    );

    console.log(
      `👤 NICKNAME: ${nickname || 'não encontrado'}`
    );


    // =================================================
    // TEXTO
    // =================================================

    let possibleComment =
      data?.comment ??
      data?.content ??
      data?.text ??
      data?.message ??
      data?.common?.describe ??
      null;


    // -------------------------------------------------
    // TENTAR OUTROS CAMPOS
    // -------------------------------------------------

    if (
      possibleComment === null ||
      possibleComment === undefined
    ) {

      const texts =
        findTextValues(data);


      console.log(
        '🔎 Textos encontrados no evento:'
      );


      for (
        const item
        of texts.slice(0, 20)
      ) {

        console.log(
          `   ${item.path} = "${item.value}"`
        );

      }


      // -------------------------------------------------
      // PROCURAR COMENTÁRIO PROVÁVEL
      // -------------------------------------------------

      const possible =
        texts.find(
          item => {

            const value =
              item.value
                .trim()
                .toUpperCase();

            return (
              value === 'BLACKJACK' ||
              value === '1' ||
              value === '2'
            );

          }
        );


      if (possible) {

        possibleComment =
          possible.value;

      }

    }


    // =================================================
    // SEM TEXTO
    // =================================================

    if (
      possibleComment === null ||
      possibleComment === undefined
    ) {

      console.log(
        '⚠️ Texto do comentário não encontrado.'
      );

      return;

    }


    // =================================================
    // NORMALIZAR
    // =================================================

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
    // VERIFICAR SE ESTÁ NA MESA
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
      (
        data?.user?.id
          ? `user_${data.user.id}`
          : 'unknown'
      );


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
      (
        data?.user?.id
          ? `user_${data.user.id}`
          : 'unknown'
      );


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
      (
        data?.user?.id
          ? `user_${data.user.id}`
          : 'unknown'
      );


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
      (
        data?.user?.id
          ? `user_${data.user.id}`
          : 'unknown'
      );


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
      (
        data?.user?.id
          ? `user_${data.user.id}`
          : 'unknown'
      );


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
      'stream_end',
      {
        username: USERNAME
      }
    );


    broadcast(
      'state',
      getPublicState()
    );


    // -------------------------------------------------
    // LIMPAR MESA
    // -------------------------------------------------

    players.clear();

    seats[1] = null;
    seats[2] = null;


    broadcast(
      'state',
      getPublicState()
    );


    // -------------------------------------------------
    // TENTAR NOVAMENTE
    // -------------------------------------------------

    setTimeout(
      connectToLive,
      30000
    );

  }
);


// =====================================================
// ERROS DA CONEXÃO
// =====================================================

connection.on(
  'error',
  (error) => {

    console.error(
      '❌ Erro TikTok:',
      error?.message ||
      error
    );

  }
);


// =====================================================
// INICIAR
// =====================================================

connectToLive();
