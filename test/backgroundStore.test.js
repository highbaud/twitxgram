'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseImageDataUri } = require('../src/backgroundStore');

// a 1px transparent PNG
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

test('parseImageDataUri: accepts a valid image data URI', () => {
  const { mime, buffer } = parseImageDataUri(PNG_1PX);
  assert.strictEqual(mime, 'image/png');
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0);
});

test('parseImageDataUri: accepts jpeg/webp/avif/gif mime types', () => {
  for (const t of ['jpeg', 'jpg', 'webp', 'avif', 'gif']) {
    assert.doesNotThrow(() => parseImageDataUri(`data:image/${t};base64,AAAA`));
  }
});

test('parseImageDataUri: rejects non-image / malformed input', () => {
  assert.throws(() => parseImageDataUri('https://x.com/a.png'), /valid base64 image/);
  assert.throws(() => parseImageDataUri('data:text/html;base64,AAAA'), /valid base64 image/);
  assert.throws(() => parseImageDataUri('data:image/png;base64,'), /valid base64 image/);
  assert.throws(() => parseImageDataUri('data:image/svg+xml;base64,AAAA'), /valid base64 image/); // svg can carry script — excluded
  assert.throws(() => parseImageDataUri(''), /valid base64 image/);
  assert.throws(() => parseImageDataUri(null), /valid base64 image/);
});
