import coreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  ...coreWebVitals,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
]
