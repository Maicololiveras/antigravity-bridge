# antigravity-bridge

Cliente experimental de Antigravity ACP para Pi y el selector de modelos de Gentle Shell.

**Estado: 0.1.0, prototipo verificable con servidor ACP de prueba. No validado aún contra un binario real de Antigravity ni una cuenta Google.**

El proveedor `antigravity` publica los modelos que anuncia el runtime. Pi muestra la respuesta en streaming; Antigravity mantiene su conversación y ejecuta sus propias herramientas. El bridge no extrae tokens, no implementa OAuth de Google, no llama endpoints privados y no invoca `agy -p`.

## Instalación

Requisitos: Node.js 22.19+, Pi de `@earendil-works/pi-coding-agent` 1.3.x, y un **servidor ACP oficial de Antigravity instalado por separado** compatible con ACP v1. La extensión también necesita `@earendil-works/pi-ai` (peer de Pi). Gentle Shell consultado: 4.3.0. Versiones anteriores no están verificadas.

Descomprime el proyecto y, desde su carpeta:

```powershell
npm ci --ignore-scripts
npm test
pi install .
```

Configura la ruta al ejecutable real de tu instalación. No apuntes al instalador ni a un script `.cmd`:

```powershell
$env:ANTIGRAVITY_ACP_BIN = 'C:\ruta\real\al\servidor-acp.exe'
$env:ANTIGRAVITY_ACP_ARGS = '[]'
pi
```

En Linux/macOS:

```bash
export ANTIGRAVITY_ACP_BIN='/ruta/real/al/servidor-acp'
export ANTIGRAVITY_ACP_ARGS='[]'
pi
```

Las rutas son marcadores, no rutas de instalación oficiales. Usa los argumentos documentados para tu versión del servidor. No se descarga ni instala automáticamente un ejecutable externo.

## Autenticación y catálogo

1. Inicia sesión en Antigravity mediante sus mecanismos oficiales.
2. En Pi, ejecuta `/ag auth` si el servidor exige autenticación separada. Solo se ofrecen métodos que el propio servidor anuncia; el flujo y las credenciales pertenecen al runtime. Si este requiere un login en terminal no compatible, complétalo desde el cliente oficial.
3. Ejecuta `/ag models`. Abre una sesión sin prompt, consulta sus modelos y registra el catálogo; no solicita inferencia.
4. Abre `/model` y selecciona `antigravity/<id-real>`.
5. En Gentle Shell, abre `/gentle:models` y selecciona ese mismo identificador para el rol deseado. Cierra y abre el selector si estaba abierto durante el refresco.

El comando nativo de Pi es `/model` (singular). El bridge no reemplaza comandos de Gentle ni crea una copia de su selector. Su función `getPiModelOptions()` consulta `ctx.modelRegistry.getAvailable()` y compone `provider/id`, por lo que un proveedor registrado con modelos disponibles entra en ese catálogo. Esto se comprobó leyendo el código de Gentle; no equivale a una prueba completa de su TUI.

El catálogo se guarda en `~/.pi/agent/antigravity-bridge/models.json` para próximas sesiones y procesos de subagentes. Ejecuta `/ag models` después de cambiar de cuenta o actualizar el runtime. Un catálogo guardado no garantiza acceso: cada petición comprueba que el servidor actual anuncia el modelo solicitado. Si el servidor no publica modelos, la lista queda vacía; no se inventan nombres ni se cambia silenciosamente al modelo predeterminado.

## Comandos

| Comando | Acción |
| --- | --- |
| `/ag auth` | Pedir al runtime uno de sus métodos de autenticación |
| `/ag models` | Descubrir y registrar los modelos ACP |
| `/ag status` | Mostrar cantidad de modelos y estado básico |
| `/ag reset` | Cerrar las conexiones mantenidas por el bridge |
| `/model` | Elegir el modelo de la conversación de Pi |
| `/gentle:models` | Elegir modelos en el enrutamiento de Gentle, si está instalado |
| `Esc` | Abortar el turno de Pi; se propaga a ACP |

## Arquitectura

- `extensions/index.ts`: registro en Pi, catálogo, permisos y estado de herramientas.
- `src/provider.mjs`: traduce el stream ACP a eventos de asistente de Pi; separa sesiones según `options.sessionId`.
- `src/acp.mjs`: transporte JSON-RPC por stdio, inicialización, autenticación delegada, sesiones, permisos y cancelación.
- `src/catalog.mjs`: opciones ACP `category: model`, grupos y compatibilidad con `availableModels`/`session/set_model`.

