// Envía al agente local el dominio de la pestaña activa del navegador.
// Solo el dominio: nunca la URL completa ni el contenido de la página.
const AGENT_URL = 'http://127.0.0.1:5611/browser';

async function report() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  // Si este navegador no tiene el foco no decimos nada: el agente ya sabe qué app está activa.
  if (!win?.focused) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
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

chrome.tabs.onActivated.addListener(report);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) report();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) report();
});

// Latido cada 30 s para que el agente sepa que el dato sigue vigente.
chrome.alarms.get('heartbeat').then((alarm) => {
  if (!alarm) chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') report();
});
