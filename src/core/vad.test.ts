import { describe, it, expect } from 'vitest'
import { detectSpeechSpans, autoThresholdDb } from './vad'
import { buildSignal } from './testSignals'

describe('autoThresholdDb', () => {
  it('returns a value between the noise floor and the loud frames', () => {
    const s = buildSignal([
      ['silence', 1.0],
      ['speech', 1.0],
      ['silence', 1.0],
    ])
    const thr = autoThresholdDb(s.samples, s.sampleRate)
    expect(thr).toBeGreaterThan(-60)
    expect(thr).toBeLessThan(-10)
  })

  it('all-silence input still yields a usable threshold instead of NaN', () => {
    const s = buildSignal([['silence', 1.0]])
    const thr = autoThresholdDb(s.samples, s.sampleRate)
    expect(Number.isFinite(thr)).toBe(true)
  })
})

describe('detectSpeechSpans', () => {
  it('finds three speech runs in speech/silence/speech/silence/speech', () => {
    const s = buildSignal([
      ['speech', 0.5],
      ['silence', 0.5],
      ['speech', 0.8],
      ['silence', 0.5],
      ['speech', 0.6],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    expect(spans).toHaveLength(3)
    expect(spans[0].start).toBeCloseTo(0, 1)
    expect(spans[0].end).toBeCloseTo(0.5, 1)
    expect(spans[1].start).toBeCloseTo(1.0, 1)
    expect(spans[1].end).toBeCloseTo(1.8, 1)
    expect(spans[2].start).toBeCloseTo(2.3, 1)
    expect(spans[2].end).toBeCloseTo(2.9, 1)
  })

  it('merges runs separated by a gap shorter than mergeGapMs', () => {
    const s = buildSignal([
      ['speech', 0.4],
      ['silence', 0.1], // shorter than the 400ms default
      ['speech', 0.4],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    expect(spans).toHaveLength(1)
    expect(spans[0].end).toBeCloseTo(0.9, 1)
  })

  it('keeps runs separated by a gap longer than mergeGapMs', () => {
    const s = buildSignal([
      ['speech', 0.4],
      ['silence', 0.5],
      ['speech', 0.4],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    expect(spans).toHaveLength(2)
  })

  it('honours an explicit mergeGapMs over the default', () => {
    const s = buildSignal([
      ['speech', 0.4],
      ['silence', 0.3],
      ['speech', 0.4],
    ])
    // 300ms gap: merged at the default 400, split when told to split at 200.
    expect(detectSpeechSpans(s.samples, s.sampleRate)).toHaveLength(1)
    expect(detectSpeechSpans(s.samples, s.sampleRate, { mergeGapMs: 200 })).toHaveLength(2)
  })

  it('drops blips shorter than minSpeechMs', () => {
    const s = buildSignal([
      ['speech', 0.4],
      ['silence', 0.5],
      ['speech', 0.05], // cough
      ['silence', 0.5],
      ['speech', 0.4],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    expect(spans).toHaveLength(2)
  })

  it('trims leading and trailing silence out of the spans', () => {
    const s = buildSignal([
      ['silence', 0.3],
      ['speech', 0.5],
      ['silence', 0.3],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    expect(spans[0].start).toBeGreaterThan(0.25)
    expect(spans[0].end).toBeLessThan(0.85)
  })

  it('returns no spans for a silent recording', () => {
    const s = buildSignal([['silence', 3.0]])
    expect(detectSpeechSpans(s.samples, s.sampleRate)).toHaveLength(0)
  })

  it('respects an explicit threshold over the automatic one', () => {
    const s = buildSignal([
      ['speech', 0.5],
      ['silence', 0.4],
      ['speech', 0.5],
    ])
    // A threshold far above the signal should find nothing.
    expect(detectSpeechSpans(s.samples, s.sampleRate, { thresholdDb: 10 })).toHaveLength(0)
  })

  it('never produces overlapping or out-of-order spans', () => {
    const s = buildSignal([
      ['speech', 0.3],
      ['silence', 0.2],
      ['speech', 0.3],
      ['silence', 0.2],
      ['speech', 0.3],
      ['silence', 0.2],
      ['speech', 0.3],
    ])
    const spans = detectSpeechSpans(s.samples, s.sampleRate)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
    }
  })
})
