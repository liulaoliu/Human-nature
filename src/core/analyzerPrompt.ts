import {
  FENCE,
  HEADER,
  quoted,
  type BuildPromptInput,
  type VocabLevel,
} from './analyzerShared'

/**
 * 精读 AI 提示词构建：把「要做的任务 + 选中的原文」拼成可直接粘到网页版 DeepSeek 的文本。
 *
 * 从这里只产出字符串，不做解析、不碰数据模型——解析在 `analyzerParse.ts`，
 * 对外仍然是 `analyzer.ts` 这一个门面，调用方不用改 import。
 */

/** 生成可直接粘贴到网页版 DeepSeek 的提示词。 */
export function buildPrompt(input: BuildPromptInput): string {
  const text = input.text.trim()
  switch (input.task) {
    case 'translate':
      return `${HEADER}\n把下面的英文翻译成地道、通顺的中文，只输出译文。\n原文：\n${quoted(text)}`
    case 'grammar':
      return `${HEADER}\n分析下面句子的结构：先给主干，再列修饰成分，再标出从句类型，最后点出难点。只输出分析，不要翻译。\n句子：\n${quoted(text)}`
    case 'collocations':
      return `${HEADER}\n从下面句子里挑出值得学习的动词搭配、介词搭配和地道表达，每条一行，用「 — 」分隔搭配和中文意思。只输出列表。\n句子：\n${quoted(text)}`
    case 'summarize':
      return `${HEADER}\n用中文总结下面这段的要点，最多 3 条，每条一行。只输出总结。\n段落：\n${quoted(text)}`
    case 'extract_vocab':
      return `${HEADER}\n从下面段落里提取超出四六级/雅思范围的高频生词，只输出词形，用逗号分隔，不要重复，不要解释。\n段落：\n${quoted(text)}`
    case 'auto_vocab':
      return buildAutoVocabPrompt(text)
    case 'lookup': {
      const words = (input.words?.length ? input.words : [text]).join(', ')
      return `${HEADER}\n请对下面每个单词输出一行，字段用 | 分隔，顺序固定：\n单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英+中) | 英文释义\n单词列一律输出**合适的原形**：名词用单数（companies→company），动词用一般现在时原形（running→run、went→go、Bahrainis→Bahraini），形容词/副词用原级（better→good）。现在分词（-ing）和过去分词（-ed）一律先判断它在上下文里是不是动词用法：只要是动词用法（含作定语但表示动作、构成进行时、构成分词短语等），一律还原为动词原形（dulling→dull、tinkering→tinker、swelling→swell、expunging→expunge）；只有已固化为独立形容词的分词才保持原样（exciting、interesting、expected、complicated、advanced），**不要因为 -ing 形式就默认它是形容词**；独立名词（savings、belongings）保持；音标必须给国际音标（IPA，用斜杠包住，如 /ˈrʌnɪŋ/，按原形给），每个词都要有；词性用 v./n./adj./prep. 等缩写**且不许留空**（空着会被退回词典词头首义，那个词性和上下文义项常常不是一回事）；中文含义用**词典式简短释义**（核心义，每个义项 ≤8 字、最多 2 个义项，用「；」分隔）——**不要按语境意译成长句**，语境用词尽量还原成词典里的说法（例：splinter 在语境里指"分裂出的小派别"，就写「分裂；小派别」，而不是整句解释）；用法有多条用「；」分隔，**每条搭配都要带简短中文**（格式：搭配 — 中文，如 run out — 用完；run a business — 经营公司）；例句要短（≤12 词）、只体现该义项、带典型搭配，英文和中文用「 — 」分隔；英文释义用学习者词典风格的一句话（用简单英文解释，不要照抄中文）；确实没把握的才留空，不要编造。\n示例：\nrunning | /rʌn/ | v. | 跑步 | run out；run a business | I run every day. — 我每天跑步。 | to move quickly on foot\n单词：${words}\n上下文（帮助判断词义）：\n${quoted(text)}`
    }
  }
}

/**
 * 批量查词提示词：一次把多个生词（各自带上下文句）交给 DeepSeek。
 * 用在「选词模式」里攒了一批词，一键复制。
 */
