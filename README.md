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
