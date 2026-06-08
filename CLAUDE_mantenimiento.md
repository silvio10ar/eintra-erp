# Módulo de Mantenimiento — eintra-erp

> Directivas para Claude Code. Leer completo antes de escribir cualquier código de este módulo.

---

## Modelo de datos

El módulo tiene **5 tablas** con responsabilidades separadas:

| Tabla | Rol |
|---|---|
| `mant_equipos` | Inventario maestro: 157 equipos (máquinas, tableros, alargues) |
| `mant_tareas_preventivas` | Plan preventivo: 116 tareas con frecuencia y tipo |
| `mant_ejecuciones_preventivas` | Registro de cada ejecución de tarea preventiva |
| `mant_intervenciones_correctivas` | Reparaciones no planificadas por falla |
| `mant_inspecciones` | Rondas de inspección general periódica del equipo |

Más 2 vistas:
- `v_mant_alertas` — calcula estado de cada tarea (al_día / próxima / vencida / nunca_ejecutada)
- `v_mant_historial_equipo` — unifica preventivas + correctivas por equipo en orden cronológico

---

## Entidades clave

### mant_equipos

```
codigo        EQ-001 a EQ-327 (con saltos). Formato original del Form 14.
nombre        Nombre completo del equipo.
categoria     Torno / Soldadora / Compresor / Autoelevador / Granalladora /
              Puente grúa / Aparejo / Taladro / Amoladora / Equipo de corte plasma /
              Cortadora / Fresadora / Prensa / Caladora / Sierra /
              Máquina de pintar / Máquina de roscar / Grupo electrógeno /
              Aspiración / Lavadora de granalla / Remachadora / Rectificadora /
              Percutora / Lijadora / Limadora / Minitorno / Tablero eléctrico /
              Alargue / Herramienta
marca         Libre (Kaeser, Merle, Bosch, Milwaukee, Dewalt, etc.)
modelo        Libre
nro_serie     Preloadeado del Form 14 donde existía
ubicacion     MIGUENS | POGGIO (las dos plantas de E-INTRA)
estado        activo | baja | en_reparacion
fecha_baja    Solo si estado=baja
motivo_baja   Solo si estado=baja
```

**Regla:** un equipo en estado `baja` no debe aparecer en alertas ni en formularios de carga de ejecuciones. Un equipo `en_reparacion` sí aparece en el listado pero con indicador visual diferenciado.

---

### mant_tareas_preventivas

```
equipo_id       FK a mant_equipos
componente      Parte del equipo (Caja Norton, Correas, Tablero eléctrico...)
accion          Qué hacer (Verificar nivel, Limpieza general, Control de tensión...)
tipo            V = Verificación
                L = Limpieza
                A = Ajuste
                M = Mantenimiento (cambio de aceite, filtros, etc.)
frecuencia      Mensual | Cuatrimestral | Bimestral | Anual | Luego de c/uso
frecuencia_dias 30 | 120 | 60 | 365 | 0
activa          1 = vigente, 0 = suspendida
```

**"Luego de c/uso"** es especial: no genera alerta por tiempo, solo aparece en el formulario de cierre de uso del equipo.

---

### mant_ejecuciones_preventivas

```
tarea_id        FK a mant_tareas_preventivas
equipo_id       FK a mant_equipos (denormalizado para queries rápidas)
fecha           Fecha real de ejecución
resultado       OK | NOK | Cuarentena
observaciones   Texto libre
responsable     Nombre del operario/técnico
```

**Regla:** si `resultado = NOK`, el sistema debe ofrecer la opción de generar una `mant_intervencion_correctiva` automáticamente con la descripción precargada.

---

### mant_intervenciones_correctivas

```
equipo_id           FK a mant_equipos
fecha_deteccion     Cuándo se detectó la falla
fecha_inicio        Cuándo empezó la reparación
fecha_fin           Cuándo terminó (null si sigue abierta)
descripcion_falla   Qué falló
accion_realizada    Qué se hizo
tipo_servicio       interno | externo
proveedor           Solo si externo
costo               Opcional, en ARS
repuestos_usados    Texto libre (descripción de partes)
resultado           resuelto | derivado_baja | pendiente
responsable         Técnico o empresa
nc_id               Opcional: FK a no_conformidades del Módulo NC del ERP
```

**Regla:** si `resultado = derivado_baja`, el sistema debe actualizar `mant_equipos.estado = 'baja'` y solicitar `motivo_baja`.

---

### mant_inspecciones

Equivale a las hojas de detalle del Form 14 (ronda mensual de inspección visual de todos los equipos).

```
equipo_id           FK a mant_equipos
fecha               Fecha de la inspección
estado_general      OK | NOK | requiere_atencion | en_reparacion
ubicacion_verificada MIGUENS | POGGIO (confirmar que el equipo está donde debe)
etiqueta_ok         1 = etiqueta con código visible, 0 = falta o rota
observaciones       Texto libre
responsable         Quien hizo la ronda
```

