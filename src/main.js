import './style.css';
import { loadModel, saveModel } from './model.js';
import { buildGeometry } from './geometry.js';
import { analyzeDay, analyzeYear, analyzeInstant, shadowGrid, sunHoursGrid } from './analysis.js';
import { sunPosition, localToUtc, seasonalDates, utcToLocalDate, fmtTime, dirName } from './sun.js';
import { Scene3D } from './scene3d.js';
import { PlanView } from './planview.js';
import { SunPathChart, TimelineChart, YearChart, PATH_STYLE, escapeHtml } from './charts.js';
import { Sidebar, faceLabel } from './ui.js';
import { seriesColor, sunRamp, rgb } from './colors.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');

const S = {
  model: loadModel(),
  geom: null,
  day: null,
  year: null,
  instant: null,
  paths: null,
  sunmap: null,
  mapJob: 0,
  overlay: 'shadow',
};

// ---------- 部品の生成 ----------
const scene = new Scene3D($('view3d'));
const plan = new PlanView($('plan'), {
  onDrag: () => change('drag'),
  onDragEnd: () => change('geometry'),
});
const sunChart = new SunPathChart($('sunpath'));
const timeline = new TimelineChart($('timeline'), { onPickTime: (m) => setTime(m) });
const yearChart = new YearChart($('year'), {
  onPickMonth: (mo) => setDate(`${S.model.date.slice(0, 4)}-${pad2(mo)}-21`),
});
const sidebar = new Sidebar($('sidebar'), {
  getModel: () => S.model,
  setModel,
  change,
  recenterMap: () => sidebar.siteMap.update(S.model, S.geom, true),
});

// ---------- 更新処理 ----------
const timers = {};
function debounce(key, ms, fn) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
}

function rebuildGeometry() {
  S.geom = buildGeometry(S.model);
  scene.setModel(S.model, S.geom);
  sidebar.siteMap.update(S.model, S.geom);
}

function computePaths() {
  const m = S.model;
  const { lat, lng, tz } = m.site;
  const sd = seasonalDates(Number(m.date.slice(0, 4)), tz);
  const path = (date) => {
    const pts = [];
    for (let t = 0; t <= 1440; t += 10) {
      const p = sunPosition(localToUtc(date, t, tz), lat, lng);
      pts.push({ m: t, alt: p.altitude, az: p.azimuth });
    }
    return pts;
  };
  return { current: path(m.date), summer: path(sd.summer), equinox: path(sd.vernal), winter: path(sd.winter), seasonal: sd };
}

function updateDay() {
  S.day = analyzeDay(S.model, S.geom);
  S.paths = computePaths();
  renderSunInfo();
  renderTable();
  timeline.draw(S.day, S.geom.windows, S.model.minutes);
  drawSunPath();
  renderPresets();
  const p = S.instant?.pos;
  if (p) scene.setSun(p.altitude, p.azimuth, S.paths.current);
}

function updateYear() {
  S.year = analyzeYear(S.model, S.geom);
  drawYear();
}

function updateInstant() {
  const m = S.model;
  S.instant = analyzeInstant(m, S.geom);
  const p = S.instant.pos;
  scene.setSun(p.altitude, p.azimuth, S.paths?.current || []);
  updatePlan();
  renderReadout();
  if (S.day) {
    renderTable();
    timeline.draw(S.day, S.geom.windows, m.minutes);
    drawSunPath();
  }
}

function updatePlan() {
  let overlay = null;
  if (S.overlay === 'shadow') overlay = shadowGrid(S.model, S.geom, S.instant);
  else if (S.overlay === 'hours') overlay = S.sunmap;
  plan.setData({ model: S.model, geom: S.geom, instant: S.instant, overlay });
}

/**
 * 入力の変更通知
 * kind: time（時刻のみ）/ drag（配置図でドラッグ中）/ meta（名称のみ）/ その他（形状・敷地・日付・設定）
 */
