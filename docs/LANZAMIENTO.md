# Lanzamiento — Handsfree for Claude Code

Textos listos para publicar desde tus cuentas. Cada bloque tiene versión EN (canal principal: la comunidad de Claude Code es anglófona) y ES. Enlaces reales (0.1.1 publicada el 2026-08-15).

Reglas que sigo en todos los textos: sin "Claude" al frente del nombre, "not affiliated with Anthropic" visible, nada de prometer "cero problemas": la extensión configura lo nativo y diagnostica; el modo bypass es de Anthropic y lleva su aviso.

---

## 1 · Reddit r/ClaudeAI (y r/vscode) — EN

**Title:** I got tired of "auto-accept" extensions breaking, so I made one that only uses Claude Code's own settings — plus a Doctor that tells you *why* it's still asking

**Body:** *(la anécdota es literalmente lo que nos pasó el 11-ago; publícala solo si te sientes cómodo contándola en primera persona)*

Last week my "auto-accept" extension for Claude Code hit its paid quota and silently started answering *"ask"* to every single tool call. It took me an afternoon to figure out why Claude was suddenly asking permission for `ls`. Turned out there were four separate things wrong: a hook returning "ask", a stray comma in `settings.json` (which makes Claude Code ignore the *whole* file), the VS Code extension's "allow dangerously skip permissions" toggle, and the extension remembering the last mode I picked in the indicator — which outranks `defaultMode`.

So I wrote **Handsfree for Claude Code**. It does exactly three things:

- **Enable autonomous mode** — sets the four native settings (`permissions.defaultMode`, `skipDangerousModePermissionPrompt`, `claudeCode.allowDangerouslySkipPermissions`, `claudeCode.initialPermissionMode`) after a consent dialog and a byte-exact backup. No hooks, no auto-clicking, no quota. Nothing runs at startup.
- **Revert** — puts `settings.json` and the two VS Code keys back exactly as they were (a safety copy first).
- **Doctor** — answers "why is Claude asking me?": broken JSON (with the line), missing settings, unpinned starting mode, hooks that decide permissions, third-party auto-accept extensions, managed policy, project overrides… with a one-click fix where it's safe, and a copyable report with your home dir redacted.

Free, MIT, English + Spanish. Not affiliated with Anthropic — and honestly, if Claude Code's *auto* mode already works for you, keep it; this is for the "I want zero prompts and I accept the trade-off" crowd. Bypass mode is Anthropic's, with their warning: containers/VMs, repos you trust.

There's an optional Pro (one-time 7 €) with per-project "careful" profiles, guardrail rule sets that keep prompting *even in bypass mode* (`ask`/`deny` rules, no hooks), export/import and a status bar. Removing anything Pro added is always free.

Marketplace: https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code · Open VSX (verified in VSCodium; Cursor/Windsurf should work too — standard APIs only): https://open-vsx.org/extension/argalla/handsfree-claude-code · Source: https://github.com/TecniartGalicia/handsfree-claude-code

Happy to answer questions about the settings precedence — the Doctor's texts are basically the docs' "which mode a session starts in" section, applied.

---

## 2 · X / LinkedIn — EN (hilo corto)

1/ Claude Code already has an autonomous mode. It's just spread over 4 settings in 2 files, a one-time dialog that's easy to miss in VS Code, and a "last mode you picked" memory that outranks your settings. I made a VS Code extension that sets those 4 and gets out of the way: **Handsfree for Claude Code**.

2/ No hooks. No auto-clicking. No quota. Nothing at startup. Consent dialog + byte-exact backup + real Revert. And a **Doctor** that tells you *why* Claude is still asking (broken JSON at line N, hook returning "ask", extension toggle, project override…) with one-click fixes.

3/ Free, MIT, EN+ES. Not affiliated with Anthropic. If Claude Code's auto mode works for you, keep it — this is for zero-prompt workflows in repos you trust. Optional Pro (7 € once): careful-per-project profiles, guardrails that still prompt in bypass, export/import.

https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code · https://github.com/TecniartGalicia/handsfree-claude-code

## 2b · X / LinkedIn — ES

1/ Claude Code ya trae un modo autónomo. Solo que está repartido en 4 ajustes de 2 ficheros, un diálogo único que en VS Code pasa desapercibido y una memoria del "último modo que elegiste" que gana a tu configuración. He hecho una extensión de VS Code que pone esos 4 ajustes y se aparta: **Handsfree for Claude Code**.

