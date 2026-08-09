/* ============================================
   BINGO MULTIPLAYER — SERVER
   Express + Socket.io
   ============================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== ROOM MANAGEMENT ====================
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// All 12 possible lines in a 5x5 grid
const LINES = [];
for (let r = 0; r < 5; r++) {
  LINES.push([r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4]);
}
for (let c = 0; c < 5; c++) {
  LINES.push([c, c + 5, c + 10, c + 15, c + 20]);
}
LINES.push([0, 6, 12, 18, 24]);
LINES.push([4, 8, 12, 16, 20]);

function createRoom(code, hostSocket, hostName) {
  return {
    code,
    players: [
      {
        socketId: hostSocket.id,
        name: hostName,
        grid: [],
        marked: new Set(),
        completedLines: 0,
        completedLineKeys: new Set(),
        ready: false,
      },
      null,
    ],
    calledNumbers: [],
    currentPlayer: 0,
    phase: 'waiting', // waiting | setup | playing | gameover
    winner: null,
  };
}

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== 25) return false;
  const sorted = [...grid].sort((a, b) => a - b);
  for (let i = 0; i < 25; i++) {
    if (sorted[i] !== i + 1) return false;
  }
  return true;
}

function getPlayerIndex(room, socketId) {
  if (room.players[0] && room.players[0].socketId === socketId) return 0;
  if (room.players[1] && room.players[1].socketId === socketId) return 1;
  return -1;
}

function checkLines(player) {
  let newLines = [];
  LINES.forEach((line, lineIndex) => {
    const key = `line-${lineIndex}`;
    if (player.completedLineKeys.has(key)) return;
    const isComplete = line.every((idx) => player.marked.has(idx));
    if (isComplete) {
      player.completedLineKeys.add(key);
      player.completedLines++;
      newLines.push({ lineIndex, cells: line });
    }
  });
  return newLines;
}

// ==================== SOCKET.IO EVENTS ====================
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // --- CREATE ROOM ---
  socket.on('create-room', ({ name }) => {
    const code = generateRoomCode();
    const room = createRoom(code, socket, name || 'Player 1');
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = 0;

    socket.emit('room-created', { code, playerIndex: 0 });
    console.log(`Room ${code} created by ${name || 'Player 1'}`);
  });

  // --- JOIN ROOM ---
  socket.on('join-room', ({ code, name }) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    if (room.players[1] !== null) {
      socket.emit('join-error', { message: 'Room is full. Only 2 players allowed.' });
      return;
    }

    // Add player 2
    room.players[1] = {
      socketId: socket.id,
      name: name || 'Player 2',
      grid: [],
      marked: new Set(),
      completedLines: 0,
      completedLineKeys: new Set(),
      ready: false,
    };

    socket.join(upperCode);
    socket.roomCode = upperCode;
    socket.playerIndex = 1;
    room.phase = 'setup';

    // Notify both players
    socket.emit('room-joined', {
      code: upperCode,
      playerIndex: 1,
      opponentName: room.players[0].name,
    });

    io.to(room.players[0].socketId).emit('opponent-joined', {
      opponentName: room.players[1].name,
    });

    // Tell both to set up their grids
    io.to(upperCode).emit('phase-setup');

    console.log(`${name || 'Player 2'} joined room ${upperCode}`);
  });

  // --- GRID READY ---
  socket.on('grid-ready', ({ grid }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const pIdx = getPlayerIndex(room, socket.id);
    if (pIdx === -1) return;

    if (!validateGrid(grid)) {
      socket.emit('grid-error', { message: 'Invalid grid. Use each number 1–25 exactly once.' });
      return;
    }

    room.players[pIdx].grid = grid;
    room.players[pIdx].ready = true;

    // Notify opponent that this player is ready
    const opponentIdx = pIdx === 0 ? 1 : 0;
    if (room.players[opponentIdx]) {
      io.to(room.players[opponentIdx].socketId).emit('opponent-ready');
    }

    // Check if both are ready
    if (room.players[0].ready && room.players[1] && room.players[1].ready) {
      // Coin toss
      room.currentPlayer = Math.random() < 0.5 ? 0 : 1;
      room.phase = 'playing';

      // Notify both players
      room.players.forEach((p, idx) => {
        io.to(p.socketId).emit('game-start', {
          firstPlayer: room.currentPlayer,
          firstPlayerName: room.players[room.currentPlayer].name,
          yourIndex: idx,
        });
      });

      console.log(`Game started in room ${socket.roomCode}. First player: ${room.players[room.currentPlayer].name}`);
    }
  });

  // --- CALL NUMBER ---
  socket.on('call-number', ({ number }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing' || room.winner !== null) return;

    const pIdx = getPlayerIndex(room, socket.id);
    if (pIdx === -1 || pIdx !== room.currentPlayer) {
      socket.emit('not-your-turn');
      return;
    }

    const num = parseInt(number);
    if (isNaN(num) || num < 1 || num > 25 || room.calledNumbers.includes(num)) {
      socket.emit('invalid-number');
      return;
    }

    room.calledNumbers.push(num);

    // Mark on both grids
    const results = [];
    room.players.forEach((player, idx) => {
      const gridIndex = player.grid.indexOf(num);
      if (gridIndex !== -1) {
        player.marked.add(gridIndex);
      }
      const newLines = checkLines(player);
      results.push({
        playerIndex: idx,
        gridIndex,
        newLines,
        completedLines: player.completedLines,
      });
    });

    // Check for winner
    let winner = null;
    if (room.players[0].completedLines >= 5 && room.players[1].completedLines >= 5) {
      // Both hit 5 at the same time — current player (who called) wins
      winner = room.currentPlayer;
    } else if (room.players[0].completedLines >= 5) {
      winner = 0;
    } else if (room.players[1].completedLines >= 5) {
      winner = 1;
    }

    if (winner !== null) {
      room.winner = winner;
      room.phase = 'gameover';
    }

    // Switch turn
    const nextPlayer = room.currentPlayer === 0 ? 1 : 0;
    room.currentPlayer = nextPlayer;

    // Broadcast to both players
    room.players.forEach((player, idx) => {
      io.to(player.socketId).emit('number-called', {
        number: num,
        calledBy: pIdx,
        calledByName: room.players[pIdx].name,
        yourGridIndex: player.grid.indexOf(num),
        yourNewLines: results[idx].newLines,
        yourCompletedLines: results[idx].completedLines,
        opponentCompletedLines: results[idx === 0 ? 1 : 0].completedLines,
        opponentNewLines: results[idx === 0 ? 1 : 0].newLines,
        nextPlayer,
        winner,
        winnerName: winner !== null ? room.players[winner].name : null,
      });
    });

    if (winner !== null) {
      console.log(`Game over in room ${socket.roomCode}. Winner: ${room.players[winner].name}`);
    }
  });

  // --- PLAY AGAIN ---
  socket.on('play-again', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const pIdx = getPlayerIndex(room, socket.id);
    if (pIdx === -1) return;

    // Reset player state
    room.players[pIdx].grid = [];
    room.players[pIdx].marked = new Set();
    room.players[pIdx].completedLines = 0;
    room.players[pIdx].completedLineKeys = new Set();
    room.players[pIdx].ready = false;

    // Check if both want to play again
    const opponentIdx = pIdx === 0 ? 1 : 0;
    const opponent = room.players[opponentIdx];
    if (opponent && !opponent.ready) {
      // Both are reset — restart
      room.calledNumbers = [];
      room.winner = null;
      room.phase = 'setup';

      io.to(socket.roomCode).emit('phase-setup');
      console.log(`Room ${socket.roomCode} restarted`);
    } else {
      // Wait for opponent
      socket.emit('waiting-opponent-rematch');
      if (opponent) {
        io.to(opponent.socketId).emit('opponent-wants-rematch', {
          name: room.players[pIdx].name,
        });
      }
    }
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const roomCode = socket.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const pIdx = getPlayerIndex(room, socket.id);
    if (pIdx === -1) return;

    const opponentIdx = pIdx === 0 ? 1 : 0;
    const opponent = room.players[opponentIdx];

    if (opponent) {
      io.to(opponent.socketId).emit('opponent-disconnected', {
        name: room.players[pIdx].name,
      });
    }

    // Clean up room after a delay
    setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (currentRoom) {
        // Check if both players are gone
        const p0Connected = currentRoom.players[0] && io.sockets.sockets.has(currentRoom.players[0].socketId);
        const p1Connected = currentRoom.players[1] && io.sockets.sockets.has(currentRoom.players[1].socketId);
        if (!p0Connected && !p1Connected) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (both players left)`);
        }
      }
    }, 30000);
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎯 BINGO Server running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);

  // Show network IP for playing from other devices
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   Network: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`\n   Share the Network URL with your friend to play!\n`);
});
