# Plan de seguimiento y difusión — Handsfree for Claude Code

Desde el 2026-08-16 (día 1 tras el lanzamiento) hasta la revisión de los 60 días (**2026-10-14**). Tres bloques: **medir**, **publicar**, **buscar espacios**. Registro en `docs/METRICAS.md` (automático) y `docs/DIFUSION.md` (manual: dónde se ha publicado, qué pasó, cuándo reintentar).

## 0. Qué mide el éxito (criterio ya fijado)
- **Primario**: instalaciones en el Marketplace (Manage → Reports es la cifra buena; la API pública se queda corta y va con horas de retraso) + ventas Pro en Polar.
- **Secundario**: descargas Open VSX (mucho bot; mirar tendencia, no valor absoluto), estrellas/issues/discussions en GitHub, reseñas y Q&A del Marketplace, menciones (Reddit/HN/X).
- **Decisión a 60 días**: > 2.500 instalaciones **o** > 30 ventas → seguir invirtiendo (más chequeos del Doctor, perfiles por equipo, quizá versión "team"); si no, mantenimiento mínimo y aprovechar lo aprendido en la siguiente idea de `ideasVs`.

## 1. Cadencia

| Cuándo | Qué (agente salvo que se diga lo contrario) | Herramienta |
|---|---|---|
| **Diario, días 1-14** | `node scripts/metrics.mjs --append` → fila nueva en METRICAS.md. Leer: issues/discussions del repo, Q&A y reseñas del Marketplace, comentarios en X/LinkedIn/Reddit, correo del publisher (soporte). Responder en < 24 h. Anotar cualquier bug → issue → arreglar → versión de parche. | script + navegador de automatización |
| **Semanal (lunes)** | Métricas + resumen de 5 líneas (qué subió, qué no). **1 pieza de contenido** (§2) publicada en X + LinkedIn. **1 espacio nuevo** de la lista §3 atacado (post, respuesta útil o envío). Comprobar Reddit: si r/ClaudeAI ya acepta la cuenta (≥ 23-ago) publicar allí; si los mods de r/BuildWithClaude aprobaron. | script + navegador |
| **Quincenal** | Revisar la lista de "preguntas que la gente hace" (§4) y decidir si el Doctor necesita un chequeo nuevo. Fusionar dependabot. Si hay ≥ 1 cambio de valor → tag de versión (CHANGELOG). | repo |
| **Mensual (15-sep, 14-oct)** | Informe: tabla METRICAS resumida, lo publicado (DIFUSION.md), aprendizajes, decisión de siguiente mes. Reenviar la nota a los canales si hubo versión nueva. | — |
| **2026-10-14** | Revisión de 60 días con el criterio del §0. | — |
| Automatizable | Con `/loop 7d` o una rutina programada (`/schedule`) que ejecute "métricas + lectura de canales + informe"; el humano solo revisa el informe. Ver §6. | Claude Code |

## 2. Calendario de contenidos (12 semanas)

Reglas: honesto, útil aunque no instales nada, sin atacar a nadie, "not affiliated" cuando se nombra a Anthropic, un enlace por pieza (Marketplace o repo). Formato base: hilo de X (3-4) + post de LinkedIn (EN + ES) + versión larga en dev.to cuando toque. Cada pieza sale de una **función real** o de un **hallazgo del Doctor** (así también documentamos el producto).

