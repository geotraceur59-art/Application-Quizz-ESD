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
    if (d && Array.isArray(d.quizzes)) return d;
  } catch (e) { /* données illisibles : on repart de zéro */ }
  return { quizzes: [] };
}
function saveDb() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast("Enregistrement impossible : la mémoire de l'app est pleine.");
  }
}
function getQuiz(id) { return db.quizzes.find(q => q.id === id); }

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
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>',
};

/* =========================================================
   Lecture du fichier .txt
   Format :
     Question ?
     * bonne réponse
     - mauvaise réponse
     - mauvaise réponse
     - mauvaise réponse
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
        questions.push({ id, q, choices: cur.choices.map(c => c.text), answer });
      }
    }
    cur = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line) { if (cur && cur.choices.length) finish(); return; }
    if (line.startsWith('#')) return;

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
  saveDb();
}

/* =========================================================
   Écrans
   ========================================================= */
function go(screen, extra = {}) {
  state = { screen, ...extra };
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = VIEWS[state.screen] || VIEWS.home;
  $app.innerHTML = view();
  if (state.screen === 'import') bindImport();
}

const VIEWS = {
  /* ----- Accueil ----- */
  home() {
    const list = db.quizzes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const head = `
      <div class="topbar">
        <span></span>
        <button class="icon-btn" data-action="backup" aria-label="Sauvegarde">${ICONS.save} Sauvegarde</button>
      </div>
      <header class="home-head">
        <h1>Mes révisions</h1>
        ${list.length ? `<p class="muted">${plural(list.length, 'matière', 'matières')}</p>` : ''}
      </header>`;

    if (!list.length) {
      return head + `
        <div class="empty">
          <h2>Ajoute ton premier quiz</h2>
          <p>Écris tes questions dans un fichier .txt, puis importe-le ici. Chaque question a 4 réponses, la bonne commence par une étoile.</p>
<pre>Quelle est la capitale de l'Italie ?
* Rome
- Milan
- Naples
- Turin</pre>
          <p class="muted small">Laisse une ligne vide entre deux questions.</p>
        </div>
        ${dock(`<button class="btn btn-primary" data-action="new-import">Importer un quiz</button>`)}`;
    }

    return head + `
      <ul class="subject-list">
        ${list.map(q => {
          const rev = toReview(q).length;
          const best = bestScore(q);
          return `<li><button class="subject" data-action="open" data-id="${q.id}">
            <h3>${esc(q.title)}</h3>
            <span class="meta">${plural(q.questions.length, 'question', 'questions')}${rev ? `, <span class="badge-err">${rev} à revoir</span>` : ''}</span>
            <span class="score">${best === null ? '–' : best + ' %'}<small>${best === null ? 'pas encore fait' : 'meilleur'}</small></span>
          </button></li>`;
        }).join('')}
      </ul>
      ${dock(`<button class="btn btn-primary" data-action="new-import">Importer un quiz</button>`)}`;
  },

  /* ----- Import ----- */
  import() {
    const imp = state.imp;
    return `
      <div class="topbar">
        <button class="icon-btn" data-action="${imp.replaceId ? 'open' : 'home'}" data-id="${imp.replaceId || ''}" aria-label="Retour">${ICONS.back}</button>
      </div>
      <h1>${imp.replaceId ? 'Remplacer les questions' : 'Nouveau quiz'}</h1>
      <p class="muted" style="margin:8px 0 22px">Choisis ton fichier .txt ou colle son contenu.</p>

      <button class="btn btn-secondary" data-action="pick-file">Choisir un fichier .txt</button>
      <p class="or">ou</p>

      <div class="field">
        <label for="imp-text">Contenu du quiz</label>
        <textarea id="imp-text" placeholder="Quelle est la capitale de l'Italie ?&#10;* Rome&#10;- Milan&#10;- Naples&#10;- Turin" spellcheck="false" autocapitalize="off">${esc(imp.text)}</textarea>
      </div>
      <div class="field">
        <label for="imp-title">Nom de la matière</label>
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
    const count = state.count || 'all';
    const hist = quiz.history.slice(-8).reverse();
    const missed = quiz.questions
      .filter(q => quiz.stats[q.id] && quiz.stats[q.id].wrong > 0)
      .sort((a, b) => quiz.stats[b.id].wrong - quiz.stats[a.id].wrong)
      .slice(0, 5);
    const sizes = [10, 20].filter(n => n < total);

    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour à l'accueil">${ICONS.back}</button>
      </div>
      <h1>${esc(quiz.title)}</h1>

      <div class="stats">
        <div class="stat"><b>${total}</b><span>questions</span></div>
        <div class="stat"><b>${best === null ? '–' : best + '%'}</b><span>meilleur score</span></div>
        <div class="stat ${rev.length ? 'err' : ''}"><b>${rev.length}</b><span>à revoir</span></div>
      </div>

      ${sizes.length ? `
      <div class="section">
        <h2>Nombre de questions</h2>
        <div class="row" style="grid-template-columns:repeat(${sizes.length + 1},1fr)">
          ${sizes.map(n => `<button class="btn ${count === n ? 'btn-primary' : 'btn-secondary'}" style="min-height:46px;font-size:16px" data-action="count" data-n="${n}">${n}</button>`).join('')}
          <button class="btn ${count === 'all' ? 'btn-primary' : 'btn-secondary'}" style="min-height:46px;font-size:16px" data-action="count" data-n="all">Toutes</button>
        </div>
      </div>` : ''}

      ${missed.length ? `
      <div class="section">
        <h2>Les plus ratées</h2>
        ${missed.map(q => `
          <div class="mistake">
            <span class="count">Ratée ${quiz.stats[q.id].wrong} fois</span>
            <p class="q">${esc(q.q)}</p>
            <p class="a right"><span class="dot"></span><span>${esc(q.choices[q.answer])}</span></p>
          </div>`).join('')}
      </div>` : ''}

      ${hist.length ? `
      <div class="section">
        <h2>Historique</h2>
        <ul class="history">
          ${hist.map(h => `<li><span>${fmtDate(h.date)}${h.mode !== 'all' ? ' <span class="muted">(erreurs)</span>' : ''}</span><span class="s">${h.score}/${h.total}</span></li>`).join('')}
        </ul>
      </div>` : ''}

      <div class="text-actions">
        <button class="link-btn" data-action="replace" data-id="${quiz.id}">Remplacer les questions</button>
        <button class="link-btn" data-action="reset-stats" data-id="${quiz.id}">Effacer mon suivi</button>
        <button class="link-btn danger" data-action="delete" data-id="${quiz.id}">Supprimer la matière</button>
      </div>

      ${dock(`
        <button class="btn btn-primary" data-action="start" data-mode="all">Commencer le quiz</button>
        ${rev.length ? `<button class="btn btn-secondary" data-action="start" data-mode="errors">Revoir mes ${plural(rev.length, 'erreur', 'erreurs')}</button>` : ''}
      `)}`;
  },

  /* ----- Quiz en cours ----- */
  play() {
    const s = state.session;
    const quiz = getQuiz(s.quizId);
    const item = s.items[s.idx];
    const q = quiz.questions.find(x => x.id === item.qid);
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
      <p class="question">${esc(q.q)}</p>
      <div class="choices ${done ? 'answered' : ''}">${choices}</div>
      ${done ? `<p class="verdict ${item.ok ? 'good' : 'bad'}">${item.ok ? 'Bonne réponse' : 'Raté, la bonne réponse est en vert'}</p>` : ''}
      ${done ? dock(`<button class="btn btn-primary" data-action="next">${last ? 'Voir mon score' : 'Question suivante'}</button>`) : ''}`;
  },

  /* ----- Résultats ----- */
  result() {
    const s = state.session;
    const quiz = getQuiz(s.quizId);
    const score = s.items.filter(i => i.ok).length;
    const n = s.items.length;
    const p = pct(score, n);
    const mistakes = s.items.filter(i => !i.ok);
    const msg = p === 100 ? 'Sans faute !' : p >= 80 ? 'Très bien, presque parfait.' : p >= 50 ? 'Bonne base, continue.' : 'Encore un peu de travail sur cette matière.';

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
          const q = quiz.questions.find(x => x.id === i.qid);
          return `<div class="mistake">
            <p class="q">${esc(q.q)}</p>
            <p class="a yours"><span class="dot"></span><span>${esc(q.choices[i.picked])}</span></p>
            <p class="a right"><span class="dot"></span><span>${esc(q.choices[q.answer])}</span></p>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${dock(mistakes.length
        ? `<button class="btn btn-primary" data-action="retry">Refaire ces ${plural(mistakes.length, 'erreur', 'erreurs')}</button>
           <button class="btn btn-secondary" data-action="open" data-id="${quiz.id}">Retour à la matière</button>`
        : `<button class="btn btn-primary" data-action="open" data-id="${quiz.id}">Retour à la matière</button>`)}`;
  },

  /* ----- Sauvegarde ----- */
  backup() {
    return `
      <div class="topbar">
        <button class="icon-btn" data-action="home" aria-label="Retour">${ICONS.back}</button>
      </div>
      <h1>Sauvegarde</h1>
      <p class="muted" style="margin:8px 0 22px">Tes quiz et ton suivi sont enregistrés uniquement sur cet iPhone. Fais une sauvegarde de temps en temps, par exemple dans Fichiers ou iCloud Drive.</p>
      <div class="dock-inner" style="padding:0">
        <button class="btn btn-primary" data-action="export">Créer une sauvegarde</button>
        <button class="btn btn-secondary" data-action="restore">Restaurer une sauvegarde</button>
      </div>
      <p class="muted small" style="margin-top:14px">Restaurer remplace toutes les données actuelles de l'app.</p>`;
  },
};

