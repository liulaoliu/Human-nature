import { Fragment, useState } from 'react'
import {
  DEFAULT_DRILL_LIMIT,
  DRILL_LIMIT_OPTIONS,
  type DrillKind,
  type DrillLimits,
  type QuizDrillKind,
} from '../../core/intensiveDrill'
import RoundStartPrompt from './RoundStartPrompt'

interface DrillItem {
  kind: DrillKind
  /** 按钮上的字（带 emoji） */
  label: string
  /** 无障碍 / 题数下拉用的名字（不带 emoji） */
  name: string
  title: string
}

interface DrillRow {
  hint: string
  items: DrillItem[]
}

const ROWS: DrillRow[] = [
  {
    hint: '词 · 搭配',
    items: [
      {
        kind: 'memory',
        label: '🥊 记忆拷打',
        name: '记忆拷打',
        title: '拼写 + 看词选义 + 词形辨析：把词变成长期记忆',
      },
      {
        kind: 'chunk',
        label: '🧩 词块拷打',
        name: '词块拷打',
        title: '搭配填空 + 例句填空 + 搭配默写 + 介词填空 + 习语填空：逼你把词组用出来',
      },
      {
        kind: 'deep',
        label: '🇬🇧 英英释义',
        name: '英英释义',
        title: '英英释义 → 写单词 / 选单词：用英文理解英文，记得更牢',
      },
      {
        kind: 'mark',
        label: '🏷 语法标记',
        name: '语法标记',
        title: '判断可数/不可数、及物/不及物、可分级/不可分级',
      },
    ],
  },
  {
    hint: '句 · 语法 · 听',
    items: [
      {
        kind: 'grammar',
        label: '🧠 语法·结构',
        name: '语法·结构',
        title: '中译英 + 结构/语法 + 功能词 + 排序：练语态时态与句式',
      },
      {
        kind: 'listen',
        label: '🎧 听力拷打',
        name: '听力拷打',
        title: '听力填空：听音填词，检验听力',
      },
    ],
  },
  {
    hint: '总攻',
    items: [
      {
        kind: 'siege',
        label: '🧨 错题包围战（打到全对）',
        name: '错题包围战',
        title: '把错题本 + 优先重排 + 学不稳的词一起拉出来混编轰炸，自动「反复鞭打」直到全对',
      },
    ],
  },
]

export interface DrillLauncherProps {
  /** 没有打开文章时，本篇的六种拷打不可用；错题包围战仍可用。 */
  hasDoc: boolean
  /** 一键跑批中：所有动作 / 数量选择先锁住。 */
  busy: boolean
  /** 七种入口各自记住的每次题数 */
  limits: DrillLimits
  onLimitChange: (kind: DrillKind, limit: number) => void
  onDrill: (kind: QuizDrillKind, limit: number) => void
  onSiege: (limit: number) => void
}

/**
 * 精读面板的「快速拷打」区：点哪一项，就在那一行下面展开数量选择，确认后才开考。
 *
 * 为什么不是一排 select：七个下拉太挤，而且用户得先找到「哪个下拉对应哪个按钮」。
 * 为什么不在动作 hook 里读设置：数量是用户这次点的选择，动作只接收结果；
 * 设置怎么存是 `useQuizSettings` 的事，两边不互相知道。
 */
export default function DrillLauncher({
  hasDoc,
  busy,
  limits,
  onLimitChange,
  onDrill,
  onSiege,
}: DrillLauncherProps) {
  const [pending, setPending] = useState<{ item: DrillItem; limit: number } | null>(null)

  const open = (item: DrillItem) => setPending({ item, limit: limits[item.kind] })
  const change = (n: number) => {
    if (!pending) return
    setPending({ ...pending, limit: n })
    onLimitChange(pending.item.kind, n)
  }
  const start = () => {
    if (!pending) return
    const kind = pending.item.kind
    const limit = pending.limit
    setPending(null)
    if (kind === 'siege') onSiege(limit)
    else onDrill(kind, limit)
  }
  const startDisabled = busy || (!!pending && !hasDoc && pending.item.kind !== 'siege')

  return (
    <div className="idrills">
      <div className="idrills-head">
        <b>快速拷打</b>
        <span className="muted">点开先选本次题数（默认 {DEFAULT_DRILL_LIMIT} 题，七种各自记住）</span>
      </div>

      {ROWS.map((row) => (
        <Fragment key={row.hint}>
          <div className="idrill-row">
            <span className="muted">{row.hint}</span>
            {row.items.map((item) => (
              <button
                key={item.kind}
                className={item.kind === 'siege' ? 'danger' : undefined}
                onClick={() => open(item)}
                disabled={busy || (!hasDoc && item.kind !== 'siege')}
                aria-pressed={pending?.item.kind === item.kind}
                title={`${item.title}（点开先选本次题数）`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {pending && row.items.some((item) => item.kind === pending.item.kind) && (
            <RoundStartPrompt
              title={pending.item.label}
              hint="开始前选题数（会记住）"
              ariaLabel={pending.item.name}
              value={pending.limit}
              options={DRILL_LIMIT_OPTIONS}
              onChange={change}
              onStart={start}
              onCancel={() => setPending(null)}
              disabled={startDisabled}
            />
          )}
        </Fragment>
      ))}

      <div className="muted intensive-tip">
        词 / 句拷打只针对<b>本篇</b>，错题包围战按错题本全库挑；答对会推进该词的 SRS，答错进错题本。
        隔天再回「背单词」清到期即可。
      </div>
    </div>
  )
}
