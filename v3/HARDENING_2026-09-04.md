# V3 Hardening & Cleanup — 2026-09-04

## Aplicado

- CSP en la aplicación V3.
- Estado visible de sincronización y advertencia de datos parciales.
- Auditoría administrativa basada en `audit_events`.
- Datos de contacto de OC sin fallback personal hardcodeado.
- V3 documentada como única fuente productiva.
- CI con controles de hardening.
- Deploy de Pages bloqueado para pushes directos no asociados a un Pull Request mergeado.
- Migración `20260904181621_v3_hardening_cleanup.sql` aplicada en Supabase:
  - sin privilegios de tabla para `anon` en `public`;
  - `SECURITY DEFINER` sin ejecución heredada/anónima;
  - 15 índices de FK agregados;
  - 13 policies optimizadas para no reevaluar `auth.uid()` por fila.
- Endpoints legacy retirados:
  - `avh-publish-static`
  - `avh-bootstrap`
  - `inventario-avh-v2-app`
  - `inventario-avh-v2-web`

## Verificación

Después de la migración:
- 0 grants de tablas públicas para `anon`.
- 15/15 índices de hardening presentes.
- 0 lotes con saldo negativo.
- 0 recepciones mayores a lo comprado.
- 0 compras recibidas incompletas.
- 0 depositarios activos sin depósito.
- 0 líneas de movimiento con cantidad/factor no positivo.

## Pendientes deliberados

No se mezclaron con este hardening porque requieren otra refactorización o permisos externos:

1. Las funciones `SECURITY DEFINER` que utiliza el frontend siguen siendo ejecutables por `authenticated`, pero cada operación sensible valida el rol/perfil en PostgreSQL. Migrarlas a un gateway privado sería un cambio arquitectónico mayor.
2. Quedan policies permisivas duplicadas marcadas por Database Advisor; son un tema de rendimiento/mantenibilidad, no una brecha detectada.
3. Leaked Password Protection depende de Auth Settings/plan de Supabase.
4. La visibilidad pública del repositorio y la protección nativa de `main` requieren permisos administrativos de GitHub. El workflow de Pages ahora evita publicar pushes directos.
5. Los wrappers globales `window.*` de compatibilidad se deben reducir gradualmente, no mediante una reescritura masiva junto con reglas de negocio.
