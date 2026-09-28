#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
不依赖音频，单测「抽取机器」在某一期上能不能跑通。

正式流程是用音频标题去匹配目录条目（mp3 名和纸面标题常常对不上，那一层
是另一回事）。手上没有某一期的音频时，用目录条目自己的标题当钥匙，
就能单独验证：起点定位、终点配对、逐行定归属、正文拼接。

用法:
    py tools/try-extract.py <pdf> <版式档案>
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "ext", os.path.join(HERE, "extract-articles.py"))
ext = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ext)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    pdf, profile = sys.argv[1], sys.argv[2]
    p = ext.use_profile(profile)

    doc = ext.fitz.open(pdf)
    toc, toc_pages = ext.parse_toc(doc)
    titles, decks = ext.scan_body(doc, toc_pages)
    stream = ext.build_stream(doc)
    pmap = ext.print_page_map(doc)
    ends = ext.scan_ends(stream)
    print("版式: %s" % p["label"])
    print("目录条目 %d  目录页 %s  标题候选 %d  行流 %d  结尾标记 %d"
          % (len(toc), sorted(toc_pages), len(titles), len(stream), len(ends)))
    if pmap:
        odds = sorted({i - pmap[i] for i in pmap})
        print("印刷页偏移: %s" % odds)
    print()

    # 用目录条目自己的标题去正文里找起点
    starts = []
    miss = []
    for e in toc:
        hit = ext.find_start(titles, decks, e, None, pmap)
        if hit:
            score, pno, x, y, txt = hit
            best, bd = None, 1e9
            for i, l in enumerate(stream):
                if l["p"] != pno:
                    continue
                d = abs(l["y0"] - y) * 3 + abs(l["x0"] - x)
                if d < bd:
                    best, bd = i, d
            if best is not None and bd < 400:
                starts.append((best, score, " ".join(e[0])[:40]))
                continue
        miss.append(" ".join(e[0])[:44])
    starts.sort()
    dedup, at = [], {}
    for i, sc, t in starts:
        if i in at:
            continue
        at[i] = t
        dedup.append((i, t))
    print("起点定位 %d / %d 条目录" % (len(dedup), len(toc)))

    # 终点配对（没有时长，就按顺序一对一）
    spans, k = [], 0
    for i, t in dedup:
        while k < len(ends) and ends[k] <= i:
            k += 1
        if k >= len(ends):
            break
        spans.append((i, ends[k], t))
        k += 1
    print("起终点配对 %d" % len(spans))

    owner = ext.assign_owners(stream, spans)
    display = {(l["p"], l["col"]) for l in stream if l["size"] > 12}
    buckets = [[] for _ in spans]
    for i, kk in enumerate(owner):
        if kk is not None:
            buckets[kk].append(stream[i])
    for kk, (a, e, t) in enumerate(spans):
        b = buckets[kk]
        head_col = (stream[a]["p"], stream[a]["col"])
        disp = [l for l in b
                if (l["p"], l["col"]) in display and (l["p"], l["col"]) != head_col]
        if not disp:
            continue
        cut = min(l["y0"] for l in disp)
        head = [l for l in b if (l["p"], l["col"]) == head_col and l["y0"] < cut]
        ids = {id(l) for l in disp} | {id(l) for l in head}
        buckets[kk] = head + disp + [l for l in b if id(l) not in ids]

    rows = []
    for kk, (a, e, t) in enumerate(spans):
        text = ext.slice_text(buckets[kk], 0, len(buckets[kk]))
        rows.append((len(text.split()), t, text))
    print()
    print("%-46s %6s  %s" % ("目录标题", "词数", "抽到的开头"))
    for w, t, text in rows:
        print("%-46s %6d  %s" % (t, w, text[:58]))
    ws = sorted(w for w, _, _ in rows if w)
    if ws:
        print()
        print("词数 中位 %d  最小 %d  最大 %d" % (ws[len(ws) // 2], ws[0], ws[-1]))
    if miss:
        print()
        print("起点没找到 %d 条: %s" % (len(miss), " / ".join(miss[:6])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