function change(kind) {
  if (kind === 'time') {
    updateInstant();
    debounce('save', 500, () => saveModel(S.model));
    return;
  }
  if (kind === 'meta') {
    renderTable();
    if (S.day) timeline.draw(S.day, S.geom.windows, S.model.minutes);
    debounce('save', 500, () => saveModel(S.model));
    return;
  }
  rebuildGeometry();
  S.sunmap = null;
  S.mapJob++;
  updateInstant();
  if (kind === 'drag') {
    sidebar.syncValues();
    debounce('day', 120, updateDay);
    return;
  }
  if (kind === 'date' || kind === 'site') updateDay();
  else debounce('day', 120, updateDay);
  debounce('year', 450, updateYear);
  if (S.overlay === 'hours') debounce('map', 700, computeSunmap);
  debounce('save', 500, () => saveModel(S.model));
}

function setModel(m) {
  S.model = m;
  syncTopbar();
  sidebar.render();
  plan.fitted = false;
  change('geometry');
  updateDay();
  sidebar.siteMap.update(S.model, S.geom, true);
}

// ---------- 日付・時刻 ----------
function setDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  S.model.date = d;
  $('date').value = d;
  change('date');
}

function setTime(min) {
  S.model.minutes = Math.min(1440, Math.max(0, min));
  $('time').value = S.model.minutes;
  $('timeLabel').textContent = fmtTime(S.model.minutes);
  change('time');
}

function syncTopbar() {
  $('date').value = S.model.date;
  $('time').value = S.model.minutes;
  $('timeLabel').textContent = fmtTime(S.model.minutes);
}

function renderPresets() {
  const sd = S.paths?.seasonal;
  document.querySelectorAll('#presets button').forEach((b) => {
    const p = b.dataset.p;
    const d = p === 'today' ? utcToLocalDate(Date.now(), S.model.site.tz) : sd?.[p];
    b.classList.toggle('active', d === S.model.date);
    if (d) b.title = d;
  });
}

$('date').addEventListener('change', (e) => setDate(e.target.value));
$('time').addEventListener('input', (e) => setTime(Number(e.target.value)));
$('presets').addEventListener('click', (e) => {
  const p = e.target.closest('button')?.dataset.p;
  if (!p) return;
  const tz = S.model.site.tz;
  if (p === 'today') return setDate(utcToLocalDate(Date.now(), tz));
  setDate(seasonalDates(Number(S.model.date.slice(0, 4)), tz)[p]);
});
$('prevDay').addEventListener('click', () => shiftDay(-1));
$('nextDay').addEventListener('click', () => shiftDay(1));
function shiftDay(n) {
  const [y, m, d] = S.model.date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  setDate(`${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`);
}

// 再生（日の出〜日の入りを繰り返し）
let playing = false;
let lastTs = 0;
function tick(ts) {
  if (!playing) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  const st = S.day?.sunTimes;
  const lo = st?.sunrise != null ? Math.max(0, st.sunrise - 20) : 0;
  const hi = st?.sunset != null ? Math.min(1440, st.sunset + 20) : 1440;
  let t = S.model.minutes + dt * Number($('speed').value);
  if (t > hi || t < lo) t = lo;
  S.model.minutes = t;
  $('time').value = t;
  $('timeLabel').textContent = fmtTime(t);
  updateInstant();
  requestAnimationFrame(tick);
}
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').textContent = playing ? '❚❚' : '▶';
  $('play').title = playing ? '一時停止' : '再生';
  lastTs = 0;
  if (playing) requestAnimationFrame(tick);
  else {
    S.model.minutes = Math.round(S.model.minutes);
    saveModel(S.model);
  }
});

// ---------- 表示 ----------
function renderReadout() {
  const p = S.instant.pos;
  $('readout').innerHTML =
    p.altitude > 0
      ? `<span>太陽高度 <b>${p.altitude.toFixed(1)}°</b></span><span>方位 <b>${p.azimuth.toFixed(1)}°</b>（${dirName(p.azimuth)}）</span>`
      : `<span class="muted">太陽は地平線の下です（高度 ${p.altitude.toFixed(1)}°）</span>`;
}

