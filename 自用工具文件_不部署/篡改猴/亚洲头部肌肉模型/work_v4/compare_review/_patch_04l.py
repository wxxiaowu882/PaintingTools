from pathlib import Path

p = Path("bone_morph.js")
s = p.read_text(encoding="utf-8")
s = s.replace("geom-island-texture-synth-20260904k", "geom-island-texture-synth-20260904l")

# Replace buildFlatMuscleWrinkleAlbedoFromNormal entire function - read current via markers
start = s.index("  function buildFlatMuscleWrinkleAlbedoFromNormal(")
end = s.index("  /** 平涂肌：quilt 后的法线印同色条纹", start)
if end < 0:
    end = s.index("  /** 平涂肌：用 quilt 后的法线", start)

new_albedo_fn = r'''  function buildFlatMuscleWrinkleAlbedoFromNormal(atlas, normal, bbox, maskLocal, seedRgb, seed, similarity = 0.7, blockScale = 24) {
    const flat = extractExampleCrop(atlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const out = new Uint8ClampedArray(flat);
    const br = seedRgb?.[0] ?? 128;
    const bg = seedRgb?.[1] ?? 128;
    const bb = seedRgb?.[2] ?? 128;
    const seedU = seed >>> 0;
    const sim = Math.max(0.4, Math.min(1, similarity));
    const blk = Math.max(8, Math.min(48, blockScale));
    const blockSize = Math.max(4, Math.round(blk * 0.92));
    const stripePitch = Math.max(3, blk * 0.48);
    const chaos = (1.22 - sim) * 4.2 + 0.08;

    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const di = i * 4;
      const nx = normal[di] / 255 - 0.5;
      const ny = normal[di + 1] / 255 - 0.5;
      const len = Math.hypot(nx, ny) + 1e-5;
      let fx = nx / len;
      let fy = ny / len;
      const bx = (col / blockSize) | 0;
      const by = (row / blockSize) | 0;
      const bh = (Math.imul(bx + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by + seedU, 0xc2b2ae35)) >>> 0;
      const blockRot = (((bh % 360) / 360) - 0.5) * Math.PI * chaos;
      const cosR = Math.cos(blockRot);
      const sinR = Math.sin(blockRot);
      const rfx = fx * cosR - fy * sinR;
      const rfy = fx * sinR + fy * cosR;
      fx = rfx;
      fy = rfy;
      const along = col * fx + row * fy;
      const across = -col * fy + row * fx;
      const phase = (bh % 628) / 100 + seedU * 0.0009;
      const stripe = Math.sin((along / stripePitch) * Math.PI * 2 + phase);
      const lx = col - bx * blockSize;
      const ly = row - by * blockSize;
      const edge = Math.min(lx, ly, blockSize - lx, blockSize - ly) / blockSize;
      const dark = 0.22 + (1 - sim) * 0.06;
      const bright = 1.22 + sim * 0.08;
      let shade = stripe > 0 ? bright : dark;
      if (edge < 0.1 && chaos > 1.4) shade *= 0.55;
      out[di] = Math.min(255, Math.round(br * shade));
      out[di + 1] = Math.min(255, Math.round(bg * shade));
      out[di + 2] = Math.min(255, Math.round(bb * shade));
      out[di + 3] = 255;
    }
    return out;
  }

'''

s = s[:start] + new_albedo_fn + s[end:]

start2 = s.index("  function buildFlatMuscleWrinkleNormal(")
end2 = s.index("  /** 平涂肌：seed 条纹 + 沿纤维平移", start2)
if end2 < 0:
    end2 = s.index("  /** 平涂肌：seed 条纹", start2)

