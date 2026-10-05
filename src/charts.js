// グラフ類（太陽位置図・窓別タイムライン・月別グラフ）。すべて Canvas で描画しホバーで値を表示
import { fmtTime, dirName } from './sun.js';
import { seriesColor, sunRamp, rgb, INK } from './colors.js';

const FONT = '"Yu Gothic UI", "Hiragino Sans", "Meiryo", system-ui, sans-serif';

// ---- ツールチップ ----
let tipEl = null;
export function showTip(html, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  const r = tipEl.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}
export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

function setupCanvas(canvas, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.parentElement.clientWidth;
  const h = cssH ?? canvas.parentElement.clientHeight;
  canvas.width = Math.max(10, Math.floor(w * dpr));
  canvas.height = Math.max(10, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

function niceStep(max, target = 5) {
  const raw = max / target;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---- 太陽位置図（正距方位図・北が上） ----
export const PATH_STYLE = {
  summer: { color: '#eb6834', label: '夏至' },
  equinox: { color: '#1baf7a', label: '春分・秋分' },
  winter: { color: '#2a78d6', label: '冬至' },
  current: { color: INK.primary, label: '選択日' },
};

export class SunPathChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.data = null;
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', hideTip);
  }

  geom() {
    const { w, h } = this;
    const R = Math.max(10, Math.min(w, h) / 2 - 24);
    return { cx: w / 2, cy: h / 2 + 2, R };
  }

  xy(alt, az) {
    const { cx, cy, R } = this.geom();
    const r = (R * (90 - Math.max(alt, 0))) / 90;
    return [cx + r * Math.sin((az * Math.PI) / 180), cy - r * Math.cos((az * Math.PI) / 180)];
  }

  draw(data) {
    this.data = data;
    const { g, w, h } = setupCanvas(this.canvas);
    this.w = w;
    this.h = h;
    if (w < 60 || h < 60) return;
    const { cx, cy, R } = this.geom();
    g.fillStyle = INK.surface;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 1;
    g.strokeStyle = INK.grid;
    g.fillStyle = INK.muted;
    g.font = `10px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const a of [0, 15, 30, 45, 60, 75]) {
      g.beginPath();
      g.arc(cx, cy, (R * (90 - a)) / 90, 0, Math.PI * 2);
      g.strokeStyle = a === 0 ? INK.axis : INK.grid;
      g.stroke();
      if (a > 0) g.fillText(`${a}°`, cx + 2 + ((R * (90 - a)) / 90) * Math.sin(Math.PI * 0.82), cy - ((R * (90 - a)) / 90) * Math.cos(Math.PI * 0.82));
    }
    for (let az = 0; az < 360; az += 30) {
      const [x, y] = this.xy(0, az);
      g.strokeStyle = INK.grid;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(x, y);
      g.stroke();
      const lx = cx + (R + 13) * Math.sin((az * Math.PI) / 180);
      const ly = cy - (R + 13) * Math.cos((az * Math.PI) / 180);
      const main = { 0: '北', 90: '東', 180: '南', 270: '西' }[az];
      g.fillStyle = main ? INK.primary : INK.muted;
      g.font = main ? `bold 12px ${FONT}` : `10px ${FONT}`;
      g.fillText(main || `${az}°`, lx, ly);
    }
    // 季節の軌跡
    const line = (pts, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let on = false;
      for (const p of pts) {
        if (p.alt <= 0) {
          on = false;
          continue;
        }
        const [x, y] = this.xy(p.alt, p.az);
        on ? g.lineTo(x, y) : g.moveTo(x, y);
        on = true;
      }
      g.stroke();
    };
    for (const k of ['summer', 'equinox', 'winter']) if (data.paths[k]) line(data.paths[k], PATH_STYLE[k].color, 1.5);
    line(data.paths.current, PATH_STYLE.current.color, 2);
    // 時刻目盛（選択日）
    g.font = `10px ${FONT}`;
    for (const p of data.paths.current) {
      if (p.alt <= 0 || p.m % 60 !== 0) continue;
      const [x, y] = this.xy(p.alt, p.az);
      g.fillStyle = INK.primary;
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
      const hr = p.m / 60;
      if (hr % 2 === 0) {
        g.fillStyle = INK.secondary;
        g.fillText(String(hr), x, y - 9);
      }
    }
    // 現在位置
    if (data.now && data.now.alt > 0) {
      const [x, y] = this.xy(data.now.alt, data.now.az);
      g.fillStyle = '#ffb300';
      g.strokeStyle = INK.surface;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  hover(e) {
    if (!this.data) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best = null;
    let bd = 14;
    for (const p of this.data.paths.current) {
      if (p.alt <= 0) continue;
      const [x, y] = this.xy(p.alt, p.az);
      const d = Math.hypot(x - mx, y - my);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return hideTip();
    showTip(`<b>${fmtTime(best.m)}</b><br>高度 ${best.alt.toFixed(1)}°<br>方位 ${best.az.toFixed(1)}°（${dirName(best.az)}）`, e.clientX, e.clientY);
  }
}

// ---- 窓別タイムライン ----
const ROW_H = 22;
const LABEL_W = 170;
const HEAD_H = 22;

function hatchPattern(g) {
  const c = document.createElement('canvas');
  c.width = 6;
  c.height = 6;
  const p = c.getContext('2d');
  p.fillStyle = '#eef1f5';
  p.fillRect(0, 0, 6, 6);
  p.strokeStyle = '#8796ab';
  p.lineWidth = 1;
  p.beginPath();
  p.moveTo(0, 6);
  p.lineTo(6, 0);
  p.moveTo(-1, 1);
  p.lineTo(1, -1);
  p.moveTo(5, 7);
  p.lineTo(7, 5);
  p.stroke();
  return g.createPattern(c, 'repeat');
}

export class TimelineChart {
  constructor(canvas, { onPickTime } = {}) {
    this.canvas = canvas;
    this.onPickTime = onPickTime;
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', hideTip);
    canvas.addEventListener('click', (e) => {
      const t = this.timeAt(e);
      if (t !== null) this.onPickTime?.(Math.round(t / 5) * 5);
    });
  }

  range(day) {
    const st = day.sunTimes;
    let t0 = 0;
    let t1 = 1440;
    if (st.sunrise !== null && st.sunset !== null) {
      t0 = Math.max(0, Math.floor(st.sunrise / 60) * 60 - 60);
      t1 = Math.min(1440, Math.ceil(st.sunset / 60) * 60 + 60);
    }
    return [t0, t1];
  }

  draw(day, windows, minutes) {
    this.day = day;
    this.windows = windows;
    const rows = windows.length;
    const { g, w } = setupCanvas(this.canvas, HEAD_H + Math.max(1, rows) * ROW_H + 4);
    this.w = w;
    const [t0, t1] = this.range(day);
    this.t0 = t0;
    this.t1 = t1;
    const X = (t) => LABEL_W + ((t - t0) / (t1 - t0)) * (w - LABEL_W - 8);
    this.X = X;
    g.fillStyle = INK.surface;
    g.fillRect(0, 0, w, HEAD_H + rows * ROW_H + 4);
    const hatch = hatchPattern(g);

    // 時刻目盛
    g.font = `10px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 60) {
      const x = X(t);
      g.fillStyle = INK.muted;
      g.fillText(String(t / 60), x, HEAD_H / 2);
    }

    windows.forEach((wd, i) => {
      const y = HEAD_H + i * ROW_H;
      // ラベル
      g.fillStyle = seriesColor(i);
      g.beginPath();
      g.arc(10, y + ROW_H / 2, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK.primary;
      g.textAlign = 'left';
      g.font = `12px ${FONT}`;
      let name = `${i + 1}. ${wd.win.name}`;
      while (g.measureText(name).width > LABEL_W - 26 && name.length > 3) name = `${name.slice(0, -2)}…`;
      g.fillText(name, 20, y + ROW_H / 2);
      // セル
      const s = day.win[i];
      const cellY = y + 1;
      const cellH = ROW_H - 2; // 行間 2px の余白
      for (let k = 0; k < day.times.length; k++) {
        const tc = day.times[k];
        const a = tc - day.step / 2;
        const b = tc + day.step / 2;
        if (b <= t0 || a >= t1) continue;
        const xa = X(Math.max(a, t0));
        const xb = X(Math.min(b, t1));
        if (!day.sun[k]) g.fillStyle = '#dedcd5';
        else if (!s.facing[k]) g.fillStyle = '#f1f0eb';
        else if (s.frac[k] < 0.02) g.fillStyle = hatch;
        else g.fillStyle = rgb(sunRamp(0.18 + 0.82 * s.frac[k]));
        g.fillRect(xa, cellY, xb - xa + 0.5, cellH);
      }
    });
    // 時刻の補助線
    g.strokeStyle = 'rgba(11,11,11,0.06)';
    g.lineWidth = 1;
    for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 60) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath();
      g.moveTo(x, HEAD_H);
      g.lineTo(x, HEAD_H + rows * ROW_H);
      g.stroke();
    }
    // 現在時刻
    if (minutes >= t0 && minutes <= t1) {
      const x = X(minutes);
      g.strokeStyle = INK.primary;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, HEAD_H - 4);
      g.lineTo(x, HEAD_H + rows * ROW_H);
      g.stroke();
    }
  }

  timeAt(e) {
    if (!this.day) return null;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    if (mx < LABEL_W) return null;
    const t = this.t0 + ((mx - LABEL_W) / (this.w - LABEL_W - 8)) * (this.t1 - this.t0);
    return Math.min(this.t1, Math.max(this.t0, t));
  }

  hover(e) {
    const t = this.timeAt(e);
    if (t === null) return hideTip();
    const r = this.canvas.getBoundingClientRect();
    const row = Math.floor((e.clientY - r.top - HEAD_H) / ROW_H);
    if (row < 0 || row >= this.windows.length) return hideTip();
    const day = this.day;
    const k = Math.min(day.times.length - 1, Math.max(0, Math.floor(t / day.step)));
    const s = day.win[row];
    const sun = day.sun[k];
    let state;
    if (!sun) state = '夜間（太陽が地平線下）';
    else if (!s.facing[k]) state = '太陽が壁の裏側（向きにより当たらない）';
    else if (s.frac[k] < 0.02) state = '日は向いているが、軒・庇・樹木・隣家などで遮蔽';
    else state = `窓面の <b>${Math.round(s.frac[k] * 100)}%</b> に日射<br>直達日射 ${Math.round(s.irr[k])} W/m²`;
    const a = day.times[k] - day.step / 2;
    showTip(
      `<b>${row + 1}. ${escapeHtml(this.windows[row].win.name)}</b><br>${fmtTime(a)}〜${fmtTime(a + day.step)}<br>${state}<br><span class="muted">クリックでこの時刻へ</span>`,
      e.clientX,
      e.clientY
    );
  }
}

