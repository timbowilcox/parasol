import coreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  ...coreWebVitals,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Block console.log per CLAUDE.md but allow warn/error/info as
      // server-side observability primitives.
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
]