new_normal_fn = r'''  function buildFlatMuscleWrinkleNormal(normalAtlas, bbox, maskLocal, seed, similarity = 0.7, blockScale = 24) {
    const base = extractExampleCrop(normalAtlas, bbox);
    const w = bbox.w;
    const h = bbox.h;
    const out = new Uint8ClampedArray(base);
    const seedU = seed >>> 0;
    const sim = Math.max(0.4, Math.min(1, similarity));
    const blk = Math.max(8, Math.min(48, blockScale));
    const blockSize = Math.max(4, Math.round(blk * 0.92));
    const chaos = (1.22 - sim) * 4.2 + 0.08;
    const freqAlong = (Math.PI * 2) / Math.max(3, blk * 0.42);
    const freqAcross = (Math.PI * 2) / Math.max(5, blk * 0.68);
    const bumpAmp = 0.95 + chaos * 0.72;

    for (let i = 0; i < w * h; i++) {
      if (!maskLocal[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const di = i * 4;
      let nx = (base[di] / 255) * 2 - 1;
      let ny = (base[di + 1] / 255) * 2 - 1;
      let nz = (base[di + 2] / 255) * 2 - 1;
      const glen = Math.hypot(nx, ny) + 1e-5;
      let fx = nx / glen;
      let fy = ny / glen;
      const bx = (col / blockSize) | 0;
      const by = (row / blockSize) | 0;
      const bh = (Math.imul(bx + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by + seedU, 0xc2b2ae35)) >>> 0;
      const blockRot = (((bh % 360) / 360) - 0.5) * Math.PI * chaos;
      const cosR = Math.cos(blockRot);
      const sinR = Math.sin(blockRot);
      const rfx = fx * cosR - fy * sinR;
      const rfy = fx * sinR + fy * cosR;
      fx = rfx;
      fy = rfy;
      const along = col * fx + row * fy;
      const across = -col * fy + row * fx;
      const phase1 = (bh % 628) / 100 + seedU * 0.0009;
      const phase2 = ((bh >>> 8) % 360) / 57;
      const bump =
        bumpAmp * Math.sin(along * freqAlong + phase1) +
        0.42 * Math.sin(along * freqAlong * 2.05 + phase2) +
        0.28 * Math.sin(across * freqAcross + phase1 * 0.6);
      nx += bump * -fy * 1.55;
      ny += bump * fx * 1.55;
      const nlen = Math.hypot(nx, ny, nz) + 1e-5;
      nx /= nlen;
      ny /= nlen;
      nz /= nlen;
      out[di] = Math.min(255, Math.max(0, Math.round((nx * 0.5 + 0.5) * 255)));
      out[di + 1] = Math.min(255, Math.max(0, Math.round((ny * 0.5 + 0.5) * 255)));
      out[di + 2] = Math.min(255, Math.max(0, Math.round((nz * 0.5 + 0.5) * 255)));
      out[di + 3] = 255;
    }
    return out;
  }

'''

s = s[:start2] + new_normal_fn + s[end2:]

old_synth = '''    const mixSeed = (seedU ^ Math.imul(Math.round(sim * 1000), 0x9e3779b1) ^ Math.imul(blk | 0, 0x85ebca6b)) >>> 0;
    const normal = buildFlatMuscleWrinkleNormal(normalAtlas, bbox, maskLocal, mixSeed, sim, blk);
    const albedo = buildFlatMuscleWrinkleAlbedoFromNormal(
      atlas,
      normal,
      bbox,
      maskLocal,
      seedRgb,
      mixSeed,
      sim,
      blk
    );'''

new_synth = '''    const mixSeed = seedU;
    const normal = buildFlatMuscleWrinkleNormal(normalAtlas, bbox, maskLocal, mixSeed, sim, blk);
    const albedo = buildFlatMuscleWrinkleAlbedoFromNormal(
      atlas,
      normal,
      bbox,
      maskLocal,
      seedRgb,
      mixSeed,
      sim,
      blk
    );'''

if old_synth not in s:
    raise SystemExit("synth mixSeed block not found")
s = s.replace(old_synth, new_synth, 1)

p.write_text(s, encoding="utf-8")
print("ok 04l")
