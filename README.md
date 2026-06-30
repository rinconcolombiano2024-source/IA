# Mi IA

Esta app permite que un usuario escriba una peticion y reciba:

- una respuesta de texto, como una carta, idea, resumen o historia;
- una imagen generada a partir de una descripcion;
- una decision automatica entre texto e imagen.

## Como usarla

1. Copia `.env.example` como `.env`.
2. En `.env`, cambia `pon-tu-clave-aqui` por tu clave de OpenAI.
3. Ejecuta:

```bash
.\start.ps1
```

4. Abre `http://localhost:3000`.

Si ya tienes Node.js instalado, tambien puedes ejecutar `npm start`.

## Archivos importantes

- `server.js`: protege tu clave y habla con la API de OpenAI.
- `public/index.html`: pantalla principal.
- `public/app.js`: conecta la pantalla con el servidor.
- `public/styles.css`: estilos visuales.

## Modelos

Puedes cambiar estos valores en `.env`:

```bash
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
```

Si tu cuenta no tiene acceso a alguno, cambia el modelo por otro disponible en tu cuenta.
