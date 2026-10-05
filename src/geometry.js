// モデル → 建物軸ローカル座標の三角形群（描画と日射判定で共用）
// ローカル座標: x=東(+), y=北(+), z=上(+)（いずれも建物軸。振れ角は描画/太陽ベクトル側で考慮）
import { eaveHeight, floorLevel } from './model.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 凸多角形を扇形に三角形分割して追加 */
function poly(arr, pts) {
  for (let i = 1; i < pts.length - 1; i++) arr.push(...pts[0], ...pts[i], ...pts[i + 1]);
}

/** (b,z) 断面を a 方向に押し出す。caps は端面を凸多角形に分けたインデックス列 */
function extrude(arr, prof, caps, a0, a1, P) {
  const m = prof.length;
  for (let i = 0; i < m; i++) {
    const [b1, z1] = prof[i];
    const [b2, z2] = prof[(i + 1) % m];
    poly(arr, [P(a0, b1, z1), P(a0, b2, z2), P(a1, b2, z2), P(a1, b1, z1)]);
  }
  for (const c of caps) {
    poly(arr, c.map((i) => P(a0, prof[i][0], prof[i][1])));
    poly(arr, c.map((i) => P(a1, prof[i][0], prof[i][1])).reverse());
  }
}

/** 平面で回転した直方体。u=(ux,uy) 方向に半幅 hu、その直交方向に半幅 hv */
export function obbCorners(cx, cy, ux, uy, hu, hv) {
  const vx = -uy;
  const vy = ux;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [cx + ux * hu * a + vx * hv * b, cy + uy * hu * a + vy * hv * b]);
}

function addOBB(arr, cx, cy, ux, uy, hu, hv, z0, z1) {
  const c = obbCorners(cx, cy, ux, uy, hu, hv);
  const bot = c.map(([x, y]) => [x, y, z0]);
  const top = c.map(([x, y]) => [x, y, z1]);
  poly(arr, [...bot].reverse());
  poly(arr, top);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    poly(arr, [bot[i], bot[j], top[j], top[i]]);
  }
}

/** 障害物の回転（時計回り度）→ 平面の単位ベクトル */
export function obstacleAxis(o) {
  const r = ((o.rot || 0) * Math.PI) / 180;
  return [Math.cos(r), -Math.sin(r)];
}

/**
 * 各外壁面の定義。外から壁を見たときの左下（地面）を原点、右向きを u、外向き法線を n とする。
 * baseAz は振れ角 0° のときの面の方位。
 */
export function faceDefs(W, D) {
  return {
    S: { key: 'S', ox: -W / 2, oy: -D / 2, ux: 1, uy: 0, nx: 0, ny: -1, len: W, baseAz: 180 },
    E: { key: 'E', ox: W / 2, oy: -D / 2, ux: 0, uy: 1, nx: 1, ny: 0, len: D, baseAz: 90 },
    N: { key: 'N', ox: W / 2, oy: D / 2, ux: -1, uy: 0, nx: 0, ny: 1, len: W, baseAz: 0 },
    W: { key: 'W', ox: -W / 2, oy: D / 2, ux: 0, uy: -1, nx: -1, ny: 0, len: D, baseAz: 270 },
  };
}

export const FACE_ORDER = ['S', 'E', 'N', 'W'];

function finalizePart(kind, arr, extra = {}) {
  const tris = new Float32Array(arr);
  const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      aabb[k] = Math.min(aabb[k], tris[i + k]);
      aabb[k + 3] = Math.max(aabb[k + 3], tris[i + k]);
    }
  }
  return { kind, tris, aabb, ...extra };
}

