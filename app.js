'use strict';

/* =========================================================
   Révisions — application de QCM (PWA)
   Données stockées sur l'appareil (localStorage).
   ========================================================= */

const STORE_KEY = 'revisions.v1';
const LETTERS = ['A', 'B', 'C', 'D'];

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $fileInput = document.getElementById('file-input');
const $backupInput = document.getElementById('backup-input');

let db = loadDb();
let state = { screen: 'home' };

/* ---------- Stockage ---------- */
function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.quizzes)) { d.deleted = d.deleted || {}; d.diagrams = d.diagrams || []; return d; }
  } catch (e) { /* données illisibles : on repart de zéro */ }
  return { quizzes: [], deleted: {}, diagrams: [] };
}
function writeLocal() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast("Enregistrement impossible : la mémoire de l'app est pleine.");
  }
}
function saveDb() {
  writeLocal();
  scheduleSync();
}
function getQuiz(id) { return db.quizzes.find(q => q.id === id); }
function getDiagram(id) { return db.diagrams.find(d => d.id === id); }

/* =========================================================
   Synchronisation avec un dépôt GitHub privé
   Le dépôt contient un fichier donnees.json avec tous les quiz
   et le suivi. Chaque matière garde la version la plus récente
   (champ updatedAt) ; les suppressions sont mémorisées.
   ========================================================= */
const SYNC_KEY = 'revisions.sync';
const DATA_PATH = 'donnees.json';
let sync = loadSync();
let syncState = { state: sync ? 'idle' : 'off', at: null, msg: '' };
let syncing = false, syncAgain = false, syncTimer = null;

function loadSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (s && s.owner && s.repo && s.token) return s;
  } catch (e) { /* rien */ }
  return null;
}

function ghFetch(path, opts = {}, cfg = sync) {
  return fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + cfg.token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

function httpMessage(status) {
  if (status === 401) return 'Clé refusée ou expirée. Crée une nouvelle clé sur GitHub.';
  if (status === 403) return "Accès refusé. La clé doit avoir le droit « Contents » en lecture et écriture.";
  if (status === 404) return 'Dépôt introuvable. Vérifie le pseudo, le nom du dépôt et que la clé y a accès.';
  return `GitHub a répondu une erreur (${status}).`;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function mergeDb(a, b) {
  const limit = Date.now() - 365 * 24 * 3600 * 1000; // on oublie les suppressions de plus d'un an
  const deleted = {};
  [a.deleted || {}, b.deleted || {}].forEach(d => Object.entries(d).forEach(([id, t]) => {
    if (t > limit) deleted[id] = Math.max(deleted[id] || 0, t);
  }));
  // Pour chaque élément (thème ou schéma), on garde la version la plus récente
  const mergeList = (x = [], y = []) => {
    const map = new Map();
    [...x, ...y].forEach(item => {
      const cur = map.get(item.id);
      if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) map.set(item.id, item);
    });
    return [...map.values()]
      .filter(item => !(deleted[item.id] && deleted[item.id] >= (item.updatedAt || 0)))
      .sort((p, q) => (p.id < q.id ? -1 : 1));
  };
  const sortedDeleted = {};
  Object.keys(deleted).sort().forEach(k => { sortedDeleted[k] = deleted[k]; });
  return {
    quizzes: mergeList(a.quizzes, b.quizzes),
    deleted: sortedDeleted,
    diagrams: mergeList(a.diagrams, b.diagrams),
  };
}

function setSyncState(state, msg = '') {
  syncState = { state, msg, at: state === 'ok' ? Date.now() : syncState.at };
  const pill = document.getElementById('sync-pill');
  if (pill) pill.outerHTML = syncPill();
  const info = document.getElementById('sync-info');
  if (info) info.innerHTML = syncInfo();
}

function scheduleSync(delay = 2000) {
  if (!sync) return;
  clearTimeout(syncTimer);
  if (state.screen === 'play') return; // pas de synchro pendant un quiz : elle se fait à la fin
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!sync) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  clearTimeout(syncTimer);
  setSyncState('busy');
  try {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const res = await ghFetch('/contents/' + DATA_PATH);
      let remote = { quizzes: [], deleted: {}, diagrams: [] };
      let sha;
      if (res.status === 200) {
        const j = await res.json();
        sha = j.sha;
        if (!j.content) throw new Error('Le fichier de données est trop gros pour être synchronisé.');
        remote = JSON.parse(b64decode(j.content));
      } else if (res.status !== 404) {
        throw new Error(httpMessage(res.status));
      }

      const merged = mergeDb(db, remote);
      const mergedStr = JSON.stringify(merged);
      if (mergedStr !== JSON.stringify(remote)) {
        const put = await ghFetch('/contents/' + DATA_PATH, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Synchro ' + new Date().toLocaleString('fr-FR'),
            content: b64encode(mergedStr),
            ...(sha ? { sha } : {}),
          }),
        });
        if (put.status === 409 || put.status === 422) continue; // un autre appareil a écrit entre-temps : on recommence
        if (!put.ok) throw new Error(httpMessage(put.status));
      }

      const localChanged = mergedStr !== JSON.stringify(mergeDb(db, {}));
      db = merged;
      writeLocal();
      done = true;
      const imagesChanged = await syncImages();
      setSyncState('ok');
      if ((localChanged || imagesChanged) && ['home', 'themes', 'subject', 'settings', 'diagrams', 'diagram'].includes(state.screen)) {
        if (state.screen === 'subject' && !getQuiz(state.id)) go('themes');
        else if (state.screen === 'diagram' && !getDiagram(state.id)) go('diagrams');
        else if (!(state.screen === 'diagram' && state.edit)) { const y = window.scrollY; render(); window.scrollTo(0, y); }
      }
    }
    if (!done) throw new Error('Conflit de synchro, nouvel essai plus tard.');
  } catch (e) {
    const offline = e instanceof TypeError || !navigator.onLine;
    setSyncState('error', offline ? 'Hors ligne : la synchro reprendra avec du réseau.' : e.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

/* ---------- Images des schémas (IndexedDB + dossier schemas/ du dépôt) ---------- */
const IMG_DIR = 'schemas';
const Images = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('revisions', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(idb => new Promise((res, rej) => {
    const t = idb.transaction('images', mode);
    const req = fn(t.objectStore('images'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  }));
  const urls = new Map();
  return {
    get: id => run('readonly', st => st.get(id)),
    set: (id, blob) => { urls.delete(id); return run('readwrite', st => st.put(blob, id)); },
    del: id => { urls.delete(id); return run('readwrite', st => st.delete(id)); },
    keys: () => run('readonly', st => st.getAllKeys()),
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const blob = await this.get(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urls.set(id, u);
      return u;
    },
  };
})();

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64.replace(/\s/g, ''));
  return new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))], { type });
}

