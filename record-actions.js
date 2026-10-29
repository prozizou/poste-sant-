// Les identifiants provenant de Firebase restent des données, jamais du code
// JavaScript intégré aux attributs onclick. Les actions autorisées sont locales.
export function bindRecordActions(root, actions) {
  const dispatch = event => {
    const node = event.target.closest?.('[data-record-action]');
    if (!node || !root.contains(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return;
    if (event.type === 'keydown') {
      if (!['Enter', ' '].includes(event.key) || node.matches('button, a, input, select, textarea')) return;
      event.preventDefault();
    }
    const action = Object.hasOwn(actions, node.dataset.recordAction) && actions[node.dataset.recordAction];
    if (typeof action !== 'function') return;
    event.stopPropagation();
    action(node.dataset.recordKey, node);
  };
  root.addEventListener('click', dispatch);
  root.addEventListener('keydown', dispatch);
  return () => {
    root.removeEventListener('click', dispatch);
    root.removeEventListener('keydown', dispatch);
  };
}
