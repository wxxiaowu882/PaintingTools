#!/usr/bin/env python3
"""Convert official GNM identity_decoder_model.h5 → browser bin + meta.

Requires: pip install numpy h5py

Usage (from GNM头模工坊):
  python scripts/convert-identity-decoder.py
  python scripts/convert-identity-decoder.py path/to/identity_decoder_model.h5
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "gnm"
DEFAULT_H5 = OUT_DIR / "identity_decoder_model.h5"
META_PATH = OUT_DIR / "semantic_identity_meta.json"
BIN_PATH = OUT_DIR / "semantic_identity_weights.bin"

LATENT_DIM = 64
CONDITION_DIM = 6  # gender(2) + ethnicity(4)
IDENTITY_DIM = 253


def read_dense_layers(h5_path: Path) -> list[tuple[np.ndarray, np.ndarray]]:
    layers: list[tuple[np.ndarray, np.ndarray]] = []
    with h5py.File(h5_path, "r") as model:
        weights = model["model_weights"]
        dense_names = [
            name
            for name in weights.keys()
            if "dense" in name and isinstance(weights[name], h5py.Group)
        ]
        dense_names.sort(key=lambda name: int(name.rsplit("_", 1)[1]))
        for name in dense_names:
            layer = weights[name][name]
            kernel = np.asarray(layer["kernel:0"], dtype=np.float32)
            bias = np.asarray(layer["bias:0"], dtype=np.float32)
            layers.append((kernel, bias))
    if not layers:
        raise RuntimeError(f"No dense layers in {h5_path}")
    return layers


def write_assets(layers: list[tuple[np.ndarray, np.ndarray]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta_layers = []
    blobs: list[bytes] = []
    for kernel, bias in layers:
        if kernel.ndim != 2 or bias.ndim != 1:
            raise RuntimeError(f"Unexpected shapes {kernel.shape} {bias.shape}")
        if kernel.shape[1] != bias.shape[0]:
            raise RuntimeError(f"kernel/bias mismatch {kernel.shape} {bias.shape}")
        meta_layers.append(
            {
                "kernelShape": [int(kernel.shape[0]), int(kernel.shape[1])],
                "biasShape": [int(bias.shape[0])],
            }
        )
        blobs.append(kernel.tobytes(order="C"))
        blobs.append(bias.tobytes(order="C"))

    in_dim = meta_layers[0]["kernelShape"][0]
    out_dim = meta_layers[-1]["kernelShape"][1]
    if in_dim != LATENT_DIM + CONDITION_DIM:
        print(
            f"warn: input dim {in_dim} != expected {LATENT_DIM + CONDITION_DIM}",
            file=sys.stderr,
        )
    if out_dim != IDENTITY_DIM:
        print(f"warn: output dim {out_dim} != expected {IDENTITY_DIM}", file=sys.stderr)

    meta = {
        "kind": "gnmWorkshopSemanticIdentityWeights",
        "version": 1,
        "source": "google/GNM identity_decoder_model.h5",
        "latentDim": LATENT_DIM,
        "conditionDim": CONDITION_DIM,
        "identityDim": int(out_dim),
        "layerCount": len(meta_layers),
        "layers": meta_layers,
    }
    META_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    BIN_PATH.write_bytes(b"".join(blobs))
    print(f"wrote {META_PATH}")
    print(f"wrote {BIN_PATH} ({BIN_PATH.stat().st_size} bytes, {len(meta_layers)} layers)")


def main() -> int:
    h5_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_H5
    if not h5_path.is_file():
        print(f"missing h5: {h5_path}", file=sys.stderr)
        return 1
    layers = read_dense_layers(h5_path)
    write_assets(layers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
