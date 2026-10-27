# Contador

Contabiliza automáticamente el tiempo que dedicas a cada proyecto, sin tener que
apuntar nada a mano.

> **Estado: fase 1.** El agente ya registra qué aplicación y qué dominio usas y
> durante cuánto tiempo. Todavía no asigna ese tiempo a proyectos ni lo sube a
> ninguna web.

## Cómo funciona

```
┌──────────────────────┐   dominio de la     ┌────────────────────────────┐
│ Extensión navegador  │ ── pestaña activa ─▶│ Agente (Node, sin ventana) │
│ (Chrome, Edge...)    │   127.0.0.1:5611    │                            │
└──────────────────────┘                     │  Tracker ─▶ SQLite local   │
┌──────────────────────┐  ventana activa +   │                            │
│ PowerShell + API de  │ ── inactividad ────▶│                            │
│ Windows              │   cada 5 s          └────────────────────────────┘
└──────────────────────┘
```

- **Ventana activa e inactividad**: cada 5 segundos se mira qué aplicación está
  delante y cuánto llevas sin tocar teclado ni ratón. Tras 3 minutos sin
  actividad se deja de contar (y se descuentan esos minutos).
- **Dominios**: la extensión avisa al agente del dominio de la pestaña activa
  cuando cambias de pestaña y cada 30 segundos.
- **Tramos**: mientras sigas en la misma ventana y dominio, se alarga el tramo
  actual; al cambiar, empieza otro. Se guardan en
  `%LOCALAPPDATA%\contador\contador.db`.

## Requisitos

- Windows 10/11
- [Node.js](https://nodejs.org) 22.18 o superior

## Uso

```bash
npm install
npm start
```

Para ver el resumen del día (en otra terminal, con el agente en marcha o no):

```bash
npm run report
```

O de un día concreto: `npm run report 2026-10-27`.

### Instalar la extensión del navegador

1. Abre `chrome://extensions` (o `edge://extensions` en Edge).
2. Activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension` de este repositorio.

Sin la extensión el agente funciona igual, pero no sabrá en qué dominio estás.

## Privacidad

- Todo se guarda **solo en tu equipo**. El agente escucha únicamente en
  `127.0.0.1`, así que nadie de la red puede conectarse a él.
- Del navegador se guarda **solo el dominio** (`github.com`), nunca la URL
  completa ni el contenido de las páginas.
- Los títulos de ventana sí se guardan en local, porque servirán para asignar
  proyectos (p. ej. la carpeta abierta en VS Code). Nunca se subirán tal cual.

## Estructura

```
agent/src/
  index.ts             arranque del agente
  report.ts            resumen por consola
  config.ts            intervalos, umbral de inactividad, puerto, carpeta de datos
  core/
    types.ts           interfaces: WindowSource, BrowserSource, Segment...
    tracker.ts         convierte muestras en tramos continuos
  storage/
    segment-store.ts   SQLite (node:sqlite, sin dependencias)
  sources/
    windows/           ventana activa + inactividad vía PowerShell
    browser/           servidor local que recibe a la extensión
extension/             extensión Manifest V3 para navegadores Chromium
```

**Preparado para migrar**: la única pieza que depende del sistema operativo es
`WindowSource`. Para pasar a Tauri/Rust, o dar soporte a macOS, basta con otra
implementación de esa interfaz; el tracker, el almacenamiento y la extensión no cambian.

## Limitaciones conocidas

- Si ves un vídeo o estás en una videollamada sin tocar el teclado ni el ratón,
  tras 3 minutos se deja de contar.
- Algunas apps de la Tienda de Windows aparecen como `ApplicationFrameHost`.
- La extensión es solo para navegadores Chromium (Chrome, Edge, Brave...); Firefox aún no.
- El agente hay que arrancarlo a mano; el arranque con Windows vendrá después.

## Próximos pasos

1. WhatsApp Web: detectar con qué chat hablas (solo el nombre).
2. Reglas de asignación (dominio, app, chat → proyecto) y revisión diaria.
3. Web compartida multiusuario y sincronización.
