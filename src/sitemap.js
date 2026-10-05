// 敷地の地図（Leaflet）。地図クリックで緯度経度を設定し、建物の外形を重ねて表示する
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RAD, DEG } from './sun.js';
import { obstacleAxis, obbCorners } from './geometry.js';

const EARTH_R = 6378137;

const LAYERS = {
  gsiPhoto: {
    label: '航空写真（国土地理院）',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    attr: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxNative: 18,
  },
  gsiStd: {
    label: '標準地図（国土地理院）',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attr: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxNative: 18,
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxNative: 19,
  },
};

/**
 * 緯度経度の文字列を解釈する
 * 対応: "35.6812, 139.7671" / Google マップの URL（@lat,lng / !3dlat!4dlng / ?q=lat,lng）/ 度分秒（35°40'52.4"N 139°46'01.7"E）
 */
export function parseLatLng(text) {
  if (!text) return null;
  const s = String(text).trim().replace(/，/g, ',').replace(/　/g, ' ');
  const ok = (lat, lng) => (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);
  let m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return ok(+m[1], +m[2]);
  m = s.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NS])[\s,]*(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EW])/i);
  if (m) {
    const lat = (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/s/i.test(m[4]) ? -1 : 1);
    const lng = (+m[5] + +m[6] / 60 + +m[7] / 3600) * (/w/i.test(m[8]) ? -1 : 1);
    return ok(lat, lng);
  }
  m = s.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  return null;
}

/** 住所検索（国土地理院 住所検索API） */
export async function geocodeAddress(q) {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const js = await res.json();
  return js.map((f) => ({ title: f.properties?.title || q, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
}

export class SiteMap {
  constructor(el, { onPick } = {}) {
    this.map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 21 });
    this.layers = {};
    for (const [k, d] of Object.entries(LAYERS)) {
      this.layers[k] = L.tileLayer(d.url, { attribution: d.attr, maxNativeZoom: d.maxNative, maxZoom: 21 });
    }
    this.current = 'gsiPhoto';
    this.layers[this.current].addTo(this.map);
    this.overlay = L.layerGroup().addTo(this.map);
    this.map.on('click', (e) => onPick?.(e.latlng.lat, e.latlng.lng));
    this.map.setView([35.68, 139.76], 19);
    this.centered = false;
  }

  setLayer(k) {
    if (!this.layers[k] || k === this.current) return;
    this.map.removeLayer(this.layers[this.current]);
    this.layers[k].addTo(this.map);
    this.current = k;
  }

  static layerOptions() {
    return Object.entries(LAYERS).map(([k, d]) => [k, d.label]);
  }

  /** 建物軸ローカル (x,y) → 緯度経度 */
  toLatLng(model, x, y) {
    const f = model.site.rotation * RAD;
    const e = x * Math.cos(f) + y * Math.sin(f);
    const n = -x * Math.sin(f) + y * Math.cos(f);
    const lat0 = model.site.lat;
    return [lat0 + (n / EARTH_R) * DEG, model.site.lng + (e / (EARTH_R * Math.cos(lat0 * RAD))) * DEG];
  }

  update(model, geom, recenter = false) {
    const ll = (x, y) => this.toLatLng(model, x, y);
    this.overlay.clearLayers();
    for (const o of model.obstacles) {
      const [ux, uy] = obstacleAxis(o);
      L.polygon(
        obbCorners(o.x, o.y, ux, uy, o.w / 2, o.d / 2).map(([x, y]) => ll(x, y)),
        { color: '#fef3c7', weight: 1.5, dashArray: (o.z0 || 0) > 0.3 ? '4 3' : null, fillOpacity: 0.15, interactive: false }
      ).addTo(this.overlay);
    }
    for (const c of geom.crowns) {
      L.circle(ll(c.cx, c.cy), {
        radius: c.a,
        color: c.type === 'evergreen' ? '#4ade80' : '#bef264',
        weight: 1.5,
        fillOpacity: 0.2,
        interactive: false,
      }).addTo(this.overlay);
    }
    for (const [[ax, ay], [bx, by]] of geom.roofLines) {
      L.polyline([ll(ax, ay), ll(bx, by)], { color: '#ffffff', weight: 1, dashArray: '4 3', interactive: false }).addTo(this.overlay);
    }
    const W = geom.W;
    const D = geom.D;
    L.polygon(
      [ll(-W / 2, -D / 2), ll(W / 2, -D / 2), ll(W / 2, D / 2), ll(-W / 2, D / 2)],
      { color: '#f97316', weight: 2.5, fillOpacity: 0.25, interactive: false }
    ).addTo(this.overlay);
    // 南面（主採光面）を太線で示す
    L.polyline([ll(-W / 2, -D / 2), ll(W / 2, -D / 2)], { color: '#dc2626', weight: 5, interactive: false }).addTo(this.overlay);
    L.circleMarker([model.site.lat, model.site.lng], { radius: 4, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1, interactive: false }).addTo(this.overlay);
    if (recenter || !this.centered) {
      this.map.setView([model.site.lat, model.site.lng], Math.max(this.map.getZoom(), 19));
      this.centered = true;
    }
  }

  invalidate() {
    this.map.invalidateSize();
  }
}