---

## Pantallas a desarrollar

### 1. Dashboard de mantenimiento (`/mantenimiento`)

KPIs en tarjetas:
- Tareas vencidas (usar `v_mant_alertas WHERE estado_alerta = 'vencida'`)
- Tareas próximas a vencer en 7 días
- Equipos en reparación
- Equipos dados de baja este año

Tabla de alertas urgentes: las 10 tareas más vencidas ordenadas por `dias_desde_ultima DESC`.

---

### 2. Inventario de equipos (`/mantenimiento/equipos`)

Tabla con filtros por: categoría, ubicación, estado.

Columnas: Código · Nombre · Categoría · Ubicación · Estado · Nro. serie · Acciones.

Acciones por fila:
- Ver historial completo (usa `v_mant_historial_equipo`)
- Registrar intervención correctiva
- Dar de baja
- Editar datos

Al hacer clic en un equipo → vista de detalle con:
- Datos del equipo (editable)
- Próximas tareas preventivas (de `v_mant_alertas`)
- Historial de ejecuciones y correctivas

---

### 3. Plan preventivo (`/mantenimiento/plan`)

Vista de calendario mensual o tabla: todos los equipos activos × tareas del mes en curso.

Columnas: Equipo · Tarea · Frecuencia · Última ejecución · Próxima fecha · Estado (al_día/vencida/próxima).

Acción por fila: **Registrar ejecución** → modal con campos: fecha, resultado (OK/NOK/Cuarentena), observaciones, responsable.

Al marcar NOK → ofrecer "Crear intervención correctiva" con datos precargados.

---

### 4. Intervenciones correctivas (`/mantenimiento/correctivas`)

Lista de todas las correctivas con filtro por estado (pendiente / resuelto / derivado_baja).

Formulario de alta: buscar equipo por código o nombre, completar campos de la tabla.

Al cerrar una correctiva con `derivado_baja` → modal de confirmación + actualizar estado del equipo.

---

### 5. Inspección periódica (`/mantenimiento/inspeccion`)

Formulario de ronda: seleccionar fecha + responsable, luego lista de todos los equipos activos con campos: estado_general (dropdown), etiqueta_ok (checkbox), observaciones.

Permite cargar la ronda de forma rápida (una fila por equipo) y guardar todo en un batch.

---

### 6. Historial por equipo (`/mantenimiento/equipos/:codigo/historial`)

Tabla unificada usando `v_mant_historial_equipo`:
- Tipo (preventiva / correctiva / inspección)
- Fecha
- Descripción
- Estado/Resultado
- Responsable

Exportable a PDF para auditorías.

---

## Reglas de negocio críticas

1. **Nunca borrar registros.** Todo se desactiva (`activa=0`) o se marca con estado. Los equipos dados de baja permanecen en el historial.

2. **Cálculo de vencimiento** (implementado en `v_mant_alertas`):
   - Vencida: `dias_desde_ultima > frecuencia_dias`
   - Próxima: `dias_desde_ultima > frecuencia_dias * 0.8`
   - Nunca ejecutada: sin registros en ejecuciones_preventivas

3. **NOK genera correctiva:** cuando se registra una ejecución con resultado NOK, el sistema debe sugerir (no obligar) crear la intervención correctiva correspondiente.

4. **Baja por correctiva:** si una intervención correctiva cierra con `derivado_baja`, actualizar automáticamente el equipo.

5. **Etiqueta faltante:** si en una inspección se marca `etiqueta_ok = 0`, registrar observación automática para que Producción gestione la reimpresión (PE-11 Metodología de identificación de equipos).

6. **Ubicaciones:** MIGUENS y POGGIO son las únicas dos ubicaciones válidas. Si un equipo se detecta en una ubicación diferente a la registrada, el campo `ubicacion_verificada` de la inspección lo captura sin sobrescribir el dato maestro.

---

## Stack y convenciones

- Fechas: `DATE` en ISO formato `YYYY-MM-DD`, display en `DD/MM/YYYY`
- Costos: en ARS, sin formateo automático de moneda (el usuario ingresa el número)
- Exports: toda tabla exportable a Excel; historial individual exportable a PDF
- No hay integración con proveedores externos en esta fase (el campo `proveedor` es texto libre)
- La vinculación con el módulo de NC (`nc_id`) es opcional y se implementa en fase posterior

---

## Seed inicial

Ejecutar antes de arrancar el módulo:

```bash
sqlite3 eintra.db < db/migrations/mantenimiento.sql
```

Contiene:
- 155 equipos cargados (87 con tareas preventivas + 68 solo en inventario)
- 116 tareas preventivas del Plan 2026
- 100 inspecciones históricas importadas de hojas 2024-2026
- 2 equipos marcados como baja (EQ-157 bobinado quemado, EQ-158 colector quemado)

