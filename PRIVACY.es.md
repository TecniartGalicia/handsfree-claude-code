# Privacidad

**Handsfree for Claude Code no hace ninguna petición de red y no recoge telemetría.**

Qué lee: tu fichero de configuración de usuario de Claude Code (`~/.claude/settings.json` o `$CLAUDE_CONFIG_DIR/settings.json`), los ficheros de política gestionada de Claude Code si existen, los `.claude/settings.json` / `.claude/settings.local.json` de las carpetas abiertas, el manifiesto y los ajustes de la extensión oficial de Claude Code, y la lista de extensiones instaladas (para detectar herramientas de auto-aceptación conocidas). Todo se queda en tu equipo.

Qué escribe: los cuatro ajustes descritos en el README, y copias de seguridad de tu fichero de configuración de Claude en `~/.claude/backups/handsfree/` (se conservan las 10 más recientes). Las copias son idénticas a tu configuración y por tanto contienen lo mismo que ella, incluidos los valores de `env`; conservan los permisos del fichero original.

"Copiar informe" del Doctor pone un informe Markdown en **tu** portapapeles, con tu carpeta y nombre de usuario sustituidos por marcadores y los valores con pinta de token en comandos de hooks enmascarados. No se envía nada a ningún sitio salvo que tú lo pegues.

Si una futura versión de pago añade activación de licencia, se documentará aquí antes de publicarse, enviará solo la clave de licencia y un identificador anónimo de máquina al proveedor de licencias, y nunca enviará el contenido de tu configuración.

Contacto: info@tecniartgalicia.com — Tecniart Galicia SL (Argalla), España.
