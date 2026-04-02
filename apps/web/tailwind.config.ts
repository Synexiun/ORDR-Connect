import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#060608',
        brand: {
          primary: '#060608',
          accent: '#fbbf24',
          'accent-hover': '#f59e0b',
          danger: '#ef4444',
          'danger-hover': '#dc2626',
          success: '#10b981',
          warning: '#f59e0b',
        },
        surface: {
          DEFAULT: '#0d0d12',
          secondary: '#0d0d12',
          tertiary: '#111118',
          elevated: '#131318',
          overlay: 'rgba(0, 0, 0, 0.7)',
        },
        content: {
          DEFAULT: '#f1f5f9',
          secondary: '#94a3b8',
          tertiary: '#475569',
          inverse: '#060608',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          light: 'rgba(255,255,255,0.10)',
          focus: 'rgba(251,191,36,0.40)',
        },
        kpi: {
          blue: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
          purple: '#a855f7',
          amber: '#fbbf24',
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
      borderWidth: {
        '3': '3px',
      },
      boxShadow: {
        kpi: '0 1px 3px 0 rgba(0, 0, 0, 0.5)',
        'card-hover': '0 4px 20px 0 rgba(0, 0, 0, 0.6)',
        'glow-amber': '0 0 20px rgba(251,191,36,0.10)',
        'glow-blue': '0 0 12px rgba(59, 130, 246, 0.10)',
        'glow-green': '0 0 12px rgba(16, 185, 129, 0.10)',
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
