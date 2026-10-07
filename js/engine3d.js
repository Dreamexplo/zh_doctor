/* ==========================================================================
   engine3d.js —— 轻量级软件 3D 渲染引擎（零依赖，Canvas2D 实现）
   特性：透视投影 / 背面剔除 / Lambert 光照 + 边缘光 / 画家算法（深度排序）
         支持 三角网格、折线、标记点 的统一深度混合绘制
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------- 向量工具 ------------------------- */
  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  /* ------------------------- 相机 ------------------------- */
  function Camera() {
    this.target = [0, 0.92, 0];
    this.theta = 0.0;              // 方位角（0 = 正前方）
    this.phi = 1.45;               // 俯仰（PI/2 为水平）
    this.dist = 4.6;
    this.fov = Math.PI / 4.2;
    this._eye = [0, 0, 0];
    this._r = [1, 0, 0]; this._u = [0, 1, 0]; this._f = [0, 0, -1];
  }
  Camera.prototype.update = function () {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const st = Math.sin(this.theta), ct = Math.cos(this.theta);
    this._eye = [
      this.target[0] + this.dist * sp * st,
      this.target[1] + this.dist * cp,
      this.target[2] + this.dist * sp * ct
    ];
    const f = V.norm(V.sub(this.target, this._eye));
    const worldUp = [0, 1, 0];
    let r = V.cross(f, worldUp);
    if (V.dot(r, r) < 1e-6) r = [1, 0, 0];
    this._r = V.norm(r);
    this._u = V.norm(V.cross(this._r, f));
    this._f = f;
  };

  /* ------------------------- 场景 ------------------------- */
  function Scene() { this.meshes = []; this.lines = []; this.markers = []; }
  Scene.prototype.clearGroup = function (g) {
    this.meshes = this.meshes.filter(m => m.group !== g);
    this.lines = this.lines.filter(m => m.group !== g);
    this.markers = this.markers.filter(m => m.group !== g);
  };
  Scene.prototype.addMesh = function (m) {
    // 预计算面法线
    const F = m.faces || [];
    const nrm = new Array(F.length);
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      const a = m.verts[f[0]], b = m.verts[f[1]], c = m.verts[f[2]];
      nrm[i] = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
    }
    m._n = nrm;
    m._cc = m._cc || {};
    m._rgb = hexToRgb(m.color || "#cccccc");
    this.meshes.push(m);
    return m;
  };

  /* ------------------------- 光源 ------------------------- */
  const LIGHT = V.norm([-0.38, 0.78, 0.92]);
  const FILL = V.norm([0.6, 0.1, -0.5]);

  function shadeStr(mesh, k) {
    const key = (k * 60) | 0;
    const cached = mesh._cc[key];
    if (cached) return cached;
    const c = mesh._rgb;
    const r = Math.max(0, Math.min(255, Math.round(c[0] * k)));
    const g = Math.max(0, Math.min(255, Math.round(c[1] * k)));
    const b = Math.max(0, Math.min(255, Math.round(c[2] * k)));
    const s = "rgb(" + r + "," + g + "," + b + ")";
    mesh._cc[key] = s;
    return s;
  }

  /* ------------------------- 渲染器 ------------------------- */
  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1; this.W = 1; this.H = 1;
    this.bg = null;
    this.resize();
  }
  Renderer.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
    this.dpr = dpr; this.W = w; this.H = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* 把世界坐标投影到屏幕，返回 {x,y,z} */
  Renderer.prototype.project = function (p, cam, focal) {
    const vx = p[0] - cam._eye[0], vy = p[1] - cam._eye[1], vz = p[2] - cam._eye[2];
    const cz = vx * cam._f[0] + vy * cam._f[1] + vz * cam._f[2];
    if (cz <= 0.05) return null;
    const cx = vx * cam._r[0] + vy * cam._r[1] + vz * cam._r[2];
    const cy = vx * cam._u[0] + vy * cam._u[1] + vz * cam._u[2];
    return { x: this.W / 2 + (cx / cz) * focal, y: this.H / 2 - (cy / cz) * focal, z: cz };
  };

  Renderer.prototype.render = function (scene, cam, opts) {
    opts = opts || {};
    cam.update();
    const focal = (this.H / 2) / Math.tan(cam.fov / 2);
    this._focal = focal; this._cam = cam;
    const ctx = this.ctx;
    const items = [];
    const eye = cam._eye;

    /* --- 网格 --- */
    for (let mi = 0; mi < scene.meshes.length; mi++) {
      const mesh = scene.meshes[mi];
      const verts = mesh.verts, F = mesh.faces, NRM = mesh._n;
      const sp = new Array(verts.length);
      for (let i = 0; i < verts.length; i++) sp[i] = this.project(verts[i], cam, focal);
      const op = mesh.opacity == null ? 1 : mesh.opacity;
      for (let fi = 0; fi < F.length; fi++) {
        const f = F[fi];
        const p0 = sp[f[0]], p1 = sp[f[1]], p2 = sp[f[2]];
        if (!p0 || !p1 || !p2) continue;
        const n = NRM[fi];
        // 背面剔除：法线背向视点则跳过
        const a = verts[f[0]];
        const vdx = eye[0] - a[0], vdy = eye[1] - a[1], vdz = eye[2] - a[2];
        if (n[0] * vdx + n[1] * vdy + n[2] * vdz <= 0) continue;
        const vl = Math.sqrt(vdx * vdx + vdy * vdy + vdz * vdz) || 1;
        const ndv = (n[0] * vdx + n[1] * vdy + n[2] * vdz) / vl;
        const diff = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        const fill2 = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2]);
        const rim = Math.pow(1 - Math.max(0, ndv), 3) * 0.35;
        let k = (mesh.ambient == null ? 0.34 : mesh.ambient) + diff * 0.72 + fill2 * 0.14 + rim;
        if (k > 1.45) k = 1.45;
        items.push({
          z: (p0.z + p1.z + p2.z) / 3,
          t: 0,
          a: p0, b: p1, c: p2,
          col: shadeStr(mesh, k),
          op: op,
          ov: mesh.overlay ? 1 : 0
        });
      }
    }

    /* --- 折线（经络） --- */
    for (let li = 0; li < scene.lines.length; li++) {
      const L = scene.lines[li];
      const pr = new Array(L.pts.length);
      for (let i = 0; i < L.pts.length; i++) pr[i] = this.project(L.pts[i], cam, focal);
      for (let i = 0; i < pr.length - 1; i++) {
        const a2 = pr[i], b2 = pr[i + 1];
        if (!a2 || !b2) continue;
        items.push({
          z: (a2.z + b2.z) / 2 - (L.bias || 0),
          t: 1, a: a2, b: b2,
          col: L.color, w: (L.width || 2), op: L.opacity == null ? 1 : L.opacity,
          ov: L.overlay ? 1 : 0, dash: L.dash || null, glow: L.glow || 0
        });
      }
    }

    /* --- 标记点（穴位） --- */
    for (let ki = 0; ki < scene.markers.length; ki++) {
      const M = scene.markers[ki];
      const p = this.project(M.p, cam, focal);
      if (!p) continue;
      items.push({
        z: p.z - (M.bias || 0.02),
        t: 2, x: p.x, y: p.y,
        r: Math.max(1.2, (M.r || 0.012) * focal / p.z),
        col: M.color, ring: M.ring !== false, sel: M.sel ? 1 : 0,
        ov: M.overlay ? 1 : 0, glow: M.glow || 0, data: M.data, op: M.opacity == null ? 1 : M.opacity
      });
    }

    /* --- 排序：远→近 --- */
    items.sort((A, B) => B.z - A.z);

    /* --- 绘制 --- */
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.bg) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, this.W, this.H); }

    ctx.lineJoin = "round";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.ov) continue;
      drawItem(ctx, it);
    }
    // 叠加层（高亮经络 / 选中穴位）最后绘制，始终可见
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.ov) continue;
      if (it.t === 1) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (it.glow) { ctx.shadowBlur = 14; ctx.shadowColor = it.col; }
        ctx.strokeStyle = it.col; ctx.lineWidth = it.w; ctx.globalAlpha = it.op;
        ctx.beginPath(); ctx.moveTo(it.a.x, it.a.y); ctx.lineTo(it.b.x, it.b.y); ctx.stroke();
        ctx.restore();
      } else if (it.t === 2) {
        drawItem(ctx, it);
      }
    }
    return this;
  };

  function drawItem(ctx, it) {
    if (it.t === 0) {
      ctx.globalAlpha = it.op;
      ctx.fillStyle = it.col;
      ctx.beginPath();
      ctx.moveTo(it.a.x, it.a.y); ctx.lineTo(it.b.x, it.b.y); ctx.lineTo(it.c.x, it.c.y);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (it.t === 1) {
      ctx.globalAlpha = it.op;
      ctx.strokeStyle = it.col;
      ctx.lineWidth = it.w;
      if (it.glow) { ctx.shadowBlur = 10; ctx.shadowColor = it.col; } else { ctx.shadowBlur = 0; }
      ctx.beginPath(); ctx.moveTo(it.a.x, it.a.y); ctx.lineTo(it.b.x, it.b.y); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = it.op;
      if (it.glow) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = hexA(it.col, 0.22); ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
      ctx.fillStyle = it.col; ctx.fill();
      if (it.ring) {
        ctx.lineWidth = it.sel ? 2.2 : 1.1;
        ctx.strokeStyle = it.sel ? "#fff3c4" : "rgba(255,255,255,0.75)";
        ctx.stroke();
      }
      if (it.sel) {
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r * 2.2, 0, Math.PI * 2);
        ctx.lineWidth = 1.6; ctx.strokeStyle = "#ffe08a"; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function hexA(hex, a) {
    const c = hexToRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /* ------------------------- 拾取 ------------------------- */
  Renderer.prototype.pick = function (scene, cam, sx, sy, maxDist) {
    cam.update();
    const focal = (this.H / 2) / Math.tan(cam.fov / 2);
    let best = null;
    for (let i = 0; i < scene.markers.length; i++) {
      const M = scene.markers[i];
      const p = this.project(M.p, cam, focal);
      if (!p) continue;
      const r = Math.max(6, (M.r || 0.012) * focal / p.z + 6);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= r) {
        if (!best || p.z < best.z) best = { z: p.z, marker: M, dist: d };
      }
    }
    return best ? best.marker : null;
  };

  window.Engine = { V, Camera, Scene, Renderer, hexToRgb, hexA };
})();
