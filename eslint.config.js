import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 只收「tsc 管不到、但踩过坑」的规则：
 *   - `no-explicit-any`：类型口子（本仓库目前是 0，别开第一例）；
 *   - `react-hooks/rules-of-hooks`：条件调用 hook 会在运行期炸，tsc 看不出来；
 *   - `react-hooks/exhaustive-deps`：与「一个状态一个写入方」直接相关，先告警不拦；
 *   - `no-empty`：空 catch 必须写理由（TESTING §3-16）。
 * 风格类（缩进 / 引号 / 分号）不进来：仓库已经有固定写法，别为了 lint 改一遍历史代码。
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'public/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      // tsc 已经用 noUnusedLocals / noUnusedParameters 拦了，别报两遍
      '@typescript-eslint/no-unused-vars': 'off',
      // 允许 `catch {}` 但必须紧跟注释说明降级理由（TESTING §3-16）；这里只拦完全空的块
      'no-empty': ['error', { allowEmptyCatch: false }],
      // `let [a, b, c] = …` 里只有一个会被重新赋值时，拆成 const 反而更啰嗦
      'prefer-const': ['error', { destructuring: 'all' }],
      // 正则字符类里的 `\-` / `\[` 是防歧义写法；这条纯风格，不为它改解析器
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/reader/testStorage.ts', 'src/core/testFixtures.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },
)
