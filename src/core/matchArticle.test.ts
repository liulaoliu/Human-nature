import { describe, it, expect } from 'vitest'
import { findArticle, normalize, stripHash, styleOf, type ArticleBook } from './matchArticle'

const a = (title: string): ArticleBook[string] => ({ title, words: 3, text: `text of ${title}` })

const BOOK: ArticleBook = {
  '009 Leaders - Interest-rate caps': a('Interest-rate caps'),
  '028 Asia - The wit and wisdom of Rodrigo Duterte': a('Rodrigo Duterte'),
  '060 Business - Reliance Jio': a('Reliance Jio'),
}

describe('normalize', () => {
  it('撇号各种写法都归一成下划线', () => {
    expect(normalize("Rodrigo Duterte")).toBe(normalize('Rodrigo Duterte'))
    expect(normalize("Rodrigo Duterte")).toBe(normalize('rodrigo  duterte'))
  })

  it('大小写和多余空白不影响', () => {
    expect(normalize('  Leaders   -  Hong  ')).toBe('leaders - hong')
  })
})

describe('styleOf', () => {
  it('认得出两代的写法', () => {
    expect(styleOf('009 Leaders - Interest-rate caps')).toBe('spaced')
    expect(styleOf('005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7')).toBe('dashed')
    expect(styleOf('我的录音')).toBe('other')
  })
})

describe('stripHash', () => {
  it('去掉尾巴上那串 32 位哈希', () => {
    expect(stripHash('005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7'))
      .toBe('005-Leaders---The-green-boom')
  })

  it('没有哈希就不动', () => {
    expect(stripHash('009 Leaders - Interest-rate caps')).toBe('009 Leaders - Interest-rate caps')
  })
})

describe('findArticle', () => {
  it('文件名完全对上时命中', () => {
    expect(findArticle(BOOK, '009 Leaders - Interest-rate caps.mp3')?.title).toBe(
      'Interest-rate caps',
    )
  })

  it('2021 那种带哈希的文件名能命中', () => {
    const b: ArticleBook = {
      '005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7': a('The green boom'),
    }
    expect(findArticle(b, '005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7.mp3')?.title)
      .toBe('The green boom')
  })

  it('2021 的文件重新下载、哈希变了，靠抹掉哈希那一档还能命中', () => {
    const b: ArticleBook = {
      '005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7': a('The green boom'),
    }
    expect(findArticle(b, '005-Leaders---The-green-boom-ffffffffffffffffffffffffffffffff.mp3')?.title)
      .toBe('The green boom')
  })

  it('库里放了两期、期号撞车时不猜，但文件名对得上照样命中', () => {
    const b: ArticleBook = {
      '005 Leaders - Post-truth politics': a('Post-truth politics'),
      '005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7': a('The green boom'),
    }
    // 文件名精确，命中
    expect(findArticle(b, '005-Leaders---The-green-boom-0ebfa18befeffb60c715bbf0e29fd3f7.mp3')?.title)
      .toBe('The green boom')
    // 名字被改得只剩期号，两期都有 005，不敢猜
    expect(findArticle(b, '005 renamed.mp3')).toBeNull()
  })

  it('带路径的文件名也能命中', () => {
    expect(findArticle(BOOK, 'I:/audio/009 Leaders - Interest-rate caps.mp3')?.title).toBe(
      'Interest-rate caps',
    )
  })

  it('扩展名换成 m4a 也能命中', () => {
    expect(findArticle(BOOK, '060 Business - Reliance Jio.m4a')?.title).toBe('Reliance Jio')
  })

  it('撇号写成真撇号，靠归一化兜住', () => {
    expect(findArticle(BOOK, "028 Asia - The wit and wisdom of Rodrigo Duterte.mp3")?.title).toBe(
      'Rodrigo Duterte',
    )
  })

  it('名字被改过、对不上任何一档时返回 null（宁可手动粘，不给错的）', () => {
    expect(findArticle(BOOK, '009 renamed.mp3')).toBeNull()
    expect(findArticle(BOOK, '009 - 利率上限.mp3')).toBeNull()
  })

  it('两期混装时不会串期：期号一样但代次不同，不认', () => {
    const b: ArticleBook = {
      '023 The Americas - Bello': a('Bello 2016'),
      '023-The-Americas---Nicaragua_s-opposition-61bf607a167700469cc24b8f8b05b2a0': a('Nicaragua 2021'),
    }
    expect(findArticle(b, '023 The Americas - Something else.mp3')).toBeNull()
    // 2021 那种写法、哈希变了，归一化那一档在同代次里命中
    expect(
      findArticle(b, '023-The-Americas---Nicaragua_s-opposition-ffffffffffffffffffffffffffffffff.mp3')
        ?.title,
    ).toBe('Nicaragua 2021')
  })

  it('库里没有这篇时返回 null', () => {
    expect(findArticle(BOOK, '099 Something else.mp3')).toBeNull()
  })

  it('完全没有期号的陌生文件返回 null', () => {
    expect(findArticle(BOOK, '我的录音.mp3')).toBeNull()
  })

  it('期号撞车时不猜，返回 null', () => {
    const dup: ArticleBook = {
      '050 Britain - One': a('One'),
      '050 Britain - Two': a('Two'),
    }
    expect(findArticle(dup, '050 Britain - ???.mp3')).toBeNull()
  })
})