// ---- 月別グラフ（各月21日） ----
export class YearChart {
  constructor(canvas, { onPickMonth } = {}) {
    this.canvas = canvas;
    this.onPickMonth = onPickMonth;
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', () => {
      hideTip();
      this.hoverM = null;
      if (this.args) this.draw(...this.args);
    });
    canvas.addEventListener('click', () => {
      if (this.hoverM) this.onPickMonth?.(this.hoverM);
    });
  }

  draw(year, windows, metric, currentMonth) {
    this.args = [year, windows, metric, currentMonth];
    const { g, w, h } = setupCanvas(this.canvas);
    this.w = w;
    const pad = { l: 46, r: 14, t: 14, b: 26 };
    this.pad = pad;
    const series = year ? year.win.map((x) => (metric === 'effH' ? x.effH : x.gainKWh)) : [];
    const max = Math.max(0.1, ...series.flat());
    const step = niceStep(max, 4);
    const top = Math.ceil(max / step) * step;
    const X = (m) => pad.l + ((m - 1) / 11) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v / top) * (h - pad.t - pad.b);
    this.X = X;
    g.fillStyle = INK.surface;
    g.fillRect(0, 0, w, h);
    g.font = `10px ${FONT}`;
    g.textBaseline = 'middle';
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = v === 0 ? INK.axis : INK.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(pad.l, y);
      g.lineTo(w - pad.r, y);
      g.stroke();
      g.fillStyle = INK.muted;
      g.textAlign = 'right';
      g.fillText(step < 1 ? v.toFixed(1) : String(Math.round(v)), pad.l - 6, y);
    }
    g.textAlign = 'center';
    for (let m = 1; m <= 12; m++) {
      g.fillStyle = m === currentMonth ? INK.primary : INK.muted;
      g.font = m === currentMonth ? `bold 11px ${FONT}` : `10px ${FONT}`;
      g.fillText(`${m}月`, X(m), h - pad.b + 14);
    }
    const hm = this.hoverM ?? currentMonth;
    if (hm) {
      g.strokeStyle = this.hoverM ? INK.axis : 'rgba(11,11,11,0.15)';
      g.lineWidth = 1;
      const x = Math.round(X(hm)) + 0.5;
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, h - pad.b);
      g.stroke();
    }
    series.forEach((vals, i) => {
      g.strokeStyle = seriesColor(i);
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      vals.forEach((v, k) => (k ? g.lineTo(X(k + 1), Y(v)) : g.moveTo(X(k + 1), Y(v))));
      g.stroke();
    });
    if (this.hoverM) {
      series.forEach((vals, i) => {
        g.fillStyle = seriesColor(i);
        g.strokeStyle = INK.surface;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(this.hoverM), Y(vals[this.hoverM - 1]), 4.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
  }

  hover(e) {
    if (!this.args || !this.args[0]) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const m = Math.round(((mx - this.pad.l) / (this.w - this.pad.l - this.pad.r)) * 11) + 1;
    if (m < 1 || m > 12) {
      hideTip();
      return;
    }
    if (m !== this.hoverM) {
      this.hoverM = m;
      this.draw(...this.args);
    }
    const [year, windows, metric] = this.args;
    const unit = metric === 'effH' ? 'h' : 'kWh/日';
    const rows = windows
      .map((wd, i) => ({ i, name: wd.win.name, v: metric === 'effH' ? year.win[i].effH[m - 1] : year.win[i].gainKWh[m - 1] }))
      .sort((a, b) => b.v - a.v)
      .map((x) => `<div class="tip-row"><span class="dot" style="background:${seriesColor(x.i)}"></span>${x.i + 1}. ${escapeHtml(x.name)}<b>${x.v.toFixed(2)} ${unit}</b></div>`)
      .join('');
    const total = metric === 'effH' ? '' : `<div class="tip-row tip-total">合計<b>${windows.reduce((s, _, i) => s + year.win[i].gainKWh[m - 1], 0).toFixed(2)} kWh/日</b></div>`;
    showTip(`<b>${year.year}年${m}月21日</b>${rows}${total}<span class="muted">クリックでこの日へ</span>`, e.clientX, e.clientY);
  }
}

export { escapeHtml };
