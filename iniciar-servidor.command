#!/bin/bash
# Pleaseme — inicia la base de datos local (Mac: doble clic · Linux: ./iniciar-servidor.command)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js no está instalado. Descárgalo de https://nodejs.org (versión LTS) y vuelve a abrir este archivo."
  echo
  read -n 1 -s -r -p "Presiona una tecla para cerrar…"
  exit 1
fi
( sleep 1.5; (open "http://localhost:3000/admin.html" || xdg-open "http://localhost:3000/admin.html") >/dev/null 2>&1 ) &
node servidor/server.js
