// 太陽位置・日射量の計算
// 太陽位置は NOAA Solar Calculator の算法（誤差おおむね 0.01°程度）
// 日射量は建築環境工学で一般的な ブーゲの式（直達）＋ ベルラーゲの式（天空）

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 大気差（度）。見かけの高度を求めるための補正 */
function refraction(e) {
  if (e > 85) return 0;
  const te = Math.tan(e * RAD);
  let r;
  if (e > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (e > -0.575) r = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

function solarCore(utcMs) {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const dist = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnom * RAD));
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eot, dist, lambda: mod(lambda, 360) };
}

/**
 * 太陽位置
 * @param {number} utcMs UTC のミリ秒
 * @param {number} lat 緯度（北緯が正）
 * @param {number} lng 経度（東経が正）
 * @returns {{altitude:number, altTrue:number, azimuth:number, declination:number, eot:number, distance:number}}
 *  altitude: 見かけの太陽高度（度, 大気差補正あり） / azimuth: 方位角（真北0°, 東90°, 南180°, 西270°）
 */
export function sunPosition(utcMs, lat, lng) {
  const { decl, eot, dist } = solarCore(utcMs);
  const utcMin = mod(utcMs / 60000, 1440);
  const tst = mod(utcMin + eot + 4 * lng, 1440);
  const har = (tst / 4 - 180) * RAD;
  const latr = lat * RAD;
  const cosZ = clamp(
    Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(har),
    -1,
    1
  );
  const altTrue = 90 - Math.acos(cosZ) * DEG;
  const az = mod(
    Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) * DEG + 180,
    360
  );
  return {
    altitude: altTrue + refraction(altTrue),
    altTrue,
    azimuth: az,
    declination: decl * DEG,
    eot,
    distance: dist,
  };
}

/** 太陽方向の単位ベクトル（東, 北, 上） */
export function sunVector(altDeg, azDeg) {
  const a = altDeg * RAD;
  const z = azDeg * RAD;
  return { e: Math.cos(a) * Math.sin(z), n: Math.cos(a) * Math.cos(z), u: Math.sin(a) };
}

/** 'YYYY-MM-DD' + 現地時刻（分）+ 時差（時間）→ UTC ms */
export function localToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) + (minutes - tz * 60) * 60000;
}

/** UTC ms → 現地の 'YYYY-MM-DD' */
export function utcToLocalDate(utcMs, tz) {
  const d = new Date(utcMs + tz * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 日の出・日の入・南中（現地時刻の分）と南中高度 */
export function sunTimes(dateStr, lat, lng, tz) {
  const h = (min) => sunPosition(localToUtc(dateStr, min, tz), lat, lng).altTrue + 0.833;
  // 南中：時角0となる時刻（均時差は正午付近の値を使い、1回反復）
  let transit = 720 - 4 * lng - sunPosition(localToUtc(dateStr, 720, tz), lat, lng).eot + tz * 60;
  transit = 720 - 4 * lng - sunPosition(localToUtc(dateStr, transit, tz), lat, lng).eot + tz * 60;
  const transitAlt = sunPosition(localToUtc(dateStr, transit, tz), lat, lng).altitude;

  const bisect = (a, b) => {
    let fa = h(a);
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      const fm = h(m);
      if (Math.sign(fm) === Math.sign(fa)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  let sunrise = null;
  let sunset = null;
  const step = 10;
  let prev = h(transit - 720);
  for (let t = transit - 720 + step; t <= transit + 720; t += step) {
    const cur = h(t);
    if (prev <= 0 && cur > 0 && sunrise === null) sunrise = bisect(t - step, t);
    if (prev > 0 && cur <= 0 && t > transit) sunset = bisect(t - step, t);
    prev = cur;
  }
  const polar = sunrise === null && sunset === null ? (h(transit) > 0 ? 'day' : 'night') : null;
  return { sunrise, sunset, transit, transitAlt, polar };
}

/** 太陽の視黄経（度） */
export function solarLongitude(utcMs) {
  return solarCore(utcMs).lambda;
}

/**
 * 指定年の春分・夏至・秋分・冬至の現地日付
 * 太陽黄経が 0/90/180/270° となる瞬間を二分法で求める
 */
export function seasonalDates(year, tz) {
  const find = (target, m, dFrom, dTo) => {
    let a = Date.UTC(year, m - 1, dFrom);
    let b = Date.UTC(year, m - 1, dTo);
    const f = (t) => {
      let d = solarLongitude(t) - target;
      d = mod(d + 180, 360) - 180;
      return d;
    };
    for (let i = 0; i < 50; i++) {
      const mid = (a + b) / 2;
      if (f(mid) < 0) a = mid;
      else b = mid;
    }
    return utcToLocalDate((a + b) / 2, tz);
  };
  return {
    vernal: find(0, 3, 15, 25),
    summer: find(90, 6, 16, 26),
    autumnal: find(180, 9, 18, 28),
    winter: find(270, 12, 17, 27),
  };
}

/**
 * 晴天時の日射量 [W/m²]
 * @param {number} altDeg 太陽高度
 * @param {number} P 大気透過率（0.6〜0.8 程度。都市部で小さめ）
 * @param {number} distAU 太陽との距離（AU）
 * @returns {{dn:number, sky:number}} dn: 法線面直達日射量, sky: 水平面天空日射量
 */
export function clearSky(altDeg, P, distAU = 1) {
  if (altDeg <= 0) return { dn: 0, sky: 0 };
  const I0 = 1367 / (distAU * distAU);
  const sh = Math.sin(altDeg * RAD);
  // 大気路程（Kasten-Young）
  const m = 1 / (sh + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
  const pm = Math.pow(P, m);
  const dn = I0 * pm;
  const sky = (0.5 * I0 * sh * (1 - pm)) / (1 - 1.4 * Math.log(P));
  return { dn, sky: Math.max(0, sky) };
}

const DIR16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
/** 方位角 → 16方位名 */
export function dirName(az) {
  return DIR16[Math.round(mod(az, 360) / 22.5) % 16];
}

export function fmtTime(min) {
  if (min === null || min === undefined || !isFinite(min)) return '--:--';
  const m = Math.round(mod(min, 1440));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