export function buildBatchLookupPrompt(entries: { word: string; context?: string }[]): string {
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    const k = e.word.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const lines = unique
    .map((e) => (e.context ? `- ${e.word}  （上下文：${e.context}）` : `- ${e.word}`))
    .join('\n')
  return `${HEADER}\n请对下面每个单词输出一行，字段用 | 分隔，顺序固定：\n单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英+中) | 英文释义\n单词列一律输出**合适的原形**：名词用单数（companies→company），动词用一般现在时原形（running→run、went→go、Bahrainis→Bahraini），形容词/副词用原级（better→good）。现在分词（-ing）和过去分词（-ed）一律先判断它在上下文里是不是动词用法：只要是动词用法（含作定语但表示动作、构成进行时、构成分词短语等），一律还原为动词原形（dulling→dull、tinkering→tinker、swelling→swell、expunging→expunge）；只有已固化为独立形容词的分词才保持原样（exciting、interesting、expected、complicated、advanced），**不要因为 -ing 形式就默认它是形容词**；独立名词（savings、belongings）保持；音标必须给国际音标（IPA，用斜杠包住，如 /rʌn/，按原形给），每个词都要有；词性用 v./n./adj./prep. 等缩写**且不许留空**，**按这个词在上下文里的实际用法定**——同一个词在句中作动词就写 v.，不要照抄词典词头的首个词性（例：rival 在 "…to rival America's" 里是动词，就写 v. +「与…匹敌」+ rival sb/sth，不要写 n. 对手）；**词性、中文含义、用法/搭配、例句、英文释义这五样必须同属一个义项**，不许把名词的释义配动词的搭配；中文含义用**词典式简短释义**（核心义，每个义项 ≤8 字、最多 2 个义项，用「；」分隔）——**不要按语境意译成长句**，语境用词尽量还原成词典里的说法（例：splinter 在语境里指"分裂出的小派别"，就写「分裂；小派别」，而不是整句解释）；用法有多条用「；」分隔，**每条搭配都要带简短中文**（格式：搭配 — 中文，如 run out — 用完；run a business — 经营公司）；例句要短（≤12 词）、只体现该义项、带典型搭配，英文和中文用「 — 」分隔；英文释义用学习者词典风格的一句话（用简单英文解释，不要照抄中文）；确实没把握的才留空，不要编造。\n示例：\nrunning | /rʌn/ | v. | 跑步 | run out；run a business | I run every day. — 我每天跑步。 | to move quickly on foot\n单词与上下文：\n${lines}`
}

/**
 * 清洗提示词：把从 PDF / 网页复制来的原始文本交给 AI，去掉多余换行与粘连、修错。
 * 用「新建文章」里的一键复制，粘到网页版 AI，再把结果贴回来。
 */
export function buildCleanupPrompt(raw: string): string {
  return `下面是我从 PDF / 网页复制来的英文文本，可能存在：
- 不该有的换行（一句话被硬拆成好几行）
- 单词粘连（例如 offthe、BarackObama、tookpart）
- 拼写、标点等明显错误

请去掉不必要的换行、修复粘连和错误，保持原意和原有措辞，给我修复后的文本。

**重要：我可能在最开头手动加了「【……】」中文方括号标记（标题 / 导语，可能有一到多行）。请原样保留**：
- 不要删除、不要改写、不要换成别的括号或符号；
- 不要移动位置，也不要把「【…】」那几行和正文合并成一行；
- 每一行「【…】」都单独成行保留。
除这些标记以外的正文，才按上面的要求清洗。

只输出修复后的文本，不要解释、不要加标题。

原文：
${FENCE}
${raw.trim()}
${FENCE}`
}

