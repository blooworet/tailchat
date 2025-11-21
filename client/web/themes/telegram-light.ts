import type { ThemeSpec } from '../../shared/theme/types';

const spec: ThemeSpec = {
  vars: {
    /* Motion scale (0-1) */
    '--tc-motion-scale': '1',

    /* Chat bubble tokens (Light) */
    '--tc-bubble-radius': '16px',
    '--tc-bubble-bg': 'rgba(240, 244, 248, 0.7)',
    '--tc-bubble-bg-self': 'rgba(74, 162, 242, 0.12)',
    '--tc-bubble-tail-bg': 'rgba(240, 244, 248, 0.7)',
    '--tc-bubble-tail-bg-self': 'rgba(240, 244, 248, 0.7)',
    '--tc-bubble-hover-shadow': '0 2px 10px rgba(0,0,0,.08)',
    '--tc-color-primary': '#4aa2f2',
    '--tc-input-radius': '1.5rem', /* ~ rounded-3xl */
    '--tc-surface-shadow': '0 10px 15px rgba(0,0,0,0.06)',
    '--tc-icon-button-size': '3rem', /* 48px */

    /* Banner */
    '--tc-banner-bg': 'linear-gradient(to right, rgba(247, 249, 251, 0.95), rgba(255, 255, 255, 0.9))',
    '--tc-banner-border': 'rgba(15, 20, 25, 0.08)',
    '--tc-banner-icon-bg': 'rgba(74, 162, 242, 0.15)',
    '--tc-banner-icon-color': '#4aa2f2',
    '--tc-banner-title-color': '#0f1419',
    '--tc-banner-subtitle-color': '#5b7083',
    '--tc-banner-button-bg': '#4aa2f2',
    '--tc-banner-close-hover-bg': 'rgba(74, 162, 242, 0.1)',

    /* Audio glow/filters */
    '--tc-audio-player-filter': 'drop-shadow(0 0 20px rgba(74, 162, 242, 0.1))',
    '--tc-audio-player-filter-hover': 'drop-shadow(0 0 25px rgba(74, 162, 242, 0.15))',
    '--tc-audio-play-btn-filter': 'drop-shadow(0 0 15px rgba(74, 162, 242, 0.3))',

    /* Audio component tokens (Telegram Light) */
    '--tc-audio-bg': 'rgba(74, 162, 242, 0.1)',
    '--tc-audio-bg-own': 'rgba(74, 162, 242, 0.15)',
    '--tc-audio-border': 'rgba(74, 162, 242, 0.3)',
    '--tc-audio-border-own': 'rgba(74, 162, 242, 0.4)',
    '--tc-audio-text': '#4aa2f2',
    '--tc-audio-text-secondary': 'rgba(74, 162, 242, 0.8)',
    '--tc-audio-waveform-fill': 'rgba(74, 162, 242, 0.5)',
    '--tc-audio-waveform-progress': '#4aa2f2',
    '--tc-audio-waveform-own-fill': 'rgba(74, 162, 242, 0.7)',
    '--tc-audio-waveform-own-progress': '#0088cc',
    '--tc-audio-btn-bg': '#4aa2f2',
    '--tc-audio-btn-bg-own': '#0088cc',
    '--tc-audio-btn-hover': '#0088cc',
    '--tc-audio-btn-hover-own': '#006699',
    '--tc-audio-btn-text': '#FFFFFF',
    '--tc-audio-btn-disabled': 'rgba(74, 162, 242, 0.3)',
    '--tc-audio-loading': '#6B7280',
    '--tc-audio-error': '#F87171',
    '--tc-audio-success': '#10B981',
    '--tc-audio-hover': 'rgba(74, 162, 242, 0.1)',
    '--tc-audio-active': 'rgba(74, 162, 242, 0.2)',
    '--tc-audio-focus': 'rgba(74, 162, 242, 0.35)',
  },
};

export default spec;
