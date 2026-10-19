import type { ComponentProps } from 'react'
import mascotAI from '../../../assets/imgs/GinShinImapct.png'
import SideOverview from './SideOverview'
import SideMastery from './SideMastery'
import SidePick from './SidePick'
import SideVocab from './SideVocab'
import StatsPanel from './StatsPanel'

/** 右侧栏的五个页签。 */
export type ReaderSideTab = 'overview' | 'pick' | 'vocab' | 'stats' | 'mastery'

const TABS: { key: ReaderSideTab; label: string }[] = [
  { key: 'overview', label: '总览' },
  { key: 'pick', label: '选词 / 分析' },
  { key: 'vocab', label: '生词本' },
  { key: 'stats', label: '统计' },
  { key: 'mastery', label: '掌握度' },
]

/**
 * 阅读页右侧栏：品牌图 + 页签 + 五个面板。
 * 面板 props 按区域分组传入，`ReaderApp` 只需把各 hook 的输出接进来。
 */
export interface ReaderSidebarProps {
  sideTab: ReaderSideTab
  onSideTabChange: (tab: ReaderSideTab) => void
  overview: ComponentProps<typeof SideOverview>
  mastery: ComponentProps<typeof SideMastery>
  stats: ComponentProps<typeof StatsPanel>
  pick: ComponentProps<typeof SidePick>
  vocab: ComponentProps<typeof SideVocab>
}

export default function ReaderSidebar({
  sideTab,
  onSideTabChange,
  overview,
  mastery,
  stats,
  pick,
  vocab,
}: ReaderSidebarProps) {
  return (
    <>
      <div className="side-brand">
        <img src={mascotAI} alt="" title="精读" />
      </div>
      <div className="side-tabs">
        {TABS.map(({ key, label }) => (
          <button key={key} className={sideTab === key ? 'primary' : ''} onClick={() => onSideTabChange(key)}>
            {label}
          </button>
        ))}
      </div>
      <SideOverview {...overview} />
      <SideMastery {...mastery} />
      <div className="side-sec" data-sec="stats">
        <StatsPanel {...stats} />
      </div>
      <SidePick {...pick} />
      <SideVocab {...vocab} />
    </>
  )
}
