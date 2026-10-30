// Envía al agente local el dominio de la pestaña activa del navegador.
// Solo el dominio: nunca la URL completa ni el contenido de la página.
// La misma extensión vale para Chrome, Edge, Firefox y Safari.
const AGENT_URL = 'http://127.0.0.1:5611/browser';
// Firefox y Safari usan `browser` (con promesas); Chrome y Edge, `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;

async function report() {
  const win = await ext.windows.getLastFocused().catch(() => null);
  // Si este navegador no tiene el foco no decimos nada: el agente ya sabe qué app está activa.
  // (Si el navegador no dice si tiene el foco, se envía igual: el agente solo lo usa con el navegador delante.)
  if (!win || win.focused === false) return;
  const [tab] = await ext.tabs.query({ active: true, windowId: win.id });
  if (!tab) return;

  let domain = null;
  try {
    const url = new URL(tab.url ?? '');
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      domain = url.hostname.replace(/^www\./, '');
    }
  } catch {
    // URL vacía o especial (chrome://, about:blank...): sin dominio.
  }

  await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Contador': '1' },
    body: JSON.stringify({ domain }),
  }).catch(() => {
    // Agente apagado: no pasa nada, se reintentará en el siguiente aviso.
  });
}

ext.tabs.onActivated.addListener(report);
ext.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) report();
});
ext.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== ext.windows.WINDOW_ID_NONE) report();
});

// Latido cada 30 s para que el agente sepa que el dato sigue vigente.
ext.alarms.get('heartbeat').then((alarm) => {
  if (!alarm) ext.alarms.create('heartbeat', { periodInMinutes: 0.5 });
});
ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') report();
});
