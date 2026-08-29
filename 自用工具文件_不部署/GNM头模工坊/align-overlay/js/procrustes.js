/**
 * Umeyama similarity transform: maps source points → target points.
 * X, Y: Array of [x,y,z] length N (>=3). Returns { scale, R[3][3], t[3], rms, maxErr, errors[] }.
 */

function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function mulS(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function matMulVec(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

function matMul(A, B) {
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return C;
}

function transpose(A) {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ];
}

function det3(A) {
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  );
}

/** Jacobi SVD for 3x3 (enough for covariance). Returns { U, S, V } with A ≈ U * diag(S) * V^T */
function svd3(A) {
  // Use eigen-decomposition of A^T A via power/Jacobi-lite: closed form via Numerical Recipes style
  // For robustness use known 3x3 SVD via AtA eigenvectors.
  const At = transpose(A);
  const AtA = matMul(At, A);

  // Jacobi eigen for symmetric 3x3
  let V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let B = [
    [AtA[0][0], AtA[0][1], AtA[0][2]],
    [AtA[1][0], AtA[1][1], AtA[1][2]],
    [AtA[2][0], AtA[2][1], AtA[2][2]],
  ];

  for (let iter = 0; iter < 32; iter++) {
    let p = 0,
      q = 1;
    let max = Math.abs(B[0][1]);
    const cands = [
      [0, 2, Math.abs(B[0][2])],
      [1, 2, Math.abs(B[1][2])],
    ];
    for (const [i, j, v] of cands) {
      if (v > max) {
        max = v;
        p = i;
        q = j;
      }
    }
    if (max < 1e-12) break;
    const app = B[p][p];
    const aqq = B[q][q];
    const apq = B[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const R = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    R[p][p] = c;
    R[q][q] = c;
    R[p][q] = s;
    R[q][p] = -s;
    B = matMul(matMul(transpose(R), B), R);
    V = matMul(V, R);
  }

  const evals = [B[0][0], B[1][1], B[2][2]];
  const order = [0, 1, 2].sort((i, j) => evals[j] - evals[i]);
  const S = order.map((i) => Math.sqrt(Math.max(0, evals[i])));
  const Vsorted = [
    [V[0][order[0]], V[0][order[1]], V[0][order[2]]],
    [V[1][order[0]], V[1][order[1]], V[1][order[2]]],
    [V[2][order[0]], V[2][order[1]], V[2][order[2]]],
  ];

  // U = A V S^+
  const AV = matMul(A, Vsorted);
  const U = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let j = 0; j < 3; j++) {
    const col = [AV[0][j], AV[1][j], AV[2][j]];
    const inv = S[j] > 1e-12 ? 1 / S[j] : 0;
    const u = mulS(col, inv);
    const nu = norm(u);
    const uu = nu > 1e-12 ? mulS(u, 1 / nu) : j === 0 ? [1, 0, 0] : j === 1 ? [0, 1, 0] : [0, 0, 1];
    U[0][j] = uu[0];
    U[1][j] = uu[1];
    U[2][j] = uu[2];
  }
  // Orthonormalize U columns if needed
  const u0 = [U[0][0], U[1][0], U[2][0]];
  let u1 = [U[0][1], U[1][1], U[2][1]];
  u1 = sub(u1, mulS(u0, dot(u0, u1)));
  const n1 = norm(u1);
  u1 = n1 > 1e-12 ? mulS(u1, 1 / n1) : cross(u0, [0, 0, 1]);
  let u2 = cross(u0, u1);
  const n2 = norm(u2);
  u2 = n2 > 1e-12 ? mulS(u2, 1 / n2) : [0, 0, 1];
  return {
    U: [
      [u0[0], u1[0], u2[0]],
      [u0[1], u1[1], u2[1]],
      [u0[2], u1[2], u2[2]],
    ],
    S,
    V: Vsorted,
  };
}

/**
 * @param {number[][]} src  euro points
 * @param {number[][]} dst  gnm points
 * @param {number[]} [weights] optional per-point weights
 */
