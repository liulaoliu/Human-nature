import { useState } from 'react'
import GoldenFeedback from './GoldenFeedback'
import GoldenPasteBox from './GoldenPasteBox'
import type { GoldenExamApi } from './types'

/**
 * 仿写考试：中文提示 + 目标结构 → 用户写新句子 → AI 批改。
 *
 * 判分口径复用 `core/writing` 的 WritingFeedback；这里只做展示与粘贴入口。
 */
export default function GoldenExamView({ exam, onBack }: { exam: GoldenExamApi; onBack: () => void }) {
  const [taskPaste, setTaskPaste] = useState('')
  const [gradePaste, setGradePaste] = useState('')

  if (!exam.unlocked) {
    return (
      <div className="golden-body">
        <div className="bar golden-drill-bar">
          <button onClick={onBack}>← 课程页</button>
          <b>仿写考试</b>
        </div>
        <div className="golden-preview">
          <div className="golden-en">再完成 {Math.max(0, exam.after - exam.completedCount)} 句就解锁</div>
          <div className="muted">
            已完成遣词造句 {exam.completedCount} / {exam.after} 句。考试会用你已经学过的句型，给中文提示让你写新句子。
          </div>
        </div>
      </div>
    )
  }

  const current = exam.current
  if (!current) {
    return (
      <div className="golden-body">
        <div className="bar golden-drill-bar">
          <button onClick={onBack}>← 课程页</button>
          <b>仿写考试</b>
          <span className="muted">已完成 {exam.completedCount} 句</span>
        </div>
        <div className="golden-preview">
          <div className="golden-en">这一轮考完了</div>
          <div className="muted">
            共 {exam.items.length} 题；成绩已存进仿写记录。可以重新开始，或让 AI 按已完成句子重新出题。
          </div>
          <div className="bar">
            <button className="primary" onClick={exam.start}>再考一轮</button>
            <button onClick={exam.generateTasks} disabled={exam.generating}>
              {exam.generating ? 'AI 出题中…' : 'AI 重新出题'}
            </button>
            <button onClick={exam.copyTaskPrompt}>复制出题提示词</button>
          </div>
        </div>
        <GoldenPasteBox
          label="应用 AI 出题结果（JSON）"
          value={taskPaste}
          onChange={setTaskPaste}
          onApply={() => {
            if (exam.applyTasks(taskPaste)) setTaskPaste('')
          }}
          placeholder='{"items":[{"sentenceId":"s1","task":"...","structure":"...","mustUse":["..."],"rubric":[]}]}'
        />
      </div>
    )
  }

  return (
    <div className="golden-body">
      <div className="bar golden-drill-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>仿写考试</b>
        <span className="muted">第 {exam.index + 1} / {exam.items.length} 题</span>
        <span className="muted">已完成 {exam.completedCount} 句</span>
        <button onClick={exam.generateTasks} disabled={exam.generating}>
          {exam.generating ? 'AI 出题中…' : 'AI 重新出题'}
        </button>
        <button onClick={exam.copyTaskPrompt}>复制出题提示词</button>
      </div>

      <div className="golden-preview">
        <div className="muted">用学过的句型写一句英文；不要照抄范句，换一个内容或场景。</div>
        <div className="golden-en golden-exam-task">{current.task}</div>
        {current.structure && <div className="golden-note">目标结构：{current.structure}</div>}
        {current.mustUse.length > 0 && (
          <div className="golden-note">必须用上：{current.mustUse.join('、')}</div>
        )}
      </div>

      <textarea
        className="study-input golden-exam-input"
        rows={5}
        value={exam.answer}
        onChange={(e) => exam.setAnswer(e.target.value)}
        placeholder="在这里写你的英文句子…"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="bar">
        <button className="primary" onClick={() => void exam.grade()} disabled={exam.grading}>
          {exam.grading ? '批改中…' : '提交 AI 批改'}
        </button>
        <button onClick={() => void exam.copyGradePrompt()}>复制批改提示词</button>
        {exam.index > 0 && <button onClick={exam.prev}>上一题</button>}
        <button onClick={exam.next}>{exam.index + 1 >= exam.items.length ? '交卷' : '下一题'}</button>
      </div>

      {exam.error && <div className="golden-bad">{exam.error}</div>}

      {exam.feedback && <GoldenFeedback feedback={exam.feedback} model={current.model} />}

      <GoldenPasteBox
        label="应用 AI 批改结果（JSON）"
        value={gradePaste}
        onChange={setGradePaste}
        onApply={() => {
          if (exam.applyGrade(gradePaste)) setGradePaste('')
        }}
        placeholder='{"scores":[{"dimension":"结构运用","score":30,"max":35}],"issues":[],"polished":"...","summary":"..."}'
      />

      <GoldenPasteBox
        label="应用 AI 出题结果（JSON）"
        value={taskPaste}
        onChange={setTaskPaste}
        onApply={() => {
          if (exam.applyTasks(taskPaste)) setTaskPaste('')
        }}
        placeholder='{"items":[{"sentenceId":"s1","task":"...","structure":"...","mustUse":["..."],"rubric":[]}]}'
      />

      {exam.history.length > 0 && (
        <div className="golden-note">
          本科已存 {exam.history.length} 次考试记录（回课程页点「🕘 学习历史」可看完整批改）。
        </div>
      )}
    </div>
  )
}
