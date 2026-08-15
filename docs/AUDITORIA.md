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
