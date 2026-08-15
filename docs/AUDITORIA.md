# Auditorías por fase

Cada fase se cierra con una revisión independiente (agente revisor sin contexto de la implementación).
Se registran los hallazgos y qué se hizo con cada uno.

## F1 · Núcleo + Activar/Revertir (2026-08-15)

| # | Sev. | Hallazgo | Resolución |
|---|------|----------|------------|
| 1 | Alta | `clearSnapshot` no borraba `last-snapshot.json`; un 2.º Revert podía borrar un settings.json legítimo | Corregido: `retireSnapshotFile` renombra el snapshot a `reverted-<ts>.snapshot.json`; test |
| 2 | Alta | Revert sobrescribía el fichero actual sin copia y sin avisar de cambios posteriores | Corregido: copia `before-revert.*` + `writtenSha256` en el snapshot; el modal avisa si el fichero cambió; test |
| 3 | Alta | Enable repetido machacaba el snapshot (Enable→Enable→Revert dejaba bypass) y escribía sin cambios | Corregido: si no hay nada que cambiar no escribe ni toca snapshot ("ya configurado", ofrece Doctor); si hay snapshot sin revertir se conserva |
| 4 | Media | Escritura atómica sustituía symlinks y no conservaba permisos; `rm` del tmp podía fallar el comando | Corregido: `realpath`, `stat.mode` al tmp, `rm` tolerante; test (skip si no hay symlinks) |
| 5 | Media | `removeHooks` borraba por índice sin verificar el comando (índices caducos) | Corregido: `removeHooksDetailed` verifica `command`, devuelve `skipped`; Doctor avisa; tests |
| 6 | Media | Wildcard incompleto (`.*`, `^.*$`, `.+`) | Corregido: `matcherIsWildcard` compila la regex y la prueba contra 9 herramientas; tests |
| 7 | Media | Fallo al escribir settings de VS Code dejaba estado parcial sin explicarlo | Corregido: try/catch con mensaje de estado parcial y cómo deshacer |
| 8 | Baja | `pruneBackups` podía borrar el backup recién creado con reloj atrasado | Corregido: lista `protect`; test |
| 9 | Media | `handsfree.claudeSettingsPath` sin `scope: machine`; ruta no visible en el consentimiento; sin `untrustedWorkspaces` | Corregido: scope machine, ruta y ficheros afectados en el modal, capabilities declaradas |
| 10 | Baja | Backups pueden contener secretos | Documentado en el consentimiento; irá al README |
| 11 | Baja | Enable no mencionaba hooks wildcard | Corregido: se listan en el resumen y en el mensaje final ("ejecuta el Doctor") |
| 12 | Alta (empaquetado) | Falta `media/icon.png`, README, CHANGELOG; `package-lock.json` en el vsix | Icono/README/CHANGELOG en F3; lock excluido en `.vscodeignore` |
| 13 | Baja | `_doctorReport` sin activation event | Corregido: `onCommand:handsfree._doctorReport` |
| 14 | Baja | `extensions.all` no ve extensiones de otro host (Remote) | Se documenta en README (F3) |
| 15 | Baja | Revert no restauraba claves VS Code si la extensión oficial ya no estaba | Corregido: se restauran siempre (viven en settings de VS Code); mensaje si falla |
| 16 | Texto | "hook de herramienta de terceros" podía ser un hook propio; mensaje de recarga sin extensión instalada | Corregido: textos EN/ES ajustados |
| — | Menor | OutputChannel fuera de subscriptions; `consentAcceptedAt` muerto | Corregido |

Comprobado OK por el revisor: rutas (`CLAUDE_CONFIG_DIR`, managed por SO), BOM/línea-columna, byte-exactitud del backup, idempotencia de `applyAutonomous`, orden del flujo (ninguna escritura antes del consentimiento), `ConfigurationTarget.Global` e `inspect()`, id de comando de desinstalación, l10n, activación por comandos, bundle esbuild.

Estado tras corrección: `npm run check` (typecheck + lint + 53 tests unitarios) y test de integración en verde.

## F2 · Doctor (2026-08-15)

Antes de corregir se verificaron dos hechos en la documentación oficial de Claude Code y en el manifiesto de la extensión oficial 2.1.233:
- `claudeCode.allowDangerouslySkipPermissions` e `initialPermissionMode` son `scope: "machine"` → no existe override por workspace; se retiró esa rama.
- La extensión elige el modo inicial así: (1) `initialPermissionMode`, (2) último modo elegido en el indicador, (3) `defaultMode` de managed/`~/.claude/settings.json`, (4) predeterminado; y **nunca lee** `.claude/settings*.json` del proyecto. `disableBypassPermissionsMode` vale desde cualquier ámbito. Las reglas `ask`/`deny` siguen aplicando en bypass.