// Renvoie true si des images ont été téléchargées ou supprimées sur cet appareil
async function syncImages() {
  let changed = false;
  const res = await ghFetch('/contents/' + IMG_DIR);
  const remote = new Map();
  if (res.status === 200) {
    (await res.json()).forEach(f => { if (f.type === 'file') remote.set(f.name.replace(/\.jpg$/, ''), f.sha); });
  } else if (res.status !== 404) {
    throw new Error(httpMessage(res.status));
  }
  const local = new Set(await Images.keys());
  for (const d of db.diagrams) {
    if (local.has(d.id) && !remote.has(d.id)) {
      const blob = await Images.get(d.id);
      const put = await ghFetch(`/contents/${IMG_DIR}/${d.id}.jpg`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Schéma : ' + d.title, content: await blobToBase64(blob) }),
      });
      if (!put.ok && put.status !== 422) throw new Error(httpMessage(put.status));
    } else if (!local.has(d.id) && remote.has(d.id)) {
      const get = await ghFetch(`/contents/${IMG_DIR}/${d.id}.jpg`);
      if (!get.ok) throw new Error(httpMessage(get.status));
      const j = await get.json();
      if (j.content) { await Images.set(d.id, base64ToBlob(j.content)); changed = true; }
    }
  }
  // Schémas supprimés : on retire l'image du dépôt et de l'appareil
  const alive = new Set(db.diagrams.map(d => d.id));
  for (const [id, sha] of remote) {
    if (!alive.has(id) && db.deleted[id]) {
      await ghFetch(`/contents/${IMG_DIR}/${id}.jpg`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Schéma supprimé', sha }),
      });
    }
  }
  for (const id of local) {
    if (!alive.has(id) && db.deleted[id]) { await Images.del(id); changed = true; }
  }
  return changed;
}

function syncPill() {
  if (!sync) return '<span id="sync-pill"></span>';
  const s = syncState.state;
  const label = s === 'busy' ? 'Synchro…' : s === 'ok' ? 'Synchronisé' : s === 'error' ? (syncState.msg.startsWith('Hors ligne') ? 'Hors ligne' : 'Synchro en échec') : 'Synchro';
  return `<button id="sync-pill" class="sync-pill ${s}" data-action="settings"><span class="dot"></span>${label}</button>`;
}
function syncInfo() {
  if (!sync) return '';
  const s = syncState;
  if (s.state === 'busy') return 'Synchronisation en cours…';
  if (s.state === 'error') return `<span class="sync-err">${esc(s.msg)}</span>`;
  if (s.at) return 'Dernière synchro à ' + new Date(s.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
  return '';
}
function connectionCode(cfg) {
  return 'REV1-' + btoa(JSON.stringify({ o: cfg.owner, r: cfg.repo, t: cfg.token }));
}
function readConnectionCode(code) {
  const m = code.trim().match(/^REV1-([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const d = JSON.parse(atob(m[1]));
    return d.o && d.r && d.t ? { owner: d.o, repo: d.r, token: d.t } : null;
  } catch (e) { return null; }
}

/* ---------- Utilitaires ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pct(score, total) { return total ? Math.round((score / total) * 100) : 0; }
function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
function shorten(s, n = 50) { s = s.replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 2600);
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="5" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/><path d="M10 6h10M10 12h10M10 18h10"/></svg>',
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  diagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6" y="8" width="6" height="3" rx="1" fill="currentColor"/><rect x="12" y="14" width="6" height="3" rx="1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

/* =========================================================
   Lecture du fichier .txt
   Format :
     Question ?
     * bonne réponse
     - mauvaise réponse
     - mauvaise réponse
     - mauvaise réponse
     > explication facultative
   (ligne vide entre deux questions, # = commentaire)
   ========================================================= */
function parseQuizText(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const questions = [];
  const errors = [];
  const seen = new Set();
  let cur = null;

  const finish = () => {
    if (!cur) return;
    const q = cur.q.join('\n').trim();
    const label = `« ${esc(shorten(q))} » (ligne ${cur.line})`;
    const nCorrect = cur.choices.filter(c => c.correct).length;
    if (cur.choices.length !== 4) {
      errors.push(`${label} : ${plural(cur.choices.length, 'réponse trouvée', 'réponses trouvées')}, il en faut 4.`);
    } else if (nCorrect === 0) {
      errors.push(`${label} : aucune bonne réponse. Mets une * devant la bonne.`);
    } else if (nCorrect > 1) {
      errors.push(`${label} : ${nCorrect} réponses marquées *, il en faut une seule.`);
    } else {
      const answer = cur.choices.findIndex(c => c.correct);
      const id = hash(q + '|' + cur.choices[answer].text);
      if (seen.has(id)) {
        errors.push(`${label} : question en double, ignorée.`);
      } else {
        seen.add(id);
        const item = { id, q, choices: cur.choices.map(c => c.text), answer };
        if (cur.explain) item.explain = cur.explain;
        questions.push(item);
      }
    }
    cur = null;
  };

  // Format « tout sur une ligne » (texte copié depuis Anki, un PDF, une page web…) :
  //   Question ? * bonne - mauvaise - mauvaise - mauvaise
  //   Question ? * bonne - mauvaise - mauvaise - mauvaise > explication
  // Si la ligne contient une étoile suivie d'un espace, on la découpe
  // devant chaque « * » ou « - » précédé et suivi d'un espace.
  // Tout ce qui suit le premier « > » est l'explication (pas découpée).
  const expanded = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line && !line.startsWith('#') && /(^|\s)\*\s/.test(line) && /\s[-–—•*]\s/.test(line)) {
      const cut = line.search(/\s>\s/);
      const head = cut === -1 ? line : line.slice(0, cut);
      head.split(/\s+(?=[*\-–—•]\s)/).forEach(part => expanded.push({ line: part.trim(), n: i + 1 }));
      if (cut !== -1) expanded.push({ line: line.slice(cut).trim(), n: i + 1 });
    } else {
      expanded.push({ line, n: i + 1 });
    }
  });

  expanded.forEach(({ line, n }) => {
    if (!line) { finish(); return; }
    if (line.startsWith('#')) return;

    const info = line.match(/^>\s*(.+)$/);
    if (info) {
      if (!cur) { errors.push(`Ligne ${n} : explication (>) sans question au-dessus.`); return; }
      cur.explain = (cur.explain ? cur.explain + '\n' : '') + info[1].trim();
      return;
    }

    const good = line.match(/^\*\s*(.+)$/);
    const bad = line.match(/^[-–—•]\s+(.+)$/);
    if (good || bad) {
      if (!cur) { errors.push(`Ligne ${n} : réponse sans question au-dessus.`); return; }
      cur.choices.push({ text: (good || bad)[1].trim(), correct: !!good });
    } else {
      if (cur && cur.choices.length) finish();
      if (!cur) cur = { q: [], choices: [], line: n };
      cur.q.push(line);
    }
  });
  finish();
  return { questions, errors };
}

async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buf); // fichiers du Bloc-notes Windows ancien format
  }
}

/* ---------- Statistiques ---------- */
function toReview(quiz) {
  return quiz.questions.filter(q => quiz.stats[q.id] && quiz.stats[q.id].last === 'ko');
}
function bestScore(quiz) {
  const full = quiz.history.filter(h => h.mode === 'all');
  if (!full.length) return null;
  return Math.max(...full.map(h => pct(h.score, h.total)));
}
function recordAnswer(quiz, qid, ok) {
  const s = quiz.stats[qid] || (quiz.stats[qid] = { right: 0, wrong: 0, last: null });
  if (ok) s.right++; else s.wrong++;
  s.last = ok ? 'ok' : 'ko';
  quiz.updatedAt = Date.now();
  saveDb();
}

/* =========================================================
   Écrans
   ========================================================= */
function go(screen, extra = {}) {
  const leavingQuiz = state.screen === 'play' && screen !== 'play';
  state = { screen, ...extra };
  render();
  window.scrollTo(0, 0);
  if (leavingQuiz) scheduleSync(500);
}

