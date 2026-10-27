# Cada N segundos escribe una línea JSON con la ventana activa y los segundos
# sin actividad de teclado/ratón. Lo lanza windows-window-source.ts.
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
"@

while ($true) {
  # Si el agente muere, este proceso no se queda huérfano.
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }

  $app = ''
  $title = ''
  $hwnd = [ContadorNative]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][ContadorNative]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    $procId = [uint32]0
    [void][ContadorNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) { $app = $proc.ProcessName }
  }

  $sample = @{
    app         = $app
    title       = $title
    idleSeconds = [math]::Floor([ContadorNative]::IdleMilliseconds() / 1000)
  }
  [Console]::Out.WriteLine(($sample | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds $IntervalSeconds
}
