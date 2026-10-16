#!/usr/bin/env python3
"""Bump the version number on every script and the stylesheet in index.html and play.html.

Run after changing any code or CSS:   python3 tools/bump.py
Browsers then fetch every file fresh instead of mixing cached old scripts with new ones.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
pages = [os.path.join(ROOT, p) for p in ("index.html", "play.html")]
current = max(int(v) for p in pages for v in re.findall(r"\?v=(\d+)", open(p, encoding="utf-8").read()))
new = current + 1
for p in pages:
    s = open(p, encoding="utf-8").read()
    open(p, "w", encoding="utf-8").write(re.sub(r"\?v=\d+", f"?v={new}", s))
print(f"Version {current} -> {new}")
