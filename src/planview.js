// 配置図（2D）。建物軸で描画し、真北を矢印で示す。樹木・障害物はドラッグで移動できる
import { RAD } from './sun.js';
import { obstacleAxis, obbCorners } from './geometry.js';
import { isLeafOff } from './model.js';
import { seriesColor, sunRamp, rgb, INK } from './colors.js';

export class PlanView {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = handlers;
    this.view = { cx: 0, cy: -3, scale: 14 };
    this.data = null;
    this.drag = null;
    this.fitted = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.bindEvents();
  }

  resize() {
    const el = this.canvas;
    const r = el.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.max(10, Math.floor(r.width * dpr));
    el.height = Math.max(10, Math.floor(r.height * dpr));
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    this.dpr = dpr;
    if (!this.fitted && this.data) this.fit();
    else this.draw();
  }

  get size() {
    return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr };
  }

  toS(x, y) {
    const { w, h } = this.size;
    return [w / 2 + (x - this.view.cx) * this.view.scale, h / 2 - (y - this.view.cy) * this.view.scale];
  }

  toW(sx, sy) {
    const { w, h } = this.size;
    return [(sx - w / 2) / this.view.scale + this.view.cx, -(sy - h / 2) / this.view.scale + this.view.cy];
  }

  setData(d) {
    this.data = d;
    if (!this.fitted && this.dpr) this.fit();
    else this.draw();
  }

  fit() {
    if (!this.data || !this.dpr) return;
    const b = this.data.geom.bounds;
    const { w, h } = this.size;
    if (w < 20 || h < 20) return;
    const bw = b.maxX - b.minX + 6;
    const bh = b.maxY - b.minY + 6;
    this.view.cx = (b.minX + b.maxX) / 2;
    this.view.cy = (b.minY + b.maxY) / 2;
    this.view.scale = Math.max(2, Math.min(w / bw, h / bh));
    this.fitted = true;
    this.draw();
  }

  hit(wx, wy) {
    const { model, geom } = this.data;
    for (let i = geom.crowns.length - 1; i >= 0; i--) {
      const c = geom.crowns[i];
      if (Math.hypot(wx - c.cx, wy - c.cy) <= Math.max(c.a, 0.6)) return { kind: 'tree', index: i, item: model.trees[i] };
    }
    for (let i = model.obstacles.length - 1; i >= 0; i--) {
      const o = model.obstacles[i];
      const [ux, uy] = obstacleAxis(o);
      const dx = wx - o.x;
      const dy = wy - o.y;
      if (Math.abs(dx * ux + dy * uy) <= o.w / 2 && Math.abs(-dx * uy + dy * ux) <= o.d / 2) return { kind: 'obstacle', index: i, item: o };
    }
    return null;
  }

  bindEvents() {
    const el = this.canvas;
    const pos = (e) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.data) return;
      const [sx, sy] = pos(e);
      const [wx, wy] = this.toW(sx, sy);
      const hit = this.hit(wx, wy);
      el.setPointerCapture(e.pointerId);
      if (hit) {
        this.drag = { mode: 'item', ...hit, ox: wx - hit.item.x, oy: wy - hit.item.y, moved: false };
        el.style.cursor = 'grabbing';
      } else {
        this.drag = { mode: 'pan', sx, sy, cx: this.view.cx, cy: this.view.cy };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.data) return;
      const [sx, sy] = pos(e);
      if (!this.drag) {
        const [wx, wy] = this.toW(sx, sy);
        const hit = this.hit(wx, wy);
        el.style.cursor = hit ? 'grab' : 'default';
        el.title = hit ? `${hit.item.name}（ドラッグで移動）` : '';
        return;
      }
      if (this.drag.mode === 'pan') {
        this.view.cx = this.drag.cx - (sx - this.drag.sx) / this.view.scale;
        this.view.cy = this.drag.cy + (sy - this.drag.sy) / this.view.scale;
        this.draw();
      } else {
        const [wx, wy] = this.toW(sx, sy);
        const snap = (v) => Math.round(v / 0.05) * 0.05;
        this.drag.item.x = Number(snap(wx - this.drag.ox).toFixed(2));
        this.drag.item.y = Number(snap(wy - this.drag.oy).toFixed(2));
        this.drag.moved = true;
        this.h.onDrag?.(this.drag.kind, this.drag.index);
      }
    });
    const end = () => {
      if (this.drag?.mode === 'item' && this.drag.moved) this.h.onDragEnd?.(this.drag.kind, this.drag.index);
      this.drag = null;
      el.style.cursor = 'default';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [sx, sy] = pos(e);
        const [wx, wy] = this.toW(sx, sy);
        const k = Math.exp(-e.deltaY * 0.0015);
        this.view.scale = Math.min(200, Math.max(1.5, this.view.scale * k));
        const [wx2, wy2] = this.toW(sx, sy);
        this.view.cx += wx - wx2;
        this.view.cy += wy - wy2;
        this.draw();
      },
      { passive: false }
    );
    el.addEventListener('dblclick', () => this.fit());
  }

  draw() {
    if (!this.data || !this.dpr) return;
    const g = this.ctx;
    const { w, h } = this.size;
    const { model, geom, instant, overlay } = this.data;
    const sc = this.view.scale;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#fbfaf7';
    g.fillRect(0, 0, w, h);

    // グリッド（1m / 5m）
    const [x0, y1] = this.toW(0, 0);
    const [x1, y0] = this.toW(w, h);
    const stepMinor = sc >= 8 ? 1 : 5;
    g.lineWidth = 1;
    for (let x = Math.floor(x0 / stepMinor) * stepMinor; x <= x1; x += stepMinor) {
      const [sx] = this.toS(x, 0);
      g.strokeStyle = Math.round(x) % 5 === 0 ? '#e1e0d9' : '#efeee9';
      g.beginPath();
      g.moveTo(Math.round(sx) + 0.5, 0);
      g.lineTo(Math.round(sx) + 0.5, h);
      g.stroke();
    }
    for (let y = Math.floor(y0 / stepMinor) * stepMinor; y <= y1; y += stepMinor) {
      const [, sy] = this.toS(0, y);
      g.strokeStyle = Math.round(y) % 5 === 0 ? '#e1e0d9' : '#efeee9';
      g.beginPath();
      g.moveTo(0, Math.round(sy) + 0.5);
      g.lineTo(w, Math.round(sy) + 0.5);
      g.stroke();
    }

    // オーバーレイ（日照時間マップ／現在の影）
    if (overlay) this.drawOverlay(overlay);

    // 障害物
    model.obstacles.forEach((o) => {
      const [ux, uy] = obstacleAxis(o);
      const c = obbCorners(o.x, o.y, ux, uy, o.w / 2, o.d / 2).map(([x, y]) => this.toS(x, y));
      const elevated = (o.z0 || 0) > 0.3;
      g.beginPath();
      c.forEach(([sx, sy], i) => (i ? g.lineTo(sx, sy) : g.moveTo(sx, sy)));
      g.closePath();
      g.fillStyle = elevated ? 'rgba(160,152,140,0.25)' : 'rgba(170,162,150,0.55)';
      g.fill();
      g.setLineDash(elevated ? [4, 3] : []);
      g.strokeStyle = '#8c857a';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
      const [sx, sy] = this.toS(o.x, o.y);
      this.label(`${o.name}（H${(o.z0 + o.h).toFixed(1)}m）`, sx, sy, INK.secondary);
    });

    // 建物（外壁）
    const W = geom.W;
    const D = geom.D;
    const [fx0, fy0] = this.toS(-W / 2, D / 2);
    g.fillStyle = '#efe7da';
    g.fillRect(fx0, fy0, W * sc, D * sc);

    // 室内床への日だまり（窓から差し込む直達光）
    if (instant?.sun) {
      g.save();
      g.beginPath();
      g.rect(fx0, fy0, W * sc, D * sc);
      g.clip();
      g.fillStyle = 'rgba(250, 176, 40, 0.55)';
      instant.win.forEach((r) => {
        for (const q of r.patches) {
          g.beginPath();
          q.forEach(([x, y], i) => {
            const [sx, sy] = this.toS(x, y);
            i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
          });
          g.closePath();
          g.fill();
        }
      });
      g.restore();
    }
    g.strokeStyle = '#334155';
    g.lineWidth = 2;
    g.strokeRect(fx0, fy0, W * sc, D * sc);

    // 屋根伏せ（破線）
    g.setLineDash([6, 4]);
    g.strokeStyle = '#64748b';
    g.lineWidth = 1;
    for (const [[ax, ay], [bx, by]] of geom.roofLines) {
      const [s1x, s1y] = this.toS(ax, ay);
      const [s2x, s2y] = this.toS(bx, by);
      g.beginPath();
      g.moveTo(s1x, s1y);
      g.lineTo(s2x, s2y);
      g.stroke();
    }
    g.setLineDash([]);

    // 窓
    geom.windows.forEach((wd, i) => {
      const f = wd.face;
      const p0 = this.toS(f.ox + f.ux * wd.s0, f.oy + f.uy * wd.s0);
      const p1 = this.toS(f.ox + f.ux * wd.s1, f.oy + f.uy * wd.s1);
      const r = instant?.win[i];
      g.lineCap = 'butt';
      g.strokeStyle = r && r.frac > 0 ? rgb(sunRamp(0.35 + r.frac * 0.65)) : '#94a3b8';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(...p0);
      g.lineTo(...p1);
      g.stroke();
      const mid = (wd.s0 + wd.s1) / 2;
      // 上階の窓番号は外側にずらして、同じ位置の下階の窓と重ならないようにする
      const off = 0.8 + (wd.win.floor - 1) * 0.75;
      const [lx, ly] = this.toS(f.ox + f.ux * mid + f.nx * off, f.oy + f.uy * mid + f.ny * off);
      g.fillStyle = seriesColor(i);
      g.beginPath();
      g.arc(lx, ly, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = 'bold 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), lx, ly + 0.5);
    });

    // 樹木
    const leafOff = isLeafOff(model.date, model.settings);
    geom.crowns.forEach((c) => {
      const [sx, sy] = this.toS(c.cx, c.cy);
      const rr = c.a * sc;
      g.beginPath();
      g.arc(sx, sy, rr, 0, Math.PI * 2);
      if (c.type === 'evergreen') g.fillStyle = 'rgba(61,122,58,0.40)';
      else g.fillStyle = leafOff ? 'rgba(143,111,80,0.12)' : 'rgba(115,169,79,0.40)';
      g.fill();
      g.setLineDash(c.type !== 'evergreen' && leafOff ? [4, 3] : []);
      g.strokeStyle = c.type === 'evergreen' ? '#2f5f2c' : leafOff ? '#8f6f50' : '#4e7d33';
      g.lineWidth = 1.5;
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#6b4a2f';
      g.beginPath();
      g.arc(sx, sy, Math.max(2, (c.trunkW / 2) * sc), 0, Math.PI * 2);
      g.fill();
      this.label(`${c.tree.name}（H${c.tree.height}m）`, sx, sy + rr + 9, INK.secondary);
    });

    // 太陽の方向
    if (instant?.sun) {
      const s = instant.sun.local;
      const len = Math.hypot(s.x, s.y);
      if (len > 1e-3) {
        const R = Math.min(w, h) / 2 - 22;
        const sx = w / 2 + (s.x / len) * R;
        const sy = h / 2 - (s.y / len) * R;
        g.fillStyle = '#ffb300';
        g.beginPath();
        g.arc(sx, sy, 9, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.stroke();
      }
    }

    this.drawNorth(model.site.rotation);
    this.drawScale();
    if (overlay?.kind === 'hours') this.drawLegend(overlay);
  }

  label(text, sx, sy, color) {
    const g = this.ctx;
    g.font = '11px "Yu Gothic UI", "Hiragino Sans", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(252,252,251,0.85)';
    g.fillRect(sx - tw / 2 - 3, sy - 8, tw + 6, 16);
    g.fillStyle = color;
    g.fillText(text, sx, sy);
  }

  drawOverlay(ov) {
    const g = this.ctx;
    if (!this._off) this._off = document.createElement('canvas');
    const off = this._off;
    if (off.width !== ov.nx || off.height !== ov.ny || off._src !== ov) {
      off.width = ov.nx;
      off.height = ov.ny;
      const oc = off.getContext('2d');
      const img = oc.createImageData(ov.nx, ov.ny);
      for (let j = 0; j < ov.ny; j++) {
        for (let i = 0; i < ov.nx; i++) {
          const idx = j * ov.nx + i;
          const p = ((ov.ny - 1 - j) * ov.nx + i) * 4;
          if (ov.mask[idx]) {
            img.data[p + 3] = 0;
            continue;
          }
          if (ov.kind === 'hours') {
            const c = sunRamp(ov.maxH > 0 ? ov.data[idx] / ov.maxH : 0);
            img.data[p] = c[0];
            img.data[p + 1] = c[1];
            img.data[p + 2] = c[2];
            img.data[p + 3] = 225;
          } else {
            const v = 1 - ov.data[idx];
            img.data[p] = 40;
            img.data[p + 1] = 52;
            img.data[p + 2] = 75;
            img.data[p + 3] = Math.round(v * 105);
          }
        }
      }
      oc.putImageData(img, 0, 0);
      off._src = ov;
    }
    const [sx, sy] = this.toS(ov.x0, ov.y0 + ov.ny * ov.cell);
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(off, sx, sy, ov.nx * ov.cell * this.view.scale, ov.ny * ov.cell * this.view.scale);
    g.restore();
  }

  drawNorth(rotation) {
    const g = this.ctx;
    const { w } = this.size;
    const cx = w - 34;
    const cy = 38;
    const f = rotation * RAD;
    const dx = -Math.sin(f);
    const dy = Math.cos(f);
    g.save();
    g.fillStyle = 'rgba(252,252,251,0.9)';
    g.beginPath();
    g.arc(cx, cy, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK.axis;
    g.lineWidth = 1;
    g.stroke();
    g.translate(cx, cy);
    g.rotate(Math.atan2(dx, dy));
    g.fillStyle = '#b42318';
    g.beginPath();
    g.moveTo(0, -18);
    g.lineTo(6, 6);
    g.lineTo(0, 2);
    g.lineTo(-6, 6);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#b42318';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('真北', cx, cy + 34);
  }

  drawScale() {
    const g = this.ctx;
    const { h } = this.size;
    const sc = this.view.scale;
    const len = sc > 30 ? 2 : sc > 10 ? 5 : 10;
    const x = 14;
    const y = h - 16;
    g.strokeStyle = INK.secondary;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x, y);
    g.lineTo(x + len * sc, y);
    g.lineTo(x + len * sc, y - 4);
    g.stroke();
    g.fillStyle = INK.secondary;
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${len} m`, x + len * sc + 6, y - 2);
  }

  drawLegend(ov) {
    const g = this.ctx;
    const { w, h } = this.size;
    const bw = 150;
    const x = w - bw - 16;
    const y = h - 40;
    g.fillStyle = 'rgba(252,252,251,0.92)';
    g.fillRect(x - 8, y - 18, bw + 16, 48);
    for (let i = 0; i < bw; i++) {
      g.fillStyle = rgb(sunRamp(i / (bw - 1)));
      g.fillRect(x + i, y, 1, 10);
    }
    g.fillStyle = INK.secondary;
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`日照時間（${ov.date}・高さ${ov.height.toFixed(1)}m）`, x - 2, y - 8);
    g.fillText('0h', x, y + 22);
    g.textAlign = 'right';
    g.fillText(`${ov.maxH.toFixed(1)}h`, x + bw, y + 22);
  }
}
