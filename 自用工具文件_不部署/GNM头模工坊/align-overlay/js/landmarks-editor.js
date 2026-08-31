/**
 * 路标点编辑：增删移、命名、粉黄配对、重算 Umeyama。
 * 粉 = GNM（存 native，未 normalize）；黄 = 欧版（存欧版资产 local）。
 */
import * as THREE from 'three';
import {
  umeyama,
  applyNormalizePoint,
  inverseNormalizePoint,
  composeNormalizeAfterSimilarity,
} from './procrustes.js';
import { landmarkLabel } from './landmarks-gnm.js';

const STORAGE_KEY = 'gnm-align-overlay-landmarks-v1';
/** 兼容旧版 localStorage；权威存储为 landmarks/history/*.json */
const HISTORY_KEY = 'gnm-align-overlay-history-v1';
const HISTORY_MAX = 40;
const HISTORY_DIR_URL = './landmarks/history/';
const HISTORY_API_URLS = [
  '/__api/align-overlay-history',
  'http://127.0.0.1:18080/__api/align-overlay-history',
];
/** GNM 点：粉红，与蓝色头模对比清晰 */
const COLOR_GNM = 0xff5aad;
const COLOR_EURO = 0xe8a317;
const COLOR_SEL = 0xffffff;
/** 球体半径（直径相对旧版缩小一倍：0.0028 → 0.0014） */
const MARKER_RADIUS = 0.0014;
/** 路标沿「离头中心向外」再抬一点，避免埋进网格里看不见 */
const MARKER_OUTSET = 0.0018;

