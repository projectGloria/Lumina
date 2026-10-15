// @ts-check
/**
 * Lint rules chosen for what they actually catch in this codebase.
 *
 * `AGENTS.md` says no linter is configured, and that was a reasonable position:
 * TypeScript strict mode does most of the work, `npm run typecheck` is the
 * gate, and a linter that argues about style trains people to stop reading its
 * output. What `tsc` structurally cannot see is React hook dependencies and
 * interactive elements with no keyboard route — and both produced real defects
 * here:
 *
 *   - an effect with an over-broad dependency array serialised the whole
 *     document on every keystroke (`Editor.tsx`);
 *   - an unstable dependency made a modal steal focus on every render
 *     (`useModalTrap.ts`);
 *   - the file explorer shipped as `<div onClick>` rows no keyboard could reach
 *     (`FileTree.tsx`);
 *   - a `Date` built inline invalidated a `useMemo` on every render
 *     (`CalendarWidget.tsx`) — found by this config, not by the manual review.
 *
 * So: those two plugins and nothing else. No `js.configs.recommended`, no
 * `tseslint.configs.recommended`. Both fire on this project's deliberate
 * idioms — the synchronous `require()` dispatcher in `src/main/index.ts` that
 * exists to run before `app.ready`, the literal BOM in the settings reader, the
 * documented empty `catch` blocks — and being loudly wrong about intentional
 * code is how a linter gets switched off.
 */
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'extension/**', '*.tsbuildinfo']
  },

  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser }
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      // The rule that would have caught two of this review's findings. A
      // warning rather than an error: a handful of effects intentionally omit
      // a dependency and carry a comment saying why.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',

      // Keyboard reachability. Warnings, because the remaining hits are modal
      // backdrops and event-delegation surfaces where clicking is a
      // convenience and Escape or a real control is the actual route — worth
      // seeing, not worth failing a build over.
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',

      // These are errors: broken ARIA is worse than no ARIA, because it lies to
      // a screen reader rather than merely telling it nothing.
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error'
    }
  }
)
