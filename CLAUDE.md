# eintra-erp — Directivas generales para Claude Code

## Base de datos: siempre trabajar contra el servidor, nunca guardar una copia local persistente

El servidor de producción corre en `10.1.1.10` (Linux, PM2, ver `deploy.ps1`), con su base en
`/home/administrador/eintra-erp/backend/db/eintra_erp.db`. Esa es la **única fuente de verdad**.

**Regla:** no mantener una copia local de `eintra_erp.db` como base de trabajo persistente entre
sesiones. Si en algún momento se necesita una copia local para analizar o probar cambios:

1. Traerla del servidor al empezar a trabajar (no asumir que una copia local vieja sigue vigente).
2. Al terminar la tarea, borrar los archivos temporales (`.db`, backups, copias de prueba) usados
   durante el trabajo.
3. Cualquier cambio de datos se aplica al servidor (por SSH, con un `.sql` idempotente cuando sea
   posible) — la copia local es solo un borrador de trabajo, nunca el destino final.

**Por qué:** trabajar con una copia local persistente generó confusión — cambios hechos directo en
el servidor (vía la app web) y cambios hechos en la copia local quedaban desincronizados sin que
quedara claro cuál era el estado real. Cero ambigüedad: el servidor manda siempre.

## Cambios de código vs. cambios de datos

- **Código** (rutas, componentes React, etc.): se sube con `.\deploy.ps1` desde
  `C:\Users\silvi\eintra-erp`. Nunca se sincroniza solo — hay que correr el deploy explícitamente.
- **Datos**: se aplican con un script `.sql` vía `scp` + `ssh` contra la base del servidor,
  preferentemente idempotente (usar `WHERE NOT EXISTS`, `AND campo=''`, etc.) para poder
  reintentar sin duplicar ni pisar datos si algo falla a mitad de camino.
