/* ============================================
   BINGO MULTIPLAYER — CLIENT GAME LOGIC
   Socket.io Client + Session Reconnection
   ============================================ */

(function () {
  'use strict';

  // ==================== SESSION ====================
  // Unique session ID persisted across reconnects and tab switches
  let sessionId = sessionStorage.getItem('bingo-session-id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessionStorage.setItem('bingo-session-id', sessionId);
  }

  // ==================== SOCKET ====================
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  // ==================== STATE ====================
  const state = {
    myName: '',
    opponentName: '',
    myIndex: -1,
    myGrid: [],
    markedIndices: new Set(),
    myCompletedLines: 0,
    opponentCompletedLines: 0,
    calledNumbers: [],
    isMyTurn: false,
    fillSelectedCell: null,
    tempGrid: new Array(25).fill(null),
    roomCode: '',
    inRoom: false, // tracks if we're actively in a room
  };

  // All 12 possible lines
  const LINES = [];
  for (let r = 0; r < 5; r++) LINES.push([r*5, r*5+1, r*5+2, r*5+3, r*5+4]);
  for (let c = 0; c < 5; c++) LINES.push([c, c+5, c+10, c+15, c+20]);
  LINES.push([0, 6, 12, 18, 24]);
  LINES.push([4, 8, 12, 16, 20]);

  // ==================== DOM ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    welcome: $('#screen-welcome'),
    waiting: $('#screen-waiting'),
    setup: $('#screen-setup'),
    coinToss: $('#screen-coin-toss'),
    game: $('#screen-game'),
    gameover: $('#screen-gameover'),
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
  }

  // ==================== PARTICLES ====================
  function createParticles() {
    const container = $('#particles');
    const colors = ['#7c3aed', '#a855f7', '#3b82f6', '#f43f5e', '#c084fc'];
    for (let i = 0; i < 25; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const size = Math.random() * 5 + 3;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = Math.random() * 100 + '%';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = (Math.random() * 15 + 10) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      container.appendChild(p);
    }
  }

  // ==================== WELCOME SCREEN ====================
  function initWelcome() {
    // Rules modal
    $('#btn-rules').addEventListener('click', () => $('#modal-rules').classList.add('active'));
    $('#btn-close-rules').addEventListener('click', () => $('#modal-rules').classList.remove('active'));
    $('#modal-rules .modal-overlay').addEventListener('click', () => $('#modal-rules').classList.remove('active'));

    // Create room
    $('#btn-create').addEventListener('click', () => {
      state.myName = $('#input-name').value.trim() || 'Player';
      socket.emit('create-room', { name: state.myName, sessionId });
    });

    // Show join form
    $('#btn-join-show').addEventListener('click', () => {
      $('#join-form').classList.toggle('hidden');
      if (!$('#join-form').classList.contains('hidden')) {
        setTimeout(() => $('#input-code').focus(), 100);
      }
    });

    // Join room
    $('#btn-join').addEventListener('click', joinRoom);
    $('#input-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom();
    });

    function joinRoom() {
      const code = $('#input-code').value.trim();
      if (!code || code.length < 4) {
        showJoinError('Please enter a valid room code.');
        return;
      }
      state.myName = $('#input-name').value.trim() || 'Player';
      socket.emit('join-room', { code, name: state.myName, sessionId });
    }
  }

  function showJoinError(msg) {
    const el = $('#join-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ==================== WAITING SCREEN ====================
  function showWaitingScreen(code) {
    state.roomCode = code;
    state.inRoom = true;
    showScreen('waiting');
    $('#code-chars').textContent = code;

    $('#btn-copy-code').onclick = () => {
      navigator.clipboard.writeText(code).then(() => {
        const fb = $('#copy-feedback');
        fb.classList.remove('hidden');
        setTimeout(() => fb.classList.add('hidden'), 2000);
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const fb = $('#copy-feedback');
        fb.classList.remove('hidden');
        setTimeout(() => fb.classList.add('hidden'), 2000);
      });
    };
  }

  // ==================== GRID SETUP ====================
  function showGridSetup() {
    showScreen('setup');
    state.tempGrid = new Array(25).fill(null);
    state.fillSelectedCell = 0;

    const grid = $('#fill-grid');
    grid.innerHTML = '';

    // Re-enable buttons
    const confirmBtn = $('#btn-confirm-grid');
    confirmBtn.disabled = true;
    confirmBtn.querySelector('span').textContent = 'Lock In Grid';
    $('#btn-fill-random').disabled = false;
    $('#btn-clear-grid').disabled = false;

    for (let i = 0; i < 25; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.index = i;
      cell.style.pointerEvents = 'auto'; // ensure clickable
      cell.addEventListener('click', () => {
        $$('#fill-grid .grid-cell').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        state.fillSelectedCell = i;
      });
      grid.appendChild(cell);
    }

    // Select first cell
    grid.children[0].classList.add('selected');

    // Remaining numbers
    renderRemainingNumbers();

    // Clear
    $('#btn-clear-grid').onclick = () => {
      state.tempGrid.fill(null);
      state.fillSelectedCell = 0;
      $$('#fill-grid .grid-cell').forEach(c => {
        c.textContent = '';
        c.classList.remove('filled', 'selected');
      });
      grid.children[0].classList.add('selected');
      renderRemainingNumbers();
      updateConfirmBtn();
    };

    // Random
    $('#btn-fill-random').onclick = () => {
      const shuffled = shuffleArray([...Array(25)].map((_, j) => j + 1));
      for (let i = 0; i < 25; i++) {
        state.tempGrid[i] = shuffled[i];
        const cell = grid.children[i];
        cell.textContent = shuffled[i];
        cell.classList.add('filled');
        cell.classList.remove('selected');
      }
      state.fillSelectedCell = null;
      renderRemainingNumbers();
      updateConfirmBtn();
    };

    // Confirm
    $('#btn-confirm-grid').onclick = () => {
      state.myGrid = [...state.tempGrid];
      socket.emit('grid-ready', { grid: state.myGrid });
      confirmBtn.disabled = true;
      confirmBtn.querySelector('span').textContent = 'Waiting for opponent...';
      $('#btn-fill-random').disabled = true;
      $('#btn-clear-grid').disabled = true;
      $$('#fill-grid .grid-cell').forEach(c => {
        c.style.pointerEvents = 'none';
      });
    };

    // Opponent status
    const oppStatus = $('#opponent-status');
    oppStatus.classList.remove('ready');
    oppStatus.querySelector('span').textContent = `${state.opponentName} is setting up...`;

    updateConfirmBtn();
  }

  function renderRemainingNumbers() {
    const container = $('#remaining-numbers');
    container.innerHTML = '';
    for (let n = 1; n <= 25; n++) {
      const el = document.createElement('div');
      el.className = 'remaining-num' + (state.tempGrid.includes(n) ? ' used' : '');
      el.textContent = n;
      if (!state.tempGrid.includes(n)) {
        el.addEventListener('click', () => placeNumber(n));
      }
      container.appendChild(el);
    }
  }

  function placeNumber(num) {
    if (state.fillSelectedCell === null) return;
    const grid = $('#fill-grid');

    const oldIdx = state.tempGrid.indexOf(num);
    if (oldIdx !== -1) {
      state.tempGrid[oldIdx] = null;
      grid.children[oldIdx].textContent = '';
      grid.children[oldIdx].classList.remove('filled');
    }

    state.tempGrid[state.fillSelectedCell] = num;
    const cell = grid.children[state.fillSelectedCell];
    cell.textContent = num;
    cell.classList.add('filled');
    cell.classList.remove('selected');

    state.fillSelectedCell = state.tempGrid.indexOf(null);
    if (state.fillSelectedCell !== -1) {
      $$('#fill-grid .grid-cell').forEach(c => c.classList.remove('selected'));
      grid.children[state.fillSelectedCell].classList.add('selected');
    }

    renderRemainingNumbers();
    updateConfirmBtn();
  }

  function updateConfirmBtn() {
    const allFilled = state.tempGrid.every(v => v !== null);
    const unique = new Set(state.tempGrid.filter(v => v !== null));
    $('#btn-confirm-grid').disabled = !(allFilled && unique.size === 25);
  }

  // ==================== COIN TOSS ====================
  function showCoinToss(firstPlayer, firstPlayerName) {
    showScreen('coinToss');
    const coin = $('#coin');
    const isMyTurn = (firstPlayer === state.myIndex);

    coin.className = 'coin flipping' + (firstPlayer === 1 ? ' land-tails' : '');

    setTimeout(() => {
      const resultEl = $('#toss-result');
      if (isMyTurn) {
        resultEl.textContent = '🎉 You go first!';
      } else {
        resultEl.textContent = `${firstPlayerName} goes first`;
      }
      setTimeout(() => startGame(firstPlayer), 1500);
    }, 2200);
  }

  // ==================== GAME ====================
  function startGame(firstPlayer) {
    showScreen('game');

    state.markedIndices = new Set();
    state.myCompletedLines = 0;
    state.opponentCompletedLines = 0;
    state.calledNumbers = [];
    state.isMyTurn = (firstPlayer === state.myIndex);

    $('#your-name-display').textContent = state.myName;
    $('#opp-name-display').textContent = state.opponentName;

    $$('#bingo-you .bingo-letter, #bingo-opp .bingo-letter').forEach(l => l.classList.remove('lit'));

    renderGameGrid();
    renderNumberPad();

    $('#called-numbers').innerHTML = '';

    updateTurnUI();
  }

  // Restore game state after reconnect
  function restoreGameState(data) {
    state.myIndex = data.playerIndex;
    state.myName = data.myName;
    state.opponentName = data.opponentName;
    state.roomCode = data.roomCode;
    state.inRoom = true;
    state.myGrid = data.myGrid;
    state.calledNumbers = data.calledNumbers;
    state.myCompletedLines = data.myCompletedLines;
    state.opponentCompletedLines = data.opponentCompletedLines;
    state.markedIndices = new Set(data.myMarked);
    state.isMyTurn = data.isMyTurn;

    // Hide disconnect overlay if showing
    $('#overlay-disconnect').classList.add('hidden');

    if (data.phase === 'waiting') {
      showWaitingScreen(data.roomCode);
    } else if (data.phase === 'setup') {
      showGridSetup();
    } else if (data.phase === 'playing') {
      showScreen('game');

      $('#your-name-display').textContent = state.myName;
      $('#opp-name-display').textContent = state.opponentName;

      // Render grid with marks
      renderGameGrid();
      state.markedIndices.forEach(idx => {
        const cell = $('#game-grid').children[idx];
        if (cell) cell.classList.add('marked');
      });

      // Check which lines are complete and highlight them
      LINES.forEach(line => {
        const isComplete = line.every(idx => state.markedIndices.has(idx));
        if (isComplete) {
          line.forEach(idx => {
            const cell = $('#game-grid').children[idx];
            if (cell) cell.classList.add('line-complete');
          });
        }
      });

      // Render number pad with called numbers
      renderNumberPad();
      state.calledNumbers.forEach(num => {
        const btn = $(`.num-btn[data-number="${num}"]`);
        if (btn) { btn.classList.add('called'); btn.disabled = true; }
      });

      // Render called numbers display
      $('#called-numbers').innerHTML = '';
      state.calledNumbers.forEach(num => {
        const el = document.createElement('div');
        el.className = 'called-num';
        el.textContent = num;
        $('#called-numbers').appendChild(el);
      });

      // Update BINGO letters
      updateBingoLetters('bingo-you', state.myCompletedLines);
      updateBingoLetters('bingo-opp', state.opponentCompletedLines);

      updateTurnUI();
    } else if (data.phase === 'gameover') {
      showGameOver(data.winner === state.myIndex);
    }
  }

  function renderGameGrid() {
    const grid = $('#game-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 25; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.index = i;
      cell.textContent = state.myGrid[i];
      grid.appendChild(cell);
    }
  }

  function renderNumberPad() {
    const pad = $('#number-pad');
    pad.innerHTML = '';
    for (let n = 1; n <= 25; n++) {
      const btn = document.createElement('button');
      btn.className = 'num-btn';
      btn.dataset.number = n;
      btn.textContent = n;
      btn.addEventListener('click', () => {
        if (!state.isMyTurn) return;
        if (state.calledNumbers.includes(n)) return;
        socket.emit('call-number', { number: n });
        setNumberPadEnabled(false);
      });
      pad.appendChild(btn);
    }
  }

  function setNumberPadEnabled(enabled) {
    $$('.num-btn').forEach(btn => {
      if (!btn.classList.contains('called')) {
        btn.disabled = !enabled;
      }
    });
  }

  function updateTurnUI() {
    const indicator = $('#turn-indicator');
    const turnText = $('#turn-text');

    if (state.isMyTurn) {
      indicator.className = 'turn-indicator your-turn';
      turnText.textContent = 'Your Turn — Call a Number!';
      setNumberPadEnabled(true);
    } else {
      indicator.className = 'turn-indicator opp-turn';
      turnText.textContent = `${state.opponentName}'s Turn...`;
      setNumberPadEnabled(false);
    }
  }

  function handleNumberCalled(data) {
    const {
      number, yourGridIndex, yourNewLines,
      yourCompletedLines, opponentCompletedLines, opponentNewLines,
      nextPlayer, winner
    } = data;

    state.calledNumbers.push(number);

    const btn = $(`.num-btn[data-number="${number}"]`);
    if (btn) { btn.classList.add('called'); btn.disabled = true; }

    const calledEl = document.createElement('div');
    calledEl.className = 'called-num';
    calledEl.textContent = number;
    $('#called-numbers').appendChild(calledEl);

    if (yourGridIndex !== -1) {
      state.markedIndices.add(yourGridIndex);
      const cell = $('#game-grid').children[yourGridIndex];
      cell.classList.add('marked', 'just-marked');
      setTimeout(() => cell.classList.remove('just-marked'), 400);
    }

    state.myCompletedLines = yourCompletedLines;
    if (yourNewLines && yourNewLines.length > 0) {
      yourNewLines.forEach(line => {
        line.cells.forEach(idx => {
          $('#game-grid').children[idx].classList.add('line-complete');
        });
      });
      updateBingoLetters('bingo-you', yourCompletedLines);
    }

    state.opponentCompletedLines = opponentCompletedLines;
    if (opponentNewLines && opponentNewLines.length > 0) {
      updateBingoLetters('bingo-opp', opponentCompletedLines);
    }

    if (winner !== null) {
      setTimeout(() => {
        showGameOver(winner === state.myIndex);
      }, 800);
      return;
    }

    state.isMyTurn = (nextPlayer === state.myIndex);
    updateTurnUI();
  }

  function updateBingoLetters(containerId, count) {
    const letters = $$(`#${containerId} .bingo-letter`);
    for (let i = 0; i < 5; i++) {
      if (i < count) {
        letters[i].classList.add('lit');
      } else {
        letters[i].classList.remove('lit');
      }
    }
  }

  // ==================== GAME OVER ====================
  function showGameOver(isWinner) {
    showScreen('gameover');

    // Reset play again button
    const playAgainBtn = $('#btn-play-again');
    playAgainBtn.disabled = false;
    playAgainBtn.textContent = 'Play Again';

    if (isWinner) {
      $('#result-icon').textContent = '🏆';
      $('#result-title').textContent = 'You Win!';
      $('#result-title').className = 'result-title win';
      $('#result-subtitle').textContent = 'You completed BINGO first!';
      startConfetti();
    } else {
      $('#result-icon').textContent = '😔';
      $('#result-title').textContent = 'You Lose';
      $('#result-title').className = 'result-title lose';
      $('#result-subtitle').textContent = `${state.opponentName} completed BINGO first.`;
    }

    $$('.win-letter').forEach(l => {
      l.style.animation = 'none';
      l.offsetHeight;
      l.style.animation = '';
    });
  }

  function startConfetti() {
    const canvas = $('#confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#7c3aed', '#a855f7', '#3b82f6', '#f43f5e', '#22c55e', '#f59e0b', '#c084fc'];

    for (let i = 0; i < 150; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 3 + 1.5,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.1,
        drift: (Math.random() - 0.5) * 0.8,
      });
    }

    let frame = 0;
    const maxFrames = 250;

    function animate() {
      if (frame > maxFrames) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      pieces.forEach(p => {
        p.y += p.speed;
        p.x += p.drift;
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = frame > maxFrames - 50 ? (maxFrames - frame) / 50 : 1;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
      });

      frame++;
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ==================== PLAY AGAIN / HOME ====================
  function initGameOverButtons() {
    $('#btn-play-again').addEventListener('click', () => {
      socket.emit('play-again');
      const btn = $('#btn-play-again');
      btn.disabled = true;
      btn.textContent = 'Waiting for opponent...';
    });

    $('#btn-home').addEventListener('click', () => {
      // Clear session so we get a fresh one
      sessionStorage.removeItem('bingo-session-id');
      location.reload();
    });

    $('#btn-back-home').addEventListener('click', () => {
      sessionStorage.removeItem('bingo-session-id');
      location.reload();
    });
  }

  // ==================== SOCKET EVENTS ====================
  function initSocketEvents() {
    // --- Connection events ---
    socket.on('connect', () => {
      $('#connection-status').classList.remove('disconnected');
      $('#connection-status').querySelector('span').textContent = 'Connected';

      // Try to rejoin if we were in a room
      if (state.inRoom) {
        socket.emit('rejoin', { sessionId });
      }
    });

    socket.on('disconnect', () => {
      $('#connection-status').classList.add('disconnected');
      $('#connection-status').querySelector('span').textContent = 'Reconnecting...';
    });

    socket.on('reconnect_failed', () => {
      $('#connection-status').querySelector('span').textContent = 'Disconnected';
    });

    // --- Rejoin responses ---
    socket.on('rejoin-success', (data) => {
      console.log('Rejoined room successfully!', data.roomCode);
      restoreGameState(data);
    });

    socket.on('rejoin-failed', () => {
      console.log('Rejoin failed — starting fresh');
      state.inRoom = false;
      showScreen('welcome');
    });

    // --- Room events ---
    socket.on('room-created', ({ code, playerIndex }) => {
      state.myIndex = playerIndex;
      state.inRoom = true;
      showWaitingScreen(code);
    });

    socket.on('room-joined', ({ code, playerIndex, opponentName }) => {
      state.myIndex = playerIndex;
      state.roomCode = code;
      state.opponentName = opponentName;
      state.inRoom = true;
    });

    socket.on('opponent-joined', ({ opponentName }) => {
      state.opponentName = opponentName;
    });

    socket.on('join-error', ({ message }) => {
      showJoinError(message);
    });

    // --- Game phases ---
    socket.on('phase-setup', () => {
      showGridSetup();
    });

    socket.on('opponent-ready', () => {
      const oppStatus = $('#opponent-status');
      if (oppStatus) {
        oppStatus.classList.add('ready');
        oppStatus.querySelector('span').textContent = `${state.opponentName} is ready! ✓`;
      }
    });

    socket.on('game-start', ({ firstPlayer, firstPlayerName, yourIndex }) => {
      state.myIndex = yourIndex;
      showCoinToss(firstPlayer, firstPlayerName);
    });

    socket.on('number-called', (data) => {
      handleNumberCalled(data);
    });

    socket.on('not-your-turn', () => {
      updateTurnUI();
    });

    // --- Disconnect / Reconnect ---
    socket.on('opponent-disconnected', ({ name }) => {
      const overlay = $('#overlay-disconnect');
      overlay.classList.remove('hidden');
      $('#disconnect-text').textContent = `${name} lost connection. Waiting for them to reconnect...`;
    });

    socket.on('opponent-reconnected', ({ name }) => {
      // Hide disconnect overlay
      $('#overlay-disconnect').classList.add('hidden');
    });

    // --- Rematch ---
    socket.on('opponent-wants-rematch', ({ name }) => {
      // Show a notification or auto-accept by also clicking play again
      // For now, show on the button
      const btn = $('#btn-play-again');
      if (btn && !btn.disabled) {
        btn.textContent = `${name} wants rematch! Click to accept`;
        btn.classList.add('btn-glow');
      }
    });

    socket.on('waiting-opponent-rematch', () => {
      // Already showing "Waiting..." on button
    });
  }

  // ==================== UTILS ====================
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ==================== INIT ====================
  function init() {
    createParticles();
    initWelcome();
    initGameOverButtons();
    initSocketEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
