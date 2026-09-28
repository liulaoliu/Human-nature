#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
校验抽取结果：wpm = 词数 / 音频时长，必须落在合理区间。

用法:
    py tools/validate-articles.py <articles.json> <durations.tsv>

durations.tsv 每行: <mp3文件名>\t<秒>
参考值：009 实测 135 wpm。旁白通常 130~145。
低于 110 说明正文被截断（少抽了），高于 175 说明混进了别的文章（多抽了）。
"""
import json
import sys

LO, HI = 110.0, 175.0
IDEAL = 135.0


def main():
    art_path, dur_path = sys.argv[1], sys.argv[2]
    art = json.load(open(art_path, encoding="utf-8"))
    dur = {}
    for line in open(dur_path, encoding="utf-8"):
        line = line.rstrip("\n")
        if "\t" not in line:
            continue
        name, sec = line.rsplit("\t", 1)
        try:
            dur[name] = float(sec)
        except ValueError:
            pass

    rows, bad, missing = [], [], []
    for base, v in art.items():
        d = dur.get(base) or dur.get(base + ".mp3")
        if not d:
            missing.append(base)
            continue
        wpm = v["words"] / d * 60.0
        rows.append((wpm, base, v["words"], d))
        if not (LO <= wpm <= HI):
            bad.append((wpm, base, v["words"], d))

    rows.sort()
    if not rows:
        print("没有可校验的条目")
        return

    wpms = [r[0] for r in rows]
    n = len(rows)
    print("可校验 %d 篇（音频时长缺失 %d 篇）" % (n, len(missing)))
    print("wpm  中位 %.0f   最低 %.0f   最高 %.0f   合理区间 %.0f~%.0f"
          % (sorted(wpms)[n // 2], min(wpms), max(wpms), LO, HI))
    near = sum(1 for w in wpms if 120 <= w <= 150)
    print("落在 120~150 的: %d/%d (%.0f%%)" % (near, n, 100.0 * near / n))

    if bad:
        print("\n超出合理区间 %d 篇:" % len(bad))
        for wpm, base, words, d in sorted(bad):
            print("  %6.0f wpm  %5d词/%6.1fs  %s" % (wpm, words, d, base))
    else:
        print("\n全部在合理区间内 ✓")

    print("\n最低 5 篇:")
    for wpm, base, words, d in rows[:5]:
        print("  %6.0f wpm  %5d词/%6.1fs  %s" % (wpm, words, d, base))
    print("最高 5 篇:")
    for wpm, base, words, d in rows[-5:]:
        print("  %6.0f wpm  %5d词/%6.1fs  %s" % (wpm, words, d, base))

    if missing:
        print("\n时长缺失:")
        for b in missing:
            print("  ", b)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
