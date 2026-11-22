// ==> Section 1 - Picker State And Events <==
import { normalizeHex, hexToRgb, rgbToHex, hexToHsl, hslToHex } from './colors.js';
export class ColorPicker {
  constructor(elements, onModeChange) {
    this.elements = elements;
    this.onModeChange = onModeChange;
    this.dialog = elements['color-dialog'];
    elements['color-mode'].onchange = () => {
      this.mode = elements['color-mode'].value;
      this.renderFields();
      this.onModeChange(this.mode);
    };
    for (const input of this.dialog.querySelectorAll('.color-values input')) input.oninput = () => this.readFields();
    for (const input of this.dialog.querySelectorAll('input[type=range]')) input.oninput = () => {
      this.color = hslToHex(this.sliders.map(slider => slider.value));
      this.renderFields(false);
    };
    elements['color-form'].onsubmit = event => {
      event.preventDefault();
      if (this.readFields()) this.dialog.close('apply');
    };
    elements['color-cancel'].onclick = () => this.dialog.close('cancel');
    this.dialog.onclose = () => {
      this.resolve?.(this.dialog.returnValue === 'apply' ? this.color : null);
      this.resolve = null;
    };
  }
  get sliders() { return ['hue', 'saturation', 'lightness'].map(name => this.elements[`color-${name}`]); }
  open(preferences) {
    this.color = preferences.lastColor;
    this.mode = preferences.colorMode;
    this.elements['color-mode'].value = this.mode;
    this.renderFields();
    this.dialog.returnValue = '';
    this.dialog.showModal();
    this.dialog.querySelector('.color-values:not([hidden]) input').focus();
    return new Promise(resolve => { this.resolve = resolve; });
  }

  // ==> Section 2 - Input Validation And Preview <==
  readFields() {
    try {
      const values = [...this.elements[`color-${this.mode}-fields`].querySelectorAll('input')].map(input => input.value);
      this.color = this.mode === 'hex' ? normalizeHex(values[0]) : this.mode === 'rgb' ? rgbToHex(values) : hslToHex(values);
      this.elements['color-error'].textContent = '';
      this.renderPreview(true);
      return true;
    } catch (error) {
      this.elements['color-error'].textContent = error.message;
      return false;
    }
  }
  renderFields(updateSliders = true) {
    for (const mode of ['hex', 'rgb', 'hsl']) this.elements[`color-${mode}-fields`].hidden = mode !== this.mode;
    const values = this.mode === 'hex' ? [this.color] : this.mode === 'rgb' ? hexToRgb(this.color) : hexToHsl(this.color);
    [...this.elements[`color-${this.mode}-fields`].querySelectorAll('input')].forEach((input, index) => { input.value = values[index]; });
    this.elements['color-error'].textContent = '';
    this.renderPreview(updateSliders);
  }
  renderPreview(updateSliders) {
    this.elements['color-preview'].style.backgroundColor = this.color;
    this.elements['color-preview-value'].textContent = this.color;
    const hsl = updateSliders ? hexToHsl(this.color) : this.sliders.map(slider => Number(slider.value));
    if (updateSliders) this.sliders.forEach((slider, index) => { slider.value = hsl[index]; });
    this.elements['color-saturation'].style.background = `linear-gradient(to right, hsl(${hsl[0]} 0% 50%), hsl(${hsl[0]} 100% 50%))`;
    this.elements['color-lightness'].style.background = `linear-gradient(to right, #000, hsl(${hsl[0]} ${hsl[1]}% 50%), #fff)`;
  }
}
