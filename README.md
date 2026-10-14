# Mi IA Max

Esta es una base robusta para una plataforma de IA generalista. Permite que un usuario pida texto, documentos, menus de restaurante, libros, codigo, paginas web, imagenes y videos.

## Capacidades incluidas

- Chat y escritura general.
- Generacion de documentos descargables en Markdown, HTML, TXT, PDF y Word `.docx`.
- Menus de restaurante listos para imprimir.
- Estructura y primer contenido de libros.
- Paquetes de codigo descargables en ZIP.
- Paginas web con HTML, CSS y JavaScript.
- Imagenes con la API de imagenes.
- Video con la API de video, si tu cuenta tiene acceso.
- Historial local de trabajos.
- Registro local de errores y respuestas de recuperacion.
- Ruta de salud: `http://localhost:3000/api/health`.

## Limites honestos

Ninguna IA puede garantizar cero errores, conciencia propia real, aprendizaje autonomo ilimitado o reparacion perfecta sin supervision. Esta app si incluye una arquitectura preparada para crecer: herramientas por tipo de tarea, historial local, reintentos, diagnostico de fallos y archivos descargables.

## Como usarla

1. Copia `.env.example` como `.env`.
2. En `.env`, cambia `pon-tu-clave-aqui` por tu clave de OpenAI.
3. Ejecuta:

```powershell
.\start.ps1
```

4. Abre `http://localhost:3000`.

Si ya tienes Node.js instalado, tambien puedes ejecutar:

```bash
npm start
```

## Como desplegar en Vercel

1. Sube esta carpeta al repositorio conectado con Vercel.
2. En **Vercel > Project > Settings > Environment Variables**, configura como minimo:

```bash
APP_AUTH_USER=admin
APP_AUTH_PASSWORD=usa-una-clave-larga-unica-y-segura

OPENAI_API_KEY=tu-clave-real
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_VIDEO_MODEL=sora-2
```

`APP_AUTH_PASSWORD` es obligatoria en produccion. No copies el valor de ejemplo literalmente y nunca guardes la contraseña real en GitHub.

3. Aplica las variables al entorno **Production** y, si utilizas previews, tambien a **Preview**.
4. Haz un nuevo deployment despues de guardar las variables.
5. Abre la URL de Vercel: la pagina principal y sus recursos son publicos, sin contrasena de administrador.
6. Comprueba `/api/public-status` sin autenticarte. Las rutas de pago y privadas (`/api/run`, `/api/history`, `/api/health`, `/api/video/*`, `/generated/*`) siguen protegidas con autenticacion temporal de administrador.

**Atencion:** hacer publica la interfaz NO habilita llamadas anonimas a modelos de pago. El registro de usuarios y las cuotas persistentes deben implementarse y probarse antes de liberar el uso de IA a todas las cuentas. La contrasena APP_AUTH_PASSWORD nunca se comparte con visitantes ni se incorpora a la aplicacion cliente.

Si aparece:

```json
{"error":"La aplicacion no tiene configurada la autenticacion.","code":"AUTH_NOT_CONFIGURED"}
```

la aplicacion esta cerrando el acceso de forma segura porque faltan `APP_AUTH_USER` o `APP_AUTH_PASSWORD` en ese deployment. No desactives la autenticacion para resolverlo: configura ambas variables y vuelve a desplegar.

Para habilitar otros proveedores, agrega sus claves solo en Vercel, nunca en el repositorio:

```bash
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
GROQ_API_KEY=
```

En Vercel, los archivos creados por la IA se guardan temporalmente durante la vida de la funcion. Para datos importantes utiliza la persistencia externa configurada por el proyecto.

## Configuracion principal

```bash
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_VIDEO_MODEL=sora-2
OPENAI_REASONING_EFFORT=medium
```

Si tu cuenta no tiene acceso a algun modelo, cambia el valor por un modelo disponible en tu cuenta.

## Archivos importantes

- `server.js`: servidor, enrutador de tareas, llamadas a OpenAI y generadores de archivos.
- `public/index.html`: pantalla principal.
- `public/app.js`: logica de la interfaz.
- `public/styles.css`: diseno responsive.
- `generated/`: trabajos creados por la IA.
- `data/history.json`: historial local de trabajos.
- `data/errors.log`: errores registrados para diagnostico.
