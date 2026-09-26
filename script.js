/* ============================================================
   CatTinder 🐱 — swipe, match, repeat.
   Live random cat photos from cataas.com, no API key needed.
   ============================================================ */
(() => {
  "use strict";

  // ---------- Config ----------
  const CATS_API = "https://cataas.com/cat";
  const IMG_W = 520;
  const IMG_H = 640;
  const LIKE_MATCH_CHANCE = 0.4; // chance a regular like becomes a match
  const DRAG_THRESHOLD = 110; // px to trigger a swipe
  const MAX_IMG_RETRIES = 3;
  const TARGET_QUEUE = 4; // keep this many cats loaded ahead
  const STORAGE_KEY = "catTinder.v1";

  // ---------- Filler data ----------
  const NAMES = [
    "Whiskers",
    "Mochi",
    "Pumpkin",
    "Luna",
    "Miso",
    "Biscuit",
    "Waffles",
    "Noodle",
    "Clover",
    "Jasper",
    "Peaches",
    "Gizmo",
    "Maple",
    "Toast",
    "Suki",
    "Ollie",
    "Dumpling",
    "Mango",
    "Ziggy",
    "Pancake",
    "Clementine",
    "Figaro",
  ];
  const TRAITS = ["fluffy", "sassy", "cuddly", "chaotic", "dramatic", "goofy", "majestic", "snuggly", "mischievous", "chill", "velvet", "bouncy"];
  const BIOS = [
    "Professional napper. Will judge your taste in treats.",
    "Lives for cardboard boxes and warm laps.",
    "Has a 6am alarm for breakfast. It is meowing.",
    "Chases red dots. Will never catch one. It is fine.",
    "Belly rubs: forbidden. Head scratches: mandatory.",
    "Half cat, half loaf. 100% your future bestie.",
    "Expert in knocking things off shelves. CV on request.",
    "Purrs louder than your laptop fan.",
    "Will trade affection for tuna. Non-negotiable.",
    "Sunbeam connoisseur. The window seat is mine, sorry.",
    "Can open drawers. Cannot close them. Ambitious.",
    "Has strong opinions about birds. All of them.",
  ];
  const QUOTES = [
    "“I’m pawsitively smitten.”",
    "“You had me at head scratches.”",
    "“Let’s nap together forever.”",
    "“My heart is purring right now.”",
    "“You’re the cat’s meow.”",
    "“I knew you were my human.”",
    "“We’re going to be so happy, and so warm.”",
  ];
  const EMOJI_AVATARS = ["🐱", "🐈", "😻", "🐈‍⬛", "🐾", "🐆", "🐯"];
  const HEART_EMOJIS = ["💗", "💖", "🐾", "💕", "🌸"];
  const BURST_EMOJIS = ["💖", "💘", "✨", "🐾", "😻", "💕", "⭐"];

  // ---------- State ----------
  const deck = []; // loaded cats, last entry is the top card
  const pending = []; // cats whose photos are still loading
  const history = []; // dismissed {cat, dir, matched, matchId} for undo
  let matches = []; // persisted
  let stats = { likes: 0, nopes: 0, supers: 0 }; // persisted
  let busy = false; // a card is animating out
  let needsRender = false;
  let drag = null;
  let consecutiveFailures = 0;

  // ---------- DOM ----------
  const deckEl = document.getElementById("deck");
  const loadingEl = document.getElementById("loading");
  const nopeBtn = document.getElementById("nopeBtn");
  const likeBtn = document.getElementById("likeBtn");
  const superBtn = document.getElementById("superBtn");
  const undoBtn = document.getElementById("undoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const matchesBtn = document.getElementById("matchesBtn");
  const matchesCount = document.getElementById("matchesCount");
  const statNopes = document.getElementById("statNopes");
  const statLikes = document.getElementById("statLikes");
  const statSupers = document.getElementById("statSupers");
  const matchOverlay = document.getElementById("matchOverlay");
  const matchTitle = document.getElementById("matchTitle");
  const matchSub = document.getElementById("matchSub");
  const matchPhoto = document.getElementById("matchPhoto");
  const matchQuote = document.getElementById("matchQuote");
  const keepSwipingBtn = document.getElementById("keepSwipingBtn");
  const matchesOverlay = document.getElementById("matchesOverlay");
  const matchesGrid = document.getElementById("matchesGrid");
  const closeMatchesBtn = document.getElementById("closeMatchesBtn");

  // ---------- Small helpers ----------
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (n) => Math.floor(Math.random() * n);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function removeFrom(arr, item) {
    const i = arr.indexOf(item);
    if (i !== -1) arr.splice(i, 1);
  }

  function makeImgUrl() {
    console.log("consecutiveFailures", consecutiveFailures);
    console.log(`${CATS_API}?width=${IMG_W}&height=${IMG_H}&cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    return `${CATS_API}?width=${IMG_W}&height=${IMG_H}&cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- Persistence ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.matches)) matches = data.matches;
      if (data.stats) stats = Object.assign({ likes: 0, nopes: 0, supers: 0 }, data.stats);
    } catch {
      /* private mode / corrupted — start fresh */
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ matches, stats }));
    } catch {
      /* storage unavailable — session only */
    }
  }

  // ---------- Cat factory ----------
  function makeCat() {
    const t1 = pick(TRAITS);
    let t2 = pick(TRAITS);
    while (t2 === t1) t2 = pick(TRAITS);
    return {
      id: "cat-" + Math.random().toString(36).slice(2, 10),
      name: pick(NAMES),
      age: 1 + randInt(11),
      traits: [t1, t2],
      bio: pick(BIOS),
      distance: 1 + randInt(29),
      imgSrc: makeImgUrl(),
      avatar: pick(EMOJI_AVATARS),
      fallback: false,
      loaded: false,
    };
  }

  // ---------- Deck management ----------
  function ensureDeck() {
    while (deck.length + pending.length < TARGET_QUEUE) spawnCat();
  }

  function spawnCat() {
    const cat = makeCat();
    pending.push(cat);
    loadCatImage(cat, 0);
  }

  function loadCatImage(cat, attempt) {
    const img = new Image();
    img.onload = () => {
      cat.loaded = true;
      removeFrom(pending, cat);
      if (!deck.includes(cat)) deck.push(cat);
      consecutiveFailures = 0;
      render();
      hideLoading();
      ensureDeck();
    };
    img.onerror = () => {
      if (attempt < MAX_IMG_RETRIES) {
        cat.imgSrc = makeImgUrl();
        loadCatImage(cat, attempt + 1);
        return;
      }
      // Give up on real photos — use a cute emoji stand-in so swiping never stalls.
      consecutiveFailures++;
      cat.loaded = true;
      cat.fallback = true;
      removeFrom(pending, cat);
      if (!deck.includes(cat)) deck.push(cat);
      render();
      hideLoading();
      ensureDeck();
    };
    img.src = cat.imgSrc;
  }

  function hideLoading() {
    if (deck.length >= 1) loadingEl.classList.add("hidden");
  }

  // ---------- Rendering ----------
  function render(force) {
    if (busy && !force) {
      needsRender = true;
      return;
    }
    deckEl.innerHTML = "";
    const visible = deck.slice(-3);
    visible.forEach((cat, i) => {
      const depth = Math.max(0, 2 - (visible.length - 1 - i));
      cat.el = makeCardEl(cat, depth);
      deckEl.appendChild(cat.el);
    });
    const top = visible[visible.length - 1];
    if (top && top.el) attachDrag(top.el, top);
    const idle = !top;
    nopeBtn.disabled = idle;
    likeBtn.disabled = idle;
    superBtn.disabled = idle;
    updateStats();
    needsRender = false;
  }

  function makeCardEl(cat, depth) {
    const el = document.createElement("article");
    el.className = "card" + (depth === 2 ? " is-top" : "");
    el.dataset.catId = cat.id;
    el.dataset.depth = depth;

    const photo = document.createElement("div");
    photo.className = "card-photo";
    if (cat.fallback) {
      el.classList.add("avatar-card");
      const av = document.createElement("div");
      av.className = "card-avatar";
      av.textContent = cat.avatar;
      photo.appendChild(av);
    } else {
      const img = document.createElement("img");
      img.src = cat.imgSrc;
      img.alt = `${cat.name} — a ${cat.traits.join(", ")} cat`;
      img.draggable = false;
      photo.appendChild(img);
    }
    el.appendChild(photo);

    for (const [cls, txt] of [
      ["stamp-nope", "Nope"],
      ["stamp-like", "Like"],
      ["stamp-super", "Super"],
    ]) {
      const s = document.createElement("div");
      s.className = "stamp " + cls;
      s.textContent = txt;
      el.appendChild(s);
    }

    const info = document.createElement("div");
    info.className = "card-info";
    info.innerHTML = `<h2 class="cat-name">${cat.name}, ${cat.age}</h2>` + `<p class="cat-bio">${cat.bio}</p>` + `<p class="cat-meta">🐾 ${cat.distance} km away · ${cat.traits.join(" · ")}</p>`;
    el.appendChild(info);
    return el;
  }

  // ---------- Drag / swipe ----------
  function attachDrag(el, cat) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    function onDown(e) {
      if (busy) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { el, cat, id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, superSwipe: false };
      el.classList.remove("returning");
      el.style.transition = "none";
    }
    function onMove(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag.dx = e.clientX - drag.sx;
      drag.dy = e.clientY - drag.sy;
      applyDrag();
    }
    function onUp(e) {
      if (drag && drag.id === e.pointerId) endDrag();
    }
  }

  function applyDrag() {
    const { el, dx, dy } = drag;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.07}deg)`;
    const isSuper = dy < -70 && Math.abs(dy) > Math.abs(dx) * 1.15;
    drag.superSwipe = isSuper;
    const amt = clamp01(Math.abs(dx) / 90);
    const superAmt = clamp01(Math.abs(dy) / 90);
    setStamp(el, ".stamp-like", dx > 0 && !isSuper ? amt : 0);
    setStamp(el, ".stamp-nope", dx < 0 && !isSuper ? amt : 0);
    setStamp(el, ".stamp-super", isSuper ? superAmt : 0);
  }

  function setStamp(el, sel, v) {
    const s = el.querySelector(sel);
    if (s) s.style.opacity = v;
  }

  function endDrag() {
    if (!drag) return;
    const { el, dx, dy, superSwipe } = drag;
    drag = null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let dir = null;
    if (superSwipe && ay > DRAG_THRESHOLD) dir = "super";
    else if (ax > DRAG_THRESHOLD) dir = dx > 0 ? "like" : "nope";
    if (dir) {
      dismissTop(dir);
      return;
    }
    // Spring back to center.
    el.classList.add("returning");
    el.style.transition = "";
    el.style.transform = "";
    setStamp(el, ".stamp-like", 0);
    setStamp(el, ".stamp-nope", 0);
    setStamp(el, ".stamp-super", 0);
  }

  // ---------- Dismissing cards ----------
  function dismissTop(dir) {
    const cat = deck[deck.length - 1];
    if (!cat || busy) return;
    busy = true;
    const el = cat.el;
    el.style.transition = "transform 0.45s ease, opacity 0.45s ease";
    el.classList.add(dir === "like" ? "fly-right" : dir === "nope" ? "fly-left" : "fly-up");
    const entry = { cat, dir, matched: willMatch(dir), matchId: null };
    history.push(entry);

    setTimeout(() => {
      removeFrom(deck, cat);
      busy = false;
      recordSwipe(dir, cat, entry);
      render(true);
      ensureDeck();
      if (entry.matched) showMatchOverlay(cat, dir);
    }, 460);
  }

  function willMatch(dir) {
    if (dir === "super") return true; // super likes always match
    return Math.random() < LIKE_MATCH_CHANCE;
  }

  function recordSwipe(dir, cat, entry) {
    if (dir === "like") {
      stats.likes++;
      if (entry.matched) entry.matchId = addMatch(cat, "like");
    } else if (dir === "super") {
      stats.supers++;
      if (entry.matched) entry.matchId = addMatch(cat, "super");
    } else {
      stats.nopes++;
    }
    persist();
    updateStats();
  }

  function addMatch(cat, kind) {
    const m = {
      id: cat.id + "-" + Date.now(),
      name: cat.name,
      img: cat.imgSrc,
      avatar: cat.avatar,
      fallback: cat.fallback,
      kind,
      when: Date.now(),
    };
    matches.unshift(m);
    persist();
    updateMatchesBadge();
    return m.id;
  }

  function undo() {
    if (busy || history.length === 0) return;
    const entry = history.pop();
    const { cat, dir } = entry;
    if (dir === "like") stats.likes = Math.max(0, stats.likes - 1);
    else if (dir === "super") stats.supers = Math.max(0, stats.supers - 1);
    else stats.nopes = Math.max(0, stats.nopes - 1);
    if (entry.matchId) {
      const i = matches.findIndex((m) => m.id === entry.matchId);
      if (i !== -1) matches.splice(i, 1);
    }
    if (!deck.includes(cat)) deck.push(cat);
    persist();
    updateStats();
    updateMatchesBadge();
    render(true);
  }

  // ---------- Stats & badges ----------
  function updateStats() {
    statNopes.textContent = stats.nopes;
    statLikes.textContent = stats.likes;
    statSupers.textContent = stats.supers;
    undoBtn.disabled = history.length === 0 || busy;
  }

  function updateMatchesBadge() {
    matchesCount.textContent = matches.length;
    matchesCount.style.display = matches.length ? "grid" : "none";
  }

  // ---------- Match celebration ----------
  function showMatchOverlay(cat, kind) {
    matchTitle.textContent = kind === "super" ? "Super like! 💫" : "It's a match! 💘";
    matchSub.innerHTML = kind === "super" ? `You super-liked <strong>${cat.name}</strong> — instant match!` : `You and <strong>${cat.name}</strong> both swiped right`;
    matchPhoto.innerHTML = "";
    if (cat.fallback) {
      const av = document.createElement("div");
      av.className = "card-avatar";
      av.textContent = cat.avatar;
      matchPhoto.appendChild(av);
    } else {
      const img = document.createElement("img");
      img.src = cat.imgSrc;
      img.alt = cat.name;
      matchPhoto.appendChild(img);
    }
    matchQuote.textContent = pick(QUOTES);
    spawnBurst();
    matchOverlay.classList.remove("hidden");
  }

  function spawnBurst() {
    const burst = document.getElementById("burst");
    burst.innerHTML = "";
    for (let i = 0; i < 28; i++) {
      const s = document.createElement("span");
      s.textContent = pick(BURST_EMOJIS);
      s.style.left = 5 + Math.random() * 90 + "%";
      s.style.fontSize = 0.8 + Math.random() * 1.4 + "rem";
      s.style.animationDuration = 0.9 + Math.random() * 0.9 + "s";
      s.style.animationDelay = Math.random() * 0.5 + "s";
      burst.appendChild(s);
    }
  }

  function closeOverlays() {
    matchOverlay.classList.add("hidden");
    matchesOverlay.classList.add("hidden");
  }

  // ---------- Matches list ----------
  function renderMatchesGrid() {
    matchesGrid.innerHTML = "";
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<span class="big">😿</span>No matches yet.<br>Go make some feline friends!';
      matchesGrid.appendChild(empty);
      return;
    }
    for (const m of matches) {
      const item = document.createElement("div");
      item.className = "match-item";

      const thumb = document.createElement("div");
      if (m.fallback) {
        thumb.className = "thumb-avatar";
        thumb.textContent = m.avatar;
      } else {
        const img = document.createElement("img");
        img.className = "thumb";
        img.src = m.img;
        img.alt = m.name;
        img.loading = "lazy";
        thumb.appendChild(img);
      }

      const nameRow = document.createElement("div");
      nameRow.className = "m-name";
      nameRow.innerHTML = `<span>${m.name}</span>` + `<span class="tag${m.kind === "super" ? " superlike" : ""}">${m.kind === "super" ? "⭐ Super" : "❤️ Like"}</span>`;

      const rm = document.createElement("button");
      rm.className = "remove";
      rm.textContent = "✕";
      rm.setAttribute("aria-label", `Remove ${m.name} from matches`);
      rm.onclick = () => {
        matches = matches.filter((x) => x.id !== m.id);
        persist();
        updateMatchesBadge();
        renderMatchesGrid();
      };

      item.append(thumb, nameRow, rm);
      matchesGrid.appendChild(item);
    }
  }

  // ---------- Ambient hearts ----------
  function spawnHearts() {
    const wrap = document.getElementById("hearts");
    for (let i = 0; i < 14; i++) {
      const s = document.createElement("span");
      s.className = "heart";
      s.textContent = pick(HEART_EMOJIS);
      s.style.left = Math.random() * 100 + "vw";
      s.style.fontSize = 0.8 + Math.random() * 1.6 + "rem";
      s.style.animationDuration = 8 + Math.random() * 10 + "s";
      s.style.animationDelay = Math.random() * 10 + "s";
      wrap.appendChild(s);
    }
  }

  // ---------- Reset ----------
  function resetAll() {
    if (!confirm("Start over? This clears your matches and stats.")) return;
    matches = [];
    stats = { likes: 0, nopes: 0, supers: 0 };
    history.length = 0;
    deck.length = 0;
    pending.length = 0;
    consecutiveFailures = 0;
    deckEl.innerHTML = "";
    loadingEl.classList.remove("hidden");
    persist();
    updateStats();
    updateMatchesBadge();
    ensureDeck();
  }

  // ---------- Wire up events ----------
  nopeBtn.addEventListener("click", () => dismissTop("nope"));
  likeBtn.addEventListener("click", () => dismissTop("like"));
  superBtn.addEventListener("click", () => dismissTop("super"));
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", resetAll);
  matchesBtn.addEventListener("click", () => {
    renderMatchesGrid();
    matchesOverlay.classList.remove("hidden");
  });
  closeMatchesBtn.addEventListener("click", closeOverlays);
  keepSwipingBtn.addEventListener("click", closeOverlays);
  matchOverlay.addEventListener("click", (e) => {
    if (e.target === matchOverlay) closeOverlays();
  });
  matchesOverlay.addEventListener("click", (e) => {
    if (e.target === matchesOverlay) closeOverlays();
  });

  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const overlayOpen = !matchOverlay.classList.contains("hidden") || !matchesOverlay.classList.contains("hidden");
    if (e.key === "Escape") {
      closeOverlays();
      return;
    }
    if (overlayOpen) return;
    if (e.key === "ArrowLeft") nopeBtn.click();
    else if (e.key === "ArrowRight") likeBtn.click();
    else if (e.key === "ArrowUp") superBtn.click();
    else if (e.key === "u" || e.key === "U" || e.key === "z" || e.key === "Z") undo();
  });

  // ---------- Boot ----------
  loadState();
  updateStats();
  updateMatchesBadge();
  spawnHearts();
  ensureDeck();
})();