export function buildGeometry(model) {
  const b = model.building;
  const r = model.roof;
  const W = Math.max(1, b.width);
  const D = Math.max(1, b.depth);
  const H = eaveHeight(b);
  const p = Math.max(0, r.pitch) / 10;
  const n = Math.max(0, r.eave);
  const k = Math.max(0, r.verge);
  const t = Math.max(0.02, r.thickness);

  const body = [];
  const roof = [];
  const roofLines = []; // 配置図用の屋根伏せ線 [[x1,y1],[x2,y2]]
  let ridgeH = H + t;
  let wallTop = () => H; // 壁上端高さ（窓の範囲チェック用）

  const rect = (P, a0, a1, b0, b1) => {
    const c = [P(a0, b0, 0), P(a1, b0, 0), P(a1, b1, 0), P(a0, b1, 0)].map((q) => [q[0], q[1]]);
    for (let i = 0; i < 4; i++) roofLines.push([c[i], c[(i + 1) % 4]]);
  };
  const line = (P, a0, b0, a1, b1) => {
    const q0 = P(a0, b0, 0);
    const q1 = P(a1, b1, 0);
    roofLines.push([
      [q0[0], q0[1]],
      [q1[0], q1[1]],
    ]);
  };

  if (r.type === 'gable') {
    const alongX = r.ridge !== 'y';
    const A = alongX ? W : D;
    const B = alongX ? D : W;
    const P = alongX ? (a, bb, z) => [a, bb, z] : (a, bb, z) => [bb, a, z];
    const zr = H + (p * B) / 2;
    ridgeH = zr + t;
    extrude(body, [[-B / 2, 0], [B / 2, 0], [B / 2, H], [0, zr], [-B / 2, H]], [[0, 1, 2, 3, 4]], -A / 2, A / 2, P);
    const rb = B / 2 + n;
    const ze = H - p * n;
    extrude(
      roof,
      [[-rb, ze], [0, zr], [rb, ze], [rb, ze + t], [0, zr + t], [-rb, ze + t]],
      [[0, 1, 4, 5], [1, 2, 3, 4]],
      -A / 2 - k,
      A / 2 + k,
      P
    );
    rect(P, -A / 2 - k, A / 2 + k, -rb, rb);
    line(P, -A / 2 - k, 0, A / 2 + k, 0);
    wallTop = (x, y) => H + p * Math.max(0, B / 2 - Math.abs(alongX ? y : x));
  } else if (r.type === 'hip') {
    const alongX = W >= D;
    const L = alongX ? W : D;
    const S = alongX ? D : W;
    const P = alongX ? (a, bb, z) => [a, bb, z] : (a, bb, z) => [bb, a, z];
    extrude(body, [[-S / 2, 0], [S / 2, 0], [S / 2, H], [-S / 2, H]], [[0, 1, 2, 3]], -L / 2, L / 2, P);
    const ea = L / 2 + n;
    const eb = S / 2 + n;
    const ze = H - p * n;
    const ra = L / 2 - S / 2;
    const zr = H + (p * S) / 2;
    ridgeH = zr + t;
    const layer = (dz) => ({
      c1: P(-ea, -eb, ze + dz),
      c2: P(ea, -eb, ze + dz),
      c3: P(ea, eb, ze + dz),
      c4: P(-ea, eb, ze + dz),
      r1: P(-ra, 0, zr + dz),
      r2: P(ra, 0, zr + dz),
    });
    const lo = layer(0);
    const hi = layer(t);
    const faces = [
      ['c1', 'c2', 'r2', 'r1'],
      ['c2', 'c3', 'r2'],
      ['c3', 'c4', 'r1', 'r2'],
      ['c4', 'c1', 'r1'],
    ];
    for (const f of faces) {
      poly(roof, f.map((key) => hi[key]));
      poly(roof, f.map((key) => lo[key]).reverse());
    }
    const per = ['c1', 'c2', 'c3', 'c4'];
    for (let i = 0; i < 4; i++) {
      const a = per[i];
      const c = per[(i + 1) % 4];
      poly(roof, [lo[a], lo[c], hi[c], hi[a]]);
    }
    rect(P, -ea, ea, -eb, eb);
    line(P, -ra, 0, ra, 0);
    line(P, -ea, -eb, -ra, 0);
    line(P, ea, -eb, ra, 0);
    line(P, ea, eb, ra, 0);
    line(P, -ea, eb, -ra, 0);
  } else if (r.type === 'shed') {
    const f = r.shedDown || 'S';
    const alongX = f === 'S' || f === 'N';
    const A = alongX ? W : D;
    const B = alongX ? D : W;
    const maps = {
      S: (a, bb, z) => [a, bb, z],
      N: (a, bb, z) => [a, -bb, z],
      E: (a, bb, z) => [-bb, a, z],
      W: (a, bb, z) => [bb, a, z],
    };
    const P = maps[f] || maps.S;
    const zh = H + p * B;
    ridgeH = zh + t;
    extrude(body, [[-B / 2, 0], [B / 2, 0], [B / 2, zh], [-B / 2, H]], [[0, 1, 2, 3]], -A / 2, A / 2, P);
    const zl = H - p * n;
    const zt = H + p * (B + n);
    extrude(roof, [[-B / 2 - n, zl], [B / 2 + n, zt], [B / 2 + n, zt + t], [-B / 2 - n, zl + t]], [[0, 1, 2, 3]], -A / 2 - k, A / 2 + k, P);
    rect(P, -A / 2 - k, A / 2 + k, -B / 2 - n, B / 2 + n);
    // 最上部（棟側）の線を区別できるよう少し内側に補助線
    line(P, -A / 2 - k, B / 2, A / 2 + k, B / 2);
    const bOf = { S: (x, y) => y, N: (x, y) => -y, E: (x) => -x, W: (x) => x }[f];
    wallTop = (x, y) => H + p * clamp(bOf(x, y) + B / 2, 0, B);
  } else {
    // 陸屋根
    const P = (a, bb, z) => [a, bb, z];
    extrude(body, [[-D / 2, 0], [D / 2, 0], [D / 2, H], [-D / 2, H]], [[0, 1, 2, 3]], -W / 2, W / 2, P);
    addOBB(roof, 0, 0, 1, 0, W / 2 + n, D / 2 + n, H, H + t);
    rect(P, -W / 2 - n, W / 2 + n, -D / 2 - n, D / 2 + n);
    ridgeH = H + t;
  }

  const parts = [finalizePart('body', body), finalizePart('roof', roof)];

  // 窓・庇
  const F = faceDefs(W, D);
  const windows = model.windows.map((w, index) => {
    const f = F[w.face] || F.S;
    const fl = floorLevel(b, clamp(Math.round(w.floor) || 1, 1, 10));
    const z0 = fl + Math.max(0, w.sill);
    const z1 = z0 + Math.max(0.05, w.height);
    const width = Math.max(0.05, w.width);
    const s0 = w.offset;
    const s1 = w.offset + width;
    const pt = (s, z, out = 0) => [f.ox + f.ux * s + f.nx * out, f.oy + f.uy * s + f.ny * out, z];
    const nu = clamp(Math.ceil(width / 0.3), 3, 8);
    const nz = clamp(Math.ceil((z1 - z0) / 0.3), 3, 8);
    const samples = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nz; j++) {
        const s = s0 + ((i + 0.5) / nu) * width;
        const z = z0 + ((j + 0.5) / nz) * (z1 - z0);
        const q = pt(s, z, 0.02);
        samples.push({ x: q[0], y: q[1], z, s });
      }
    }
    const warns = [];
    if (s0 < -1e-6 || s1 > f.len + 1e-6) warns.push('窓が壁の幅からはみ出しています');
    const top0 = pt(s0, 0);
    const top1 = pt(s1, 0);
    if (z1 > Math.min(wallTop(top0[0], top0[1]), wallTop(top1[0], top1[1])) + 1e-6) warns.push('窓上端が壁の上端（軒）を超えています');
    if (w.hood > 0) {
      const ext = 0.15;
      const hs0 = s0 - ext;
      const hs1 = s1 + ext;
      const c = pt((hs0 + hs1) / 2, 0, w.hood / 2);
      const hz = z1 + Math.max(0, w.hoodGap ?? 0.15);
      const arr = [];
      addOBB(arr, c[0], c[1], f.ux, f.uy, (hs1 - hs0) / 2, w.hood / 2, hz, hz + 0.06);
      parts.push(finalizePart('hood', arr, { windowIndex: index }));
    }
    return {
      index,
      win: w,
      face: f,
      fl,
      z0,
      z1,
      s0,
      s1,
      area: width * (z1 - z0),
      samples,
      nu,
      nz,
      corners: [pt(s0, z0, 0.012), pt(s1, z0, 0.012), pt(s1, z1, 0.012), pt(s0, z1, 0.012)],
      center: pt((s0 + s1) / 2, (z0 + z1) / 2, 0.012),
      warns,
    };
  });

  // 障害物（隣家・塀・バルコニー等）
  model.obstacles.forEach((o, index) => {
    const [ux, uy] = obstacleAxis(o);
    const arr = [];
    addOBB(arr, o.x, o.y, ux, uy, Math.max(0.01, o.w) / 2, Math.max(0.01, o.d) / 2, o.z0 || 0, (o.z0 || 0) + Math.max(0.01, o.h));
    parts.push(finalizePart('obstacle', arr, { index, obstacle: o }));
  });

  // 樹木（幹は直方体、樹冠は楕円体）
  const crowns = [];
  model.trees.forEach((tr, index) => {
    const h = Math.max(0.5, tr.height);
    const base = clamp(tr.crownBase, 0, h - 0.2);
    const d = clamp(tr.crown * 0.07, 0.12, 0.5);
    const arr = [];
    addOBB(arr, tr.x, tr.y, 1, 0, d / 2, d / 2, 0, base + (h - base) * 0.35);
    parts.push(finalizePart('trunk', arr, { index }));
    crowns.push({
      index,
      tree: tr,
      type: tr.type,
      cx: tr.x,
      cy: tr.y,
      cz: (base + h) / 2,
      a: Math.max(0.1, tr.crown / 2),
      c: Math.max(0.1, (h - base) / 2),
      trunkW: d,
      trunkH: base + (h - base) * 0.35,
    });
  });

  // 配置図の表示範囲
  const pts = [
    [-W / 2 - k - n, -D / 2 - n - k],
    [W / 2 + k + n, D / 2 + n + k],
  ];
  for (const o of model.obstacles) {
    const [ux, uy] = obstacleAxis(o);
    pts.push(...obbCorners(o.x, o.y, ux, uy, o.w / 2, o.d / 2));
  }
  for (const c of crowns) pts.push([c.cx - c.a, c.cy - c.a], [c.cx + c.a, c.cy + c.a]);
  const bounds = {
    minX: Math.min(...pts.map((q) => q[0])),
    maxX: Math.max(...pts.map((q) => q[0])),
    minY: Math.min(...pts.map((q) => q[1])),
    maxY: Math.max(...pts.map((q) => q[1])),
  };

  return { W, D, H, ridgeH, parts, windows, crowns, roofLines, bounds, faces: F };
}
