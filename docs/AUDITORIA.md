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

## F3 · Publicación (2026-08-15)

| # | Sev. | Hallazgo | Resolución |
|---|------|----------|------------|
| 1 | Alta | Ruta managed de Windows obsoleta (`ProgramData`; desde 2.1.75 es `Program Files\ClaudeCode`); no se leían `managed-settings.d/*.json`; README prometía una detección que no ocurría en Windows | `paths.ts` reescrito (Program Files, drop-ins alfabéticos, legado solo como nota del Doctor); README/README.es aclaran "políticas basadas en fichero; registro/MDM/servidor no se inspeccionan"; tests |
| 2 | Media | Encuadre de seguridad más blando que el aviso oficial; sin mención al modo `auto` | Aviso oficial ("solo entornos aislados…") en README y en el modal de consentimiento; párrafo "¿De verdad lo necesitas?" sobre auto; hallazgo específico del Doctor cuando `defaultMode` es `auto` |
| 3 | Media | `ovsx` sin fijar; acciones sin pin por SHA | `ovsx` en devDependencies; `checkout`/`setup-node`/`upload-artifact`/`action-gh-release` fijadas por SHA; `dependabot.yml` |
| 4 | Media-baja | Release no idempotente; sin comprobar rama; sin timeout | Publicación salta si la versión ya existe (Marketplace vía `vsce show`, Open VSX vía `ovsx get`); `merge-base --is-ancestor origin/main`; `timeout-minutes` |
| 5 | Media-baja | `docs/TUS-TAREAS.md` (notas internas) trackeado | Fuera del repo (`.gitignore`), sigue en disco; `AUDITORIA.md` se mantiene público a propósito |
| 6 | Baja | `@types/vscode ^1.95` resolvía a 1.125 | Fijado a `1.95.0` exacto |
| 7 | Baja | Poda de backups solo en Enable | También en Revert y Doctor (protegiendo la copia del snapshot) |
| 8 | Baja | Nota sobre nivel raíz de `skipDangerousModePermissionPrompt` | Añadida al README |
| 9 | Baja | Afirmaciones a matizar (Cursor no probado, `CLAUDE_CONFIG_DIR` del proceso, "Fix" solo donde es seguro, Revert restaura claves) | Textos ajustados EN/ES |
| 10 | Baja | Icono 128; categoría solo "Other"; keyword "anthropic"; sin `preview` | Icono 256 px; categorías `AI, Other`; keyword retirada; `preview: true` |
| 11 | Baja | Prerrequisitos de publicación | Private vulnerability reporting activado en GitHub (API); TUS-TAREAS recoge push-antes-de-publicar; PRIVACY.es.md añadido |

Estado: 62 tests unitarios + 4 integración; `vsce package` sin avisos (14 ficheros, 39 KB); `.vsix` instalado con éxito en un VS Code 1.133 limpio.

## F4 · Pro (2026-08-15)