export function umeyama(src, dst, weights) {
  if (src.length !== dst.length || src.length < 3) {
    throw new Error(`Umeyama 需要至少 3 对点，当前 ${src.length}`);
  }
  const n = src.length;
  const w = weights && weights.length === n ? weights.slice() : Array(n).fill(1);
  let wSum = 0;
  for (const wi of w) wSum += wi;
  if (wSum <= 0) throw new Error('权重和为 0');

  const muX = [0, 0, 0];
  const muY = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    muX[0] += w[i] * src[i][0];
    muX[1] += w[i] * src[i][1];
    muX[2] += w[i] * src[i][2];
    muY[0] += w[i] * dst[i][0];
    muY[1] += w[i] * dst[i][1];
    muY[2] += w[i] * dst[i][2];
  }
  muX[0] /= wSum;
  muX[1] /= wSum;
  muX[2] /= wSum;
  muY[0] /= wSum;
  muY[1] /= wSum;
  muY[2] /= wSum;

  let sigmaX = 0;
  const Cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    const dx = sub(src[i], muX);
    const dy = sub(dst[i], muY);
    sigmaX += w[i] * dot(dx, dx);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        Cov[r][c] += (w[i] / wSum) * dy[r] * dx[c];
      }
    }
  }
  sigmaX /= wSum;

  const { U, S, V } = svd3(Cov);
  let R = matMul(U, transpose(V));
  if (det3(R) < 0) {
    const Sfix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ];
    R = matMul(matMul(U, Sfix), transpose(V));
  }

  const traceDS = S[0] + S[1] + S[2];
  // reflection correction on singular values for scale
  let dAdj = 1;
  if (det3(Cov) < 0 || det3(R) < 0) {
    // already handled R; scale uses sum of singular values with last flipped if needed
  }
  const scale = sigmaX > 1e-18 ? traceDS / sigmaX : 1;
  const t = sub(muY, mulS(matMulVec(R, muX), scale));

  const errors = [];
  let sumSq = 0;
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    const mapped = add(mulS(matMulVec(R, src[i]), scale), t);
    const e = norm(sub(mapped, dst[i]));
    errors.push(e);
    sumSq += e * e;
    maxErr = Math.max(maxErr, e);
  }
  const rms = Math.sqrt(sumSq / n);

  return { scale, R, t, rms, maxErr, errors, dAdj };
}

/** Apply similarity to a point */
export function applySimilarity(p, { scale, R, t }) {
  return add(mulS(matMulVec(R, p), scale), t);
}

/** Build column-major 4x4 for THREE.Matrix4 (row-major set is fine via elements) */
export function similarityToMatrix4({ scale, R, t }) {
  // M = [ sR | t ; 0 0 0 1 ]
  return [
    scale * R[0][0],
    scale * R[1][0],
    scale * R[2][0],
    0,
    scale * R[0][1],
    scale * R[1][1],
    scale * R[2][1],
    0,
    scale * R[0][2],
    scale * R[1][2],
    scale * R[2][2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

/**
 * Normalize transform matching workshop bottom-center 30cm:
 * p' = s * p - (cx, minY*s, cz)
 */
export function computeBottomCenterNormalize(positions, targetHeightM = 0.3) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const h = maxY - minY;
  const scale = h > 0 ? targetHeightM / h : 1;
  const cx = ((minX + maxX) / 2) * scale;
  const minYs = minY * scale;
  const cz = ((minZ + maxZ) / 2) * scale;
  return { scale, offset: [cx, minYs, cz], heightCm: targetHeightM * 100 };
}

export function applyNormalizePoint(p, norm) {
  return [p[0] * norm.scale - norm.offset[0], p[1] * norm.scale - norm.offset[1], p[2] * norm.scale - norm.offset[2]];
}

/** Inverse of applyNormalizePoint: display → native */
export function inverseNormalizePoint(p, norm) {
  return [
    (p[0] + norm.offset[0]) / norm.scale,
    (p[1] + norm.offset[1]) / norm.scale,
    (p[2] + norm.offset[2]) / norm.scale,
  ];
}

export function applyNormalizePositions(positions, norm) {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i] * norm.scale - norm.offset[0];
    positions[i + 1] = positions[i + 1] * norm.scale - norm.offset[1];
    positions[i + 2] = positions[i + 2] * norm.scale - norm.offset[2];
  }
}

/** Column-major Matrix4: first Umeyama then normalize (p_disp = s_n * (s R p + t) - offset) */
export function composeNormalizeAfterSimilarity(sim, norm) {
  const s = sim.scale * norm.scale;
  const R = sim.R;
  const t = sim.t;
  // p' = sn * (s R p + t) - o = (sn*s) R p + sn*t - o
  const tn = [
    norm.scale * t[0] - norm.offset[0],
    norm.scale * t[1] - norm.offset[1],
    norm.scale * t[2] - norm.offset[2],
  ];
  return [
    s * R[0][0],
    s * R[1][0],
    s * R[2][0],
    0,
    s * R[0][1],
    s * R[1][1],
    s * R[2][1],
    0,
    s * R[0][2],
    s * R[1][2],
    s * R[2][2],
    0,
    tn[0],
    tn[1],
    tn[2],
    1,
  ];
}
