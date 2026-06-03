'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resolveBackground, listPresets, isPreset, getPreset } = require('../src/backgrounds');

test('resolveBackground: priority order', () => {
  // 1. backgroundImage wins over everything
  const img = resolveBackground(
    { backgroundImage: 'https://x.com/a.png', background: 'sunset', containerBackground: '#fff' },
    'light'
  );
  assert.ok(img.startsWith("url('https://x.com/a.png')"));

  // 2. preset over raw CSS
  assert.strictEqual(
    resolveBackground({ background: 'sunset', containerBackground: '#fff' }, 'light'),
    getPreset('sunset')
  );

  // 3. raw CSS escape hatch
  assert.strictEqual(resolveBackground({ containerBackground: '#abc' }, 'light'), '#abc');

  // 4. theme default
  assert.strictEqual(resolveBackground({}, 'light'), getPreset('sky'));
  assert.strictEqual(resolveBackground({}, 'dark'), getPreset('midnight'));
});

test('resolveBackground: escapes quotes/parens in image URL', () => {
  const out = resolveBackground({ backgroundImage: "https://x.com/a.png')+evil(" }, 'light');
  assert.ok(!out.includes("')+evil("), 'raw breakout sequence must not survive');
  assert.ok(out.includes('%27'), 'single quote should be percent-escaped');
});

test('preset helpers', () => {
  assert.ok(listPresets().includes('sunset'));
  assert.ok(isPreset('SUNSET'));         // case-insensitive
  assert.ok(!isPreset('does-not-exist'));
});
