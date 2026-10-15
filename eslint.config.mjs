// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

// Flat config (shared with beacon).
// - No `parserOptions.project`: none of the enabled rules are type-aware, and
//   tsconfig.json excludes *.spec.ts, so it only produced parsing errors there.
// - No `env: { node, jest }`: only core rules such as no-undef read globals,
//   and none are enabled (TypeScript checks undefined identifiers).
export default [
  { ignores: ['eslint.config.mjs'] },
  ...tsPlugin.configs['flat/recommended'],
  prettierRecommended,
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `import x = require('cjs')` is valid TypeScript for CommonJS modules.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      // Allow `const { omitted: _x, ...rest } = obj` to drop a key, `_arg` for unused params.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
    },
  },
];
