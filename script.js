(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const EMPTY = ".";
  const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
  };
  const GLYPHS = { I: "██", O: "██", T: "██", S: "▀▄", Z: "▄▀", J: "█▄", L: "▄█" };
  const POINTS = [0, 100, 300, 500, 800];

  const boardEl = document.querySelector("#gameBoard");
  const nextEl = document.querySelector("#nextPiece");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlayTitle");
  const overlayText = document.querySelector("#overlayText");
  const startButton = document.querySelector("#startButton");
  const pauseButton = document.querySelector("#pauseButton");
  const restartButton = document.querySelector("#restartButton");
  const scoreEl = document.querySelector("#score");
  const highScoreEl = document.querySelector("#highScore");
  const linesEl = document.querySelector("#lines");
  const levelEl = document.querySelector("#level");
  const stateLabel = document.querySelector("#stateLabel");
  const fpsLabel = document.querySelector("#fpsLabel");

  let grid, current, nextType, bag, score, lines, level;
  let running = false, paused = false, gameOver = false;
  let lastTime = 0, dropCounter = 0, animationId = 0;
  let highScore = loadHighScore();
  let touchStart = null;
  let softDropHeld = false;
  let softDropTimer = 0;

  function loadHighScore() {
    try { return Number(localStorage.getItem("asciiTetrisHighScore")) || 0; }
    catch (_) { return 0; }
  }
  function saveHighScore() {
    try { localStorage.setItem("asciiTetrisHighScore", String(highScore)); }
    catch (_) { /* Storage may be unavailable; the game still works. */ }
  }
  function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  }
  function shuffleBag() {
    const types = Object.keys(SHAPES);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    return types;
  }
  function takeType() {
    if (!bag.length) bag = shuffleBag();
    return bag.pop();
  }
  function makePiece(type) {
    const matrix = SHAPES[type].map(row => row.slice());
    return {
      type,
      matrix,
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: 0
    };
  }
  function resetGame() {
    grid = emptyGrid();
    bag = [];
    score = 0;
    lines = 0;
    level = 1;
    current = makePiece(takeType());
    nextType = takeType();
    running = true;
    paused = false;
    gameOver = false;
    lastTime = 0;
    dropCounter = 0;
    hideOverlay();
    pauseButton.disabled = false;
    pauseButton.textContent = "[ PAUSE ]";
    stateLabel.textContent = "RUNNING";
    fpsLabel.innerHTML = "ENGINE: <b>ACTIVE</b>";
    updateStats();
    render();
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
  }
  function updateStats() {
    scoreEl.textContent = String(score).padStart(6, "0");
    highScoreEl.textContent = String(highScore).padStart(6, "0");
    linesEl.textContent = String(lines).padStart(2, "0");
    levelEl.textContent = String(level).padStart(2, "0");
  }
  function showOverlay(title, message, buttonText) {
    overlayTitle.textContent = title;
    overlayText.textContent = message;
    startButton.textContent = buttonText;
    overlay.classList.remove("hidden");
  }
  function hideOverlay() { overlay.classList.add("hidden"); }
  function collides(piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const boardX = piece.x + x + offsetX;
        const boardY = piece.y + y + offsetY;
        if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
        if (boardY >= 0 && grid[boardY][boardX] !== EMPTY) return true;
      }
    }
    return false;
  }
  function mergePiece() {
    current.matrix.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return;
      const boardY = current.y + y;
      const boardX = current.x + x;
      if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
        grid[boardY][boardX] = current.type;
      }
    }));
  }
  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every(cell => cell !== EMPTY)) {
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(EMPTY));
        cleared++;
        y++;
      }
    }
    if (cleared) {
      lines += cleared;
      score += (POINTS[cleared] || cleared * 300) * level;
      level = Math.floor(lines / 10) + 1;
      if (score > highScore) {
        highScore = score;
        saveHighScore();
      }
      updateStats();
    }
  }
  function spawnNext() {
    current = makePiece(nextType);
    nextType = takeType();
    if (collides(current)) endGame();
  }
  function lockPiece() {
    mergePiece();
    clearLines();
    spawnNext();
    render();
  }
  function move(dx, dy) {
    if (!running || paused || gameOver) return false;
    if (!collides(current, dx, dy)) {
      current.x += dx;
      current.y += dy;
      render();
      return true;
    }
    if (dy > 0) lockPiece();
    return false;
  }
  function rotateMatrix(matrix) {
    const height = matrix.length;
    const width = matrix[0].length;
    return Array.from({ length: width }, (_, x) =>
      Array.from({ length: height }, (_, y) => matrix[height - 1 - y][x])
    );
  }
  function rotate() {
    if (!running || paused || gameOver) return;
    const rotated = rotateMatrix(current.matrix);
    // Small wall-kick checks make rotation usable near edges and stacked blocks.
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(current, kick, 0, rotated)) {
        current.matrix = rotated;
        current.x += kick;
        render();
        return;
      }
    }
  }
  function hardDrop() {
    if (!running || paused || gameOver) return;
    let distance = 0;
    while (!collides(current, 0, 1)) {
      current.y++;
      distance++;
    }
    score += distance * 2;
    if (score > highScore) {
      highScore = score;
      saveHighScore();
    }
    updateStats();
    lockPiece();
  }
  function gravityInterval() {
    return Math.max(90, 850 * Math.pow(0.82, level - 1));
  }
  function loop(timestamp = 0) {
    if (!running) return;
    if (!lastTime) lastTime = timestamp;
    const delta = Math.min(timestamp - lastTime, 100);
    lastTime = timestamp;

    if (!paused && !gameOver) {
      dropCounter += delta;
      if (dropCounter >= gravityInterval()) {
        move(0, 1);
        dropCounter = 0;
      }
      if (softDropHeld) {
        softDropTimer += delta;
        if (softDropTimer > 55) {
          move(0, 1);
          softDropTimer = 0;
        }
      }
    }
    animationId = requestAnimationFrame(loop);
  }
  function endGame() {
    gameOver = true;
    running = false;
    pauseButton.disabled = true;
    stateLabel.textContent = "GAME OVER";
    fpsLabel.innerHTML = "ENGINE: <b>STOPPED</b>";
    showOverlay("GAME OVER", `Final score: ${String(score).padStart(6, "0")} — run it back?`, "[ PLAY AGAIN ]");
    render();
  }
  function togglePause() {
    if (!running || gameOver) return;
    paused = !paused;
    pauseButton.textContent = paused ? "[ RESUME ]" : "[ PAUSE ]";
    stateLabel.textContent = paused ? "PAUSED" : "RUNNING";
    if (paused) showOverlay("PAUSED", "Simulation halted. Resume when ready.", "[ RESUME ]");
    else hideOverlay();
  }
  function renderNext() {
    const matrix = SHAPES[nextType];
    const width = Math.max(...matrix.map(row => row.length));
    const linesOut = [];
    const topPad = Math.max(0, Math.floor((4 - matrix.length) / 2));
    for (let i = 0; i < topPad; i++) linesOut.push(" ".repeat(width * 2 + 2));
    matrix.forEach(row => {
      let line = " ";
      row.forEach(cell => { line += cell ? GLYPHS[nextType] : "  "; });
      line += " ";
      linesOut.push(line);
    });
    while (linesOut.length < 4) linesOut.push(" ".repeat(width * 2 + 2));
    nextEl.textContent = linesOut.join("\n");
  }
  function render() {
    const display = grid.map(row => row.slice());
    if (current && !gameOver) {
      current.matrix.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell) return;
        const boardY = current.y + y;
        const boardX = current.x + x;
        if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
          display[boardY][boardX] = current.type;
        }
      }));
    }
    const output = ["+----------------------+"];
    display.forEach(row => {
      let line = "|";
      row.forEach(cell => { line += cell === EMPTY ? " ." : GLYPHS[cell]; });
      line += " |";
      output.push(line);
    });
    output.push("+----------------------+");
    boardEl.textContent = output.join("\n");
    renderNext();
    updateStats();
  }

  function handleAction(action) {
    if (action === "pause") return togglePause();
    if (action === "restart") return resetGame();
    if (!running || paused || gameOver) return;
    switch (action) {
      case "left": move(-1, 0); break;
      case "right": move(1, 0); break;
      case "down":
        if (move(0, 1)) {
          score += 1;
          if (score > highScore) { highScore = score; saveHighScore(); }
          updateStats();
        }
        dropCounter = 0;
        break;
      case "rotate": rotate(); break;
      case "drop": hardDrop(); break;
    }
  }

  document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    const handled = ["arrowleft", "arrowright", "arrowdown", "arrowup", " ", "p", "escape", "enter"];
    if (handled.includes(key)) event.preventDefault();
    if (key === "p" || key === "escape") {
      if (running && !gameOver) togglePause();
      return;
    }
    if (key === "enter" && (!running || gameOver)) { resetGame(); return; }
    if (key === "arrowleft" || key === "a") handleAction("left");
    else if (key === "arrowright" || key === "d") handleAction("right");
    else if (key === "arrowdown" || key === "s") handleAction("down");
    else if (key === "arrowup" || key === "w" || key === "x") handleAction("rotate");
    else if (key === " ") handleAction("drop");
  });
  document.addEventListener("keyup", event => {
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
      softDropHeld = false;
      softDropTimer = 0;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
      softDropHeld = true;
    }
  });

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });
  startButton.addEventListener("click", () => {
    if (paused && running) togglePause();
    else resetGame();
  });
  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", resetGame);

  boardEl.addEventListener("touchstart", event => {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, { passive: true });
  boardEl.addEventListener("touchend", event => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (Math.max(absX, absY) < 18) {
      handleAction("rotate");
    } else if (absX > absY) {
      handleAction(dx > 0 ? "right" : "left");
    } else if (dy < 0) {
      handleAction("rotate");
    } else if (dy > 80) {
      handleAction("drop");
    } else {
      handleAction("down");
    }
    touchStart = null;
  }, { passive: true });

  // Initialize a stable preview before the player starts.
  grid = emptyGrid();
  bag = [];
  score = 0;
  lines = 0;
  level = 1;
  current = makePiece(takeType());
  nextType = takeType();
  render();
  highScoreEl.textContent = String(highScore).padStart(6, "0");
  stateLabel.textContent = "READY";
  fpsLabel.innerHTML = "ENGINE: <b>READY</b>";
  startButton.addEventListener("click", () => {});

  // Theme changing logic
  const themes = ["default", "amber", "cyan", "purple"];
  let currentThemeIdx = 0;
  const themeButton = document.querySelector("#themeButton");
  if (themeButton) {
    themeButton.addEventListener("click", () => {
      currentThemeIdx = (currentThemeIdx + 1) % themes.length;
      const newTheme = themes[currentThemeIdx];
      if (newTheme === "default") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", newTheme);
      }
    });
  }

  // Mouse hover glow logic (snapped to 24px grid)
  document.addEventListener("mousemove", (e) => {
    const gridSize = 24;
    const qX = Math.floor(e.clientX / gridSize) * gridSize + (gridSize / 2);
    const qY = Math.floor(e.clientY / gridSize) * gridSize + (gridSize / 2);
    document.documentElement.style.setProperty("--mouse-x", qX + "px");
    document.documentElement.style.setProperty("--mouse-y", qY + "px");
  });
})();