function render() {
  const view = VIEWS[state.screen] || VIEWS.home;
  $app.innerHTML = view();
  if (state.screen === 'import') bindImport();
  hydrateImages();
}

const VIEWS = {
  /* ----- Accueil ----- */
  home() {
    const list = db.quizzes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const head = `
      <div class="topbar">
        ${syncPill()}
        <button class="icon-btn" data-action="settings" aria-label="Réglages">${ICONS.gear} Réglages</button>
      </div>
      <header class="home-head">
        <h1>Mes révisions</h1>
      </header>`;

    const diagramsItem = `
        <button class="menu-item" data-action="diagrams">
          <span class="menu-icon" aria-hidden="true">${ICONS.diagram}</span>
          <span class="menu-text">
            <span class="menu-title">Mes schémas</span>
            <span class="menu-sub">${db.diagrams.length ? plural(db.diagrams.length, 'schéma', 'schémas') + ', touche les cases pour révéler' : 'Aucun schéma pour le moment'}</span>
          </span>
        </button>`;

    if (!list.length) {
      return head + `
        <div class="empty">
          <h2>Ajoute ton premier thème</h2>
          <p>Écris tes questions dans un fichier .txt, puis importe-le depuis <strong>Réglages → Importer</strong>. Chaque question a 4 réponses, la bonne commence par une étoile.</p>
<pre>Quelle est la capitale de l'Italie ?
* Rome
- Milan
- Naples
- Turin</pre>
          <p class="muted small">Laisse une ligne vide entre deux questions.</p>
        </div>
        <div class="menu" style="margin-top:12px">${diagramsItem}</div>
        ${dock(`<button class="btn btn-primary" data-action="settings">Ouvrir les réglages pour importer</button>`)}`;
    }

    const totalQ = list.reduce((n, q) => n + q.questions.length, 0);
    const totalRev = list.reduce((n, q) => n + toReview(q).length, 0);
    return head + `
      <div class="menu">
        <button class="menu-item" data-action="mix">
          <span class="menu-icon" aria-hidden="true">${ICONS.shuffle}</span>
          <span class="menu-text">
            <span class="menu-title">Commencer un quiz</span>
            <span class="menu-sub">Questions mélangées de tous tes thèmes, tu choisis combien</span>
          </span>
        </button>
        <button class="menu-item" data-action="themes">
          <span class="menu-icon" aria-hidden="true">${ICONS.list}</span>
          <span class="menu-text">
            <span class="menu-title">Commencer un thème</span>
            <span class="menu-sub">${plural(list.length, 'thème', 'thèmes')}, ${plural(totalQ, 'question', 'questions')}${totalRev ? `, <span class="badge-err">${totalRev} à revoir</span>` : ''}</span>
          </span>
        </button>
        ${diagramsItem}
      </div>
`;
  },

  /* ----- Liste des thèmes ----- */
  themes() {
    const list = db.quizzes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour à l'accueil">${ICONS.back}</button>
      </div>
      <h1 style="margin-bottom:18px">Mes thèmes</h1>
      ${list.length ? `<ul class="subject-list">
        ${list.map(q => {
          const rev = toReview(q).length;
          const best = bestScore(q);
          return `<li><button class="subject" data-action="open" data-id="${q.id}">
            <h3>${esc(q.title)}</h3>
            <span class="meta">${plural(q.questions.length, 'question', 'questions')}${rev ? `, <span class="badge-err">${rev} à revoir</span>` : ''}</span>
            <span class="score">${best === null ? '–' : best + ' %'}<small>${best === null ? 'pas encore fait' : 'meilleur'}</small></span>
          </button></li>`;
        }).join('')}
      </ul>` : '<p class="muted">Aucun thème pour le moment. Importe-en un depuis <strong>Réglages → Importer</strong>.</p>'}`;
  },

  /* ----- Quiz mélangé ----- */
  mix() {
    const list = db.quizzes.slice().sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    const sel = state.sel;
    const total = list.filter(q => sel.has(q.id)).reduce((n, q) => n + q.questions.length, 0);
    const allOn = list.every(q => sel.has(q.id));
    const someOn = !allOn && list.some(q => sel.has(q.id));
    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour à l'accueil">${ICONS.back}</button>
      </div>
      <h1>Commencer un quiz</h1>
      <p class="muted" style="margin-top:8px">Les questions sont tirées au hasard dans les thèmes cochés.</p>

      ${total ? countPicker(total) : ''}

      <div class="section">
        <h2>Thèmes inclus</h2>
        <div class="check-list">
          <button class="check-row all ${allOn ? 'on' : someOn ? 'some' : ''}" data-action="toggle-all" role="checkbox" aria-checked="${allOn ? 'true' : someOn ? 'mixed' : 'false'}">
            <span class="box" aria-hidden="true">${allOn ? ICONS.check : someOn ? ICONS.dash : ICONS.check}</span>
            <span class="check-title">Tous les thèmes</span>
            <span class="muted small">${list.reduce((n, q) => n + q.questions.length, 0)}</span>
          </button>
          ${list.map(q => `
            <button class="check-row ${sel.has(q.id) ? 'on' : ''}" data-action="toggle-theme" data-id="${q.id}" role="checkbox" aria-checked="${sel.has(q.id)}">
              <span class="box" aria-hidden="true">${ICONS.check}</span>
              <span class="check-title">${esc(q.title)}</span>
              <span class="muted small">${q.questions.length}</span>
            </button>`).join('')}
        </div>
      </div>

      ${dock(total
        ? `<button class="btn btn-primary" id="start-btn" data-action="start-mix">${startLabel()}</button>`
        : `<button class="btn btn-primary" disabled>Coche au moins un thème</button>`)}`;
  },

  /* ----- Import ----- */
  import() {
    const imp = state.imp;
    return `
      <div class="topbar">
        <button class="icon-btn" data-action="${imp.replaceId ? 'open' : 'settings'}" data-id="${imp.replaceId || ''}" aria-label="Retour">${ICONS.back}</button>
      </div>
      <h1>${imp.replaceId ? 'Remplacer les questions' : 'Nouveau thème'}</h1>
      <p class="muted" style="margin:8px 0 22px">Choisis ton fichier .txt ou colle son contenu.</p>

      <button class="btn btn-secondary" data-action="pick-file">Choisir un fichier .txt</button>
      <p class="or">ou</p>

      <div class="field">
        <label for="imp-text">Contenu du quiz</label>
        <textarea id="imp-text" placeholder="Quelle est la capitale de l'Italie ?&#10;* Rome&#10;- Milan&#10;- Naples&#10;- Turin" spellcheck="false" autocapitalize="off">${esc(imp.text)}</textarea>
      </div>
      <div class="field">
        <label for="imp-title">Nom du thème</label>
        <input id="imp-title" type="text" value="${esc(imp.title)}" placeholder="Ex. : Droit des contrats, chapitre 2" autocomplete="off">
      </div>
      <div id="imp-report"></div>
      ${dock(`<button class="btn btn-primary" id="imp-go" data-action="do-import" disabled>Importer</button>`)}`;
  },

  /* ----- Fiche matière ----- */
  subject() {
    const quiz = getQuiz(state.id);
    if (!quiz) return VIEWS.home();
    const rev = toReview(quiz);
    const best = bestScore(quiz);
    const total = quiz.questions.length;
    const hist = quiz.history.slice(-8).reverse();
    const missed = quiz.questions
      .filter(q => quiz.stats[q.id] && quiz.stats[q.id].wrong > 0)
      .sort((a, b) => quiz.stats[b.id].wrong - quiz.stats[a.id].wrong)
      .slice(0, 5);

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="themes" aria-label="Retour aux thèmes">${ICONS.back}</button>
      </div>
      <h1>${esc(quiz.title)}</h1>

      <div class="stats">
        <div class="stat"><b>${total}</b><span>questions</span></div>
        <div class="stat"><b>${best === null ? '–' : best + '%'}</b><span>meilleur score</span></div>
        <div class="stat ${rev.length ? 'err' : ''}"><b>${rev.length}</b><span>à revoir</span></div>
      </div>

      ${countPicker(total)}

      ${missed.length ? `
      <div class="section">
        <h2>Les plus ratées</h2>
        ${missed.map(q => `
          <div class="mistake">
            <span class="count">Ratée ${quiz.stats[q.id].wrong} fois</span>
            <p class="q">${esc(q.q)}</p>
            <p class="a right"><span class="dot"></span><span>${esc(q.choices[q.answer])}</span></p>
            ${q.explain ? `<p class="explain small">${esc(q.explain)}</p>` : ''}
          </div>`).join('')}
      </div>` : ''}

      ${hist.length ? `
      <div class="section">
        <h2>Historique</h2>
        <ul class="history">
          ${hist.map(h => `<li><span>${fmtDate(h.date)}${h.mode === 'mix' ? ' <span class="muted">(quiz mélangé)</span>' : h.mode !== 'all' ? ' <span class="muted">(erreurs)</span>' : ''}</span><span class="s">${h.score}/${h.total}</span></li>`).join('')}
        </ul>
      </div>` : ''}

      <div class="text-actions">
        <button class="link-btn" data-action="replace" data-id="${quiz.id}">Remplacer les questions</button>
        <button class="link-btn" data-action="reset-stats" data-id="${quiz.id}">Effacer mon suivi</button>
        <button class="link-btn danger" data-action="delete" data-id="${quiz.id}">Supprimer le thème</button>
      </div>

      ${dock(`
        <button class="btn btn-primary" id="start-btn" data-action="start" data-mode="all">${startLabel()}</button>
        ${rev.length ? `<button class="btn btn-secondary" data-action="start" data-mode="errors">Revoir mes ${plural(rev.length, 'erreur', 'erreurs')}</button>` : ''}
      `)}`;
  },

  /* ----- Quiz en cours ----- */
  play() {
    const s = state.session;
    const item = s.items[s.idx];
    const quiz = getQuiz(item.quizId);
    const q = findQ(item);
    if (!q) { // question supprimée entre-temps (synchro) : on passe à la suivante
      s.items.splice(s.idx, 1);
      if (!s.items.length) return VIEWS.home();
      s.idx = Math.min(s.idx, s.items.length - 1);
      return VIEWS.play();
    }
    const n = s.items.length;
    const done = item.picked !== null;
    const last = s.idx === n - 1;

    const choices = item.order.map((ci, pos) => {
      let cls = '';
      if (done) {
        if (ci === q.answer) cls = 'correct';
        else if (ci === item.picked) cls = 'wrong picked';
      }
      return `<button class="choice ${cls}" data-action="pick" data-c="${ci}" ${done ? 'disabled' : ''}>
        <span class="bubble"><b>${LETTERS[pos]}</b></span>
        <span>${esc(q.choices[ci])}</span>
      </button>`;
    }).join('');

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="quit" aria-label="Arrêter le quiz">${ICONS.close}</button>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${s.idx + (done ? 1 : 0)}"><span style="width:${((s.idx + (done ? 1 : 0)) / n) * 100}%"></span></div>
        <span class="q-count">${s.idx + 1} / ${n}</span>
      </div>
      ${s.origin.type === 'mix' ? `<p class="q-theme">${esc(quiz.title)}</p>` : ''}
      <p class="question">${esc(q.q)}</p>
      <div class="choices ${done ? 'answered' : ''}">${choices}</div>
      ${done && item.ok ? `<p class="verdict good">Bonne réponse</p>` : ''}
      ${done && q.explain ? `<p class="explain">${esc(q.explain)}</p>` : ''}
      ${done ? dock(`<button class="btn btn-primary" data-action="next">${last ? 'Voir mon score' : 'Question suivante'}</button>`) : ''}`;
  },

  /* ----- Résultats ----- */
  result() {
    const s = state.session;
    const score = s.items.filter(i => i.ok).length;
    const n = s.items.length;
    const p = pct(score, n);
    const mistakes = s.items.filter(i => !i.ok && findQ(i));
    const msg = p === 100 ? 'Sans faute !' : p >= 80 ? 'Très bien, presque parfait.' : p >= 50 ? 'Bonne base, continue.' : 'Encore un peu de travail.';
    const back = s.origin.type === 'mix'
      ? `data-action="home">Retour à l'accueil`
      : `data-action="open" data-id="${s.origin.id}">Retour au thème`;

    return `
      <div class="result-hero">
        <div class="big">${score}<small>/${n}</small></div>
        <p><strong>${p} %</strong> de bonnes réponses</p>
        <p class="muted small">${msg}</p>
      </div>

      ${mistakes.length ? `
      <div class="section">
        <h2>Tes erreurs</h2>
        ${mistakes.map(i => {
          const q = findQ(i);
          return `<div class="mistake">
            ${s.origin.type === 'mix' ? `<span class="q-theme small">${esc(getQuiz(i.quizId).title)}</span>` : ''}
            <p class="q">${esc(q.q)}</p>
            <p class="a yours"><span class="dot"></span><span>${esc(q.choices[i.picked])}</span></p>
            <p class="a right"><span class="dot"></span><span>${esc(q.choices[q.answer])}</span></p>
            ${q.explain ? `<p class="explain small">${esc(q.explain)}</p>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}

      ${dock(mistakes.length
        ? `<button class="btn btn-primary" data-action="retry">Refaire ces ${plural(mistakes.length, 'erreur', 'erreurs')}</button>
           <button class="btn btn-secondary" ${back}</button>`
        : `<button class="btn btn-primary" ${back}</button>`)}`;
  },

  /* ----- Liste des schémas : onglets Réviser / Modifier ----- */
  diagrams() {
    const tab = state.dtab || lastDiagramTab;
    lastDiagramTab = tab;
    const all = db.diagrams.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const list = tab === 'study' ? all.filter(d => d.zones.length) : all;
    const card = d => `<li><button class="diagram-card" data-action="open-diagram" data-id="${d.id}">
          <span class="thumb"><img data-img="${d.id}" alt=""></span>
          <span class="diagram-meta">
            <h3>${esc(d.title)}</h3>
            <span class="muted small">${d.zones.length ? plural(d.zones.length, 'case', 'cases') : 'Aucune case pour le moment'}</span>
          </span>
        </button></li>`;
    const empty = tab === 'study'
      ? `<div class="empty"><p>${all.length
          ? "Aucun schéma n'a encore de cases. Va dans l'onglet <strong>Modifier</strong> pour en dessiner."
          : 'Aucun schéma pour le moment. Importe-en un depuis <strong>Réglages → Importer</strong>.'}</p></div>`
      : `<div class="empty"><p>Aucun schéma pour le moment. Importe une photo ou une capture d'écran depuis <strong>Réglages → Importer</strong>, puis dessine des cases sur les textes à retenir.</p></div>`;

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour à l'accueil">${ICONS.back}</button>
      </div>
      <h1>Mes schémas</h1>
      ${diagramTabs(tab, 'list-tab')}
      <p class="muted" style="margin:0 0 16px">${tab === 'study'
        ? 'Touche un schéma, puis touche ses cases pour révéler les textes.'
        : 'Touche un schéma pour dessiner ou supprimer ses cases.'}</p>
      ${list.length ? `<ul class="diagram-list">${list.map(card).join('')}</ul>` : empty}
`;
  },

  /* ----- Un schéma : onglet Réviser ou Modifier ----- */
  diagram() {
    const d = getDiagram(state.id);
    if (!d) return VIEWS.diagrams();
    const edit = state.edit;
    const open = state.revealed;
    const zoom = state.zoom || 1;
    const zones = d.zones.map(z => {
      const cls = edit ? (state.selZone === z.id ? 'sel' : '') : (open.has(z.id) ? 'open' : '');
      return `<button class="zone ${cls}" data-action="${edit ? 'zone-select' : 'zone-tap'}" data-z="${z.id}"
        style="left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%"
        aria-label="${edit ? 'Case' : open.has(z.id) ? 'Case révélée' : 'Case cachée, toucher pour révéler'}"></button>`;
    }).join('');

    const head = edit ? `
      <div class="field">
        <label for="dg-title">Nom du schéma</label>
        <input id="dg-title" type="text" value="${esc(d.title)}" autocomplete="off">
      </div>
      <div class="seg" role="group" aria-label="Outil">
        <button class="${state.tool !== 'move' ? 'on' : ''}" data-action="tool" data-t="draw">Dessiner des cases</button>
        <button class="${state.tool === 'move' ? 'on' : ''}" data-action="tool" data-t="move">Faire défiler</button>
      </div>
      <p class="muted small" style="margin:10px 0 12px">${state.tool === 'move'
        ? "Fais défiler l'image zoomée, puis repasse sur « Dessiner des cases »."
        : 'Fais glisser ton doigt sur un texte pour le cacher. Touche une case pour la sélectionner.'}</p>`
      : `
      <p class="muted" id="dg-count" style="margin:0 0 14px">${d.zones.length
        ? `${open.size} / ${plural(d.zones.length, 'case révélée', 'cases révélées')}`
        : "Aucune case pour le moment. Va dans l'onglet « Modifier » pour en dessiner."}</p>`;

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="diagrams-back" aria-label="Retour aux schémas">${ICONS.back}</button>
        <div class="zoom" role="group" aria-label="Zoom">
          <button class="icon-btn" data-action="zoom" data-d="-1" aria-label="Dézoomer" ${zoom <= 1 ? 'disabled' : ''}>−</button>
          <span class="zoom-val">${Math.round(zoom * 100)} %</span>
          <button class="icon-btn" data-action="zoom" data-d="1" aria-label="Zoomer" ${zoom >= 4 ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <h1 class="dg-title">${esc(d.title)}</h1>
      ${diagramTabs(edit ? 'edit' : 'study', 'dg-mode')}
      ${head}
      <div class="stage-wrap ${edit && state.tool !== 'move' ? 'drawing' : ''}" id="stage-wrap">
        <div class="stage ${edit ? 'editing' : ''}" id="stage" style="width:${zoom * 100}%">
          <img data-img="${d.id}" alt="${esc(d.title)}" draggable="false">
          ${zones}
          <div class="zone draft" id="draft" hidden></div>
        </div>
      </div>
      ${edit ? `
        <div class="text-actions">
          <button class="link-btn danger" data-action="delete-diagram">Supprimer le schéma</button>
        </div>` : ''}
      ${dock(edit
        ? (state.selZone
          ? '<button class="btn btn-danger" data-action="zone-delete">Supprimer cette case</button>'
          : `<button class="btn btn-primary" data-action="dg-mode" data-m="study" ${d.zones.length ? '' : 'disabled'}>Réviser ce schéma</button>`)
        : d.zones.length
          ? `<div class="row">
               <button class="btn btn-secondary" data-action="hide-all">Tout cacher</button>
               <button class="btn btn-secondary" data-action="reveal-all">Tout révéler</button>
             </div>`
          : `<button class="btn btn-primary" data-action="dg-mode" data-m="edit">Dessiner des cases</button>`)}`;
  },

  /* ----- Réglages : synchronisation + sauvegarde ----- */
  settings() {
    const syncBlock = sync ? `
        <p>Connecté au dépôt <strong>${esc(sync.owner)}/${esc(sync.repo)}</strong>. Tes quiz et ton suivi sont partagés avec tes autres appareils connectés.</p>
        <p class="muted small" id="sync-info" style="margin-top:6px">${syncInfo()}</p>
        <div class="stack">
          <button class="btn btn-primary" data-action="sync-now">Synchroniser maintenant</button>
          <button class="btn btn-secondary" data-action="copy-code">Copier le code pour un autre appareil</button>
        </div>
        <p class="muted small" style="margin-top:10px">Le code contient ta clé d'accès. Une fois collé sur l'autre appareil, supprime le message ou la note qui l'a transporté.</p>
        <div class="text-actions"><button class="link-btn danger" data-action="disconnect">Déconnecter cet appareil</button></div>`
      : `
        <p class="muted">Connecte cet appareil à ton dépôt GitHub privé pour retrouver tes quiz et ton suivi partout.</p>
        <div class="field" style="margin-top:16px">
          <label for="sync-code">Code de connexion</label>
          <input id="sync-code" type="text" placeholder="REV1-…" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <button class="btn btn-primary" data-action="connect-code">Connecter avec le code</button>
        <p class="or">ou, la première fois</p>
        <div class="field">
          <label for="sync-owner">Ton pseudo GitHub</label>
          <input id="sync-owner" type="text" placeholder="geotraceur59-art" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="field">
          <label for="sync-repo">Nom du dépôt privé</label>
          <input id="sync-repo" type="text" value="revisions-donnees" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="field">
          <label for="sync-token">Clé d'accès (commence par github_pat_)</label>
          <input id="sync-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <button class="btn btn-secondary" data-action="connect-form">Connecter</button>`;

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour">${ICONS.back}</button>
      </div>
      <h1>Réglages</h1>

      <div class="section">
        <h2>Importer</h2>
        <div class="import-grid">
          <button class="import-card" data-action="new-import">
            <span class="menu-icon" aria-hidden="true">${ICONS.list}</span>
            <span class="menu-text">
              <span class="menu-title">Un thème de questions</span>
              <span class="menu-sub">Fichier .txt ou texte collé</span>
            </span>
          </button>
          <button class="import-card" data-action="new-diagram">
            <span class="menu-icon" aria-hidden="true">${ICONS.diagram}</span>
            <span class="menu-text">
              <span class="menu-title">Un schéma</span>
              <span class="menu-sub">Photo ou capture d'écran</span>
            </span>
          </button>
        </div>
      </div>

      <div class="section">
        <h2>Synchronisation</h2>
        ${syncBlock}
      </div>

      <div class="section">
        <h2>Sauvegarde</h2>
        <p class="muted">Un fichier avec tous tes quiz et ton suivi, à ranger dans Fichiers ou iCloud Drive.</p>
        <div class="stack">
          <button class="btn btn-secondary" data-action="export">Créer une sauvegarde</button>
          <button class="btn btn-secondary" data-action="restore">Restaurer une sauvegarde</button>
        </div>
        <p class="muted small" style="margin-top:10px">Restaurer remplace toutes les données de cet appareil.</p>
      </div>`;
  },
};

function dock(inner) {
  return `<div class="dock"><div class="dock-inner">${inner}</div></div>`;
}

/* ---------- Schémas : images, import, dessin ---------- */
async function hydrateImages() {
  for (const img of document.querySelectorAll('img[data-img]')) {
    const url = await Images.url(img.dataset.img).catch(() => null);
    if (url) { img.src = url; img.closest('.thumb, .stage')?.classList.remove('missing'); }
    else img.closest('.thumb, .stage')?.classList.add('missing');
  }
}

// Réduit l'image (1800 px max, JPEG) pour qu'elle reste légère et synchronisable
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(src);
      const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // fond blanc pour les PNG transparents
      ctx.drawImage(img, 0, 0, w, h);
      let blob = null;
      for (const q of [0.86, 0.75, 0.62, 0.5]) {
        blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size < 700 * 1024) break;
      }
      blob ? resolve({ blob, w, h }) : reject(new Error('conversion'));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('lecture')); };
    img.src = src;
  });
}

const $imageInput = document.createElement('input');
$imageInput.type = 'file';
$imageInput.accept = 'image/*';
$imageInput.hidden = true;
document.body.appendChild($imageInput);

$imageInput.addEventListener('change', async () => {
  const file = $imageInput.files[0];
  if (!file) return;
  toast('Préparation du schéma…');
  try {
    const { blob, w, h } = await compressImage(file);
    const id = uid();
    await Images.set(id, blob);
    const title = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Schéma';
    db.diagrams.push({ id, title, w, h, zones: [], createdAt: Date.now(), updatedAt: Date.now() });
    saveDb();
    toast('Schéma importé : dessine tes cases');
    lastDiagramTab = 'edit';
    go('diagram', { id, edit: true, revealed: new Set(), tool: 'draw', zoom: 1 });
  } catch (e) {
    toast("Impossible de lire cette image. Essaie une capture d'écran en PNG ou JPEG.");
  }
});

// Dessin d'une case au doigt (mode modification)
let drawing = null;
function stagePoint(e) {
  const r = document.getElementById('stage').getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}
function boxFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
$app.addEventListener('pointerdown', e => {
  if (state.screen !== 'diagram' || !state.edit || state.tool === 'move') return;
  if (!e.target.closest('#stage') || e.target.closest('.zone:not(.draft)')) return;
  e.preventDefault();
  drawing = { start: stagePoint(e), id: e.pointerId };
  document.getElementById('stage').setPointerCapture?.(e.pointerId);
});
$app.addEventListener('pointermove', e => {
  if (!drawing || e.pointerId !== drawing.id) return;
  const b = boxFrom(drawing.start, stagePoint(e));
  const el = document.getElementById('draft');
  el.hidden = false;
  Object.assign(el.style, { left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' });
});
function endDraw(e) {
  if (!drawing || e.pointerId !== drawing.id) return;
  const b = boxFrom(drawing.start, stagePoint(e));
  drawing = null;
  const d = getDiagram(state.id);
  const r = document.getElementById('stage').getBoundingClientRect();
  if (d && b.w * r.width >= 12 && b.h * r.height >= 8) { // assez grande pour être une vraie case
    const z = { id: uid(), ...b };
    d.zones.push(z);
    d.updatedAt = Date.now();
    state.selZone = null;
    saveDb();
  }
  rerenderKeepScroll();
}
$app.addEventListener('pointerup', endDraw);
$app.addEventListener('pointercancel', e => { if (drawing && e.pointerId === drawing.id) { drawing = null; rerenderKeepScroll(); } });

function rerenderKeepScroll() {
  const y = window.scrollY;
  const wrap = document.getElementById('stage-wrap');
  const sx = wrap ? wrap.scrollLeft : 0, sy = wrap ? wrap.scrollTop : 0;
  render();
  window.scrollTo(0, y);
  const w2 = document.getElementById('stage-wrap');
  if (w2) { w2.scrollLeft = sx; w2.scrollTop = sy; }
}

let lastDiagramTab = 'study';
function diagramTabs(current, action) {
  return `
    <div class="tabs" role="tablist" aria-label="Mode">
      <button role="tab" aria-selected="${current === 'study'}" class="${current === 'study' ? 'on' : ''}" data-action="${action}" data-m="study">Réviser</button>
      <button role="tab" aria-selected="${current === 'edit'}" class="${current === 'edit' ? 'on' : ''}" data-action="${action}" data-m="edit">Modifier</button>
    </div>`;
}

function findQ(item) {
  const quiz = getQuiz(item.quizId);
  return quiz ? quiz.questions.find(x => x.id === item.qid) : null;
}

/* ---------- Choix du nombre de questions ---------- */
const COUNT_KEY = 'revisions.count';
function preferredCount() {
  try { return Number(localStorage.getItem(COUNT_KEY)) || 20; } catch (e) { return 20; }
}
function clampCount(n, total) {
  n = Math.round(Number(n));
  if (!n || n < 1) n = 1;
  return Math.min(n, total);
}
function countPicker(total) {
  state.total = total;
  state.count = clampCount(state.want || preferredCount(), total); // « want » = le choix de l'utilisateur, gardé même si on décoche un thème
  const n = state.count;
  return `
    <div class="section">
      <h2>Nombre de questions</h2>
      <div class="gauge">
        <p class="gauge-value"><b id="count-value">${n}</b><span>/ ${total}</span></p>
        <div class="gauge-row">
          <button class="step" data-action="count-step" data-d="-1" aria-label="Une question de moins">−</button>
          <input id="count-range" class="range" type="range" min="1" max="${total}" step="1" value="${n}"
                 style="--p:${gaugePct(n, total)}%" aria-label="Nombre de questions" aria-valuetext="${plural(n, 'question', 'questions')}">
          <button class="step" data-action="count-step" data-d="1" aria-label="Une question de plus">+</button>
        </div>
        <div class="gauge-ends"><span>1</span><span>${total}</span></div>
      </div>
    </div>`;
}
function gaugePct(n, total) {
  return total > 1 ? ((n - 1) / (total - 1)) * 100 : 100;
}
function startLabel() {
  return 'Lancer ' + plural(state.count || 1, 'question', 'questions');
}
function setCount(n, rerender) {
  state.count = clampCount(n, state.total);
  state.want = state.count;
  try { localStorage.setItem(COUNT_KEY, String(state.count)); } catch (e) { /* rien */ }
  if (rerender) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }
  // Mise à jour légère pendant que le doigt glisse sur la jauge
  const range = document.getElementById('count-range');
  if (range) {
    range.value = state.count;
    range.style.setProperty('--p', gaugePct(state.count, state.total) + '%');
    range.setAttribute('aria-valuetext', plural(state.count, 'question', 'questions'));
  }
  const val = document.getElementById('count-value');
  if (val) val.textContent = state.count;
  const btn = document.getElementById('start-btn');
  if (btn) btn.textContent = startLabel();
}

/* ---------- Import : rapport en direct ---------- */
function bindImport() {
  const $text = document.getElementById('imp-text');
  const $title = document.getElementById('imp-title');
  $text.addEventListener('input', () => { state.imp.text = $text.value; updateImportReport(); });
  $title.addEventListener('input', () => { state.imp.title = $title.value; updateImportReport(); });
  updateImportReport();
}

function updateImportReport() {
  const imp = state.imp;
  const $rep = document.getElementById('imp-report');
  const $go = document.getElementById('imp-go');
  if (!$rep) return;
  if (!imp.text.trim()) { $rep.innerHTML = ''; $go.disabled = true; $go.textContent = 'Importer'; return; }

  const { questions, errors } = parseQuizText(imp.text);
  imp.parsed = questions;
  const title = imp.title.trim();
  const existing = !imp.replaceId && title && db.quizzes.find(q => q.title.toLowerCase() === title.toLowerCase());

  let html = '';
  if (questions.length) {
    html += `<div class="report ok"><strong>${plural(questions.length, 'question prête', 'questions prêtes')}</strong>
      ${existing ? `<span class="small">« ${esc(existing.title)} » existe déjà : ses questions seront remplacées, ton suivi est gardé pour les questions identiques.</span>` : ''}</div>`;
  }
  if (errors.length) {
    html += `<div class="report ko"><strong>${plural(errors.length, 'problème', 'problèmes')} dans le texte</strong>
      <ul>${errors.slice(0, 12).map(e => `<li>${e}</li>`).join('')}</ul>
      ${errors.length > 12 ? `<span class="small">… et ${errors.length - 12} autres.</span>` : ''}
      ${questions.length ? '<span class="small">Les questions avec un problème ne seront pas importées.</span>' : ''}</div>`;
  }
  $rep.innerHTML = html;
  $go.disabled = !questions.length || !title;
  $go.textContent = !title && questions.length ? 'Donne un nom au thème'
    : questions.length ? `Importer ${plural(questions.length, 'question', 'questions')}` : 'Importer';
}

/* =========================================================
   Actions
   ========================================================= */
// items : [{ quizId, qid }] ; origin : { type: 'theme', id } ou { type: 'mix' }
function startSession(pairs, mode, origin) {
  const items = pairs.map(p => ({ quizId: p.quizId, qid: p.qid, order: shuffle([0, 1, 2, 3]), picked: null, ok: null }));
  go('play', { session: { items, idx: 0, mode, origin } });
}

const ACTIONS = {
  home: () => go('home'),
  settings: () => go('settings'),
  open: el => go('subject', { id: el.dataset.id }),

  'new-import': () => go('import', { imp: { title: '', text: '', parsed: [], replaceId: null } }),
  replace: el => {
    const quiz = getQuiz(el.dataset.id);
    go('import', { imp: { title: quiz.title, text: '', parsed: [], replaceId: quiz.id } });
  },
  'pick-file': () => { $fileInput.value = ''; $fileInput.click(); },

  'do-import': () => {
    const imp = state.imp;
    const title = imp.title.trim();
    if (!title || !imp.parsed.length) return;
    let quiz = imp.replaceId ? getQuiz(imp.replaceId)
      : db.quizzes.find(q => q.title.toLowerCase() === title.toLowerCase());
    if (quiz) {
      const keep = new Set(imp.parsed.map(q => q.id));
      Object.keys(quiz.stats).forEach(id => { if (!keep.has(id)) delete quiz.stats[id]; });
      quiz.title = title;
      quiz.questions = imp.parsed;
      quiz.updatedAt = Date.now();
    } else {
      quiz = { id: uid(), title, questions: imp.parsed, stats: {}, history: [], createdAt: Date.now(), updatedAt: Date.now() };
      db.quizzes.push(quiz);
    }
    saveDb();
    toast(`${plural(imp.parsed.length, 'question importée', 'questions importées')}`);
    go('subject', { id: quiz.id });
  },

  themes: () => go('themes'),
  mix: () => go('mix', { sel: new Set(db.quizzes.map(q => q.id)) }),
  'toggle-theme': el => {
    const id = el.dataset.id;
    if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  },
  'toggle-all': () => {
    const allOn = db.quizzes.every(q => state.sel.has(q.id));
    state.sel = new Set(allOn ? [] : db.quizzes.map(q => q.id));
    const y = window.scrollY; render(); window.scrollTo(0, y);
  },
  'count-step': el => setCount((state.count || 1) + Number(el.dataset.d), false),

  start: el => {
    const quiz = getQuiz(state.id);
    let pairs;
    if (el.dataset.mode === 'errors') {
      pairs = shuffle(toReview(quiz).map(q => ({ quizId: quiz.id, qid: q.id })));
    } else {
      pairs = shuffle(quiz.questions.map(q => ({ quizId: quiz.id, qid: q.id }))).slice(0, state.count || quiz.questions.length);
    }
    if (!pairs.length) return;
    startSession(pairs, el.dataset.mode, { type: 'theme', id: quiz.id });
  },

  'start-mix': () => {
    const all = db.quizzes.filter(q => state.sel.has(q.id))
      .flatMap(quiz => quiz.questions.map(q => ({ quizId: quiz.id, qid: q.id })));
    const pairs = shuffle(all).slice(0, state.count || all.length);
    if (!pairs.length) return;
    startSession(pairs, 'mix', { type: 'mix' });
  },

  pick: el => {
    const s = state.session;
    const item = s.items[s.idx];
    if (item.picked !== null) return;
    const q = findQ(item);
    if (!q) return;
    item.picked = Number(el.dataset.c);
    item.ok = item.picked === q.answer;
    recordAnswer(getQuiz(item.quizId), q.id, item.ok);
    render();
  },

  next: () => {
    const s = state.session;
    if (s.idx < s.items.length - 1) {
      s.idx++;
      render();
      window.scrollTo(0, 0);
    } else {
      // Historique : une ligne par thème concerné
      const byQuiz = new Map();
      s.items.forEach(i => {
        const g = byQuiz.get(i.quizId) || { score: 0, total: 0 };
        g.total++; if (i.ok) g.score++;
        byQuiz.set(i.quizId, g);
      });
      byQuiz.forEach((g, quizId) => {
        const quiz = getQuiz(quizId);
        if (!quiz) return;
        quiz.history.push({ date: Date.now(), score: g.score, total: g.total, mode: s.mode });
        if (quiz.history.length > 100) quiz.history = quiz.history.slice(-100);
        quiz.updatedAt = Date.now();
      });
      saveDb();
      go('result', { session: s });
    }
  },

  quit: () => {
    if (confirm('Arrêter le quiz ? Les réponses déjà données restent enregistrées dans ton suivi.')) {
      const o = state.session.origin;
      if (o.type === 'theme' && getQuiz(o.id)) go('subject', { id: o.id }); else go('home');
    }
  },

  retry: () => {
    const s = state.session;
    const pairs = shuffle(s.items.filter(i => !i.ok && findQ(i)).map(i => ({ quizId: i.quizId, qid: i.qid })));
    startSession(pairs, s.origin.type === 'mix' ? 'mix' : 'retry', s.origin);
  },

  'reset-stats': el => {
    const quiz = getQuiz(el.dataset.id);
    if (confirm(`Effacer le suivi de « ${quiz.title} » ? Les questions sont gardées, les scores et erreurs sont remis à zéro.`)) {
      quiz.stats = {};
      quiz.history = [];
      quiz.updatedAt = Date.now();
      saveDb();
      toast('Suivi effacé');
      render();
    }
  },

  delete: el => {
    const quiz = getQuiz(el.dataset.id);
    if (confirm(`Supprimer « ${quiz.title} » et tout son suivi ?`)) {
      db.quizzes = db.quizzes.filter(q => q.id !== quiz.id);
      db.deleted[quiz.id] = Date.now();
      saveDb();
      toast('Thème supprimé');
      go('home');
    }
  },

  export: async () => {
    const name = `revisions-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    const images = {};
    for (const d of db.diagrams) {
      const b = await Images.get(d.id).catch(() => null);
      if (b) images[d.id] = await blobToBase64(b);
    }
    const blob = new Blob([JSON.stringify({ ...db, images })], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Sauvegarde Révisions' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  restore: () => { $backupInput.value = ''; $backupInput.click(); },

  /* ----- Schémas ----- */
  diagrams: () => go('diagrams', { dtab: db.diagrams.some(d => d.zones.length) ? lastDiagramTab : 'edit' }),
  'list-tab': el => go('diagrams', { dtab: el.dataset.m }),
  'diagrams-back': () => go('diagrams', { dtab: state.edit ? 'edit' : 'study' }),
  'new-diagram': () => { $imageInput.value = ''; $imageInput.click(); },
  'open-diagram': el => {
    go('diagram', { id: el.dataset.id, edit: lastDiagramTab === 'edit', revealed: new Set(), tool: 'draw', zoom: 1 });
  },
  'dg-mode': el => {
    state.edit = el.dataset.m === 'edit';
    lastDiagramTab = el.dataset.m;
    state.selZone = null; state.tool = 'draw'; state.revealed = new Set();
    rerenderKeepScroll();
  },
  'zone-tap': el => {
    const id = el.dataset.z;
    if (state.revealed.has(id)) state.revealed.delete(id); else state.revealed.add(id);
    el.classList.toggle('open', state.revealed.has(id));
    const d = getDiagram(state.id);
    const p = document.getElementById('dg-count');
    if (p) p.textContent = `${state.revealed.size} / ${plural(d.zones.length, 'case révélée', 'cases révélées')}`;
    if (state.revealed.size === d.zones.length && d.zones.length > 1 && state.revealed.has(id)) toast('Toutes les cases sont révélées');
  },
  'hide-all': () => { state.revealed = new Set(); rerenderKeepScroll(); },
  'reveal-all': () => { state.revealed = new Set(getDiagram(state.id).zones.map(z => z.id)); rerenderKeepScroll(); },
  'zone-select': el => { state.selZone = state.selZone === el.dataset.z ? null : el.dataset.z; rerenderKeepScroll(); },
  'zone-delete': () => {
    const d = getDiagram(state.id);
    d.zones = d.zones.filter(z => z.id !== state.selZone);
    d.updatedAt = Date.now();
    state.selZone = null;
    saveDb();
    rerenderKeepScroll();
  },
  tool: el => { state.tool = el.dataset.t; state.selZone = null; rerenderKeepScroll(); },
  zoom: el => {
    const steps = [1, 1.5, 2, 3, 4];
    const i = Math.max(0, steps.indexOf(state.zoom || 1) + Number(el.dataset.d));
    state.zoom = steps[Math.min(i, steps.length - 1)];
    rerenderKeepScroll();
  },
  'delete-diagram': () => {
    const d = getDiagram(state.id);
    if (!confirm(`Supprimer le schéma « ${d.title} » ?`)) return;
    db.diagrams = db.diagrams.filter(x => x.id !== d.id);
    db.deleted[d.id] = Date.now();
    Images.del(d.id).catch(() => {});
    saveDb();
    toast('Schéma supprimé');
    go('diagrams', { dtab: 'edit' });
  },

  /* ----- Synchronisation ----- */
  'connect-code': () => {
    const cfg = readConnectionCode(document.getElementById('sync-code').value);
    if (!cfg) { toast("Ce code n'est pas valide. Copie-le en entier, il commence par REV1-."); return; }
    connect(cfg);
  },
  'connect-form': () => {
    const cfg = {
      owner: document.getElementById('sync-owner').value.trim().replace(/^@/, ''),
      repo: document.getElementById('sync-repo').value.trim(),
      token: document.getElementById('sync-token').value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast('Remplis les trois champs.'); return; }
    connect(cfg);
  },
  'sync-now': () => syncNow(),
  'copy-code': async () => {
    const code = connectionCode(sync);
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copié');
    } catch (e) {
      prompt('Copie ce code :', code);
    }
  },
  disconnect: () => {
    if (!confirm("Déconnecter cet appareil ? Tes quiz restent sur l'appareil mais ne seront plus synchronisés.")) return;
    localStorage.removeItem(SYNC_KEY);
    sync = null;
    setSyncState('off');
    render();
  },
};

async function connect(cfg) {
  toast('Connexion…');
  try {
    const res = await ghFetch('', {}, cfg);
    if (!res.ok) { toast(httpMessage(res.status)); return; }
    const repo = await res.json();
    if (!repo.private && !confirm("Attention : ce dépôt est PUBLIC, tes questions y seraient visibles par tout le monde. Continuer quand même ?")) return;
    if (repo.permissions && !repo.permissions.push) { toast(httpMessage(403)); return; }
  } catch (e) {
    toast('Pas de connexion internet. Réessaie avec du réseau.');
    return;
  }
  sync = cfg;
  localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
  setSyncState('idle');
  render();
  await syncNow();
  if (syncState.state === 'ok') toast('Appareil connecté et synchronisé');
  else toast(syncState.msg || 'Connecté, mais la synchro a échoué.');
}

// Nom du schéma (mode modification)
$app.addEventListener('change', e => {
  if (e.target.id !== 'dg-title') return;
  const d = getDiagram(state.id);
  const t = e.target.value.trim();
  if (d && t && t !== d.title) { d.title = t; d.updatedAt = Date.now(); saveDb(); }
});

// Jauge du nombre de questions
$app.addEventListener('input', e => {
  if (e.target.id === 'count-range') setCount(e.target.value, false);
});

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el);
});