| Semana | Pieza | Formato / dónde |
|---|---|---|
| 1 (16-22 ago) | *Lanzamiento* (hecho: X + LinkedIn). Repost personal del titular. | X, LinkedIn |
| 2 | **"La coma que apaga todo tu settings.json"** — Claude Code ignora el fichero entero si hay un JSON inválido; cómo lo detecta el Doctor (línea y columna). GIF de 10 s. | X hilo, LinkedIn, dev.to (artículo largo con los 4 sospechosos) |
| 3 | **"El último modo que elegiste gana a tu defaultMode"** — precedencia real de modos en la extensión de VS Code (initialPermissionMode > indicador > defaultMode). | X, LinkedIn |
| 4 | **Reddit r/ClaudeAI** (cuenta ya con edad) — el post original de lanzamiento. Show HN el mismo día si el post va bien. | Reddit, HN |
| 5 | **Guardarraíles**: reglas `ask/deny` que se aplican incluso en bypass; los 4 juegos y por qué son "mejor esfuerzo". | X, LinkedIn, dev.to |
| 6 | **Perfil prudente por proyecto** — cómo dejar un repo concreto pidiendo permiso mientras el resto va autónomo (`disableBypassPermissionsMode` en la raíz git). | X, LinkedIn |
| 7 | **VSCodium / Cursor** — misma extensión desde Open VSX, cómo se probó (suite hermética). Menciona r/vscode y r/cursor. | X, Reddit r/vscode |
| 8 | **Changelog 0.2** (lo que salga de issues) + "cómo funcionan las licencias sin telemetría" (offline 14 días, revalidación 24 h). | X, LinkedIn, GitHub Release notes |
| 9 | Artículo ES: **"Por qué Claude Code te pide permiso aunque hayas activado el modo autónomo"** (audiencia hispana). | LinkedIn ES, dev.to ES / blog Argalla si existe |
| 10 | Vídeo corto (60-90 s): Enable → Doctor → Revert. | YouTube Shorts / X / LinkedIn |
| 11 | Product Hunt (martes) con el tagline de LANZAMIENTO §4. | PH + aviso en X/LinkedIn |
| 12 | Balance público: qué aprendimos publicando una extensión de pago único (números reales). | dev.to, LinkedIn |

## 3. Espacios donde difundir (prioridad y reglas)

Marcar en `docs/DIFUSION.md` cada uno con fecha, URL y resultado.

**A. Comunidades de Claude Code (las que importan)**
1. **r/ClaudeAI** — reintentar ≥ 2026-08-23 (AutoModerator: cuenta nueva) o desde cuenta antigua; flair *Built with Claude*; karma > 50 para el feed, si no va al Megathread (también vale publicarlo ahí como comentario).
2. **r/ClaudeCode** (sub específico) y **r/BuildWithClaude** (mods avisados; volver a intentar en 1 semana).
3. **anthropics/claude-code — GitHub Discussions "Show and tell"** e issues sobre permisos: responder con contexto útil, no solo el enlace.
4. **Discord de Anthropic (Claude Developers)** canal *showcase / built-with-claude* — humano (requiere cuenta Discord).
5. **awesome-claude-code** (GitHub, lista de recursos) — abrir PR añadiendo la extensión (sección tools/IDE).

**B. Comunidad VS Code**
6. **r/vscode** (permite showcases de extensiones open source; leer reglas de autopromoción: participar antes).
7. **VS Code Discord (comunidad oficial "VS Code Dev")** canal de extensiones — humano.
8. **awesome-vscode** (lista) — PR.
9. **Q&A del propio Marketplace**: responder cada pregunta el mismo día (cuenta como señal de calidad).

