# Privacidad

**Handsfree for Claude Code no recoge telemetría. Las funciones gratuitas no hacen ninguna petición de red.**

Qué lee: tu fichero de configuración de usuario de Claude Code (`~/.claude/settings.json` o `$CLAUDE_CONFIG_DIR/settings.json`), los ficheros de política gestionada de Claude Code si existen, los `.claude/settings.json` / `.claude/settings.local.json` de las carpetas abiertas, el manifiesto y los ajustes de la extensión oficial de Claude Code, y la lista de extensiones instaladas (para detectar herramientas de auto-aceptación conocidas). Todo se queda en tu equipo.

Qué escribe: los cuatro ajustes descritos en el README, y copias de seguridad de tu fichero de configuración de Claude en `~/.claude/backups/handsfree/` (se conservan las 10 más recientes). Las copias son idénticas a tu configuración y por tanto contienen lo mismo que ella, incluidos los valores de `env`; conservan los permisos del fichero original.

"Copiar informe" del Doctor pone un informe Markdown en **tu** portapapeles, con tu carpeta y nombre de usuario sustituidos por marcadores y los valores con pinta de token en comandos de hooks enmascarados. No se envía nada a ningún sitio salvo que tú lo pegues.

**Licencia Pro (opcional, de pago).** Cuando *tú* ejecutas "Pro: introducir clave de licencia", la extensión envía tu clave de licencia, el nombre de este equipo (como etiqueta de la activación) y dos campos no identificativos (sistema operativo, versión de la extensión) a la API de licencias de Polar Software Inc. (`api.polar.sh`), que actúa como merchant of record y proveedor de licencias. Después revalida la clave como mucho una vez cada 24 horas cuando usas una función Pro (solo clave e id de activación) y sigue funcionando sin conexión 14 días. Nunca se envía nada de tus ficheros de configuración. La clave se guarda en el almacén secreto de VS Code de este equipo. "Pro: desactivar la licencia" la borra y libera la activación en Polar. Política de privacidad de Polar: https://polar.sh/legal/privacy.

Responsable del tratamiento en la extensión: Tecniart Galicia SL (Argalla), España. Base jurídica del intercambio de licencia: ejecución del contrato de compra. Puedes pedir la supresión de tus registros de activación en el contacto de abajo.

Contacto: info@tecniartgalicia.com — Tecniart Galicia SL (Argalla), España.
