// Cada N segundos escribe una línea JSON con la app activa, el título de su ventana
// y los segundos sin teclado ni ratón. Lo lanza window-source.ts en macOS:
//   osascript -l JavaScript foreground.js <segundos> <pid del agente>
//
// El nombre de la app y la inactividad no necesitan permisos. El título de la ventana
// sí: Ajustes del Sistema > Privacidad y seguridad > Accesibilidad. Sin él, el título
// va vacío y se sigue contando por app (y por web, gracias a la extensión).
// El chat de WhatsApp aún no se detecta en Mac.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

const ANY_INPUT_EVENT = 0xFFFFFFFF; // kCGAnyInputEventType
const COMBINED_SESSION_STATE = 0; // kCGEventSourceStateCombinedSessionState

function writeLine(text) {
  const data = $(text + '\n').dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

/** Si el agente muere, este proceso no se queda huérfano. */
function parentAlive(app, pid) {
  if (!pid) return true;
  try {
    app.doShellScript('kill -0 ' + pid);
    return true;
  } catch (e) {
    return false;
  }
}

function focusedWindowTitle(events, pid) {
  try {
    const proc = events.processes.whose({ unixId: pid })[0];
    const win = proc.attributes.byName('AXFocusedWindow').value();
    return win ? String(win.name() || '') : '';
  } catch (e) {
    return ''; // Sin permiso de Accesibilidad, o la app no tiene ventana.
  }
}

function run(argv) {
  const interval = Number(argv[0]) || 5;
  const parentPid = Number(argv[1]) || 0;
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const events = Application('System Events');

  while (parentAlive(app, parentPid)) {
    const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    const name = front.isNil() ? '' : ObjC.unwrap(front.localizedName) || '';
    const title = name ? focusedWindowTitle(events, front.processIdentifier) : '';
    const idle = $.CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT);
    writeLine(JSON.stringify({ app: name, title: title, chat: '', idleSeconds: Math.floor(idle) }));
    // Esperamos girando el bucle de eventos (y no con delay()): si no, macOS no
    // actualiza la app activa en un proceso que no es una app.
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(interval));
  }
}
