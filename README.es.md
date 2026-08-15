# Handsfree for Claude Code

**Instalar:** [Marketplace de VS Code](https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code) · [Open VSX](https://open-vsx.org/extension/argalla/handsfree-claude-code) (Cursor / VSCodium) · o ejecuta `code --install-extension argalla.handsfree-claude-code`.

**Deja que Claude Code trabaje sin pedir permiso, usando solo su configuración nativa.** Un comando activa el modo *bypass permissions* de Claude Code tal y como lo diseñó Anthropic (sin hooks, sin auto-clic, sin cuotas de uso), otro lo revierte byte a byte, y un **Doctor** te dice exactamente *por qué* Claude sigue preguntando cuando algo más en tu equipo se interpone.

> **Sin relación con Anthropic.** "Claude" es una marca de Anthropic, PBC. Esta extensión solo escribe ajustes que Claude Code y su extensión oficial de VS Code documentan y exponen.
>
> [Read in English](README.md)

---

## Por qué existe

Todas las extensiones de "auto-accept" hacen lo mismo con un truco distinto: un hook `PreToolUse` que dice *sí* a todo, un script que teclea en tu terminal, o DevTools pulsando el botón por ti. Todas se colocan **delante** del sistema de permisos de Claude Code, y todas fallan igual: cuando el hook se rompe, se agota su cuota de pago o Claude Code cambia un detalle, de repente te pide confirmar *cada herramienta* — y nada en pantalla te dice por qué.

Claude Code ya trae un modo autónomo. Solo que está repartido en **cuatro ajustes en dos ficheros**, más un diálogo de confirmación único que dentro de VS Code pasa desapercibido, más una memoria del "último modo que elegiste" en la extensión que gana en silencio a tus ajustes. Handsfree pone esos cuatro ajustes y se aparta.

**¿De verdad lo necesitas?** En los planes Pro, Max y Team, Claude Code arranca ya en **modo auto**: un segundo modelo aprueba las acciones rutinarias y bloquea las peligrosas. Si auto ya te vale, quédatelo: es la opción más segura y no necesita ninguna extensión. Handsfree es para cuando quieres *cero* diálogos y aceptas la contrapartida de abajo.

## Qué hace

| Comando | Qué ocurre |
| :-- | :-- |
| **Handsfree: Activar modo autónomo** | Diálogo de consentimiento con la lista exacta de ficheros que cambiarán → copia byte a byte → escribe los cuatro ajustes nativos → ofrece eliminar hooks/extensiones de auto-aceptación de terceros que los anularían → propone recargar. |
| **Handsfree: Revertir a la configuración anterior** | Restaura `settings.json` byte a byte y las dos claves de VS Code a sus valores previos a la *primera* activación (antes guarda copia del fichero actual). |
| **Handsfree: Doctor** | Responde a *"¿por qué me pregunta?"*: revisa el equipo, ordena problemas → avisos → notas → correcto, y ofrece **Arreglar** siempre que sea seguro (las políticas gestionadas y los ficheros ilegibles se explican, no se "arreglan"). Copia el informe (carpeta y nombre de usuario ocultados) para un issue o para un compañero. |

### Los cuatro ajustes nativos

| Fichero | Clave | Valor | Efecto |
| :-- | :-- | :-- | :-- |
| `~/.claude/settings.json` | `permissions.defaultMode` | `"bypassPermissions"` | Las sesiones de terminal arrancan sin diálogos. |
| `~/.claude/settings.json` | `skipDangerousModePermissionPrompt` | `true` | Deja respondido el diálogo único de "aceptar la responsabilidad" del modo bypass (Claude Code guarda esa respuesta en la configuración de usuario: es esta misma clave). |
| Ajustes de usuario de VS Code | `claudeCode.allowDangerouslySkipPermissions` | `true` | La extensión oficial se niega a abrir una conversación en bypass sin este interruptor. |
| Ajustes de usuario de VS Code | `claudeCode.initialPermissionMode` | `"bypassPermissions"` | Fija el modo inicial de las conversaciones nuevas. Sin él, la extensión usa **el último modo que elegiste en el indicador**, que gana a `defaultMode` — el clásico "lo tengo todo puesto y sigue preguntando". |

`skipDangerousModePermissionPrompt` va en el nivel raíz (ahí es donde lo guarda la propia CLI), aunque la documentación lo liste junto a los ajustes `permissions.*`. `CLAUDE_CONFIG_DIR` se respeta tal y como lo ve el proceso de VS Code: si solo lo exportas en el perfil de la shell, un VS Code lanzado desde el Dock/menú Inicio no lo verá; usa `handsfree.claudeSettingsPath` (ámbito de máquina) en ese caso.

### Lo que no hace, a propósito

- **Sin hooks.** Nada intercepta decisiones de permiso en tiempo de ejecución, así que nada puede empezar a responder "ask" a tus espaldas.
- **Sin auto-clic ni teclear en el terminal.** Nada que se rompa cuando cambia la interfaz.
- **Sin cuota, sin contador, sin "pasa a Pro para seguir".**
- **Nada se ejecuta al arrancar.** La extensión solo se activa cuando lanzas uno de sus comandos.
- **Sin telemetría, sin red** en las funciones gratuitas. La única llamada de red de toda la extensión es la activación de la licencia Pro y su revalidación cada 24 h, y solo en equipos donde hayas introducido una clave. Ver [PRIVACY.es.md](PRIVACY.es.md).

## El Doctor

Cada comprobación trae un arreglo a un clic cuando es seguro:

| Comprobación | Por qué importa |
| :-- | :-- |
| `settings.json` es JSON válido (señala la línea) | Una coma de más hace que Claude Code ignore **toda** la configuración de ese fichero, en silencio. |
| Los cuatro ajustes nativos | Si falta uno, siguen los diálogos. |
| Modo inicial sin fijar en la extensión | El último modo elegido en el indicador gana a `defaultMode`. |
| Hooks en `PreToolUse` / `PermissionRequest` de herramientas de auto-aceptación conocidas, o que aplican a todas las herramientas | Un hook que responde "ask" gana a cualquier modo. Los hooks legítimos de registro se marcan como aviso, nunca se eliminan sin preguntar. |
| Extensiones de auto-aceptación de terceros instaladas | Anulan el modo nativo; se ofrece desinstalarlas (con el motivo). |
| Política gestionada basada en fichero (`managed-settings.json` y `managed-settings.d/*.json`) que prohíbe bypass, fija un modo o define hooks | Solo un administrador puede cambiarla: el Doctor lo dice en vez de fallar. Las políticas por registro / MDM / servidor no son ficheros y no se inspeccionan. |
| `.claude/settings.json` / `settings.local.json` del proyecto que fija un modo, desactiva bypass o define hooks | La configuración del proyecto gana en las sesiones de terminal; la extensión de VS Code nunca la lee para el modo inicial. |
| Extensión oficial instalada y exponiendo los ajustes (validado contra su manifiesto) | Si Anthropic renombra una clave, Handsfree lo dice en vez de escribir basura. |
| Reglas allow que no hacen nada (`Tool(*)` junto a `Tool`, herramientas renombradas, restos de otras extensiones) | Cosmético; se ofrece limpiar. |
| Ficheros ilegibles (EACCES, unidad de red que no responde) | Se informan como tales, nunca se confunden con "inválido". |

## Seguridad

- **Consentimiento primero.** Activar muestra un diálogo modal que explica qué significa el modo bypass y lista los ficheros que cambiarán. No se escribe nada antes de aceptar.
- **Copias de seguridad.** Antes de cada escritura (Activar, Revertir, arreglos del Doctor) se guarda una copia byte a byte de `~/.claude/settings.json` en `~/.claude/backups/handsfree/`; se conservan las 10 más recientes y la copia que respalda Revertir nunca se poda. **Esas copias contienen lo mismo que tu configuración — incluidos bloques `env` con claves de API — con los mismos permisos que el original.**
- **Revertir es real.** Restaura el fichero original y las dos claves de VS Code, y antes copia el fichero actual. Activar → Activar → Revertir sigue volviendo al estado original.
- **Nunca sobre un fichero roto.** Si `settings.json` es inválido no se escribe nada; el Doctor lo abre en la línea del error.
- **El modo bypass es de Anthropic, con las reglas de Anthropic — y con su aviso.** La recomendación oficial es usarlo *solo en entornos aislados como contenedores, VMs o dev containers sin acceso a internet, donde Claude Code no pueda dañar tu equipo*. Las reglas `ask` y `deny` siguen aplicando, `rm -rf /` y `rm -rf ~` siguen preguntando (cortacircuitos), y Claude Code se niega a arrancar en este modo como root. Lee la [página oficial](https://code.claude.com/docs/en/permission-modes) antes de activarlo.

## Pro

La versión gratuita conserva **Activar, Revertir y el Doctor para siempre**: es la razón de ser de la extensión y nunca se bloqueará. Pro es una licencia de pago único (7 €) para lo que ahorra tiempo cuando ya te fías:

| Función Pro | Qué hace |
| :-- | :-- |
| **Perfil prudente por proyecto** | *"Handsfree: Marcar este proyecto como prudente"* escribe `permissions.disableBypassPermissionsMode = "disable"` (y `defaultMode = "default"` salvo que ya tuvieras fijado un modo que pregunta) en el `.claude/settings.local.json` del repositorio — en la raíz git, que es donde lo lee Claude Code — y añade ese fichero a `.git/info/exclude`. Claude Code rechaza bypass ahí (terminal y VS Code) mientras el resto de proyectos siguen autónomos. Se quita con un comando (siempre gratis). |
| **Guardarraíles** | Conjuntos listos de reglas `ask` / `deny` que Claude Code aplica **incluso en modo bypass**: preguntar antes de comandos de shell destructivos, mantener las herramientas de fichero de Claude fuera de `.env` / claves / `~/.ssh` (mejor esfuerzo: los scripts arbitrarios no se cubren; para bloqueo a nivel de SO usa el sandbox), preguntar antes de publicar paquetes, preguntar antes de cambiar infraestructura en la nube. Reglas nativas, sin hooks; se activan y desactivan por conjuntos; al quitar solo se retiran las reglas que añadió Handsfree. |
| **Exportar / importar** | Un JSON pequeño solo con las claves de modo de permisos y tus reglas ask/deny (nunca reglas allow, valores `env` ni hooks), para montar un segundo equipo o compartir con el equipo. |
| **Barra de estado** | Tras el primer comando de Handsfree en una ventana: indicador verde / aviso / "prudente", clic para el Doctor. |

Las licencias se venden a través de [Polar](https://polar.sh) (merchant of record: factura y gestiona el IVA, así que el checkout muestra el precio final para tu país). La activación envía a Polar tu clave, el nombre de este equipo, tu sistema operativo y la versión de la extensión, nunca nada de tu configuración; la licencia sigue funcionando sin conexión 14 días entre comprobaciones, y una mala respuesta del servidor de licencias nunca es definitiva (se reintenta a las 24 h); si Polar informa de que la clave está revocada (por ejemplo tras una devolución), Pro se apaga en la siguiente comprobación, y vuelve a encenderse si la clave se rehabilita. Las activaciones por clave son un límite configurado en la licencia (tres por defecto); desactiva en un equipo para moverla. **Quitar lo que Pro añadió — un perfil prudente, un conjunto de guardarraíles — es siempre gratis**, así que una licencia caducada nunca te deja atrapado con diálogos. Ver [PRIVACY.es.md](PRIVACY.es.md).

## Requisitos

- VS Code 1.95+. VSCodium / Cursor / Windsurf la instalan desde Open VSX; la extensión usa solo APIs estándar. Verificada en VSCodium 1.126 (la suite de integración hermética pasa allí sin cambios); Cursor y Windsurf aún no se han probado.
- CLI de Claude Code; la extensión oficial **Claude Code** (`anthropic.claude-code`) para la parte de VS Code. Sin ella solo se escriben los ajustes de la CLI.
- Remote-SSH / WSL / Dev Containers: se ejecuta donde se ejecuta Claude Code (`extensionKind: workspace`). Las extensiones instaladas en el *otro* lado no son visibles para el Doctor.

## Preguntas frecuentes

**Lo activé y Claude preguntó una vez más.** La primera conversación justo después de instalar o actualizar Claude Code ignora los ficheros de configuración; la segunda los respeta. Recarga también la ventana tras activar.

**Solo pregunta en un proyecto.** Ese proyecto tiene `.claude/settings.json` o `settings.local.json` fijando un modo o desactivando bypass; el Doctor lo muestra. Es un perfil por proyecto, quizá deliberado.

**Pregunta con `git push --force` / un comando concreto.** Una regla `ask` (tuya o de tu organización) sigue forzando el diálogo en modo bypass. Es a propósito.

**¿Funciona con `claude` en el terminal?** Sí: `permissions.defaultMode` cubre las sesiones de terminal; las dos claves de VS Code cubren la extensión.

**¿Puede bloquearlo mi organización?** Sí. `permissions.disableBypassPermissionsMode: "disable"` en la configuración gestionada gana a todo; Handsfree lee la configuración gestionada basada en fichero y se niega a escribir cuando prohíbe bypass.

## Ajustes

| Ajuste | Predeterminado | Descripción |
| :-- | :-- | :-- |
| `handsfree.claudeSettingsPath` | `""` | Ruta al fichero de configuración de usuario de Claude Code. Vacío = `~/.claude/settings.json` (o `$CLAUDE_CONFIG_DIR/settings.json`). Ámbito de máquina. |

## Contribuir

Licencia MIT, hecha por [Argalla](https://argalla.com) (Tecniart Galicia SL). Issues y PRs en [github.com/TecniartGalicia/handsfree-claude-code](https://github.com/TecniartGalicia/handsfree-claude-code). Ver [CONTRIBUTING.md](CONTRIBUTING.md); avisos de seguridad según [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE) © 2026 Tecniart Galicia SL (Argalla).
