// サイドバーの入力フォーム
import { dirName } from './sun.js';
import { newId, eaveHeight, defaultModel, normalizeModel } from './model.js';
import { FACE_ORDER } from './geometry.js';
import { seriesColor } from './colors.js';
import { SiteMap, parseLatLng, geocodeAddress } from './sitemap.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const FACE_NAME = { S: '南面', E: '東面', N: '北面', W: '西面' };
const ROOF_TYPES = [
  ['gable', '切妻'],
  ['hip', '寄棟'],
  ['shed', '片流れ'],
  ['flat', '陸屋根（フラット）'],
];

export function faceAz(face, rotation) {
  const base = { S: 180, E: 90, N: 0, W: 270 }[face];
  return (((base + rotation) % 360) + 360) % 360;
}

export function faceLabel(face, rotation) {
  const az = faceAz(face, rotation);
  return `${FACE_NAME[face]}（${dirName(az)}向き ${Math.round(az)}°）`;
}

export class Sidebar {
  /**
   * @param {HTMLElement} root
   * @param {{getModel:()=>object, setModel:(m:object)=>void, change:(kind:string)=>void}} app
   */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.bound = []; // [input, getter] 値の同期用
    this.render();
  }

  get model() {
    return this.app.getModel();
  }

  /** 数値入力 */
  num(label, obj, key, { step = 0.01, min, max, unit = 'm', kind = 'geometry', hint, onSet } = {}) {
    const input = h('input', { type: 'number', step, min, max, value: obj[key], inputmode: 'decimal' });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      if (min !== undefined && v < min) return;
      if (max !== undefined && v > max) return;
      obj[key] = v;
      onSet?.(v);
      this.app.change(kind);
    });
    this.bound.push([input, () => obj[key]]);
    return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('span', { class: 'inp' }, input, unit ? h('em', {}, unit) : null), hint ? h('small', { class: 'hint' }, hint) : null);
  }

  text(label, obj, key, { onSet } = {}) {
    const input = h('input', { type: 'text', value: obj[key] ?? '' });
    input.addEventListener('input', () => {
      obj[key] = input.value;
      onSet?.(input.value);
      this.app.change('meta');
    });
    this.bound.push([input, () => obj[key]]);
    return h('label', { class: 'field wide' }, h('span', { class: 'lbl' }, label), h('span', { class: 'inp' }, input));
  }

  select(label, obj, key, options, { kind = 'geometry', numeric = false, rerender = false, wide = false } = {}) {
    const sel = h('select', {}, options.map(([v, t, attrs]) => h('option', { value: v, ...attrs }, t)));
    sel.value = String(obj[key]);
    sel.addEventListener('change', () => {
      obj[key] = numeric ? Number(sel.value) : sel.value;
      this.app.change(kind);
      if (rerender) this.render();
    });
    this.bound.push([sel, () => String(obj[key])]);
    return h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', { class: 'lbl' }, label), h('span', { class: 'inp' }, sel));
  }

  section(id, title, open, ...body) {
    const d = h('details', { class: 'sec', id: `sec-${id}` }, h('summary', {}, title), h('div', { class: 'sec-body' }, ...body));
    const prev = this.openState?.[id];
    d.open = prev === undefined ? open : prev;
    d.addEventListener('toggle', () => {
      if (id === 'site' && d.open) setTimeout(() => this.siteMap?.invalidate(), 50);
    });
    return d;
  }

  /** 値だけ入れ直す（ドラッグ等で外部から変わったとき） */
  syncValues() {
    for (const [el, get] of this.bound) {
      if (document.activeElement === el) continue;
      const v = get();
      if (el.value !== String(v)) el.value = v;
    }
    for (const fn of this.updaters) fn();
    this.updateDerived?.();
  }

  /** 方位の選択肢（振れ角で表示が変わる） */
  faceOptions() {
    const rot = this.model.site.rotation;
    return FACE_ORDER.map((f) => [f, faceLabel(f, rot), { 'data-face': f }]);
  }

  render() {
    // 開閉状態を保持して再構築
    this.openState = {};
    this.root.querySelectorAll('details.sec').forEach((d) => (this.openState[d.id.slice(4)] = d.open));
    const itemOpen = new Set([...this.root.querySelectorAll('details.item[open]')].map((d) => d.dataset.id));
    const scroll = this.root.scrollTop;
    this.bound = [];
    this.updaters = [];
    const m = this.model;
    const keepMap = this.mapEl;
    this.root.textContent = '';

    this.root.append(
      this.siteSection(m),
      this.buildingSection(m),
      this.roofSection(m),
      this.listSection('windows', '窓', m.windows, (w, i) => this.windowFields(w, i), () => this.addWindow(), true),
      this.listSection('trees', '樹木', m.trees, (t) => this.treeFields(t), () => this.addTree(), false),
      this.listSection('obstacles', '障害物（隣家・塀・バルコニー等）', m.obstacles, (o) => this.obstacleFields(o), () => this.addObstacle(), false),
      this.settingsSection(m),
      this.dataSection()
    );
    this.root.querySelectorAll('details.item').forEach((d) => {
      if (itemOpen.has(d.dataset.id)) d.open = true;
    });
    this.root.scrollTop = scroll;
    if (keepMap) this.siteMap.invalidate();
  }

  // ---------- 敷地 ----------
  siteSection(m) {
    const s = m.site;
    const msg = h('div', { class: 'msg' });
    const say = (t, bad = false) => {
      msg.textContent = t;
      msg.className = `msg ${bad ? 'bad' : 'good'}`;
    };
    const gmLink = h('a', { target: '_blank', rel: 'noopener', class: 'linkbtn' }, 'Googleマップで開く ↗');
    const updLink = () => (gmLink.href = `https://www.google.com/maps/search/?api=1&query=${s.lat.toFixed(6)},${s.lng.toFixed(6)}`);
    updLink();

    const setLL = (lat, lng, recenter = true) => {
      s.lat = Number(lat.toFixed(7));
      s.lng = Number(lng.toFixed(7));
      updLink();
      this.syncValues();
      this.app.change('site');
      if (recenter) this.app.recenterMap?.();
    };

    const paste = h('input', { type: 'text', placeholder: '例: 35.681236, 139.767125 や GoogleマップのURL' });
    const applyPaste = () => {
      const r = parseLatLng(paste.value);
      if (!r) return say('緯度経度を読み取れませんでした', true);
      setLL(r.lat, r.lng);
      say(`反映しました：${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`);
      paste.value = '';
    };
    paste.addEventListener('keydown', (e) => e.key === 'Enter' && applyPaste());
    paste.addEventListener('paste', () => setTimeout(applyPaste, 0));

    const addr = h('input', { type: 'text', placeholder: '住所（例: 東京都千代田区丸の内1丁目）' });
    const results = h('div', { class: 'addr-results' });
    const search = async () => {
      const q = addr.value.trim();
      if (!q) return;
      results.textContent = '検索中…';
      try {
        const list = await geocodeAddress(q);
        results.textContent = '';
        if (!list.length) return (results.textContent = '見つかりませんでした');
        list.slice(0, 6).forEach((r) =>
          results.append(
            h('button', { class: 'addr-item', onclick: () => {
              setLL(r.lat, r.lng);
              say(`「${r.title}」に移動しました。地図で正確な位置をクリックしてください`);
              results.textContent = '';
            } }, r.title)
          )
        );
      } catch (e) {
        results.textContent = `検索できませんでした（${e.message}）`;
      }
    };
    addr.addEventListener('keydown', (e) => e.key === 'Enter' && search());

    if (!this.mapEl) {
      this.mapEl = h('div', { class: 'sitemap' });
      this.siteMap = new SiteMap(this.mapEl, { onPick: (lat, lng) => {
        setLL(lat, lng, false);
        say(`地図から設定：${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      } });
    }
    const layerSel = h('select', { class: 'mini' }, SiteMap.layerOptions().map(([k, t]) => h('option', { value: k }, t)));
    layerSel.value = this.siteMap.current;
    layerSel.addEventListener('change', () => this.siteMap.setLayer(layerSel.value));

    const rotOut = h('small', { class: 'hint' });
    const rotRange = h('input', { type: 'range', min: -90, max: 90, step: 0.5, value: s.rotation, class: 'rot-range' });
    const updRot = () => {
      rotOut.textContent = `南面の向き：${dirName(faceAz('S', s.rotation))} ${faceAz('S', s.rotation).toFixed(1)}°（真南=180°）。地図のオレンジ枠と赤線（南面）を航空写真の建物に合わせてください。`;
    };
    updRot();
    rotRange.addEventListener('input', () => {
      s.rotation = Number(rotRange.value);
      this.syncValues();
      updRot();
      this.app.change('rotation');
    });
    this.bound.push([rotRange, () => s.rotation]);
    this.updateDerived = () => {
      updRot();
      updLink();
      this.updateEave?.();
      this.root.querySelectorAll('option[data-face]').forEach((o) => (o.textContent = faceLabel(o.dataset.face, s.rotation)));
    };

    return this.section(
      'site',
      '敷地・方位',
      true,
      this.text('敷地名', s, 'name'),
      h('div', { class: 'grid2' },
        this.num('緯度', s, 'lat', { step: 0.000001, min: -90, max: 90, unit: '°', kind: 'site', onSet: updLink }),
        this.num('経度', s, 'lng', { step: 0.000001, min: -180, max: 180, unit: '°', kind: 'site', onSet: updLink })
      ),
      h('div', { class: 'field wide' },
        h('span', { class: 'lbl' }, 'Googleマップの座標を貼り付け'),
        h('div', { class: 'row' }, paste, h('button', { onclick: applyPaste }, '反映')),
        h('small', { class: 'hint' }, 'Googleマップで敷地を右クリック → 表示された「35.68…, 139.76…」をクリックでコピー → ここに貼り付け。URL（@緯度,経度）や度分秒にも対応。')
      ),
      h('div', { class: 'field wide' },
        h('span', { class: 'lbl' }, '住所から探す（国土地理院）'),
        h('div', { class: 'row' }, addr, h('button', { onclick: search }, '検索')),
        results
      ),
      msg,
      h('div', { class: 'map-tools' }, layerSel, gmLink, h('button', { class: 'mini', onclick: () => this.app.recenterMap?.() }, '敷地へ戻る')),
      this.mapEl,
      h('small', { class: 'hint' }, '地図をクリックすると、その地点を建物の中心として設定します。'),
      h('div', { class: 'grid2' },
        this.num('時差（UTC+）', s, 'tz', { step: 0.5, min: -12, max: 14, unit: '時間', kind: 'site' }),
        this.num('建物の振れ角', s, 'rotation', { step: 0.5, min: -180, max: 180, unit: '°', kind: 'rotation', onSet: () => {
          rotRange.value = s.rotation;
          this.updateDerived();
        } })
      ),
      h('div', { class: 'field wide' }, h('span', { class: 'lbl' }, '振れ角の調整（＋で西へ、−で東へ回転）'), rotRange, rotOut)
    );
  }

  // ---------- 建物 ----------
  buildingSection(m) {
    const b = m.building;
    const eaveOut = h('div', { class: 'derived' });
    this.updateEave = () => (eaveOut.textContent = `軒高（GL〜壁上端）= 基礎高 + 階高×階数 = ${eaveHeight(b).toFixed(2)} m`);
    this.updateEave();
    const upd = () => this.updateEave();
    return this.section(
      'building',
      '建物',
      true,
      h('div', { class: 'grid2' },
        this.num('幅（東西）', b, 'width', { min: 1, max: 100, step: 0.01, onSet: upd }),
        this.num('奥行（南北）', b, 'depth', { min: 1, max: 100, step: 0.01, onSet: upd }),
        this.select('階数', b, 'floors', [[1, '平屋'], [2, '2階建て'], [3, '3階建て']], { numeric: true, rerender: true }),
        this.num('基礎高（GL→1FL）', b, 'baseHeight', { min: 0, max: 3, step: 0.05, onSet: upd }),
        this.num('階高', b, 'storyHeight', { min: 2, max: 6, step: 0.05, onSet: upd })
      ),
      eaveOut,
      h('small', { class: 'hint' }, '幅・奥行は振れ角0°のときの東西・南北方向。総二階（または平屋）の箱型としてモデル化します。')
    );
  }

  // ---------- 屋根 ----------
  roofSection(m) {
    const r = m.roof;
    const angle = h('small', { class: 'hint' });
    const updAngle = () => (angle.textContent = `${r.pitch}寸勾配 ＝ ${((Math.atan(r.pitch / 10) * 180) / Math.PI).toFixed(1)}°`);
    updAngle();
    const fields = [
      this.select('屋根形状', r, 'type', ROOF_TYPES, { rerender: true }),
      this.num('勾配', r, 'pitch', { min: 0, max: 20, step: 0.5, unit: '寸', onSet: updAngle }),
    ];
    if (r.type === 'gable')
      fields.push(this.select('棟の方向', r, 'ridge', [['x', '東西（南面が平側）'], ['y', '南北（南面が妻側）']], { wide: true }));
    if (r.type === 'shed')
      fields.push(this.select('下がる側', r, 'shedDown', this.faceOptions(), { wide: true }));
    fields.push(this.num(r.type === 'flat' ? '庇・パラペットの出' : '軒の出', r, 'eave', { min: 0, max: 3, step: 0.05 }));
    if (r.type === 'gable' || r.type === 'shed') fields.push(this.num('ケラバの出', r, 'verge', { min: 0, max: 3, step: 0.05 }));
    fields.push(this.num('屋根厚（鼻隠し）', r, 'thickness', { min: 0.05, max: 1, step: 0.01 }));
    return this.section('roof', '屋根・軒', true, h('div', { class: 'grid2' }, fields), angle, h('small', { class: 'hint' }, '軒の出・ケラバの出は外壁面からの水平距離。寄棟は長辺方向に棟を通します。'));
  }

  // ---------- 一覧（窓・樹木・障害物） ----------
  listSection(id, title, list, fieldsFn, addFn, open) {
    const items = list.map((it, i) => {
      const summaryText = h('span', { class: 'item-title' });
      const spec = h('span', { class: 'item-spec' });
      const updSummary = () => {
        summaryText.textContent = it.name || '(名称なし)';
        spec.textContent = this.itemSpec(id, it);
      };
      updSummary();
      const del = h('button', { class: 'icon-btn danger', title: '削除', onclick: (e) => {
        e.preventDefault();
        list.splice(i, 1);
        this.app.change('geometry');
        this.render();
      } }, '✕');
      const dup = h('button', { class: 'icon-btn', title: '複製', onclick: (e) => {
        e.preventDefault();
        const c = { ...structuredClone(it), id: newId(id[0]), name: `${it.name} のコピー` };
        list.splice(i + 1, 0, c);
        this.app.change('geometry');
        this.render();
      } }, '⧉');
      const marker = id === 'windows' ? h('span', { class: 'swatch', style: `background:${seriesColor(i)}` }, String(i + 1)) : h('span', { class: `glyph ${id}` });
      const body = h('div', { class: 'item-body' }, fieldsFn(it, i));
      body.addEventListener('input', updSummary);
      body.addEventListener('change', updSummary);
      this.updaters.push(updSummary);
      return h('details', { class: 'item', 'data-id': it.id }, h('summary', {}, marker, h('span', { class: 'item-text' }, summaryText, spec), dup, del), body);
    });
    return this.section(
      id,
      `${title}（${list.length}）`,
      open,
      h('div', { class: 'items' }, items),
      h('button', { class: 'add', onclick: () => addFn() }, `＋ ${title.replace(/（.*$/, '')}を追加`)
    );
  }

  itemSpec(kind, it) {
    if (kind === 'windows') return `${FACE_NAME[it.face]} ${it.floor}F ${(+it.width).toFixed(2)}×${(+it.height).toFixed(2)}m${it.hood > 0 ? ` 庇${it.hood}m` : ''}`;
    if (kind === 'trees') return `${it.type === 'evergreen' ? '常緑' : '落葉'} H${it.height}m 樹冠${it.crown}m`;
    return `${it.w}×${it.d}m H${(+it.z0 + +it.h).toFixed(1)}m`;
  }

  windowFields(w) {
    const m = this.model;
    const floors = Array.from({ length: m.building.floors }, (_, i) => [i + 1, `${i + 1}階`]);
    if (w.floor > m.building.floors) floors.push([w.floor, `${w.floor}階（建物外）`]);
    return h('div', { class: 'grid2' },
      this.text('名称', w, 'name'),
      this.select('取付け面', w, 'face', this.faceOptions(), { wide: true }),
      this.select('階', w, 'floor', floors, { numeric: true }),
      this.num('左端からの距離', w, 'offset', { min: -50, max: 100, hint: '外から見て壁の左端から' }),
      this.num('窓幅', w, 'width', { min: 0.05, max: 50 }),
      this.num('窓高さ', w, 'height', { min: 0.05, max: 20 }),
      this.num('床から窓下端', w, 'sill', { min: 0, max: 10, hint: '掃出し窓は0' }),
      this.num('庇の出', w, 'hood', { min: 0, max: 5, step: 0.05, hint: '0で庇なし' }),
      this.num('窓上端〜庇', w, 'hoodGap', { min: 0, max: 3, step: 0.05 })
    );
  }

  treeFields(t) {
    return h('div', { class: 'grid2' },
      this.text('名称', t, 'name'),
      this.select('種類', t, 'type', [['deciduous', '落葉樹'], ['evergreen', '常緑樹']]),
      this.num('位置 X（東+）', t, 'x', { step: 0.1, min: -500, max: 500 }),
      this.num('位置 Y（北+）', t, 'y', { step: 0.1, min: -500, max: 500 }),
      this.num('樹高', t, 'height', { min: 0.5, max: 60, step: 0.1 }),
      this.num('樹冠の直径', t, 'crown', { min: 0.2, max: 40, step: 0.1 }),
      this.num('枝下高さ', t, 'crownBase', { min: 0, max: 50, step: 0.1, hint: '樹冠の下端の高さ' })
    );
  }

  obstacleFields(o) {
    return h('div', { class: 'grid2' },
      this.text('名称', o, 'name'),
      this.num('中心 X（東+）', o, 'x', { step: 0.1, min: -500, max: 500 }),
      this.num('中心 Y（北+）', o, 'y', { step: 0.1, min: -500, max: 500 }),
      this.num('幅（X方向）', o, 'w', { min: 0.01, max: 300, step: 0.1 }),
      this.num('奥行（Y方向）', o, 'd', { min: 0.01, max: 300, step: 0.1 }),
      this.num('下端の高さ', o, 'z0', { min: 0, max: 200, step: 0.05, hint: 'バルコニー等は床の高さ' }),
      this.num('高さ（厚み）', o, 'h', { min: 0.01, max: 300, step: 0.1 }),
      this.num('回転（時計回り）', o, 'rot', { min: -360, max: 360, step: 1, unit: '°' })
    );
  }

  addWindow() {
    const m = this.model;
    m.windows.push({ id: newId('w'), name: `窓${m.windows.length + 1}`, face: 'S', floor: 1, offset: 1, width: 1.69, height: 1.1, sill: 0.9, hood: 0, hoodGap: 0.15 });
    this.app.change('geometry');
    this.render();
    this.openItem(m.windows.at(-1).id);
  }

  addTree() {
    const m = this.model;
    m.trees.push({ id: newId('t'), name: `樹木${m.trees.length + 1}`, type: 'deciduous', x: 0, y: -m.building.depth / 2 - 4, height: 5, crown: 3, crownBase: 1.8 });
    this.app.change('geometry');
    this.render();
    this.openItem(m.trees.at(-1).id);
  }

  addObstacle() {
    const m = this.model;
    m.obstacles.push({ id: newId('o'), name: `障害物${m.obstacles.length + 1}`, x: 0, y: -m.building.depth / 2 - 8, w: 6, d: 0.15, z0: 0, h: 1.8, rot: 0 });
    this.app.change('geometry');
    this.render();
    this.openItem(m.obstacles.at(-1).id);
  }

  openItem(id) {
    const d = this.root.querySelector(`details.item[data-id="${id}"]`);
    if (d) {
      d.open = true;
      d.closest('details.sec').open = true;
      d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ---------- 計算設定 ----------
  settingsSection(m) {
    const st = m.settings;
    const months = Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}月`]);
    const labels = h('input', { type: 'checkbox' });
    labels.checked = !!st.showLabels;
    labels.addEventListener('change', () => {
      st.showLabels = labels.checked;
      this.app.change('geometry');
    });
    return this.section(
      'settings',
      '計算条件',
      false,
      h('div', { class: 'grid2' },
        this.num('大気透過率 P', st, 'P', { min: 0.4, max: 0.9, step: 0.01, unit: '', kind: 'settings', hint: '晴天時 0.6〜0.75程度' }),
        this.num('日射熱取得率 η', st, 'eta', { min: 0.05, max: 1, step: 0.01, unit: '', kind: 'settings', hint: 'Low-E複層 0.4〜0.6' }),
        this.num('地面の反射率', st, 'rho', { min: 0, max: 0.9, step: 0.01, unit: '', kind: 'settings' }),
        this.select('計算間隔', st, 'step', [[5, '5分'], [10, '10分'], [15, '15分'], [30, '30分']], { numeric: true, kind: 'settings' }),
        this.select('落葉期（開始）', st, 'leafOffFrom', months, { numeric: true, kind: 'settings' }),
        this.select('落葉期（終了）', st, 'leafOffTo', months, { numeric: true, kind: 'settings' }),
        this.num('常緑樹の透過率', st, 'transEvergreen', { min: 0, max: 1, step: 0.05, unit: '', kind: 'settings' }),
        this.num('落葉樹（葉あり）', st, 'transLeafOn', { min: 0, max: 1, step: 0.05, unit: '', kind: 'settings' }),
        this.num('落葉樹（落葉期）', st, 'transLeafOff', { min: 0, max: 1, step: 0.05, unit: '', kind: 'settings' }),
        this.num('日照マップ格子', st, 'gridSize', { min: 0.2, max: 3, step: 0.1, kind: 'settings' }),
        this.num('測定面の高さ', st, 'gridHeight', { min: 0, max: 30, step: 0.1, kind: 'settings', hint: '日影規制は1.5m/4m等' }),
        this.num('計算範囲（建物から）', st, 'gridMargin', { min: 2, max: 60, step: 1, kind: 'settings' })
      ),
      h('label', { class: 'check' }, labels, ' 3Dビューに窓番号を表示'),
      h('small', { class: 'hint' }, '直達日射はブーゲの式、天空日射はベルラーゲの式（晴天時）。窓の日射熱取得 =（直達＋天空＋地面反射）× 面積 × η。天空日射は軒による遮蔽を考慮しない簡易計算です。')
    );
  }

  // ---------- データ ----------
  dataSection() {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const m = normalizeModel(JSON.parse(await f.text()));
        this.app.setModel(m);
      } catch (e) {
        alert(`読み込めませんでした：${e.message}`);
      }
      file.value = '';
    });
    const exportJson = () => {
      const m = this.model;
      const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${m.site.name || '日当たり'}_${m.date}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    return this.section(
      'data',
      'データの保存・読込',
      false,
      h('div', { class: 'row wrap' },
        h('button', { onclick: exportJson }, 'JSONで保存'),
        h('button', { onclick: () => file.click() }, 'JSONを読込'),
        h('button', { class: 'danger', onclick: () => {
          if (confirm('入力内容をサンプルの初期値に戻します。よろしいですか？')) this.app.setModel(defaultModel());
        } }, '初期値に戻す'),
        file
      ),
      h('small', { class: 'hint' }, '入力内容はこのブラウザに自動保存されます。別のPCへ移すときや複数案を比べるときはJSONで保存してください。')
    );
  }
}