Se usa `session/set_config_option` cuando está anunciado; el método anterior solo se usa si el runtime publica el catálogo anterior. Una selección no anunciada falla, sin sustituciones.

Cada sesión de Pi mantiene su runtime. Los turnos siguientes envían solamente el contenido nuevo; si el historial cambia de rama, se abre otra sesión y se reconstruye el contexto textual. Los procesos de subagentes cargan el mismo paquete y su catálogo, pero necesitan que Gentle efectivamente cargue esta extensión y conserve la configuración del ejecutable. No se afirma integración completa de sus perfiles, ODD/TDD o herramientas.

## Límites de esta versión

- Antigravity ejecuta sus herramientas. **Las herramientas y delegaciones propias de Pi/Gentle no se exportan al runtime en esta versión.** Elegir el modelo no garantiza que Antigravity pueda ejecutar una herramienta exclusiva de Gentle.
- Solo texto. No hay soporte de imágenes, esfuerzo `/thinking`, audio ni selección de variantes no anunciadas.
- La UI muestra texto en streaming, estado de herramientas y plan. No hay tarjetas nativas con diffs de Pi.
- Autenticación real, disponibilidad por sistema operativo, consumo de suscripción y compatibilidad de la versión instalada de ACP requieren validación en el equipo del usuario.
- ACP no entrega límites de tokens estandarizados: 32768/8192 son presupuestos del adaptador exigidos por el catálogo de Pi, **no especificaciones del modelo ni límites impuestos al runtime**.
- Los campos de uso/costo se mantienen en cero porque no se miden. Cero no significa uso gratuito ni cuota ilimitada; consulta Antigravity para el consumo real.
- Historial ACP en memoria durante la ejecución. Después de reiniciar se crea una sesión y se reenvía el historial textual disponible, lo que puede consumir contexto. No se recuperan automáticamente sesiones por ID del disco.
- Sin servidor de archivos ni terminal delegado al cliente: no se anuncian capacidades ACP que no se implementan. El agente debe ejecutar sus herramientas por sí mismo.
- Se mantienen como máximo 16 conexiones por instancia. `/ag reset` las libera.
- No tiene autoaprobación: se pregunta por permisos que envía ACP; sin interfaz se cancela la solicitud. Esto no restringe herramientas que el runtime ejecuta sin pedir permiso.
- Una cancelación sin respuesta cierra el proceso ACP tras cinco segundos. No garantiza finalizar procesos descendientes que el runtime haya dejado independientes.
- Los hooks HTTP `onResponse` no representan una respuesta HTTP real en este transporte; ver VALIDATION.md para el alcance del contrato.

## Pruebas

```bash
npm test
npm run demo
npm run typecheck
```

El servidor de prueba corre localmente, no hace llamadas de modelos ni usa una cuenta Google. Las pruebas verifican negociación, catálogo, elección exacta del modelo, streaming, aislamiento, continuidad, permisos, errores, cancelación y timeouts. Consulta `VALIDATION.md` para distinguir pruebas reales de pruebas con simulador.

## Repositorio

[Maicololiveras/antigravity-bridge](https://github.com/Maicololiveras/antigravity-bridge)

```bash
git clone https://github.com/Maicololiveras/antigravity-bridge.git
cd antigravity-bridge
npm ci --ignore-scripts
npm test
pi install .
```

## Alcance de autorización

Este proyecto no afirma autorización de Google para consumir planes personales desde Pi. Mantener la autenticación en el runtime o usar ACP no concede por sí mismo ese permiso. No incluye rotación de cuentas, extracción de credenciales ni mecanismos para ocultar el cliente. La compatibilidad técnica y las condiciones del servicio son asuntos separados.

## Referencias

- [ACP v1](https://agentclientprotocol.com/protocol/v1/initialization)
- [Opciones de sesión](https://agentclientprotocol.com/protocol/v1/session-config-options)
- [Extensiones Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Selector Gentle](https://github.com/Gentleman-Programming/gentle-shell/blob/main/extensions/gentle-ai.ts)
- [Antigravity](https://antigravity.google/docs/)

MIT. Proyecto independiente; no afiliado a Google, Pi ni Gentle Shell.
