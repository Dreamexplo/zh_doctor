/* ==========================================================================
   body.js —— 男女人体模型网格生成 + 经络路径构建 + 现代医学解剖层
   全部为程序化几何（管状体 / 椭球体），不依赖任何外部模型文件
   模块：
     build(kind, quality)      基础体表（高密度网格 + 五官 + 指趾细节）
     buildNerves(kind, q)      神经层（脑 / 脊髓 / 交感干 / 周围神经）
     buildVessels(kind, q)     血管层（心 / 动脉 / 静脉）
     buildMuscles(kind, q)     筋腱肌肉层（肌群 / 肌腱）
   注：器官层随 build() 返回的 organs 字段提供。
   约定：男女人体共用同一组纵向地标 y（仅改半径），穴位坐标因此对两性同时贴合。
   ========================================================================== */
(function () {
  "use strict";
  const V = window.Engine.V;

  /* ------------------------------------------------------------------
     基础发生器：沿路径生成椭圆截面管体
     radii[i] = [rN, rB]  rN 沿法向 N（肢体前后方向），rB 沿副法向 B（肢体左右方向）
     modFn(i, a) 可选，返回 [kN, kB] 对该截面的两向半径做局部缩放（塑造肌肉起伏）
     ------------------------------------------------------------------ */
  function makeTube(path, radii, radial, modFn) {
    const n = path.length, T = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      let t;
      if (i === 0) t = V.sub(path[1], path[0]);
      else if (i === n - 1) t = V.sub(path[n - 1], path[n - 2]);
      else t = V.sub(path[i + 1], path[i - 1]);
      T.push(V.norm(t));
    }
    let ref = [0, 0, 1];
    if (Math.abs(V.dot(T[0], ref)) > 0.9) ref = [1, 0, 0];
    N.push(V.norm(V.sub(ref, V.mul(T[0], V.dot(ref, T[0])))));
    for (let i = 1; i < n; i++) {
      const prev = N[i - 1];
      const d = V.dot(prev, T[i]);
      let nn = V.sub(prev, V.mul(T[i], d));
      let l = Math.sqrt(nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]);
      if (l < 1e-6) {
        let alt = Math.abs(V.dot(T[i], [0, 0, 1])) > 0.9 ? [1, 0, 0] : [0, 0, 1];
        nn = V.norm(V.sub(alt, V.mul(T[i], V.dot(alt, T[i]))));
      } else nn = V.mul(nn, 1 / l);
      N.push(nn);
    }
    for (let i = 0; i < n; i++) B.push(V.norm(V.cross(T[i], N[i])));

    const verts = [], faces = [];
    for (let i = 0; i < n; i++) {
      const c = path[i], rN = radii[i][0], rB = radii[i][1];
      for (let j = 0; j < radial; j++) {
        const a = j / radial * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        let kN = 1, kB = 1;
        if (modFn) {
          const mm = modFn(i, a, n);
          if (mm) { if (mm[0] != null) kN = mm[0]; if (mm[1] != null) kB = mm[1]; }
        }
        verts.push([
          c[0] + ca * rB * kB * B[i][0] + sa * rN * kN * N[i][0],
          c[1] + ca * rB * kB * B[i][1] + sa * rN * kN * N[i][1],
          c[2] + ca * rB * kB * B[i][2] + sa * rN * kN * N[i][2]
        ]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const j2 = (j + 1) % radial;
        const a = i * radial + j, b = i * radial + j2;
        const c = (i + 1) * radial + j, d = (i + 1) * radial + j2;
        faces.push([a, c, b]); faces.push([b, c, d]);
      }
    }
    // 统一法线朝外
    const f0 = faces[0];
    const A = verts[f0[0]], Bv = verts[f0[1]], Cv = verts[f0[2]];
    const nrm = V.cross(V.sub(Bv, A), V.sub(Cv, A));
    const ci = Math.floor(f0[0] / radial);
    if (V.dot(nrm, V.sub(A, path[ci])) < 0) {
      for (let i = 0; i < faces.length; i++) { const tmp = faces[i][1]; faces[i][1] = faces[i][2]; faces[i][2] = tmp; }
    }
    return { verts: verts, faces: faces };
  }

  /* ------------------------------------------------------------------
     基础发生器：椭球体
     ------------------------------------------------------------------ */
  function makeSphere(cx, cy, cz, rx, ry, rz, lon, lat, mod) {
    lon = lon || 16; lat = lat || 10;
    const verts = [], faces = [];
    for (let i = 0; i <= lat; i++) {
      const th = i / lat * Math.PI;
      const st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j < lon; j++) {
        const ph = j / lon * Math.PI * 2;
        let nx = st * Math.cos(ph), ny = ct, nz = st * Math.sin(ph);
        let sx = 1, sy = 1, sz = 1, ox = 0, oy = 0, oz = 0;
        if (mod) { const r = mod(nx, ny, nz) || []; sx = r[0] == null ? 1 : r[0]; sy = r[1] == null ? 1 : r[1]; sz = r[2] == null ? 1 : r[2]; ox = r[3] || 0; oy = r[4] || 0; oz = r[5] || 0; }
        verts.push([cx + nx * rx * sx + ox, cy + ny * ry * sy + oy, cz + nz * rz * sz + oz]);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const j2 = (j + 1) % lon;
        const a = i * lon + j, b = i * lon + j2;
        const c = (i + 1) * lon + j, d = (i + 1) * lon + j2;
        faces.push([a, b, c]); faces.push([b, d, c]);
      }
    }
    return { verts: verts, faces: faces };
  }

  function mirror(m) {
    return {
      verts: m.verts.map(v => [-v[0], v[1], v[2]]),
      faces: m.faces.map(f => [f[0], f[2], f[1]])
    };
  }

  function merge(list) {
    const verts = [], faces = [];
    for (const m of list) {
      const off = verts.length;
      for (const v of m.verts) verts.push(v);
      for (const f of m.faces) faces.push([f[0] + off, f[1] + off, f[2] + off]);
    }
    return { verts: verts, faces: faces };
  }

  /* ------------------------------------------------------------------
     曲线工具：Catmull-Rom 插值（穿过全部控制点，端点为给定值）
     smoothArr 对任意维度的控制点序列重采样，同一控制点数 → 输出点数相同
     ------------------------------------------------------------------ */
  function crPoint(p0, p1, p2, p3, t) {
    const dim = p1.length, out = new Array(dim);
    const t2 = t * t, t3 = t2 * t;
    for (let d = 0; d < dim; d++) {
      const a = p1[d];
      const b = 0.5 * (p2[d] - p0[d]);
      const c = p0[d] - 2.5 * p1[d] + 2 * p2[d] - 0.5 * p3[d];
      const e = -0.5 * p0[d] + 1.5 * p1[d] - 1.5 * p2[d] + 0.5 * p3[d];
      out[d] = a + b * t + c * t2 + e * t3;
    }
    return out;
  }

  function smoothArr(list, target) {
    const n = list.length;
    if (n < 2) return list.map(a => a.slice());
    const segs = n - 1;
    const per = Math.max(2, Math.round(Math.max(target || 0, segs * 2) / segs));
    const out = [];
    for (let s = 0; s < segs; s++) {
      const p0 = list[s > 0 ? s - 1 : 0];
      const p1 = list[s];
      const p2 = list[s + 1];
      const p3 = list[s + 2 < n ? s + 2 : n - 1];
      for (let k = 0; k < per; k++) out.push(crPoint(p0, p1, p2, p3, k / per));
    }
    out.push(list[n - 1].slice());
    return out;
  }

  /* 由控制点插值出连续躯干轮廓（保持原有返回结构） */
  function profile(ctrl, samples) {
    return smoothArr(ctrl, samples).map(a => ({ y: a[0], rB: a[1], rN: a[2], z: a[3] }));
  }

  /* 平滑管体：控制路径与半径同步重采样（点数一致） */
  function tubeSmooth(cp, cr, sections, radial) {
    return makeTube(smoothArr(cp, sections), smoothArr(cr, sections), radial);
  }

  /* 梭形肌腹：两端收细、中段隆起 */
  function fusiform(cp, midPair, endPair, sections, radial) {
    const P = smoothArr(cp, sections);
    const n = P.length;
    const radii = P.map((p, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const k = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55);
      return [endPair[0] + (midPair[0] - endPair[0]) * k, endPair[1] + (midPair[1] - endPair[1]) * k];
    });
    return makeTube(P, radii, radial);
  }

  /* ------------------------------------------------------------------
     躯干 / 四肢轮廓参数（保持原值：穴位坐标依赖该骨架标定）
     ------------------------------------------------------------------ */
  const FIG = {
    male: {
      height: 1.78,
      torso: [
        [0.855, 0.148, 0.113, 0.006],
        [0.940, 0.158, 0.118, 0.006],
        [1.020, 0.144, 0.107, 0.009],
        [1.065, 0.137, 0.103, 0.011],
        [1.140, 0.151, 0.107, 0.009],
        [1.220, 0.167, 0.112, 0.006],
        [1.285, 0.175, 0.116, 0.005],
        [1.355, 0.171, 0.111, 0.004],
        [1.420, 0.162, 0.100, 0.002],
        [1.455, 0.152, 0.086, 0.000]
      ],
      delt: [0.168, 1.400, 0.0, 0.062],
      arm: [
        [[0.180, 1.398, 0.005], [0.058, 0.056]],
        [[0.192, 1.315, 0.008], [0.050, 0.050]],
        [[0.200, 1.220, 0.010], [0.046, 0.045]],
        [[0.205, 1.118, 0.012], [0.043, 0.041]],
        [[0.208, 1.050, 0.014], [0.041, 0.039]],
        [[0.214, 0.965, 0.016], [0.038, 0.036]],
        [[0.222, 0.885, 0.018], [0.033, 0.031]],
        [[0.228, 0.848, 0.019], [0.026, 0.024]]
      ],
      hip: [0.086, 0.898, 0.004, 0.090],
      leg: [
        [[0.088, 0.900, 0.005], [0.088, 0.092]],
        [[0.092, 0.800, 0.008], [0.081, 0.085]],
        [[0.094, 0.700, 0.010], [0.073, 0.076]],
        [[0.095, 0.600, 0.009], [0.065, 0.068]],
        [[0.095, 0.510, 0.007], [0.059, 0.062]],
        [[0.095, 0.465, 0.005], [0.057, 0.059]],
        [[0.094, 0.410, 0.001], [0.058, 0.061]],
        [[0.092, 0.310, -0.006], [0.055, 0.057]],
        [[0.089, 0.210, -0.008], [0.043, 0.045]],
        [[0.087, 0.120, -0.007], [0.036, 0.038]],
        [[0.086, 0.082, -0.005], [0.033, 0.035]]
      ],
      neck: [[0.052, 0.050], [0.046, 0.046]],
      head: [0.083, 0.104, 0.096],
      hand: [0.030, 0.072, 0.017],
      foot: [0.041, 0.033, 0.098],
      skin: "#e4cfb2", skin2: "#e2ccae", brow: "#c3a382", lip: "#c08074", sclera: "#f2e7d6", iris: "#4a3a2e"
    },
    female: {
      height: 1.78,
      torso: [
        [0.855, 0.152, 0.115, 0.006],
        [0.940, 0.172, 0.126, 0.006],
        [1.020, 0.138, 0.104, 0.010],
        [1.065, 0.117, 0.092, 0.015],
        [1.140, 0.135, 0.100, 0.013],
        [1.220, 0.152, 0.108, 0.008],
        [1.285, 0.158, 0.112, 0.006],
        [1.355, 0.150, 0.102, 0.004],
        [1.420, 0.142, 0.092, 0.002],
        [1.455, 0.134, 0.080, 0.000]
      ],
      delt: [0.150, 1.400, 0.0, 0.052],
      arm: [
        [[0.163, 1.398, 0.005], [0.050, 0.049]],
        [[0.175, 1.315, 0.008], [0.043, 0.042]],
        [[0.183, 1.220, 0.010], [0.039, 0.038]],
        [[0.188, 1.118, 0.012], [0.036, 0.035]],
        [[0.191, 1.050, 0.014], [0.034, 0.033]],
        [[0.197, 0.965, 0.016], [0.032, 0.030]],
        [[0.204, 0.885, 0.018], [0.028, 0.026]],
        [[0.209, 0.848, 0.019], [0.023, 0.021]]
      ],
      hip: [0.086, 0.898, 0.004, 0.088],
      leg: [
        [[0.086, 0.900, 0.005], [0.085, 0.088]],
        [[0.090, 0.800, 0.008], [0.077, 0.080]],
        [[0.092, 0.700, 0.010], [0.068, 0.071]],
        [[0.093, 0.600, 0.009], [0.059, 0.062]],
        [[0.093, 0.510, 0.007], [0.053, 0.056]],
        [[0.093, 0.465, 0.005], [0.050, 0.053]],
        [[0.092, 0.410, 0.001], [0.052, 0.055]],
        [[0.090, 0.310, -0.006], [0.049, 0.051]],
        [[0.088, 0.210, -0.008], [0.039, 0.041]],
        [[0.086, 0.120, -0.007], [0.033, 0.035]],
        [[0.086, 0.082, -0.005], [0.030, 0.032]]
      ],
      neck: [[0.045, 0.043], [0.040, 0.040]],
      head: [0.079, 0.100, 0.093],
      hand: [0.027, 0.067, 0.016],
      foot: [0.038, 0.031, 0.094],
      skin: "#f0dcc6", skin2: "#eed7c0", brow: "#cdb094", lip: "#cb8a8a", sclera: "#f4ead9", iris: "#493a2f"
    }
  };

  /* 分辨率档位（quality<1 用于双人同屏，控制三角面数） */
  function resTable(q) {
    const s = q == null ? 1 : q;
    return {
      torsoS: Math.max(22, Math.round(48 * s)),
      torsoR: Math.max(18, Math.round(40 * s)),
      headLon: Math.max(18, Math.round(34 * s)),
      headLat: Math.max(12, Math.round(22 * s)),
      armS: Math.max(14, Math.round(26 * s)),
      armR: Math.max(12, Math.round(24 * s)),
      legS: Math.max(16, Math.round(32 * s)),
      legR: Math.max(14, Math.round(28 * s)),
      neckR: Math.max(10, Math.round(22 * s)),
      jointLon: Math.max(10, Math.round(18 * s)),
      jointLat: Math.max(8, Math.round(13 * s)),
      handLon: Math.max(10, Math.round(18 * s)),
      handLat: Math.max(8, Math.round(12 * s)),
      digitR: Math.max(5, Math.round(8 * s)),
      tubeR: Math.max(8, Math.round(14 * s)),
      muscleR: Math.max(6, Math.round(10 * s)),
      muscleS: Math.max(7, Math.round(11 * s)),
      organLon: Math.max(10, Math.round(16 * s)),
      organLat: Math.max(7, Math.round(10 * s)),
      organS: Math.max(12, Math.round(18 * s))
    };
  }

  /* ------------------------------------------------------------------
     构建人体基础体表
     ------------------------------------------------------------------ */
  function build(kind, quality) {
    const F = FIG[kind] || FIG.male;
    const R = resTable(quality);
    const meshes = [];
    const H = F.height;
    const isF = kind === "female";
    const SK = F.skin, SK2 = F.skin2;

    /* --- 躯干 --- */
    const prof = profile(F.torso, R.torsoS);
    const torsoPath = prof.map(p => [0, p.y, p.z]);
    const torsoRadii = prof.map(p => [p.rN, p.rB]);
    meshes.push({ geo: makeTube(torsoPath, torsoRadii, R.torsoR), color: SK, name: "躯干", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 女性胸部 --- */
    if (isF) {
      for (const sgn of [1, -1]) {
        meshes.push({
          geo: makeSphere(sgn * 0.072, 1.238, 0.098, 0.052, 0.050, 0.048, R.jointLon, R.jointLat),
          color: SK, name: "胸", ambient: 0.30, spec: 0.42, specPow: 26
        });
      }
    }

    /* --- 颈 --- */
    const neckCtrl = [[0, F.torso[F.torso.length - 1][0] - 0.005, 0], [0, 1.500, 0.002], [0, 1.565, 0.004]];
    const neckRCtrl = [[F.neck[0][0], F.neck[0][1]], [F.neck[0][0] * 0.96, F.neck[0][1] * 0.96], [F.neck[1][0], F.neck[1][1]]];
    meshes.push({ geo: tubeSmooth(neckCtrl, neckRCtrl, 12, R.neckR), color: SK, name: "颈", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 头 --- */
    const hy = H - F.head[1];
    const headMod = function (nx, ny, nz) {
      const t = ny;
      let sx = t >= 0 ? 1 - 0.06 * t * t : 1 + 0.30 * t;
      let sz = 1;
      let oz = 0;
      if (t < -0.2) { sz = 1 - 0.10 * (-t - 0.2); }
      if (t < 0 && nz > 0) { oz = 0.016 * (-t); }
      return [sx, 1, sz, 0, 0, oz];
    };
    meshes.push({ geo: makeSphere(0, hy, 0.006, F.head[0], F.head[1], F.head[2], R.headLon, R.headLat, headMod), color: SK, name: "头", ambient: 0.30, spec: 0.44, specPow: 30 });

    /* --- 五官细节 --- */
    const hx0 = F.head[0], hz0 = F.head[2];
    // 鼻（鼻梁 + 鼻头）
    meshes.push({ geo: merge([
      makeSphere(0, hy - 0.016, hz0 * 0.90 + 0.008, 0.013, 0.024, 0.024, R.jointLon, R.jointLat),
      makeSphere(0, hy - 0.030, hz0 * 0.96 + 0.006, 0.0125, 0.011, 0.0125, R.jointLon, R.jointLat)
    ]), color: SK2, name: "鼻", ambient: 0.30, spec: 0.44, specPow: 30 });
    // 眉弓
    for (const sgn of [1, -1]) {
      meshes.push({ geo: makeSphere(sgn * hx0 * 0.40, hy + 0.045, hz0 * 0.82, 0.024, 0.0062, 0.011, R.jointLon, R.jointLat), color: F.brow, name: "眉弓", ambient: 0.34, spec: 0.20, specPow: 18 });
    }
    // 眼（眼白 + 虹膜）
    for (const sgn of [1, -1]) {
      meshes.push({ geo: makeSphere(sgn * hx0 * 0.373, hy + 0.026, hz0 * 0.88, 0.0138, 0.0102, 0.0092, R.jointLon, R.jointLat), color: F.sclera, name: "眼", ambient: 0.5, spec: 0.55, specPow: 40 });
      meshes.push({ geo: makeSphere(sgn * hx0 * 0.373, hy + 0.026, hz0 * 0.975, 0.0056, 0.0056, 0.0052, Math.max(8, R.jointLon - 4), Math.max(6, R.jointLat - 4)), color: F.iris, name: "虹膜", ambient: 0.42, spec: 0.7, specPow: 46 });
    }
    // 唇
    meshes.push({ geo: makeSphere(0, hy - 0.040, hz0 * 1.02, 0.0175, 0.0072, 0.0095, R.jointLon, R.jointLat), color: F.lip, name: "唇", ambient: 0.34, spec: 0.30, specPow: 22 });
    // 耳
    for (const sgn of [1, -1]) {
      meshes.push({ geo: combine(makeSphere(sgn * hx0 * 0.96, hy - 0.004, -0.010, 0.011, 0.026, 0.020, R.jointLon, R.jointLat),
        makeSphere(sgn * hx0 * 0.94, hy - 0.012, 0.002, 0.008, 0.014, 0.011, Math.max(8, R.jointLon - 4), Math.max(6, R.jointLat - 4))), color: SK2, name: "耳", ambient: 0.30, spec: 0.36, specPow: 24 });
    }

    /* --- 肩 / 髋 关节球 --- */
    const d = F.delt;
    for (const sgn of [1, -1]) {
      meshes.push({ geo: makeSphere(sgn * d[0], d[1], d[2], d[3], d[3] * 0.95, d[3] * 0.92, R.jointLon, R.jointLat), color: SK, name: "肩", ambient: 0.30, spec: 0.42, specPow: 26 });
      const hp = F.hip;
      meshes.push({ geo: makeSphere(sgn * hp[0], hp[1], hp[2], hp[3], hp[3] * 0.90, hp[3] * 0.92, R.jointLon, R.jointLat), color: SK, name: "髋", ambient: 0.30, spec: 0.42, specPow: 26 });
    }

    /* --- 手臂 --- */
    const armCP = F.arm.map(a => a[0]);
    const armCR = F.arm.map(a => a[1]);
    const armGeo = tubeSmooth(armCP, armCR, R.armS, R.armR);
    meshes.push({ geo: armGeo, color: SK, name: "臂", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(armGeo), color: SK, name: "臂", ambient: 0.30, spec: 0.42, specPow: 26 });
    // 肘关节
    const elbow = armCP[3];
    const elbowGeo = makeSphere(elbow[0], elbow[1], elbow[2], 0.044, 0.040, 0.041, R.jointLon, R.jointLat);
    meshes.push({ geo: elbowGeo, color: SK, name: "肘", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(elbowGeo), color: SK, name: "肘", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 手（掌 + 五指 + 拇指） --- */
    const wrist = armCP[armCP.length - 1];
    const hd = F.hand;
    const palmC = [wrist[0] + 0.004, wrist[1] - hd[1] * 0.95, wrist[2] + 0.002];
    const handParts = [
      makeSphere(palmC[0], palmC[1], palmC[2], hd[0], hd[1], hd[2], R.handLon, R.handLat),
      makeSphere(wrist[0] - hd[0] * 0.75, wrist[1] - hd[1] * 1.15, wrist[2] + 0.012, hd[0] * 0.45, hd[1] * 0.42, hd[2] * 0.75, Math.max(8, R.handLon - 4), Math.max(6, R.handLat - 3))
    ];
    const fbY = palmC[1] - hd[1] * 0.62;
    const fR = hd[0] * 0.255;
    const fSpec = [
      { ox: -0.019 * (hd[0] / 0.030), len: 0.046 * (hd[0] / 0.030), r: fR * 0.95, dx: -0.010 },
      { ox: -0.0065 * (hd[0] / 0.030), len: 0.052 * (hd[0] / 0.030), r: fR, dx: -0.003 },
      { ox: 0.0060 * (hd[0] / 0.030), len: 0.049 * (hd[0] / 0.030), r: fR * 0.96, dx: 0.003 },
      { ox: 0.0185 * (hd[0] / 0.030), len: 0.040 * (hd[0] / 0.030), r: fR * 0.86, dx: 0.010 }
    ];
    for (const f of fSpec) {
      const bx = palmC[0] + f.ox;
      handParts.push(digitGeo(bx, fbY, palmC[2] + 0.006, f.dx, f.len, f.r, 0.010, R.digitR));
    }
    // 拇指
    handParts.push(digitGeo(palmC[0] - hd[0] * 0.72, palmC[1] - hd[1] * 0.10, palmC[2] + 0.010,
      -0.016, 0.038 * (hd[0] / 0.030), fR * 1.12, 0.014, R.digitR));
    const handGeo = merge(handParts);
    meshes.push({ geo: handGeo, color: SK, name: "手", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(handGeo), color: SK, name: "手", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 腿 --- */
    const legCP = F.leg.map(a => a[0]);
    const legCR = F.leg.map(a => a[1]);
    const legGeo = tubeSmooth(legCP, legCR, R.legS, R.legR);
    meshes.push({ geo: legGeo, color: SK, name: "腿", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(legGeo), color: SK, name: "腿", ambient: 0.30, spec: 0.42, specPow: 26 });
    // 膝关节
    const knee = legCP[5];
    const kneeGeo = makeSphere(knee[0], knee[1], knee[2] + 0.006, 0.056, 0.052, 0.050, R.jointLon, R.jointLat);
    meshes.push({ geo: kneeGeo, color: SK, name: "膝", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(kneeGeo), color: SK, name: "膝", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 足（足弓 + 五趾 + 足跟） --- */
    const ft = F.foot;
    const ank = legCP[legCP.length - 1];
    const footParts = [
      makeSphere(ank[0] + 0.003, ft[1] * 0.92, 0.052, ft[0], ft[1], ft[2], R.handLon, R.handLat),
      makeSphere(ank[0], ft[1] * 1.05, -0.026, ft[0] * 0.92, ft[1] * 1.25, ft[0] * 1.02, Math.max(10, R.handLon - 4), Math.max(8, R.handLat - 3))
    ];
    const toeZ = 0.052 + ft[2] * 0.86;
    for (let t = 0; t < 5; t++) {
      const k = t / 4;
      const tx = ank[0] + (0.030 - 0.062 * k) * (ft[0] / 0.041);
      const tr = (0.0115 - 0.0032 * k) * (ft[0] / 0.041);
      footParts.push(makeSphere(tx, ft[1] * 0.80, toeZ + 0.012 - 0.020 * k, tr, tr * 0.86, tr * 1.35, Math.max(8, R.digitR + 2), Math.max(6, R.digitR)));
    }
    const footGeo = merge(footParts);
    meshes.push({ geo: footGeo, color: SK, name: "足", ambient: 0.30, spec: 0.42, specPow: 26 });
    meshes.push({ geo: mirror(footGeo), color: SK, name: "足", ambient: 0.30, spec: 0.42, specPow: 26 });

    /* --- 内脏（默认隐藏，作为器官层） --- */
    const organList = [
      { n: "心", c: "#c0392b", s: [0.028, 1.288, 0.058, 0.052, 0.062, 0.044] },
      { n: "肺", c: "#b7cddc", s: [0.088, 1.310, 0.020, 0.056, 0.112, 0.068], m: 1 },
      { n: "肝", c: "#7d5a50", s: [-0.074, 1.168, 0.048, 0.082, 0.058, 0.060] },
      { n: "胃", c: "#d8a56a", s: [0.046, 1.152, 0.055, 0.052, 0.052, 0.042] },
      { n: "脾", c: "#9b7653", s: [0.092, 1.205, -0.018, 0.032, 0.028, 0.028] },
      { n: "肾", c: "#8d6a6a", s: [0.072, 1.062, -0.072, 0.030, 0.052, 0.030], m: 1 },
      { n: "胆", c: "#5fa85f", s: [-0.052, 1.128, 0.056, 0.020, 0.028, 0.020] },
      { n: "大肠", c: "#c8a58a", s: [0, 1.015, 0.010, 0.098, 0.060, 0.078] },
      { n: "小肠", c: "#d9b8a0", s: [0, 1.010, 0.062, 0.070, 0.052, 0.050] },
      { n: "膀胱", c: "#a8c0d0", s: [0, 0.932, 0.062, 0.034, 0.038, 0.030] },
      { n: "脑", c: "#cbb8c8", s: [0, 1.742, -0.008, 0.068, 0.070, 0.074] }
    ];
    const organs = [];
    const oLon = R.organS, oLat = Math.max(7, Math.round(R.organS * 0.62));
    for (const o of organList) {
      const gg = [];
      gg.push(makeSphere(o.s[0], o.s[1], o.s[2], o.s[3], o.s[4], o.s[5], oLon, oLat));
      if (o.m) gg.push(makeSphere(-o.s[0], o.s[1], o.s[2], o.s[3], o.s[4], o.s[5], oLon, oLat));
      organs.push({ geo: merge(gg), color: o.c, name: o.n, kind: "organ" });
    }

    return { meshes: meshes, organs: organs, height: H, profile: prof, fig: F };
  }

  /* 指/趾：带轻微弯曲的锥形管 */
  function digitGeo(bx, by, bz, dx, len, r, curl, radial) {
    const cp = [
      [bx, by, bz],
      [bx + dx * 0.34, by - len * 0.40, bz + curl * 0.35],
      [bx + dx * 0.72, by - len * 0.76, bz + curl * 0.95],
      [bx + dx, by - len, bz + curl * 1.55]
    ];
    const cr = [[r, r], [r * 0.92, r * 0.92], [r * 0.80, r * 0.80], [r * 0.58, r * 0.58]];
    return tubeSmooth(cp, cr, 8, radial || 7);
  }

  function combine() {
    const list = [];
    for (let i = 0; i < arguments.length; i++) list.push(arguments[i]);
    return merge(list);
  }

  /* ==================================================================
     解剖层 1：神经层
     脑 / 小脑 / 脑干 / 脊髓 / 交感干 / 臂丛与上肢神经 / 腰骶丛与下肢神经
     / 股神经 / 面神经
     ================================================================== */
  function buildNerves(kind, quality) {
    const F = FIG[kind] || FIG.male;
    const R = resTable(quality);
    const meshes = [], lines = [];
    const NC = "#f0de9e", NC2 = "#e3cd86", NL = "#f7e9b4";
    const hy = F.height - F.head[1];
    const nR = Math.max(7, Math.round(11 * (quality == null ? 1 : quality)));

    /* 大脑（左右半球） */
    for (const sgn of [1, -1]) {
      meshes.push({
        geo: makeSphere(sgn * 0.026, hy + 0.026, 0.004, 0.040, 0.044, 0.050, R.jointLon, R.jointLat),
        color: NC, name: "大脑半球", kind: "nerve", ambient: 0.46, spec: 0.22, specPow: 16
      });
    }
    /* 小脑 */
    meshes.push({ geo: makeSphere(0, hy - 0.014, -0.036, 0.030, 0.021, 0.026, R.jointLon, R.jointLat), color: NC2, name: "小脑", kind: "nerve", ambient: 0.46, spec: 0.22, specPow: 16 });
    /* 脑干 */
    meshes.push({ geo: tubeSmooth([[0, hy + 0.010, 0.010], [0, hy - 0.036, -0.012], [0, hy - 0.084, -0.024]], [[0.011, 0.011], [0.011, 0.011], [0.011, 0.011]], 6, nR), color: NC2, name: "脑干", kind: "nerve", ambient: 0.46, spec: 0.22, specPow: 16 });
    /* 脊髓 */
    const cordCP = [[0, 1.612, -0.026], [0, 1.540, -0.052], [0, 1.462, -0.066], [0, 1.380, -0.072], [0, 1.286, -0.074], [0, 1.190, -0.074], [0, 1.090, -0.072], [0, 1.000, -0.068], [0, 0.940, -0.062], [0, 0.900, -0.058]];
    const cordCR = [[0.0125, 0.0125], [0.012, 0.012], [0.0115, 0.0115], [0.011, 0.011], [0.0105, 0.0105], [0.010, 0.010], [0.0095, 0.0095], [0.009, 0.009], [0.0082, 0.0082], [0.0072, 0.0072]];
    meshes.push({ geo: tubeSmooth(cordCP, cordCR, Math.max(14, Math.round(20 * (quality == null ? 1 : quality))), nR), color: NC, name: "脊髓", kind: "nerve", ambient: 0.46, spec: 0.22, specPow: 16 });

    for (const sgn of [1, -1]) {
      /* 交感神经干 */
      const symCP = [[sgn * 0.020, 1.320, -0.068], [sgn * 0.020, 1.220, -0.072], [sgn * 0.020, 1.120, -0.072], [sgn * 0.020, 1.020, -0.068], [sgn * 0.020, 0.940, -0.062]];
      const symCR = symCP.map(() => [0.0056, 0.0056]);
      meshes.push({ geo: tubeSmooth(symCP, symCR, 10, Math.max(6, Math.round(9 * (quality == null ? 1 : quality)))), color: NC2, name: "交感神经干", kind: "nerve", ambient: 0.46, spec: 0.18, specPow: 14 });

      /* 臂丛 → 上肢神经 */
      lines.push({
        pts: mul(sgn, [[0.014, 1.548, -0.026], [0.052, 1.516, -0.030], [0.100, 1.470, -0.024], [0.148, 1.428, -0.010], [0.176, 1.382, 0.004], [0.190, 1.320, 0.010], [0.196, 1.250, 0.012], [0.201, 1.175, 0.014], [0.206, 1.090, 0.016], [0.211, 1.005, 0.017], [0.217, 0.920, 0.018], [0.225, 0.868, 0.019], [0.230, 0.820, 0.020], [0.233, 0.775, 0.021], [0.235, 0.730, 0.022]]),
        color: NL, width: 2.0, opacity: 0.95, group: "nerve", name: "臂丛与上肢神经"
      });
      /* 腰骶丛 → 下肢神经（坐骨神经走行） */
      lines.push({
        pts: mul(sgn, [[0.018, 1.030, -0.056], [0.046, 0.980, -0.062], [0.072, 0.930, -0.058], [0.086, 0.870, -0.048], [0.092, 0.790, -0.034], [0.095, 0.700, -0.030], [0.096, 0.610, -0.028], [0.096, 0.520, -0.026], [0.094, 0.430, -0.030], [0.092, 0.340, -0.038], [0.090, 0.250, -0.036], [0.088, 0.160, -0.028], [0.087, 0.100, -0.014], [0.087, 0.070, 0.006], [0.089, 0.055, 0.042], [0.091, 0.048, 0.086]]),
        color: NL, width: 2.0, opacity: 0.95, group: "nerve", name: "腰骶丛与坐骨神经"
      });
      /* 股神经（下肢前侧） */
      lines.push({
        pts: mul(sgn, [[0.020, 1.010, -0.020], [0.056, 0.960, -0.010], [0.082, 0.900, 0.004], [0.090, 0.820, 0.014], [0.094, 0.730, 0.020], [0.096, 0.640, 0.022], [0.096, 0.552, 0.018]]),
        color: NL, width: 1.5, opacity: 0.88, group: "nerve", name: "股神经"
      });
      /* 面神经 */
      lines.push({
        pts: mul(sgn, [[0.008, hy + 0.000, 0.020], [0.024, hy - 0.014, 0.048], [0.034, hy - 0.030, 0.062], [0.038, hy - 0.046, 0.070]]),
        color: NL, width: 1.4, opacity: 0.85, group: "nerve", name: "面神经"
      });
    }
    return { meshes: meshes, lines: lines };
  }

  /* ==================================================================
     解剖层 2：血管层
     心 / 主动脉 / 腔静脉 / 颈动静脉 / 上肢动静脉 / 下肢动静脉
     ================================================================== */
  function buildVessels(kind, quality) {
    const F = FIG[kind] || FIG.male;
    const R = resTable(quality);
    const meshes = [], lines = [];
    const ART = "#c0392b", ART2 = "#d4483a", VEN = "#3f6fb5", VEN2 = "#5b86c6";
    const q = quality == null ? 1 : quality;
    const vR = Math.max(7, Math.round(11 * q));
    const hy = F.height - F.head[1];

    /* 心 */
    meshes.push({ geo: makeSphere(0.020, 1.252, 0.058, 0.044, 0.055, 0.044, R.jointLon, R.jointLat), color: "#b03b3b", name: "心", kind: "vessel", ambient: 0.42, spec: 0.30, specPow: 20 });
    /* 主动脉（升主动脉 → 主动脉弓 → 降主动脉） */
    const aoCP = [[0.006, 1.306, 0.040], [0.012, 1.352, 0.018], [0.008, 1.330, -0.014], [0.003, 1.255, -0.046], [0.001, 1.170, -0.056], [0, 1.080, -0.060], [0, 0.990, -0.060], [0, 0.930, -0.058], [0, 0.905, -0.056]];
    const aoCR = [[0.011, 0.011], [0.0105, 0.0105], [0.010, 0.010], [0.0095, 0.0095], [0.009, 0.009], [0.0085, 0.0085], [0.008, 0.008], [0.0075, 0.0075], [0.007, 0.007]];
    meshes.push({ geo: tubeSmooth(aoCP, aoCR, 20, vR), color: ART2, name: "主动脉", kind: "vessel", ambient: 0.42, spec: 0.28, specPow: 20 });

    for (const sgn of [1, -1]) {
      /* 颈总动脉 */
      lines.push({ pts: mul(sgn, [[0.010, 1.320, 0.010], [0.024, 1.420, 0.010], [0.030, 1.520, 0.012], [0.028, 1.600, 0.014], [0.024, 1.652, 0.018]]), color: ART, width: 1.8, opacity: 0.92, group: "vessel", name: "颈总动脉" });
      /* 颈内静脉 */
      lines.push({ pts: mul(sgn, [[0.034, 1.320, -0.002], [0.046, 1.420, -0.006], [0.050, 1.520, -0.004], [0.046, 1.600, 0.000]]), color: VEN2, width: 1.9, opacity: 0.88, group: "vessel", name: "颈内静脉" });
      /* 上肢：锁骨下动脉 → 肱动脉 → 桡/尺动脉 */
      lines.push({ pts: mul(sgn, [[0.014, 1.372, 0.006], [0.066, 1.386, 0.016], [0.120, 1.372, 0.020], [0.164, 1.336, 0.020], [0.188, 1.290, 0.018], [0.196, 1.220, 0.016], [0.202, 1.140, 0.014], [0.207, 1.060, 0.014], [0.212, 0.975, 0.016], [0.218, 0.895, 0.018], [0.226, 0.856, 0.019], [0.230, 0.812, 0.020], [0.233, 0.770, 0.021], [0.235, 0.735, 0.022]]), color: ART, width: 1.8, opacity: 0.92, group: "vessel", name: "上肢动脉" });
      /* 上肢静脉（浅静脉） */
      lines.push({ pts: mul(sgn, [[0.030, 1.362, -0.008], [0.086, 1.372, 0.000], [0.136, 1.360, 0.006], [0.170, 1.326, 0.006], [0.182, 1.270, 0.002], [0.190, 1.200, 0.000], [0.196, 1.120, -0.002], [0.202, 1.030, 0.000], [0.208, 0.940, 0.004], [0.214, 0.878, 0.008], [0.222, 0.838, 0.010]]), color: VEN2, width: 1.9, opacity: 0.88, group: "vessel", name: "上肢静脉" });
      /* 下肢：髂外动脉 → 股动脉 → 腘动脉 → 胫后动脉 */
      lines.push({ pts: mul(sgn, [[0.026, 0.985, -0.026], [0.066, 0.930, -0.024], [0.086, 0.870, -0.018], [0.092, 0.780, -0.008], [0.095, 0.690, -0.002], [0.096, 0.600, 0.000], [0.096, 0.520, 0.000], [0.096, 0.450, -0.008], [0.094, 0.380, -0.016], [0.092, 0.300, -0.020], [0.090, 0.220, -0.016], [0.088, 0.140, -0.010], [0.087, 0.090, -0.006], [0.088, 0.060, 0.010], [0.090, 0.045, 0.050], [0.092, 0.040, 0.090]]), color: ART, width: 1.8, opacity: 0.92, group: "vessel", name: "下肢动脉" });
      /* 下肢静脉 */
      lines.push({ pts: mul(sgn, [[0.012, 0.985, -0.040], [0.048, 0.928, -0.038], [0.070, 0.868, -0.034], [0.076, 0.778, -0.026], [0.079, 0.688, -0.020], [0.080, 0.598, -0.018], [0.080, 0.518, -0.018], [0.080, 0.448, -0.026], [0.078, 0.378, -0.034], [0.076, 0.298, -0.040], [0.074, 0.218, -0.038], [0.072, 0.140, -0.032], [0.071, 0.095, -0.026]]), color: VEN, width: 1.9, opacity: 0.88, group: "vessel", name: "下肢静脉" });
    }
    /* 上腔静脉 / 下腔静脉 */
    meshes.push({ geo: tubeSmooth([[0.018, 1.356, 0.006], [0.015, 1.318, -0.014], [0.011, 1.272, -0.026]], [[0.009, 0.009], [0.009, 0.009], [0.009, 0.009]], 8, vR), color: VEN2, name: "上腔静脉", kind: "vessel", ambient: 0.42, spec: 0.24, specPow: 18 });
    meshes.push({ geo: tubeSmooth([[0.014, 1.160, -0.050], [0.011, 1.070, -0.054], [0.009, 0.972, -0.054], [0.008, 0.925, -0.052]], [[0.0095, 0.0095], [0.0095, 0.0095], [0.0095, 0.0095], [0.0095, 0.0095]], 10, vR), color: VEN2, name: "下腔静脉", kind: "vessel", ambient: 0.42, spec: 0.24, specPow: 18 });
    return { meshes: meshes, lines: lines };
  }

  /* ==================================================================
     解剖层 3：筋腱肌肉层
     胸大肌 / 三角肌 / 肱二头肌 / 肱三头肌 / 前臂肌群 / 斜方肌 / 背阔肌
     / 腹直肌 / 腹外斜肌 / 臀大肌 / 股四头肌 / 腘绳肌 / 腓肠肌 / 胫骨前肌
     / 胸锁乳突肌 / 跟腱 / 髌韧带
     ================================================================== */
  function buildMuscles(kind, quality) {
    const F = FIG[kind] || FIG.male;
    const R = resTable(quality);
    const meshes = [];
    const q = quality == null ? 1 : quality;
    const mR = R.muscleR;
    const isF = kind === "female";
    const sc = isF ? 0.93 : 1;   // 女性体表更窄，肌肉整体略收
    const SEC = R.muscleS;

    function M(names, geo, color) {
      meshes.push({ geo: geo, color: color, name: names, kind: "muscle", ambient: 0.34, spec: 0.26, specPow: 20 });
    }
    function SC(list) { return list.map(p => [p[0] * sc, p[1], p[2] * sc]); }

    for (const sgn of [1, -1]) {
      const sx = p => [p[0] * sgn * sc, p[1], p[2] * sc];
      /* 胸大肌 */
      M("胸大肌", fusiform(SC(sgn > 0 ? [[0.010, 1.362, 0.070], [0.048, 1.352, 0.084], [0.088, 1.336, 0.084], [0.126, 1.318, 0.068], [0.154, 1.306, 0.046]] : [[-0.010, 1.362, 0.070], [-0.048, 1.352, 0.084], [-0.088, 1.336, 0.084], [-0.126, 1.318, 0.068], [-0.154, 1.306, 0.046]]), [0.019, 0.026], [0.005, 0.007], SEC, mR), "#ab5145");
      /* 三角肌 */
      M("三角肌", makeSphere(sgn * 0.164 * sc, 1.396, 0.000, 0.042 * sc, 0.062, 0.046 * sc, R.jointLon, R.jointLat), "#b25a45");
      /* 肱二头肌 */
      M("肱二头肌", fusiform(SC(sgn > 0 ? [[0.186, 1.372, 0.016], [0.193, 1.330, 0.028], [0.198, 1.280, 0.032], [0.202, 1.232, 0.028], [0.205, 1.196, 0.018]] : [[-0.186, 1.372, 0.016], [-0.193, 1.330, 0.028], [-0.198, 1.280, 0.032], [-0.202, 1.232, 0.028], [-0.205, 1.196, 0.018]]), [0.019, 0.025], [0.006, 0.008], SEC, mR), "#b05648");
      /* 肱三头肌 */
      M("肱三头肌", fusiform(SC(sgn > 0 ? [[0.182, 1.380, -0.026], [0.189, 1.332, -0.032], [0.194, 1.276, -0.030], [0.198, 1.224, -0.024], [0.201, 1.190, -0.016]] : [[-0.182, 1.380, -0.026], [-0.189, 1.332, -0.032], [-0.194, 1.276, -0.030], [-0.198, 1.224, -0.024], [-0.201, 1.190, -0.016]]), [0.021, 0.026], [0.006, 0.008], SEC, mR), "#a44e42");
      /* 前臂肌群 */
      M("前臂肌群", fusiform(SC(sgn > 0 ? [[0.204, 1.152, 0.004], [0.208, 1.092, 0.010], [0.212, 1.022, 0.014], [0.217, 0.952, 0.016], [0.223, 0.892, 0.018], [0.227, 0.858, 0.019]] : [[-0.204, 1.152, 0.004], [-0.208, 1.092, 0.010], [-0.212, 1.022, 0.014], [-0.217, 0.952, 0.016], [-0.223, 0.892, 0.018], [-0.227, 0.858, 0.019]]), [0.019, 0.023], [0.009, 0.011], SEC, mR), "#a9524a");
      /* 斜方肌 */
      M("斜方肌", fusiform(SC(sgn > 0 ? [[0.012, 1.494, -0.016], [0.052, 1.470, -0.006], [0.096, 1.444, 0.004], [0.132, 1.420, 0.006]] : [[-0.012, 1.494, -0.016], [-0.052, 1.470, -0.006], [-0.096, 1.444, 0.004], [-0.132, 1.420, 0.006]]), [0.015, 0.019], [0.006, 0.008], SEC, mR), "#9d4b40");
      /* 背阔肌 */
      M("背阔肌", fusiform(SC(sgn > 0 ? [[0.018, 1.286, -0.062], [0.068, 1.244, -0.058], [0.114, 1.204, -0.040], [0.146, 1.182, -0.010]] : [[-0.018, 1.286, -0.062], [-0.068, 1.244, -0.058], [-0.114, 1.204, -0.040], [-0.146, 1.182, -0.010]]), [0.013, 0.028], [0.005, 0.010], SEC, mR), "#a04d42");
      /* 腹直肌 */
      M("腹直肌", fusiform(SC(sgn > 0 ? [[0.028, 1.300, 0.078], [0.026, 1.220, 0.088], [0.024, 1.130, 0.092], [0.023, 1.050, 0.088], [0.023, 0.978, 0.076]] : [[-0.028, 1.300, 0.078], [-0.026, 1.220, 0.088], [-0.024, 1.130, 0.092], [-0.023, 1.050, 0.088], [-0.023, 0.978, 0.076]]), [0.013, 0.030], [0.009, 0.024], SEC, mR), "#b8615a");
      /* 腹外斜肌 */
      M("腹外斜肌", fusiform(SC(sgn > 0 ? [[0.136, 1.240, 0.020], [0.128, 1.160, 0.038], [0.114, 1.080, 0.048], [0.096, 1.012, 0.048]] : [[-0.136, 1.240, 0.020], [-0.128, 1.160, 0.038], [-0.114, 1.080, 0.048], [-0.096, 1.012, 0.048]]), [0.011, 0.026], [0.005, 0.010], SEC, mR), "#ad574d");
      /* 臀大肌 */
      M("臀大肌", makeSphere(sgn * 0.070 * sc, 0.898, -0.056 * sc, 0.054 * sc, 0.062, 0.050 * sc, R.jointLon, R.jointLat), "#a84f43");
      /* 股四头肌 */
      M("股四头肌", fusiform(SC(sgn > 0 ? [[0.090, 0.870, 0.024], [0.094, 0.780, 0.032], [0.096, 0.680, 0.032], [0.096, 0.582, 0.026], [0.095, 0.502, 0.014]] : [[-0.090, 0.870, 0.024], [-0.094, 0.780, 0.032], [-0.096, 0.680, 0.032], [-0.096, 0.582, 0.026], [-0.095, 0.502, 0.014]]), [0.028, 0.032], [0.012, 0.014], SEC, mR), "#b25a4b");
      /* 腘绳肌 */
      M("腘绳肌", fusiform(SC(sgn > 0 ? [[0.092, 0.860, -0.026], [0.095, 0.780, -0.032], [0.096, 0.690, -0.030], [0.096, 0.600, -0.024], [0.095, 0.522, -0.014]] : [[-0.092, 0.860, -0.026], [-0.095, 0.780, -0.032], [-0.096, 0.690, -0.030], [-0.096, 0.600, -0.024], [-0.095, 0.522, -0.014]]), [0.024, 0.028], [0.010, 0.012], SEC, mR), "#a24d41");
      /* 腓肠肌 */
      M("腓肠肌", fusiform(SC(sgn > 0 ? [[0.094, 0.424, -0.034], [0.093, 0.362, -0.046], [0.091, 0.300, -0.048], [0.089, 0.240, -0.042], [0.088, 0.182, -0.030]] : [[-0.094, 0.424, -0.034], [-0.093, 0.362, -0.046], [-0.091, 0.300, -0.048], [-0.089, 0.240, -0.042], [-0.088, 0.182, -0.030]]), [0.024, 0.028], [0.009, 0.011], SEC, mR), "#ad5747");
      /* 胫骨前肌 */
      M("胫骨前肌", fusiform(SC(sgn > 0 ? [[0.088, 0.404, 0.020], [0.089, 0.332, 0.024], [0.089, 0.262, 0.020], [0.088, 0.192, 0.012]] : [[-0.088, 0.404, 0.020], [-0.089, 0.332, 0.024], [-0.089, 0.262, 0.020], [-0.088, 0.192, 0.012]]), [0.013, 0.015], [0.006, 0.007], SEC, mR), "#a5504a");
      /* 胸锁乳突肌 */
      M("胸锁乳突肌", fusiform(SC(sgn > 0 ? [[0.014, 1.520, 0.028], [0.028, 1.480, 0.034], [0.038, 1.442, 0.030]] : [[-0.014, 1.520, 0.028], [-0.028, 1.480, 0.034], [-0.038, 1.442, 0.030]]), [0.010, 0.012], [0.005, 0.006], SEC, mR), "#b8615a");
      /* 跟腱 */
      M("跟腱", fusiform(SC(sgn > 0 ? [[0.090, 0.302, -0.050], [0.088, 0.222, -0.046], [0.087, 0.142, -0.038], [0.086, 0.100, -0.028]] : [[-0.090, 0.302, -0.050], [-0.088, 0.222, -0.046], [-0.087, 0.142, -0.038], [-0.086, 0.100, -0.028]]), [0.010, 0.010], [0.008, 0.008], SEC, Math.max(6, mR - 3)), "#ddc9ae");
      /* 髌韧带 */
      M("髌韧带", fusiform(SC(sgn > 0 ? [[0.095, 0.502, 0.026], [0.095, 0.472, 0.030], [0.095, 0.442, 0.029]] : [[-0.095, 0.502, 0.026], [-0.095, 0.472, 0.030], [-0.095, 0.442, 0.029]]), [0.013, 0.013], [0.010, 0.010], SEC, Math.max(6, mR - 3)), "#ddc9ae");
    }
    return { meshes: meshes, lines: [] };
  }

  /* 沿 x 轴镜像一组点（sgn = 1 原样 / -1 取反） */
  function mul(sgn, pts) {
    if (sgn === 1) return pts.map(p => p.slice());
    return pts.map(p => [-p[0], p[1], p[2]]);
  }

  /* ------------------------------------------------------------------
     经络路径补充控制点（让线条沿真实循行路线走行）
     ------------------------------------------------------------------ */
  const VIA = {
    ST: { ST8: [[0.076, 1.640, -0.005], [0.078, 1.560, -0.045], [0.076, 1.480, -0.050], [0.070, 1.430, -0.010], [0.064, 1.330, 0.050], [0.059, 1.200, 0.082], [0.057, 1.100, 0.094]] },
    BL: {
      BL2: [[0.030, 1.735, 0.045], [0.032, 1.756, -0.005], [0.033, 1.720, -0.045], [0.034, 1.650, -0.068], [0.035, 1.570, -0.075]],
      BL25: [[0.052, 0.960, -0.095], [0.072, 0.840, -0.082], [0.086, 0.690, -0.075], [0.092, 0.560, -0.068], [0.094, 0.480, -0.063]]
    },
    GB: {
      GB2: [[0.088, 1.720, 0.010], [0.070, 1.752, 0.030], [0.050, 1.750, 0.060], [0.040, 1.730, 0.080]],
      GB14: [[0.050, 1.740, 0.045], [0.058, 1.752, 0.000], [0.052, 1.700, -0.048], [0.044, 1.620, -0.068]],
      GB21: [[0.132, 1.330, 0.010], [0.126, 1.250, 0.060], [0.112, 1.212, 0.085]],
      GB26: [[0.140, 0.995, -0.030], [0.146, 0.938, -0.052]],
      GB40: [[0.128, 0.062, 0.048], [0.124, 0.048, 0.075]]
    },
    KI: { KI10: [[0.076, 0.640, -0.052], [0.062, 0.800, -0.052], [0.044, 0.930, 0.020], [0.030, 0.985, 0.090]] },
    SP: { SP15: [[0.080, 1.135, 0.096], [0.092, 1.220, 0.070], [0.120, 1.300, 0.035], [0.148, 1.320, 0.005]] },
    LR: {
      LR3: [[0.064, 0.120, 0.040], [0.066, 0.215, 0.024]],
      LR8: [[0.076, 0.600, 0.020], [0.084, 0.760, 0.040], [0.098, 0.930, 0.048], [0.114, 1.040, 0.050]]
    },
    TE: { TE17: [[0.086, 1.700, 0.006], [0.076, 1.712, 0.034], [0.062, 1.702, 0.066]] },
    SI: {
      SI8: [[0.186, 1.260, -0.062], [0.170, 1.320, -0.088], [0.140, 1.330, -0.102]],
      SI11: [[0.112, 1.380, -0.096], [0.082, 1.452, -0.068], [0.076, 1.520, -0.030], [0.080, 1.580, 0.008]]
    },
    LI: {
      LI15: [[0.136, 1.425, 0.020], [0.086, 1.452, 0.040], [0.052, 1.470, 0.050]],
      LI18: [[0.032, 1.545, 0.078], [0.026, 1.585, 0.090]]
    }
  };

  /* 构建某条经络的折线（side: 1 左侧 / -1 右侧） */
  function meridianPath(mer, side) {
    const pts = [];
    const via = VIA[mer.id] || {};
    for (let i = 0; i < mer.points.length; i++) {
      const p = mer.points[i];
      if (side < 0 && mer.id === "GV") continue;
      if (side < 0 && mer.id === "CV") continue;
      pts.push([p.x * side, p.y, p.z]);
      const extra = via[p.c];
      if (extra) for (const e of extra) pts.push([e[0] * side, e[1], e[2]]);
    }
    return pts;
  }

  window.Body = {
    build: build,
    buildNerves: buildNerves,
    buildVessels: buildVessels,
    buildMuscles: buildMuscles,
    makeTube: makeTube,
    makeSphere: makeSphere,
    mirror: mirror,
    merge: merge,
    meridianPath: meridianPath,
    FIG: FIG
  };
})();
