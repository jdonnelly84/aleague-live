/* A-League Live - unofficial A-League Men & Women app.
 * Data: the public A-Leagues match feed (match.api.aleagues.football, open to any origin)
 * and aleagues.com.au news (WordPress REST API). No server needed: the phone reads both directly.
 */
'use strict';

const API = 'https://match.api.aleagues.football';
const NEWS_API = 'https://aleagues.com.au/wp-json/wp/v2/posts';

const COMPS = {
  men:   { id: 'xwnjb1az11zffwty3m6vn8y6', season: '1ztoqmkrzy1d4ejf5jokthiqc', name: 'A-League Men',   tag: 'ALM' },
  women: { id: '9p3nnxhdjahfn8qswpzy8oyc3', season: 'di1eymkpweljbeck80fwsuiok', name: 'A-League Women', tag: 'ALW' },
};

// Display names and club colours, keyed by the feed's team code.
const CLUBS = {
  ADL: { name: 'Adelaide United',      short: 'Adelaide',      c: '#E31837' },
  AKL: { name: 'Auckland FC',          short: 'Auckland FC',   c: '#1726C8' },
  BRI: { name: 'Brisbane Roar',        short: 'Brisbane',      c: '#F26E24' },
  CBR: { name: 'Canberra United',      short: 'Canberra',      c: '#2E9E4B' },
  CCM: { name: 'Central Coast Mariners', short: 'Central Coast', c: '#0F2D56' },
  MAC: { name: 'Macarthur FC',         short: 'Macarthur',     c: '#1A1410' },
  MCY: { name: 'Melbourne City',       short: 'Melb City',     c: '#5FA8DD' },
  MVC: { name: 'Melbourne Victory',    short: 'Melb Victory',  c: '#032E5E' },
  NEW: { name: 'Newcastle Jets',       short: 'Newcastle',     c: '#C21D2F' },
  PER: { name: 'Perth Glory',          short: 'Perth',         c: '#5B2C83' },
  SYD: { name: 'Sydney FC',            short: 'Sydney FC',     c: '#3F8FD6' },
  WEL: { name: 'Wellington Phoenix',   short: 'Wellington',    c: '#1B1A17' },
  WSW: { name: 'Western Sydney Wanderers', short: 'Wanderers', c: '#C8193B' },
};

/* ------------------------------------------------------------------ utils */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v == null || v === '' || isNaN(+v)) ? 0 : +v;
const now = () => Date.now();
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { // storage full: drop cached match events and retry once
      Object.keys(localStorage).filter(x => x.startsWith('ev:')).forEach(x => localStorage.removeItem(x));
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* give up quietly */ }
    }
  },
};

async function fetchJSON(url, timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ISO with milliseconds - the feed redirects anything else.
const iso = ms => new Date(Math.floor(ms / MIN) * MIN).toISOString();

const fmt = {
  day: ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  dayShort: ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  time: ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, (m, a) => a.toLowerCase() + 'm'),
  dateKey: ms => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); },
  ago: ms => {
    const s = (now() - ms) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.round(s / 86400) + 'd ago';
    return fmt.dayShort(ms);
  },
};
function relDay(ms) {
  const k = fmt.dateKey(ms);
  if (k === fmt.dateKey(now())) return 'Today';
  if (k === fmt.dateKey(now() + DAY)) return 'Tomorrow';
  if (k === fmt.dateKey(now() - DAY)) return 'Yesterday';
  return fmt.dayShort(ms);
}
function decodeHTML(s) { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; }
function stripTags(s) { return decodeHTML(String(s || '').replace(/<[^>]*>/g, '')).trim(); }

/* ------------------------------------------------------------------ state */
const S = {
  comp: store.get('comp') || 'men',
  data: {},          // per comp: { ladder, ladderMeta, matches, fetched:{} }
  live: {},          // matchId -> overlay from match detail
  news: store.get('news') || null,
  view: { tab: 'home' },
  ui: { round: null, ladderMode: 'table', statMode: 'goals', mcTab: 'timeline' },
};
const D = () => (S.data[S.comp] ||= loadCached(S.comp));
const C = () => COMPS[S.comp];

function loadCached(comp) {
  const c = store.get('d:' + comp) || {};
  return { ladder: c.ladder || null, ladderMeta: c.ladderMeta || null, matches: c.matches || null, fetched: c.fetched || {} };
}
function saveData(comp) {
  const d = S.data[comp];
  store.set('d:' + comp, { ladder: d.ladder, ladderMeta: d.ladderMeta, matches: d.matches, fetched: d.fetched });
}

const favKey = () => 'fav:' + S.comp;
const fav = () => store.get(favKey());
const setFav = code => { store.set(favKey(), code); };

/* ------------------------------------------------------------------ data */
function team(x) {
  x = x || {};
  return { id: x.id, code: x.code || '', name: x.name || x.officialName || 'TBC', short: x.shortName || x.name || 'TBC' };
}

function normMatch(m) {
  const md = (m.liveData && m.liveData.matchDetails) || {};
  const sc = md.scores || {};
  return {
    id: m.id,
    ko: num(m.startDate),
    st: m.matchStatus || 'Fixture',
    h: team(m.homeTeam), a: team(m.awayTeam),
    hs: num(m.homeScore) + num(m.homeScoreUnconfirmed),
    as: num(m.awayScore) + num(m.awayScoreUnconfirmed),
    ht: sc.ht ? [num(sc.ht.home), num(sc.ht.away)] : null,
    pen: sc.pen ? [num(sc.pen.home), num(sc.pen.away)] : null,
    min: md.matchTime || null,
    wk: m.week || '',
    stage: (m.stage && m.stage.name) || 'Regular Season',
    venue: m.venue ? (m.venue.shortName || m.venue.longName || '') : '',
    city: m.venue ? m.venue.city || '' : '',
    tix: m.ticketUrl || null,
  };
}

async function refreshLadder(comp, force) {
  const d = S.data[comp] ||= loadCached(comp);
  const fresh = d.fetched.ladder && now() - d.fetched.ladder < 5 * MIN;
  if (fresh && !force) return false;
  const anyLive = (d.matches || []).some(m => isLive(withLive(m)));
  const j = await fetchJSON(`${API}/v1/competitions/${COMPS[comp].id}/ladder${anyLive ? '/live' : ''}`);
  if (!Array.isArray(j.data)) throw new Error('Bad ladder data');
  d.ladder = j.data.map(r => ({
    pos: r.position, prev: r.previousPosition, t: team(r.team), p: r.played, w: r.won, dr: r.drawn, l: r.lost,
    gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, pts: r.points, form: r.form || [], rs: r.rankStatus || null,
    inPlay: !!r.inPlay,
  }));
  d.ladderMeta = j.meta || null;
  if (j.meta && j.meta.seasonId) COMPS[comp].season = j.meta.seasonId;
  d.fetched.ladder = now();
  saveData(comp);
  return true;
}

