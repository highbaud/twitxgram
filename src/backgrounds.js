'use strict';

/*
 * Curated background presets for the card container.
 *
 * Each preset is a CSS `background` value. Mesh presets layer several
 * radial-gradients to get that premium "designed share card" look with
 * zero asset files. Solid/linear presets are clean single statements.
 *
 * Resolution priority (highest first), handled in resolveBackground():
 *   1. backgroundImage   — an HTTPS URL the caller supplies
 *   2. background=<name>  — a curated preset from this file
 *   3. containerBackground — raw CSS escape hatch (hex / rgba / gradient)
 *   4. nothing            — a tasteful theme-aware default gradient
 */

const PRESETS = {
  // ── Mesh gradients (multi-radial, premium look) ──
  sunset: `
    radial-gradient(at 20% 20%, #ff6b6b 0px, transparent 50%),
    radial-gradient(at 80% 0%, #feca57 0px, transparent 50%),
    radial-gradient(at 80% 90%, #ff9ff3 0px, transparent 50%),
    radial-gradient(at 10% 90%, #ee5253 0px, transparent 50%),
    #ff7979`,
  ocean: `
    radial-gradient(at 0% 0%, #48dbfb 0px, transparent 50%),
    radial-gradient(at 90% 10%, #0abde3 0px, transparent 50%),
    radial-gradient(at 50% 100%, #006ba6 0px, transparent 50%),
    #1e90ff`,
  grape: `
    radial-gradient(at 10% 10%, #a55eea 0px, transparent 50%),
    radial-gradient(at 90% 30%, #8854d0 0px, transparent 50%),
    radial-gradient(at 50% 100%, #5f27cd 0px, transparent 50%),
    #6c5ce7`,
  forest: `
    radial-gradient(at 15% 20%, #26de81 0px, transparent 50%),
    radial-gradient(at 85% 25%, #20bf6b 0px, transparent 50%),
    radial-gradient(at 50% 95%, #0b8457 0px, transparent 50%),
    #10ac84`,
  midnight: `
    radial-gradient(at 20% 20%, #341f97 0px, transparent 50%),
    radial-gradient(at 80% 10%, #2c2c54 0px, transparent 50%),
    radial-gradient(at 60% 100%, #1e3799 0px, transparent 50%),
    #0c0c1e`,
  peach: `
    radial-gradient(at 10% 0%, #ffd3a5 0px, transparent 50%),
    radial-gradient(at 90% 100%, #fd6585 0px, transparent 50%),
    #ffb6a3`,
  mint: `
    radial-gradient(at 20% 10%, #d4fc79 0px, transparent 50%),
    radial-gradient(at 80% 90%, #96e6a1 0px, transparent 50%),
    #a8e6cf`,

  // ── Clean linear gradients ──
  twilight: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`,
  flamingo: `linear-gradient(135deg, #f093fb 0%, #f5576c 100%)`,
  citrus:   `linear-gradient(135deg, #f6d365 0%, #fda085 100%)`,
  sky:      `linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)`,
  slate:    `linear-gradient(135deg, #485563 0%, #29323c 100%)`,
  ember:    `linear-gradient(135deg, #ff512f 0%, #dd2476 100%)`,
  graphite: `linear-gradient(160deg, #232526 0%, #414345 100%)`,

  // ── Flat solids ──
  white: `#ffffff`,
  black: `#0f1419`,
  ash:   `#f0f2f5`,
  ink:   `#15202b`,
};

// Tasteful default when the caller supplies no background at all.
const DEFAULT_BACKGROUND = {
  light: PRESETS.sky,
  dark:  PRESETS.midnight,
};

function listPresets() {
  return Object.keys(PRESETS);
}

function isPreset(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, name.toLowerCase());
}

function getPreset(name) {
  return PRESETS[name.toLowerCase()];
}

/**
 * Resolve the final CSS `background` value for the container.
 * @param {object} opts - parsed request options
 * @param {string} theme - 'light' | 'dark'
 * @returns {string} CSS background value
 */
function resolveBackground(opts, theme) {
  // 1. Explicit image URL wins. Percent-escape quotes/parens so a crafted value
  //    can't break out of the CSS url('...') context. (SSRF/protocol validation
  //    happens upstream in the route via validateExternalUrl.)
  if (opts.backgroundImage) {
    const safe = String(opts.backgroundImage).replace(/'/g, '%27').replace(/[()]/g, encodeURIComponent);
    return `url('${safe}') center/cover no-repeat`;
  }
  // 1b. Saved custom background (background=custom:<id>) → inline its file as a
  //     data: URI (no network). Unknown id falls through to the default.
  if (typeof opts.background === 'string' && opts.background.startsWith('custom:')) {
    const uri = require('./backgroundStore').getDataUri(opts.background.slice(7));
    if (uri) return `url('${uri}') center/cover no-repeat`;
  }
  // 2. Named preset.
  if (opts.background && isPreset(opts.background)) {
    return getPreset(opts.background);
  }
  // 3. Raw CSS escape hatch (validated upstream; this is a no-op trust pass).
  if (opts.containerBackground) {
    return opts.containerBackground;
  }
  // 4. Tasteful theme-aware default.
  return DEFAULT_BACKGROUND[theme] || DEFAULT_BACKGROUND.light;
}

module.exports = { PRESETS, resolveBackground, listPresets, isPreset, getPreset };
