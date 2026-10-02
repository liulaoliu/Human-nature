/**
 * 连字符断词判断用的小词典。
 *
 * 行末出现 `foo-\nbar` 时，有两种可能：
 *   - 断词：`com-\npared` → `compared`（词本来没有连字符）
 *   - 真复合词：`co-\nfounder` → `co-founder`（词本来有连字符）
 * 去掉连字符后若能在词典里找到，说明是断词，删连字符；否则保留。
 *
 * 这里先放一个精简表，够覆盖常见词；后续可换成完整词表 / 词形还原。
 */

const WORDS = new Set<string>([
  'about', 'above', 'across', 'affordable', 'after', 'against', 'almost',
  'already', 'although', 'always', 'among', 'another', 'because', 'became',
  'become', 'before', 'behind', 'being', 'below', 'better', 'between',
  'billion', 'business', 'businesses', 'called', 'cannot', 'century',
  'certain', 'change', 'changes', 'children', 'china', 'compared',
  'companies', 'company', 'country', 'countries', 'decade', 'decades',
  'declined', 'despite', 'different', 'during', 'economic', 'economies',
  'economy', 'education', 'either', 'election', 'emerging', 'energy',
  'enough', 'europe', 'european', 'every', 'everything', 'example',
  'federal', 'finance', 'financial', 'foreign', 'founder', 'government',
  'governments', 'growth', 'happened', 'however', 'important', 'including',
  'increase', 'industry', 'inflation', 'instead', 'investment', 'itself',
  'labour', 'liberal', 'little', 'market', 'markets', 'million', 'minister',
  'morning', 'national', 'nature', 'nearly', 'never', 'nothing', 'number',
  'often', 'other', 'others', 'people', 'perhaps', 'police', 'policy',
  'political', 'politicians', 'politics', 'population', 'possible',
  'president', 'problem', 'problems', 'programme', 'project', 'public',
  'recently', 'report', 'reported', 'research', 'result', 'results',
  'return', 'russia', 'russian', 'school', 'science', 'should', 'similar',
  'simply', 'social', 'something', 'sometimes', 'state', 'states',
  'strong', 'system', 'systems', 'taxes', 'technology', 'themselves',
  'there', 'these', 'things', 'though', 'through', 'together', 'towards',
  'under', 'understand', 'university', 'until', 'whether', 'which',
  'whether', 'while', 'world', 'would', 'years', 'yesterday',
])

/** 去连字符后的词是否像一个正常英文单词。 */
export function inDictionary(word: string): boolean {
  return WORDS.has(word.toLowerCase())
}