async function refreshMatches(comp, force) {
  const d = S.data[comp] ||= loadCached(comp);
  const fresh = d.fetched.matches && now() - d.fetched.matches < 3 * MIN;
  if (fresh && !force) return false;
  const c = COMPS[comp];
  const j = await fetchJSON(`${API}/middleware/v2/fixturesAndResultsV2?competitionId=${c.id}&tournamentId=${c.season}&includeTicketAndStreamInfo=true`, 25000);
  if (!Array.isArray(j)) throw new Error('Bad fixtures data');
  d.matches = j.map(normMatch).sort((a, b) => a.ko - b.ko);
  d.fetched.matches = now();
  saveData(comp);
  return true;
}

async function refreshNews(force) {
  if (S.news && !force && now() - S.news.t < 10 * MIN) return false;
  const j = await fetchJSON(`${NEWS_API}?per_page=20&_fields=id,date_gmt,link,title,excerpt,jetpack_featured_media_url`);
  S.news = {
    t: now(),
    items: j.map(p => ({
      id: p.id, link: p.link, title: decodeHTML(p.title && p.title.rendered),
      ex: stripTags(p.excerpt && p.excerpt.rendered), img: p.jetpack_featured_media_url || '',
      at: Date.parse((p.date_gmt || '') + 'Z') || now(),
    })),
  };
  store.set('news', S.news);
  return true;
}

/* match detail (events, officials, periods) */
const detailMem = {};
async function getDetail(id, force) {
  const cached = detailMem[id] || store.get('md:' + id);
  if (cached && !force && (cached.done || now() - cached.t < 20e3)) return cached;
  const j = await fetchJSON(`${API}/v1/matches/${id}`);
  const m = j.data;
  const det = {
    t: now(),
    done: m.status === 'played' || m.period === 'full_time' || m.status === 'awarded',
    status: m.status, period: m.period, periods: m.periods || [],
    hs: num(m.score && m.score.current && m.score.current.home) + num(m.score && m.score.currentUnconfirmed && m.score.currentUnconfirmed.home),
    as: num(m.score && m.score.current && m.score.current.away) + num(m.score && m.score.currentUnconfirmed && m.score.currentUnconfirmed.away),
    ht: m.score && m.score.halfTime && m.score.halfTime.home != null ? [m.score.halfTime.home, m.score.halfTime.away] : null,
    pen: m.score && m.score.penalties && m.score.penalties.home != null ? [m.score.penalties.home, m.score.penalties.away] : null,
    homeId: m.home && m.home.id, awayId: m.away && m.away.id,
    att: m.attendance || null,
    venue: m.venue ? { name: m.venue.name, city: m.venue.city, cap: m.venue.capacity } : null,
    refs: (m.officials || []).map(o => ({ n: o.name, r: o.role })),
    ev: (m.events || []).map(e => ({
      t: e.type, m: e.minute, per: e.period, p: e.playerName, pid: e.playerId, r: e.relatedPlayerName,
      a: e.assistPlayerName, aid: e.assistPlayerId, tm: e.teamId, s: e.scoreAfter, v: e.varReviewed, why: e.reason, u: e.unconfirmed,
    })),
  };
  detailMem[id] = det;
  if (det.done) store.set('md:' + id, det);
  return det;
}

/* live overlay: merge a live match detail onto the fixture-list match */
const LIVE_PERIODS = /half|extra|penalt|break/;
function withLive(m) {
  const L = S.live[m.id];
  if (!L) return m;
  const o = Object.assign({}, m, { hs: L.hs, as: L.as, per: L.period, periods: L.periods, ht: L.ht || m.ht, pen: L.pen || m.pen });
  if (L.done) o.st = 'Played';
  else if (/postpon|cancel|abandon/.test(L.status || '')) o.st = 'Postponed';
  else if (L.period && LIVE_PERIODS.test(L.period) && L.period !== 'full_time') o.st = 'Playing';
  return o;
}
const isDone = m => m.st === 'Played' || m.st === 'Awarded';
const isOff = m => /postpon|cancel|abandon|suspend/i.test(m.st);
const isLive = m => m.st === 'Playing' || m.st === 'Live';
// Kick-off has passed but the fixture list hasn't caught up yet.
const maybeLive = m => !isDone(m) && !isOff(m) && now() >= m.ko - 2 * MIN && now() < m.ko + 3 * HOUR;

function liveClock(m) {
  const p = m.per || '';
  if (p === 'half_time') return 'HT';
  if (/penalt/.test(p)) return 'Pens';
  if (/break|half_time/.test(p)) return 'Break';
  const cur = (m.periods || []).slice().reverse().find(x => x.startUtc && !x.endUtc);
  if (cur) {
    const P = cur.period || '';
    const [base, cap] = /extra.*(first|1)|(first|1).*extra/.test(P) ? [90, 105]
      : /extra.*(second|2)|(second|2).*extra/.test(P) ? [105, 120]
      : /second/.test(P) ? [45, 90] : [0, 45];
    const mm = base + Math.floor((now() - Date.parse(cur.startUtc)) / MIN) + 1;
    return mm > cap ? `${cap}+${mm - cap}'` : `${Math.max(mm, base + 1)}'`;
  }
  if (m.min) return m.min + "'";
  return 'Live';
}

async function pollLive() {
  const d = D();
  if (!d.matches) return false;
  const cands = d.matches.filter(m => isLive(m) || maybeLive(m) || (S.live[m.id] && !S.live[m.id].done));
  if (!cands.length) return false;
  let changed = false;
  for (const m of cands) {
    try {
      const det = await getDetail(m.id, true);
      const prev = S.live[m.id];
      S.live[m.id] = det;
      if (!prev || prev.hs !== det.hs || prev.as !== det.as || prev.period !== det.period || prev.ev.length !== det.ev.length) changed = true;
      if (prev && (det.hs > prev.hs || det.as > prev.as)) toast(`GOAL! ${clubShort(m.h)} ${det.hs}-${det.as} ${clubShort(m.a)}`);
      if (det.done && !prev?.done) { d.fetched.matches = 0; d.fetched.ladder = 0; }
    } catch { /* keep last known */ }
  }
  return changed;
}

/* ------------------------------------------------------------------ helpers for views */
const clubOf = t => CLUBS[t.code] || null;
const clubShort = t => (clubOf(t) || {}).short || t.short || t.name;
const clubName = t => (clubOf(t) || {}).name || t.name;
const clubColor = t => (clubOf(t) || {}).c || '#151A95';

