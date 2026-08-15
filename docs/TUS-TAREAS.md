# TUS TAREAS — Handsfree for Claude Code

Lo que solo tú puedes hacer (cuentas, claves, decisiones). Todo lo demás está hecho y verificado. Marca cada casilla al terminar; cuando estén las de un bloque, dímelo y sigo yo.

## Bloque A · Publicar la extensión gratuita (F3)

- [ ] **A1. Publisher en el Marketplace de VS Code.** Entra en https://marketplace.visualstudio.com/manage con una cuenta Microsoft (la de Tecniart), crea el publisher con **ID `argalla`** (es el que lleva `package.json`; si estuviera ocupado dímelo y cambio el ID) y nombre "Argalla". Rellena web `https://argalla.com`. Opcional pero recomendable: verificar el dominio `argalla.com` (registro TXT que te muestra la propia página) → insignia azul.
- [ ] **A2. Token del Marketplace (VSCE_PAT).** En https://dev.azure.com → tu organización (crea una si no la hay) → User settings → Personal access tokens → New token: nombre `vsce-handsfree`, Organization **"All accessible organizations"**, Scopes → **Marketplace: Manage**. Copia el token una sola vez.
- [ ] **A3. Token de Open VSX (OVSX_PAT).** Cuenta en https://open-vsx.org (login con GitHub `TecniartGalicia`), crea el namespace `argalla` (Settings → Namespaces → Create) y un Access Token (Settings → Access Tokens). Open VSX es lo que usan Cursor, VSCodium y Windsurf: la mitad de los usuarios de Claude Code están ahí.
- [ ] **A4. Secretos en GitHub.** En https://github.com/TecniartGalicia/handsfree-claude-code/settings/secrets/actions añade `VSCE_PAT` y `OVSX_PAT`. Con eso, cada tag `vX.Y.Z` publica solo (workflow `release.yml`).
- [ ] **A5. Habilitar Discussions** en el repo (Settings → General → Features → Discussions) — `package.json` apunta las Q&A ahí.
- [ ] **A6. Primera publicación.** Cuando A1–A4 estén: dímelo y creo el tag `v0.1.0` (o lo haces tú: `git tag v0.1.0 && git push --tags`). Alternativa manual sin CI: `npx vsce publish --no-dependencies -p <VSCE_PAT>` desde la carpeta del proyecto.

## Bloque B · Pro y licencias (F4)

- [ ] **B1. Cuenta en Polar** (https://polar.sh) con los datos fiscales de Tecniart Galicia SL (Polar es *merchant of record*: factura él, liquida el IVA de cada país y te paga). Crea la organización `argalla`.
- [ ] **B2. Producto "Handsfree Pro"**: pago único, **7 €**, con el beneficio **License Keys** activado (límite de activaciones: 3 por clave, para 3 máquinas). Copia el **Organization ID** (Settings → General) y pégalo en `src/pro/polar.ts` (`POLAR_ORGANIZATION_ID`), o dámelo y lo pongo yo. Sin ese ID la activación Pro dice "not configured".
- [ ] **B3. Enlace de compra**: copia la URL de checkout del producto y pégala en `src/pro/polar.ts` (`POLAR_CHECKOUT_URL`) o dámela.
- [ ] **B4. Textos legales**: revisa PRIVACY.md (párrafo de licencias) y el aviso del README con tu asesoría si quieres; son mínimos y ciertos, pero la decisión de vender es tuya.

## Bloque C · Lanzamiento (F5)

- [ ] **C1.** Aprobar los textos de anuncio en `docs/LANZAMIENTO.md` (Reddit r/ClaudeAI, X/LinkedIn, página en argalla.com).
- [ ] **C2.** Publicarlos desde tus cuentas (yo no tengo acceso a ellas).
- [ ] **C3.** Calendario: revisión a 60 días con los datos de instalaciones del Marketplace (Manage → Reports) y ventas de Polar → decidir seguir/ampliar/congelar.

## Ya hecho (para que no lo dupliques)

- Repositorio público creado: https://github.com/TecniartGalicia/handsfree-claude-code (topics puestos; el push del código lo hago yo al cerrar cada fase).
- Extensión completa (Activar / Revertir / Doctor), EN+ES, tests unitarios e integración, CI en GitHub Actions, `.vsix` empaquetado e instalado con éxito en un VS Code limpio.
- Icono con paleta Argalla (`media/icon.png` + `.svg`, generados por `scripts/make-icon.mjs`).
