// 日照・日射の解析（建物軸ローカル座標でのレイキャスト）
import { sunPosition, sunVector, clearSky, localToUtc, sunTimes, RAD } from './sun.js';
import { isLeafOff } from './model.js';
import { obstacleAxis, obbCorners } from './geometry.js';

/** 世界座標の太陽ベクトル → 建物軸ローカル（振れ角の分だけ逆回転） */
export function sunLocal(alt, az, rotation) {
  const s = sunVector(alt, az);
  const f = rotation * RAD;
  return {
    x: s.e * Math.cos(f) - s.n * Math.sin(f),
    y: s.e * Math.sin(f) + s.n * Math.cos(f),
    z: s.u,
  };
}

export function makeOccluders(geom, settings, leafOff) {
  return {
    solids: geom.parts,
    crowns: geom.crowns.map((c) => ({
      ...c,
      trans: c.type === 'evergreen' ? settings.transEvergreen : leafOff ? settings.transLeafOff : settings.transLeafOn,
    })),
  };
}

function hitTris(t, ox, oy, oz, dx, dy, dz) {
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i];
    const ay = t[i + 1];
    const az = t[i + 2];
    const e1x = t[i + 3] - ax;
    const e1y = t[i + 4] - ay;
    const e1z = t[i + 5] - az;
    const e2x = t[i + 6] - ax;
    const e2y = t[i + 7] - ay;
    const e2z = t[i + 8] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-4) return true;
  }
  return false;
}

/**
 * 点 o から太陽方向 d へのレイの日射透過率（0=完全に遮蔽, 1=遮るものなし）
 * 建物・障害物・幹は不透明、樹冠は設定の透過率を掛け合わせる
 */
export function transmit(occ, ox, oy, oz, dx, dy, dz) {
  const ix = 1 / (Math.abs(dx) < 1e-12 ? 1e-12 : dx);
  const iy = 1 / (Math.abs(dy) < 1e-12 ? 1e-12 : dy);
  const iz = 1 / (Math.abs(dz) < 1e-12 ? 1e-12 : dz);
  for (const s of occ.solids) {
    const b = s.aabb;
    let t1 = (b[0] - ox) * ix;
    let t2 = (b[3] - ox) * ix;
    let tmin = Math.min(t1, t2);
    let tmax = Math.max(t1, t2);
    t1 = (b[1] - oy) * iy;
    t2 = (b[4] - oy) * iy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (b[2] - oz) * iz;
    t2 = (b[5] - oz) * iz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < Math.max(tmin, 0)) continue;
    if (hitTris(s.tris, ox, oy, oz, dx, dy, dz)) return 0;
  }
  let tr = 1;
  for (const c of occ.crowns) {
    const k = c.a / c.c;
    const px = ox - c.cx;
    const py = oy - c.cy;
    const pz = (oz - c.cz) * k;
    const qz = dz * k;
    const A = dx * dx + dy * dy + qz * qz;
    const B = 2 * (px * dx + py * dy + pz * qz);
    const C = px * px + py * py + pz * pz - c.a * c.a;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) continue;
    if ((-B + Math.sqrt(disc)) / (2 * A) <= 0) continue;
    tr *= c.trans;
    if (tr < 1e-4) return 0;
  }
  return tr;
}

/** 1つの窓の日当たり率（窓面積のうち直達日射が当たる割合, 樹冠透過を含む） */
function windowLit(occ, w, s, keepFlags = false) {
  const f = w.face;
  const cos = s.x * f.nx + s.y * f.ny; // 窓面への入射角の余弦（鉛直面）
  if (s.z <= 0 || cos <= 1e-3) return { facing: false, cos: Math.max(0, cos), frac: 0, flags: null };
  let sum = 0;
  const flags = keepFlags ? new Float32Array(w.samples.length) : null;
  for (let i = 0; i < w.samples.length; i++) {
    const q = w.samples[i];
    const tr = transmit(occ, q.x, q.y, q.z, s.x, s.y, s.z);
    sum += tr;
    if (flags) flags[i] = tr;
  }
  return { facing: true, cos, frac: sum / w.samples.length, flags };
}

