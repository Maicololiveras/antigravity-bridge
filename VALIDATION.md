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
