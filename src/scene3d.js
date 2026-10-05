// 3D ビュー（Three.js）。建物軸ローカル (x東, y北, z上) → Three (X, Y=上, Z=南)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RAD, sunVector } from './sun.js';
import { isLeafOff } from './model.js';
import { SERIES } from './colors.js';

const L = (x, y, z) => new THREE.Vector3(x, z, -y);

function trisToGeometry(tris) {
  const pos = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    pos[i] = tris[i];
    pos[i + 1] = tris[i + 2];
    pos[i + 2] = -tris[i + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(4, 8, 120, 48, 24);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 32px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  sp.scale.set(1.3, 0.65, 1);
  sp.renderOrder = 10;
  return sp;
}

function textSprite(text, size = 2.2, color = '#334155') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.font = 'bold 72px "Yu Gothic UI", "Hiragino Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  sp.scale.set(size, size, 1);
  return sp;
}

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: '#efe7da', roughness: 0.9, side: THREE.DoubleSide }),
  roof: new THREE.MeshStandardMaterial({ color: '#5b6573', roughness: 0.8, side: THREE.DoubleSide }),
  hood: new THREE.MeshStandardMaterial({ color: '#7b8490', roughness: 0.7, side: THREE.DoubleSide }),
  obstacle: new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.95, side: THREE.DoubleSide }),
  trunk: new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 1, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: '#7fa7cc', roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
  evergreen: new THREE.MeshStandardMaterial({ color: '#3d7a3a', roughness: 1 }),
  leafOn: new THREE.MeshStandardMaterial({ color: '#73a94f', roughness: 1 }),
  leafOff: new THREE.MeshStandardMaterial({ color: '#8f6f50', roughness: 1, wireframe: true, transparent: true, opacity: 0.55 }),
};
const SHARED = new Set(Object.values(MAT));

export class Scene3D {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d6e6f3');
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
    this.camera.position.set(26, 22, 42);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());

    this.hemi = new THREE.HemisphereLight('#e4f0ff', '#8d846f', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#c3cfac', roughness: 1 })
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, '#9aa983', '#aebb98');
    grid.position.y = 0.004;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.scene.add(grid);

    // 方位表示
    this.compass = new THREE.Group();
    const R = 26;
    [
      ['北', 0, -R, '#b42318'],
      ['東', R, 0, '#334155'],
      ['南', 0, R, '#334155'],
      ['西', -R, 0, '#334155'],
    ].forEach(([t, x, z, col]) => {
      const s = textSprite(t, 2.6, col);
      s.position.set(x, 1.4, z);
      this.compass.add(s);
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.08, R, 128).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#7d8a6a', transparent: true, opacity: 0.5 })
    );
    ring.position.y = 0.01;
    this.compass.add(ring);
    this.scene.add(this.compass);

    // 太陽と軌跡
    this.dome = 24;
    this.sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffb300' }));
    this.scene.add(this.sunBall);
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f59e0b' }));
    this.scene.add(this.pathLine);

    this.bldg = new THREE.Group();
    this.scene.add(this.bldg);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** 建物・樹木・障害物を作り直す */
  setModel(model, geom) {
    for (const c of [...this.bldg.children]) {
      this.bldg.remove(c);
      c.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !SHARED.has(o.material)) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    }
    this.bldg.rotation.y = -model.site.rotation * RAD;

    for (const p of geom.parts) {
      const m = new THREE.Mesh(trisToGeometry(p.tris), MAT[p.kind] || MAT.obstacle);
      m.castShadow = true;
      m.receiveShadow = true;
      this.bldg.add(m);
    }
    geom.windows.forEach((w, i) => {
      const [a, b, c, d] = w.corners.map((q) => L(q[0], q[1], q[2]));
      const g = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, MAT.glass);
      m.receiveShadow = true;
      this.bldg.add(m);
      const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([a, b, c, d]), new THREE.LineBasicMaterial({ color: '#2f3b48' }));
      this.bldg.add(frame);
      if (model.settings.showLabels) {
        const f = w.face;
        const lab = makeLabel(String(i + 1), SERIES[i % SERIES.length]);
        const q = w.center;
        lab.position.copy(L(q[0] + f.nx * 0.45, q[1] + f.ny * 0.45, q[2]));
        this.bldg.add(lab);
      }
    });
    const leafOff = isLeafOff(model.date, model.settings);
    for (const c of geom.crowns) {
      const mat = c.type === 'evergreen' ? MAT.evergreen : leafOff ? MAT.leafOff : MAT.leafOn;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat);
      m.scale.set(c.a, c.c, c.a);
      m.position.copy(L(c.cx, c.cy, c.cz));
      m.castShadow = mat !== MAT.leafOff;
      m.receiveShadow = true;
      this.bldg.add(m);
    }

    // 影を落とす範囲
    const bd = geom.bounds;
    const ext = Math.max(Math.abs(bd.minX), Math.abs(bd.maxX), Math.abs(bd.minY), Math.abs(bd.maxY), 10) + 12;
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 400;
    sc.updateProjectionMatrix();
    this.render();
  }

  /** 太陽位置と当日の軌跡を反映 */
  setSun(alt, az, path) {
    const up = alt > 0;
    const s = sunVector(alt, az);
    const dir = new THREE.Vector3(s.e, s.u, -s.n);
    this.sun.position.copy(dir.clone().multiplyScalar(150));
    this.sun.target.position.set(0, 0, 0);
    const k = up ? Math.min(1, alt / 8) : 0;
    this.sun.intensity = 2.6 * k;
    this.sun.visible = up;
    this.hemi.intensity = 0.4 + 0.5 * Math.min(1, Math.max(0, (alt + 6) / 16));
    this.scene.background.set(up ? '#d6e6f3' : alt > -6 ? '#a9b6c8' : '#5d6b80');
    this.sunBall.visible = alt > -1;
    this.sunBall.position.copy(dir.clone().multiplyScalar(this.dome));
    const pts = path.filter((q) => q.alt > -1).map((q) => {
      const v = sunVector(q.alt, q.az);
      return new THREE.Vector3(v.e, v.u, -v.n).multiplyScalar(this.dome);
    });
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.lastSunDir = up ? dir : null;
    this.render();
  }

  view(kind) {
    const c = this.camera;
    const t = this.controls.target;
    t.set(0, 3, 0);
    if (kind === 'south') c.position.set(0, 16, 46);
    else if (kind === 'top') c.position.set(0, 60, 0.01);
    else if (kind === 'sun' && this.lastSunDir) c.position.copy(this.lastSunDir.clone().multiplyScalar(55).add(t));
    else c.position.set(26, 22, 42);
    c.lookAt(t);
    this.controls.update();
    this.render();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