| # | Sev. | Hallazgo | Resolución |
|---|------|----------|------------|
| L1 | Alta | Trampa permanente: un estado ≠ granted (o cualquier 4xx) dejaba Pro apagado para siempre sin volver a la red | `lastCheckedAt`; se revalida a las 24 h también tras una mala respuesta; `force` siempre va a red; un 4xx es fallo blando (gracia), solo un 200 con estado explícito se persiste; tests |
| L2 | Media | Sin timeout en `fetch` | `AbortSignal.timeout(15 s)`; test comprueba que se pasa `signal` |
| L3 | Media | Reactivar en el mismo equipo dejaba un slot huérfano en Polar | Se desactiva la activación previa antes de activar |
| L4 | Baja | 408/425/429 como "clave no reconocida"; `detail` array → `[object Object]`; 200 sin `id` | Transitorios → network; `detailText` formatea arrays; `unexpected` con mensaje propio |
| L5 | Baja (aceptado) | `HANDSFREE_PRO_DEV=1` desbloquea Pro | Documentado en CONTRIBUTING como "honor system"; nada empaquetado lo activa |
| L6 | Baja | Validaciones solapadas; comandos gratuitos tocaban secrets | Promesa en vuelo compartida; flag `hasLicense` en globalState evita leer secrets si nunca hubo licencia |
| L7 | Baja | Reloj atrasado sin red → mensaje engañoso | Edad negativa cuenta como reciente → gracia |
| L8 | Baja | Texto del input decía "solo clave y nombre" | Alineado con PRIVACY (SO y versión también) |
| G1 | Alta | Poda de backups en guardarraíles/import sin proteger la copia del snapshot | Protegida (como Doctor); Revert nunca pierde su copia |
| G2 | Alta | `settings.local.json` se lee desde la raíz git (≥2.1.211); se escribía en la carpeta abierta | `gitRootOf`; perfil escrito/leído en la raíz; el Doctor lee carpeta y raíz (dedupe); modal avisa si difieren |
| G3 | Media | Perfil prudente pisaba un `defaultMode` propio (p. ej. `plan`) y no lo restauraba | Solo se sustituye si vacío o modo sin diálogos; se guarda el previo y se restaura al quitar; tests |
| G4 | Media | Sobreafirmación de "no puede leer" | Textos matizados (herramientas de fichero; scripts no; también bloquea crear/editar; `.env.example`) |
| G5 | Media | Quitar perfil/guardarraíles exigía Pro | Quitar es siempre gratis; Pro solo para añadir; README lo promete |
| G6 | Media-baja | El Doctor no miraba `permissions.ask` | Hallazgo info con recuento (y cuántas son de Handsfree); test |
| G7 | Media-baja | Regla borrada a mano → set "no instalado" y reglas huérfanas | `guardrailPresence` full/partial/none; preselección de parciales; quitar toma sets con alguna regla |
| G8 | Baja | Huecos y reglas demasiado amplias | Variantes (`git push *--force*`, `git clean *`, `rm -R*`, `chmod * -R*`), `gh release create/upload/delete`, helm/kubectl drain; "mejor esfuerzo" en el detalle |
| G9 | Baja | Quitar un set borraba reglas idénticas previas del usuario | Se registra lo añadido por set (`globalState`) y solo eso se retira; test |
| G10 | Baja | Marcador en workspaceState (no cruza workspaces; no se limpia) | `globalState` por ruta normalizada; se limpia si el fichero desapareció |
| G11 | Baja | Fichero podía commitearse | Se añade a `.git/info/exclude` (no toca `.gitignore`) |
| G12 | Baja | `untrustedWorkspaces.description` desfasada; sin comprobar `isTrusted` | Descripción actualizada; se exige workspace de confianza para escribir |
| G13 | Baja | Se borraba un fichero vacío que no habíamos creado | Solo se borra si lo creó Handsfree |
| E1 | Media | Import sin valores antes→después, sin consentimiento de bypass ni snapshot | Modal con `clave: antes → después` y reglas; aviso oficial si el perfil enciende bypass; se crea snapshot si no existía (Revert lo deshace) |
| E2 | Media-baja | Perfil sin validar | `parseProfile` estricto (modos conocidos, `disable`, arrays de reglas con forma válida); tests |
| E3 | Baja | Export por defecto dentro del workspace | Por defecto en home |
| S1-S3 | Baja | Barra: no se ocultaba sin Pro; "prudente" ocultaba avisos; ruido de log; no vigilaba `~/.claude` | Se oculta; orden error > aviso > prudente(propio) > ok; `runDoctor({quiet})`; watcher adicional sobre el directorio de settings |
| T1-T4 | Baja | Textos: "nada más", "3 equipos", precio, `polar.ts`, detalles sin traducir, motivos crudos | Corregidos; l10n extendida a literales con comillas dobles (detectó 2 cadenas que se escapaban) |
| Tests | — | — | +licencia (trampa, re-granted, skew, transitorios, `signal`), guardarraíles (parcial, registro de añadidos), perfil (`plan` previo, restaurar), `parseProfile` estricto, Doctor `ask.rules`; integración comprueba los 13 comandos |

Estado: 78 tests unitarios + 4 integración; `l10n-sync` 230/230; build 72 KB.

## F5 · Lanzamiento (auditoría integral, 2026-08-15) — veredicto: GO condicionado → condiciones aplicadas