function crest(t, cls = '') {
  if (t && CLUBS[t.code]) return `<img class="crest ${cls}" src="crests/${t.code}.svg" alt="" loading="lazy">`;
  return `<span class="crest crest-fb ${cls}">${esc((t && t.code) || '?')}</span>`;
}
function roundLabel(m) {
  if (m.stage === 'Regular Season') return 'Round ' + m.wk;
  return m.stage + (m.wk && !isNaN(+m.wk) ? '' : '');
}
const roundKey = m => m.stage + '|' + m.wk;

function rounds(matches) {
  const map = new Map();
  for (const m of matches) {
    const k = roundKey(m);
    if (!map.has(k)) map.set(k, { key: k, label: m.stage === 'Regular Season' ? 'Rd ' + m.wk : m.stage, full: roundLabel(m), ms: [] });
    map.get(k).ms.push(m);
  }
  const rs = [...map.values()];
  rs.forEach(r => { r.start = Math.min(...r.ms.map(m => m.ko)); r.end = Math.max(...r.ms.map(m => m.ko)); });
  rs.sort((a, b) => a.start - b.start);
  return rs;
}
function currentRound(rs) {
  // The first round with an unfinished match; if everything is done, the last one.
  return rs.find(r => r.ms.some(m => { const x = withLive(m); return !isDone(x) && !isOff(x); })) || rs[rs.length - 1];
}

function scoreOrTime(m, big) {
  const x = withLive(m);
  if (isLive(x)) {
    return `<div class="score">${x.hs}<span class="muted">-</span>${x.as}</div><div class="st live"><span class="live-dot"></span>${esc(liveClock(x))}</div>`;
  }
  if (isDone(x)) {
    return `<div class="score">${x.hs}<span class="muted">-</span>${x.as}</div><div class="st">${x.pen ? `Pens ${x.pen[0]}-${x.pen[1]}` : 'Full time'}</div>`;
  }
  if (isOff(x)) return `<span class="pill pp">${esc(x.st)}</span>`;
  if (maybeLive(x)) return `<div class="ko">${esc(fmt.time(x.ko))}</div><div class="st">Kick-off</div>`;
  return `<div class="ko">${esc(fmt.time(x.ko))}</div>${big ? '' : ''}`;
}

function matchRow(m, opts = {}) {
  const x = withLive(m);
  const f = fav();
  const done = isDone(x);
  const hl = done && x.hs < x.as, al = done && x.as < x.hs;
  return `<a class="mrow" href="#/match/${x.id}">
    <div class="team ${hl ? 'lose' : ''} ${f === x.h.code ? 'fav' : ''}">${crest(x.h)}<span class="nm">${esc(clubShort(x.h))}</span></div>
    <div class="mid">${scoreOrTime(x)}</div>
    <div class="team away ${al ? 'lose' : ''} ${f === x.a.code ? 'fav' : ''}">${crest(x.a)}<span class="nm">${esc(clubShort(x.a))}</span></div>
    ${opts.venue !== false && x.venue ? `<div class="venue">${opts.showDate ? esc(fmt.dayShort(x.ko)) + ' · ' : ''}${esc(x.venue)}</div>` : ''}
  </a>`;
}

function matchesByDay(ms, opts) {
  let out = '', key = null, open = false;
  for (const m of ms) {
    const k = fmt.dateKey(m.ko);
    if (k !== key) {
      if (open) out += '</div>';
      out += `<div class="day">${esc(relDay(m.ko) === fmt.dayShort(m.ko) ? fmt.day(m.ko) : relDay(m.ko) + ' · ' + fmt.day(m.ko))}</div><div class="card">`;
      key = k; open = true;
    }
    out += matchRow(m, opts);
  }
  if (open) out += '</div>';
  return out;
}

function miniCard(m) {
  const x = withLive(m);
  const live = isLive(x);
  const done = isDone(x);
  const when = live ? `<span class="live-tag"><span class="live-dot"></span>${esc(liveClock(x))}</span>`
    : done ? 'FT' : isOff(x) ? esc(x.st) : `${esc(relDay(x.ko))} ${esc(fmt.time(x.ko))}`;
  const sh = (done || live) ? x.hs : '', sa = (done || live) ? x.as : '';
  return `<a class="mini ${live ? 'live' : ''}" href="#/match/${x.id}">
    <div class="when"><span>${when}</span><span class="tag">${C().tag}</span></div>
    <div class="row ${done && x.hs < x.as ? 'lose' : ''}">${crest(x.h)}<span class="code">${esc(x.h.code)}</span><span class="sc">${sh}</span></div>
    <div class="row ${done && x.as < x.hs ? 'lose' : ''}">${crest(x.a)}<span class="code">${esc(x.a.code)}</span><span class="sc">${sa}</span></div>
  </a>`;
}

function formDots(form) {
  return `<span class="form">${(form || []).slice(-5).map(r => `<span class="fd ${esc(r)}">${esc(r)}</span>`).join('')}</span>`;
}

const loading = (h = 120) => `<div class="skel" style="height:${h}px;margin:12px"></div>`;
const errBox = msg => `<div class="err">${esc(msg)}</div>`;

