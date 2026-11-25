// ==> Section 1 - Color Conversion And Preferences <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, hexToRgb, rgbToHex, hexToHsl, hslToHex, colorPreferences } from '../src/colors.js';
import { DocumentStore } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('hex accepts an optional hash, short form, case and whitespace', () => {
  assert.equal(normalizeHex(' fF0 '), '#ffff00');
  assert.equal(normalizeHex('#E6A050'), '#e6a050');
  for (const value of ['', '#', '1234', '12345678', 'red', '##fff', '<script>']) assert.throws(() => normalizeHex(value));
});

test('RGB and HSL convert known colors and preserve exact RGB on round trips', () => {
  assert.equal(hslToHex([120, 100, 50]), '#00ff00');
  assert.equal(hslToHex([360, 100, 50]), '#ff0000');
  assert.equal(rgbToHex([230, 160, 80]), '#e6a050');
  for (const color of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#e6a050', '#123456', '#010203']) {
    assert.equal(rgbToHex(hexToRgb(color)), color);
    assert.equal(hslToHex(hexToHsl(color)), color);
  }
});

test('invalid or incomplete numeric color values are rejected', () => {
  for (const values of [[-1, 0, 0], [256, 0, 0], ['', 0, 0], [0.5, 0, 0], [NaN, 0, 0]]) assert.throws(() => rgbToHex(values));
  for (const values of [[361, 0, 50], [0, 101, 50], [0, 0, -1], ['', 0, 50]]) assert.throws(() => hslToHex(values));
});

test('color and mode survive session restoration independently of documents', async () => {
  const backend = backendFixture();
  const original = new DocumentStore(backend);
  original.preferences = { lastColor: '#123456', colorMode: 'hsl' };
  await original.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.deepEqual(restored.preferences, { ...original.preferences, dismissedPrompts: {} });
  assert.deepEqual(colorPreferences({ lastColor: 'bad value', colorMode: 'invalid' }), { lastColor: '#e6a050', colorMode: 'hex' });
  await backend.saveSession({ version: 2, documents: [] });
  const legacy = new DocumentStore(backend);
  await legacy.restore();
  assert.deepEqual(legacy.preferences, { ...colorPreferences(), dismissedPrompts: {} });
});
