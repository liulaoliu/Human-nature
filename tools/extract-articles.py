#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从杂志 PDF 抽正文，输出 JSON，键是 mp3 文件名（不含扩展名）。

用法:
    py tools/extract-articles.py [--profile=2016|2021] <pdf> <mp3目录> [输出json] [时长tsv]

依赖: pip install pymupdf

做法（靠字体和目录，不靠猜）:
  1. 起终点用两个硬信号定位，不是靠猜文字：
       · 起点 = 目录条目给的印刷页 + 正文里的标题行
       · 终点 = 正文结尾那个花饰符（`EcoPict` / `ZapfDingbats`），
         这是唯一精确的「本篇到此为止」标记。一页上甲在左栏开头、乙在左栏中段，
         甲的正文还要接到右栏，靠「下一篇标题在哪」去切会把甲切短、把乙切长。
  2. 同一页上每篇的正文不是连续的，所以逐行定归属：同栏里有终点标记的按终点分界，
     否则按起点分界。
  3. 用 rawdict 的逐字符 bbox 在空隙处补空格，绕开 PDF 丢空格的问题
     （"of conveying" 在 dict 模式下会粘成 "ofconveying"）。
  4. 最后过一道 wpm 闸门（见 WPM_LO/WPM_HI）：语速不合理的整篇不写出去。

