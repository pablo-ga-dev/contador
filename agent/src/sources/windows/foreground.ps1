# Cada N segundos escribe una línea JSON con la ventana activa, los segundos
# sin actividad de teclado/ratón y, si es WhatsApp, el chat abierto.
# Lo lanza window-source.ts.
param(
  [int]$IntervalSeconds = 5,
  [int]$ParentPid = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ContadorNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

  public static uint IdleMilliseconds() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    GetLastInputInfo(ref info);
    return (uint)Environment.TickCount - info.dwTime;
  }
}

// API nativa de UI Automation (la de los lectores de pantalla). El cliente de .NET
// no ve el contenido WebView2 de WhatsApp; esta sí. Solo declaramos lo que usamos:
// los huecos _N mantienen el orden de la tabla de métodos COM.
[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IContadorUIA {
  void _0(); void _1(); void _2();
  IContadorUIAElement ElementFromHandle(IntPtr hwnd);
  void _4(); void _5(); void _6(); void _7(); void _8(); void _9(); void _10(); void _11(); void _12();
  IContadorUIAWalker GetRawViewWalker();
}

[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IContadorUIAElement {
  void _0(); void _1(); void _2(); void _3(); void _4(); void _5(); void _6();
  [return: MarshalAs(UnmanagedType.Struct)]
  object GetCurrentPropertyValue(int propertyId);
}

[ComImport, Guid("4042c624-389c-4afc-a630-9df854a541fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IContadorUIAWalker {
  void _0();
  IContadorUIAElement GetFirstChildElement(IContadorUIAElement element);
  void _2();
  IContadorUIAElement GetNextSiblingElement(IContadorUIAElement element);
}

public static class ContadorWhatsApp {
  const int ControlTypeProperty = 30003, NameProperty = 30005, AutomationIdProperty = 30011;
  const int TextControlType = 50020;
  // "main" aparece tras unos 70 elementos y el nombre del chat tras unos 7 dentro de él;
  // los límites evitan recorrer miles si WhatsApp cambia su estructura.
  const int MaxVisitedToMain = 400, MaxVisitedInMain = 40;
  static IContadorUIA uia;
  static IContadorUIAWalker walker;

  // WhatsApp para Windows es WhatsApp Web dentro de un WebView2. La conversación
  // abierta es el elemento "main" y, en orden de página, su primer texto es el nombre
  // del chat (en la cabecera). Nos guiamos por id, tipos y orden, no por clases CSS,
  // que cambian con cada versión. Usamos el walker y no FindFirst: FindFirst no entra
  // en el contenido de Chromium por id ni respeta el orden de la página.
  public static string OpenChat(IntPtr hwnd) {
    try {
      if (uia == null) {
        uia = (IContadorUIA)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
        walker = uia.GetRawViewWalker();
      }
      var main = FindById(uia.ElementFromHandle(hwnd), "main");
      if (main == null) return "";
      int visited = 0;
      var text = FirstText(main, ref visited);
      if (text == null) return "";
      return (text.GetCurrentPropertyValue(NameProperty) as string) ?? "";
    } catch {
      // Si WhatsApp cambia su estructura, seguimos contando sin chat.
      return "";
    }
  }

  // Primer texto en orden de página (en profundidad).
  static IContadorUIAElement FirstText(IContadorUIAElement el, ref int visited) {
    if (++visited > MaxVisitedInMain) return null;
    if ((el.GetCurrentPropertyValue(ControlTypeProperty) as int?) == TextControlType) return el;
    for (var c = walker.GetFirstChildElement(el); c != null; c = walker.GetNextSiblingElement(c)) {
      var found = FirstText(c, ref visited);
      if (found != null) return found;
    }
    return null;
  }

  // Búsqueda por niveles: "main" está cerca de la raíz.
  static IContadorUIAElement FindById(IContadorUIAElement root, string id) {
    var queue = new System.Collections.Generic.Queue<IContadorUIAElement>();
    queue.Enqueue(root);
    for (int visited = 0; queue.Count > 0 && visited < MaxVisitedToMain; visited++) {
      var el = queue.Dequeue();
      if ((el.GetCurrentPropertyValue(AutomationIdProperty) as string) == id) return el;
      for (var c = walker.GetFirstChildElement(el); c != null; c = walker.GetNextSiblingElement(c)) queue.Enqueue(c);
    }
    return null;
  }
}
"@

while ($true) {
  # Si el agente muere, este proceso no se queda huérfano.
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }

  $app = ''
  $title = ''
  $chat = ''
  $hwnd = [ContadorNative]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][ContadorNative]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    $procId = [uint32]0
    [void][ContadorNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) { $app = $proc.ProcessName }
    if ($app -eq 'WhatsApp.Root') { $chat = [ContadorWhatsApp]::OpenChat($hwnd) }
  }

  $sample = @{
    app         = $app
    title       = $title
    chat        = $chat
    idleSeconds = [math]::Floor([ContadorNative]::IdleMilliseconds() / 1000)
  }
  [Console]::Out.WriteLine(($sample | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds $IntervalSeconds
}