**C. Prensa técnica / agregadores**
10. **Hacker News — "Show HN: Handsfree for Claude Code – autonomous mode with native settings, plus a Doctor"** (martes-jueves 14:00-16:00 CEST; nunca pedir votos; responder todos los comentarios la primera hora).
11. **dev.to** (etiquetas #vscode #ai #productivity), **Hashnode**, **Medium** — artículo largo de la semana 2 y el de la semana 12.
12. **Product Hunt** — semana 11 (preparar 3 capturas + GIF, primer comentario del maker con la historia del 11-ago).
13. Newsletters con formulario de envío: **TLDR** (tldr.tech/submit), **Console.dev** (console.dev/submit), **VS Code newsletter de la comunidad** (si sigue activa), **Changelog Nightly** (lo recoge solo si el repo suma estrellas).
14. **Cursor community forum** (forum.cursor.com) — sección Showcase, tras confirmar que funciona en Cursor.

**D. Hispanohablante / local**
15. LinkedIn ES (perfil + página de empresa Tecniart/Argalla si existe), grupos de LinkedIn de desarrollo, X en castellano.
16. Comunidades: **r/programacion**, **Foro de Discord "Programación en español"/"DevsLatam"**, **Genbeta Respuestas**? (baja prioridad), meetups Galicia (Python Vigo, GDG Coruña, Xantar Tech…) — presentar la historia (10 min) cuando haya cifras.
17. Blog de Argalla / web corporativa (cuando exista): la página de LANZAMIENTO §3.

**E. Directo (mayor tasa de conversión)**
18. **Responder preguntas reales**: buscar cada semana en Reddit/X/GitHub issues "claude code keeps asking permission", "bypassPermissions not working", "auto accept claude code", "settings.json ignored" y contestar con el diagnóstico (y, si procede, el Doctor). Máximo 1 enlace, siempre con la explicación completa en el propio comentario.
19. Personas que ya usan Claude Code y publican sobre él (creadores de contenido en X/YouTube): DM breve ofreciendo licencia Pro gratis a cambio de nada (sin exigir reseña).

## 4. Qué buscar cada semana (para responder y para mejorar el Doctor)
Consultas (Reddit search desde el navegador con sesión —la búsqueda anónima está bloqueada—, X search, GitHub issues de `anthropics/claude-code`, HN Algolia):
`claude code asking permission`, `bypassPermissions`, `skipDangerousModePermissionPrompt`, `initialPermissionMode`, `auto accept claude code`, `auto approve claude code extension`, `claude code settings.json ignored`, `PreToolUse hook ask`, `disableBypassPermissionsMode`, `Handsfree for Claude Code`, `argalla`.
Cada hallazgo relevante → fila en DIFUSION.md (URL, qué se respondió) y, si revela un caso nuevo, issue en el repo "Doctor: detectar X".

## 5. Registro y plantillas
- `docs/METRICAS.md` — lo escribe `scripts/metrics.mjs --append` (Marketplace, Open VSX, GitHub, HN, Reddit si deja; Polar solo con `POLAR_OAT`).
- `docs/DIFUSION.md` — tabla: fecha · canal · URL · resultado · siguiente acción.
- Respuestas: tono corto y concreto; empezar por el diagnóstico del problema de la persona; enlace al final solo si aporta; nunca menospreciar otras extensiones (basta con "la nuestra no usa hooks ni auto-clic").

## 6. Automatización propuesta (opcional, un comando)
- Métricas: `node scripts/metrics.mjs --append` (sin dependencias). Para Polar por API: crear un *Organization Access Token* de solo lectura (polar.sh → Settings → Developers → New token, scopes `orders:read`, `license_keys:read`) y guardarlo como `POLAR_OAT=` en `Documents/handsfree-secrets.txt`.
- Rutina semanal (Claude Code): `/loop 7d` con el prompt "ejecuta node scripts/metrics.mjs --append en handsfree-claude-code, lee issues/discussions/reseñas/Q&A y los hilos de X/LinkedIn/Reddit publicados en DIFUSION.md, resume en 10 líneas y propón la pieza de contenido de la semana según PLAN-SEGUIMIENTO §2" — o una rutina en la nube con `/schedule` si se prefiere que corra sin el equipo encendido.
- Reddit/X con sesión: el navegador de automatización (`~/handsfree-browser`) mantiene las sesiones; el agente puede leer comentarios y borradores, y publicar previa aprobación del texto.

## 7. Lo que necesita el humano (mínimo)
- [ ] Repostear el lanzamiento desde su cuenta personal de X y LinkedIn (las de Argalla tienen 0 seguidores).
- [ ] Una cuenta de Reddit con antigüedad para r/ClaudeAI/r/vscode antes del 23-ago (o esperar).
- [ ] Discord de Anthropic y de VS Code (registro y post en showcase; el agente prepara el texto).
- [ ] Opcional: `POLAR_OAT` de solo lectura para automatizar ventas en METRICAS.md.
- [ ] Opcional: grabar el vídeo de 60-90 s (semana 10) — o dejar que el agente prepare un GIF con la suite de integración.