/** 用法示例提示词：按中文含义给每个词造 1–2 个「好例句」。 */
export function buildExamplePrompt(entries: { word: string; meaning?: string }[]): string {
  const lines = entries
    .map((e) => (e.meaning ? `- ${e.word}（含义：${e.meaning}）` : `- ${e.word}`))
    .join('\n')
  return `${HEADER}
下面每个单词给了中文含义。请为每个词写 1–2 个**好例句**（英文 + 中文），要求：
- **短**：每句不超过 12 个词，语法简单，读一遍就懂；
- **只考一个词**：除了目标词，句中其余词都要是常见词（别塞别的生词，这就是 "i+1"）；
- **用对义项**：必须体现「含义」里给的那个意思，不要用别的义项；
- **给搭配**：优先用该词最常见的搭配 / 句型（动词带典型宾语或介词；名词配常见动词/介词；形容词配典型名词）；
- **具体真实**：像真实场景里说出的一句话，不要空洞例句（如 "This is a run."）；
- 句中必须**出现该词的自然词形**（原形或它的屈折形式，方便以后挖空）。
每个词输出一行，字段用 | 分隔，顺序固定：单词 | 例句1英 | 例句1中 | 例句2英 | 例句2中
只有在需要展示**不同搭配**时才给第二句；中文要自然、口语化，不要逐字直译。
不要编号、不要解释、不要加标题。
示例：
mitigate | The drug can mitigate the pain. | 这种药能减轻疼痛。 | We must mitigate the risks. | 我们必须降低风险。
词与含义：
${lines}`
}


/**
 * 词组 / 习语提示词：为每个词补「常用词组搭配」与「固定习语」。
 * 用来填背单词卡片上「词组 / 习语」两块（与「用法」「例句」分开）。
 */
export function buildPhrasePrompt(entries: { word: string; meaning?: string | null }[]): string {
  const lines = entries.map((e) => (e.meaning ? `- ${e.word}（含义：${e.meaning}）` : `- ${e.word}`)).join('\n')
  return `${HEADER}
下面每个单词，请给出它的**常用词组 / 搭配**和**固定习语**（有就给，没有就写「无」）。
- 词组：该词组成的常用搭配或短语（2–4 条），如 run out、run a business；
- 习语：该词参与的固定习语 / 俚语（0–2 条），如 run in the family；确实没有就写「无」；
- **每条都要带简短中文释义**（格式：英文 — 中文，如 run out — 用完）；
- 只放该词真实常见的说法，不要与单词本身重复，不要解释，不要造句。
**每个词都必须输出一行**（哪一类没有就写「无」，不要漏行）。
每个词输出一行，字段用 | 分隔，顺序固定：单词 | 词组1；词组2 | 习语1；习语2
词组、习语有多条都用「；」分隔；某一类没有就写「无」。
示例：
run | run out — 用完；run a business — 经营公司 | run in the family — 家族遗传
mrs | 无 | 无
只输出这些行，不要编号、不要标题、不要解释。
词与含义：
${lines}`
}

/** 语法标记提示词：为每个词标「主要释义」的语法属性（名词可数性、动词及物性等）。 */
export function buildGrammarMarkPrompt(entries: { word: string; meaning?: string | null }[]): string {
  const lines = entries.map((e) => (e.meaning ? `- ${e.word}（含义：${e.meaning}）` : `- ${e.word}`)).join('\n')
  return `${HEADER}
下面每个单词，请按它**最常用的那个释义**，给出语法标记。可选标记（只能从下面挑，可多选）：
- 名词：可数 / 不可数（两种用法都有就都选）
- 动词：及物 / 不及物（两种用法都有就都选）
- 形容词：可分级 / 不可分级
只标该词**确实具备**的类别；该词不是名词/动词/形容词，或该类别不适用，就不要硬凑。
**每个词都必须输出一行**（哪怕没有可标的，也要写「无」，不要漏行，不要跳过专有名词/称呼语）。
每个词输出一行，字段用 | 分隔，顺序固定：单词 | 标记1；标记2
多个标记用「；」分隔；没有可标的就在第二格写「无」。
示例：
water | 不可数
run | 可数；及物；不及物
happy | 可分级
mrs | 无
只输出这些行，不要编号、不要标题、不要解释。
词与含义：
${lines}`
}

/**
 * 全文翻译提示词：按句子 id 逐句翻译，id 原样返回，位置天然对齐。
 */
