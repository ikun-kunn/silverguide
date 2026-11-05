/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        sg: {
          bg: 'var(--sg-bg)',
          surface: 'var(--sg-surface)',
          ink: 'var(--sg-ink)',
          muted: 'var(--sg-muted)',
          primary: 'var(--sg-primary)',
          'primary-ink': 'var(--sg-primary-ink)',
          border: 'var(--sg-border)',
          warn: 'var(--sg-warn)',
        },
      },
      minHeight: {
        tap: '48px',
      },
    },
  },
  plugins: [],
};
