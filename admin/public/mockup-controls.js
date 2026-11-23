import { mockupDetailFields, resolveMockupDetails } from './vendor/mockup/mockup-options.js';

export function createMockupControls(panel) {
  const controls = Object.entries(mockupDetailFields).map(([key, spec]) => {
    const id = key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
    const input = panel.querySelector('#' + id);
    const automatic = panel.querySelector('#auto-' + id);
    if (spec.type === 'number') {
      input.min = spec.min;
      input.max = spec.max;
    }
    return { key, spec, input, automatic };
  });
  const groups = panel.querySelectorAll('fieldset[data-bindings], fieldset[data-stitch], fieldset[data-enabled-by]');
  const stitch = panel.querySelector('#stitch-type');

  function update(binding) {
    for (const { input, automatic } of controls) {
      if (automatic) input.disabled = automatic.checked;
    }
    for (const group of groups) {
      const { bindings, stitch: material, enabledBy } = group.dataset;
      const show = (!bindings || bindings.split(' ').includes(binding))
        && (!material || binding !== 'saddle-stitch' || material.split(' ').includes(stitch.value))
        && (!enabledBy || panel.querySelector('#' + enabledBy).checked)
        && !group.parentElement.closest('fieldset[hidden]');
      group.hidden = !show;
      group.disabled = !show;
    }
  }

  function write(value) {
    const details = resolveMockupDetails(value);
    for (const { key, spec, input, automatic } of controls) {
      if (automatic) automatic.checked = details[key] == null;
      if (spec.type === 'boolean') input.checked = details[key];
      else input.value = details[key] ?? input.defaultValue;
    }
  }

  function read() {
    const details = {};
    for (const { key, spec, input, automatic } of controls) {
      if (automatic?.checked) details[key] = null;
      else if (spec.type === 'boolean') details[key] = input.checked;
      else if (spec.type === 'number') details[key] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
      else details[key] = input.value;
    }
    return resolveMockupDetails(details);
  }

  function hasChanges(value) {
    return controls.some(({ key, spec }) => (value?.[key] ?? spec.default) !== spec.default);
  }

  return { update, write, read, hasChanges };
}
