#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
就地清洗已抽取的 articles.json：去软连字符、ligature、不换行空格、多余空白。

注意：这只是「能安全做的事」。真正的彻底修复请用更新后的 extract-articles.py
带着音频目录重跑（那一版会在抽取时按字符间距区分断词和实义连字符，
把 "af fordable" 接成 "affordable"、把 "shake­up" 还原成 "shake-up"）。
本脚本对已经粘连/丢空格的文本无能为力。

用法:
    py tools/clean-articles.py public/articles.json
"""
import json
import re
import sys

SOFT_HYPHEN = "\u00ad"
LIG_TBL = str.maketrans({
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
})


def clean(text):
    text = text.translate(LIG_TBL)
    text = text.replace(SOFT_HYPHEN, "").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "public/articles.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    changed = 0
    for value in data.values():
        new = clean(value.get("text", ""))
        if new != value.get("text"):
            changed += 1
        value["text"] = new
        value["words"] = len(new.split())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("清洗完成：%d/%d 篇有改动" % (changed, len(data)))


if __name__ == "__main__":
    main()
