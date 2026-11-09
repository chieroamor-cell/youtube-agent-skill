# InfamousHub · YouTube — conexión del mismo canal (2026-11-08)

**Estado:** Nuevo conector de Cloudflare funcionando, pero todavía sin un canal de YouTube autorizado. No está permitido editar, publicar ni eliminar vídeos.

## Configuración realizada

- Conector independiente: `https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/connect`
- Google OAuth Web Client creado y secretos presentes en el nuevo Cloudflare: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_ADMIN_CODE`.
- Cliente OAuth activo para iniciar la autorización: `OAUTH_ENABLED=YES`.
- Datos de canal y sesiones en D1 europea `infamoushub-youtube-oauth`. El token de actualización de Google se cifra mediante AES-GCM con clave privada separada.
- Los 11 comandos originales de YouTube Agent Skill, el bot de Shorts y la cuenta antigua de Cloudflare permanecen intactos.

## Instrucciones — dos pasos en Chrome

1. Abrir la URL del conector en **Chrome normal**, no en el navegador integrado de otra aplicación. Si se abre dentro de ChatGPT, utilizar el menú ⋮ del navegador para elegir *Abrir en Chrome*.
2. Introducir una sola vez la contraseña de administración (24+ caracteres). Pulsar **1. Entrar**. Si es correcta, el navegador recibe una cookie de sesión `Secure`, `HttpOnly` y `SameSite=Lax` válida durante **20 minutos**. En D1 se guarda únicamente el hash de un token aleatorio de sesión; no se guarda la contraseña.
3. Se muestra una pantalla separada **Sesión iniciada**, con **2. Conectar mi YouTube** y **Cerrar sesión**.
4. Pulsar **2. Conectar mi YouTube**. Para evitar redirecciones automáticas bloqueadas en el móvil, aparece un enlace visible **Continuar con Google y seleccionar mi canal**. Abrirlo en la **misma ventana de Chrome** para conservar cookies y autorización de 10 minutos.
5. En Google, elegir la cuenta que administra el mismo canal donde publica los Shorts. Conocer el correo no basta: verificar el nombre y el ID de canal real (prefijo `UC`) en la pantalla de confirmación.
6. Tras regresar desde Google, confirmar el canal explícitamente. No es necesario volver a introducir la contraseña mientras la sesión de 20 minutos siga activa.
7. Realizar primero una lectura del canal y después una prueba sobre un vídeo **privado**. Las modificaciones de títulos, descripciones y miniaturas siguen deshabilitadas.

## Límites y seguridad

- Un error de contraseña nunca debe mostrar secretos ni redirigir a Google; el formulario utiliza doble comprobación CSRF y límites de tamaño.
- El permiso solicitado, `youtube.force-ssl`, es amplio: la aplicación no tiene endpoints para modificar, eliminar ni publicar vídeos, pero Google mostrará las capacidades de ese permiso. Revisar cuidadosamente antes de consentir.
- `OAUTH_ADMIN_CODE`, `GOOGLE_OAUTH_CLIENT_SECRET`, claves y tokens se mantienen solo en Cloudflare Secrets; **no compartirlos por capturas, chat o GitHub**.
- Las autorizaciones externas en modo *Testing* pueden caducar a los 7 días. Antes de automatizar será necesario revisar el estado de la pantalla de consentimiento y el posible proceso de verificación de Google.
- La autorización de Google no es todavía una automatización periódica del optimizador; falta desarrollar un agente de ejecución privada para títulos y miniaturas.

## Autorización de retorno de Google (ya configurada en su cliente OAuth)

`https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/oauth/callback`

**No modificar las credenciales OAuth del bot antiguo.**

Documentación: <https://developers.google.com/identity/protocols/oauth2/web-server> y <https://developers.google.com/youtube/v3/guides/authentication>

## Recuperación del retorno de Google (corrección 2026-11-08)

- Se ha corregido el fallo que podía mostrar `GOOGLE_CALLBACK`: los intentos OAuth caducados se detectan sin ejecutar sentencias de escritura con `.first()`. Las actualizaciones de D1 usan `.run()` y verifican que **exactamente una** fila cambió.
- La página de retorno clasifica cualquier nuevo fallo en fases seguras, como `GOOGLE_STATE_CHECK`, `GOOGLE_TOKEN_EXCHANGE`, `YOUTUBE_CHANNEL_CHECK` o `ENCRYPT_AND_STORE`, sin mostrar contraseñas, tokens, códigos ni consultas.
- Se han probado con datos simulados la caducidad y el uso único del estado OAuth, el almacenamiento cifrado y la confirmación del canal; **no significa que se haya autenticado el canal real**.
- **No reutilizar ni recargar** una URL antigua `/oauth/callback?...`: el código OAuth de Google es de un solo uso y el enlace de estado caduca a los 10 minutos. Una vez caducado, se debe abrir desde cero `/connect`, entrar con la contraseña y generar un enlace nuevo mediante **2. Conectar mi YouTube**.
- Realizar todo el recorrido en la misma ventana de Chrome para conservar las cookies de sesión, sin pegar ni compartir URL de retorno (pueden contener un código temporal).
- Los vídeos largos solo se optimizarán después de comprobar mediante la API el canal correcto; **no está activada ninguna escritura**, subida ni publicación.