| # | Sev. | Hallazgo | Resolución |
|---|------|----------|------------|
| H1 | Alta | 0.1.0 anuncia Pro pero sin IDs de Polar el build no lo vende | Orden explícito en TUS-TAREAS (B1–B3 antes de A6) y guardarraíl mecánico: `release.yml` se niega a publicar si `polarConfig.ts` está vacío |
| M1 | Media | `ovsx get ns.ext@ver` no es sintaxis válida → release no idempotente en Open VSX | `ovsx get ns.ext -v "$VER"` (verificado por el revisor contra ovsx 0.10) |
| M2 | Media | Puerta `when` de la paleta ocultaba Pro hasta el primer comando en cada ventana | Puerta retirada (Pro debe estar configurado antes de publicar, ver H1) |
| M3 | Media | TUS-TAREAS incompleto (prueba real de Polar, cuenta Eclipse + Publisher Agreement en Open VSX, `git push main` antes del tag, A5 ya hecho, PAT caduca, publisher ocupado, probar Cursor) | Añadido todo |
| M4 | Media-baja | PRIVACY/README: la revalidación también la disparan comandos gratuitos y la barra; PRIVACY no listaba lo que escribe Pro | Frases corregidas EN/ES |
| L1 | Baja | "Remove careful profile … (Pro)" siendo gratis | Etiqueta corregida |
| L2 | Baja | Ignores de dependabot solo como comentarios en PRs | Codificados en `dependabot.yml` |
| L3 | Baja | Comentario `# v4` incompleto; Node 20 EOL en CI | `# v4.4.0`; Node 22 en CI/release |
| L4 | Baja | Modal/log de hooks en Enable sin enmascarar | `maskSecrets` |
| L5 | Baja | LANZAMIENTO: umbrales internos públicos, anécdota, tagline, "Cursor" sin probar, "exactly as it was" | Umbrales movidos a TUS-TAREAS; matices aplicados |
| L6 | Baja | Topic `anthropic` en GitHub | Retirado |
| L7 | Baja | `_doctorReport` sin documentar | Sección en CONTRIBUTING |
| L8 | Baja | Precio con/sin IVA | Decisión anotada en TUS-TAREAS B2 |

Verificado por el revisor: SHAs de acciones correctos tras dependabot, lock en sincronía, `vsce show --json` expone `versions[]`, `.vsix` de 14 ficheros sin src/docs/scripts/lock, TUS-TAREAS no trackeado, nada al arrancar, única red = Polar, README/PRIVACY coherentes con el código, versiones/licencia consistentes, l10n 230/230, todas las URLs citadas responden.

## Publicación 0.1.0 (2026-08-15) — nota de operación

- Marketplace: https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code · Open VSX: https://open-vsx.org/extension/argalla/handsfree-claude-code · Release: tag `v0.1.0`.
- El chequeo de contenido del Marketplace rechazó el primer intento ("Your extension has suspicious content"). Bisección con extensiones vacías de diagnóstico (después despublicadas): código, README, icono, nls, keywords y `contributes` pasaban; **el disparador era la frase de `description` "why … keeps asking for permission"**. Se reformuló ("why you still get permission prompts") y la 0.1.0 pasó con el resto del paquete intacto.
- Aprendido para futuras versiones: (1) un ID despublicado no se puede reutilizar y un `displayName` despublicado queda reservado; (2) `vsce show --json` imprime `undefined` (no JSON) cuando el ID no existe: `release.yml` lo trata ahora como "no publicado"; (3) `ovsx publish` responde "Published" pero la ficha tarda ~1 min en aparecer en la API pública; (4) el namespace `argalla` de Open VSX se reclama en EclipseFdn/open-vsx.org#12545.

## F6 · Prueba en vivo de Polar y auditoría de la 0.1.1 (2026-08-15)

**Método.** Cuenta Polar aprobada → cupón del 100 % de un solo uso → checkout real a 0 € (correo del titular) → clave real → activar / validar / desactivar / deshabilitar / rehabilitar / revocar contra `api.polar.sh` con el código compilado de la extensión (`out/core/license.js`); segunda clave para el caso "activación retirada". Después: claves revocadas y cupones borrados (no queda ninguna licencia gratuita viva).