字体、字号、花饰符名、文件名写法每一期都可能变，都收在 PROFILES 里。
换一期先跑 tools/inspect-fonts.py 看命中哪套。
"""
import fitz
import json
import os
import re
import sys
from collections import Counter, defaultdict

# ------------------------------------------------------------------ 常量

LIG_TBL = str.maketrans({
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
})

# 目录里的栏目名，用来把「缩进的栏目名」和「上一条的续行」区分开
SECTIONS = {
    "the world this week", "leaders", "letters", "briefing", "asia", "china",
    "united states", "the americas", "middle east and africa", "europe",
    "britain", "international", "business", "finance and economics",
    "science and technology", "books and arts", "obituary", "executive focus",
}

# ------------------------------------------------------------------ 版式档案
#
# 抽正文全靠字体和尺寸这两个硬信号（不是靠猜文字），所以换一期第一件事是
# 确认字体名还在不在。先跑 tools/inspect-fonts.py 看清单，对不上就在这里加一套。
#
# 字段含义:
#   title_font              正文里文章标题用的字体（2016 的目录条目也用它）
#   title_size              (下限, 上限)，字号落在这个区间才算标题
#   anchor_fonts            在正文里「哪些行可以当文章起点」。每项 (字体子串, 下限, 上限)。
#                           2016 是「标题字体 + 副题字体」；
#                           2021 的索引标题/音频标题指的是**栏目标签**（kicker，
#                           EconSansOSMed 11.6），正文大标题是另一句话
#                           （索引「Boarded-up Portland」→ 正文「Plaid shirts and plywood」），
#                           所以要靠 kicker 定位。
#   deck_font / deck_min     副题字体；一个字既是副题又是短文标题时用最小字号区分
#   body_font                正文字体（子串匹配，Roman/Bold/Italic 都算）
#   end_font                 文章结尾花饰符的字体，这是「本篇到此为止」的信号
#   ad_fonts                 广告和图表字体，整行排掉
#   toc_numbered             目录条目是不是「页码在前、标题在后」那种写法
#                            （2016 是「标题在前」，靠字体认；2021 是页码在前）
PROFILES = {
    "2016": {
        "label": "2016-09-10（Officina + EcoNewtext）",
        "title_font": "OfficinaSanITC-BoldOS",
        "title_size": (8.7, 9.3),
        "anchor_fonts": (("OfficinaSanITC-BoldOS", 8.7, 9.3),
                         ("EcoNewHead", 15.0, 999.0)),
        "deck_font": "EcoNewHead",
        "deck_min": 15.0,
        "body_font": "EcoNewtext",
        "end_font": "Pict",
        "ad_fonts": ("Helvetica", "BentonSans"),
        "toc_numbered": False,
        # 2016 的音频标题和纸面标题经常对不上，靠目录条目定位更稳。
        "title_anchor": False,
        # 社论页中间那栏是首段摘引，要提到正文前（2021 没有这种栏，见 PULL_QUOTE_COL）
        "pull_quote": True,
        # 正文里的非正文行（斜体侧栏等）照收，2016 这一版是照着现状验过的，不动它
        "drop_foreign_lines": False,
        "top_skip": 30.0,
    },
    "2021": {
        "label": "2021-06-12（Milo + EconSans）",
        "title_font": "MiloLNTE-Bold",
        "title_size": (24.0, 40.0),
        "anchor_fonts": (("MiloLNTE-Bold", 24.0, 40.0),
                         ("EconSansOSMed", 11.5, 11.7)),
        # 2021 的副题（standfirst）和正文里的粗体是同一个字体同一个字号，
        # 拿它当副题会把 150 多行正文算成标题候选。改用标题上方的栏目名，
        # 它反而不会误伤正文。
        "deck_font": "EconSansOSMed",
        "deck_min": 11.0,
        "body_font": "MiloTE",
        "end_font": "ZapfDingbats",
        "ad_fonts": ("Helvetica", "NeueHaasUnica", "Gibson", "Montserrat",
                     "Garamond", "Arial", "TimesNewRoman", "Frutiger",
                     "ProximaNova", "TNYNeutraface", "SofiaPro", "Graphik",
                     "ChaletBook", "Interstate", "Editor-", "CharlesModern",
                     "TDAmeritrade", "LouisVuitton", "EconomistAMV"),
        "toc_numbered": True,
        # 音频标题等于正文标题上方的栏目标签（kicker），所以目录没命中时
        # 可以拿音频标题直接去正文里找起点。
        "title_anchor": True,
        # 2021 每篇开头都有 31pt 的首字下沉，单独占一行，"有大字就是摘引栏"的判据会误伤
        "pull_quote": False,
        # 2021 的地名（「A M STE R DA M」）字距被拉开，一行碎成一堆单字母，收进来是噪声
        "drop_foreign_lines": True,
        # 页眉在 y=33，2016 那期在 y<30，所以切页眉的高度得跟着版式走。
        "top_skip": 45.0,
    },
}
DEFAULT_PROFILE = "2016"
# 当前生效的一套，main() 里按 --profile 覆盖。函数里直接读这些名字。
TITLE_FONT = ""
TITLE_LO = 0.0
TITLE_HI = 0.0
ANCHOR_FONTS = ()
DECK_FONT = ""
DECK_SIZE = 0.0
BODY_FONT = ""
END_FONT = ""
AD_FONTS = ()
TOC_NUMBERED = False
TOP_SKIP = 30.0
TITLE_ANCHOR = False
PULL_QUOTE_COL = False
DROP_FOREIGN = False


def use_profile(name):
    """把某一套档案装进模块级常量，后面所有函数都按它干活"""
    p = PROFILES[name]
    global TITLE_FONT, TITLE_LO, TITLE_HI, DECK_FONT, DECK_SIZE
    global BODY_FONT, END_FONT, AD_FONTS, TOC_NUMBERED, TOP_SKIP
    global ANCHOR_FONTS, TITLE_ANCHOR, PULL_QUOTE_COL, DROP_FOREIGN
    TITLE_FONT = p["title_font"]
    TITLE_LO, TITLE_HI = p["title_size"]
    ANCHOR_FONTS = p["anchor_fonts"]
    DECK_FONT = p["deck_font"]
    DECK_SIZE = p["deck_min"]
    BODY_FONT = p["body_font"]
    END_FONT = p["end_font"]
    AD_FONTS = p["ad_fonts"]
    TOC_NUMBERED = p["toc_numbered"]
    TOP_SKIP = p["top_skip"]
    TITLE_ANCHOR = p["title_anchor"]
    PULL_QUOTE_COL = p["pull_quote"]
    DROP_FOREIGN = p["drop_foreign_lines"]
    return p

# wpm 质量闸门。旁白通常 130~145 wpm（009 实测 135），
# 低于 110 说明正文被截断（少抽了），高于 175 说明混进了别的文章（多抽了）。
WPM_LO, WPM_HI = 110.0, 175.0

# 音频文件名和纸面标题对不上的几篇，手工指定纸面标题。
# 都是核对过的：014 纸面叫 The Affordable Care Act；046 叫 Tweetganda（很短的一小块）；
# 050 叫 The National Health Service（007 那篇是另一篇社论）；056 叫 Race relations；
# 077 纸面叫 Wooden buildings。
# 012 的 Briefing 页和 005 的 Leader 页，纸面上没有标题行，只剩副题，
# 只能拿副题当锚点。
ALIASES = {
    "005 Leaders - Post-truth politics": "Art of the lie",
    "012 Briefing - The post-truth world": "Yes, I'd lie to you",
    "014 United States - Obamacare": "The Affordable Care Act",
    "046 Europe - Russian social media": "Tweetganda",
    "050 Britain - The NHS": "The National Health Service",
    "056 International - Race in Brazil and America": "Race relations",
    "077 Science and technology - Building materials": "Wooden buildings",
}


def norm(s):
    """只用于匹配：小写、还原连字、标点和下划线都当空格"""
    s = s.translate(LIG_TBL).lower().replace("’", "'").replace("_", "'")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def clean(s):
    """用于输出：只还原连字，保留原大小写和标点"""
    return s.translate(LIG_TBL)


def ITALIC_MARK(font):
    """
    字体名里表示斜体的记号。两代不一样：
    2016 用「Italic」，2021 缩成「Ita」。斜体的是作者名/图片说明，不是正文。
    """
    return "Italic" in font or "Ita" in font


# ------------------------------------------------------------------ 版面

def is_title_style(span):
    return TITLE_FONT in span["font"] and TITLE_LO <= span["size"] <= TITLE_HI


def page_lines(page):
    """
    该页所有文本行，每行带：
      x0 / y0  位置
      col     栏号
      words   词列表（空隙处补过空格）
      font / size  该行主字体
    """
    lines = []
    for b in page.get_text("rawdict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            chars, font, size = [], "", 0.0
            for s in l["spans"]:
                if not s.get("chars"):
                    continue
                for c in s["chars"]:
                    if c["c"].strip():
                        chars.append((c["bbox"], c["c"]))
                if chars:
                    font, size = s["font"], max(size, s["size"])
            if not chars:
                continue

            # 逐字符看横向空隙，超过阈值就断词。
            # 阈值要压得低：正文是两端对齐的，词间距被拉开，但字母之间仍然很紧，
            # 0.13 倍字号会把 "at 10.5%" 粘成 "at10.5%"。
            thresh = max(0.6, size * 0.085)
            words, cur, prev = [], chars[0][1], chars[0][0]
            for bb, ch in chars[1:]:
                if bb[0] - prev[2] > thresh:
                    words.append(cur)
                    cur = ch
                else:
                    cur += ch
                prev = bb
            words.append(cur)

            lines.append({
                "x0": l["bbox"][0], "y0": l["bbox"][1],
                "words": [clean(w) for w in words],
                "text": " ".join(words),
                "font": font, "size": size,
            })

    # 分栏：x 聚类，栏内保持 y 序
    xs = sorted({round(l["x0"]) for l in lines})
    if not xs:
        return []
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > 60:
            groups.append(cur)
            cur = [x]
        else:
            cur.append(x)
    groups.append(cur)

    out = []
    for ci, g in enumerate(groups):
        lo, hi = g[0] - 14, g[-1] + 14
        for l in lines:
            if lo <= l["x0"] <= hi:
                out.append(dict(l, col=ci))
    out.sort(key=lambda l: (l["col"], l["y0"]))
    return out


# ------------------------------------------------------------------ 目录

def parse_toc(doc):
    """
    返回 (目录条目, 目录所在页)。条目形如 [[行1, 行2, ...], 印刷页, 栏x]。
    标题可能跨行，也可能后面跟着副题，所以按「行列表」存，匹配时从最长前缀试。
    目录页要单独记下来：目录里有「Business」这种光秃秃的栏目名，
    会被音频标题「Business」误认成正文标题。

    分三趟：先通读全书挑出候选行，再定哪些页是目录页，
    最后按版式把候选行筛成目录条目。分趟是因为「只认目录页附近的行」
    这个规则要等目录页定下来才知道。
    """
    # 第一趟：通读，打标
    cand = {}
    for pno in range(doc.page_count):
        rows = []
        for b in doc[pno].get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for l in b["lines"]:
                spans = [s for s in l["spans"] if s["text"].strip()]
                if not spans:
                    continue
                txt = "".join(s["text"] for s in spans).strip()
                if not txt:
                    continue
                # 目录行有两代写法：
                #   2016  「标题在前、页码在后」，整行是标题字体；
                #   2021  「页码在前、标题在后」，第一行带页码，
                #         续行只是正文字体（「58 The return of the」+「mega-lbo」），
                #         标题就在续行上，漏了就会把标题截断。
                rows.append((
                    l["bbox"][0], l["bbox"][1], txt,
                    bool(re.match(r"^\d{1,3}\s", txt)),          # numbered
                    all(is_title_style(s) for s in spans),        # styled
                    any(BODY_FONT in s["font"] for s in spans),   # bodyish
                ))
        if rows:
            cand[pno] = rows

    # 第二趟：定目录页。判据是「行数多，且至少三成带印刷页码」。
    # 2016 目录页 73/36 行（占 0.55/0.78）；正文页最多 10 行（交叉引用框）。
    toc_pages = set()
    for pno, rows in cand.items():
        rel = [r for r in rows if r[3] or r[4]]
        num = sum(1 for r in rel if r[3])
        if len(rel) >= 15 and num and num >= 0.3 * len(rel):
            toc_pages.add(pno)
    # 2021 的目录横跨两页，其中一页（封面说明那页）只挂了 Leaders 方框，
    # 带页码的行不够 15 条单独认不出来，把目录页旁边一页也算进来。
    cluster = set()
    for p in toc_pages:
        cluster |= {p - 1, p, p + 1}

    # 第三趟：按版式筛行，拼条目
    entries = []
    for pno in range(doc.page_count):
        rows = []
        for x, y, t, numbered, styled, bodyish in cand.get(pno, []):
            if TOC_NUMBERED:
                # 2021 的目录自成一页（整版索引），只认目录页附近的行：
                # 正文里的图表编号、版权页街道地址（「25 St James's Street…」）
                # 也带行首数字，全书乱收会出来一堆假条目。
                if pno not in cluster:
                    continue
                if not (numbered or styled or bodyish):
                    continue
            elif not styled:
                # 2016 的目录行本身就是标题字体，全书任何地方都收
                # （正文里的「Also in this section」框也是这个字体，是有效的文章清单）。
                continue
            rows.append((x, y, t))
        if not rows:
            continue
        xs = sorted({round(x) for x, _, _ in rows})
        groups, cur = [], [xs[0]]
        for x in xs[1:]:
            if x - cur[-1] > 60:
                groups.append(cur)
                cur = [x]
            else:
                cur.append(x)
        groups.append(cur)

        for g in groups:
            lo, hi = g[0] - 12, g[-1] + 12
            col = sorted([r for r in rows if lo <= r[0] <= hi],
                         key=lambda r: r[1])
            entry = None
            for x, y, t in col:
                m = re.match(r"^(\d{1,3})\s+(.+)$", t)
                if m:
                    entry = [[m.group(2).strip()], int(m.group(1)), x]
                    entries.append(entry)
                elif entry and 0 < x - entry[2] < 30:
                    n = norm(t)
                    if not n or n in SECTIONS or "The Economist" in t:
                        continue
                    if len(t) > 60 or n.startswith("contents"):
                        continue
                    entry[0].append(t)
    return entries, toc_pages


def match_toc(audio_titles, toc):
    """
    mp3 标题 → 目录条目。
    短标题（「Politics」）会同时匹配好几条目录，所以先各自取最优条目，
    再让每条目录条目只归给匹配最好的那篇，剩下的算未命中——
    宁可没正文，也不能给错文章。
    """
    cands = {}
    for base, title in audio_titles.items():
        n = norm(title)
        best = None
        for ei, e in enumerate(toc):
            g = grade(n, " ".join(e[0]))
            if g > 2:
                continue               # 目录匹配只放行较严的档
            g = min(g, grade(n, e[0][0]))
            if best is None or g < best[0]:
                best = (g, ei)
        if best:
            cands[base] = best

    winner = {}
    for base, (g, ei) in cands.items():
        if ei not in winner or g < winner[ei][0]:
            winner[ei] = (g, base)

    out, miss = {}, []
    for base, title in sorted(audio_titles.items()):
        if base not in cands:
            miss.append(base)
        elif winner[cands[base][1]][1] == base:
            out[base] = toc[cands[base][1]]
        else:
            miss.append(base)
    return out, miss


# ------------------------------------------------------------------ 正文定位

def scan_body(doc, toc_pages):
    """
    扫全书，取出所有「可能是文章开头的行」和「副题位置」，
    一次扫完给所有文章共用（每篇单独扫 84 页太慢）。
    哪些字体能当起点由版式档案的 anchor_fonts 决定 —— 2016 是「标题字体 + 副题字体」，
    2021 还要带上栏目标签（kicker），因为那一代的索引标题和音频标题指的是 kicker。
    三道过滤：
      · 目录行以印刷页码开头（「14 Interest-rate caps」），正文标题不会；
        目录页整页排掉，因为目录里有「Business」这种光秃秃的栏目名。
      · 页眉里也有标题（「20 Briefing The post-truth world 21」），按 y 排掉。
      · 「The Economist …」那种刊名/日期行排掉。
    """
    titles, decks = [], []
    for pno in range(doc.page_count):
        if pno in toc_pages:
            continue
        for l in page_lines(doc[pno]):
            if any(f in l["font"] for f in AD_FONTS):
                continue
            if l["y0"] < TOP_SKIP:
                continue
            if re.match(r"^\d{1,3}\s", l["text"]):
                continue                    # 目录行
            if "The Economist" in l["text"]:
                continue
            if DECK_FONT in l["font"] and l["size"] > DECK_SIZE:
                decks.append((pno, l["x0"], l["y0"]))
            if any(f in l["font"] and lo <= l["size"] <= hi
                   for f, lo, hi in ANCHOR_FONTS):
                titles.append((pno, l["x0"], l["y0"], l["text"]))
    return titles, decks


def grade(head, cand):
    """标题匹配质量，0 最好，99 表示不匹配"""
    cn, head = norm(cand), norm(head)
    if not cn or not head:
        return 99
    if cn == head:
        return 0
    if cn.startswith(head) or head.startswith(cn):
        return 1
    if " " + head + " " in " " + cn + " ":
        return 2
    if set(head.split()) <= set(cn.split()):
        return 3
    return 99


def find_start(titles, decks, entry, hint=None, pmap=None):
    """
    目录条目 → 正文起点 (页, x, y, 标题原文)。
    目录条目是「行列表」，标题可能跨行、后面还跟着副题，
    所以从最长前缀开始试，第一个能匹配上的就是标题。
    匹配质量、离目录页码有多远、下方有没有副题，一起参与打分。
    hint 给了就用它当标题（ALIASES 的情况）。
    pmap 是文档页号 → 印刷页号；没有就按 2016 那期的线性关系估。
    """
    page = entry[1]
    # 先按前缀试（2016 的目录是「标题 + 副题」，前缀就是标题）；
    # 再单独试每一行 —— 2021 的目录第一条常常是描述，真正的标题是下一行
    # （「11 The green boom / Bunged up」，正文标题是「Bunged up」）。
    seen, heads = set(), []
    for h in ([hint] if hint else []) + \
             [" ".join(entry[0][:k]) for k in range(len(entry[0]), 0, -1)] + \
             list(entry[0]):
        n = norm(h)
        if n and n not in seen:
            seen.add(n)
            heads.append(n)
    for head in heads:
        scored = []
        for pno, x, y, txt in titles:
            g = grade(head, txt)
            if g == 99:
                continue
            dist = abs((pmap.get(pno, pno + 1) if pmap else pno + 1) - page)
            if g >= 2 and dist > 2:
                continue               # 匹配不严，就必须在目录页附近
            s = g + 2 * dist
            if any(dp == pno and abs(dx - x) < 8 and 8 < dy - y < 45
                   for dp, dx, dy in decks):
                s -= 3
            scored.append((s, pno, x, y, txt))
        if scored:
            scored.sort()
            return scored[0]
    return None


# ------------------------------------------------------------------ 切正文

def print_page_map(doc):
    """
    文档页号 → 印刷页号。

    2016 那期正好是「印刷页 = doc 页号 + 1」，但 2021 那期 PDF 里插了整页广告，
    广告不算印刷页码（doc[48] 的页眉写的是 46），线性映射就错位了。
    页眉里印着页码，读出来当锚点。

    锚点要筛一遍：正文里也有孤立的数字（图表编号之类），会读成假页码。
    真页码满足「偏移 = doc 页号 - 印刷页号」非递减、且每次只小幅变化
    （变一次就是插了一页广告），按这个筛掉假的。
    """
    anchors = {}
    for pno in range(doc.page_count):
        for l in page_lines(doc[pno]):
            if l["y0"] < 45 and re.fullmatch(r"\d{1,3}", l["text"].strip()):
                anchors[pno] = int(l["text"].strip())
                break
    if len(anchors) < 5:
        return None
    offs = {i: i - p for i, p in anchors.items()}
    # 偏移（doc 页号 - 印刷页号）只会往上走：插一页广告就加一，不会变小。
    # 所以起点取最小值，再看它往后怎么涨。取众数会错——广告多半在后面，
    # 后段的偏移反而更常见。
    seed = min(offs.values())
    good, run = {}, seed
    for i in sorted(offs):
        o = offs[i]
        if seed <= o <= seed + 20 and 0 <= o - run <= 5:
            good[i] = anchors[i]
            run = o
    if len(good) < 5:
        return None
    out = {}
    for pno in range(doc.page_count):
        near = min(good, key=lambda k: (abs(k - pno), k))
        out[pno] = good[near] + (pno - near)
    return out


def build_stream(doc):
    """全书行流，去掉页眉页脚和广告，按阅读顺序"""
    stream = []
    for pno in range(doc.page_count):
        h = doc[pno].rect.height
        for l in page_lines(doc[pno]):
            if l["y0"] < TOP_SKIP or l["y0"] > h - 30:
                continue
            if any(f in l["font"] for f in AD_FONTS):
                continue
            if END_FONT in l["font"] and len(l["words"]) < 2:
                continue                   # 页脚页码，也是这个字体
            stream.append(dict(l, p=pno))
    return stream


def scan_ends(stream):
    """
    文章结尾标记。The Economist 每篇正文最后一行末尾带一个 EcoPict 字体的
    装饰字符，例如
        「…But imposing rate caps is shoddy economics. 7」
    这是唯一精确的「本篇到此为止」信号，比「下一篇标题在哪」可靠得多：
    一页上甲在左栏开头、乙在左栏中段，甲的正文还要接到右栏，
    靠「下一篇标题」去切就会把甲切短、把乙切长。
    页脚页码也用这个字体，但整行只有一个字符，按词数排掉。
    """
    return [i for i, l in enumerate(stream)
            if END_FONT in l["font"] and len(l["words"]) >= 2]


def assign_owners(stream, spans):
    """
    给每一行定唯一归属。

    一篇文章的正文在行流里不是连续的：同一页上，甲在左栏开头、乙在左栏中段，
    甲的正文还要接到右栏。甲的起点在左栏，甲的终点（结尾标记）在右栏，
    而乙的起点也在左栏 —— 于是「起点 → 终点」的行流区间里混着乙的标题。
    逐行判断的办法：
      · 如果这一行的同栏里有某篇的终点标记，就归「终点最靠前」的那篇（栏内按终点分界）；
      · 否则归「起点最靠后」的那篇（栏内按起点分界）。
    """
    owner = [None] * len(stream)
    for i, l in enumerate(stream):
        cands = [k for k, (a, b, _) in enumerate(spans) if a <= i <= b]
        if not cands:
            continue
        ends = [k for k in cands
                if stream[spans[k][1]]["col"] == l["col"]
                and stream[spans[k][1]]["y0"] >= l["y0"]]
        if ends:
            owner[i] = min(ends, key=lambda k: spans[k][1])
        else:
            owner[i] = max(cands, key=lambda k: spans[k][0])
    return owner


def slice_text(stream, at, end, drop=()):
    """
    取 stream[at:end] 的正文。
    开头跳过标题、副题、作者名、日期地名：正文字体才是正文（档案里的 body_font）。
    这里不能拿「一行至少 8 个词」当正文的判据 —— 社论页中间那栏只有 4~7 个词一行，
    整段 lede 会被判成不是正文丢掉。
    正文开始后，非正文字体的行仍然跳过：2021 的地名（「A M STE R DA M」）夹在
    副题和标题之间，字距被拉开，一行会碎成一堆单字母，收进来就是噪声。
    drop 里的 (页, 栏) 整栏丢掉（留给图表说明之类的噪声）。
    行尾连字符接词："hous-" + "ing" → "housing"，下一个词可以带标点（"ca,"）。
    首字下沉的大字单独一行，跟下一行之间不空格（"T" + "HE Kenyan" → "THE Kenyan"）。
    两处收尾：开头漏进来的图表编号、结尾的花饰符，都不是给人念的，去掉。
    """
    words = []
    started = False
    prev_y = None
    glue = False                     # 上一个词还没断开（首字下沉要粘住下一行）
    for l in stream[at:end]:
        ws = l["words"]
        if not ws:
            continue
        if drop and (l["p"], l["col"]) in drop:
            continue
        dropcap = l["size"] > 20 and len(ws) == 1
        is_body = BODY_FONT in l["font"] and not ITALIC_MARK(l["font"])
        # 结尾花饰那一行不是正文字体，但它挂着本篇最后几个词，收尾不能丢
        keep = is_body or (END_FONT in l["font"])
        if not started and not dropcap:
            if is_body:
                started = True
            else:
                continue
        elif DROP_FOREIGN and started and not keep and not dropcap:
            if os.environ.get("EXTRACT_DEBUG_DROP"):
                print("      丢掉 p%d col%d %.1fpt %-22s %r"
                      % (l["p"], l["col"], l["size"], l["font"][:22], l["text"][:44]))
            continue                 # 正文里的非正文行：地名、图片说明之类
        if glue:
            words[-1] = words[-1] + ws[0]
            words.extend(ws[1:])
            glue = False
        elif not words:
            words.extend(ws)
        elif dropcap and prev_y is not None and l["y0"] - prev_y < 3.5:
            words[-1] = words[-1] + ws[0]
            words.extend(ws[1:])
        elif words[-1].endswith("-") and re.match(r"^[a-z]", ws[0]):
            words[-1] = words[-1][:-1] + ws[0]
            words.extend(ws[1:])
        else:
            words.extend(ws)
        if dropcap:
            glue = True             # 大字单独一行，下一行紧跟着，粘住
        prev_y = l["y0"]

    # 开头：图表的编号（「2 wages account for 12% of GDP…」）排在正文栏里，
    # 但它不是文章开头，念出来是「二 wages account…」这种莫名其妙的东西。
    while words and re.fullmatch(r"[\d,.%-]+", words[0]) and len(words) > 6:
        words.pop(0)
    # 结尾：花饰符「7」。字符本身随字体变（7 / 1 / 别的），统一按「结尾一个孤立
    # 数字」处理，靠上下文保证不会误删正常词。
    if words and re.fullmatch(r"\d{1,2}", words[-1]):
        words.pop()
    return " ".join(words)


# ------------------------------------------------------------------ 主流程

def parse_audio_name(fname):
    """
    音频文件名 → (键, 用来匹配目录的标题)。
    两代命名：
      2016  「009 Leaders - Interest-rate caps.mp3」
            栏目和标题之间是「 - 」
      2021  「005-Leaders---The-green-boom-<32位哈希>.mp3」
            空格写成连字符，栏目和标题之间是「---」，尾巴挂一串哈希。
            这一代的标题正好就是目录索引的写法，比 2016 好匹配得多。
    认不出标题的（栏目过场那种）返回 (键, None)，调用方跳过。
    """
    base = fname[:-4] if fname.lower().endswith(".mp3") else fname
    m = re.match(r"^(.*)-[0-9a-f]{32}$", base)
    if m:
        parts = m.group(1).split("---")
        if len(parts) >= 2:
            title = parts[-1].replace("-", " ").replace("_", "'")
            return base, " ".join(title.split())
    if " - " in base:
        return base, " ".join(base.split(" - ")[1:])
    return base, None


def scan_audio(audio_dir):
    """目录里的 mp3 → {键: 标题}，跳过栏目过场"""
    out = {}
    for f in sorted(os.listdir(audio_dir)):
        if not f.lower().endswith(".mp3"):
            continue
        key, title = parse_audio_name(f)
        if title:
            out[key] = title
    return out


def find_start_by_title(titles, decks, title, page=None, pmap=None, win=4):
    """
    直接拿音频标题去正文里找起点（不经过目录条目）。

    2021 那代的索引标题是**描述**（「Boarded-up Portland」），正文大标题是另一句话
    （「Plaid shirts and plywood」），两边对不上；但音频标题正好等于标题上方的
    栏目标签 kicker（「Portland」），而 kicker 已经在 titles 里了，所以直接匹配更靠谱。
    page 是估出来的印刷页，用来在多个同名的候选里挑对那一个。
    """
    head = norm(title)
    if not head:
        return None
    scored = []
    for pno, x, y, txt in titles:
        g = grade(head, txt)
        if g == 99:
            continue
        if page is not None and pmap is not None:
            dist = abs(pmap.get(pno, pno) - page)
            if dist > win:
                continue
        else:
            dist = 0
        s = g + 2 * dist
        if any(dp == pno and abs(dx - x) < 8 and 8 < dy - y < 45
               for dp, dx, dy in decks):
            s -= 3
        scored.append((s, pno, x, y, txt))
    if not scored:
        return None
    scored.sort()
    return scored[0]


def extend_start(stream, i):
    """
    把起点往上扩到「标题区」的开头。

    定位到的可能是大标题那一行（在栏目标签和副题下面），而正文开头那一段
    就压在标题上面。往上走，把同栏、紧挨着的非正文行（栏目标签、大标题、副题）
    一起圈进来 —— slice_text 会跳过它们，但不会漏掉正文第一段。
    只在同栏且行距正常时往上走，撞到正文行或换栏就停，免得吃进上一篇。
    """
    while i > 0:
        prev, cur = stream[i - 1], stream[i]
        if prev["col"] != cur["col"]:
            break
        if cur["y0"] - prev["y0"] > 45:
            break
        if BODY_FONT in prev["font"]:
            break
        if END_FONT in prev["font"]:
            break              # 上一篇的结尾花饰，再往上就是别人的正文了
        i -= 1
    return i


def stream_index(stream, pno, x, y):
    """(页, x, y) → 行流下标"""
    best, bestd = None, 1e9
    for i, l in enumerate(stream):
        if l["p"] != pno:
            continue
        d = abs(l["y0"] - y) * 3 + abs(l["x0"] - x)
        if d < bestd:
            best, bestd = i, d
    return best if bestd < 400 else None


def mp3_no(base):
    m = re.match(r"^(\d{1,3})", base)
    return int(m.group(1)) if m else None


def main():
    args = [a for a in sys.argv[1:]]
    profile = DEFAULT_PROFILE
    for a in list(args):
        if a.startswith("--profile="):
            profile = a.split("=", 1)[1]
            args.remove(a)
    if profile not in PROFILES:
        print("没有这套版式档案: %s（有: %s）" % (profile, ", ".join(PROFILES)))
        return 2
    p = use_profile(profile)
    print("版式档案:", profile, "-", p["label"])

    if len(args) < 2:
        print(__doc__)
        return 1
    pdf_path = args[0]
    audio_dir = args[1]
    out_path = args[2] if len(args) > 2 else "public/articles.json"
    dur_path = args[3] if len(args) > 3 else None
    # 默认攒库；--fresh 重建整库（换了一期彻底抽不出来时用）
    merge = "--fresh" not in sys.argv

    doc = fitz.open(pdf_path)
    toc, toc_pages = parse_toc(doc)
    print("目录条目:", len(toc), "（目录页:", sorted(toc_pages), ")")
    pmap = print_page_map(doc)
    if pmap:
        odds = sorted({i - pmap[i] for i in pmap})
        print("印刷页映射:", "偏移 %s" % odds if len(odds) < 4
              else "偏移 %d~%d（PDF 里插了广告页）" % (odds[0], odds[-1]))

    audio = scan_audio(audio_dir)
    print("音频文章:", len(audio), "（已排除栏目过场）")

    matched, miss = match_toc(audio, toc)
    print("目录命中:", len(matched), "未命中:", len(miss))

    titles, decks = scan_body(doc, toc_pages)

    stream = build_stream(doc)
    print("全书行数:", len(stream))

    marks = []
    for base, entry in matched.items():
        hit = find_start(titles, decks, entry, ALIASES.get(base), pmap)
        if not hit:
            continue
        score, pno, x, y, _ = hit
        i = stream_index(stream, pno, x, y)
        if i is not None:
            marks.append((extend_start(stream, i), score, base))
    marks.sort()

    # ---- 目录没命中的，直接拿音频标题去正文里找 ----
    # 2021 的索引标题和正文标题常常不是一句话（索引「Boarded-up Portland」，
    # 正文「Plaid shirts and plywood」），靠目录找不到；但音频标题等于 kicker。
    # 页号靠 mp3 编号估：编号和印刷顺序是单调一致的，拿已定位的当锚点插值。
    if TITLE_ANCHOR and dur_path:
        anchors = sorted((mp3_no(b), pmap.get(stream[i]["p"], 0))
                         for i, _, b in marks if mp3_no(b) is not None)
        for base in sorted(audio):
            if any(b == base for _, _, b in marks):
                continue
            no = mp3_no(base)
            page = None
            if no is not None and anchors:
                lo = [a for a in anchors if a[0] <= no]
                hi = [a for a in anchors if a[0] >= no]
                if lo and hi:
                    (n0, p0), (n1, p1) = lo[-1], hi[0]
                    page = p0 if n1 == n0 else round(p0 + (p1 - p0) * (no - n0) / (n1 - n0))
                elif lo:
                    page = lo[-1][1] + (no - lo[-1][0])
                else:
                    page = hi[0][1] - (hi[0][0] - no)
            hit = find_start_by_title(titles, decks, audio[base], page, pmap)
            if not hit:
                continue
            score, pno, x, y, _ = hit
            i = stream_index(stream, pno, x, y)
            if i is not None:
                marks.append((extend_start(stream, i), score + 4, base))   # 比目录定位低一档
        marks.sort()

    # 两篇撞到同一个起点（标题太泛导致的误匹配）时，匹配分高的留下
    dedup, at = [], {}
    for i, score, base in marks:
        if i in at:
            print("  跳过 %s：和 %s 定位到同一处" % (base, at[i][1]))
            continue
        at[i] = (score, base)
        dedup.append((i, base))
    marks = dedup
    print("正文起点定位:", len(marks), "/", len(audio))

    # ---- 用结尾标记配对出每篇的终点 ----
    # 不是所有短文都带结尾标记（54 个标记 vs 61 个起点）。
    # 一篇缺标记，后面每篇都会错位，所以配对要看跨度合不合理：
    # 起点到终点的行数，按「9 词/行、130 wpm」折算成 音频秒数 × 0.24。
    # 跨度远超预期，说明这篇自己没有结尾标记，终点跟下一篇共用。
    ends = scan_ends(stream)
    print("结尾标记:", len(ends))

    dur = {}
    if dur_path:
        for line in open(dur_path, encoding="utf-8"):
            if "\t" in line:
                k, v = line.rstrip("\n").rsplit("\t", 1)
                try:
                    dur[k] = float(v)
                except ValueError:
                    pass

    spans, j, shared = [], 0, False
    for at, base in marks:
        while j < len(ends) and ends[j] <= at:
            j += 1
        if j >= len(ends):
            break
        sec = dur.get(base, 0.0)
        far = sec > 0 and (ends[j] - at) > 2.5 * sec * 0.24
        spans.append((at, ends[j], base))
        if far and not shared and j + 1 < len(ends):
            shared = True                     # 与下一篇共用这个终点
            print("  %s 没有自己的结尾标记，终点与下一篇共用" % base)
        else:
            j += 1
            shared = False
    print("起终点配对:", len(spans), "/", len(marks))

    # ---- 逐行定归属，再拼正文 ----
    owner = assign_owners(stream, spans)
    buckets = [[] for _ in spans]
    for i, k in enumerate(owner):
        if k is not None:
            buckets[k].append(stream[i])

    # 2016 的社论页中间那栏放首段（lede），版面上排在右栏之后、语义上紧跟标题，
    # 所以要提到正文前面。判据是「这栏里有大字」—— 2016 的大字只出现在那种摘引栏。
    # 2021 不能这么判：那一代每个正文开头都有个 31pt 的首字下沉，单独占一行，
    # 结果所有开篇栏都被当成摘引栏，整篇词序被打乱。
    if PULL_QUOTE_COL:
        display = {(l["p"], l["col"]) for l in stream if l["size"] > 12}
        for k, (at, end, base) in enumerate(spans):
            b = buckets[k]
            head_col = (stream[at]["p"], stream[at]["col"])
            disp = [l for l in b
                    if (l["p"], l["col"]) in display and (l["p"], l["col"]) != head_col]
            if not disp:
                continue
            cut = min(l["y0"] for l in disp)
            head = [l for l in b
                    if (l["p"], l["col"]) == head_col and l["y0"] < cut]
            disp_ids = {id(l) for l in disp}
            head_ids = {id(l) for l in head}
            rest = [l for l in b if id(l) not in disp_ids and id(l) not in head_ids]
            buckets[k] = head + disp + rest

    articles = {}
    for k, (at, end, base) in enumerate(spans):
        text = slice_text(buckets[k], 0, len(buckets[k]))
        if os.environ.get("EXTRACT_DEBUG") and text:
            b = buckets[k]
            print("  [调试] %s" % base[:46])
            print("     起点 [%d] p%d col=%d y=%.0f %r"
                  % (at, stream[at]["p"], stream[at]["col"], stream[at]["y0"],
                     stream[at]["text"][:44]))
            print("     终点 [%d] p%d col=%d y=%.0f %r"
                  % (end, stream[end]["p"], stream[end]["col"], stream[end]["y0"],
                     stream[end]["text"][-36:]))
            print("     桶首/桶尾: %r ... %r" % (b[0]["text"][:40], b[-1]["text"][-30:]))
            print("     字数 %d，桶行数 %d" % (len(text.split()), len(b)))
        if text:
            articles[base] = {
                "title": " ".join(audio[base].split()),
                "words": len(text.split()),
                "text": text,
            }

    # ---- 质量闸门：wpm 必须落在合理区间，否则不写出去 ----
    # 旁白通常 130~145 wpm（009 实测 135）。低于 110 是正文被截断，
    # 高于 175 是混进了别的文章。宁可不写，也不要写一份看着能用、实际串篇的文本。
    rejected = []
    if dur_path:
        for base in list(articles):
            d = dur.get(base) or dur.get(base + ".mp3")
            if not d:
                continue
            wpm = articles[base]["words"] / d * 60.0
            if not (WPM_LO <= wpm <= WPM_HI):
                rejected.append((wpm, base, articles[base]["words"], d))
                del articles[base]
        rejected.sort()

    # ---- 合并进已有的库，不是覆盖 ----
    # 一期一期往下跑，库是一点点攒起来的。App 按音频文件名查，多期放一起不会串。
    # 同一篇重复跑以这次的结果为准。要重建整库加 --fresh。
    old = {}
    if merge and os.path.exists(out_path):
        try:
            with open(out_path, encoding="utf-8") as f:
                old = json.load(f)
        except (ValueError, OSError):
            old = {}
    added = [k for k in articles if k not in old]
    updated = [k for k in articles if k in old and old[k] != articles[k]]
    merged = dict(old)
    merged.update(articles)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)

    n = len(articles)
    sizes = sorted(v["words"] for v in articles.values())
    print("本期写出:", n, "篇（新增 %d，更新 %d）→ %s" % (len(added), len(updated), out_path))
    print("库里共:", len(merged), "篇")
    if sizes:
        print("词数  中位 %d  最小 %d  最大 %d" % (sizes[n // 2], sizes[0], sizes[-1]))

    # 开头是半句话的（第一个词小写，多半是起点定晚了）单独列出来，
    # wpm 闸门拦不住这种 —— 少一句照样是合理的语速。
    if articles:
        odd = [b for b, v in articles.items()
               if v["text"][:1].islower() and not re.match(r"^[a-z]{1,3}\d", v["text"])]
        if odd:
            print("\n开头疑似半句话（第一个词是小写，值得看一眼）%d 篇:" % len(odd))
            for b in sorted(odd):
                print("  %s" % b[:52])
                print("      %s" % articles[b]["text"][:66])
    if merge and not articles and old:
        print("注意: 本期一篇都没抽出来，库里原有的 %d 篇原样保留。" % len(old))
    if rejected:
        print("\nwpm 超出 %.0f~%.0f，未写出 %d 篇:" % (WPM_LO, WPM_HI, len(rejected)))
        for wpm, base, words, d in rejected:
            print("  %6.0f wpm  %5d词/%6.1fs  %s" % (wpm, words, d, base))

    if miss:
        print("\n目录未命中:")
        for b in miss:
            print("  x", b)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