$fileInput.addEventListener('change', async () => {
  const file = $fileInput.files[0];
  if (!file || state.screen !== 'import') return;
  const text = await readTextFile(file);
  state.imp.text = text;
  if (!state.imp.title) state.imp.title = file.name.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ').trim();
  render();
});

$backupInput.addEventListener('change', async () => {
  const file = $backupInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await readTextFile(file));
    if (!data || !Array.isArray(data.quizzes)) throw new Error('format');
    if (!confirm(`Restaurer ${plural(data.quizzes.length, 'thème', 'thèmes')} ? Les données actuelles seront remplacées.`)) return;
    db = { quizzes: data.quizzes, deleted: data.deleted || {}, diagrams: data.diagrams || [] };
    for (const [id, b64] of Object.entries(data.images || {})) await Images.set(id, base64ToBlob(b64));
    saveDb();
    toast('Sauvegarde restaurée');
    go('home');
  } catch (e) {
    toast("Ce fichier n'est pas une sauvegarde de l'app.");
  }
});

/* ---------- Démarrage ---------- */
render();

// Synchro à l'ouverture, au retour dans l'app et au retour du réseau
if (sync) syncNow();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.screen !== 'play') scheduleSync(300);
});
window.addEventListener('online', () => scheduleSync(300));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
