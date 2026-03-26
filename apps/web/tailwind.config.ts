import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0f172a',
          accent: '#2563eb',
          'accent-hover': '#1d4ed8',
          danger: '#dc2626',
          'danger-hover': '#b91c1c',
          success: '#059669',
          warning: '#f59e0b',
        },
        surface: {
          DEFAULT: '#0f172a',
          secondary: '#1e293b',
          tertiary: '#334155',
          elevated: '#1e293b',
          overlay: 'rgba(0, 0, 0, 0.6)',
        },
        content: {
          DEFAULT: '#f8fafc',
          secondary: '#94a3b8',
          tertiary: '#64748b',
          inverse: '#0f172a',
        },
        border: {
          DEFAULT: '#334155',
          light: '#475569',
          focus: '#2563eb',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