function uid() {
  return `lm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function $(sel) {
  return document.querySelector(sel);
}

export class LandmarkEditor {
  /**
   * @param {object} host
   * @param {THREE.Scene} host.scene
   * @param {THREE.Camera} host.camera
   * @param {HTMLCanvasElement} host.canvas
   * @param {THREE.OrbitControls} host.controls
   * @param {THREE.Group} host.gnmRoot
   * @param {THREE.Group} host.euroRoot
   * @param {THREE.Group} host.markerRoot
   * @param {() => object|null} host.getNorm
   * @param {(sim: object, reportPatch: object) => void} host.applyAlignment
   * @param {() => object} [host.getPreTrs]
   * @param {(raw: object|null) => void} [host.applyPreTrs]
   * @param {(msg: string) => void} host.setStatus
   */
  constructor(host) {
    this.host = host;
    this.points = [];
    this.selectedUid = null;
    this.mode = 'idle'; // idle | add-gnm | add-euro | move | pair
    this.pairPickUid = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();
    this.ndc = new THREE.Vector2();
    this.markerByUid = new Map();
    this._bound = false;
    this._dragging = false;
    this._dragSide = null;
    this._historyBusy = false;
    this._historyLoadingId = null;
    this._pairLinkLock = false;
    this._onMove = (ev) => this.onPointerMove(ev);
    this._onUp = (ev) => this.onPointerUp(ev);
  }

  bindUi() {
    if (this._bound) return;
    this._bound = true;
    $('#lm-add-gnm')?.addEventListener('click', () => this.toggleMode('add-gnm'));
    $('#lm-add-euro')?.addEventListener('click', () => this.toggleMode('add-euro'));
    $('#lm-pair')?.addEventListener('click', () => this.toggleMode('pair'));
    $('#lm-gen-mirror')?.addEventListener('click', () => this.generateMirrorFromSelected());
    $('#lm-delete')?.addEventListener('click', () => this.deleteSelected());
    $('#lm-warp')?.addEventListener('click', () => {
      this.host.applyLandmarkWarp?.();
    });
    $('#lm-eye-align')?.addEventListener('click', () => {
      this.host.applyEuroEyeAlign?.();
    });
    $('#lm-export')?.addEventListener('click', () => this.exportJson());
    $('#lm-import')?.addEventListener('click', () => $('#lm-import-file')?.click());
    $('#lm-import-file')?.addEventListener('change', (ev) => this.importFile(ev));
    $('#lm-save-local')?.addEventListener('click', () => this.saveLocal());
    $('#lm-load-local')?.addEventListener('click', () => this.loadLocal());
    $('#lm-hist-save')?.addEventListener('click', () => {
      this.saveHistoryVersion().catch((e) =>
        this.host.setStatus?.(`存版本失败：${e.message || e}`)
      );
    });
    $('#lm-hist-del')?.addEventListener('click', () => {
      this.deleteHistorySelected().catch((e) =>
        this.host.setStatus?.(`删除失败：${e.message || e}`)
      );
    });
    $('#lm-hist-reload')?.addEventListener('click', () => {
      this.refreshHistorySelect()
        .then(() => this.host.setStatus?.('已从磁盘刷新历史列表'))
        .catch((e) => this.host.setStatus?.(`刷新失败：${e.message || e}`));
    });
    // 单击选中即加载；避免用 change（程序改 value 也会误触发）
    $('#lm-hist-select')?.addEventListener('click', (ev) => {
      if (this._historyBusy) return;
      const sel = $('#lm-hist-select');
      if (!sel?.value) return;
      const opt = sel.selectedOptions?.[0];
      if (opt?.disabled) return;
      // 仅当点在 option 上时加载，避免点滚动条误触
      if (ev.target && ev.target.tagName === 'OPTION') {
        this.loadHistorySelected();
      }
    });
    this.refreshHistorySelect();
    $('#lm-rename')?.addEventListener('change', () => this.renameSelected());
    $('#lm-rename')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.renameSelected();
    });
    $('#chk-landmarks')?.addEventListener('change', (ev) => {
      this.host.markerRoot.visible = !!ev.target.checked;
      if (ev.target.checked) this.syncMarkerSideVisibility();
    });

    const canvas = this.host.canvas;
    canvas.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    window.addEventListener('keydown', (ev) => this._onKeyDown(ev));
  }

  _onKeyDown(ev) {
    const t = ev.target;
    const typing =
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable);
    if (ev.key === 'Escape') {
      if (this.mode !== 'idle') this.setMode('idle');
      else if (this.selectedUid) this.clearSelection();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selectedUid) {
      if (typing) return;
      this.deleteSelected();
      return;
    }
    // 方向键：相对屏幕微调选中路标，再吸附到模型表面
    if (
      this.selectedUid &&
      !typing &&
      (ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowRight' ||
        ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown')
    ) {
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 3; // px；Shift 更细
      let dx = 0;
      let dy = 0;
      if (ev.key === 'ArrowLeft') dx = -step;
      if (ev.key === 'ArrowRight') dx = step;
      if (ev.key === 'ArrowUp') dy = -step;
      if (ev.key === 'ArrowDown') dy = step;
      this.nudgeSelectedScreen(dx, dy);
    }
  }

  /** 空闲 / 加点模式可旋转；配对与拖点瞬间临时锁 */
  _orbitAllowed() {
    return (this.mode === 'idle' || this.mode === 'add-gnm' || this.mode === 'add-euro') && !this._dragging;
  }

  _setOrbitEnabled(on) {
    if (this.host.controls) this.host.controls.enabled = !!on;
  }

  /** 工具模式：再点同一工具退出；空闲时始终可旋转（拖点瞬间临时锁） */
  toggleMode(mode) {
    if (this.mode === mode) this.setMode('idle');
    else this.setMode(mode);
  }

  setMode(mode) {
    this.mode = mode;
    this.pairPickUid = null;
    this._dragging = false;
    this._setOrbitEnabled(this._orbitAllowed());
    for (const id of ['lm-add-gnm', 'lm-add-euro', 'lm-pair']) {
      const active =
        (mode === 'add-gnm' && id === 'lm-add-gnm') ||
        (mode === 'add-euro' && id === 'lm-add-euro') ||
        (mode === 'pair' && id === 'lm-pair');
      $(`#${id}`)?.classList.toggle('is-active', active);
    }
    this.host.setStatus?.(
      mode === 'idle' ? this._lastStatus || '路标编辑就绪' : `路标模式：${mode}`
    );
  }

  clearSelection() {
    if (!this.selectedUid) return;
    this.selectedUid = null;
    this.refreshMarkers();
    this.refreshList();
    const rename = $('#lm-rename');
    if (rename) rename.value = '';
  }

  /**
   * Bootstrap from auto-aligned core pairs.
   * @param {{ gnmNative: Record<string,number[]>, euroLocal: Record<string,number[]>, usedIds: string[], weights?: number[] }} data
   */
  loadFromPairs(data) {
    this.points = [];
    const { gnmNative, euroLocal, usedIds, weights } = data;
    usedIds.forEach((id, i) => {
      const g = gnmNative[id];
      const e = euroLocal[id];
      if (!g || !e) return;
      const pairKey = id;
      const label = landmarkLabel(id);
      const w = weights?.[i] ?? 1;
      this.points.push({
        uid: uid(),
        name: label,
        side: 'gnm',
        pos: g.slice(0, 3),
        pairKey,
        weight: w,
      });
      this.points.push({
        uid: uid(),
        name: label,
        side: 'euro',
        pos: e.slice(0, 3),
        pairKey,
        weight: w,
      });
    });
    this.selectedUid = null;
    this.refreshMarkers();
    this.refreshList();
    this.bindUi();
    this.setMode('idle');
  }

  collectFitPairs() {
    const byKey = new Map();
    for (const p of this.points) {
      if (!p.pairKey) continue;
      if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
      byKey.get(p.pairKey)[p.side] = p;
    }
    const src = [];
    const dst = [];
    const used = [];
    const weights = [];
    for (const [key, sides] of byKey) {
      if (!sides.gnm || !sides.euro) continue;
      src.push(sides.euro.pos.slice(0, 3));
      dst.push(sides.gnm.pos.slice(0, 3));
      used.push(key);
      weights.push(Number(sides.gnm.weight) || Number(sides.euro.weight) || 1);
    }
    return { src, dst, used, weights };
  }

  /** 拧形用：粉黄配对路标的世界坐标（不含路标外抬） */
  collectWarpPairsWorld() {
    const byKey = new Map();
    for (const p of this.points) {
      if (!p.pairKey) continue;
      if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
      byKey.get(p.pairKey)[p.side] = p;
    }
    const norm = this.host.getNorm?.();
    const src = [];
    const dst = [];
    const used = [];
    const tmp = new THREE.Vector3();
    for (const [key, sides] of byKey) {
      if (!sides.gnm || !sides.euro) continue;
      const g = applyNormalizePoint(sides.gnm.pos, norm);
      dst.push([g[0], g[1], g[2]]);
      tmp.set(sides.euro.pos[0], sides.euro.pos[1], sides.euro.pos[2]);
      this.host.euroRoot.updateMatrixWorld(true);
      this.host.euroRoot.localToWorld(tmp);
      src.push([tmp.x, tmp.y, tmp.z]);
      used.push(key);
    }
    return { src, dst, used };
  }

  /**
   * 拧形后：把黄点 euro 局部坐标改到粉点世界位置，使粉黄路标重合（显示仍略抬出表面）。
   * @param {string[]|null} usedKeys 参与拧的 pairKey；null = 全部已配对
   */
  syncEuroLandmarksToWarpTargets(usedKeys = null) {
    const norm = this.host.getNorm?.();
    const byKey = new Map();
    for (const p of this.points) {
      if (!p.pairKey) continue;
      if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
      byKey.get(p.pairKey)[p.side] = p;
    }
    const keys = usedKeys?.length ? usedKeys : [...byKey.keys()];
    const local = new THREE.Vector3();
    let n = 0;
    for (const key of keys) {
      const sides = byKey.get(key);
      if (!sides?.gnm || !sides?.euro) continue;
      const g = applyNormalizePoint(sides.gnm.pos, norm);
      local.set(g[0], g[1], g[2]);
      this.host.euroRoot.updateMatrixWorld(true);
      this.host.euroRoot.worldToLocal(local);
      sides.euro.pos = [local.x, local.y, local.z];
      n += 1;
    }
    return n;
  }

  recompute() {
    const paired = this.collectFitPairs();
    if (paired.src.length < 3) {
      this.host.setStatus?.(`配对不足（需≥3，当前 ${paired.src.length}）`);
      return;
    }
    const norm = this.host.getNorm?.();
    if (!norm) {
      this.host.setStatus?.('缺少 normalize 状态，无法重算');
      return;
    }
    const sim = umeyama(paired.src, paired.dst, paired.weights);
    const elements = composeNormalizeAfterSimilarity(sim, norm);
    // sim.errors 在 native 空间；显示误差需乘 normalize.scale
    const sN = norm.scale || 1;
    const perPoint = paired.used.map((id, i) => {
      const err = sim.errors[i] * sN;
      return { id, errM: err, errMm: err * 1000, weight: paired.weights[i] };
    });
    const rmsMm =
      Math.sqrt(perPoint.reduce((s, p) => s + p.errM * p.errM, 0) / perPoint.length) * 1000;
    const maxMm = Math.max(...perPoint.map((p) => p.errMm));
    this.host.applyAlignment(sim, {
      usedIds: paired.used,
      matrix4_columnMajor: elements,
      perPoint,
      summary: { nPoints: perPoint.length, rmsMm, maxMm },
      umeyama: {
        scale: sim.scale,
        R: sim.R,
        t: sim.t,
        rmsM: sim.rms,
        maxErrM: sim.maxErr,
      },
    });
    this.refreshMarkers();
    const msg = `对齐 ${perPoint.length} 点 · RMS ${rmsMm.toFixed(1)} mm · 最大 ${maxMm.toFixed(1)} mm`;
    this._lastStatus = msg;
    this.host.setStatus?.(msg);
    this.refreshList();
  }

  /**
   * 保留 keepKeys（默认眉心/鼻根）两侧坐标，其余点按权威源重摆并贴面，再重算。
   * @param {string[]} keepKeys
   */
  async retuneOtherLandmarks(keepKeys = ['glabella', 'nasion']) {
    const KEEP = new Set(keepKeys);
    const gnmNative = this.host.getGnmLandmarksNative?.() || {};
    let euroLocal = {};
    const url = this.host.getEuroRestUrl?.();
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`无法加载欧版路标 HTTP ${res.status}`);
      const data = await res.json();
      euroLocal = data.points || {};
    }

    const beforeKeep = {};
    for (const p of this.points) {
      if (KEEP.has(p.pairKey)) beforeKeep[`${p.pairKey}:${p.side}`] = p.pos.slice(0, 3);
    }

    const updated = [];
    const missing = [];
    for (const p of this.points) {
      const key = p.pairKey;
      if (!key || KEEP.has(key)) continue;
      if (p.side === 'gnm') {
        const src = gnmNative[key];
        if (!src) {
          missing.push(`gnm:${key}`);
          continue;
        }
        p.pos = (this.host.snapGnmNative?.(src) || src).slice(0, 3);
        updated.push(`gnm:${key}`);
      } else if (p.side === 'euro') {
        const src = euroLocal[key];
        if (!src) {
          missing.push(`euro:${key}`);
          continue;
        }
        p.pos = (this.host.snapEuroLocal?.(src) || src).slice(0, 3);
        updated.push(`euro:${key}`);
      }
    }

    // 保险：keep 被误改则写回
    for (const p of this.points) {
      if (!KEEP.has(p.pairKey)) continue;
      const k = `${p.pairKey}:${p.side}`;
      if (beforeKeep[k]) p.pos = beforeKeep[k].slice(0, 3);
    }

    this.refreshMarkers();
    this.refreshList();
    this.recompute();

    const noteEl = $('#lm-hist-note');
    if (noteEl) noteEl.value = '自动重摆除眉心鼻根';
    this.saveHistoryVersion();

    const miss = missing.length ? `；缺源 ${missing.length}` : '';
    const msg = `已重摆 ${updated.length} 个点（保留 ${[...KEEP].join('·')}）${miss} · ${this._lastStatus || ''}`;
    this._lastStatus = msg;
    this.host.setStatus?.(msg);
    return { updated, missing };
  }

  worldPosFor(point) {
    const norm = this.host.getNorm?.();
    let v;
    if (point.side === 'gnm') {
      const d = applyNormalizePoint(point.pos, norm);
      v = new THREE.Vector3(d[0], d[1], d[2]);
    } else {
      v = new THREE.Vector3(point.pos[0], point.pos[1], point.pos[2]);
      this.host.euroRoot.updateMatrixWorld(true);
      v = this.host.euroRoot.localToWorld(v);
    }
    // 略抬出表面，避免 depthTest 时整颗埋进网格
    const center = this.host.getHeadCenterWorld?.() || new THREE.Vector3(0, 0.15, 0);
    const out = v.clone().sub(center);
    if (out.lengthSq() > 1e-12) {
      out.normalize().multiplyScalar(MARKER_OUTSET);
      v.add(out);
    }
    return v;
  }

  /** 粉点随 GNM 显示、黄点随欧版显示；连线需两侧都显示 */
  syncMarkerSideVisibility(showGnm, showEuro) {
    let g = showGnm;
    let e = showEuro;
    if (g == null || e == null) {
      const flags = this.host.getModelShowFlags?.();
      if (flags) {
        if (g == null) g = flags.showGnm;
        if (e == null) e = flags.showEuro;
      } else {
        if (g == null) g = true;
        if (e == null) e = true;
      }
    }
    g = !!g;
    e = !!e;
    for (const p of this.points) {
      const mesh = this.markerByUid.get(p.uid);
      if (mesh) mesh.visible = p.side === 'gnm' ? g : e;
    }
    const root = this.host.markerRoot;
    if (!root) return;
    for (const child of root.children) {
      if (child.userData?.lmPairLine) child.visible = g && e;
    }
  }

  refreshMarkers() {
    const root = this.host.markerRoot;
    root.clear();
    this.markerByUid.clear();
    const geo = new THREE.SphereGeometry(MARKER_RADIUS, 10, 10);
    for (const p of this.points) {
      const selected = p.uid === this.selectedUid;
      const mat = new THREE.MeshBasicMaterial({
        color: selected ? COLOR_SEL : p.side === 'gnm' ? COLOR_GNM : COLOR_EURO,
        depthTest: true,
        depthWrite: true,
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this.worldPosFor(p));
      mesh.scale.setScalar(selected ? 1.45 : p.pairKey ? 1 : 0.85);
      mesh.renderOrder = 0;
      mesh.userData.lmUid = p.uid;
      mesh.userData.lmSide = p.side;
      mesh.name = `lm_${p.side}_${p.name}`;
      root.add(mesh);
      this.markerByUid.set(p.uid, mesh);
    }
    // pair lines
    const byKey = new Map();
    for (const p of this.points) {
      if (!p.pairKey) continue;
      if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
      byKey.get(p.pairKey)[p.side] = p;
    }
    for (const sides of byKey.values()) {
      if (!sides.gnm || !sides.euro) continue;
      const a = this.worldPosFor(sides.gnm);
      const b = this.worldPosFor(sides.euro);
      const geoL = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(
        geoL,
        new THREE.LineBasicMaterial({
          color: 0x88aa88,
          transparent: true,
          opacity: 0.55,
          depthTest: true,
          depthWrite: false,
        })
      );
      line.userData.lmPairLine = true;
      root.add(line);
    }
    this.syncMarkerSideVisibility();
  }

  /** 列表排序：先按去 L/R 后的名称，再 L 在 R 前 */
  _listSortKey(label) {
    const n = String(label || '');
    const m = n.match(/^(.*?)([LR])$/i);
    if (m) {
      const lr = m[2].toUpperCase() === 'L' ? '0' : '1';
      return `${m[1]}\u0000${lr}\u0000${n}`;
    }
    return `${n}\u0000\u00002\u0000${n}`;
  }

  _cmpListRows(a, b) {
    const c = this._listSortKey(a.name).localeCompare(this._listSortKey(b.name), 'zh-CN');
    if (c !== 0) return c;
    return String(a.key || '').localeCompare(String(b.key || ''), 'zh-CN');
  }

  /** 选中后把列表滚到对应行（图中点球、列表点选均会触发） */
  _scrollListToSelected(uid) {
    if (!uid) return;
    const wrap = document.querySelector('.lm-list-wrap');
    const list = $('#lm-list');
    if (!wrap || !list) return;
    requestAnimationFrame(() => {
      const row =
        list.querySelector(`.lm-pick[data-uid="${uid}"]`)?.closest('.lm-row') ||
        list.querySelector(`.lm-name[data-uid="${uid}"]`)?.closest('.lm-row');
      if (!row) return;
      const w = wrap.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      if (r.top < w.top || r.bottom > w.bottom) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  refreshList() {
    const list = $('#lm-list');
    if (!list) return;
    const sideFilter = this.host.getListSideFilter?.() || null; // null | 'gnm' | 'euro'
    const byKey = new Map();
    const unpaired = [];
    for (const p of this.points) {
      if (sideFilter && p.side !== sideFilter) continue;
      if (p.pairKey) {
        if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, { key: p.pairKey, gnm: null, euro: null });
        byKey.get(p.pairKey)[p.side] = p;
      } else {
        unpaired.push(p);
      }
    }
    // 单侧模式下：配对行仍带上对侧引用仅用于展示名？当前已按 side 过滤，行内只会出现该侧按钮
    // 若需要显示完整配对名，从全量 points 补全对侧 name
    if (sideFilter) {
      for (const row of byKey.values()) {
        const other = sideFilter === 'gnm' ? 'euro' : 'gnm';
        if (!row[other]) {
          const mate = this.points.find((p) => p.pairKey === row.key && p.side === other);
          if (mate) row[other] = mate;
        }
      }
    }
    const rows = [];
    for (const row of byKey.values()) {
      const ok = !!(row.gnm && row.euro);
      const name = row.gnm?.name || row.euro?.name || row.key;
      const primaryUid =
        (sideFilter === 'euro' ? row.euro?.uid : row.gnm?.uid) ||
        row.gnm?.uid ||
        row.euro?.uid ||
        '';
      const showGnmBtn = !sideFilter || sideFilter === 'gnm';
      const showEuroBtn = !sideFilter || sideFilter === 'euro';
      const gnmBtn = showGnmBtn
        ? `<button type="button" class="lm-pick" data-uid="${row.gnm?.uid || ''}">粉</button>`
        : '';
      const euroBtn = showEuroBtn
        ? `<button type="button" class="lm-pick" data-uid="${row.euro?.uid || ''}">黄</button>`
        : '';
      const tag = sideFilter
        ? sideFilter === 'gnm'
          ? '粉·GNM'
          : '黄·欧版'
        : ok
          ? '已配对'
          : '缺一侧';
      rows.push({
        name,
        key: row.key,
        html: `<li class="lm-row ${ok ? 'is-paired' : 'is-partial'} ${
          this.selectedUid === row.gnm?.uid || this.selectedUid === row.euro?.uid ? 'is-selected' : ''
        }" data-key="${escapeHtml(row.key)}">
          ${gnmBtn}${euroBtn}
          <span class="lm-name" title="双击改名" data-uid="${primaryUid}" data-key="${escapeHtml(row.key)}">${escapeHtml(name)}</span>
          <span class="lm-tag">${tag}</span>
        </li>`,
      });
    }
    for (const p of unpaired) {
      rows.push({
        name: p.name,
        key: p.pairKey || p.uid,
        html: `<li class="lm-row is-unpaired ${this.selectedUid === p.uid ? 'is-selected' : ''}">
          <button type="button" class="lm-pick" data-uid="${p.uid}">${p.side === 'gnm' ? '粉' : '黄'}</button>
          <span class="lm-name" title="双击改名" data-uid="${p.uid}">${escapeHtml(p.name)}</span>
          <span class="lm-tag">未配对</span>
        </li>`,
      });
    }
    rows.sort((a, b) => this._cmpListRows(a, b));
    const emptyHint = sideFilter
      ? `暂无${sideFilter === 'gnm' ? '粉（GNM）' : '黄（欧版）'}路标`
      : '暂无路标';
    list.innerHTML = rows.map((r) => r.html).join('') || `<li class="lm-empty">${emptyHint}</li>`;
    list.querySelectorAll('.lm-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-uid');
        if (!id) {
          this.host.setStatus?.('该侧还没有点，请先加点或选另一侧');
          return;
        }
        if (this.mode === 'pair') this._handlePairClick(id);
        else this.select(id);
      });
    });
    list.querySelectorAll('.lm-name').forEach((el) => {
      el.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._beginInlineRename(el);
      });
    });
    const rename = $('#lm-rename');
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (rename) rename.value = sel?.name || '';
  }

  select(uid) {
    this.selectedUid = uid || null;
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    const rename = $('#lm-rename');
    if (rename) rename.value = sel?.name || '';
    this.refreshMarkers();
    this.refreshList();
    this._scrollListToSelected(uid);
  }

  /** 列表名称双击：就地输入改名 */
  _beginInlineRename(nameEl) {
    if (!nameEl || nameEl.querySelector('input')) return;
    const uid = nameEl.getAttribute('data-uid');
    const key = nameEl.getAttribute('data-key');
    let sel = uid ? this.points.find((p) => p.uid === uid) : null;
    if (!sel && key) sel = this.points.find((p) => p.pairKey === key);
    if (!sel) return;

    this.selectedUid = sel.uid;
    this.refreshMarkers();
    const renameTop = $('#lm-rename');
    if (renameTop) renameTop.value = sel.name || '';

    const old = sel.name || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lm-name-edit';
    input.value = old;
    input.setAttribute('aria-label', '路标改名');
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        const name = (input.value || '').trim() || old;
        this._applyRename(sel, name);
      } else {
        this.refreshList();
      }
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** 只改显示名，不改 pairKey（稳定英文 id，供重算/导出） */
  _applyRename(sel, name) {
    if (!sel) return;
    const n = String(name || '').trim() || sel.name;
    sel.name = n;
    if (sel.pairKey) {
      for (const p of this.points) {
        if (p.pairKey === sel.pairKey) p.name = n;
      }
    }
    const rename = $('#lm-rename');
    if (rename) rename.value = n;
    this.refreshList();
    this.refreshMarkers();
    this.host.setStatus?.(`已改名「${n}」`);
  }

  renameSelected() {
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (!sel) return;
    const name = ($('#lm-rename')?.value || '').trim() || sel.name;
    this._applyRename(sel, name);
  }

  deleteSelected() {
    if (!this.selectedUid) return;
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (!sel) return;
    this.points = this.points.filter((p) => p.uid !== sel.uid);
    this.selectedUid = null;
    this.refreshMarkers();
    this.refreshList();
  }

  onPointerDown(ev) {
    if (ev.button !== 0) return;

    // —— 空闲：点上选中并开始拖；空白处取消选中，交给 Orbit ——
    if (this.mode === 'idle') {
      const hitMarker = this.pickMarker(ev);
      if (hitMarker) {
        const uid = hitMarker.userData.lmUid;
        this.select(uid);
        const sel = this.points.find((p) => p.uid === uid);
        if (!sel) return;
        ev.preventDefault();
        ev.stopPropagation();
        this._dragging = true;
        this._dragSide = sel.side;
        this._setOrbitEnabled(false);
        this.host.canvas.setPointerCapture?.(ev.pointerId);
        window.addEventListener('pointermove', this._onMove);
        window.addEventListener('pointerup', this._onUp);
        return;
      }
      // 点在空白：取消选中，允许旋转
      if (this.selectedUid) this.clearSelection();
      this._setOrbitEnabled(true);
      return;
    }

    if (this.mode === 'pair') {
      const hitMarker = this.pickMarker(ev);
      if (!hitMarker) {
        // 配对模式下点空白：退出配对并取消选中
        this.setMode('idle');
        this.clearSelection();
        return;
      }
      this._handlePairClick(hitMarker.userData.lmUid);
      ev.preventDefault();
      return;
    }

    if (this.mode === 'add-gnm' || this.mode === 'add-euro') {
      // 加点时若点到已有路标：改为选中并拖（与空闲一致），方便纠错
      const hitMarker = this.pickMarker(ev);
      if (hitMarker) {
        const uid = hitMarker.userData.lmUid;
        this.select(uid);
        const sel = this.points.find((p) => p.uid === uid);
        if (sel) {
          ev.preventDefault();
          this._dragging = true;
          this._dragSide = sel.side;
          this._setOrbitEnabled(false);
          this.host.canvas.setPointerCapture?.(ev.pointerId);
          window.addEventListener('pointermove', this._onMove);
          window.addEventListener('pointerup', this._onUp);
        }
        return;
      }
      const side = this.mode === 'add-euro' ? 'euro' : 'gnm';
      const hit = this.pickMesh(ev, side);
      if (!hit) {
        this.host.setStatus?.('未点中表面，可拖动旋转后再点（或再点工具退出）');
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      this._addAtHit(hit, side);
      return;
    }
  }

  onPointerMove(ev) {
    if (!this._dragging) return;
    const side = this._dragSide || this._selectedSide();
    const hit = this.pickMesh(ev, side);
    if (!hit) return;
    this._moveSelectedToHit(hit, side);
  }

  onPointerUp(ev) {
    if (!this._dragging) return;
    this._dragging = false;
    this._dragSide = null;
    try {
      this.host.canvas.releasePointerCapture?.(ev.pointerId);
    } catch (_) {
      /* ignore */
    }
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this._setOrbitEnabled(this._orbitAllowed());
    this.refreshMarkers();
    this.refreshList();
  }

  _selectedSide() {
    return this.points.find((p) => p.uid === this.selectedUid)?.side || 'gnm';
  }

  _addAtHit(hit, side) {
    const norm = this.host.getNorm?.();
    let pos;
    if (side === 'gnm') {
      pos = inverseNormalizePoint([hit.point.x, hit.point.y, hit.point.z], norm);
    } else {
      this.host.euroRoot.updateMatrixWorld(true);
      const local = this.host.euroRoot.worldToLocal(hit.point.clone());
      pos = [local.x, local.y, local.z];
    }
    const n = this.points.filter((p) => p.side === side).length + 1;
    const name = `自加点${n}`;
    const pt = { uid: uid(), name, side, pos, pairKey: null, weight: 1 };
    this.points.push(pt);
    this.selectedUid = pt.uid;
    this.refreshMarkers();
    this.refreshList();
    this.host.setStatus?.(`已添加${side === 'gnm' ? '粉' : '黄'}点：${name}`);
  }

  /** 将射线命中写入任意路标（不依赖当前选中） */
  _applyHitToPoint(point, hit) {
    if (!point || !hit?.point) return false;
    const norm = this.host.getNorm?.();
    if (point.side === 'gnm') {
      point.pos = inverseNormalizePoint([hit.point.x, hit.point.y, hit.point.z], norm);
    } else {
      this.host.euroRoot.updateMatrixWorld(true);
      const local = this.host.euroRoot.worldToLocal(hit.point.clone());
      point.pos = [local.x, local.y, local.z];
    }
    this._syncMarkerPos(point);
    return true;
  }

  _moveSelectedToHit(hit, side) {
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (!sel) {
      this.host.setStatus?.('请先选中要移动的点');
      return;
    }
    if (sel.side !== side) {
      this.host.setStatus?.(`当前选中是${sel.side === 'gnm' ? '粉' : '黄'}点，请点到对应模型上`);
      return;
    }

    this._applyHitToPoint(sel, hit);

    // 左右对称点：按头中矢状面镜像跟随（同侧粉或同侧黄）
    if (this._pairLinkEnabled() && !this._pairLinkLock) {
      this._pairLinkLock = true;
      try {
        this._syncLrMirrorPartner(sel);
      } finally {
        this._pairLinkLock = false;
      }
    }
  }

  _pairLinkEnabled() {
    return $('#lm-pair-link')?.checked !== false;
  }

  /** pairKey / 名里的 _L↔_R（或尾缀 L↔R） */
  _lrSiblingKey(key) {
    if (!key || typeof key !== 'string') return null;
    if (/_L$/i.test(key)) return key.replace(/_L$/i, '_R');
    if (/_R$/i.test(key)) return key.replace(/_R$/i, '_L');
    if (/(^|[^A-Za-z])L$/i.test(key) && !/_R$/i.test(key)) {
      return key.replace(/L$/i, (m) => (m === 'L' ? 'R' : 'r'));
    }
    if (/(^|[^A-Za-z])R$/i.test(key) && !/_L$/i.test(key)) {
      return key.replace(/R$/i, (m) => (m === 'R' ? 'L' : 'l'));
    }
    return null;
  }

  /** 同侧左右对称点（外眼角L↔R），不是粉↔黄 */
  _lrPartner(point) {
    if (!point) return null;
    const sib =
      this._lrSiblingKey(point.pairKey) ||
      this._lrSiblingKey(point.name);
    if (!sib) return null;
    return (
      this.points.find(
        (p) =>
          p.uid !== point.uid &&
          p.side === point.side &&
          (p.pairKey === sib ||
            p.name === sib ||
            this._lrSiblingKey(p.pairKey) === point.pairKey ||
            this._lrSiblingKey(p.name) === point.name)
      ) || null
    );
  }

  /**
   * 该侧头部中矢状面（世界坐标）：原点取中线点/头心，法线取模型局部 +X（左右轴）的世界方向。
   * 头被预变换转过时，法线跟着模型走，而不是固定世界竖切面。
   */
  _headMidSagittalWorld(side) {
    const root = side === 'euro' ? this.host.euroRoot : this.host.gnmRoot;
    if (!root) return null;
    root.updateMatrixWorld(true);

    const midlineKeys = new Set([
      'glabella',
      'nasion',
      'pronasale',
      'subnasale',
      'pogonion',
      'sellion',
    ]);
    const midWorlds = [];
    for (const p of this.points) {
      if (p.side !== side || !midlineKeys.has(p.pairKey)) continue;
      const w = this._surfaceWorldPos(p);
      if (w) midWorlds.push(w);
    }
    const origin = new THREE.Vector3();
    if (midWorlds.length) {
      for (const w of midWorlds) origin.add(w);
      origin.multiplyScalar(1 / midWorlds.length);
    } else {
      origin.copy(this.host.getHeadCenterWorld?.() || new THREE.Vector3(0, 0.15, 0));
    }

    // 模型局部 +X → 世界：解剖学左右轴；随 euroPivot/euroRoot 旋转
    const normal = new THREE.Vector3().setFromMatrixColumn(root.matrixWorld, 0);
    if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0);
    else normal.normalize();

    return { origin, normal };
  }

  _mirrorWorldAcrossPlane(world, origin, normal) {
    const v = world.clone().sub(origin);
    const d = v.dot(normal);
    return world.clone().addScaledVector(normal, -2 * d);
  }

  /** 世界坐标 → 路标存储坐标（GNM native / 欧版 local） */
  _worldToStoragePos(side, world) {
    if (!world) return null;
    if (side === 'gnm') {
      const norm = this.host.getNorm?.();
      if (!norm) return null;
      return inverseNormalizePoint([world.x, world.y, world.z], norm);
    }
    if (!this.host.euroRoot) return null;
    this.host.euroRoot.updateMatrixWorld(true);
    const local = this.host.euroRoot.worldToLocal(world.clone());
    return [local.x, local.y, local.z];
  }

  /**
   * 在目标世界点附近短距贴到模型表面（避免整轴对侧外壳把前脸点打到脸颊深处）。
   * 优先沿中剖面法线 ± 方向；再沿「头心→点」；再取近处命中。
   */
  _snapWorldNearSurface(side, world, frame, maxDist = 0.028) {
    const root = side === 'euro' ? this.host.euroRoot : this.host.gnmRoot;
    if (!root || !world) return null;
    root.updateMatrixWorld(true);

    const origin = frame?.origin || this.host.getHeadCenterWorld?.() || new THREE.Vector3();
    const normal = (frame?.normal || new THREE.Vector3(1, 0, 0)).clone().normalize();
    const sideSign = Math.sign(world.clone().sub(origin).dot(normal)) || 1;

    const prevNear = this.raycaster.near;
    const prevFar = this.raycaster.far;
    this.raycaster.near = 0;
    this.raycaster.far = maxDist;

    let best = null;
    let bestD = Infinity;
    const consider = (hits) => {
      for (const h of hits || []) {
        if (h.object?.userData?._overlayHiddenJunk) continue;
        const dPlane = h.point.clone().sub(origin).dot(normal);
        // 尽量留在几何镜像同一侧，避免吸到中线另一侧
        if (Math.sign(dPlane) !== 0 && Math.sign(dPlane) !== sideSign) continue;
        const d = h.point.distanceTo(world);
        if (d < bestD && d <= maxDist) {
          bestD = d;
          best = h.point.clone();
        }
      }
    };

    const dirs = [
      normal.clone(),
      normal.clone().negate(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    const center = this.host.getHeadCenterWorld?.();
    if (center) {
      const radial = world.clone().sub(center);
      if (radial.lengthSq() > 1e-12) dirs.push(radial.normalize(), radial.clone().negate());
    }

    for (const dir of dirs) {
      if (dir.lengthSq() < 1e-12) continue;
      dir.normalize();
      this.raycaster.set(world.clone().addScaledVector(dir, -1e-4), dir);
      consider(this.raycaster.intersectObject(root, true));
    }

    // 从头心穿过目标再贴一次（适合颧弓外侧）
    if (center) {
      const out = world.clone().sub(center);
      if (out.lengthSq() > 1e-12) {
        out.normalize();
        this.raycaster.far = center.distanceTo(world) + maxDist;
        this.raycaster.set(center.clone(), out);
        const hits = this.raycaster.intersectObject(root, true);
        for (const h of hits || []) {
          if (h.object?.userData?._overlayHiddenJunk) continue;
          const d = h.point.distanceTo(world);
          if (d < bestD && d <= maxDist) {
            bestD = d;
            best = h.point.clone();
          }
        }
      }
    }

    this.raycaster.near = prevNear;
    this.raycaster.far = prevFar;
    return best;
  }

  /**
   * 左右对称目标存储坐标：
   * 1) 相对头中剖面做等距几何镜像（前脸对应更准，距离不会差很大）
   * 2) 在镜像点附近短距贴面（可有微小不对称，但贴在表面上）
   */
  _mirroredStoragePos(point) {
    if (!point) return null;
    const frame = this._headMidSagittalWorld(point.side);
    if (!frame) return null;
    const srcW = this._surfaceWorldPos(point);
    if (!srcW) return null;
    const mirrored = this._mirrorWorldAcrossPlane(srcW, frame.origin, frame.normal);
    const snapped = this._snapWorldNearSurface(point.side, mirrored, frame);
    const dstW = snapped || mirrored;
    return this._worldToStoragePos(point.side, dstW);
  }

  /** 将 moved 的当前位置联动到左右对称点并贴面。成功返回 true。 */
  _syncLrMirrorPartner(moved) {
    const partner = this._lrPartner(moved);
    if (!partner) return false;
    const pos = this._mirroredStoragePos(moved);
    if (!pos) return false;
    partner.pos = pos;
    this._syncMarkerPos(partner);
    return true;
  }

  /**
   * 从当前选中点生成 L↔R 镜像点。
   * - 名称 / pairKey 自动 L↔R
   * - 若选中点已粉黄配对，两侧都镜像，新两点用新 pairKey 配对
   * - 镜像侧已存在则更新坐标，不重复加点
   */
  generateMirrorFromSelected() {
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (!sel) {
      this.host.setStatus?.('请先选中要镜像的点（粉或黄）');
      return;
    }

    const newName = this._lrSiblingKey(sel.name);
    const newKeyFromPair = this._lrSiblingKey(sel.pairKey);
    if (!newName && !newKeyFromPair) {
      this.host.setStatus?.(
        '名称或配对键需带 L/R 才能生成镜像（例如「外眼角L」或 pairKey 以 _L/_R 结尾）'
      );
      return;
    }

    const sources = sel.pairKey
      ? this.points.filter((p) => p.pairKey === sel.pairKey)
      : [sel];
    if (!sources.length) {
      this.host.setStatus?.('未找到源点');
      return;
    }

    // 统一新名、新键：优先用显示名互换；pairKey 有 L/R 则互换，否则用新名当键
    const mirrorName = newName || this._lrSiblingKey(sources[0].name);
    const mirrorKey = newKeyFromPair || mirrorName;
    if (!mirrorName || !mirrorKey) {
      this.host.setStatus?.('无法从当前名称生成镜像名，请先把名称改成带 L 或 R');
      return;
    }
    if (mirrorKey === sel.pairKey || (sel.pairKey && mirrorKey === sel.pairKey)) {
      this.host.setStatus?.('镜像键与源相同，请检查命名');
      return;
    }

    let created = 0;
    let updated = 0;
    const outUids = [];

    for (const src of sources) {
      const pos = this._mirroredStoragePos(src);
      if (!pos) {
        this.host.setStatus?.(`镜像失败：无法计算「${src.name}」的对称位置`);
        return;
      }
      const srcMirrorName = this._lrSiblingKey(src.name) || mirrorName;
      let dst =
        this.points.find(
          (p) =>
            p.side === src.side &&
            (p.pairKey === mirrorKey ||
              (p.name === srcMirrorName && !p.pairKey) ||
              p.name === srcMirrorName)
        ) || null;

      // 避免误匹配到源点自己
      if (dst && sources.some((s) => s.uid === dst.uid)) dst = null;

      if (dst) {
        dst.pos = pos;
        dst.name = srcMirrorName;
        dst.pairKey = mirrorKey;
        dst.weight = src.weight ?? dst.weight ?? 1;
        this._syncMarkerPos(dst);
        updated += 1;
        outUids.push(dst.uid);
      } else {
        const pt = {
          uid: uid(),
          name: srcMirrorName,
          side: src.side,
          pos,
          pairKey: mirrorKey,
          weight: src.weight ?? 1,
        };
        this.points.push(pt);
        created += 1;
        outUids.push(pt.uid);
      }
    }

    // 确保本次产出的点共用 mirrorKey（粉黄配对）
    for (const id of outUids) {
      const p = this.points.find((x) => x.uid === id);
      if (p) {
        p.pairKey = mirrorKey;
        if (!this._lrSiblingKey(p.name)) p.name = mirrorName;
      }
    }

    const pick = outUids[0];
    if (pick) this.selectedUid = pick;
    this.refreshMarkers();
    this.refreshList();
    const bits = [];
    if (created) bits.push(`新建 ${created}`);
    if (updated) bits.push(`更新 ${updated}`);
    this.host.setStatus?.(
      `已生成镜像「${mirrorName}」（${bits.join(' · ') || '无变化'}）· 配对键 ${mirrorKey}`
    );
  }

  /**
   * 相对屏幕平移选中路标（像素）；若开启联动，左右对称点按头中矢状面镜像跟随。
   * @param {number} dxPx 右为正
   * @param {number} dyPx 下为正
   */
  nudgeSelectedScreen(dxPx, dyPx) {
    const sel = this.points.find((p) => p.uid === this.selectedUid);
    if (!sel) return;
    const canvas = this.host.canvas;
    const cam = this.host.camera;
    if (!canvas || !cam) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    cam.updateMatrixWorld(true);
    const moved = this._nudgePointByScreenDelta(sel, dxPx, dyPx, rect);
    if (!moved) {
      this.host.setStatus?.('微调未落到可靠表面（可换角度再按方向键）');
      return;
    }

    let linked = false;
    if (this._pairLinkEnabled() && !this._pairLinkLock) {
      this._pairLinkLock = true;
      try {
        linked = this._syncLrMirrorPartner(sel);
      } finally {
        this._pairLinkLock = false;
      }
    }

    this.refreshList();
    const linkHint = linked ? ' · 已镜像对称点' : '';
    this.host.setStatus?.(
      `已微调「${sel.name || sel.pairKey || ''}」· 方向键移动 · Shift=1px 细调${linkHint}`
    );
  }

  /**
   * 将任意路标按屏幕像素位移贴面移动。成功返回 true。
   */
  _nudgePointByScreenDelta(point, dxPx, dyPx, rect) {
    if (!point || !rect) return false;
    const cam = this.host.camera;
    if (!cam) return false;
    cam.updateMatrixWorld(true);

    const originPos = point.pos.slice(0, 3);
    const s0 = this._screenPosOfPoint(point, rect);
    if (!s0) return false;
    const desired = {
      x: Math.min(rect.width - 1, Math.max(0, s0.x + dxPx)),
      y: Math.min(rect.height - 1, Math.max(0, s0.y + dyPx)),
    };
    const req = Math.hypot(dxPx, dyPx) || 1;
    const maxJump = Math.max(14, req * 4);
    const preferX = Math.abs(dxPx) >= Math.abs(dyPx);

    let moved = false;
    for (let iter = 0; iter < 8; iter++) {
      const s = this._screenPosOfPoint(point, rect);
      if (!s) break;
      const ex = desired.x - s.x;
      const ey = desired.y - s.y;
      const err = Math.hypot(ex, ey);
      if (err < 0.4) break;

      const beforePos = point.pos.slice(0, 3);
      const damp = iter === 0 ? 1 : 0.7;
      if (!this._nudgeOnceTowardScreen(point, ex * damp, ey * damp, rect)) {
        point.pos = beforePos;
        this._syncMarkerPos(point);
        break;
      }
      const s1 = this._screenPosOfPoint(point, rect);
      if (!s1) {
        point.pos = beforePos;
        this._syncMarkerPos(point);
        break;
      }
      const jump = Math.hypot(s1.x - s.x, s1.y - s.y);
      const err1 = Math.hypot(desired.x - s1.x, desired.y - s1.y);
      const primaryOk = preferX
        ? Math.sign(s1.x - s.x) === Math.sign(ex || dxPx) && Math.abs(s1.x - s.x) > 0.25
        : Math.sign(s1.y - s.y) === Math.sign(ey || dyPx) && Math.abs(s1.y - s.y) > 0.25;
      if (jump > maxJump || (err1 > err + 1.0 && !primaryOk)) {
        point.pos = beforePos;
        this._syncMarkerPos(point);
        break;
      }
      moved = true;
    }

    const sEnd = this._screenPosOfPoint(point, rect);
    if (sEnd) {
      const totalJump = Math.hypot(sEnd.x - s0.x, sEnd.y - s0.y);
      if (totalJump > maxJump) {
        point.pos = originPos;
        this._syncMarkerPos(point);
        return false;
      }
      // 屏幕几乎没动则不算成功（避免误报联动）
      if (totalJump < 0.35) {
        point.pos = originPos;
        this._syncMarkerPos(point);
        return false;
      }
    } else if (!moved) {
      return false;
    }
    return moved;
  }

  _syncMarkerPos(sel) {
    const mesh = this.markerByUid.get(sel.uid);
    if (mesh) mesh.position.copy(this.worldPosFor(sel));
    else this.refreshMarkers();
  }

  /** 路标当前屏幕像素坐标（相对 canvas 左上；优先用可见标记球，与肉眼一致） */
  _screenPosOfPoint(point, rect) {
    const cam = this.host.camera;
    cam.updateMatrixWorld(true);
    const mesh = this.markerByUid.get(point.uid);
    const world = mesh ? mesh.position.clone() : this.worldPosFor(point);
    if (!world || !Number.isFinite(world.x)) return null;
    const ndc = world.project(cam);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
    return {
      x: (ndc.x * 0.5 + 0.5) * rect.width,
      y: (-ndc.y * 0.5 + 0.5) * rect.height,
    };
  }

  /** 路标在模型表面上的世界坐标（不含 marker outset） */
  _surfaceWorldPos(point) {
    const norm = this.host.getNorm?.();
    if (point.side === 'gnm') {
      const d = applyNormalizePoint(point.pos, norm);
      return new THREE.Vector3(d[0], d[1], d[2]);
    }
    this.host.euroRoot.updateMatrixWorld(true);
    return this.host.euroRoot.localToWorld(
      new THREE.Vector3(point.pos[0], point.pos[1], point.pos[2])
    );
  }

  /** 在命中列表里选最靠近参考点的，且不能离太远 */
  _pickNearestHit(hits, ref, maxDist = 0.02) {
    if (!hits?.length || !ref) return null;
    let best = null;
    let bestD = Infinity;
    for (const h of hits) {
      const d = h.point.distanceToSquared(ref);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (!best || bestD > maxDist * maxDist) return null;
    return best;
  }

  /**
   * 朝屏幕误差 (ex,ey) 走一步并吸附。返回是否成功写入。
   */
  _nudgeOnceTowardScreen(sel, ex, ey, rect) {
    const cam = this.host.camera;
    const world = this._surfaceWorldPos(sel);
    if (!world) return false;

    const camPos = new THREE.Vector3();
    cam.getWorldPosition(camPos);
    const dist = Math.max(1e-4, camPos.distanceTo(world));

    let worldPerPixelX;
    let worldPerPixelY;
    if (cam.isPerspectiveCamera) {
      const vFov = (cam.fov * Math.PI) / 180;
      worldPerPixelY = (2 * Math.tan(vFov / 2) * dist) / rect.height;
      worldPerPixelX = (2 * Math.tan(vFov / 2) * cam.aspect * dist) / rect.width;
    } else if (cam.isOrthographicCamera) {
      worldPerPixelY = (cam.top - cam.bottom) / rect.height;
      worldPerPixelX = (cam.right - cam.left) / rect.width;
    } else {
      worldPerPixelY = dist * 0.001;
      worldPerPixelX = worldPerPixelY;
    }

    const center = this.host.getHeadCenterWorld?.() || new THREE.Vector3(0, 0.15, 0);
    let normal = world.clone().sub(center);
    if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    else normal.normalize();

    const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const tRight = camRight.clone().addScaledVector(normal, -camRight.dot(normal));
    const tUp = camUp.clone().addScaledVector(normal, -camUp.dot(normal));

    let delta;
    if (tRight.lengthSq() > 1e-8 && tUp.lengthSq() > 1e-8) {
      tRight.normalize();
      tUp.normalize();
      delta = tRight
        .clone()
        .multiplyScalar(ex * worldPerPixelX)
        .add(tUp.clone().multiplyScalar(-ey * worldPerPixelY));
    } else {
      delta = camRight
        .clone()
        .multiplyScalar(ex * worldPerPixelX)
        .add(camUp.clone().multiplyScalar(-ey * worldPerPixelY));
    }

    const target = world.clone().add(delta);
    const root = sel.side === 'euro' ? this.host.euroRoot : this.host.gnmRoot;
    const nearRef = target;
    const maxDist = Math.max(0.028, delta.length() * 3 + 0.012);

    // 1) 外侧沿法线打回
    this.raycaster.set(target.clone().addScaledVector(normal, 0.03), normal.clone().negate());
    let hit = this._pickNearestHit(
      this.raycaster.intersectObject(root, true),
      nearRef,
      maxDist
    );
    // 2) 相机穿过目标
    if (!hit) {
      const dir = target.clone().sub(camPos);
      if (dir.lengthSq() > 1e-12) {
        this.raycaster.set(camPos, dir.normalize());
        hit = this._pickNearestHit(
          this.raycaster.intersectObject(root, true),
          nearRef,
          maxDist
        );
      }
    }
    // 3) 退一步：仍靠近「当前点」的法线投射
    if (!hit) {
      this.raycaster.set(world.clone().addScaledVector(normal, 0.03), normal.clone().negate());
      // 不移动时不该走到这；作为贴面保底
      hit = this._pickNearestHit(
        this.raycaster.intersectObject(root, true),
        world,
        0.01
      );
      if (hit) {
        // 保底命中若几乎没动，视为失败，避免空转
        if (hit.point.distanceTo(world) < 1e-5) return false;
      }
    }
    if (!hit) return false;
    // 必须写到传入的 point：配对联动时另一侧不是 selectedUid
    return this._applyHitToPoint(sel, hit);
  }

  _handlePairClick(uid) {
    const pt = this.points.find((p) => p.uid === uid);
    if (!pt) return;

    // Unpair if already paired and clicked again as first pick
    if (pt.pairKey && !this.pairPickUid) {
      const key = pt.pairKey;
      for (const p of this.points) {
        if (p.pairKey === key) p.pairKey = null;
      }
      this.select(uid);
      this.host.setStatus?.(`已解除配对：${key}`);
      this.refreshMarkers();
      this.refreshList();
      return;
    }

    if (!this.pairPickUid) {
      this.pairPickUid = uid;
      this.select(uid);
      this.host.setStatus?.(`已选 ${pt.side === 'gnm' ? '粉' : '黄'}点，请再选另一侧（图中点球或列表「粉/黄」）`);
      return;
    }
    const a = this.points.find((p) => p.uid === this.pairPickUid);
    const b = pt;
    this.pairPickUid = null;
    if (!a || a.uid === b.uid) return;
    if (a.side === b.side) {
      this.host.setStatus?.('配对需要一粉一黄');
      return;
    }
    const key = a.pairKey || b.pairKey || a.name || b.name || uid();
    a.pairKey = key;
    b.pairKey = key;
    b.name = a.name || b.name;
    a.name = b.name;
    this.select(b.uid);
    this.host.setStatus?.(`已配对：${key}`);
    this.refreshMarkers();
    this.refreshList();
  }

  pickMarker(ev) {
    this._setNdc(ev);
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    const markers = [...this.markerByUid.values()].filter((m) => m.visible);
    const hits = this.raycaster.intersectObjects(markers, false);
    return hits[0]?.object || null;
  }

  pickMesh(ev, side) {
    this._setNdc(ev);
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    const root = side === 'euro' ? this.host.euroRoot : this.host.gnmRoot;
    const hits = this.raycaster.intersectObject(root, true);
    return hits[0] || null;
  }

  _setNdc(ev) {
    const rect = this.host.canvas.getBoundingClientRect();
    this.ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  toJSON() {
    const warpSnapshot = this.host.getWarpSnapshotForSave?.() || null;
    const eyeAlignSnapshot = this.host.getEyeAlignSnapshotForSave?.() || null;
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      preTrs: this.host.getPreTrs?.() || null,
      // 保存当下欧版内层姿态；只挪路标未点「重算」时，加载应恢复此矩阵而非重算
      alignSnapshot: this.host.getAlignSnapshot?.() || null,
      warpSnapshot,
      eyeAlignSnapshot,
      points: this.points.map((p) => ({
        uid: p.uid,
        name: p.name,
        side: p.side,
        pos: p.pos.slice(0, 3),
        pairKey: p.pairKey,
        weight: p.weight,
      })),
    };
  }

  fromJSON(data, { applyPreTrs = true } = {}) {
    if (!data?.points?.length) throw new Error('无效点集');
    this.points = data.points.map((p) => ({
      uid: p.uid || uid(),
      name: p.name || 'pt',
      side: p.side === 'euro' ? 'euro' : 'gnm',
      pos: p.pos.slice(0, 3),
      pairKey: p.pairKey || null,
      weight: p.weight ?? 1,
    }));
    this.selectedUid = null;
    if (applyPreTrs && data.preTrs != null) {
      this.host.applyPreTrs?.(data.preTrs);
    }
    this.refreshMarkers();
    this.refreshList();
  }

  _latestHistoryMeta(versions) {
    if (!versions?.length) return null;
    return [...versions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  }

  /** 载入磁盘上最近一条历史（按 createdAt） */
  async loadLatestHistory({ statusPrefix } = {}) {
    let index = { versions: [] };
    for (let attempt = 0; attempt < 3; attempt++) {
      index = await this._fetchHistoryIndex();
      if (index.versions?.length) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150));
    }
    const versions = index.versions || [];
    await this.refreshHistorySelect(index);
    const meta = this._latestHistoryMeta(versions);
    if (!meta) return null;
    const hit = await this._fetchHistoryEntry(meta);
    if (!hit?.payload) return null;
    const note = hit.note ? `「${hit.note}」` : meta.id;
    const msg = this.applyHistoryEntry(hit, {
      statusPrefix: statusPrefix || `已自动加载最近历史 ${note}`,
    });
    const sel = $('#lm-hist-select');
    if (sel) sel.value = meta.id;
    this._lastStatus = msg;
    return msg;
  }

  /**
   * 应用一条历史记录：路标 + 预变换 +（若有）对齐矩阵。
   * 有 alignSnapshot 时不重算，保证「只挪路标」存的版本刷新后姿态不变。
   * @returns {string} 状态文案
   */
  applyHistoryEntry(hit, { statusPrefix } = {}) {
    if (!hit?.payload) throw new Error('该版本数据无效');
    const savedPreTrs = hit.preTrs ?? hit.payload?.preTrs ?? null;
    const snap = hit.alignSnapshot ?? hit.payload?.alignSnapshot ?? null;
    const warpSnap = hit.warpSnapshot ?? hit.payload?.warpSnapshot ?? null;
    const eyeAlignSnap = hit.eyeAlignSnapshot ?? hit.payload?.eyeAlignSnapshot ?? null;
    this.fromJSON(hit.payload, { applyPreTrs: false });
    this.host.applyPreTrs?.(savedPreTrs);
    const note = hit.note ? `「${hit.note}」` : hit.id || '';
    const trs = this._preTrsSummary(savedPreTrs);
    const trsHint = trs ? `，预变换 ${trs}` : savedPreTrs ? '，含预变换' : '';
    const prefix =
      statusPrefix || `已加载历史 ${note}（${this.points.length} 点${trsHint}）`;

    let alignHint = '';
    if (snap && this.host.applyAlignSnapshot?.(snap)) {
      alignHint = ' · 已恢复对齐姿态（未重算）';
    } else {
      try {
        this.recompute();
        alignHint = ' · 旧版无对齐矩阵，已按路标重算（请确认后重新存版本）';
      } catch (reErr) {
        const msg = `${prefix}。重算失败：${reErr.message || reErr}`;
        this.host.setStatus?.(msg);
        return msg;
      }
    }

    // 先恢复未拧网格，再按版本决定是否拧
    this.host.restoreEuroMesh?.();
    let warpHint = ' · 欧版未拧';
    if (warpSnap?.src?.length >= 4) {
      const wr = this.host.applyWarpSnapshot?.(warpSnap);
      if (wr?.ok) {
        warpHint = ` · 已恢复拧形（${wr.nPairs} 对 · 残差 ${wr.landmarkResidualMm.toFixed(1)} mm）`;
      } else if (wr?.reason === 'degenerate-snapshot') {
        warpHint = ' · 拧形快照无效（粉黄已重合误存），请重新点「拧」后另存';
      } else {
        warpHint = ' · 拧形快照无效，已保持未拧';
      }
    } else {
      this.host._reprepareEuroAfterWarp?.();
    }

    let eyeHint = '';
    if (eyeAlignSnap) {
      const er = this.host.applyEyeAlignSnapshot?.(eyeAlignSnap);
      if (er?.ok) {
        eyeHint = ' · 已恢复眼球重合';
      } else {
        eyeHint = ' · 眼球快照无效';
      }
    } else {
      this.host._eyeAlignSnapshot = null;
    }

    const msg = `${prefix}${alignHint}${warpHint}${eyeHint}`;
    this._lastStatus = msg;
    this.host.setStatus?.(msg);
    this.refreshMarkers();
    this.refreshList();
    return msg;
  }

  exportJson() {
    const blob = new Blob([JSON.stringify(this.toJSON(), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'align_landmarks_edit.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  importFile(ev) {
    const file = ev.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        this.fromJSON(data);
        this.host.applyPreTrs?.(data.preTrs);
        if (data.alignSnapshot) this.host.applyAlignSnapshot?.(data.alignSnapshot);
        this.host.restoreEuroMesh?.();
        if (data.warpSnapshot?.src?.length >= 4) {
          this.host.applyWarpSnapshot?.(data.warpSnapshot);
        }
        if (data.eyeAlignSnapshot) {
          this.host.applyEyeAlignSnapshot?.(data.eyeAlignSnapshot);
        } else {
          this.host.applyEyeAlignSnapshot?.(null);
        }
        this.host.setStatus?.(`已导入 ${this.points.length} 个点（含预变换/拧形/眼球则已恢复）`);
      } catch (e) {
        this.host.setStatus?.(`导入失败：${e.message || e}`);
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
      this.host.setStatus?.('路标已写入 localStorage（覆盖槽）');
    } catch (e) {
      this.host.setStatus?.(`本地保存失败：${e.message || e}`);
    }
  }

  loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.host.setStatus?.('本地无已存路标');
        return;
      }
      this.fromJSON(JSON.parse(raw));
      const data = JSON.parse(raw);
      this.host.applyPreTrs?.(data.preTrs);
      if (data.alignSnapshot) this.host.applyAlignSnapshot?.(data.alignSnapshot);
      this.host.restoreEuroMesh?.();
      if (data.warpSnapshot?.src?.length >= 4) {
        this.host.applyWarpSnapshot?.(data.warpSnapshot);
      }
      if (data.eyeAlignSnapshot) {
        this.host.applyEyeAlignSnapshot?.(data.eyeAlignSnapshot);
      } else {
        this.host._eyeAlignSnapshot = null;
      }
      this.host.setStatus?.(`已从本地载入 ${this.points.length} 个点（含预变换/拧形/眼球则已恢复）`);
    } catch (e) {
      this.host.setStatus?.(`本地载入失败：${e.message || e}`);
    }
  }

  _preTrsSummary(pre) {
    if (!pre || typeof pre !== 'object') return '';
    const fmt = (n, d = 2) => {
      const x = Number(n) || 0;
      const s = x.toFixed(d);
      return s.replace(/\.?0+$/, '') || '0';
    };
    const bits = [];
    const rx = Number(pre.rxDeg) || 0;
    const ry = Number(pre.ryDeg) || 0;
    const rz = Number(pre.rzDeg) || 0;
    if (Math.abs(rx) > 0.05) bits.push(`rx=${fmt(rx, 4)}`);
    if (Math.abs(ry) > 0.05) bits.push(`ry=${fmt(ry, 4)}`);
    if (Math.abs(rz) > 0.05) bits.push(`rz=${fmt(rz, 4)}`);
    const tx = Number(pre.txMm) || 0;
    const ty = Number(pre.tyMm) || 0;
    const tz = Number(pre.tzMm) || 0;
    if (Math.abs(tx) + Math.abs(ty) + Math.abs(tz) > 0.2) {
      bits.push(`t=${fmt(tx, 2)}/${fmt(ty, 2)}/${fmt(tz, 2)}`);
    }
    const su = Number(pre.su) || 1;
    if (Math.abs(su - 1) > 0.005) bits.push(`s=${fmt(su, 3)}`);
    return bits.join(' ');
  }

  _downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async _postHistoryApi(body) {
    let lastErr = null;
    for (const url of HISTORY_API_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        });
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        // 只接受第一个成功响应，避免双 URL 重复写
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('history API unreachable');
  }

  _readLocalStorageHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.versions) ? data.versions : [];
    } catch (_) {
      return [];
    }
  }

  /** 磁盘 index 元数据镜像到 LS（不含 payload）；列表不再从 LS 合并 */
  _mirrorHistoryIndexToLocalStorage(versions) {
    try {
      const metas = (versions || []).map((v) => ({
        id: v.id,
        note: v.note || '',
        createdAt: v.createdAt,
        pointCount: v.pointCount,
        preTrsSummary: v.preTrsSummary || '',
        warpSummary: v.warpSummary || '',
        file: v.file || `${v.id}.json`,
      }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, versions: metas }));
    } catch (_) {}
  }

  _removeLocalStorageHistoryId(id) {
    if (!id) return false;
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.versions)) return false;
      const next = data.versions.filter((v) => v?.id !== id);
      if (next.length === data.versions.length) return false;
      data.versions = next;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 只读磁盘 index.json（权威），不与 LS 合并 */
  async _fetchHistoryIndex() {
    try {
      const res = await fetch(`${HISTORY_DIR_URL}index.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.versions)) {
          return { version: 1, versions: data.versions };
        }
      }
    } catch (_) {}
    return { version: 1, versions: [] };
  }

  async _fetchHistoryEntry(meta) {
    if (meta?.payload) return meta;
    const file = meta?.file || `${meta?.id}.json`;
    const res = await fetch(`${HISTORY_DIR_URL}${file}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`无法读取 ${file} · HTTP ${res.status}`);
    return res.json();
  }

  /**
   * @param {{ versions?: object[] } | null} [indexOverride]
   * @param {{ keepSelection?: boolean }} [opts]
   */
  async refreshHistorySelect(indexOverride = null, opts = {}) {
    const sel = $('#lm-hist-select');
    if (!sel) return;
    const keepSelection = !!opts.keepSelection;
    const prev = keepSelection ? sel.value : '';
    let versions;
    if (indexOverride && Array.isArray(indexOverride.versions)) {
      versions = indexOverride.versions.slice();
    } else {
      const data = await this._fetchHistoryIndex();
      versions = data.versions || [];
    }
    this._historyIndexCache = versions;
    this._mirrorHistoryIndexToLocalStorage(versions);

    sel.innerHTML = '';
    if (!versions.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（暂无历史版本）';
      opt.disabled = true;
      sel.appendChild(opt);
      sel.selectedIndex = -1;
      return;
    }
    const sorted = [...versions].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    for (const v of sorted) {
      const opt = document.createElement('option');
      opt.value = v.id;
      const t = (v.createdAt || '').replace('T', ' ').slice(0, 19);
      const note = v.note ? ` · ${v.note}` : '';
      const n = v.pointCount != null ? ` · ${v.pointCount}点` : '';
      const trs = v.preTrsSummary ? ` · ${v.preTrsSummary}` : '';
      const warp = v.warpSummary ? ` · ${v.warpSummary}` : '';
      const eye = v.eyeSummary ? ` · ${v.eyeSummary}` : '';
      opt.textContent = `${t}${note}${n}${trs}${warp}${eye}`;
      sel.appendChild(opt);
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) {
      sel.value = prev;
    } else {
      sel.selectedIndex = -1;
    }
  }

  /** 把本页 localStorage 里仍带 payload 的旧版本写入磁盘（一次性迁移） */
  async importLocalStorageHistoryToJson() {
    if (this._historyBusy) return;
    this._historyBusy = true;
    try {
      const ls = this._readLocalStorageHistory().filter((v) => v?.id && v?.payload);
      if (!ls.length) {
        this.host.setStatus?.(
          '本页缓存里没有带完整数据的旧历史可导入（列表已以磁盘为准）'
        );
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const entry of ls) {
        const preTrs = entry.preTrs ?? entry.payload?.preTrs ?? null;
        const preTrsSummary = entry.preTrsSummary || this._preTrsSummary(preTrs);
        const pack = {
          id: entry.id,
          note: entry.note || '',
          createdAt: entry.createdAt || new Date().toISOString(),
          pointCount: entry.pointCount ?? entry.payload?.points?.length ?? 0,
          statusSnapshot: entry.statusSnapshot || '',
          preTrs,
          preTrsSummary,
          payload: entry.payload,
        };
        try {
          const api = await this._postHistoryApi({ action: 'save', entry: pack });
          if (api?.ok) ok += 1;
          else fail += 1;
        } catch (_) {
          fail += 1;
        }
      }
      await this.refreshHistorySelect();
      this.host.setStatus?.(
        `导入旧缓存：成功 ${ok} · 失败 ${fail}（失败请确认 18080 已开）`
      );
    } finally {
      this._historyBusy = false;
    }
  }

  async saveHistoryVersion() {
    if (this._historyBusy) return;
    this._historyBusy = true;
    try {
      const note = ($('#lm-hist-note')?.value || '').trim();
      const pack = this.toJSON();
      const preTrs = pack.preTrs || this.host.getPreTrs?.() || null;
      const alignSnapshot = pack.alignSnapshot || this.host.getAlignSnapshot?.() || null;
      const warpSnapshot = pack.warpSnapshot || null;
      const eyeAlignSnapshot = pack.eyeAlignSnapshot || this.host.getEyeAlignSnapshotForSave?.() || null;
      const status = document.querySelector('#status-text')?.textContent || '';
      const id = `v_${Date.now()}`;
      const preTrsSummary = this._preTrsSummary(preTrs);
      const warpSummary = warpSnapshot ? `拧·${warpSnapshot.nPairs}对` : '';
      const eyeSummary = eyeAlignSnapshot ? '眼球重合' : '';
      const entry = {
        id,
        note,
        createdAt: new Date().toISOString(),
        pointCount: pack.points.length,
        statusSnapshot: status,
        preTrs,
        preTrsSummary,
        alignSnapshot,
        warpSnapshot,
        warpSummary,
        eyeAlignSnapshot,
        eyeSummary,
        payload: pack,
      };

      let savedVia = 'download';
      let apiIndex = null;
      try {
        const api = await this._postHistoryApi({ action: 'save', entry });
        if (api?.ok) {
          savedVia = 'json';
          apiIndex = api.index || null;
        }
      } catch (_) {
        this._downloadJson(`${id}.json`, { ...entry, file: `${id}.json` });
        const index = await this._fetchHistoryIndex();
        const meta = {
          id: entry.id,
          note: entry.note,
          createdAt: entry.createdAt,
          pointCount: entry.pointCount,
          preTrsSummary,
          warpSummary,
          eyeSummary,
          file: `${id}.json`,
        };
        index.versions = (index.versions || []).filter((v) => v.id !== id);
        index.versions.push(meta);
        this._downloadJson('index.json', index);
        apiIndex = index;
      }

      if (apiIndex) {
        await this.refreshHistorySelect(apiIndex, { keepSelection: true });
      } else {
        await this.refreshHistorySelect(null, { keepSelection: true });
      }
      const sel = $('#lm-hist-select');
      if (sel) sel.value = id;
      if ($('#lm-hist-note')) $('#lm-hist-note').value = '';
      const where =
        savedVia === 'json'
          ? '已写入 landmarks/history/'
          : 'API 不可用，已下载 JSON（请放入 landmarks/history/）';
      const trsHint = preTrsSummary ? ` · 含预变换 ${preTrsSummary}` : '';
      const warpHint = warpSummary ? ` · ${warpSummary}` : '';
      const eyeHint = eyeSummary ? ` · ${eyeSummary}` : '';
      this.host.setStatus?.(`${where}「${note || id}」${trsHint}${warpHint}${eyeHint}`);
    } catch (e) {
      this.host.setStatus?.(`存版本失败：${e.message || e}`);
    } finally {
      this._historyBusy = false;
    }
  }

  async loadHistorySelected() {
    if (this._historyBusy) return;
    const sel = $('#lm-hist-select');
    const id = sel?.value;
    if (!id) {
      this.host.setStatus?.('请先在列表中选中一个历史版本');
      return;
    }
    if (this._historyLoadingId === id) return;
    this._historyLoadingId = id;
    this._historyBusy = true;
    try {
      const versions =
        this._historyIndexCache || (await this._fetchHistoryIndex()).versions || [];
      const meta = versions.find((v) => v.id === id);
      if (!meta) {
        this.host.setStatus?.('未找到该版本');
        return;
      }
      const hit = await this._fetchHistoryEntry(meta);
      if (!hit?.payload) {
        this.host.setStatus?.('该版本数据无效');
        return;
      }
      this.applyHistoryEntry(hit);
    } catch (e) {
      this.host.setStatus?.(`加载版本失败：${e.message || e}`);
    } finally {
      this._historyBusy = false;
      this._historyLoadingId = null;
    }
  }

  async deleteHistorySelected() {
    if (this._historyBusy) return;
    const sel = $('#lm-hist-select');
    const id = sel?.value;
    if (!id) {
      this.host.setStatus?.('请先选中一个历史版本');
      return;
    }
    const meta = (this._historyIndexCache || []).find((v) => v.id === id);
    const label = meta?.note ? `「${meta.note}」` : id;
    if (!window.confirm(`确定删除历史 ${label}？\n仅删除这一项，不可恢复。`)) {
      return;
    }

    this._historyBusy = true;
    // 立刻从 UI 去掉，防止连点误删下一项
    const snapshot = (this._historyIndexCache || []).filter((v) => v.id !== id);
    await this.refreshHistorySelect({ versions: snapshot });
    if (sel) sel.selectedIndex = -1;

    try {
      let api = null;
      try {
        api = await this._postHistoryApi({ action: 'delete', id });
      } catch (_) {
        api = null;
      }
      this._removeLocalStorageHistoryId(id);
      const diskOk = !!api?.ok;
      if (api?.index) {
        await this.refreshHistorySelect(api.index);
      } else if (!diskOk) {
        await this.refreshHistorySelect();
        this.host.setStatus?.(
          `删除失败：无法写磁盘（请确认 18080 服务）。${label} 已恢复显示`
        );
        return;
      }
      if (sel) sel.selectedIndex = -1;
      this.host.setStatus?.(diskOk ? `已删除历史 ${label}` : `已从列表移除 ${label}`);
    } catch (e) {
      await this.refreshHistorySelect();
      this.host.setStatus?.(`删除失败：${e.message || e}`);
    } finally {
      this._historyBusy = false;
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
