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
    else if (Object.keys(base2d.points || {}).length) {
      ours2d = {
        view: viewId,
        source: "copied_from_base",
        points: JSON.parse(JSON.stringify(base2d.points)),
      };
    } else {
      reprojectOurs(viewId);
    }
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

  const DOT_FILL = "#fff";
  const DOT_STROKE = "#000";

  function pairId(id) {
    if (!id) return null;
    if (id.endsWith("_L")) return `${id.slice(0, -2)}_R`;
    if (id.endsWith("_R")) return `${id.slice(0, -2)}_L`;
    return null;
  }

  function setUv(bag, id, u, v, mirror) {
    const uu = Math.max(0, Math.min(1, u));
    const vv = Math.max(0, Math.min(1, v));
    bag.points[id] = { u: uu, v: vv };
    if (!mirror) return;
    const pid = pairId(id);
    if (!pid) return;
    bag.points[pid] = { u: 1 - uu, v: vv };
  }

  function paintOverlay(svg, points, img) {
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
      c.setAttribute("r", id === selectedId ? "3.2" : "2.2");
      c.setAttribute("fill", DOT_FILL);
      c.setAttribute("stroke", DOT_STROKE);
      c.setAttribute("stroke-width", "1.2");
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", String(cx + 5));
      t.setAttribute("y", String(cy + 11));
      t.setAttribute("fill", DOT_FILL);
      t.setAttribute("font-size", "11");
      t.setAttribute("font-weight", "400");
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", DOT_STROKE);
      t.setAttribute("stroke-width", "2.5");
      const lm = (schema.landmarks || []).find((x) => x.id === id);
      t.textContent = lm ? lm.label : id;
      g.appendChild(c);
      g.appendChild(t);
      svg.appendChild(g);
    }
  }

  function bindDrag(svg, which, img, cand, viewId) {
    let dragId = null;
    let mirror = true;
    svg.onpointerdown = (e) => {
      const g = e.target.closest("[data-id]");
      if (!g) return;
      dragId = g.dataset.id;
      selectedId = dragId;
      mirror = !e.shiftKey;
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
      setUv(bag, dragId, u, v, mirror);
      if (which === "ours") ours2d.source = "refined";
      paintOverlay(svg, bag.points, img);
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
      <button type="button" id="lmAddPair">添加对称点</button>
      <button type="button" id="lmAddSingle">添加不对称点</button>
      <button type="button" id="lmDelete">删除当前自定义点</button>
      <span class="lm-stat">3D ${n3} · Base ${nb} · 相机${camOk ? "OK" : "缺"} · 左右默认同步 · Shift单独调 · 可拖</span>
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
    const addPair = document.getElementById("lmAddPair");
    if (addPair) {
      addPair.onclick = () => addCustom(cand, viewId, true);
    }
    const addSingle = document.getElementById("lmAddSingle");
    if (addSingle) {
      addSingle.onclick = () => addCustom(cand, viewId, false);
    }
    const del = document.getElementById("lmDelete");
    if (del) {
      del.onclick = () => deleteCustom(cand, viewId);
    }
  }

  function isCustomId(id) {
    return typeof id === "string" && id.startsWith("custom_");
  }

  function dropPoint(id) {
    if (base2d.points) delete base2d.points[id];
    if (ours2d.points) delete ours2d.points[id];
    if (points3d.points) delete points3d.points[id];
  }

  async function addCustom(cand, viewId, symmetric) {
    const kind = symmetric ? "对称点（会生成左右一对，拖一边另一边跟着镜像）" : "不对称点（单独一个，不镜像）";
    const label = window.prompt(`自定义${kind}名称`);
    if (!label || !label.trim()) return;
    const name = label.trim();
    const stamp = Date.now();
    schema.landmarks = schema.landmarks || [];
    if (symmetric) {
      const idL = `custom_${stamp}_L`;
      const idR = `custom_${stamp}_R`;
      schema.landmarks.push(
        { id: idL, label: `${name}L`, views: [viewId], hint: "自定义", custom: true },
        { id: idR, label: `${name}R`, views: [viewId], hint: "自定义", custom: true }
      );
      selectedId = idL;
      setUv(base2d, idL, 0.42, 0.5, true);
      setUv(ours2d, idL, 0.42, 0.5, true);
    } else {
      const id = `custom_${stamp}`;
      schema.landmarks.push({
        id,
        label: name,
        views: [viewId],
        hint: "自定义",
        custom: true,
      });
      selectedId = id;
      setUv(base2d, id, 0.5, 0.5, false);
      setUv(ours2d, id, 0.5, 0.5, false);
    }
    try {
      await saveJson("landmarks/schema.json", schema);
      await save2d(cand, viewId);
    } catch (err) {
      console.warn(err);
    }
    onRefresh();
  }

  async function deleteCustom(cand, viewId) {
    if (!isCustomId(selectedId)) {
      window.alert("只能删除自定义点。内置解剖点请保留。");
      return;
    }
    const ids = [selectedId];
    const pid = pairId(selectedId);
    if (pid && isCustomId(pid)) ids.push(pid);
    const names = ids
      .map((id) => (schema.landmarks || []).find((x) => x.id === id))
      .filter(Boolean)
      .map((x) => x.label)
      .join("、");
    if (!window.confirm(`删除自定义点：${names || selectedId}？`)) return;
    schema.landmarks = (schema.landmarks || []).filter((lm) => !ids.includes(lm.id));
    ids.forEach(dropPoint);
    const remain = viewLandmarks(viewId).map((l) => l.id);
    selectedId = remain[0] || "";
    try {
      await saveJson("landmarks/schema.json", schema);
      await save2d(cand, viewId);
      await save3d(cand);
    } catch (err) {
      console.warn(err);
    }
    onRefresh();
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
      paintOverlay(svgB, base2d.points, imgB);
      paintOverlay(svgO, ours2d.points, imgO);
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
  async function mountOverlay({ frameBase, frameOurs, candId, viewId: vid, camMetaUrl, toolbarHost }) {
    _overlayFrameBase = frameBase;
    _overlayFrameOurs = frameOurs;
    _overlayCand = candId;
    _overlayView = vid;

    await loadAll(candId, vid);

    // Inject toolbar into dedicated host (below stage) to avoid squeezing card layout.
    const host = toolbarHost || document.getElementById("lmToolbar");
    if (host) {
      host.innerHTML = toolbarHtml(vid);
      wireToolbar(candId, vid);
    }

    mountOverlays(frameBase, frameOurs, candId, vid);
  }

  function clearOverlays() {
    if (_overlayFrameBase) {
      const s = _overlayFrameBase.querySelector(".lm-svg");
      if (s) s.remove();
    }
    if (_overlayFrameOurs) {
      const s = _overlayFrameOurs.querySelector(".lm-svg");
      if (s) s.remove();
    }
    const host = document.getElementById("lmToolbar");
    if (host) host.innerHTML = "";
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