**Hechos observados (no estaban en la documentación que usó la F4):**
| Llamada | Respuesta real |
|---|---|
| Ráfaga de ~3-4 llamadas en 30 s | `429` + `Retry-After: 30` (cualquier endpoint) |
| `validate` clave revocada o deshabilitada | `404 {"error":"ResourceNotFound","detail":"License key is no longer active."}` |
| `validate` clave desconocida, o clave válida + `activation_id` desactivado/aleatorio | `404 {"error":"ResourceNotFound","detail":"Not found"}` (indistinguibles por el cuerpo) |
| `validate` con `organization_id` mal formado | `422 RequestValidationError` |
| `activate` clave revocada | `403 {"error":"NotPermitted","detail":"License key is no longer active. This license key can not be activated."}` |
| `deactivate` | `204` sin cuerpo; validar después con ese `activation_id` → 404 "Not found"; por clave sola → 200 granted |
| Rehabilitar tras deshabilitar | vuelve a `200 status=granted` |

**Cambios en la 0.1.1 (resumen; detalle en CHANGELOG):** reintento único ante 429 honrando `Retry-After` (tope 60 s) solo en llamadas del usuario (activar, desactivar, estado forzado; el fondo nunca espera) + tipo `busy` con mensaje claro; 404 con la forma exacta `ResourceNotFound` = respuesta definitiva (revocada → OFF ya, se repregunta a las 24 h; "Not found" con `activation_id` → 2ª llamada por clave sola para distinguir "activación retirada" de "clave desconocida"); un estado negativo persistido no resucita por gracia; activar antes de liberar el hueco antiguo (y, si se liberó y falló, se persiste `activation-removed`); progreso en desactivar/estado y activación cancelable.

**Auditoría independiente del cambio (agente):** MEDIA — la vía "misma clave al límite" liberaba el hueco ante cualquier `limit` y podía dejar un `activationId` muerto (→ solo si el mensaje dice *limit*, y se persiste `activation-removed` con aviso); MEDIA-BAJA — `activation_id` obsoleto se leía como "clave no reconocida" (→ 2ª llamada por clave, razón `activation-removed`, textos EN/ES); BAJA-MEDIA — estado negativo resucitaba por gracia ante fallo de red (→ corregido); BAJA — `not-found`→`revoked` incoherente (→ `reasonForStatus`), esperas sin progreso ni cancelación (→ `withProgress` + cancelable), detección "definitiva" laxa (→ exige `error === 'ResourceNotFound'`), comentarios desfasados, `opts` sustituía los defaults (→ `{ retryBusy: true, ...opts }`), tests sin la rama `headers` ausente (→ añadido). Todo aplicado; 82 tests unitarios; rutas nuevas verificadas también contra la API real.

## F7 · Auditoría completa post-publicación (2026-08-17)

Seis revisores independientes en paralelo (núcleo de ficheros · Doctor/informe · Pro/guardarraíles · activación/l10n/empaquetado · CI/release/scripts · licencias v2), con reproducción ejecutada de cada hallazgo. **Corregido todo lo de severidad alta y media, y lo bajo que era barato**; 14 tests de regresión nuevos en `src/test/unit/auditF7.test.ts` (95 unitarios + 4 de integración).

