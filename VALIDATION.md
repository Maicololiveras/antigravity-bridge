# Validación — 2026-10-19

## Ejecutado

- Node.js 24.19.0 en Linux.
- `@earendil-works/pi-coding-agent` 1.3.0 y `@earendil-works/pi-ai` 1.3.0 instalados desde npm, con scripts de instalación desactivados.
- `npm test`: 13 pruebas aprobadas.
- `npm run typecheck`: comprobación TypeScript de la extensión contra las declaraciones reales de Pi. El núcleo JavaScript no usa checkJs; su cobertura funcional está en los tests.
- Registro real `ModelRuntime` + `ModelRegistry` de Pi: extensión importada, comando de descubrimiento ejecutado, dos modelos anunciados por el servidor de prueba, `getAvailable()` correcto y respuesta obtenida por `registry.streamSimple()` seleccionando el segundo modelo.
- Transporte ACP por proceso hijo real para todas las pruebas de integración; las respuestas del agente son simuladas, no respuestas de Google.
- Sin peticiones de inferencia ni consumo de una suscripción durante las pruebas.

## Contratos revisados

- Pi: `packages/coding-agent/src/core/extensions/types.ts`, provider API y stream de eventos; paquete 1.3.0 instalado.
- Gentle Shell: `extensions/gentle-ai.ts`, función `getPiModelOptions`, y `package.json` (4.3.0). Consulta `modelRegistry.getAvailable()` y construye `provider/id`.
- ACP v1: initialize, authenticate, session/new, session/load, session/prompt, session/cancel, session/request_permission y session/set_config_option.
- En transporte stdio no existe respuesta HTTP: el bridge soporta `onPayload` y los eventos del proveedor, pero no fabrica un status HTTP para `onResponse`.

## No validado

- Login, binario, catálogos y cuotas reales de Google Antigravity.
- Windows/macOS y permisos o dependencias que exija el ejecutable oficial.
- UI interactiva de Gentle, carga de extensiones en sus subagentes y ejecución completa ODD/TDD.
- Compatibilidad de versiones de Pi anteriores a 1.3.0.
- Exportación de herramientas Pi a Antigravity, no implementada en este MVP.

## Prueba de aceptación en el equipo destino

1. Configurar `ANTIGRAVITY_ACP_BIN` con un ejecutable oficial compatible con stdio ACP v1.
2. Iniciar sesión en la aplicación oficial; usar `/ag auth` únicamente si el runtime lo requiere y ofrece el método.
3. Ejecutar `/ag models`; comprobar que el número coincide con las opciones que anuncia el runtime.
4. Elegir un modelo desde `/model` y enviar una pregunta breve.
5. Cambiar de modelo y comprobar que el runtime acepta la selección, sin fallback silencioso.
6. Abrir `/gentle:models`, seleccionar `antigravity/<id>` y verificar que el proceso que recibe el rol también carga la extensión.
7. Probar Esc y nueva sesión; comprobar que no continúa un turno oculto.
8. Revisar el uso en Antigravity: este bridge no mide cuota ni tokens.


## 0.2.0: contrato nativo Gentle

16 tests y TypeScript pasan (incluyendo el normalizador real de Gentle con `GENTLE_SOURCE=/ruta/al/clon/gentle-shell npm test`; sin esa variable la prueba opcional se omite): proveedor registrado en Pi real, selección RPC headless, cancelación y costo USD por turno sin duplicación del acumulado. Antigravity se simula; no se ejecutó Windows ni Gentle completo. Código Gentle 4.3.0 consultado en commit b274ba40aa433c4afc9a6c63292100cc7000644e: `lib/agents-protocol.ts` normaliza message_end.usage; `lib/agents-runner.ts` reenvía diálogos solo para task; `extensions/gentle-agents.ts` answerThroughUi reenvía select al padre. El usuario sí comprobó permisos y creación/lectura en el padre con 0.1.0. No se afirma que su problema fuera falta de hasUI: background es otra causa concreta y deliberada.

## 0.3.0

17 pruebas con GENTLE_SOURCE, más TypeScript: permiso por carpeta compartido entre create_file/edit_file solo en el mismo turno; otras carpetas, comandos, otro turno, cancelación y symlinks no heredan autorización. UI compacta sin CodeContent. Windows real pendiente para esta versión. El usuario confirmó aprobación del worker en el padre y tarea completada con 0.2.0.

## 0.4.0

18 pruebas con normalizador Gentle y TypeScript. Se valida selección de esfuerzo anunciado, rechazo de nivel inexistente y respuesta sin confirmación. Esfuerzo y uso reales de Antigravity aún requieren salida de /ag inspect y /ag usage del equipo del usuario. No se afirma paridad completa de la tarjeta: totalTokens no se inventa.
