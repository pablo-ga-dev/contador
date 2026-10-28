// Tema elegido en Ajustes (claro u oscuro); sin elegir, el del sistema. Se carga en <head>,
// antes de pintar, para que la página no parpadee con el otro tema.
try {
  const theme = localStorage.getItem('dialogue-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Sin almacenamiento (p. ej. bloqueado): se queda el del sistema.
}

/** Cambia el tema: 'light', 'dark' o 'auto' (el del sistema). */
window.setTheme = (theme) => {
  try {
    if (theme === 'auto') localStorage.removeItem('dialogue-theme');
    else localStorage.setItem('dialogue-theme', theme);
  } catch {
    // Se aplica igual, aunque no se recuerde.
  }
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};
window.currentTheme = () => document.documentElement.dataset.theme ?? 'auto';

/** Pinta en `container` los botones Automático / Claro / Oscuro (para Ajustes). */
window.mountThemePicker = (container) => {
  const options = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']];
  container.className = 'theme-choice';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Tema');
  const buttons = options.map(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (value === 'auto') button.title = 'Como el sistema';
    button.addEventListener('click', () => {
      window.setTheme(value);
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === value)));
    });
    button.setAttribute('aria-pressed', String(window.currentTheme() === value));
    return button;
  });
  container.replaceChildren(...buttons);
};
