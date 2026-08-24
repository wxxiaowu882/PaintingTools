/**
 * Landmark overlay (2A): compare named points. No mesh deform.
 * 3B: pick on GLB → project with Blender camera_meta → drag-refine on Base/ours PNGs.
 */
export function createLandmarkController(THREE) {
  const DIR = "landmarks";
  let schema = { landmarks: [] };
  let selectedId = "";
  let cameraMeta = null;
  let points3d = { candidate: "", points: {} };
  let base2d = { points: {} };
  let ours2d = { points: {} };
  let pickArmed = false;
  let onRefresh = () => {};

  function viewLandmarks(viewId) {
    return (schema.landmarks || []).filter((lm) => (lm.views || []).includes(viewId));
  }

  function project(xyz, viewId) {
    const cam = cameraMeta && cameraMeta[viewId];
    if (!cam || !cam.inv || !xyz || xyz.length < 3) return null;
    const m = cam.inv;
    const x = xyz[0];
    const y = xyz[1];
    const z = xyz[2];
    const px = m[0] * x + m[1] * y + m[2] * z + m[3];
    const py = m[4] * x + m[5] * y + m[6] * z + m[7];
    const halfH = (cam.ortho_scale || 1) / 2;
    const halfW = halfH * (cam.aspect || 1);
    let u = (px + halfW) / Math.max(2 * halfW, 1e-8);
    let v = (halfH - py) / Math.max(2 * halfH, 1e-8);
    if (cam.flip_h) u = 1 - u;
    if (u < -0.08 || u > 1.08 || v < -0.08 || v > 1.08) return null;
    return { u, v };
  }

  function reprojectOurs(viewId) {
    const pts = {};
    for (const lm of viewLandmarks(viewId)) {
      const xyz = points3d.points[lm.id];
      if (!xyz) continue;
      const uv = project(xyz, viewId);
      if (uv) pts[lm.id] = uv;
    }
    ours2d = { view: viewId, source: "projected", points: pts };
  }

  async function loadAll(cand, viewId) {
    const bust = `?_=${Date.now()}`;
    const [sch, meta, p3, b2, o2] = await Promise.all([
      fetch(`${DIR}/schema.json${bust}`).then((r) => r.json()),
      fetch(`ours/${cand}/camera_meta.json${bust}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${DIR}/${cand}_3d.json${bust}`).then((r) => (r.ok ? r.json() : { candidate: cand, points: {} })),
      fetch(`${DIR}/${cand}_base_${viewId}.json${bust}`).then((r) => (r.ok ? r.json() : { points: {} })),
      fetch(`${DIR}/${cand}_ours_${viewId}.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    schema = sch;
    cameraMeta = meta;
    points3d = p3 && p3.points ? p3 : { candidate: cand, points: {} };
    base2d = b2 && b2.points ? b2 : { points: {} };
    if (o2 && o2.points && Object.keys(o2.points).length) ours2d = o2;
    else reprojectOurs(viewId);
    const ids = viewLandmarks(viewId).map((l) => l.id);
    if (!ids.includes(selectedId)) selectedId = ids[0] || "";
  }

  async function saveJson(relPath, data) {
    const res = await fetch("/api/save-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, data }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function save3d(cand) {
    points3d.candidate = cand;
    await saveJson(`landmarks/${cand}_3d.json`, points3d);
  }

  async function save2d(cand, viewId) {
    await saveJson(`landmarks/${cand}_base_${viewId}.json`, {
      view: viewId,
      source: "base15",
      points: base2d.points,
    });
    await saveJson(`landmarks/${cand}_ours_${viewId}.json`, {
      view: viewId,
      source: ours2d.source || "refined",
      points: ours2d.points,
    });
  }

  function imgBox(img) {
    return {
      w: parseFloat(img.style.width) || img.clientWidth || 0,
      h: parseFloat(img.style.height) || img.clientHeight || 0,
      left: parseFloat(img.style.left) || 0,
      top: parseFloat(img.style.top) || 0,
    };
  }

  function paintOverlay(svg, points, color, img) {
    svg.innerHTML = "";
    if (!img) return;
    const box = imgBox(img);
    const sw = svg.clientWidth || 1;
    const sh = svg.clientHeight || 1;
    svg.setAttribute("viewBox", `0 0 ${sw} ${sh}`);
    for (const [id, uv] of Object.entries(points || {})) {
      const cx = box.left + uv.u * box.w;
      const cy = box.top + uv.v * box.h;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.dataset.id = id;
      g.style.cursor = "grab";
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", id === selectedId ? "7" : "5");
      c.setAttribute("fill", color);
      c.setAttribute("stroke", "#111");
      c.setAttribute("stroke-width", "1");
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", String(cx + 8));
      t.setAttribute("y", String(cy - 8));
      t.setAttribute("fill", color);
      t.setAttribute("font-size", "11");
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", "#000");
      t.setAttribute("stroke-width", "2");
      const lm = (schema.landmarks || []).find((x) => x.id === id);
      t.textContent = lm ? lm.label : id;
      g.appendChild(c);
      g.appendChild(t);
      svg.appendChild(g);
    }
  }

  function bindDrag(svg, which, img, cand, viewId) {
    let dragId = null;
    svg.onpointerdown = (e) => {
      const g = e.target.closest("[data-id]");
      if (!g) return;
      dragId = g.dataset.id;
      selectedId = dragId;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    svg.onpointermove = (e) => {
      if (!dragId || !img) return;
      const r = svg.getBoundingClientRect();
      const box = imgBox(img);
      const u = (e.clientX - r.left - box.left) / Math.max(box.w, 1);
      const v = (e.clientY - r.top - box.top) / Math.max(box.h, 1);
      const bag = which === "base" ? base2d : ours2d;
      bag.points[dragId] = {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, v)),
      };
      if (which === "ours") ours2d.source = "refined";
      paintOverlay(svg, bag.points, which === "base" ? "#3b82f6" : "#f59e0b", img);
    };
    svg.onpointerup = async () => {
      if (!dragId) return;
      dragId = null;
      try {
        await save2d(cand, viewId);
      } catch (err) {
        console.warn(err);
      }
      onRefresh();
    };
  }

  function toolbarHtml(viewId) {
    const opts = viewLandmarks(viewId)
      .map((lm) => `<option value="${lm.id}"${lm.id === selectedId ? " selected" : ""}>${lm.label}</option>`)
      .join("");
    const n3 = Object.keys(points3d.points || {}).length;
    const nb = Object.keys(base2d.points || {}).length;
    const camOk = !!(cameraMeta && cameraMeta[viewId]);
    return `<div class="lm-bar">
      <span>锚点对照（不改网格）</span>
      <select id="lmSelect">${opts}</select>
      <button type="button" id="lmPick3d">在3D上点当前点</button>
      <button type="button" id="lmReproject">3D重投到成果图</button>
      <span class="lm-stat">3D ${n3} · Base ${nb} · 相机${camOk ? "OK" : "缺"} · 蓝=Base 橙=成果 · 可拖</span>
    </div>`;
  }

  function wireToolbar(cand, viewId) {
    const sel = document.getElementById("lmSelect");
    if (sel) {
      sel.onchange = () => {
        selectedId = sel.value;
        onRefresh();
      };
    }
    const pick = document.getElementById("lmPick3d");
    if (pick) {
      pick.onclick = () => {
        pickArmed = true;
        onRefresh("pick3d");
      };
    }
    const rp = document.getElementById("lmReproject");
    if (rp) {
      rp.onclick = async () => {
        reprojectOurs(viewId);
        try {
          await save2d(cand, viewId);
        } catch (err) {
          console.warn(err);
        }
        onRefresh();
      };
    }
  }

  function ensureSvg(parent, id) {
    let svg = parent.querySelector(`#${id}`);
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = id;
      svg.classList.add("lm-svg");
      parent.appendChild(svg);
    }
    return svg;
  }

  function mountOverlays(frameBase, frameOurs, cand, viewId) {
    const svgB = ensureSvg(frameBase, "lmSvgBase");
    const svgO = ensureSvg(frameOurs, "lmSvgOurs");
    const imgB = frameBase.querySelector("img");
    const imgO = frameOurs.querySelector("img");
    const paint = () => {
      paintOverlay(svgB, base2d.points, "#3b82f6", imgB);
      paintOverlay(svgO, ours2d.points, "#f59e0b", imgO);
    };
    requestAnimationFrame(() => requestAnimationFrame(paint));
    bindDrag(svgB, "base", imgB, cand, viewId);
    bindDrag(svgO, "ours", imgO, cand, viewId);
  }

  function attach3dPicker(renderer, camera, rootObj, cand, viewId) {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const handler = async (e) => {
      if (!pickArmed || !selectedId) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(rootObj, true);
      if (!hits.length) return;
      const p = hits[0].point;
      points3d.points[selectedId] = [p.x, p.y, p.z];
      pickArmed = false;
      try {
        await save3d(cand);
        reprojectOurs(viewId);
        await save2d(cand, viewId);
      } catch (err) {
        console.warn(err);
      }
      onRefresh();
    };
    renderer.domElement.addEventListener("pointerdown", handler);
    return () => renderer.domElement.removeEventListener("pointerdown", handler);
  }

  let _overlayFrameBase = null;
  let _overlayFrameOurs = null;
  let _overlayCand = "";
  let _overlayView = "";

  /** High-level entry called by index.html when landmark layer is active. */
  async function mountOverlay({ frameBase, frameOurs, candId, viewId: vid, camMetaUrl }) {
    _overlayFrameBase = frameBase;
    _overlayFrameOurs = frameOurs;
    _overlayCand = candId;
    _overlayView = vid;

    // Always reload fresh data so edits from other sessions show up.
    await loadAll(candId, vid);

    // Inject toolbar above frameBase if not already present.
    const existingBar = frameBase.parentElement && frameBase.parentElement.querySelector(".lm-bar");
    if (!existingBar && frameBase.parentElement) {
      const wrap = frameBase.parentElement.parentElement; // .card > .frame -> .card
      if (wrap) {
        const div = document.createElement("div");
        div.innerHTML = toolbarHtml(vid);
        wrap.insertBefore(div.firstElementChild, wrap.firstChild);
        wireToolbar(candId, vid);
      }
    }

    mountOverlays(frameBase, frameOurs, candId, vid);
  }

  function clearOverlays() {
    if (_overlayFrameBase) {
      const s = _overlayFrameBase.querySelector(".lm-svg");
      if (s) s.remove();
      const bar = _overlayFrameBase.parentElement &&
        _overlayFrameBase.parentElement.parentElement &&
        _overlayFrameBase.parentElement.parentElement.querySelector(".lm-bar");
      if (bar) bar.remove();
    }
    if (_overlayFrameOurs) {
      const s = _overlayFrameOurs.querySelector(".lm-svg");
      if (s) s.remove();
    }
    _overlayFrameBase = null;
    _overlayFrameOurs = null;
  }

  return {
    setOnRefresh(fn) {
      onRefresh = fn;
    },
    loadAll,
    mountOverlay,
    clearOverlays,
    toolbarHtml,
    wireToolbar,
    mountOverlays,
    attach3dPicker,
    getSelectedId: () => selectedId,
    isPickArmed: () => pickArmed,
    viewLandmarks,
  };
}
