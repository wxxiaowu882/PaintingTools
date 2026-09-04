#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键跑 P0：先 Node 提取指纹，再 Python 聚类。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    extract = ROOT / "cluster-identity-similarity-extract.mjs"
    cluster = ROOT / "cluster-identity-similarity-cluster.py"
    print("=== P0 extract ===")
    r1 = subprocess.run(["node", str(extract)], cwd=str(ROOT.parent))
    if r1.returncode != 0:
        sys.exit(r1.returncode)
    print("=== P0 cluster ===")
    r2 = subprocess.run([sys.executable, str(cluster)], cwd=str(ROOT.parent))
    sys.exit(r2.returncode)


if __name__ == "__main__":
    main()