2/ Sin hooks. Sin auto-clic. Sin cuota. Nada al arrancar. Consentimiento + copia byte a byte + Revertir de verdad. Y un **Doctor** que te dice *por qué* Claude sigue preguntando (JSON roto en la línea N, hook que responde "ask", interruptor de la extensión, override del proyecto…) con arreglos a un clic.

3/ Gratis, MIT, EN+ES. Sin relación con Anthropic. Si el modo auto de Claude Code ya te vale, quédatelo: esto es para flujos sin diálogos en repos de confianza. Pro opcional (7 € una vez): perfiles prudentes por proyecto, guardarraíles que siguen preguntando en bypass, exportar/importar.

https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code · https://github.com/TecniartGalicia/handsfree-claude-code

---

## 3 · Página en argalla.com — ES (sección de producto / blog)

**Handsfree for Claude Code**
*Deja que Claude Code trabaje sin pedir permiso — con su propia configuración, no con trucos.*

Cuando Claude Code pide permiso para cada herramienta suele haber cuatro sospechosos, y ninguno aparece en pantalla: un `settings.json` con una coma de más (Claude Code ignora entonces el fichero completo, en silencio), un hook de una extensión de "auto-aceptar" que agotó su cuota y ahora responde "ask" a todo, el interruptor `allowDangerouslySkipPermissions` de la extensión oficial, y el último modo que elegiste en el indicador, que gana a `defaultMode`.

En su versión gratuita, Handsfree hace tres cosas y ninguna más:

- **Activar modo autónomo.** Diálogo de consentimiento con la lista exacta de ficheros que cambian, copia byte a byte, y los cuatro ajustes nativos. Sin hooks, sin auto-clic, sin cuota, nada al arrancar VS Code.
- **Revertir.** Devuelve `settings.json` y las dos claves de VS Code al estado previo. Activar → Activar → Revertir vuelve al original.
- **Doctor.** Responde a "¿por qué me pregunta?" con una lista ordenada de problemas → avisos → notas, arreglo a un clic donde es seguro, e informe copiable con tu carpeta de usuario ocultada.

Gratis y de código abierto (MIT), en inglés y castellano. Sin relación con Anthropic: solo escribe ajustes que Claude Code y su extensión oficial documentan. Y una recomendación honesta: si el modo *auto* de Claude Code ya te sirve, quédatelo — es la opción más segura. Handsfree es para quien quiere cero diálogos y acepta el aviso de Anthropic sobre el modo bypass (entornos aislados, repos de confianza).

**Pro (7 €, pago único):** perfil "prudente" por proyecto (Claude vuelve a preguntar solo en ese repositorio), guardarraíles — conjuntos de reglas `ask`/`deny` que Claude Code aplica incluso en modo bypass —, exportar/importar el perfil a otro equipo y barra de estado. Quitar lo que Pro añadió es siempre gratis.

[Instalar desde el Marketplace](https://marketplace.visualstudio.com/items?itemName=argalla.handsfree-claude-code) · [Open VSX (VSCodium verificado; Cursor / Windsurf)](https://open-vsx.org/extension/argalla/handsfree-claude-code) · [Código en GitHub](https://github.com/TecniartGalicia/handsfree-claude-code)

Handsfree es de Argalla, la línea tecnológica de Tecniart Galicia. Si tu equipo usa Claude Code y quiere una configuración coherente en todas las máquinas, hablamos.

---

## 4 · Descripción corta para directorios / Product Hunt — EN

**Tagline:** Handsfree for Claude Code — autonomous mode with native settings, not hacks.

**Description (≤ 260 chars):** One command turns on Claude Code's native bypass mode (consent + backup + revert), and a Doctor tells you *why* it's still asking. No hooks, no auto-clicking, no quotas, nothing at startup. Free, MIT, EN/ES. Not affiliated with Anthropic.

---

## 5 · Métricas

- **Instalaciones**: Marketplace → Manage → Reports; Open VSX → página de la extensión.
- **Uso**: no hay telemetría a propósito; la señal real serán issues, Discussions y reseñas.
- **Pro**: panel de Polar.
- El criterio de revisión a 60 días está en TUS-TAREAS (privado).
