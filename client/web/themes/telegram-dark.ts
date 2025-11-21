import type { ThemeSpec } from '../../shared/theme/types';

const spec: ThemeSpec = {
  vars: {
    /* Motion scale (0-1) */
    '--tc-motion-scale': '1',

    /* Chat bubble tokens (Dark) */
    '--tc-bubble-radius': '16px',
    '--tc-bubble-bg': 'rgba(20, 25, 30, 0.6)',
    '--tc-bubble-bg-self': 'rgba(58, 126, 212, 0.16)',
    '--tc-bubble-tail-bg': 'rgba(20, 25, 30, 0.6)',
    '--tc-bubble-tail-bg-self': 'rgba(20, 25, 30, 0.6)',
    '--tc-bubble-hover-shadow': '0 2px 10px rgba(0,0,0,.35)',
    '--tc-input-radius': '1.5rem', /* ~ rounded-3xl */
    '--tc-surface-shadow': '0 10px 15px rgba(0,0,0,0.10)',
    '--tc-icon-button-size': '3rem', /* 48px */

    /* Banner (dark) */
    '--tc-banner-bg': 'linear-gradient(to right, #1e293b, #0f172a)',
    '--tc-banner-border': 'rgba(148, 163, 184, 0.2)',
    '--tc-banner-icon-bg': '#334155',
    '--tc-banner-icon-color': '#60a5fa',
    '--tc-banner-title-color': '#f1f5f9',
    '--tc-banner-subtitle-color': '#cbd5e1',
    '--tc-banner-button-bg': '#3b82f6',
    '--tc-banner-close-hover-bg': '#475569',

    /* Audio glow/filters */
    '--tc-audio-player-filter': 'drop-shadow(0 0 20px rgba(74, 162, 242, 0.1))',
    '--tc-audio-player-filter-hover': 'drop-shadow(0 0 25px rgba(74, 162, 242, 0.15))',
    '--tc-audio-play-btn-filter': 'drop-shadow(0 0 15px rgba(74, 162, 242, 0.3))',

    /* Audio component tokens (Telegram Dark) */
    '--tc-audio-bg': 'rgba(74, 162, 242, 0.1)',
    '--tc-audio-bg-own': 'rgba(74, 162, 242, 0.15)',
    '--tc-audio-border': 'rgba(74, 162, 242, 0.3)',
    '--tc-audio-border-own': 'rgba(74, 162, 242, 0.4)',
    '--tc-audio-text': '#dbeafe',
    '--tc-audio-text-secondary': 'rgba(191, 219, 254, 0.85)',
    '--tc-audio-waveform-fill': 'rgba(74, 162, 242, 0.5)',
    '--tc-audio-waveform-progress': '#60a5fa',
    '--tc-audio-waveform-own-fill': 'rgba(74, 162, 242, 0.7)',
    '--tc-audio-waveform-own-progress': '#93c5fd',
    '--tc-audio-btn-bg': '#60a5fa',
    '--tc-audio-btn-bg-own': '#3b82f6',
    '--tc-audio-btn-hover': '#3b82f6',
    '--tc-audio-btn-hover-own': '#2563eb',
    '--tc-audio-btn-text': '#FFFFFF',
    '--tc-audio-btn-disabled': 'rgba(74, 162, 242, 0.3)',
    '--tc-audio-loading': '#9CA3AF',
    '--tc-audio-error': '#F87171',
    '--tc-audio-success': '#34D399',
    '--tc-audio-hover': 'rgba(255, 255, 255, 0.05)',
    '--tc-audio-active': 'rgba(255, 255, 255, 0.1)',
    '--tc-audio-focus': 'rgba(96, 165, 250, 0.35)',
  },
};

export default spec;