/* ------------------------------------------------------------------ views */
function viewHome() {
  const d = D();
  if (!d.matches || !d.ladder) return loading(180) + loading(90) + loading(240);
  const rs = rounds(d.matches);
  const cur = currentRound(rs);
  const live = d.matches.filter(m => { const x = withLive(m); return isLive(x); });
  const upcoming = d.matches.filter(m => !isDone(withLive(m)) && !isOff(m) && m.ko > now());
  const next = upcoming[0];
  const f = fav();
  let h = '';

  // hero: live now, or countdown to the next match
  if (live.length) {
    h += `<section class="hero"><div class="kicker"><span class="live-dot"></span>Live now</div>
      <div class="title">${live.length === 1 ? esc(clubShort(live[0].h)) + ' v ' + esc(clubShort(live[0].a)) : live.length + ' matches in play'}</div>
      <div class="meta">${esc(C().name)} · ${esc(roundLabel(live[0]))}</div></section>`;
  } else if (next) {
    h += `<section class="hero"><div class="kicker">${esc(C().name)} · ${esc(roundLabel(next))}</div>
      <div class="title">${esc(clubShort(next.h))} v ${esc(clubShort(next.a))}</div>
      <div class="count" data-countdown="${next.ko}">${countdownHTML(next.ko)}</div>
      <div class="meta">${esc(fmt.day(next.ko))} · ${esc(fmt.time(next.ko))}${next.venue ? ' · ' + esc(next.venue) : ''}</div></section>`;
  } else {
    h += `<section class="hero"><div class="kicker">${esc(C().name)}</div><div class="title">Season complete</div></section>`;
  }

  // strip: this round's matches (dark cards, like the site's match strip)
  const stripMs = cur ? cur.ms : [];
  h += `<div class="wrap" style="padding-bottom:0"><div class="sec-title"><h2>${esc(cur ? cur.full : 'Matches')}</h2><a href="#/matches">All matches</a></div>
    <div class="strip">${stripMs.map(miniCard).join('')}</div></div>`;

  h += '<div class="wrap" style="padding-top:0">';
  // favourite club
  if (f && CLUBS[f]) {
    const mine = d.matches.filter(m => m.h.code === f || m.a.code === f);
    const nextMine = mine.find(m => !isDone(withLive(m)) && !isOff(m));
    const lastMine = mine.filter(m => isDone(withLive(m))).pop();
    const row = d.ladder.find(r => r.t.code === f);
    h += `<div class="sec-title"><h2>${esc(CLUBS[f].short)}</h2><a href="#/club/${f}">Club page</a></div><div class="card">
      ${row ? `<div class="lead" style="border:0"><span class="rk">${row.pos}</span>${crest(row.t)}<div class="nm"><b>${esc(CLUBS[f].name)}</b><span>${row.pts} pts · ${row.p} played · GD ${row.gd > 0 ? '+' : ''}${row.gd}</span></div>${formDots(row.form)}</div>` : ''}
      ${lastMine ? matchRow(lastMine, { showDate: true }) : ''}${nextMine ? matchRow(nextMine, { showDate: true }) : ''}</div>`;
  } else {
    h += `<div class="sec-title"><h2>Pick your club</h2></div><div class="clubs">${d.ladder.map(r =>
      `<button data-fav="${esc(r.t.code)}">${crest(r.t)}<span>${esc(clubShort(r.t))}</span></button>`).join('')}</div>`;
  }

  // ladder top 6
  h += `<div class="sec-title"><h2>Ladder</h2><a href="#/ladder">Full ladder</a></div><div class="card">${ladderTable(d.ladder.slice(0, 6), true)}</div>`;

  // last results
  const played = d.matches.filter(m => isDone(withLive(m)));
  const recent = played.slice(-4).reverse();
  if (recent.length) h += `<div class="sec-title"><h2>Latest results</h2><a href="#/matches">More</a></div><div class="card">${recent.map(m => matchRow(m, { showDate: true })).join('')}</div>`;

  // news
  if (S.news && S.news.items.length) {
    h += `<div class="sec-title"><h2>News</h2><a href="#/news">All news</a></div><div class="card">${S.news.items.slice(0, 3).map(newsItem).join('')}</div>`;
  }
  h += '</div>' + foot();
  return h;
}

function countdownHTML(ko) {
  let s = Math.max(0, Math.floor((ko - now()) / 1000));
  const dd = Math.floor(s / 86400); s %= 86400;
  const hh = Math.floor(s / 3600); s %= 3600;
  const mm = Math.floor(s / 60); const ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return `<div><b>${dd}</b><span>Days</span></div><div><b>${p(hh)}</b><span>Hrs</span></div><div><b>${p(mm)}</b><span>Mins</span></div><div><b>${p(ss)}</b><span>Secs</span></div>`;
}

function viewMatches() {
  const d = D();
  if (!d.matches) return banner('Matches', C().name) + loading(60) + loading(300);
  const rs = rounds(d.matches);
  if (!rs.length) return banner('Matches', C().name) + '<div class="empty">No fixtures yet.</div>';
  const cur = currentRound(rs);
  let sel = rs.find(r => r.key === S.ui.round) || cur;
  if (S.ui.round === 'club') sel = null;
  let h = banner('Matches', `${C().name} · ${seasonName()}`);
  h += `<div class="chips" id="chips">${rs.map(r => `<button class="chip ${sel && r.key === sel.key ? 'on' : ''} ${r === cur ? 'cur' : ''}" data-round="${esc(r.key)}">${esc(r.label)}</button>`).join('')}</div>`;
  h += `<div class="wrap" style="padding-top:2px">${matchesByDay(sel.ms)}</div>` + foot();
  return h;
}

function seasonName() {
  const d = D();
  const y = d.matches && d.matches[0] ? new Date(d.matches[0].ko).getFullYear() : new Date().getFullYear();
  return `${y}/${String(y + 1).slice(2)} season`;
}

