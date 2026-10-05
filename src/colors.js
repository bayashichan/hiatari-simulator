// 配色（系列色は色覚多様性に配慮した順序固定のカテゴリ配色）
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export const INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#fcfcfb',
};

/** 9色目以降は同じ色を繰り返さず、色＋番号ラベルで識別する（番号は常に併記） */
export const seriesColor = (i) => SERIES[i % SERIES.length];

// 日照量の連続値（単色相：薄い→濃いオレンジ）
const SUN_RAMP = [
  [255, 247, 236],
  [253, 214, 160],
  [245, 158, 72],
  [221, 98, 31],
  [150, 52, 12],
];

/** 0..1 → [r,g,b] */
export function sunRamp(v) {
  const x = Math.min(1, Math.max(0, v)) * (SUN_RAMP.length - 1);
  const i = Math.min(SUN_RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = SUN_RAMP[i];
  const b = SUN_RAMP[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