export function buildTranslateAllPrompt(sentences: { id: string; text: string }[]): string {
  const list = sentences.map((s) => `${s.id} | ${s.text}`).join('\n')
  return `${HEADER}\n下面是按顺序编号的英文句子。请逐句翻译成地道、通顺的中文，**每个 id 输出一行**，格式固定：\nid | 中文翻译\n要求：id 原样照抄、顺序不变、不合并也不拆分句子；只输出这些行，不要解释、不要加标题。\n${list}`
}

const LEVEL_DESC: Record<VocabLevel, string> = {
  cet4: '以「大学英语四级」为基准（四级大纲以内的词不要）',
  cet6: '以「大学英语六级」为基准（六级大纲以内的词不要）',
  kaoyan: '以「考研英语」大纲为基准',
  ielts: '以「刚开始学雅思」为基准（约雅思 5.5–6 分，核心词汇约 6000）',
  ielts65: '以「雅思 6.5 分」为基准（核心词汇约 8000）',
}

/**
 * 自动标词提示词：让 AI 按指定词汇水平，从文章里挑出值得查词学习的单词。
 * 结果是一串「原形」单词，粘回后进入「待选」清单，人工增删后再查词。
 */
export function buildAutoVocabPrompt(text: string, level: VocabLevel = 'cet6'): string {
  return `${HEADER}\n请${LEVEL_DESC[level]}，从下面这篇文章里挑出**超出该水平、值得查词学习**的单词。\n要求：\n- 每个词输出**原形**：名词用单数、动词用一般现在时（如 running→run、went→go）；\n- 去掉重复；只输出**单个单词**，不要短语、不要编号、不要解释、不要分点；\n- **每个词单独一行**（不要一行里写好几个词，也不要加词性/中文/序号）；\n- 数量按文章长度取 20–40 个，按在文中出现的先后顺序。\n文章：\n${quoted(text)}`
}

/**
 * 混淆项提示词：为一批词生成**形近/音近但含义明显不同**的干扰词及释义。
 * 用于给「看词选义 / 词形辨析」提供更贴合的干扰项（生词本太小时尤其有用）。
 *
 * 明确排除「义近词」：否则中文释义会出现近义词，选择题就有多个正确答案。
 */