function renderSunInfo() {
  const st = S.day.sunTimes;
  const len = st.sunrise !== null && st.sunset !== null ? st.sunset - st.sunrise : st.polar === 'day' ? 1440 : 0;
  const rows = [
    ['日の出', fmtTime(st.sunrise)],
    ['南中', `${fmtTime(st.transit)}（高度 ${st.transitAlt.toFixed(1)}°）`],
    ['日の入り', fmtTime(st.sunset)],
    ['可照時間', `${Math.floor(len / 60)}時間${pad2(Math.round(len % 60))}分`],
  ];
  $('sunInfo').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('sunpathLegend').innerHTML = ['current', 'summer', 'equinox', 'winter']
    .map((k) => `<span class="key"><i class="line" style="background:${PATH_STYLE[k].color};height:${k === 'current' ? 2 : 1.5}px"></i>${PATH_STYLE[k].label}${k === 'current' ? `（${S.model.date}）` : ''}</span>`)
    .join('') + '<span class="key"><i class="sun"></i>現在の太陽</span>';
}

function drawSunPath() {
  if (!S.paths) return;
  const p = S.instant?.pos;
  sunChart.draw({ paths: S.paths, now: p ? { alt: p.altitude, az: p.azimuth } : null });
}

function drawYear() {
  if (!S.year) return;
  const metric = $('yearMetric').value;
  yearChart.draw(S.year, S.geom.windows, metric, Number(S.model.date.slice(5, 7)));
  $('yearLegend').innerHTML = S.geom.windows
    .map((w, i) => `<span class="key"><i class="line" style="background:${seriesColor(i)}"></i>${i + 1}. ${escapeHtml(w.win.name)}</span>`)
    .join('');
}
$('yearMetric').addEventListener('change', drawYear);

function renderTable() {
  const { geom, day, instant, model } = S;
  if (!geom || !day || !instant) return;
  $('resultDate').textContent = `${model.date}（${model.site.name || '敷地'}）`;
  const f2 = (v) => v.toFixed(2);
  let html = `<thead><tr>
    <th class="l">窓</th><th class="l">向き</th>
    <th>面積<small>m²</small></th>
    <th>現在<small>${fmtTime(model.minutes)}</small></th>
    <th>日照時間<small>h（一部でも当たる）</small></th>
    <th>有効日照<small>h（面積加重）</small></th>
    <th>直達日射<small>kWh/日</small></th>
    <th>日射熱取得<small>kWh/日（×η）</small></th>
    <th>差込み奥行<small>m（現在）</small></th>
  </tr></thead><tbody>`;
  let sumA = 0;
  let sumD = 0;
  let sumG = 0;
  geom.windows.forEach((w, i) => {
    const d = day.win[i];
    const r = instant.win[i];
    sumA += w.area;
    sumD += d.directWh;
    sumG += d.gainWh;
    let now;
    if (!instant.sun) now = '<span class="muted">夜間</span>';
    else if (!r.facing) now = '<span class="muted">壁の裏側</span>';
    else if (r.frac < 0.02) now = '<span class="shade">遮蔽</span>';
    else now = `<span class="pct"><i style="width:${Math.round(r.frac * 100)}%;background:${rgb(sunRamp(0.3 + r.frac * 0.7))}"></i></span>${Math.round(r.frac * 100)}%`;
    const warn = w.warns.length ? ` <span class="warn" title="${escapeHtml(w.warns.join('\n'))}">⚠</span>` : '';
    html += `<tr data-id="${w.win.id}">
      <td class="l"><span class="swatch" style="background:${seriesColor(i)}">${i + 1}</span>${escapeHtml(w.win.name)}${warn}</td>
      <td class="l nowrap">${faceLabel(w.win.face, model.site.rotation).replace(/（(.+?)向き.*$/, '（$1）')}</td>
      <td>${f2(w.area)}</td>
      <td class="nowrap">${now}</td>
      <td>${d.sunH.toFixed(1)}</td>
      <td>${d.effH.toFixed(1)}</td>
      <td>${f2(d.directWh / 1000)}</td>
      <td><b>${f2(d.gainWh / 1000)}</b></td>
      <td>${r.depth > 0 ? r.depth.toFixed(2) : '—'}</td>
    </tr>`;
  });
  html += `</tbody><tfoot><tr><td class="l">合計</td><td></td><td>${f2(sumA)}</td><td></td><td></td><td></td><td>${f2(sumD / 1000)}</td><td><b>${f2(sumG / 1000)}</b></td><td></td></tr></tfoot>`;
  $('winTable').innerHTML = html;
  $('tlLegend').innerHTML = `
    <span class="key"><i class="box" style="background:linear-gradient(90deg, ${rgb(sunRamp(0.2))}, ${rgb(sunRamp(1))})"></i>日射あり（濃いほど窓面の多くに当たる）</span>
    <span class="key"><i class="box hatch"></i>日は向いているが遮蔽（軒・庇・樹木・隣家など）</span>
    <span class="key"><i class="box" style="background:#f1f0eb"></i>太陽が壁の裏側</span>
    <span class="key"><i class="box" style="background:#dedcd5"></i>夜間</span>`;
}