/** 1日分の解析。keepSeries=true で時刻ごとの系列も返す */
export function analyzeDate(model, geom, dateStr, step, keepSeries = true) {
  const { site, settings: st } = model;
  const occ = makeOccluders(geom, st, isLeafOff(dateStr, st));
  const nSteps = Math.round(1440 / step);
  const dtH = step / 60;
  const times = [];
  const sun = [];
  const win = geom.windows.map(() => ({
    frac: keepSeries ? new Float32Array(nSteps) : null,
    facing: keepSeries ? new Uint8Array(nSteps) : null,
    irr: keepSeries ? new Float32Array(nSteps) : null,
    sunH: 0,
    effH: 0,
    directWh: 0,
    totalWh: 0,
    gainWh: 0,
  }));
  for (let i = 0; i < nSteps; i++) {
    const m = i * step + step / 2;
    times.push(m);
    const pos = sunPosition(localToUtc(dateStr, m, site.tz), site.lat, site.lng);
    if (pos.altitude <= 0) {
      sun.push(null);
      continue;
    }
    const irr = clearSky(pos.altitude, st.P, pos.distance);
    sun.push({ alt: pos.altitude, az: pos.azimuth, ...irr });
    const s = sunLocal(pos.altitude, pos.azimuth, site.rotation);
    const diffuse = irr.sky * 0.5; // 鉛直面の天空日射（形態係数 0.5）
    const refl = st.rho * (irr.dn * s.z + irr.sky) * 0.5; // 地面反射
    geom.windows.forEach((w, wi) => {
      const r = windowLit(occ, w, s);
      const o = win[wi];
      const direct = irr.dn * r.cos * r.frac;
      if (keepSeries) {
        o.frac[i] = r.frac;
        o.facing[i] = r.facing ? 1 : 0;
        o.irr[i] = direct;
      }
      if (r.frac > 0.02) o.sunH += dtH;
      o.effH += r.frac * dtH;
      o.directWh += direct * w.area * dtH;
      o.totalWh += (direct + diffuse + refl) * w.area * dtH;
    });
  }
  for (const o of win) o.gainWh = o.totalWh * st.eta;
  return { date: dateStr, step, times, sun, win };
}

export function analyzeDay(model, geom) {
  const res = analyzeDate(model, geom, model.date, model.settings.step, true);
  res.sunTimes = sunTimes(model.date, model.site.lat, model.site.lng, model.site.tz);
  return res;
}

/** 各月21日の日射熱取得・有効日照時間 */
export function analyzeYear(model, geom) {
  const year = Number(model.date.slice(0, 4));
  const step = Math.max(20, model.settings.step);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const date = `${year}-${String(m).padStart(2, '0')}-21`;
    months.push({ month: m, date, res: analyzeDate(model, geom, date, step, false) });
  }
  return {
    year,
    months,
    win: geom.windows.map((_, wi) => ({
      gainKWh: months.map((x) => x.res.win[wi].gainWh / 1000),
      effH: months.map((x) => x.res.win[wi].effH),
    })),
  };
}

/** 現在時刻の解析（窓ごとの日当たり率と、室内床面への日だまり形状） */
export function analyzeInstant(model, geom) {
  const { site, settings: st } = model;
  const pos = sunPosition(localToUtc(model.date, model.minutes, site.tz), site.lat, site.lng);
  const out = { pos, sun: null, win: [] };
  if (pos.altitude <= 0) {
    out.win = geom.windows.map(() => ({ facing: false, frac: 0, depth: 0, patches: [] }));
    return out;
  }
  const irr = clearSky(pos.altitude, st.P, pos.distance);
  const s = sunLocal(pos.altitude, pos.azimuth, site.rotation);
  out.sun = { ...irr, local: s };
  const occ = makeOccluders(geom, st, isLeafOff(model.date, st));
  out.win = geom.windows.map((w) => {
    const r = windowLit(occ, w, s, true);
    const res = { facing: r.facing, frac: r.frac, cos: r.cos, irr: irr.dn * r.cos * r.frac, depth: 0, patches: [] };
    if (!r.facing || r.frac <= 0) return res;
    const f = w.face;
    const ds = (w.s1 - w.s0) / w.nu / 2;
    const dz = (w.z1 - w.z0) / w.nz / 2;
    w.samples.forEach((q, i) => {
      if (r.flags[i] < 0.5) return;
      const quad = [
        [q.s - ds, q.z - dz],
        [q.s + ds, q.z - dz],
        [q.s + ds, q.z + dz],
        [q.s - ds, q.z + dz],
      ].map(([ss, zz]) => {
        const k = Math.max(0, zz - w.fl) / s.z;
        const x = f.ox + f.ux * ss - s.x * k;
        const y = f.oy + f.uy * ss - s.y * k;
        return [x, y];
      });
      for (const [x, y] of quad) {
        const depth = -((x - f.ox) * f.nx + (y - f.oy) * f.ny);
        if (depth > res.depth) res.depth = depth;
      }
      res.patches.push(quad);
    });
    return res;
  });
  return out;
}

