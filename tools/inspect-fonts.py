#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
换新一期杂志时，先跑这个，看字体对不对得上。

抽正文全靠字体和尺寸这两个硬信号（不是靠猜文字），所以换一期第一件事
就是确认 TITLE_FONT / BODY_FONT / AD_FONTS 这些常量还是不是这几个名字。

用法:
    py tools/inspect-fonts.py <pdf路径>

输出:
    · 字体清单：每个字体用了多少次、什么字号、样文
    · 对着 extract-articles.py 里的常量，逐条报「有 / 没有」
    · 目录页（9pt 粗体行最多的那两页）和结尾花饰符的检出情况
"""
import importlib.util
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRACT = os.path.join(HERE, "extract-articles.py")


def load_extractor():
    spec = importlib.util.spec_from_file_location("ext", EXTRACT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    pdf = sys.argv[1]
    ext = load_extractor()
    doc = ext.fitz.open(pdf)
    print("PDF: %s  共 %d 页" % (os.path.basename(pdf), doc.page_count))
    print()

    # ---- 字体清单 ----
    count = Counter()
    sizes = defaultdict(Counter)
    sample = {}
    for pno in range(doc.page_count):
        for l in ext.page_lines(doc[pno]):
            f = l["font"]
            count[f] += 1
            sizes[f][round(l["size"], 1)] += 1
            if f not in sample and len(l["words"]) >= 2:
                sample[f] = l["text"][:56]

    print("字体清单（按出现次数）:")
    print("  次数    字号(最多的三个)              字体")
    for f, n in count.most_common():
        top = " ".join("%g" % s for s, _ in sizes[f].most_common(3))
        print("  %-6d %-28s %s" % (n, top, f))
    print()

    # ---- 常量核对 ----
    # 常量现在是「版式档案」，逐套对，看这本 PDF 命中哪套。
    print("哪套版式档案对得上这本 PDF:")
    for name, prof in ext.PROFILES.items():
        ext.use_profile(name)
        hit = sum(n for f, n in count.items() if prof["title_font"] in f)
        body = sum(n for f, n in count.items() if prof["body_font"] in f)
        end = sum(n for f, n in count.items() if prof["end_font"] in f)
        ad = sum(n for f, n in count.items()
                 if any(a in f for a in prof["ad_fonts"]))
        ok = hit > 0 and body > 0 and end > 0
        print("  %s %-6s %s" % ("[命中]" if ok else "[  ]  ", name, prof["label"]))
        print("           标题字体 %-22s %5d 行" % (prof["title_font"], hit))
        print("           正文字体 %-22s %5d 行" % (prof["body_font"], body))
        print("           结尾花饰 %-22s %5d 行" % (prof["end_font"], end))
        print("           广告字体 %d 种命中 %d 行" % (len(prof["ad_fonts"]), ad))
    print()
    print("如果一套都没命中，这本是新版式：照上面的字体清单在 PROFILES 里加一套。")
    print("字号对不上时，把清单里该字体最常见的那个数填进 title_size。")
    print()

    # 目录页和结尾标记，用第一套命中的档案跑
    use = next((n for n in ext.PROFILES
                if sum(c for f, c in count.items()
                       if ext.PROFILES[n]["title_font"] in f) > 0
                and sum(c for f, c in count.items()
                        if ext.PROFILES[n]["body_font"] in f) > 0), None)
    if use:
        ext.use_profile(use)
        print("按 %s 试跑:" % use)
        try:
            toc, toc_pages = ext.parse_toc(doc)
            print("  目录 %d 条，目录页 %s" % (len(toc), sorted(toc_pages)))
        except Exception as e:
            print("  目录解析挂了: %s" % e)
        try:
            pmap = ext.print_page_map(doc)
            if pmap:
                odds = sorted({i - pmap[i] for i in pmap})
                print("  印刷页偏移 %s" % odds)
            stream = ext.build_stream(doc)
            ends = ext.scan_ends(stream)
            print("  行流 %d 行，结尾标记 %d 个" % (len(stream), len(ends)))
            if ends:
                print("  样例: %r" % stream[ends[0]]["text"][:50])
        except Exception as e:
            print("  行流/结尾标记挂了: %s" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
