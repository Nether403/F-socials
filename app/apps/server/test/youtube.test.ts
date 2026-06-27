// extractVideoId handles the URL forms YouTube actually uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId } from '../src/providers/youtube';

test('parses common YouTube URL shapes', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(extractVideoId(`https://youtube.com/watch?v=${id}&t=30s`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId(`https://m.youtube.com/watch?v=${id}`), id);
});

test('returns null for non-YouTube or malformed URLs', () => {
  assert.equal(extractVideoId('https://example.com/watch?v=abc'), null);
  assert.equal(extractVideoId('not a url'), null);
  assert.equal(extractVideoId('https://www.youtube.com/'), null);
});
