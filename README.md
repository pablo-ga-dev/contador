# DIALOGUE

<img src="web/public/favicon.svg" alt="" width="64">

Contabiliza automáticamente el tiempo que dedicas a cada cliente, sin tener que
apuntar nada a mano: un agente en cada PC, revisión al final del día y una web
compartida por el equipo, en vuestro propio servidor.

> **Estado.** El agente registra qué aplicación, qué web y qué chat de WhatsApp
> usas, te recuerda revisar el día y lo envía a la web, donde se ven los tiempos
> por persona y por cliente. Falta el despliegue en el servidor.

## Identidad

- **Nombre:** DIALOGUE (de *dia-*, «a través de», y del *dial* de un cronógrafo).
- **Paleta:** Deep Night `#040914` (fondo oscuro, cabeceras), Deep Steel
  `#0B132B` (texto en modo claro), Cobalt Plate `#1C3D5A`, Temporal Pulse
  `#00D2FF` (estados activos y seguimiento en marcha), Platinum Frame `#E2E8F0`
  (bordes) y Pure Clean `#F8FAFC` (fondo claro).
- **Tipografías:** Outfit SemiBold para títulos y Switzer Light para textos, de
  [Fontshare](https://www.fontshare.com). Switzer tiene una licencia que permite
  usarla en nuestra web y nuestra app pero no publicarla (Outfit es libre, OFL),
  así que **no están en el repositorio**. En cada máquina (y en el servidor) se
  instalan desde el zip descargado de Fontshare:

  ```bash
  npm run fuentes -- C:\ruta\FontshareKit-XXXX.zip
  ```

  Sin ellas, la web y el panel usan las fuentes del sistema.
- **Logo:** `web/public/logo.svg` (sobre fondo oscuro) y `web/public/favicon.svg`
  (con su fondo, para pestañas e iconos).

## Cómo funciona

```
┌──────────────────────┐   dominio de la     ┌────────────────────────────┐
│ Extensión navegador  │ ── pestaña activa ─▶│ Agente (Node, sin ventana) │
│ (Chrome, Edge...)    │   127.0.0.1:5611    │                            │
└──────────────────────┘                     │  Tracker ─▶ SQLite local   │
┌──────────────────────┐  ventana activa,    │                │           │
│ PowerShell + API de  │ ── inactividad y ──▶│                ▼           │
│ Windows              │   chat de WhatsApp  │  Panel  127.0.0.1:5611     │
└──────────────────────┘   cada 5 s          └────────────────────────────┘
```

- **Ventana activa e inactividad**: cada 5 segundos se mira qué aplicación está
  delante y cuánto llevas sin tocar teclado ni ratón. Tras 3 minutos sin
  actividad se deja de contar (y se descuentan esos minutos).
- **Dominios**: la extensión avisa al agente del dominio de la pestaña activa
  cuando cambias de pestaña y cada 30 segundos.
- **Chats de WhatsApp** (app de escritorio): si la ventana activa es WhatsApp,
  se lee el nombre del chat abierto con UI Automation, la API de los lectores de
  pantalla. Solo el nombre de la cabecera; nunca los mensajes.
- **Tramos**: mientras sigas en la misma ventana, dominio y chat, se alarga el tramo
  actual; al cambiar, empieza otro. Se guardan en la carpeta de datos (ver abajo).

## Requisitos

- **Windows 10/11** o **macOS** (ver [En Mac](#en-mac))
- [Node.js](https://nodejs.org) 22.18 o superior

Carpeta de datos (`contador.db` y los registros del agente):
- Windows: `%LOCALAPPDATA%\contador`
- macOS: `~/Library/Application Support/DIALOGUE`

## Uso

```bash
npm install
npm run arrancar
```

`npm run arrancar` lo deja funcionando **en segundo plano, sin ventanas**, y no
depende de que la terminal siga abierta. Si ya estaba en marcha, no arranca otro
(dos agentes contarían el tiempo dos veces). Para pararlo: `npm run parar`.
Lo que escribe el agente se guarda en `agente.log` y `agente-error.log`, en la
carpeta de datos. Para verlo en la propia terminal, usa `npm start`.

Para que arranque solo al iniciar sesión, actívalo en **Ajustes → Arranque
automático** (no necesita permisos de administrador).

### En Mac

Funciona igual que en Windows, con estas diferencias:

- **Permisos.** La primera vez macOS preguntará si permites que el agente
  (Terminal, o `node` si arrancó solo) **controle «System Events»**: acéptalo.
  Para que se vean los **títulos de ventana**, añádelo además en *Ajustes del
  Sistema → Privacidad y seguridad → Accesibilidad*. Sin ese permiso se cuenta
  igual por app y por web (con la extensión), pero sin títulos.
- **Arranque automático**: crea `~/Library/LaunchAgents/com.dialogue.agent.plist`,
  que macOS lanza al iniciar sesión. Usa el Node con el que se activó: si
  actualizas Node, Ajustes avisará de que hay que volver a activarlo.
- **Panel**: se abre en modo aplicación de Chrome, Edge o Brave si están en
  `Aplicaciones`; si no, en el navegador por defecto.
- **Aún no** se detecta el chat abierto en la app de WhatsApp (en Windows sí).

> El soporte para Mac está escrito y revisado, pero **aún no se ha probado en un
> Mac de verdad**. Si algo falla, el registro de errores está en
> `~/Library/Application Support/DIALOGUE/agente-error.log`.

### Panel

Con el agente en marcha, abre el panel en su propia ventana (en otra terminal):

```bash
npm run panel
```

Se abre en modo aplicación de Edge, Chrome o Brave (sin pestañas ni barra de
direcciones); también puedes abrir `http://127.0.0.1:5611` en cualquier navegador.
Tiene tres páginas:

- **Hoy**: lo que estás haciendo ahora, el total del día y el tiempo por
  aplicación, web y chat de WhatsApp. Se actualiza cada 5 segundos, permite ver
  días anteriores y avisa de los días sin confirmar.
- **Revisar día**: una fila por web, chat o aplicación, con un selector con
  buscador para asignarla a un cliente (o crear uno nuevo), a **Interno**, a
  **Sin cliente** o a **Personal**. Las actividades de menos de 30 s van juntas
  en una fila. Si una web o un chat ya se asignó antes a un cliente, aparece
  preseleccionado (reglas compartidas por todo el equipo); la casilla
  **Recordar** decide si se guarda la regla (desmárcala en webs genéricas como
  github.com). Debajo, **comentarios** opcionales: uno del día y uno por cada
  cliente con tiempo asignado (qué hiciste para él). **Confirmar y enviar**
  manda el día y sus comentarios a la web; si no hay conexión se guarda y se
  reintenta cada 10 minutos. Se puede volver a confirmar un día para corregirlo.
- **Ajustes**:
  - *Cuenta*: con quién está conectado (nombre y email), la web, y botones para
    abrirla, cambiar la conexión o desconectar. Para conectar, la dirección de la
    web y el código del agente (se genera en Ajustes de la web).
  - *Envíos a la web*: último envío, días pendientes y su motivo, y «Enviar ahora».
  - *Seguimiento*: minutos sin teclado ni ratón tras los que se deja de contar
    (por defecto 3; súbelo si ves vídeos o estás en videollamadas).
  - *Recordatorios*: abrir «Revisar día» tras 7 h 30 min (configurable) desde
    la primera actividad del día si aún no lo has confirmado, y al encender el
    PC, abrir los días que quedaron sin confirmar. Cada aviso sale como mucho
    una vez al día y solo si estás delante del PC.
  - *Arranque automático*: activarlo o desactivarlo. Avisa si el proyecto se
    ha movido de carpeta y hay que volver a activarlo.
  - *Datos en este PC*: dónde se guarda todo.

Lo marcado como **Personal** no sale nunca del PC.

### Resumen por consola

Sin el agente en marcha también puedes ver el resumen del día:

```bash
npm run report
```

O de un día concreto: `npm run report 2026-10-27`.

### Instalar la extensión del navegador

1. Abre `chrome://extensions` (o `edge://extensions` en Edge).
2. Activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension` de este repositorio.

Sin la extensión el agente funciona igual, pero no sabrá en qué dominio estás.

## Web compartida

La carpeta `web/` es la web del equipo: usuarios, clientes y los tiempos que
cada uno confirma al final del día. Es un servidor Node/TypeScript
([Hono](https://hono.dev)) con Postgres.

### Ponerla en marcha (desarrollo)

Necesitas [Docker](https://www.docker.com) para la base de datos.

```bash
cd web
npm install
cp .env.example .env
npm run db:up        # Postgres en Docker (puerto 5433)
npm run migrate      # crea las tablas
npm run create-user -- tu@email.com "Tu Nombre"
npm run dev          # http://localhost:3030
```

`create-user` muestra una contraseña temporal una sola vez; cámbiala al entrar.
Si alguien la olvida, `npm run reset-password -- su@email.com` le genera otra
temporal y cierra sus sesiones abiertas.
Para parar la base de datos: `npm run db:down` (los datos se conservan).

### Qué hace ya

- **Tiempos** (página principal), con dos vistas:
  - *Por persona y día*: una semana con el tiempo confirmado de cada persona
    cada día; al pulsar un día se ve por cliente, con sus webs, chats y apps.
  - *Por cliente y mes*: el total de cada cliente (y de Interno y Sin cliente)
    con el reparto por persona; al pulsar uno se ven sus actividades, personas y días.
  De momento todo el equipo ve los tiempos de todos.
- **Clientes**: lista con buscador, alta (sin duplicados, aunque cambien
  mayúsculas) y el tiempo total de cada uno. Al pulsar un cliente, su ficha:
  total, este mes y personas; tiempo por mes (cada mes enlaza a su detalle en
  Tiempos), por persona, sus webs, chats y apps, y los comentarios recientes.
  **Borrar cliente**: si tiene tiempo confirmado, se elige adónde pasa (a «Sin
  cliente» o a otro cliente, que sirve para unir duplicados) junto con sus
  comentarios y reglas; nunca se pierden horas.
- **Comentarios**: los escritos al confirmar el día aparecen en el detalle del
  día de cada persona (el general arriba, el de cada cliente bajo su nombre) y
  en el detalle de cada cliente.
- **Ajustes**: nombre, email, contraseña y el **agente del PC**: generar su
  código (se muestra una vez y generar otro invalida el anterior), ver cuándo
  contactó por última vez y desconectarlo.
- Inicio de sesión (vuelve a la página que ibas a abrir) y alta de usuarios por comando.
- API para el agente:
  - `GET /api/clients` y `GET /api/rules` (qué cliente se preselecciona para
    cada dominio, chat o app; compartidas por todo el equipo).
  - `PUT /api/days/AAAA-MM-DD`: el día confirmado, actividad por actividad
    (cliente, interno o sin cliente), con sus comentarios (`notes`). Volver a
    enviarlo lo sustituye. Las actividades marcadas para recordar actualizan
    las reglas.

Lo marcado como **Personal** en la revisión nunca se envía.

## Privacidad

- Todo se guarda **solo en tu equipo**. El agente escucha únicamente en
  `127.0.0.1`, así que nadie de la red puede conectarse a él, y rechaza
  peticiones dirigidas a otro nombre de host, para que ninguna web pueda leer el panel.
- Del navegador se guarda **solo el dominio** (`github.com`), nunca la URL
  completa ni el contenido de las páginas.
- De WhatsApp se guarda **solo el nombre del chat** abierto, tal como aparece
  en tu agenda. Nunca el contenido de los mensajes.
- Los títulos de ventana y los nombres de chat sí se guardan en local, porque
  servirán para asignar proyectos (p. ej. la carpeta abierta en VS Code o el chat
  de un cliente). Nunca se subirán tal cual.

## Estructura

```
agent/src/
  index.ts             arranque del agente
  report.ts            resumen por consola
  open-panel.ts        abre el panel en su propia ventana
  config.ts            intervalos, umbral de inactividad, puerto, carpeta de datos
  core/
    types.ts           interfaces: WindowSource, BrowserSource, Segment...
    tracker.ts         convierte muestras en tramos continuos
    day-range.ts       límites de un día en hora local
  storage/
    database.ts        abre la base SQLite local (node:sqlite, sin dependencias)
    segment-store.ts   tramos de actividad y sus totales
    review-store.ts    ajustes y días confirmados (pendientes de enviar o enviados)
  sync/
    web-client.ts      llamadas a la web con el código del agente
    day-sync.ts        envío de los días confirmados, con reintentos
  server/
    local-server.ts    servidor local: extensión, páginas del panel y su API
  ui/                  páginas del panel (HTML, CSS y JS sin dependencias)
    panel.html         Hoy
    review.html        Revisar día
    settings.html      Ajustes
    style.css, common.js  estilos y utilidades compartidas
  sources/
    windows/           ventana activa, inactividad y chat de WhatsApp vía PowerShell
    browser/           último dominio recibido de la extensión
extension/             extensión Manifest V3 para navegadores Chromium
web/
  src/
    server.ts          servidor web y protección CSRF
    auth/              contraseñas, sesiones y código del agente
    routes/            API: auth, clientes, reglas y días
    db/                conexión, migraciones SQL y su aplicador
    scripts/           alta de usuarios
  public/index.html    la web (HTML, CSS y JS sin dependencias)
  docker-compose.yml   Postgres de desarrollo
```

**Preparado para migrar**: la única pieza que depende del sistema operativo es
`WindowSource`. Para pasar a Tauri/Rust, o dar soporte a macOS, basta con otra
implementación de esa interfaz; el tracker, el almacenamiento y la extensión no cambian.
El panel es una página web normal, así que una futura app de Tauri o Electron
podría mostrarlo tal cual en su ventana.

## Limitaciones conocidas

- Si ves un vídeo o estás en una videollamada sin tocar el teclado ni el ratón,
  tras 3 minutos se deja de contar.
- Algunas apps de la Tienda de Windows aparecen como `ApplicationFrameHost`.
- En Mac aún no se detecta el chat de WhatsApp, y sin el permiso de Accesibilidad
  no hay títulos de ventana.
- El chat de WhatsApp se lee de la estructura interna de la app (el elemento
  `main` y su primer texto). Si una actualización de WhatsApp la cambia, el
  tiempo se seguirá contando como WhatsApp, pero sin chat, hasta que lo ajustemos.
- WhatsApp Web en el navegador cuenta por dominio (`web.whatsapp.com`), aún sin chat.
- La extensión es solo para navegadores Chromium (Chrome, Edge, Brave...); Firefox aún no.
- El arranque con Windows apunta a la carpeta del proyecto: si la mueves, vuelve
  a activarlo en Ajustes. Al iniciar sesión puede verse un instante una ventana
  de PowerShell.

## Próximos pasos

1. Aviso al apagar el PC.
2. Despliegue de la web en el servidor (HTTPS, `COOKIE_SECURE=true`).
3. WhatsApp Web en el navegador: detectar el chat desde la extensión.