### Alta
| # | Qué fallaba | Arreglo |
|---|---|---|
| F7-1 | `existedBefore` venía de una lectura previa al modal de consentimiento: si el fichero se creaba mientras el diálogo estaba abierto, **Revertir lo borraba** aunque hubiera copia | `existedBefore` se deriva del backup real, y `restoreClaudeSettings` nunca borra un fichero del que tiene copia |
| F7-2 | *Lost update*: se escribía el objeto calculado **antes** del consentimiento, tirando lo que Claude Code hubiera escrito mientras (p. ej. un "permitir siempre") | se relee y se recalcula tras el consentimiento; si el fichero pasó a inválido, se aborta |
| F7-3 | El diagnóstico estrella era código muerto: `cfg.get()` devuelve el default del registro (`""`/`false`) para claves declaradas sin `default`, así que **"modo inicial sin fijar" no se emitía nunca** y salía el texto falso `New conversations start in "" mode` | `readOfficialValues()` usa `inspect().globalValue` (ambas claves son `scope: machine`) |
| F7-4 | Las reglas `ask` de política gestionada y de proyecto no se miraban: el Doctor decía "all good" mientras Claude preguntaba por todo | `askRulesFinding()` se aplica también a managed y a los ficheros del proyecto |
| F7-5 | Marcar "prudente" dos veces sobre el mismo repo pisaba el registro y dejaba un `defaultMode` que ningún comando quitaba | el registro se fusiona en vez de sobrescribirse |
| F7-6 | El registro de guardarraíles se acumulaba sin reconciliarse con el fichero: tras un Revert podía **borrar reglas del propio usuario** | se poda el registro a lo que está realmente en el fichero antes de tocar nada |
| F7-7 | Un `200` con un `status` desconocido (proxy con MITM, valor nuevo de Polar) apagaba Pro **para siempre**, porque el guard de la 0.1.1 impedía que la gracia lo rescatara | lista blanca de estados; cualquier otro es fallo blando y no se persiste |

### Media
Poda de backups que borraba **los más nuevos** (ordenaba por etiqueta, no por fecha) · Revert que destruía la instantánea aunque fallara (dejando al usuario sin poder reintentar) · `claudeCode.*` previos no leídos si la extensión oficial no estaba instalada → Revertir los **borraba** · instantánea/copia buscadas en el directorio de la configuración *actual* y no en el del fichero al que pertenecen · fallo al podar abortaba la operación crítica · el gate Pro cancelaba también las **eliminaciones** de guardarraíles (rompía "quitar es siempre gratis") · `gitRootOf` subía hasta `$HOME` (dotfiles versionados) y convertía en global un perfil "por proyecto" · lectura→modal→escritura sin releer en los ficheros de proyecto (ahora con copia previa) · caducidad ignorada por la gracia · caché de Pro que una validación en vuelo pisaba tras activar · sin freno tras un fallo (15 s de espera en cada comando durante 14 días) · "estado de la licencia" no cancelable que bloqueaba los demás comandos · el juego `secrets` prometía impedir la edición y solo tenía reglas `Read` (ahora también `Edit`, porque `Read` no cubre NotebookEdit) · `metrics.mjs` **reemplazaba** el fichero entero si faltaba la cabecera y pisaba la fila del día con lecturas degradadas · rutas del script relativas al `cwd` · fecha en UTC · `release.yml` decidía "ya publicado" con un chequeo que falla en abierto (ahora publica y tolera "already exists"), token con permiso de escritura durante `npm ci`, y perfil de VS Code no temporal en los tests de integración.

### Baja
`.tmp` con los ajustes dentro si fallaba la escritura de reserva · restauración no atómica · raíz JSON no-objeto descartada en silencio · `handsfree.claudeSettingsPath` relativo (se resolvía contra el directorio de VS Code) · política gestionada ilegible tratada como "sin política" · `maskSecrets` sin cubrir credenciales en URL, webhooks ni `SECRET_ACCESS_KEY=` · redacción sin cubrir rutas UNC · el informe decía `~\settings.json` ocultando dónde vive el fichero · `in` alcanzando `Object.prototype` (`constructor` como "herramienta renombrada") · `Bash(npm run auto-accept-check *)` marcado como basura de terceros · "N reglas eliminadas" sin comprobar cuántas se quitaron · canal de salida y barra de estado que no se recreaban tras una segunda activación (y timer sin cancelar) · nombre del comando en inglés dentro del error traducido · quitar el perfil prudente sin comprobar el modo restringido · token de Open VSX en la línea de órdenes · workflows sin `concurrency` · Polar informando 0 claves cuando la llamada fallaba.

### Aceptado a propósito (sin cambio)
`HANDSFREE_PRO_DEV=1` sigue siendo "honor system" documentado en CONTRIBUTING · `l10n-sync.mjs` no analiza el AST (la lista blanca cubre el código actual) · los ficheros de política gestionada se leen de rutas reales de la máquina en los tests de integración (no hay forma de aislarlos en Linux).