| # | Sev. | Hallazgo | Resolución |
|---|------|----------|------------|
| 1.1 | Alta | Falso "todo correcto" con override de proyecto (`ws.mode` era info) | `ws.mode` → warn, texto explica terminal vs VS Code |
| 1.2 | Media | Managed solo se miraba para `disable` | Se evalúan también `defaultMode` y hooks en managed (sin fix) |
| 1.3 | Media | `initialPermissionMode` unset se reportaba como "default" (falso) y se traducía el nombre del modo | Nuevo hallazgo "modo inicial no fijado" con la explicación del indicador pegajoso; nombres de modo sin traducir; `unset` en vez de `undefined` |
| 1.4 | Media | Rama "perfil por workspace" inalcanzable (scope machine) | Retirada; `writeOfficialWorkspaceMode` eliminado; perfiles de F4 irán por `.claude/settings.local.json` del proyecto |
| 1.5 | Baja | Hooks propios etiquetados como "de terceros"; todo-o-nada | Separado known-tool wildcard (error) de matcher estrecho (warn); texto "auto-aprueban" |
| 1.6 | Baja | Ext. no instalada era warn (usuario solo-CLI nunca veía verde) | → info |
| 1.7 | Baja | "más nueva que las probadas" saltaba desde el día 1 | Solo se avisa si es MÁS ANTIGUA que la mínima probada (`compareVersions`) |
| 1.8 | Baja | Texto del diálogo de bypass | Reformulado según docs ("se guarda en user settings") |
| 1.9 | Baja | "sin hooks" sin decir dónde | Incluye la ruta |
| 1.10 | Baja | JSON inválido ocultaba checks independientes del fichero | Managed, extensiones y contrato oficial se evalúan siempre |
| 1.11 | Baja | Home abierto como carpeta duplicaba el fichero; esquemas no-file | Dedupe por ruta normalizada; solo `file:` |
| 2.1 | Alta | "Fix everything" ejecutaba Enable hasta 4 veces y anidaba el Doctor | `planFixAll` puro: un Enable, hooks fusionados, solo errores; test |
| 2.2 | Media | Índices caducos entre dos fixes de hooks | Fusionados en una operación; verificación por comando ya existía |
| 2.3 | Media | Extensión desinstalada seguía en rojo hasta recargar | `uninstalledThisSession` → info "recarga para terminar" + oferta de recarga |
| 2.4 | Media-baja | fix-all incluía hooks wildcard e info | Excluidos |
| 2.5 | Baja | Modal de desinstalación sin el porqué | `detail` con el porqué (l10n) |
| 2.6 | Baja | Sin confirmación tras arreglar; fichero inválido entre informe y fix silencioso | Toast con ruta de backup; mensaje si no legible |
| 2.7 | Baja | Se ofrecía Enable bajo política | Suprimido cuando hay política |
| 3.1 | Alta | Redacción `split(homedir)` fallaba con `c:\` minúscula y barras `/` en Windows | `core/report.ts`: regex insensible a mayúsculas y separadores en win32, `CLAUDE_CONFIG_DIR`, nombre de usuario; tests |
| 3.2 | Media-baja | Comandos de hooks con tokens y extractos del JSON en mensajes de error V8 | `maskSecrets` en títulos/detalles/modales; `sanitizeJsonErrorMessage` elimina extractos; test de no-fuga |
| 4.1 | Media-baja | `StaleRule.detail` y `why` en inglés fijo | Traducidos vía `t()` / `l10n.t` |
| 4.2 | Baja | Traducciones mejorables | Corregidas |
| 5 | — | Tests | +findings (managed, unreadable, not-object, allow false, pending reload, ws.policy, no-fuga), planFixAll, redact/report; integración hermética con `CLAUDE_CONFIG_DIR` temporal y workspace fixture |
| 6.1 | Media | EACCES/EISDIR tumbaban `collect()` | `readJsonFile` nunca lanza; hallazgo "no legible ({código})" |
| 6.2 | Media-baja | Sin progreso ni timeout | `withProgress` + timeout 5 s por fichero (`ETIMEDOUT`) |
| 6.3 | Baja | `extensionKind` sin declarar | `["workspace"]` |

Estado tras corrección: 62 tests unitarios + 4 de integración hermética en verde; `npm run check` limpio.
