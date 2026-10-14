# Iteración de seguridad: límite de entrada HTTP

Base: 4787c3d5b5d421048838264ea4d2d6d2d0261434.

Baseline: 170 pruebas existentes aprobadas. Se inspeccionaron el servidor, el límite de autenticación, las rutas públicas, el control de concurrencia, el lector JSON y el pipeline CI. Esto no certifica una auditoría exhaustiva de todos los módulos ni los proveedores en producción.

Hallazgo P1 reproducido: la construcción de URL en el listener HTTP asíncrono estaba fuera de cualquier captura. Una cabecera Host malformada provocó ERR_INVALID_URL, conexión reiniciada y salida del proceso con código 1 antes de autenticar. El test aislado falló contra la base con ese resultado. No se enviaron peticiones malformadas a producción.

Corrección mínima: capturar únicamente el análisis inicial y devolver 400 INVALID_REQUEST_URL con request ID, cabeceras de seguridad y no-store. No devuelve la entrada ni una traza interna. Mantiene intactas autenticación, rutas públicas y proveedores.

Después: 171 pruebas aprobadas y sintaxis correcta. El nuevo test verifica dos entradas malformadas, continuidad del servidor y conservación de la frontera pública/privada. CI debe confirmar Node 18 y 22 antes de integrar.

Pendientes fuera de esta corrección: cuentas públicas con cuotas persistentes, confirmación operativa de proveedores con credenciales, persistencia/recuperación en producción y evaluación de calidad. Una interfaz pública no equivale a generación anónima ilimitada ni a una plataforma terminada.