function ladderTable(rows, compact) {
  const f = fav();
  const cutAfter = rows.findIndex(r => !r.rs);
  return `<table class="ladder"><thead><tr><th>#</th><th class="l">Club</th><th>P</th>${compact ? '' : '<th>W</th><th>D</th><th>L</th>'}<th>GD</th><th>Pts</th></tr></thead><tbody>
    ${rows.map((r, i) => {
      const q = r.rs === 'Final Series' ? 'q1' : r.rs ? 'q2' : '';
      const mv = r.prev && r.prev !== r.pos ? (r.prev > r.pos ? '<span class="mv up">▲</span>' : '<span class="mv dn">▼</span>') : '';
      return `<tr class="${q} ${i === cutAfter && i > 0 ? 'cut' : ''} ${f === r.t.code ? 'fav' : ''} ${r.inPlay ? 'inplay' : ''}">
        <td class="pos">${r.pos}${mv}</td>
        <td class="club"><a href="#/club/${esc(r.t.code)}">${crest(r.t, 'sm')}<span>${esc(clubShort(r.t))}</span>${r.inPlay ? ' <span class="live-dot" style="margin-left:2px"></span>' : ''}</a></td>
        <td>${r.p}</td>${compact ? '' : `<td>${r.w}</td><td>${r.dr}</td><td>${r.l}</td>`}
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function ladderForm(rows) {
  const f = fav();
  return `<table class="ladder"><thead><tr><th>#</th><th class="l">Club</th><th>GF</th><th>GA</th><th>Last 5</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${f === r.t.code ? 'fav' : ''}"><td class="pos">${r.pos}</td>
      <td class="club"><a href="#/club/${esc(r.t.code)}">${crest(r.t, 'sm')}<span>${esc(r.t.code)}</span></a></td>
      <td>${r.gf}</td><td>${r.ga}</td><td style="text-align:right;padding-right:8px">${formDots(r.form)}</td></tr>`).join('')}</tbody></table>`;
}

function viewLadder() {
  const d = D();
  let h = banner('Ladder', `${C().name} · ${seasonName()}`);
  if (!d.ladder) return h + loading(500);
  const m = S.ui.ladderMode;
  h += `<div class="seg"><button data-lmode="table" class="${m === 'table' ? 'on' : ''}">Table</button><button data-lmode="form" class="${m === 'form' ? 'on' : ''}">Form</button></div>`;
  h += `<div class="wrap"><div class="card">${m === 'form' ? ladderForm(d.ladder) : ladderTable(d.ladder)}</div>
    <div class="key"><span><i style="background:var(--yellow)"></i>Finals Series</span><span><i style="background:var(--blue2)"></i>Finals Play-offs</span>${d.ladderMeta && d.ladderMeta.live ? '<span><span class="live-dot"></span>Live ladder</span>' : ''}</div></div>` + foot();
  return h;
}

/* ---- stats from match events (fetched once per finished match, then cached) */
const statState = {};  // comp -> { running, done, total }
async function ensureStats(comp) {
  const d = S.data[comp];
  if (!d || !d.matches) return;
  const st = statState[comp] ||= { running: false, done: 0, total: 0 };
  if (st.running) return;
  const played = d.matches.filter(isDone);
  const missing = played.filter(m => !detailMem[m.id] && !store.get('md:' + m.id));
  st.total = played.length; st.done = played.length - missing.length;
  if (!missing.length) return;
  st.running = true;
  const queue = missing.slice();
  const worker = async () => {
    while (queue.length) {
      const m = queue.shift();
      try { await getDetail(m.id); } catch { /* skip this one */ }
      st.done++;
      if (S.view.tab === 'stats' && S.comp === comp) throttledRender();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  st.running = false;
  if (S.comp === comp) render();
}

function computeStats(comp) {
  const d = S.data[comp];
  const teamById = {};
  (d.matches || []).forEach(m => { teamById[m.h.id] = m.h; teamById[m.a.id] = m.a; });
  const P = {};
  const get = (id, name, tm) => P[id] ||= { id, name, t: teamById[tm] || { code: '' }, g: 0, pg: 0, a: 0, y: 0, r: 0 };
  for (const m of (d.matches || []).filter(isDone)) {
    const det = detailMem[m.id] || store.get('md:' + m.id);
    if (!det) continue;
    detailMem[m.id] = det;
    for (const e of det.ev) {
      if (!e.pid) continue;
      if (e.t === 'goal' || e.t === 'penalty_goal') {
        const p = get(e.pid, e.p, e.tm); p.g++; if (e.t === 'penalty_goal') p.pg++;
        if (e.aid) get(e.aid, e.a, e.tm).a++;
      } else if (e.t === 'yellow_card') get(e.pid, e.p, e.tm).y++;
      else if (/red|second_yellow/.test(e.t)) get(e.pid, e.p, e.tm).r++;
    }
  }
  return Object.values(P);
}

function viewStats() {
  const d = D();
  let h = banner('Stats', `${C().name} · ${seasonName()}`);
  if (!d.matches) return h + loading(400);
  const st = statState[S.comp];
  const mode = S.ui.statMode;
  h += `<div class="seg"><button data-smode="goals" class="${mode === 'goals' ? 'on' : ''}">Goals</button><button data-smode="assists" class="${mode === 'assists' ? 'on' : ''}">Assists</button><button data-smode="cards" class="${mode === 'cards' ? 'on' : ''}">Cards</button></div><div class="wrap">`;
  if (st && st.running) {
    h += `<div class="card" style="padding:10px 14px"><div class="muted" style="font-size:12px">Reading match reports… ${st.done} of ${st.total}</div><div class="bar"><i style="width:${st.total ? Math.round(st.done / st.total * 100) : 0}%"></i></div></div>`;
  }
  const all = computeStats(S.comp);
  let rows, val, sub;
  if (mode === 'assists') { rows = all.filter(p => p.a).sort((a, b) => b.a - a.a || b.g - a.g); val = p => p.a; sub = p => `${p.g} goal${p.g === 1 ? '' : 's'}`; }
  else if (mode === 'cards') {
    rows = all.filter(p => p.y || p.r).sort((a, b) => (b.r * 3 + b.y) - (a.r * 3 + a.y));
    val = p => `${p.y ? `<span class="card-y" style="vertical-align:-2px"></span> ${p.y}` : ''}${p.r ? ` <span class="card-r" style="vertical-align:-2px;margin-left:6px"></span> ${p.r}` : ''}`;
    sub = () => '';
  } else { rows = all.filter(p => p.g).sort((a, b) => b.g - a.g || b.a - a.a); val = p => p.g; sub = p => `${p.pg ? p.pg + ' pen · ' : ''}${p.a} assist${p.a === 1 ? '' : 's'}`; }
  rows = rows.slice(0, 30);
  if (!rows.length) h += `<div class="card empty">${st && st.running ? 'Loading…' : 'No data yet.'}</div>`;
  else {
    let rank = 0, last = null;
    h += `<div class="card" style="margin-top:12px">${rows.map((p, i) => {
      const v = String(val(p)); if (v !== last) { rank = i + 1; last = v; }
      return `<a class="lead ${rank === 1 ? 'first' : ''}" href="#/club/${esc(p.t.code)}"><span class="rk">${rank}</span>${crest(p.t, 'sm')}<div class="nm"><b>${esc(p.name)}</b><span>${esc(clubShort(p.t))}${sub(p) ? ' · ' + esc(sub(p)) : ''}</span></div><span class="val">${v}</span></a>`;
    }).join('')}</div>`;
  }
  h += '</div>' + foot();
  return h;
}

function newsItem(n) {
  return `<a class="nitem" href="${esc(n.link)}" target="_blank" rel="noopener"><div class="img" style="background-image:url('${esc(thumb(n.img, 240))}')"></div><div><h4>${esc(n.title)}</h4><div class="when">${esc(fmt.ago(n.at))}</div></div></a>`;
}
const thumb = (u, w) => u ? u.replace(/\?.*$/, '') + `?w=${w}&quality=70` : '';

function viewNews() {
  let h = banner('News', 'Latest from aleagues.com.au');
  if (!S.news) return h + loading(260) + loading(400);
  const [lead, ...rest] = S.news.items;
  if (!lead) return h + '<div class="empty">No news.</div>';
  h += `<div class="wrap"><a class="card news-lead" href="${esc(lead.link)}" target="_blank" rel="noopener"><div class="img" style="background-image:url('${esc(thumb(lead.img, 720))}')"></div>
    <div class="txt"><h3>${esc(lead.title)}</h3><p>${esc(lead.ex)}</p><div class="when">${esc(fmt.ago(lead.at))}</div></div></a>
    <div class="card" style="margin-top:12px">${rest.map(newsItem).join('')}</div></div>` + foot();
  return h;
}

/* ---- match centre */
function evIcon(t) {
  if (t === 'goal' || t === 'penalty_goal' || t === 'own_goal') return `<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fff" stroke="#18191A" stroke-width="1.6"/><path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="#18191A"/><path d="M12 2v5.2M15.3 9.6l4.9-1.6M14 13.5l3 4.3M10 13.5l-3 4.3M8.7 9.6 3.8 8" stroke="#18191A" stroke-width="1.3"/></svg>`;
  if (t === 'yellow_card') return '<span class="card-y"></span>';
  if (/second_yellow|yellow_red/.test(t)) return '<span class="card-yr"></span>';
  if (/red/.test(t)) return '<span class="card-r"></span>';
  if (t === 'substitution') return `<svg class="ico" viewBox="0 0 24 24"><path d="M7 4v11H4l4.5 5L13 15h-3V4z" fill="#dc2626"/><path d="M17 20V9h3l-4.5-5L11 9h3v11z" fill="#16a34a"/></svg>`;
  if (/miss/.test(t)) return `<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#eee"/><path d="M7 7l10 10M17 7 7 17" stroke="#dc2626" stroke-width="2.4"/></svg>`;
  if (/var/i.test(t)) return '<span class="pill">VAR</span>';
  return '';
}
function evMinute(e) {
  const m = num(e.m), p = e.per || '';
  const cap = /extra.*second|second.*extra/.test(p) ? 120 : /extra/.test(p) ? 105 : /second/.test(p) ? 90 : /first/.test(p) ? 45 : 0;
  return cap && m > cap ? `${cap}+${m - cap}'` : `${m}'`;
}