$('winTable').addEventListener('click', (e) => {
  const id = e.target.closest('tr[data-id]')?.dataset.id;
  if (id) sidebar.openItem(id);
});

$('csv').addEventListener('click', () => {
  const { geom, day, model } = S;
  const head = ['No', '窓', '面', '階', '幅(m)', '高さ(m)', '面積(m2)', '日照時間(h)', '有効日照時間(h)', '直達日射量(kWh/日)', '日射熱取得量(kWh/日)'];
  const rows = geom.windows.map((w, i) => {
    const d = day.win[i];
    return [i + 1, w.win.name, faceLabel(w.win.face, model.site.rotation), w.win.floor, w.win.width, w.win.height, w.area.toFixed(2), d.sunH.toFixed(2), d.effH.toFixed(2), (d.directWh / 1000).toFixed(3), (d.gainWh / 1000).toFixed(3)];
  });
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = [`# ${model.site.name} ${model.date} 緯度${model.site.lat} 経度${model.site.lng}`, head, ...rows].map((r) => (Array.isArray(r) ? r.map(esc).join(',') : r)).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `日当たり_${model.date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- 3D・配置図の操作 ----------
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => scene.view(b.dataset.view)));
$('snap').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = scene.screenshot();
  a.download = `3D_${S.model.date}_${fmtTime(S.model.minutes).replace(':', '')}.png`;
  a.click();
});
$('fitPlan').addEventListener('click', () => plan.fit());
$('overlay').addEventListener('change', (e) => {
  S.overlay = e.target.value;
  if (S.overlay === 'hours' && !S.sunmap) computeSunmap();
  updatePlan();
});

async function computeSunmap() {
  const job = ++S.mapJob;
  const bar = $('mapProgress');
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  const res = await sunHoursGrid(
    S.model,
    S.geom,
    (p) => (bar.firstElementChild.style.width = `${Math.round(p * 100)}%`),
    () => job !== S.mapJob
  );
  if (job !== S.mapJob || !res) return;
  bar.hidden = true;
  S.sunmap = res;
  if (S.overlay === 'hours') updatePlan();
}

// グラフはコンテナの幅に追従
new ResizeObserver(() => {
  drawSunPath();
  if (S.day) timeline.draw(S.day, S.geom.windows, S.model.minutes);
  drawYear();
}).observe($('main'));

// ---------- 初期表示 ----------
syncTopbar();
rebuildGeometry();
S.paths = computePaths();
S.instant = analyzeInstant(S.model, S.geom);
updateDay();
updateInstant();
setTimeout(updateYear, 50);
