/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gh: {
          bg: '#0f1419',
          fg: '#e7ecf1',
          muted: '#8b9aab',
          accent: '#3d9a6a',
          accentDim: '#2a6b4a',
          panel: '#1a222c',
          border: '#2a3544',
          warn: '#c9a227',
          danger: '#c45c5c',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(61, 154, 106, 0.12)',
      },
    },
  },
  plugins: [],
};