// Order of match periods, so a half-time marker (whose "minute" is the half's length) sorts correctly.
function periodRank(p) {
  p = p || '';
  if (p === 'pre_match') return 0;
  if (p === 'first_half') return 1;
  if (p === 'half_time') return 2;
  if (p === 'second_half') return 3;
  if (/penalt/.test(p)) return 8;
  if (p === 'full_time') return 9;
  if (/extra/.test(p)) return /second|2/.test(p) ? 6 : /break|half_time/.test(p) ? 5 : 4;
  return 3;
}

function timeline(m, det) {
  let prev = { home: 0, away: 0 };
  const rows = [];
  const evs = det.ev.slice().sort((a, b) => periodRank(a.per) - periodRank(b.per) || num(a.m) - num(b.m));
  for (const e of evs) {
    if (e.t === 'half_time') { rows.push(`<div class="divider"><span>Half time${det.ht ? ` ${det.ht[0]}-${det.ht[1]}` : ''}</span></div>`); continue; }
    if (e.t === 'full_time') { rows.push(`<div class="divider"><span>Full time ${det.hs}-${det.as}</span></div>`); continue; }
    if (/kickoff|start|end/.test(e.t) && !/goal/.test(e.t)) continue;
    const icon = evIcon(e.t);
    if (!icon) continue;
    let home = e.tm === det.homeId;
    let extra = '', who = esc(e.p || '');
    const isGoal = /goal/.test(e.t);
    if (isGoal && e.s) {
      home = num(e.s.home) > prev.home ? true : num(e.s.away) > prev.away ? false : home;
      extra = `<span class="scoreafter">${e.s.home}-${e.s.away}</span>`;
      prev = { home: num(e.s.home), away: num(e.s.away) };
    }
    let sub = '';
    if (e.t === 'substitution') { sub = e.r ? `Off: ${esc(e.r)}` : ''; who = `${esc(e.p || '')}`; }
    else if (e.t === 'penalty_goal') sub = 'Penalty';
    else if (e.t === 'own_goal') sub = 'Own goal';
    else if (isGoal && e.a) sub = `Assist: ${esc(e.a)}`;
    else if (/card/.test(e.t) && e.why) sub = esc(e.why);
    if (e.v) sub += (sub ? ' · ' : '') + 'VAR checked';
    const body = `<div class="who"><b>${who}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const side = home
      ? `<div class="side hm">${extra}${body}${icon}</div><span class="min">${evMinute(e)}</span><div></div>`
      : `<div></div><span class="min">${evMinute(e)}</span><div class="side">${icon}${body}${extra}</div>`;
    rows.push(`<div class="ev ${isGoal ? 'goal' : ''}">${side}</div>`);
  }
  if (!rows.length) return '<div class="empty">No events yet.</div>';
  return `<div class="tl">${rows.reverse().join('')}</div>`;
}

function scorersLine(det, homeSide) {
  const goals = det.ev.filter(e => /goal/.test(e.t) && e.s);
  let prev = { home: 0, away: 0 };
  const list = [];
  for (const e of goals.sort((a, b) => num(a.m) - num(b.m))) {
    const isHome = num(e.s.home) > prev.home;
    prev = { home: num(e.s.home), away: num(e.s.away) };
    if (isHome === homeSide) list.push(`${esc(e.p || '')} ${evMinute(e)}${e.t === 'penalty_goal' ? ' (pen)' : e.t === 'own_goal' ? ' (og)' : ''}`);
  }
  return list.join('<br>');
}

function viewMatch(id) {
  const d = D();
  let m = d.matches && d.matches.find(x => x.id === id);
  if (!m) {
    // maybe it belongs to the other competition
    const other = S.comp === 'men' ? 'women' : 'men';
    const od = S.data[other] || loadCached(other);
    if (od.matches && od.matches.find(x => x.id === id)) { switchComp(other, false); m = od.matches.find(x => x.id === id); }
  }
  if (!m) return d.matches ? errBox('Match not found.') : loading(200);
  const x = withLive(m);
  const det = detailMem[id] || store.get('md:' + id);
  if (!det && (isDone(x) || isLive(x) || maybeLive(x))) loadDetailThenRender(id);
  const live = isLive(x);
  const done = isDone(x);
  let mid;
  if (done || live) {
    const hs = det && det.done ? det.hs : x.hs, as = det && det.done ? det.as : x.as;
    mid = `<div class="mc-score">${hs} - ${as}<small>${live ? `<span class="live-tag"><span class="live-dot"></span>${esc(liveClock(x))}</span>` : 'Full time'}${x.ht ? ` · HT ${x.ht[0]}-${x.ht[1]}` : ''}${x.pen ? ` · Pens ${x.pen[0]}-${x.pen[1]}` : ''}</small></div>`;
  } else if (isOff(x)) {
    mid = `<div class="mc-ko" style="font-size:20px">${esc(x.st)}</div>`;
  } else {
    mid = `<div class="mc-ko">${esc(fmt.time(x.ko))}<small style="display:block;font-size:12px;color:#cfd0d8;margin-top:6px">${esc(relDay(x.ko))}</small></div>`;
  }
  let h = `<section class="mc-head">
    <div class="mc-top"><a class="back" href="javascript:history.back()">‹ Back</a><span>${esc(roundLabel(x))} · ${esc(fmt.dayShort(x.ko))}</span></div>
    <div class="mc-teams">
      <a class="mc-team" href="#/club/${esc(x.h.code)}">${crest(x.h, 'lg')}<span>${esc(clubShort(x.h))}</span></a>
      ${mid}
      <a class="mc-team" href="#/club/${esc(x.a.code)}">${crest(x.a, 'lg')}<span>${esc(clubShort(x.a))}</span></a>
    </div>
    ${det && det.ev.some(e => /goal/.test(e.t)) ? `<div class="mc-scorers"><div>${scorersLine(det, true)}</div><div>${scorersLine(det, false)}</div></div>` : ''}
  </section>`;

  if (!done && !live) {
    // upcoming: countdown, form, tickets
    const L = d.ladder || [];
    const rh = L.find(r => r.t.code === x.h.code), ra = L.find(r => r.t.code === x.a.code);
    h += `<div class="wrap">`;
    if (!isOff(x) && x.ko > now()) h += `<div class="card" style="padding:12px 14px"><div class="muted h" style="font-size:12px">Kick-off in</div><div class="count" style="margin-top:6px" data-countdown="${x.ko}">${countdownHTML(x.ko)}</div></div>`;
    if (rh || ra) h += `<div class="sec-title"><h2>Form guide</h2></div><div class="card"><div class="vs-form">
        <div><b class="h">${rh ? ordinal(rh.pos) : ''} · ${rh ? rh.pts : 0} pts</b>${rh ? formDots(rh.form) : ''}</div>
        <div><b class="h">${ra ? ordinal(ra.pos) : ''} · ${ra ? ra.pts : 0} pts</b>${ra ? formDots(ra.form) : ''}</div></div></div>`;
    h += `<div class="sec-title"><h2>Match info</h2></div><div class="card"><ul class="info">
      <li><span>Kick-off</span><span>${esc(fmt.day(x.ko))}, ${esc(fmt.time(x.ko))}</span></li>
      ${x.venue ? `<li><span>Venue</span><span>${esc(x.venue)}${x.city ? ', ' + esc(x.city) : ''}</span></li>` : ''}
      <li><span>Competition</span><span>${esc(C().name)}</span></li></ul></div>`;
    if (x.tix) h += `<a class="btn alt" style="margin-top:12px" href="${esc(x.tix)}" target="_blank" rel="noopener">Buy tickets</a>`;
    const h2h = (d.matches || []).filter(o => o.id !== x.id && isDone(o) && ((o.h.code === x.h.code && o.a.code === x.a.code) || (o.h.code === x.a.code && o.a.code === x.h.code)));
    if (h2h.length) h += `<div class="sec-title"><h2>Earlier this season</h2></div><div class="card">${h2h.map(o => matchRow(o, { showDate: true })).join('')}</div>`;
    h += `</div>`;
    return h + foot();
  }

  const tab = S.ui.mcTab;
  h += `<div class="seg"><button data-mctab="timeline" class="${tab === 'timeline' ? 'on' : ''}">Timeline</button><button data-mctab="info" class="${tab === 'info' ? 'on' : ''}">Info</button></div><div class="wrap">`;
  if (!det) h += loading(300);
  else if (tab === 'info') {
    const ref = det.refs.find(r => r.r === 'Main');
    h += `<div class="card"><ul class="info">
      <li><span>Kick-off</span><span>${esc(fmt.day(x.ko))}, ${esc(fmt.time(x.ko))}</span></li>
      <li><span>Venue</span><span>${esc(det.venue ? det.venue.name : x.venue)}${det.venue && det.venue.city ? ', ' + esc(det.venue.city) : ''}</span></li>
      ${det.att ? `<li><span>Attendance</span><span>${Number(det.att).toLocaleString()}</span></li>` : ''}
      ${ref ? `<li><span>Referee</span><span>${esc(ref.n)}</span></li>` : ''}
      ${det.refs.filter(r => r.r !== 'Main').map(r => `<li><span>${esc(r.r)}</span><span>${esc(r.n)}</span></li>`).join('')}
      ${x.ht ? `<li><span>Half time</span><span>${x.ht[0]}-${x.ht[1]}</span></li>` : ''}
    </ul></div>`;
  } else h += `<div class="card">${timeline(x, det)}</div>`;
  h += '</div>' + foot();
  return h;
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const pendingDetail = new Set();
async function loadDetailThenRender(id) {
  if (pendingDetail.has(id)) return;
  pendingDetail.add(id);
  try {
    const det = await getDetail(id);
    if (!det.done) S.live[id] = det;
  } catch (e) { toast('Could not load match details'); }
  pendingDetail.delete(id);
  if (S.view.tab === 'match' && S.view.id === id) render();
}

/* ---- club page */
function viewClub(code) {
  const d = D();
  const info = CLUBS[code];
  if (!d.matches || !d.ladder) return loading(200);
  const row = d.ladder.find(r => r.t.code === code);
  const t = row ? row.t : (d.matches.find(m => m.h.code === code) || {}).h || { code };
  if (!row && !d.matches.some(m => m.h.code === code || m.a.code === code)) return errBox(`${info ? info.name : code} isn't in the ${C().name}.`) + `<div class="wrap"><a class="btn" href="#/ladder">Go to ladder</a></div>`;
  const isFav = fav() === code;
  const color = clubColor(t);
  const mine = d.matches.filter(m => m.h.code === code || m.a.code === code);
  const results = mine.filter(m => isDone(withLive(m))).reverse();
  const fixtures = mine.filter(m => !isDone(withLive(m)));
  let h = `<section class="club-hero" style="background:linear-gradient(160deg, ${color} 0%, ${color} 55%, rgba(0,0,0,.55) 140%), ${color}">
    <div style="display:flex;justify-content:space-between;align-items:center"><a class="back" href="javascript:history.back()">‹ Back</a>
    <button class="fav-btn ${isFav ? 'on' : ''}" data-fav="${isFav ? '' : esc(code)}">${isFav ? '★ My club' : '☆ Make my club'}</button></div>
    <div class="row">${crest(t, 'xl')}<div><h1>${esc(clubName(t))}</h1><div style="opacity:.85;font-size:13px;margin-top:4px">${esc(C().name)}</div></div></div>
    ${row ? `<div class="facts"><div><b>${ordinal(row.pos)}</b><span>Position</span></div><div><b>${row.pts}</b><span>Points</span></div><div><b>${row.w}-${row.dr}-${row.l}</b><span>W-D-L</span></div><div><b>${row.gd > 0 ? '+' : ''}${row.gd}</b><span>Goal diff</span></div></div>` : ''}
  </section><div class="wrap">`;
  if (row && row.form.length) h += `<div class="sec-title"><h2>Form</h2></div><div class="card" style="padding:12px 14px">${formDots(row.form)}</div>`;
  if (fixtures.length) h += `<div class="sec-title"><h2>Fixtures</h2></div><div class="card">${fixtures.slice(0, 6).map(m => matchRow(m, { showDate: true })).join('')}</div>`;
  const scorers = computeStats(S.comp).filter(p => p.t.code === code && p.g).sort((a, b) => b.g - a.g).slice(0, 5);
  if (scorers.length) h += `<div class="sec-title"><h2>Top scorers</h2><a href="#/stats">All stats</a></div><div class="card">${scorers.map((p, i) => `<div class="lead"><span class="rk">${i + 1}</span><div class="nm"><b>${esc(p.name)}</b><span>${p.a} assist${p.a === 1 ? '' : 's'}</span></div><span class="val">${p.g}</span></div>`).join('')}</div>`;
  if (results.length) h += `<div class="sec-title"><h2>Results</h2></div><div class="card">${results.map(m => matchRow(m, { showDate: true })).join('')}</div>`;
  h += '</div>' + foot();
  return h;
}

function banner(title, sub) {
  return `<section class="banner"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</section>`;
}
function foot() {
  const d = D();
  const t = Math.max(d.fetched.matches || 0, d.fetched.ladder || 0);
  return `<div class="foot">Unofficial fan app · Data from the A-Leagues${t ? ' · Updated ' + esc(fmt.time(t)) : ''}</div>`;
}

/* ------------------------------------------------------------------ router & render */
function parseHash() {
  const p = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
  const tab = p[0] || 'home';
  return { tab, id: p[1] || null };
}

let lastRenderKey = '';
function render() {
  const v = S.view = parseHash();
  const el = $('#view');
  let html;
  try {
    switch (v.tab) {
      case 'matches': html = viewMatches(); break;
      case 'ladder': html = viewLadder(); break;
      case 'stats': html = viewStats(); ensureStats(S.comp); break;
      case 'news': html = viewNews(); break;
      case 'match': html = viewMatch(v.id); break;
      case 'club': html = viewClub(v.id); break;
      default: html = viewHome();
    }
  } catch (e) { console.error(e); html = errBox('Something went wrong: ' + e.message); }
  if (S.error && !html.includes('class="err"')) html = errBox(S.error) + html;
  el.innerHTML = html;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (v.tab === 'match' || v.tab === 'club' ? '' : v.tab)));
  document.querySelectorAll('.comp-switch button').forEach(b => b.classList.toggle('on', b.dataset.comp === S.comp));
  const key = v.tab + '/' + (v.id || '') + '/' + S.comp;
  if (key !== lastRenderKey) {
    lastRenderKey = key;
    if (v.tab === 'matches') { const on = $('#chips .chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  }
}
let rT = 0;
function throttledRender() { if (rT) return; rT = setTimeout(() => { rT = 0; render(); }, 400); }

/* ------------------------------------------------------------------ events */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-comp],[data-round],[data-lmode],[data-smode],[data-mctab],[data-fav]');
  if (!t) return;
  if (t.dataset.comp) { switchComp(t.dataset.comp, true); return; }
  if (t.dataset.round) { S.ui.round = t.dataset.round; render(); return; }
  if (t.dataset.lmode) { S.ui.ladderMode = t.dataset.lmode; render(); return; }
  if (t.dataset.smode) { S.ui.statMode = t.dataset.smode; render(); return; }
  if (t.dataset.mctab) { S.ui.mcTab = t.dataset.mctab; render(); return; }
  if (t.hasAttribute('data-fav')) {
    const code = t.dataset.fav;
    setFav(code || null);
    toast(code ? `${CLUBS[code] ? CLUBS[code].name : code} is now your club` : 'Club removed');
    render();
  }
});

