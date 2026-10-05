// 入力データ（モデル）の既定値・保存・読込
import { seasonalDates } from './sun.js';

const STORAGE_KEY = 'hiatari-sim:model:v1';

let seq = 0;
export const newId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 座標系（建物軸）
 *  x: 建物の幅方向（南面を外から見て右＝東が +）
 *  y: 建物の奥行方向（北が +）
 *  原点は建物の中心。振れ角 0° のとき x=真東, y=真北。
 *  振れ角 rotation（度, 時計回り＝西へ振れると +）だけ全体が回転する。
 */
export function defaultModel() {
  const year = new Date().getFullYear();
  const tz = 9;
  return {
    version: 1,
    site: {
      name: '東京駅付近（サンプル）',
      lat: 35.681236,
      lng: 139.767125,
      tz,
      rotation: 0,
    },
    date: seasonalDates(year, tz).winter,
    minutes: 12 * 60,
    building: {
      width: 9.1, // 東西方向（建物軸 x）
      depth: 7.28, // 南北方向（建物軸 y）
      floors: 2,
      baseHeight: 0.5, // 基礎高 GL→1FL
      storyHeight: 2.9, // 階高
    },
    roof: {
      type: 'gable', // gable 切妻 / hip 寄棟 / shed 片流れ / flat 陸屋根
      ridge: 'x', // 切妻の棟方向 x: 東西（南面と平行）, y: 南北
      shedDown: 'S', // 片流れの下がる側の面
      pitch: 4, // 寸勾配
      eave: 0.6, // 軒の出
      verge: 0.45, // ケラバの出
      thickness: 0.25, // 屋根の厚み（鼻隠し）
    },
    windows: [
      { id: newId('w'), name: '1F LDK 掃出し', face: 'S', floor: 1, offset: 0.9, width: 2.6, height: 2.0, sill: 0, hood: 0, hoodGap: 0.15 },
      { id: newId('w'), name: '1F 和室 掃出し', face: 'S', floor: 1, offset: 5.2, width: 1.69, height: 2.0, sill: 0, hood: 0.6, hoodGap: 0.15 },
      { id: newId('w'), name: '2F 主寝室 掃出し', face: 'S', floor: 2, offset: 0.9, width: 1.69, height: 2.0, sill: 0, hood: 0, hoodGap: 0.15 },
      { id: newId('w'), name: '2F 子供室 腰窓', face: 'S', floor: 2, offset: 5.6, width: 1.69, height: 1.1, sill: 0.9, hood: 0, hoodGap: 0.15 },
      { id: newId('w'), name: '1F キッチン 腰窓', face: 'E', floor: 1, offset: 1.5, width: 1.2, height: 1.1, sill: 1.0, hood: 0, hoodGap: 0.15 },
      { id: newId('w'), name: '2F 西 小窓', face: 'W', floor: 2, offset: 3.0, width: 0.8, height: 0.9, sill: 1.1, hood: 0, hoodGap: 0.15 },
      { id: newId('w'), name: '1F 北 腰窓', face: 'N', floor: 1, offset: 2.0, width: 1.2, height: 1.1, sill: 0.9, hood: 0, hoodGap: 0.15 },
    ],
    trees: [
      { id: newId('t'), name: '落葉樹（ケヤキ等）', type: 'deciduous', x: 3.0, y: -8.0, height: 6, crown: 4, crownBase: 2.2 },
      { id: newId('t'), name: '常緑樹（シマトネリコ等）', type: 'evergreen', x: -7.0, y: -3.0, height: 4, crown: 2.4, crownBase: 1.4 },
    ],
    obstacles: [
      { id: newId('o'), name: '2F バルコニー', x: -2.3, y: -4.095, w: 3.6, d: 0.91, z0: 3.25, h: 1.25, rot: 0 },
      { id: newId('o'), name: '南側隣家', x: 0, y: -15.5, w: 9.0, d: 7.0, z0: 0, h: 6.5, rot: 0 },
      { id: newId('o'), name: '東側隣家', x: 13.5, y: 1.0, w: 7.0, d: 8.0, z0: 0, h: 7.0, rot: 0 },
    ],
    settings: {
      P: 0.7, // 大気透過率
      eta: 0.6, // ガラスの日射熱取得率 η
      rho: 0.1, // 地面の日射反射率（アルベド）
      step: 10, // 計算間隔（分）
      leafOffFrom: 12, // 落葉期 開始月
      leafOffTo: 3, // 落葉期 終了月
      transEvergreen: 0.1, // 常緑樹の日射透過率
      transLeafOn: 0.2, // 落葉樹（着葉期）
      transLeafOff: 0.7, // 落葉樹（落葉期）
      gridSize: 0.5, // 日照時間マップの格子間隔
      gridHeight: 0, // 日照時間マップの測定面高さ
      gridMargin: 10, // 建物からの計算範囲
      showLabels: true,
    },
  };
}

/** 古い保存データや不完全な JSON を既定値で補完する */
export function normalizeModel(m) {
  const d = defaultModel();
  if (!m || typeof m !== 'object') return d;
  const out = {
    ...d,
    ...m,
    site: { ...d.site, ...(m.site || {}) },
    building: { ...d.building, ...(m.building || {}) },
    roof: { ...d.roof, ...(m.roof || {}) },
    settings: { ...d.settings, ...(m.settings || {}) },
  };
  out.windows = Array.isArray(m.windows) ? m.windows.map((w) => ({ id: newId('w'), hoodGap: 0.15, hood: 0, ...w })) : d.windows;
  out.trees = Array.isArray(m.trees) ? m.trees.map((t) => ({ id: newId('t'), ...t })) : d.trees;
  out.obstacles = Array.isArray(m.obstacles) ? m.obstacles.map((o) => ({ id: newId('o'), rot: 0, z0: 0, ...o })) : d.obstacles;
  return out;
}

export function loadModel() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return normalizeModel(JSON.parse(s));
  } catch {
    /* 保存データが読めない場合は既定値 */
  }
  return defaultModel();
}

export function saveModel(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    /* プライベートモード等では保存しない */
  }
}

/** 落葉期か（月の範囲は年をまたいでもよい） */
export function isLeafOff(dateStr, s) {
  const m = Number(dateStr.slice(5, 7));
  const a = s.leafOffFrom;
  const b = s.leafOffTo;
  return a <= b ? m >= a && m <= b : m >= a || m <= b;
}

/** 1FL からの各階の床高（GL 基準） */
export function floorLevel(b, floor) {
  return b.baseHeight + (floor - 1) * b.storyHeight;
}

/** 軒高（GL→壁上端） */
export function eaveHeight(b) {
  return b.baseHeight + b.floors * b.storyHeight;
}