/** 格子点が建物内・地上の障害物内か */
function gridMask(model, geom, x, y, z) {
  if (Math.abs(x) <= geom.W / 2 && Math.abs(y) <= geom.D / 2) return true;
  for (const o of model.obstacles) {
    if (!((o.z0 || 0) <= z && z <= (o.z0 || 0) + o.h)) continue;
    const [ux, uy] = obstacleAxis(o);
    const dx = x - o.x;
    const dy = y - o.y;
    const a = dx * ux + dy * uy;
    const b = -dx * uy + dy * ux;
    if (Math.abs(a) <= o.w / 2 && Math.abs(b) <= o.d / 2) return true;
  }
  return false;
}

function gridSpec(model, geom, cellWanted) {
  const st = model.settings;
  const mg = Math.max(1, st.gridMargin);
  const minX = -geom.W / 2 - mg;
  const maxX = geom.W / 2 + mg;
  const minY = -geom.D / 2 - mg;
  const maxY = geom.D / 2 + mg;
  let cell = Math.max(0.1, cellWanted);
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > 60000) cell *= 1.25;
  const nx = Math.ceil((maxX - minX) / cell);
  const ny = Math.ceil((maxY - minY) / cell);
  return { x0: minX, y0: minY, cell, nx, ny };
}

/** 現在時刻の影（配置図用の格子, 値=透過率） */
export function shadowGrid(model, geom, instant) {
  if (!instant.sun) return null;
  const s = instant.sun.local;
  const spec = gridSpec(model, geom, 0.3);
  const z = Math.max(0.02, model.settings.gridHeight);
  const occ = makeOccluders(geom, model.settings, isLeafOff(model.date, model.settings));
  const data = new Float32Array(spec.nx * spec.ny);
  const mask = new Uint8Array(spec.nx * spec.ny);
  for (let j = 0; j < spec.ny; j++) {
    const y = spec.y0 + (j + 0.5) * spec.cell;
    for (let i = 0; i < spec.nx; i++) {
      const x = spec.x0 + (i + 0.5) * spec.cell;
      const idx = j * spec.nx + i;
      if (gridMask(model, geom, x, y, z)) {
        mask[idx] = 1;
        continue;
      }
      data[idx] = transmit(occ, x, y, z, s.x, s.y, s.z);
    }
  }
  return { ...spec, data, mask, kind: 'shadow' };
}

/**
 * 1日の日照時間マップ（等時間日影図に相当）。重いので分割実行し進捗を返す
 * @returns {Promise<object|null>} 中断されたら null
 */
export async function sunHoursGrid(model, geom, onProgress, isCancelled) {
  const st = model.settings;
  const spec = gridSpec(model, geom, st.gridSize);
  const z = Math.max(0.02, st.gridHeight);
  const occ = makeOccluders(geom, st, isLeafOff(model.date, st));
  const step = Math.max(10, st.step);
  const suns = [];
  for (let m = step / 2; m < 1440; m += step) {
    const pos = sunPosition(localToUtc(model.date, m, model.site.tz), model.site.lat, model.site.lng);
    if (pos.altitude > 0) suns.push(sunLocal(pos.altitude, pos.azimuth, model.site.rotation));
  }
  const dtH = step / 60;
  const data = new Float32Array(spec.nx * spec.ny);
  const mask = new Uint8Array(spec.nx * spec.ny);
  let last = performance.now();
  for (let j = 0; j < spec.ny; j++) {
    const y = spec.y0 + (j + 0.5) * spec.cell;
    for (let i = 0; i < spec.nx; i++) {
      const x = spec.x0 + (i + 0.5) * spec.cell;
      const idx = j * spec.nx + i;
      if (gridMask(model, geom, x, y, z)) {
        mask[idx] = 1;
        continue;
      }
      let h = 0;
      for (const s of suns) h += transmit(occ, x, y, z, s.x, s.y, s.z) * dtH;
      data[idx] = h;
    }
    if (performance.now() - last > 30) {
      onProgress?.((j + 1) / spec.ny);
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled?.()) return null;
      last = performance.now();
    }
  }
  onProgress?.(1);
  return { ...spec, data, mask, kind: 'hours', maxH: suns.length * dtH, date: model.date, height: z };
}

export { obbCorners };