export function buildConfusablePrompt(entries: { word: string; meaning?: string | null }[]): string {
  const lines = entries.map((e) => (e.meaning ? `- ${e.word}（${e.meaning}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '下面每个英文单词，请给出 3 个**容易混淆**的英文单词，并给出它们各自的中文释义。',
    '「容易混淆」指：拼写形近、或读音相近、或词形相似——但**含义必须明显不同**。',
    '',
    '务必遵守：',
    '- 干扰词的释义**绝不能**是原词含义的同义词 / 近义词，也不能是原词意思的另一种说法（否则做选择题会出现多个正确答案）。',
    '- 3 个干扰词的释义之间也要**互不相同、区分度高**（不要出现「微调」「微调，调整」这种几乎同义的）。',
    '- 释义要**简短、单一**（一个义项即可），不要用逗号罗列多个近义说法。',
    '- 必须是真实存在的英语单词，且不是原词本身。',
    '',
    '每个词输出一行，格式固定：',
    '原词 | 易混词1:释义1 ; 易混词2:释义2 ; 易混词3:释义3',
    '',
    '示例：',
    'adapt | adopt:收养 ; adept:熟练的 ; adrift:漂浮的',
    '（反例：adapt | adjust:调整 —— adjust 与 adapt 含义太近，不要这样）',
    '',
    '单词：',
    lines,
  ].join('\n')
}

/**
 * 原形校正提示词：给一批词（带来源句语境），让 AI 判断它们在词典里的**原形**。
 * 专治「非原型」词条（saw→see、companies→company、analyses→analysis）。
 */
export function buildLemmaPrompt(entries: { word: string; context?: string }[]): string {
  const lines = entries.map((e) => (e.context ? `- ${e.word}  （语境：${e.context}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '下面每个英文单词，请根据它出现的语境，判断它在词典里的**原形（lemma）**并输出。',
    '规则：',
    '- 动词一律还原为不定式（saw→see、went→go、running→run）；',
    '- 名词还原为单数（companies→company、analyses→analysis、children→child）；',
    '- 形容词 / 副词还原为原级（better→good、worse→bad）；',
    '- 注意区分同形不同词：saw（看见→see / 锯子→saw）、found（找到→find / 创建→found）、left（离开→leave / 左边→left），按**语境**判断；',
    '- 已经是原形就原样返回。',
    '',
    '**最重要的一条：加了前缀 / 后缀构成的另一个词，不是词形变化，必须原样返回，不要还原。**',
    '- 否定、反义前缀 un- / in- / im- / ir- / il- / dis- / non- / anti- / mis- 造出的是**独立的词**：',
    '  unchallenged → unchallenged（**不是** challenge）、unarticulated → unarticulated（**不是** articulate）、',
    '  inarticulate → inarticulate（**不是** articulate）、discouraged → discouraged（**不是** courage）、nonviolent → nonviolent；',
    '- 后缀派生的也一样：quickly → quickly、teacher → teacher（**不是** teach）、kindness → kindness、creation → creation；',
    '- 只处理 -s / -es / -ies / -ed / -ing / -er / -est 这类**屈折**变化，以及不规则形。',
    '  判断不了就原样返回；宁可返回原词，也不要把另一个词的原形塞进来。',
    '',
    '每个词输出一行，格式固定：',
    '原词形 | 原形',
    '只输出这些行，不要解释、不要标题、不要编号。',
    '',
    '单词与语境：',
    lines,
  ].join('\n')
}

/**
 * -ing / -ed 语法辨析提示词：强制逐个判断 -ing/-ed 形式在当前语境里的语法身份，
 * 不许用「可以理解为…/相当于…」含糊带过。
 */
export function buildPosPrompt(entries: { word: string; context?: string }[]): string {
  const lines = entries.map((e) => (e.context ? `- ${e.word}  （语境：${e.context}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '请针对下面每个单词 / 短语里的 **-ing 或 -ed 形式**，明确判断它在当前语境中具体属于哪一类，',
    '不要只说「可以理解为……」或「相当于……」。逐个按以下要求分析：',
    '1. 先给出它在词典里的原形（lemma）。**只做屈折还原，不做派生还原**：',
    '   加前缀 / 后缀构成的另一个词，原形就是它自己 ——',
    '   unchallenged 的原形是 unchallenged（**不是** challenge），unarticulated 的是 unarticulated（**不是** articulate），',
    '   inarticulate 的是 inarticulate（**不是** articulate），nonviolent 的是 nonviolent；',
    '2. 明确它的语法身份，必须从下列类别中选一个并说明理由：',
    '   - 谓语动词',
    '   - 非谓语动词（不定式 / 动名词 / 现在分词 / 过去分词）',
    '   - 分词构成的独立形容词',
    '   - 已经固化为独立形容词的分词',
    '   - 名词',
    '   - 其他（请具体说明）',
    '3. 说明它在当前语境中的具体含义（不要只给词典义）。',
    '4. 说明它修饰哪个词，或在句中充当什么成分（主语 / 定语 / 状语 / 补语等）。',
    '5. 如果属于「分词作定语」，必须进一步说明：现在分词还是过去分词、主动还是被动、进行还是完成、相当于哪个定语从句。',
    '6. 如果它已固化为独立形容词，必须给出证据或常见词典标注，不能仅凭 -ing/-ed 形式就判定为形容词。',
    '最后用一句话总结最准确的词性标注。',
    '',
    '输出格式固定（每行一条，字段用 | 分隔，共 8 列）：',
    '原形 | 当前形式 | 当前词性 | 语法身份 | 修饰对象/句子成分 | 具体含义 | 判断理由 | 最准确词性标注',
    '示例：',
    'slide | sliding | adj. | 现在分词转化来的形容词，作定语 | 修饰 oil prices | 持续下跌的 | 表示主动、进行中的状态，相当于 oil prices that are sliding | adj.（分词形容词）',
    '只输出这些行，不要解释、不要标题、不要编号。',
    '',
    '单词与语境：',
    lines,
  ].join('\n')
}
