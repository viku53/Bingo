/* ============================================
   BINGO MULTIPLAYER — CLIENT GAME LOGIC
   Socket.io Client
   ============================================ */

(function () {
  'use strict';

  // ==================== SOCKET ====================
  const socket = io();

  // ==================== STATE ====================
  const state = {
    myName: '',
    opponentName: '',
    myIndex: -1,       // 0 or 1
    myGrid: [],        // numbers 1-25 in grid order
    markedIndices: new Set(),
    myCompletedLines: 0,
    opponentCompletedLines: 0,
    calledNumbers: [],
    isMyTurn: false,
    fillSelectedCell: null,
    tempGrid: new Array(25).fill(null),
    roomCode: '',
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
      socket.emit('create-room', { name: state.myName });
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
      socket.emit('join-room', { code, name: state.myName });
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

    for (let i = 0; i < 25; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.index = i;
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
      $('#btn-confirm-grid').disabled = true;
      $('#btn-confirm-grid').querySelector('span').textContent = 'Waiting for opponent...';
      $('#btn-fill-random').disabled = true;
      $('#btn-clear-grid').disabled = true;
      // Disable grid interaction
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

    // Remove from old position if exists
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

    // Move to next empty cell
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

    // Determine coin animation
    coin.className = 'coin flipping' + (firstPlayer === 1 ? ' land-tails' : '');

    setTimeout(() => {
      const resultEl = $('#toss-result');
      if (isMyTurn) {
        resultEl.textContent = '🎉 You go first!';
      } else {
        resultEl.textContent = `${firstPlayerName} goes first`;
      }

      // Auto-transition to game after a moment
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

    // Names
    $('#your-name-display').textContent = state.myName;
    $('#opp-name-display').textContent = state.opponentName;

    // Reset BINGO letters
    $$('#bingo-you .bingo-letter, #bingo-opp .bingo-letter').forEach(l => l.classList.remove('lit'));

    // Render grid
    renderGameGrid();

    // Render number pad
    renderNumberPad();

    // Called numbers
    $('#called-numbers').innerHTML = '';

    // Update turn
    updateTurnUI();
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
        // Disable pad until server responds
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
      number, calledByName, yourGridIndex, yourNewLines,
      yourCompletedLines, opponentCompletedLines, opponentNewLines,
      nextPlayer, winner, winnerName
    } = data;

    state.calledNumbers.push(number);

    // Update number pad
    const btn = $(`.num-btn[data-number="${number}"]`);
    if (btn) { btn.classList.add('called'); btn.disabled = true; }

    // Add to called numbers display
    const calledEl = document.createElement('div');
    calledEl.className = 'called-num';
    calledEl.textContent = number;
    $('#called-numbers').appendChild(calledEl);

    // Mark on my grid
    if (yourGridIndex !== -1) {
      state.markedIndices.add(yourGridIndex);
      const cell = $('#game-grid').children[yourGridIndex];
      cell.classList.add('marked', 'just-marked');
      setTimeout(() => cell.classList.remove('just-marked'), 400);
    }

    // Update my completed lines
    state.myCompletedLines = yourCompletedLines;
    if (yourNewLines && yourNewLines.length > 0) {
      yourNewLines.forEach(line => {
        line.cells.forEach(idx => {
          $('#game-grid').children[idx].classList.add('line-complete');
        });
      });
      // Light up BINGO letters
      updateBingoLetters('bingo-you', yourCompletedLines);
    }

    // Update opponent completed lines
    state.opponentCompletedLines = opponentCompletedLines;
    if (opponentNewLines && opponentNewLines.length > 0) {
      updateBingoLetters('bingo-opp', opponentCompletedLines);
    }

    // Check winner
    if (winner !== null) {
      setTimeout(() => {
        showGameOver(winner === state.myIndex);
      }, 800);
      return;
    }

    // Switch turn
    state.isMyTurn = (nextPlayer === state.myIndex);
    updateTurnUI();
  }

  function updateBingoLetters(containerId, count) {
    const letters = $$(`#${containerId} .bingo-letter`);
    for (let i = 0; i < 5; i++) {
      if (i < count) {
        letters[i].classList.add('lit');
      }
    }
  }

  // ==================== GAME OVER ====================
  function showGameOver(isWinner) {
    showScreen('gameover');

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

    // Force re-trigger win letter animations
    $$('.win-letter').forEach(l => {
      l.style.animation = 'none';
      l.offsetHeight; // reflow
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
      $('#btn-play-again').disabled = true;
      $('#btn-play-again').textContent = 'Waiting for opponent...';
    });

    $('#btn-home').addEventListener('click', () => {
      location.reload();
    });

    $('#btn-back-home').addEventListener('click', () => {
      location.reload();
    });
  }

  // ==================== SOCKET EVENTS ====================
  function initSocketEvents() {
    // Room created
    socket.on('room-created', ({ code, playerIndex }) => {
      state.myIndex = playerIndex;
      showWaitingScreen(code);
    });

    // Room joined (I am joining)
    socket.on('room-joined', ({ code, playerIndex, opponentName }) => {
      state.myIndex = playerIndex;
      state.roomCode = code;
      state.opponentName = opponentName;
    });

    // Opponent joined my room
    socket.on('opponent-joined', ({ opponentName }) => {
      state.opponentName = opponentName;
    });

    // Join error
    socket.on('join-error', ({ message }) => {
      showJoinError(message);
    });

    // Phase: setup
    socket.on('phase-setup', () => {
      showGridSetup();
    });

    // Opponent ready
    socket.on('opponent-ready', () => {
      const oppStatus = $('#opponent-status');
      if (oppStatus) {
        oppStatus.classList.add('ready');
        oppStatus.querySelector('span').textContent = `${state.opponentName} is ready! ✓`;
      }
    });

    // Game start (coin toss result)
    socket.on('game-start', ({ firstPlayer, firstPlayerName, yourIndex }) => {
      state.myIndex = yourIndex;
      showCoinToss(firstPlayer, firstPlayerName);
    });

    // Number called
    socket.on('number-called', (data) => {
      handleNumberCalled(data);
    });

    // Not your turn
    socket.on('not-your-turn', () => {
      updateTurnUI();
    });

    // Opponent disconnected
    socket.on('opponent-disconnected', ({ name }) => {
      const overlay = $('#overlay-disconnect');
      overlay.classList.remove('hidden');
      $('#disconnect-text').textContent = `${name} has left the game.`;
    });

    // Opponent wants rematch
    socket.on('opponent-wants-rematch', ({ name }) => {
      // Auto-accept — go to setup
    });

    // Waiting for opponent rematch
    socket.on('waiting-opponent-rematch', () => {
      // Already showing "Waiting..." on button
    });

    // Connection status
    socket.on('connect', () => {
      $('#connection-status').classList.remove('disconnected');
      $('#connection-status').querySelector('span').textContent = 'Connected';
    });

    socket.on('disconnect', () => {
      $('#connection-status').classList.add('disconnected');
      $('#connection-status').querySelector('span').textContent = 'Disconnected';
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
