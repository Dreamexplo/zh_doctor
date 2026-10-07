/* ==========================================================================
   app.js —— zh_doctor 主应用
   立体人体 + 经络穴位交互 / 刺激反馈推演 / 经络穴位 Wiki / 冥想配音
   ========================================================================== */
(function () {
  "use strict";
  const E = window.Engine, V = E.V;
  const MERIDIANS = window.MERIDIANS;
  const PAIRS = window.MERIDIAN_PAIRS;
  const BAMAI = window.BAMAI_PAIRS;
  const COMBOS = window.SPECIAL_COMBOS;
  const FEEDBACK = window.MERIDIAN_FEEDBACK;
  const MED = window.MEDITATION_SCRIPT;

  /* ------------------------ 状态 ------------------------ */
  const state = {
    gender: "male",
    active: {},            // 已激活经络 id 集合
    showAllPoints: false,
    showOrgans: false,
    bothSides: true,
    showLines: true,
    autoRotate: false,
    /* —— 解剖层（现代医学）—— */
    anat: { nerve: false, vessel: false, muscle: false, organ: false, meridian: true },
    anatOp: 0.8,
    selected: null,        // {mer, point, side}
    hover: null,           // {mer, side}
    related: [],
    pulses: [],
    pending: null,
    stim: null,
    medPlaying: false,
    breath: 0,
    voiceVol: 1
  };

  let renderer, scene, cam, bodies = [], rafId = 0, dirty = true, lastT = 0;

  /* ------------------------ 工具 ------------------------ */
  const ALL = [];
  MERIDIANS.forEach(m => m.points.forEach(p => { p._m = m; ALL.push(p); }));
  function getMer(id) { return MERIDIANS.find(m => m.id === id); }
  function findPoint(code) { const p = ALL.find(x => x.c === code); return p ? { mer: p._m, point: p } : null; }
  /* 双人模式下把 0 基准横向偏移纠正到左侧人体 */
  function fixOx(ox) {
    if (state.gender !== "both") return 0;
    if (!ox) return bodies.length ? bodies[0].ox : 0;
    return ox;
  }

  /* 募穴 ↔ 背俞穴 配对表 */
  const XUE_PAIRS = {};
  (function () {
    const mu = {}, shu = {};
    ALL.forEach(p => {
      if (!p.tag) return;
      let m = p.tag.match(/([^·\s]+?)之?募穴/); if (m) mu[m[1]] = p.c;
      let s = p.tag.match(/([^·\s]+?)之?背俞穴/); if (s) shu[s[1]] = p.c;
    });
    Object.keys(mu).forEach(k => { if (shu[k]) { XUE_PAIRS[mu[k]] = shu[k]; XUE_PAIRS[shu[k]] = mu[k]; } });
  })();

  /* ------------------------ 音频 ------------------------ */
  const AudioKit = {
    ctx: null, master: null, drone: null, delay: null, timer: null, on: false,
    vol: 0.7, bgm: null, bgmTimer: null,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const dly = this.ctx.createDelay(1.0); dly.delayTime.value = 0.29;
      const fb = this.ctx.createGain(); fb.gain.value = 0.36;
      const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      dly.connect(fb); fb.connect(dly); dly.connect(lp); lp.connect(this.master);
      this.delay = dly;
    },
    /* 音量：同时作用于合成器与配乐 */
    setVolume(p) {
      this.vol = Math.max(0, Math.min(1, p));
      if (this.master) this.master.gain.value = this.vol * 0.7;
      if (this.bgm && !this.bgmTimer) this.bgm.volume = Math.max(0, Math.min(1, this.vol * 0.55));
    },
    fadeBgm(target, ms) {
      if (!this.bgm) return;
      if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
      const a = this.bgm, from = a.volume, t0 = Date.now();
      this.bgmTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        try { a.volume = Math.max(0, Math.min(1, from + (target - from) * k)); } catch (e) { }
        if (k >= 1) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
      }, 60);
    },
    /* 穴位磬声（音频文件优先，失败回落到合成编钟） */
    chimeFile(vol) {
      const a = document.getElementById("sfxChime");
      if (!a) return false;
      try {
        a.currentTime = 0;
        a.volume = Math.max(0, Math.min(1, vol == null ? 1 : vol));
        const pr = a.play();
        if (pr && pr.catch) pr.catch(function () { });
        return true;
      } catch (e) { return false; }
    },
    start() {
      if (this.on) return;
      this.on = true;
      this.init();
      const bgm = document.getElementById("bgm");
      if (bgm) {
        this.bgm = bgm;
        try {
          bgm.volume = 0; bgm.currentTime = 0;
          const pr = bgm.play();
          if (pr && pr.catch) pr.catch(() => { this.bgm = null; this._startSynth(); });
          this.fadeBgm(Math.min(1, this.vol * 0.55), 2600);
          return;
        } catch (e) { this.bgm = null; }
      }
      this._startSynth();
    },
    /* 回落方案：WebAudio 实时合成古琴衬底 + 随机编钟 */
    _startSynth() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      if (ctx.state === "suspended") ctx.resume();
      const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this.master);
      g.connect(this.delay);
      const freqs = [110, 164.81, 220, 329.63];
      const oscs = freqs.map((f, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? "sine" : "triangle"; o.frequency.value = f;
        const gg = ctx.createGain(); gg.gain.value = 0.14 / (i + 1);
        o.connect(gg); gg.connect(g); o.start();
        return o;
      });
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
      this.drone = { g, oscs, ctx };
      // 编钟式随机敲击
      const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
      const tick = () => {
        if (!this.on) return;
        if (Math.random() < 0.75) this.bell(scale[(Math.random() * scale.length) | 0], 4.2, 0.10);
        this.timer = setTimeout(tick, 3400 + Math.random() * 5200);
      };
      this.timer = setTimeout(tick, 1800);
    },
    stop() {
      this.on = false;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.bgm) {
        const a = this.bgm;
        this.fadeBgm(0, 800);
        setTimeout(() => { try { a.pause(); } catch (e) { } }, 900);
        this.bgm = null;
      }
      if (this.drone) {
        const { g, oscs, ctx } = this.drone;
        try { g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2); } catch (e) { }
        setTimeout(() => { oscs.forEach(o => { try { o.stop(); } catch (e) { } }); }, 1500);
        this.drone = null;
      }
    },
    bell(f, dur, vol) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2.76;
      const g = ctx.createGain(); const g2 = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vol * 0.28, t + 0.008);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.42);
      o.connect(g); o2.connect(g2);
      g.connect(this.master); g2.connect(this.master);
      g.connect(this.delay); g2.connect(this.delay);
      o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    },
    pointTone(f) {
      const ok = this.chimeFile(this.vol);
      if (this.ctx) this.bell(f || 440, 1.6, ok ? 0.07 : 0.14);
    }
  };

  /* 十二经对应音高（五声音阶），用于穴位刺激音 */
  const MER_TONE = {};
  (function () {
    const base = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    MERIDIANS.forEach((m, i) => { MER_TONE[m.id] = base[i % 6] * (i > 6 ? 0.5 : 1); });
  })();

  /* ------------------------ 场景构建 ------------------------ */
  function buildAll() {
    scene = new E.Scene();
    renderer.bg = null;
    bodies = [];
    if (state.gender === "both") {
      bodies.push({ kind: "male", ox: -0.38 });
      bodies.push({ kind: "female", ox: 0.38 });
      cam.target = [0, 0.92, 0];
      if (cam.dist < 6.4) cam.dist = 7.4;
    } else {
      bodies.push({ kind: state.gender, ox: 0 });
      cam.target = [0, 0.92, 0];
    }
    const bodyOpacity = skinOpacity();
    bodies.forEach(b => {
      const data = window.Body.build(b.kind);
      b.data = data;
      b.meshes = [];
      data.meshes.forEach(m => {
        const mesh = scene.addMesh({
          verts: m.geo.verts.map(v => [v[0] + b.ox, v[1], v[2]]),
          faces: m.geo.faces, color: m.color, group: "body",
          opacity: bodyOpacity, ambient: 0.36
        });
        b.meshes.push(mesh);
      });
      data.organs.forEach(o => {
        const mesh = scene.addMesh({
          verts: o.geo.verts.map(v => [v[0] + b.ox, v[1], v[2]]),
          faces: o.geo.faces, color: o.color, group: "organ",
          opacity: 0, ambient: 0.45
        });
        mesh.wikiName = o.name;
        mesh.anatGroup = "organ";
      });

      /* —— 现代医学解剖层：神经 / 血管 / 筋腱肌肉 —— */
      [["nerve", window.Body.buildNerves(b.kind)],
       ["vessel", window.Body.buildVessels(b.kind)],
       ["muscle", window.Body.buildMuscles(b.kind)]].forEach(function (pair) {
        const g = pair[0], set = pair[1] || {};
        (set.meshes || []).forEach(mm => {
          if (!mm.geo) return;
          const mesh = scene.addMesh({
            verts: mm.geo.verts.map(v => [v[0] + b.ox, v[1], v[2]]),
            faces: mm.geo.faces, color: mm.color, group: "anat",
            opacity: 0, ambient: mm.ambient == null ? 0.42 : mm.ambient
          });
          mesh.anatGroup = g; mesh.wikiName = mm.name;
        });
        (set.lines || []).forEach(ll => {
          if (!ll.pts || ll.pts.length < 2) return;
          scene.lines.push({
            pts: ll.pts.map(p => [p[0] + b.ox, p[1], p[2]]),
            color: ll.color, width: ll.width || 1.6, opacity: 0,
            group: "anat", anatGroup: g, overlay: false, _name: ll.name
          });
        });
      });
    });
    applyBodyOpacity();
    rebuildMeridians();
    rebuildRelated();
    dirty = true;
  }

  /* 是否需要对表皮做半透明处理（便于透视内部结构） */
  function needSkin() {
    const a = state.anat;
    return state.showOrgans || a.organ || a.nerve || a.vessel || a.muscle;
  }
  function skinOpacity() { return needSkin() ? 0.38 : 1; }

  function applyBodyOpacity() {
    const o = skinOpacity();
    scene.meshes.forEach(m => {
      if (m.group === "body") m.opacity = o;
    });
    applyAnat();
  }

  /* —— 解剖层显隐（各自独立，可任意叠加同显）—— */
  function applyAnat() {
    const a = state.anat, op = state.anatOp;
    const organOn = !!(a.organ || state.showOrgans);
    /* 器官层开启时：表层肌肉网格让出视野，器官提升为叠加绘制（穿透可见），
       神经/血管线条同步置为叠加，保证四层叠加时各层均可见 */
    const muscleOp = a.muscle ? (organOn ? Math.min(op, 0.34) : op) : 0;
    scene.meshes.forEach(m => {
      switch (m.anatGroup) {
        case "nerve": m.opacity = a.nerve ? op : 0; m.overlay = false; break;
        case "vessel": m.opacity = a.vessel ? op : 0; m.overlay = false; break;
        case "muscle": m.opacity = muscleOp; m.overlay = false; break;
        case "organ": m.opacity = organOn ? 0.95 : 0; m.overlay = organOn; break;
      }
    });
    scene.lines.forEach(l => {
      if (!l.anatGroup) return;
      const on = !!a[l.anatGroup];
      l.opacity = on ? Math.min(1, op + 0.25) : 0;
      l.overlay = on && organOn;
    });
    dirty = true;
  }

  /* 供解剖对照面板调用：单独开关某一层 */
  function setAnatLayer(name, on) {
    const a = state.anat;
    if (name === "organ") { state.showOrgans = on; a.organ = on; }
    else if (name === "meridian") {
      a.meridian = on; state.showLines = on; state.showAllPoints = on;
      rebuildMeridians();
    } else if (a[name] !== undefined) { a[name] = on; }
    applyBodyOpacity();
    syncAnatButtons();
  }

  function syncAnatButtons() {
    const map = { anatNerve: "nerve", anatVessel: "vessel", anatMuscle: "muscle", anatOrgan: "organ" };
    Object.keys(map).forEach(function (idn) {
      const el = document.getElementById(idn);
      if (el) el.classList.toggle("on", !!state.anat[map[idn]] || (map[idn] === "organ" && state.showOrgans));
    });
    const pairs = [["anatMeridian", !!state.showLines], ["tglLines", !!state.showLines],
                   ["tglPoints", !!state.showAllPoints], ["tglOrgans", !!state.showOrgans]];
    pairs.forEach(function (p) {
      const el = document.getElementById(p[0]);
      if (el) el.classList.toggle("on", p[1]);
    });
  }

  function isActive(id) { return !!state.active[id]; }

  function rebuildMeridians() {
    scene.clearGroup("meridians");
    MERIDIANS.forEach(mer => {
      const act = isActive(mer.id);
      const sides = (mer.id === "GV" || mer.id === "CV") ? [1] : (state.bothSides ? [1, -1] : [1]);
      bodies.forEach(b => {
        sides.forEach(side => {
          if (!state.showLines && !act) return;
          const pts = window.Body.meridianPath(mer, side).map(p => [p[0] + b.ox, p[1], p[2]]);
          if (pts.length < 2) return;
          scene.lines.push({
            pts: pts,
            color: mer.color,
            width: act ? 3.0 : 1.4,
            opacity: act ? 1 : 0.34,
            group: "meridians",
            overlay: act,
            glow: act,
            bias: act ? 0.06 : 0,
            _mer: mer, _side: side, _ox: b.ox
          });
          if (act || state.showAllPoints) {
            mer.points.forEach(p => {
              if ((mer.id === "GV" || mer.id === "CV") && side < 0) return;
              scene.markers.push({
                p: [p.x * side + b.ox, p.y, p.z],
                color: mer.color, r: act ? 0.0085 : 0.006,
                group: "meridians", glow: act,
                data: { mer: mer, point: p, side: side, ox: b.ox }
              });
            });
          }
        });
      });
    });
    // 选中标记
    if (state.selected) {
      const s = state.selected;
      scene.markers.filter(m => m.group === "meridians").forEach(m => {
        if (m.data && m.data.point === s.point) { m.sel = true; m.overlay = true; m.bias = 0.06; }
      });
    }
    dirty = true;
  }

  function rebuildRelated() {
    scene.clearGroup("related"); scene.clearGroup("arcs");
    state.related.forEach(r => {
      bodies.forEach(b => {
        const sides = (r.mer.id === "GV" || r.mer.id === "CV") ? [1] : (state.bothSides ? [1, -1] : [1]);
        sides.forEach(side => {
          scene.markers.push({
            p: [r.point.x * side + b.ox, r.point.y, r.point.z],
            color: "#ffd166", r: 0.011, ring: true, group: "related", glow: true,
            overlay: true, bias: 0.07,
            data: { mer: r.mer, point: r.point, side: side, ox: b.ox, related: r }
          });
        });
      });
    });
    // 关联连线（弧线）
    if (state.selected) {
      const s = state.selected;
      const a0 = [s.point.x * s.side, s.point.y, s.point.z];
      state.related.forEach(r => {
        const sides = (r.mer.id === "GV" || r.mer.id === "CV") ? [1] : [s.side];
        sides.forEach(side => {
          const b0 = [r.point.x * side + s.ox, r.point.y, r.point.z];
          const pts = arc3([a0[0] + s.ox, a0[1], a0[2]], b0, 0.16);
          scene.lines.push({ pts: pts, color: "#ffcf5c", width: 1.3, opacity: 0.55, group: "arcs", overlay: true, glow: false, dash: true });
        });
      });
    }
    dirty = true;
  }

  function arc3(a, b, bow) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const axis = [0, 1.0, 0.92];
    let dir = V.norm([mid[0], mid[1] - 0.92, mid[2]]);
    const ctrl = [mid[0] + axis[0] * bow + dir[0] * 0.05, mid[1] + axis[1] * bow * 0.2 + dir[1] * 0.05, mid[2] + axis[2] * bow + dir[2] * 0.05];
    const N = 14, out = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      out.push([
        u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
        u * u * a[2] + 2 * u * t * ctrl[2] + t * t * b[2]
      ]);
    }
    return out;
  }

  /* ------------------------ 刺激反馈 ------------------------ */
  function computeRelated(mer, pt) {
    const out = [];
    const push = (m, p, rel, kind) => {
      if (!p || p === pt) return;
      if (out.some(o => o.point.c === p.c)) return;
      out.push({ mer: m, point: p, rel: rel, kind: kind });
    };
    const idx = mer.points.indexOf(pt);
    if (idx > 0) push(mer, mer.points[idx - 1], "同经循行·前一穴（循经取穴）", "local");
    if (idx < mer.points.length - 1) push(mer, mer.points[idx + 1], "同经循行·后一穴（循经取穴）", "local");

    const tag = pt.tag || "";
    if (tag.indexOf("原穴") >= 0) {
      const l = mer.points.find(p => p.tag && p.tag.indexOf("络穴") >= 0);
      if (l) push(mer, l, "原络配穴：本经原穴配本经络穴", "yuanluo");
    }
    if (tag.indexOf("络穴") >= 0) {
      const y = mer.points.find(p => p.tag && p.tag.indexOf("原穴") >= 0);
      if (y) push(mer, y, "原络配穴：本经络穴配本经原穴", "yuanluo");
    }
    const pi = PAIRS[mer.id];
    if (pi && pi.biao) {
      const pm = getMer(pi.biao);
      if (pm) {
        const y = pm.points.find(p => p.tag && p.tag.indexOf("原穴") >= 0);
        if (y) push(pm, y, "表里经配穴：" + pm.name + "原穴", "biao");
      }
    }
    const bm = BAMAI.find(x => x.a === pt.c || x.b === pt.c);
    if (bm) {
      const other = bm.a === pt.c ? bm.b : bm.a;
      const f = findPoint(other);
      if (f) push(f.mer, f.point, "八脉交会穴相配（上下配穴）", "bamai");
    }
    if (XUE_PAIRS[pt.c]) {
      const f = findPoint(XUE_PAIRS[pt.c]);
      if (f) push(f.mer, f.point, "募俞配穴（腹募穴配背俞穴）", "muxue");
    }
    const sc = COMBOS[pt.c];
    if (sc) sc.forEach(c => { const f = findPoint(c); if (f) push(f.mer, f.point, "临床常用配伍", "combo"); });

    return out.slice(0, 8);
  }

  function stimulate(mer, pt, side, ox) {
    ox = fixOx(ox);
    side = side || 1;
    AudioKit.pointTone(MER_TONE[mer.id]);
    const pulse = makePulse(mer, pt, side, ox, "#fff8d8");
    state.pulses.push(pulse);
    state.stim = { mer: mer, point: pt, side: side, ox: ox, done: false, t0: performance.now() };
    state.related = computeRelated(mer, pt);
    rebuildRelated();
    showTab("feedback");
    renderFeedback(mer, pt);
    state.pending = state.related.length
      ? { mer: state.related[0].mer, point: state.related[0].point, side: side, ox: ox, delay: 1400 }
      : null;
  }

  /* 光流推演：以刺激穴为起点，沿经络同时向两端传导演示 */
  function makePulse(mer, pt, side, ox, color) {
    let pts = window.Body.meridianPath(mer, side);
    if (pts.length < 2) pts = mer.points.map(p => [p.x * side, p.y, p.z]);
    pts = pts.map(p => [p[0] + ox, p[1], p[2]]);
    const cum = [0]; let tot = 0;
    for (let i = 1; i < pts.length; i++) {
      tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      cum.push(tot);
    }
    // 定位刺激穴在路径上的最近顶点
    let bi = 0, bd = 1e9;
    const tx = pt.x * side + ox;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - tx, pts[i][1] - pt.y, pts[i][2] - pt.z);
      if (d < bd) { bd = d; bi = i; }
    }
    const d0 = cum[bi];
    const reach = Math.max(d0, tot - d0, 0.05);
    const line = { pts: [pts[bi], pts[bi]], color: color, width: 5.0, opacity: 1, group: "pulse", overlay: true, glow: true, bias: 0.10 };
    scene.lines.push(line);
    const h1 = { p: pts[bi], color: color, r: 0.018, group: "pulse", overlay: true, glow: true, ring: false, bias: 0.12 };
    const h2 = { p: pts[bi], color: color, r: 0.018, group: "pulse", overlay: true, glow: true, ring: false, bias: 0.12 };
    scene.markers.push(h1); scene.markers.push(h2);
    return {
      mer: mer, side: side, ox: ox, pts: pts, cum: cum, total: tot, d0: d0, reach: reach,
      s: 0, speed: reach / 1.7, delay: 0, color: color,
      line: line, headM: h1, headM2: h2, init: true, done: false
    };
  }

  function distAt(pu, d) {
    const c = pu.cum, p = pu.pts;
    if (d <= 0) return p[0];
    if (d >= pu.total) return p[p.length - 1];
    let lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [
      p[lo][0] + (p[hi][0] - p[lo][0]) * t,
      p[lo][1] + (p[hi][1] - p[lo][1]) * t,
      p[lo][2] + (p[hi][2] - p[lo][2]) * t
    ];
  }
  function pathBetween(pu, dA, dB) {
    if (dA > dB) { const t = dA; dA = dB; dB = t; }
    const out = [distAt(pu, dA)];
    for (let i = 0; i < pu.pts.length; i++) {
      if (pu.cum[i] > dA + 1e-6 && pu.cum[i] < dB - 1e-6) out.push(pu.pts[i]);
    }
    out.push(distAt(pu, dB));
    return out;
  }

  function updatePulses(dt) {
    let any = false;
    if (state.pending) {
      state.pending.delay -= dt;
      any = true;
      if (state.pending.delay <= 0) {
        const p = state.pending; state.pending = null;
        state.pulses.push(makePulse(p.mer, p.point, p.side, p.ox, "#ffd166"));
      }
    }
    for (const pu of state.pulses) {
      if (!pu.init) continue;
      if (pu.delay > 0) { pu.delay -= dt * 1000; if (pu.delay > 0) { any = true; continue; } }
      if (pu.done) { any = true; continue; }
      pu.s += pu.speed * dt / 1000;
      if (pu.s >= pu.reach) { pu.s = pu.reach; pu.done = true; }
      const dA = Math.max(0, pu.d0 - pu.s);
      const dB = Math.min(pu.total, pu.d0 + pu.s);
      pu.line.pts = pathBetween(pu, dA, dB);
      pu.headM.p = distAt(pu, dA);
      pu.headM2.p = distAt(pu, dB);
      any = true;
      if (pu.done && !pu.clearing) {
        pu.clearing = true;
        setTimeout(() => {
          scene.lines = scene.lines.filter(l => l !== pu.line);
          scene.markers = scene.markers.filter(m => m !== pu.headM && m !== pu.headM2);
          pu.removed = true;
          dirty = true;
        }, 600);
      }
    }
    state.pulses = state.pulses.filter(p => !p.removed);
    return any;
  }

  /* ------------------------ 渲染循环 ------------------------ */
  function loop(t) {
    const dt = Math.min(50, t - lastT || 16); lastT = t;
    let anim = false;
    if (state.autoRotate) { cam.theta += dt * 0.00022; anim = true; }
    if (state.medPlaying) { state.breath = (state.breath + dt / 1000) % 8; anim = true; updateBreath(); }
    if (updatePulses(dt)) anim = true;
    if (anim || dirty) { doRender(); dirty = false; }
    rafId = requestAnimationFrame(loop);
  }

  function doRender() {
    renderer.render(scene, cam);
    drawOverlay();
  }

  function drawOverlay() {
    const ctx = renderer.ctx, r = renderer, c = r._cam, f = r._focal;
    if (!c) return;
    const labels = [];
    if (state.selected) {
      const s = state.selected;
      labels.push({ p: [s.point.x * s.side + (s.ox || 0), s.point.y, s.point.z], text: s.point.n, sub: s.point.c, color: "#fff3c4", main: true });
    }
    state.related.forEach(rr => {
      bodies.forEach(b => {
        labels.push({ p: [rr.point.x * (rr.side || 1) + b.ox, rr.point.y, rr.point.z], text: rr.point.n, sub: rr.point.c, color: "#ffd166" });
      });
    });
    labels.forEach(L => {
      const p = r.project(L.p, c, f);
      if (!p) return;
      const txt = L.text, code = L.sub || "";
      ctx.save();
      ctx.font = (L.main ? "600 15px" : "500 12px") + ' "Noto Serif SC","Songti SC",serif';
      const w = Math.max(ctx.measureText(txt).width, ctx.measureText(code).width * 0.9) + 18;
      const h = code ? 34 : 22;
      const x = p.x + 12, y = p.y - h / 2;
      ctx.fillStyle = "rgba(12,10,8,0.78)";
      ctx.strokeStyle = L.color; ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = L.color; ctx.textBaseline = "middle";
      if (code) {
        ctx.fillText(txt, x + 9, y + 11);
        ctx.font = '400 10px "Noto Serif SC",serif';
        ctx.fillStyle = "rgba(255,240,200,0.72)";
        ctx.fillText(code, x + 9, y + 25);
      } else {
        ctx.fillText(txt, x + 9, y + h / 2);
      }
      ctx.restore();
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* ------------------------ 呼吸引导 ------------------------ */
  function updateBreath() {
    const el = document.getElementById("breath");
    if (!el) return;
    const t = state.breath;
    let k;
    if (t < 3) k = t / 3;
    else if (t < 4) k = 1;
    else if (t < 7) k = 1 - (t - 4) / 3;
    else k = 0;
    const s = 0.72 + 0.28 * k;
    el.style.transform = "scale(" + s.toFixed(3) + ")";
    el.style.opacity = (0.35 + 0.5 * k).toFixed(2);
    const lbl = document.getElementById("breathLabel");
    if (lbl) lbl.textContent = t < 3 ? "吸" : (t < 4 ? "住" : (t < 7 ? "呼" : "止"));
  }

  /* ------------------------ 交互 ------------------------ */
  let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;

  function bindInteraction(cv) {
    cv.addEventListener("pointerdown", e => {
      dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
      AudioKit.init();
      if (AudioKit.ctx && AudioKit.ctx.state === "suspended") AudioKit.ctx.resume();
    });
    cv.addEventListener("pointermove", e => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        dragMoved += Math.abs(dx) + Math.abs(dy);
        cam.theta -= dx * 0.0075;
        cam.phi = Math.max(0.28, Math.min(Math.PI - 0.28, cam.phi - dy * 0.006));
        dirty = true;
      } else {
        doHover(e);
      }
    });
    cv.addEventListener("pointerup", e => {
      const wasDrag = dragMoved > 6;
      dragging = false;
      if (!wasDrag) doClick(e);
    });
    cv.addEventListener("pointerleave", () => { dragging = false; });
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      cam.dist = Math.max(1.5, Math.min(11, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      dirty = true;
    }, { passive: false });
    // 触屏双指缩放
    let pinch = null;
    cv.addEventListener("touchstart", e => { if (e.touches.length === 2) { pinch = td(e); } }, { passive: true });
    cv.addEventListener("touchmove", e => {
      if (e.touches.length === 2 && pinch) {
        const d = td(e);
        cam.dist = Math.max(1.5, Math.min(11, cam.dist * (pinch / d)));
        pinch = d; dirty = true;
      }
    }, { passive: true });
    cv.addEventListener("touchend", () => { pinch = null; }, { passive: true });
  }
  function td(e) {
    const a = e.touches[0], b = e.touches[1];
    return Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
  }

  function canvasPos(e) {
    const rect = renderer.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function doClick(e) {
    const { x, y } = canvasPos(e);
    const mk = renderer.pick(scene, cam, x, y);
    if (mk && mk.data && mk.data.point) {
      const d = mk.data;
      if (d.related) { selectPoint(d.mer, d.point, d.side, d.ox, true); }
      else { selectPoint(d.mer, d.point, d.side, d.ox); }
      return;
    }
    const ln = pickLine(x, y);
    if (ln) { activate(ln._mer.id, true); showTab("meridian"); renderMeridianWiki(ln._mer); }
  }

  function doHover(e) {
    const { x, y } = canvasPos(e);
    const mk = renderer.pick(scene, cam, x, y, 6);
    let name = "";
    if (mk && mk.data) { name = mk.data.point.n + " " + mk.data.point.c + " · " + mk.data.mer.name; }
    else {
      const ln = pickLine(x, y, 9);
      if (ln) name = ln._mer.name + "（点击查看经络百科）";
    }
    const tip = document.getElementById("tooltip");
    if (tip) {
      if (name) { tip.textContent = name; tip.style.opacity = 1; tip.style.left = (x + 16) + "px"; tip.style.top = (y + 12) + "px"; }
      else tip.style.opacity = 0;
    }
    renderer.canvas.style.cursor = name ? "pointer" : "grab";
  }

  function pickLine(sx, sy, tol) {
    tol = tol || 8;
    const r = renderer, f = r._focal, c = r._cam;
    if (!c) return null;
    let best = null, bestD = tol;
    for (const L of scene.lines) {
      if (L.group !== "meridians" && L.group !== "arcs") continue;
      const pr = L.pts.map(p => r.project(p, c, f));
      for (let i = 0; i < pr.length - 1; i++) {
        if (!pr[i] || !pr[i + 1]) continue;
        const d = segDist(sx, sy, pr[i].x, pr[i].y, pr[i + 1].x, pr[i + 1].y);
        if (d < bestD) { bestD = d; best = L; }
      }
    }
    return best;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /* ------------------------ 选中 / 激活 ------------------------ */
  function selectPoint(mer, point, side, ox, isRelated) {
    ox = fixOx(ox);
    state.selected = { mer: mer, point: point, side: side, ox: ox };
    if (!isActive(mer.id)) { state.active[mer.id] = true; }
    state.related = computeRelated(mer, point);
    rebuildMeridians();
    rebuildRelated();
    renderPointCard(mer, point);
    renderMeridianWiki(mer);
    showTab("point");
    refreshList();
    dirty = true;
  }

  function activate(id, exclusive) {
    if (exclusive) { state.active = {}; }
    state.active[id] = !state.active[id];
    if (exclusive) state.active[id] = true;
    rebuildMeridians();
    refreshList();
    dirty = true;
  }

  function setView(name) {
    const pi = Math.PI;
    if (name === "front") { cam.theta = 0; cam.phi = pi / 2; }
    if (name === "back") { cam.theta = pi; cam.phi = pi / 2; }
    if (name === "left") { cam.theta = -pi / 2; cam.phi = pi / 2; }
    if (name === "right") { cam.theta = pi / 2; cam.phi = pi / 2; }
    if (name === "top") { cam.theta = 0; cam.phi = 0.34; }
    if (name === "iso") { cam.theta = 0.62; cam.phi = 1.24; }
    dirty = true;
  }

  /* ------------------------ UI 渲染 ------------------------ */
  function refreshList() {
    const box = document.getElementById("merList");
    if (!box) return;
    box.innerHTML = "";
    MERIDIANS.forEach(mer => {
      const act = isActive(mer.id);
      const d = document.createElement("div");
      d.className = "mer-item" + (act ? " on" : "");
      d.innerHTML =
        '<span class="dot" style="background:' + mer.color + ';box-shadow:0 0 8px ' + mer.color + '"></span>' +
        '<span class="mn">' + mer.name + '</span>' +
        '<span class="mt">' + mer.time.split(" ")[0] + '</span>';
      d.onclick = () => {
        state.active = {}; state.active[mer.id] = true;
        rebuildMeridians(); refreshList();
        renderMeridianWiki(mer); showTab("meridian");
        dirty = true;
      };
      box.appendChild(d);
    });
    const cnt = document.getElementById("activeCount");
    if (cnt) cnt.textContent = Object.keys(state.active).filter(k => state.active[k]).length;
  }

  /* ------------------------ 解剖对照 · 中医脏腑 ↔ 现代医学 ------------------------ */
  const ANAT_TAG = { nerve: "神经", vessel: "血管", muscle: "肌肉", organ: "器官" };
  const ANATOMY_MAP = [
    {
      organ: "心 · 心包", mer: ["HT", "PC"], fn: "主血脉、藏神明；心包为心之外卫，代心受邪",
      items: [
        ["心脏（四腔）、心包膜、瓣膜与腱索", "organ"],
        ["冠状动脉、主动脉、上下腔静脉、肺动静脉", "vessel"],
        ["迷走神经心支、颈胸交感节、心丛", "nerve"],
        ["心肌层、乳头肌、传导系（窦房结—房室结）", "muscle"]
      ],
      cross: "「心主血脉」≈ 心脏泵血与冠脉循环；「心藏神」与迷走—交感自主神经对情志、睡眠、心率的调节相关。"
    },
    {
      organ: "肺", mer: ["LU"], fn: "主气司呼吸、宣发肃降、通调水道、朝百脉",
      items: [
        ["肺叶、气管支气管树、胸膜与胸膜腔", "organ"],
        ["肺动脉、肺静脉、支气管动静脉", "vessel"],
        ["膈神经、迷走神经肺支、胸交感干", "nerve"],
        ["肋间肌、膈肌、腹肌（呼吸动力肌群）", "muscle"]
      ],
      cross: "「肺主气」≈ 肺通气与换气功能；「宣发肃降」≈ 气道廓清与膈肌—肋间肌的呼吸运动；「肺朝百脉」≈ 肺循环。"
    },
    {
      organ: "肝", mer: ["LR"], fn: "主疏泄、藏血，主筋，开窍于目",
      items: [
        ["肝脏（肝叶、肝窦）、肝被膜", "organ"],
        ["门静脉、肝动脉、肝静脉、下腔静脉", "vessel"],
        ["迷走神经肝支、腹腔神经丛、肝交感神经", "nerve"],
        ["膈肌毗邻、腹壁肌群、肝内血管平滑肌", "muscle"]
      ],
      cross: "「肝主疏泄」≈ 自主神经—内分泌对情绪与消化的调节，以及门静脉系统的代谢转运；「肝藏血」≈ 肝血窦储血与凝血因子合成。"
    },
    {
      organ: "胆", mer: ["GB"], fn: "贮藏排泄胆汁、主决断，与肝相表里",
      items: [
        ["胆囊、肝内胆管、胆总管、十二指肠乳头", "organ"],
        ["胆囊动脉、门静脉、肝动脉分支", "vessel"],
        ["迷走神经肝支、腹腔神经丛", "nerve"],
        ["Oddi 括约肌、胆囊壁平滑肌", "muscle"]
      ],
      cross: "「胆主决断」与胆囊收缩、胆汁排放的神经调控相关；肝胆相表里 ≈ 胆道系统与肝脏在解剖上直接相连。"
    },
    {
      organ: "脾", mer: ["SP"], fn: "主运化、统血，为后天之本、气血生化之源",
      items: [
        ["脾脏、胰腺、部分小肠（运化功能载体）", "organ"],
        ["脾动脉、脾静脉、门静脉", "vessel"],
        ["腹腔神经丛、脾交感神经、迷走神经腹腔支", "nerve"],
        ["胃肠平滑肌、腹壁肌群", "muscle"]
      ],
      cross: "中医「脾」是功能系统概念：主运化 ≈ 消化吸收（胰、小肠）；主统血 ≈ 脾脏滤血、储血与免疫监视。"
    },
    {
      organ: "胃", mer: ["ST"], fn: "主受纳、腐熟水谷，以降为和",
      items: [
        ["胃（贲门—胃体—幽门）、食管下段、十二指肠", "organ"],
        ["胃左/右动脉、胃网膜动脉、门静脉属支", "vessel"],
        ["迷走神经前后干、腹腔神经丛", "nerve"],
        ["胃壁三层平滑肌、幽门括约肌", "muscle"]
      ],
      cross: "「胃主受纳腐熟」≈ 胃酸分泌与机械研磨（胃壁肌层蠕动）；「以降为和」≈ 胃排空与幽门括约肌协同。"
    },
    {
      organ: "小肠", mer: ["SI"], fn: "受盛化物、泌别清浊",
      items: [
        ["十二指肠、空肠、回肠", "organ"],
        ["肠系膜上动脉、肠系膜上静脉、门静脉", "vessel"],
        ["迷走神经、腹腔神经丛、肠神经丛", "nerve"],
        ["小肠平滑肌（分节运动、蠕动）", "muscle"]
      ],
      cross: "泌别清浊 ≈ 小肠的营养吸收与水电解质分离；小肠经循行于上肢尺侧，伴行尺神经与尺动脉。"
    },
    {
      organ: "大肠", mer: ["LI"], fn: "传导糟粕、吸收水分，主津",
      items: [
        ["盲肠、升/横/降/乙状结肠、直肠", "organ"],
        ["肠系膜上/下动脉、门静脉属支、直肠动静脉", "vessel"],
        ["迷走神经、肠系膜下丛、盆神经（骶副交感）", "nerve"],
        ["结肠平滑肌、肛门内外括约肌", "muscle"]
      ],
      cross: "「传导糟粕」≈ 结肠吸收水分与排便反射；手阳明大肠经循上肢桡侧，与桡神经、头静脉相伴行。"
    },
    {
      organ: "肾", mer: ["KI"], fn: "藏精、主水、主纳气，为先天之本，腰为肾之府",
      items: [
        ["肾脏、肾上腺、输尿管", "organ"],
        ["肾动脉、肾静脉、腹主动脉", "vessel"],
        ["肾交感神经、腹腔神经丛、迷走神经", "nerve"],
        ["腰方肌、竖脊肌（肾区）、逼尿肌", "muscle"]
      ],
      cross: "「肾藏精」≈ 肾上腺—性腺内分泌轴；「主水」≈ 肾小球滤过与体液调节；「腰为肾之府」≈ 肾区腰背肌群。"
    },
    {
      organ: "膀胱", mer: ["BL"], fn: "贮尿排尿、气化则能出",
      items: [
        ["膀胱、输尿管膀胱口、尿道", "organ"],
        ["膀胱上下动脉、髂内动脉、前列腺静脉丛", "vessel"],
        ["盆神经（副交感）、腹下神经（交感）、阴部神经", "nerve"],
        ["逼尿肌、尿道内/外括约肌", "muscle"]
      ],
      cross: "「膀胱气化」≈ 逼尿肌与括约肌的神经协同排尿；足太阳膀胱经循行于背腰下肢后侧，与骶神经丛、坐骨神经走向高度重合。"
    },
    {
      organ: "三焦", mer: ["SJ"], fn: "主决渎、通行元气，上焦如雾、中焦如沤、下焦如渎",
      items: [
        ["胸膜腔、纵隔、腹膜腔、盆腔间隙", "organ"],
        ["胸导管、淋巴干、淋巴管、奇静脉", "vessel"],
        ["迷走神经、交感干、内脏神经丛", "nerve"],
        ["膈肌、胸腹壁肌群（体腔分隔与动力）", "muscle"]
      ],
      cross: "「三焦」无单一解剖对应，通常理解为体腔分域与通路系统：上焦—胸腔、中焦—腹腔上部、下焦—盆腔；「决渎」≈ 淋巴回流与体液通道。"
    }
  ];

  function renderAnatomyPane() {
    const box = document.getElementById("wikiAnatomy");
    if (!box) return;
    let h = "";
    h += '<div class="anat-note">中医脏腑是「功能系统」的概括，与现代解剖器官并非一一对应。下表给出各脏腑与现代医学结构（器官 / 血管 / 神经 / 筋腱肌肉）的对照；点击卡片下方按钮即可在模型上单独高亮该层。</div>';
    h += '<div class="anat-legend">' +
         '<span class="alg alg-organ">器官层</span>' +
         '<span class="alg alg-vessel">血管层</span>' +
         '<span class="alg alg-nerve">神经层</span>' +
         '<span class="alg alg-muscle">筋腱肌肉层</span>' +
         '<span class="alg alg-mer">经络穴位层</span>' +
         '</div>';
    const layerBtns = [["nerve", "神经层"], ["vessel", "血管层"], ["muscle", "肌肉层"], ["organ", "器官层"]];
    ANATOMY_MAP.forEach(function (o) {
      h += '<div class="anat-card">';
      h += '<div class="anat-hd"><b>' + o.organ + '</b><span class="anat-mer">' +
           o.mer.map(function (m) { const mm = getMer(m); return mm ? mm.name : m; }).join(" · ") + '</span></div>';
      h += '<div class="anat-fn">' + o.fn + '</div>';
      h += '<table class="anat-tb">';
      o.items.forEach(function (it) {
        h += '<tr><th class="k-' + it[1] + '">' + ANAT_TAG[it[1]] + '</th><td>' + it[0] + '</td></tr>';
      });
      h += '</table>';
      h += '<div class="anat-cross">' + o.cross + '</div>';
      h += '<div class="anat-btns">';
      layerBtns.forEach(function (kv) {
        const on = state.anat[kv[0]] || (kv[0] === "organ" && state.showOrgans);
        h += '<button class="btn' + (on ? " on" : "") + '" data-anat="' + kv[0] + '">' + kv[1] + '</button>';
      });
      h += '</div></div>';
    });
    box.innerHTML = h;
    box.querySelectorAll("[data-anat]").forEach(function (b) {
      b.onclick = function () {
        const k = this.dataset.anat;
        const on = !(state.anat[k] || (k === "organ" && state.showOrgans));
        setAnatLayer(k, on);
        box.querySelectorAll('[data-anat="' + k + '"]').forEach(function (x) { x.classList.toggle("on", on); });
      };
    });
  }

  function renderMeridianWiki(mer) {
    const el = document.getElementById("wikiMeridian");
    if (!el) return;
    const pi = PAIRS[mer.id] || {};
    const rows = mer.points.map(p =>
      '<tr data-c="' + p.c + '"><td class="code">' + p.c + '</td><td class="nm">' + p.n + '</td>' +
      '<td class="py">' + p.p + '</td><td class="fx">' + (p.fx.split("。")[0] + "。") + '</td></tr>').join("");
    el.innerHTML =
      '<div class="wiki-h" style="border-color:' + mer.color + '">' +
      '<h3>' + mer.name + '</h3><span class="badge" style="background:' + mer.color + '22;color:' + mer.color + '">' + mer.type + '</span></div>' +
      '<div class="kv"><b>代号</b><span>' + mer.id + '（' + mer.abbr + '）</span></div>' +
      '<div class="kv"><b>五行 / 络属</b><span>' + mer.element + ' · ' + mer.organ + '</span></div>' +
      '<div class="kv"><b>流注时辰</b><span>' + mer.time + '</span></div>' +
      '<div class="kv"><b>表里关系</b><span>' + (pi.label || "—") + '</span></div>' +
      '<div class="kv"><b>本经穴数</b><span>' + mer.points.length + ' 穴（本演示收录）</span></div>' +
      '<div class="sec"><h4>经脉循行</h4><p class="flow">' + mer.flow + '</p></div>' +
      '<div class="sec"><h4>主治概要</h4><p class="flow">' + (FEEDBACK[mer.id] ? FEEDBACK[mer.id].qi : "") + '</p></div>' +
      '<div class="sec"><h4>本经腧穴</h4><table class="ptable"><thead><tr><th>代号</th><th>穴名</th><th>拼音</th><th>主治</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    el.querySelectorAll("tbody tr").forEach(tr => {
      tr.onclick = () => {
        const f = findPoint(tr.dataset.c);
        if (f) selectPoint(f.mer, f.point, 1, 0);
      };
    });
  }

  function renderPointCard(mer, p) {
    const el = document.getElementById("wikiPoint");
    if (!el) return;
    const rel = state.related.map(r =>
      '<div class="rel-row" data-c="' + r.point.c + '">' +
      '<span class="rc" style="color:' + r.mer.color + '">' + r.point.c + '</span>' +
      '<span class="rn">' + r.point.n + '</span>' +
      '<span class="rr">' + r.rel + '</span>' +
      '<span class="rm" style="background:' + r.mer.color + '22;color:' + r.mer.color + '">' + r.mer.abbr + '</span></div>').join("");
    el.innerHTML =
      '<div class="pt-head"><div class="pt-name">' + p.n + '</div>' +
      '<div class="pt-code">' + p.c + ' · ' + p.p + '</div>' +
      '<div class="pt-mer" style="color:' + mer.color + '">' + mer.name + '　' + (p.tag ? '<span class="tag">' + p.tag + '</span>' : '') + '</div></div>' +
      '<div class="sec"><h4>定位</h4><p>' + p.loc + '</p></div>' +
      '<div class="sec"><h4>主治</h4><p>' + p.fx + '</p></div>' +
      '<div class="sec"><h4>所属经络</h4><p>' + mer.name + '（' + mer.id + '）　流注：' + mer.time + '</p></div>' +
      '<div class="stim-bar">' +
      '<button class="btn primary" id="btnStim">▶ 施以刺激 · 观察经络反馈</button>' +
      '</div>' +
      '<div class="sec"><h4>关联穴位（' + state.related.length + '）</h4>' +
      (rel || '<p class="dim">该穴未匹配到演示库中的常用配穴关系。</p>') + '</div>';
    const b = el.querySelector("#btnStim");
    if (b) b.onclick = () => stimulate(mer, p, state.selected.side, state.selected.ox);
    el.querySelectorAll(".rel-row").forEach(r => {
      r.onclick = () => { const f = findPoint(r.dataset.c); if (f) selectPoint(f.mer, f.point, state.selected ? state.selected.side : 1, state.selected ? state.selected.ox : 0, true); };
    });
  }

  function renderFeedback(mer, p) {
    const el = document.getElementById("wikiFeedback");
    if (!el) return;
    const fb = FEEDBACK[mer.id] || {};
    const pi = PAIRS[mer.id] || {};
    const biaoMer = pi.biao ? getMer(pi.biao) : null;
    const rel = state.related.map(r =>
      '<div class="rel-row" data-c="' + r.point.c + '"><span class="rc" style="color:' + r.mer.color + '">' + r.point.c + '</span>' +
      '<span class="rn">' + r.point.n + '</span><span class="rr">' + r.rel + '</span></div>').join("");
    el.innerHTML =
      '<div class="fb-head"><span class="fb-dot"></span>刺激事件：' + p.n + '（' + p.c + '）</div>' +
      '<div class="fb-chain">' +
      '<div class="fb-node"><b>① 穴位受激</b><span>' + p.n + ' · ' + (p.tag || "经穴") + '　' + p.loc + '</span></div>' +
      '<div class="fb-arrow">↓ 经气激发</div>' +
      '<div class="fb-node"><b>② 经络传导</b><span>' + mer.name + '　' + (fb.resp || "") + '</span></div>' +
      '<div class="fb-arrow">↓ 内属脏腑</div>' +
      '<div class="fb-node"><b>③ 脏腑应答</b><span>络属：' + mer.organ + '　相关系统：' + (fb.organ || "") + '</span></div>' +
      '<div class="fb-arrow">↓ 表里相合</div>' +
      '<div class="fb-node"><b>④ 表里经联动</b><span>' + (biaoMer ? biaoMer.name + '：' + (FEEDBACK[biaoMer.id] ? FEEDBACK[biaoMer.id].resp : "") : "—") + '</span></div>' +
      '<div class="fb-arrow">↓ 牵动关联腧穴</div>' +
      '<div class="fb-node"><b>⑤ 关联穴位响应</b><div class="rel-wrap">' + (rel || '<span class="dim">无</span>') + '</div></div>' +
      '</div>' +
      '<div class="fb-tip">体感提示：' + (fb.tip || "") + '</div>' +
      '<div class="fb-disclaim">本反馈为基于中医经络理论的推演演示，非医疗诊断或治疗建议。</div>';
    el.querySelectorAll(".rel-row").forEach(r => {
      r.onclick = () => { const f = findPoint(r.dataset.c); if (f) selectPoint(f.mer, f.point, state.selected ? state.selected.side : 1, state.selected ? state.selected.ox : 0, true); };
    });
  }

  function showTab(name) {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === name));
    document.querySelectorAll(".tabpane").forEach(t => t.classList.toggle("on", t.id === "pane-" + name));
  }

  /* ------------------------ 冥想配音 ------------------------ */
  let medIdx = 0, medTimer = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    const vs = speechSynthesis.getVoices();
    const zh = vs.filter(v => /zh[-_]?CN|Chinese|中文|普通话/i.test(v.lang + v.name));
    return zh[0] || vs.find(v => /zh/i.test(v.lang)) || null;
  }
  function speak(text, cb) {
    if (!("speechSynthesis" in window)) { setTimeout(cb, Math.max(2600, text.length * 240 + 1500)); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN"; u.rate = 0.80; u.pitch = 0.92; u.volume = state.voiceVol;
    const v = pickVoice(); if (v) u.voice = v;
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(medTimer); cb && cb(); };
    u.onend = fin; u.onerror = fin;
    medTimer = setTimeout(fin, Math.max(3000, text.length * 320 + 2200));
    try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { fin(); }
  }
  function medNext() {
    if (!state.medPlaying) return;
    if (medIdx >= MED.lines.length) { medStop(true); return; }
    const line = MED.lines[medIdx];
    document.getElementById("medText").textContent = line.text;
    document.getElementById("medIndex").textContent = (medIdx + 1) + " / " + MED.lines.length;
    const bar = document.getElementById("medBar");
    if (bar) bar.style.width = ((medIdx + 1) / MED.lines.length * 100) + "%";
    speak(line.text, () => { medIdx++; setTimeout(medNext, 450); });
  }
  function medStart() {
    AudioKit.init(); AudioKit.start();
    state.medPlaying = true; state.breath = 0;
    const btn = document.getElementById("btnMed");
    if (btn) btn.textContent = "⏸ 暂停冥想引导";
    medIdx = 0;
    // 先给一句起势
    medNext();
    dirty = true;
  }
  function medStop(finished) {
    state.medPlaying = false;
    if (medTimer) clearTimeout(medTimer);
    if ("speechSynthesis" in window) { try { speechSynthesis.cancel(); } catch (e) { } }
    AudioKit.stop();
    const btn = document.getElementById("btnMed");
    if (btn) btn.textContent = "▶ 播放冥想引导";
    const lbl = document.getElementById("breathLabel");
    if (lbl) lbl.textContent = "息";
    const br = document.getElementById("breath");
    if (br) { br.style.transform = "scale(0.8)"; br.style.opacity = 0.3; }
    if (finished) {
      document.getElementById("medText").textContent = "引导结束。经络已通，神气已足 —— 愿你身安、心安。";
      document.getElementById("medIndex").textContent = MED.lines.length + " / " + MED.lines.length;
      const bar = document.getElementById("medBar"); if (bar) bar.style.width = "100%";
    }
    dirty = true;
  }

  /* ------------------------ 搜索 ------------------------ */
  function bindSearch() {
    const inp = document.getElementById("searchBox");
    const res = document.getElementById("searchRes");
    if (!inp) return;
    inp.addEventListener("input", () => {
      const q = inp.value.trim();
      if (!q) { res.innerHTML = ""; return; }
      const hits = ALL.filter(p => p.n.indexOf(q) >= 0 || p.c.toLowerCase().indexOf(q.toLowerCase()) >= 0 || (p.tag && p.tag.indexOf(q) >= 0)).slice(0, 12);
      res.innerHTML = hits.map(p =>
        '<div class="sres" data-c="' + p.c + '"><span class="rc" style="color:' + p._m.color + '">' + p.c + '</span>' +
        '<span class="rn">' + p.n + '</span><span class="rm">' + p._m.abbr + '</span></div>').join("") ||
        '<div class="dim" style="padding:6px 10px">未找到匹配穴位</div>';
      res.querySelectorAll(".sres").forEach(d => {
        d.onclick = () => { const f = findPoint(d.dataset.c); if (f) { selectPoint(f.mer, f.point, 1, 0); inp.value = ""; res.innerHTML = ""; } };
      });
    });
  }

  /* ------------------------ 启动 ------------------------ */
  function init() {
    const cv = document.getElementById("scene");
    renderer = new E.Renderer(cv);
    cam = new E.Camera();
    cam.theta = 0; cam.phi = Math.PI / 2; cam.dist = 4.6;
    buildAll();
    bindInteraction(cv);
    bindSearch();
    refreshList();
    renderMeridianWiki(MERIDIANS[0]);
    renderAnatomyPane();
    // 默认激活肺经 + 任督二脉作为引导，默认选「列缺」（络穴）演示配穴
    state.active["LU"] = true;
    state.active["CV"] = true;
    state.active["GV"] = true;
    const dp = MERIDIANS[0].points[3];
    state.selected = { mer: MERIDIANS[0], point: dp, side: 1, ox: 0 };
    state.related = computeRelated(MERIDIANS[0], dp);
    rebuildMeridians(); refreshList();
    renderPointCard(MERIDIANS[0], dp);
    rebuildRelated();

    // 控件绑定
    const id = x => document.getElementById(x);
    id("viewFront").onclick = () => setView("front");
    id("viewBack").onclick = () => setView("back");
    id("viewLeft").onclick = () => setView("left");
    id("viewRight").onclick = () => setView("right");
    id("viewTop").onclick = () => setView("top");
    id("viewIso").onclick = () => setView("iso");
    id("viewFit").onclick = () => { cam.dist = state.gender === "both" ? 7.4 : 4.6; cam.theta = state.gender === "both" ? 0 : cam.theta; dirty = true; };
    id("genderMale").onclick = () => setGender("male");
    id("genderFemale").onclick = () => setGender("female");
    id("genderBoth").onclick = () => setGender("both");
    id("tglLines").onclick = function () { state.showLines = !state.showLines; this.classList.toggle("on", state.showLines); rebuildMeridians(); syncAnatButtons(); };
    id("tglPoints").onclick = function () { state.showAllPoints = !state.showAllPoints; this.classList.toggle("on", state.showAllPoints); rebuildMeridians(); syncAnatButtons(); };
    id("tglBoth").onclick = function () { state.bothSides = !state.bothSides; this.classList.toggle("on", state.bothSides); rebuildMeridians(); rebuildRelated(); };
    id("tglOrgans").onclick = function () { state.showOrgans = !state.showOrgans; state.anat.organ = state.showOrgans; this.classList.toggle("on", state.showOrgans); applyBodyOpacity(); syncAnatButtons(); };
    id("tglRotate").onclick = function () { state.autoRotate = !state.autoRotate; this.classList.toggle("on", state.autoRotate); };

    /* —— 解剖层开关（各自独立，可任意叠加同显）—— */
    const ANAT_IDS = { anatNerve: "nerve", anatVessel: "vessel", anatMuscle: "muscle", anatOrgan: "organ", anatMeridian: "meridian" };
    Object.keys(ANAT_IDS).forEach(function (idn) {
      const el = id(idn);
      if (!el) return;
      el.onclick = function () {
        const key = ANAT_IDS[idn];
        const cur = (key === "meridian") ? state.showLines : (key === "organ" ? state.showOrgans : state.anat[key]);
        setAnatLayer(key, !cur);
      };
    });
    const aop = id("anatOp");
    if (aop) {
      state.anatOp = (parseFloat(aop.value) || 80) / 100;
      aop.oninput = function () { state.anatOp = this.value / 100; applyAnat(); };
    }
    syncAnatButtons();
    id("btnMed").onclick = () => { if (state.medPlaying) medStop(false); else medStart(); };
    id("vol").oninput = function () { state.voiceVol = this.value / 100; AudioKit.setVolume(state.voiceVol); };
    state.voiceVol = (parseFloat(id("vol").value) || 70) / 100;
    AudioKit.setVolume(state.voiceVol);
    id("btnReset").onclick = () => {
      state.pulses.forEach(p => {
        scene.lines = scene.lines.filter(l => l !== p.line);
        scene.markers = scene.markers.filter(m => m !== p.headM && m !== p.headM2);
      });
      state.pulses = []; state.pending = null; state.related = []; state.stim = null;
      rebuildRelated(); renderPointCard(state.selected.mer, state.selected.point);
      showTab("point"); dirty = true;
    };
    document.querySelectorAll(".tab").forEach(t => t.onclick = () => showTab(t.dataset.tab));

    // 视角切换按钮组高亮
    document.querySelectorAll("[data-view]").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll("[data-view]").forEach(x => x.classList.remove("on"));
        b.classList.add("on");
      });
    });
    document.querySelectorAll("[data-gender]").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll("[data-gender]").forEach(x => x.classList.remove("on"));
        b.classList.add("on");
      });
    });

    window.addEventListener("resize", () => { renderer.resize(); dirty = true; });
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { };

    rafId = requestAnimationFrame(loop);
  }

  function setGender(g) {
    state.gender = g;
    const keep = state.selected;
    buildAll();
    if (keep) {
      state.selected = { mer: keep.mer, point: keep.point, side: keep.side, ox: 0 };
      state.related = computeRelated(keep.mer, keep.point);
      rebuildRelated();
      renderPointCard(keep.mer, keep.point);
    }
    const fit = document.getElementById("viewFit");
    if (g === "both") { cam.dist = 7.4; } else if (cam.dist > 6.5) { cam.dist = 4.6; }
    dirty = true;
  }

  let booted = false;
  function boot() { if (booted) return; booted = true; init(); }
  window.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();
})();