function dock(inner) {
  return `<div class="dock"><div class="dock-inner">${inner}</div></div>`;
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
  $go.textContent = !title && questions.length ? 'Donne un nom à la matière'
    : questions.length ? `Importer ${plural(questions.length, 'question', 'questions')}` : 'Importer';
}

/* =========================================================
   Actions
   ========================================================= */
function startSession(quizId, qids, mode) {
  const items = qids.map(qid => ({ qid, order: shuffle([0, 1, 2, 3]), picked: null, ok: null }));
  go('play', { session: { quizId, items, idx: 0, mode } });
}

const ACTIONS = {
  home: () => go('home'),
  backup: () => go('backup'),
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

  count: el => {
    const n = el.dataset.n === 'all' ? 'all' : Number(el.dataset.n);
    state.count = n;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },

  start: el => {
    const quiz = getQuiz(state.id);
    const count = state.count || 'all';
    let qids;
    if (el.dataset.mode === 'errors') {
      qids = shuffle(toReview(quiz).map(q => q.id));
    } else {
      qids = shuffle(quiz.questions.map(q => q.id));
      if (count !== 'all') qids = qids.slice(0, count);
    }
    if (!qids.length) return;
    quiz.updatedAt = Date.now();
    startSession(quiz.id, qids, el.dataset.mode);
  },

  pick: el => {
    const s = state.session;
    const item = s.items[s.idx];
    if (item.picked !== null) return;
    const quiz = getQuiz(s.quizId);
    const q = quiz.questions.find(x => x.id === item.qid);
    item.picked = Number(el.dataset.c);
    item.ok = item.picked === q.answer;
    recordAnswer(quiz, q.id, item.ok);
    render();
  },

  next: () => {
    const s = state.session;
    if (s.idx < s.items.length - 1) {
      s.idx++;
      render();
      window.scrollTo(0, 0);
    } else {
      const quiz = getQuiz(s.quizId);
      quiz.history.push({ date: Date.now(), score: s.items.filter(i => i.ok).length, total: s.items.length, mode: s.mode });
      if (quiz.history.length > 100) quiz.history = quiz.history.slice(-100);
      quiz.updatedAt = Date.now();
      saveDb();
      go('result', { session: s });
    }
  },

  quit: () => {
    if (confirm('Arrêter le quiz ? Les réponses déjà données restent enregistrées dans ton suivi.')) {
      go('subject', { id: state.session.quizId });
    }
  },

  retry: () => {
    const s = state.session;
    startSession(s.quizId, shuffle(s.items.filter(i => !i.ok).map(i => i.qid)), 'retry');
  },

  'reset-stats': el => {
    const quiz = getQuiz(el.dataset.id);
    if (confirm(`Effacer le suivi de « ${quiz.title} » ? Les questions sont gardées, les scores et erreurs sont remis à zéro.`)) {
      quiz.stats = {};
      quiz.history = [];
      saveDb();
      toast('Suivi effacé');
      render();
    }
  },

  delete: el => {
    const quiz = getQuiz(el.dataset.id);
    if (confirm(`Supprimer « ${quiz.title} » et tout son suivi ?`)) {
      db.quizzes = db.quizzes.filter(q => q.id !== quiz.id);
      saveDb();
      toast('Matière supprimée');
      go('home');
    }
  },

  export: async () => {
    const name = `revisions-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
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
};

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
    if (!confirm(`Restaurer ${plural(data.quizzes.length, 'matière', 'matières')} ? Les données actuelles seront remplacées.`)) return;
    db = data;
    saveDb();
    toast('Sauvegarde restaurée');
    go('home');
  } catch (e) {
    toast("Ce fichier n'est pas une sauvegarde de l'app.");
  }
});

/* ---------- Démarrage ---------- */
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
