// ==> Section 1 - Color Values <==
export const defaultColorPreferences = { lastColor: '#e6a050', colorMode: 'hex' };
export function normalizeHex(value) {
  const hex = String(value).trim().replace(/^#/, '').toLowerCase();
  if (/^[\da-f]{3}$/.test(hex)) return '#' + [...hex].map(character => character.repeat(2)).join('');
  if (/^[\da-f]{6}$/.test(hex)) return '#' + hex;
  throw new Error('Enter 3 or 6 hexadecimal digits. The # is optional.');
}
export function colorPreferences(value) {
  let lastColor = defaultColorPreferences.lastColor;
  try { lastColor = normalizeHex(value?.lastColor); } catch { /* Keep the default if recovery settings are invalid. */ }
  return { lastColor, colorMode: ['hex', 'rgb', 'hsl'].includes(value?.colorMode) ? value.colorMode : 'hex' };
}
function channel(value, maximum, label, integer = false) {
  if (String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maximum || (integer && !Number.isInteger(Number(value)))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between 0 and ${maximum}.`);
  return Number(value);
}
export function rgbToHex(values) {
  return '#' + values.map((value, index) => channel(value, 255, ['Red', 'Green', 'Blue'][index], true).toString(16).padStart(2, '0')).join('');
}
export function hexToRgb(value) {
  const hex = normalizeHex(value);
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}
export function hslToHex(values) {
  const hue = channel(values[0], 360, 'Hue') % 360 / 60;
  const saturation = channel(values[1], 100, 'Saturation') / 100;
  const lightness = channel(values[2], 100, 'Lightness') / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
  const offset = lightness - chroma / 2;
  const sectors = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary], [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]];
  return rgbToHex(sectors[Math.floor(hue)].map(value => Math.round((value + offset) * 255)));
}
export function hexToHsl(value) {
  const [red, green, blue] = hexToRgb(value).map(channelValue => channelValue / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation = difference === 0 ? 0 : difference / (1 - Math.abs(2 * lightness - 1));
  const hue = difference === 0 ? 0 : maximum === red ? ((green - blue) / difference + 6) % 6 : maximum === green ? (blue - red) / difference + 2 : (red - green) / difference + 4;
  return [hue * 60, saturation * 100, lightness * 100].map(channelValue => Math.round(channelValue * 100) / 100);
}
