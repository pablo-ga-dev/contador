#!/bin/sh
# Crea el proyecto de Xcode de la extensión para Safari a partir de la carpeta extension/.
# Solo en macOS, con Xcode instalado. Uso: sh safari/crear-proyecto.sh
# El proyecto usa los archivos de extension/ tal cual: si cambian, basta con volver a compilar.
set -e
cd "$(dirname "$0")/.."

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Hace falta Xcode (desde la App Store) para crear la extensión de Safari." >&2
  exit 1
fi

xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name DIALOGUE \
  --bundle-identifier com.dialogue.extension \
  --macos-only \
  --no-open \
  --no-prompt \
  --force

echo
echo "Proyecto creado en safari/DIALOGUE. Ahora:"
echo "  1. Ábrelo: open safari/DIALOGUE/DIALOGUE.xcodeproj"
echo "  2. En Xcode, Product > Run (⌘R). Se abre la app DIALOGUE; puedes cerrarla."
echo "  3. En Safari: Ajustes > Avanzado > «Mostrar funciones para desarrolladores web»;"
echo "     después Ajustes > Desarrollador > «Permitir extensiones sin firmar»."
echo "  4. Ajustes > Extensiones: activa DIALOGUE y, en «Permisos», permítela"
echo "     siempre en todas las webs (si no, Safari no le deja ver el dominio)."