function switchComp(comp, go) {
  if (!COMPS[comp] || comp === S.comp) return;
  S.comp = comp; store.set('comp', comp);
  S.ui.round = null;
  if (go && (S.view.tab === 'match' || S.view.tab === 'club')) location.hash = '#/home';
  render();
  refreshAll(false);
}

window.addEventListener('hashchange', () => {
  const v = parseHash();
  if (v.tab === 'match') S.ui.mcTab = 'timeline';
  render();
  window.scrollTo(0, 0);
});

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ------------------------------------------------------------------ refresh loop */
let refreshing = false;
async function refreshAll(force) {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#refresh'); btn.classList.add('spin');
  const comp = S.comp;
  let changed = false;
  S.error = null;
  try {
    // ladder first: it tells us the current season id
    changed = (await refreshLadder(comp, force)) || changed;
    changed = (await refreshMatches(comp, force)) || changed;
  } catch (e) {
    const d = S.data[comp];
    if (!d || !d.matches) S.error = navigator.onLine === false ? 'You are offline.' : 'Could not reach the A-Leagues data feed. Pull down or tap refresh to try again.';
    else if (force) toast('Offline - showing saved data');
  }
  try { changed = (await pollLive()) || changed; } catch { }
  try { changed = (await refreshNews(force)) || changed; } catch { }
  btn.classList.remove('spin');
  refreshing = false;
  if (changed || force || S.error) render();
}

$('#refresh').addEventListener('click', () => refreshAll(true));

// tick: countdowns every second, live clocks + polling while a match is on
let tickN = 0;
setInterval(() => {
  tickN++;
  document.querySelectorAll('[data-countdown]').forEach(el => {
    const ko = +el.dataset.countdown;
    el.innerHTML = countdownHTML(ko);
    if (ko <= now() && tickN % 5 === 0) refreshAll(false).then(render);
  });
  if (document.hidden) return;
  const d = D();
  const anyLive = d.matches && d.matches.some(m => { const x = withLive(m); return isLive(x) || maybeLive(x); });
  if (anyLive && tickN % 20 === 0) pollLive().then(ch => { if (ch) { D().fetched.ladder = 0; refreshLadder(S.comp).finally(render); } else render(); });
  else if (tickN % 300 === 0) refreshAll(false);
}, 1000);

document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(false); });

/* simple pull-to-refresh (standalone apps have no browser pull-to-refresh) */
(() => {
  let y0 = null;
  addEventListener('touchstart', e => { y0 = window.scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  addEventListener('touchend', e => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 110) refreshAll(true);
    y0 = null;
  }, { passive: true });
})();

/* ------------------------------------------------------------------ boot */
render();
refreshAll(false);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
