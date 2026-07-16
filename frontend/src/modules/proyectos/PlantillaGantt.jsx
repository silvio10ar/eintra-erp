import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'

const COLORES = ['', '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']

export default function PlantillaGantt({ canWrite }) {
  // ── Sets ───────────────────────────────────────────────────────────────────
  const [sets,       setSets]       = useState([])
  const [selSet,     setSelSet]     = useState(null)   // null = global legacy
  const [loadSets,   setLoadSets]   = useState(true)
  const [formSet,    setFormSet]    = useState(null)   // null | 'nuevo' | { id, nombre, descripcion }
  const [setNombre,  setSetNombre]  = useState('')
  const [setDesc,    setSetDesc]    = useState('')
  const [savingSet,  setSavingSet]  = useState(false)
  const [dupSet,     setDupSet]     = useState(null)   // null | { id, nombre } — set a duplicar
  const [dupNombre,  setDupNombre]  = useState('')
  const [savingDup,  setSavingDup]  = useState(false)

  // ── Tareas del set seleccionado ────────────────────────────────────────────
  const [tareas,   setTareas]   = useState([])
  const [loading,  setLoading]  = useState(false)
  const [editId,   setEditId]   = useState(null)
  const [editData, setEditData] = useState({})
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')
  const [buscar,   setBuscar]   = useState('')
  const inputRef = useRef()

  // ── Cargar lista de sets ───────────────────────────────────────────────────
  const cargarSets = useCallback(async () => {
    setLoadSets(true)
    try {
      const { data } = await api.get('/gantt/plantilla-sets')
      setSets(data)
    } catch { setErr('Error al cargar plantillas') }
    finally { setLoadSets(false) }
  }, [])

  useEffect(() => { cargarSets() }, [cargarSets])

  // ── Cargar tareas del set activo ───────────────────────────────────────────
  const cargarTareas = useCallback(async (setId) => {
    setLoading(true); setEditId(null); setBuscar('')
    try {
      const params = setId !== null ? { set_id: setId } : {}
      const { data } = await api.get('/gantt/plantilla', { params })
      setTareas(data)
    } catch { setErr('Error al cargar tareas') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    cargarTareas(selSet)
  }, [selSet, cargarTareas])

  // ── CRUD sets ──────────────────────────────────────────────────────────────
  const abrirNuevoSet = () => { setFormSet('nuevo'); setSetNombre(''); setSetDesc('') }
  const abrirEditSet  = s  => { setFormSet(s); setSetNombre(s.nombre); setSetDesc(s.descripcion || '') }

  const guardarSet = async () => {
    if (!setNombre.trim()) return
    setSavingSet(true)
    try {
      if (formSet === 'nuevo') {
        const { data } = await api.post('/gantt/plantilla-sets', { nombre: setNombre, descripcion: setDesc })
        await cargarSets()
        setSelSet(data.id)
      } else {
        await api.put(`/gantt/plantilla-sets/${formSet.id}`, { nombre: setNombre, descripcion: setDesc })
        await cargarSets()
      }
      setFormSet(null)
    } catch { setErr('Error al guardar plantilla') }
    finally { setSavingSet(false) }
  }

  const duplicarSet = async () => {
    if (!dupNombre.trim()) return
    setSavingDup(true)
    try {
      if (dupSet.id === '__global__') {
        // Duplicar desde la plantilla global (masterplan/hoja_ruta)
        const { data: newSet } = await api.post('/gantt/plantilla-sets', { nombre: dupNombre.trim() })
        // Copiar tareas globales al nuevo set via guardar-plantilla desde global no aplica directo
        // Usamos un endpoint alternativo: creamos el set y copiamos manualmente
        const { data: tareasGlobal } = await api.get('/gantt/plantilla')  // sin set_id = global
        for (const t of tareasGlobal) {
          await api.post('/gantt/plantilla', {
            nombre: t.nombre, duracion_dias: t.duracion_dias, es_grupo: t.es_grupo,
            origen: 'custom', color: t.color || '', grupo: t.grupo || '', set_id: newSet.id,
          })
        }
        await cargarSets()
        setSelSet(newSet.id)
      } else {
        const { data } = await api.post(`/gantt/plantilla-sets/${dupSet.id}/duplicar`, { nombre: dupNombre.trim() })
        await cargarSets()
        setSelSet(data.id)
      }
      setDupSet(null)
    } catch { setErr('Error al duplicar') }
    finally { setSavingDup(false) }
  }

  const eliminarSet = async (s) => {
    if (!confirm(`¿Eliminar la plantilla "${s.nombre}" y todas sus tareas (${s.total_tareas})?`)) return
    try {
      await api.delete(`/gantt/plantilla-sets/${s.id}`)
      if (selSet === s.id) setSelSet(null)
      await cargarSets()
    } catch { setErr('Error al eliminar') }
  }

  // ── CRUD tareas ────────────────────────────────────────────────────────────
  const iniciarEdicion = t => {
    setEditId(t.id)
    setEditData({ nombre: t.nombre, duracion_dias: t.duracion_dias, es_grupo: !!t.es_grupo, origen: t.origen || 'custom', color: t.color || '', grupo: t.grupo || '' })
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const guardarTarea = async (id) => {
    setSaving(true)
    try {
      await api.put(`/gantt/plantilla/${id}`, editData)
      setEditId(null)
      await cargarTareas(selSet)
    } catch { setErr('Error al guardar') }
    finally { setSaving(false) }
  }

  const agregarTarea = async (esGrupo = false) => {
    setSaving(true)
    try {
      const { data } = await api.post('/gantt/plantilla', {
        nombre: esGrupo ? 'Nueva sección' : 'Nueva tarea',
        es_grupo: esGrupo, duracion_dias: esGrupo ? 0 : 1,
        origen: 'custom', set_id: selSet,
      })
      await cargarTareas(selSet)
      iniciarEdicion({ id: data.id, nombre: esGrupo ? 'Nueva sección' : 'Nueva tarea', duracion_dias: esGrupo ? 0 : 1, es_grupo: esGrupo, origen: 'custom', color: '', grupo: '' })
    } catch { setErr('Error al crear') }
    finally { setSaving(false) }
  }

  const eliminarTarea = async id => {
    if (!confirm('¿Eliminar esta tarea de la plantilla?')) return
    try {
      await api.delete(`/gantt/plantilla/${id}`)
      await cargarTareas(selSet)
    } catch { setErr('Error al eliminar') }
  }

  const mover = async (idx, dir) => {
    const arr = [...filtradas]
    const swap = idx + dir
    if (swap < 0 || swap >= arr.length) return
    ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
    try {
      await api.put('/gantt/plantilla/reordenar', { ids: arr.map(t => t.id) })
      await cargarTareas(selSet)
    } catch { setErr('Error al reordenar') }
  }

  const filtradas = tareas.filter(t => !buscar || t.nombre.toLowerCase().includes(buscar.toLowerCase()))

  const setActivo = selSet !== null ? sets.find(s => s.id === selSet) : null

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', gap: '1rem', minHeight: 400 }}>

      {/* ── Panel izquierdo: lista de plantillas ─────────────────────────── */}
      <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #dee2e6', paddingRight: '1rem' }}>
        <div className="d-flex align-items-center justify-content-between mb-2">
          <span className="small fw-bold text-secondary">PLANTILLAS</span>
          {canWrite && (
            <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize: '0.75rem' }} onClick={abrirNuevoSet}>
              <i className="bi bi-plus-lg" />
            </button>
          )}
        </div>

        {/* Ítem "Global" (legacy) */}
        <div className={`rounded px-2 py-1 mb-1 ${selSet === null ? 'bg-primary text-white' : 'bg-light'}`}
          style={{ cursor: 'pointer', fontSize: '0.8rem' }}
          onClick={() => setSelSet(null)}>
          <div className="d-flex align-items-center justify-content-between">
            <span>
              <i className={`bi bi-globe me-1 ${selSet === null ? 'text-white' : 'text-muted'}`} />
              Master Plan / HR
            </span>
          </div>
          {canWrite && selSet === null && (
            <div className="mt-1" onClick={e => e.stopPropagation()}>
              <button className="btn btn-sm py-0 px-2 btn-outline-light w-100" style={{ fontSize: '0.68rem' }}
                onClick={() => { setDupSet({ id: '__global__', nombre: 'Master Plan / HR' }); setDupNombre('') }}>
                <i className="bi bi-copy me-1" />Usar como base
              </button>
            </div>
          )}
        </div>

        {loadSets ? (
          <div className="text-center py-2"><span className="spinner-border spinner-border-sm text-primary" /></div>
        ) : sets.length === 0 ? (
          <div className="text-muted small px-1 py-2">Sin plantillas. Creá la primera con el botón +</div>
        ) : (
          sets.map(s => (
            <div key={s.id}
              className={`rounded px-2 py-1 mb-1 ${selSet === s.id ? 'bg-primary text-white' : 'bg-light'}`}
              style={{ cursor: 'pointer', fontSize: '0.8rem' }}
              onClick={() => setSelSet(s.id)}>
              <div className="d-flex align-items-center justify-content-between">
                <span className="text-truncate flex-grow-1" title={s.nombre}>{s.nombre}</span>
                <span className={`badge ms-1 flex-shrink-0 ${selSet === s.id ? 'bg-white text-primary' : 'bg-secondary'}`} style={{ fontSize: '0.6rem' }}>
                  {s.tareas_reales ?? 0}
                </span>
              </div>
              {s.descripcion && (
                <div className={`text-truncate ${selSet === s.id ? 'text-white-50' : 'text-muted'}`} style={{ fontSize: '0.68rem' }}>
                  {s.descripcion}
                </div>
              )}
              {canWrite && selSet === s.id && (
                <div className="d-flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm py-0 px-1 btn-outline-light" style={{ fontSize: '0.65rem' }}
                    title="Editar nombre" onClick={() => abrirEditSet(s)}>
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="btn btn-sm py-0 px-1 btn-outline-light" style={{ fontSize: '0.65rem' }}
                    title="Duplicar como base para nueva" onClick={() => { setDupSet(s); setDupNombre('Copia de ' + s.nombre) }}>
                    <i className="bi bi-copy" />
                  </button>
                  <button className="btn btn-sm py-0 px-1 btn-outline-light" style={{ fontSize: '0.65rem' }}
                    title="Eliminar" onClick={() => eliminarSet(s)}>
                    <i className="bi bi-trash" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Panel derecho: tareas ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Cabecera */}
        <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
          <div>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-layout-text-sidebar-reverse me-2 text-primary" />
              {setActivo ? setActivo.nombre : 'Master Plan / Hojas de Ruta'}
            </h6>
            <div className="text-muted mt-1" style={{ fontSize: '0.78rem' }}>
              {tareas.filter(t => !t.es_grupo).length} tareas · {tareas.filter(t => !!t.es_grupo).length} secciones
            </div>
          </div>
          {canWrite && (
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => agregarTarea(true)} disabled={saving}>
                <i className="bi bi-folder-plus me-1" />Sección
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => agregarTarea(false)} disabled={saving}>
                <i className="bi bi-plus-lg me-1" />Tarea
              </button>
            </div>
          )}
        </div>

        {err && (
          <div className="alert alert-warning py-1 small mb-2">{err}
            <button className="btn-close ms-2" style={{ fontSize: '0.65rem' }} onClick={() => setErr('')} />
          </div>
        )}

        <div className="d-flex gap-2 mb-2">
          <input className="form-control form-control-sm" style={{ maxWidth: 240 }}
            placeholder="Buscar tarea..." value={buscar} onChange={e => setBuscar(e.target.value)} />
          <span className="text-muted small align-self-center">{filtradas.length} filas</span>
        </div>

        {loading ? (
          <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.78rem' }}>
              <thead className="table-dark">
                <tr>
                  {canWrite && <th style={{ width: 28 }} />}
                  <th style={{ width: 8 }} />
                  <th>Nombre</th>
                  <th style={{ width: 60 }}>Días</th>
                  <th style={{ width: 80 }}>Grupo</th>
                  {canWrite && <th style={{ width: 60 }} />}
                </tr>
              </thead>
              <tbody>
                {filtradas.map((t, idx) => editId === t.id ? (
                  <tr key={t.id} style={{ background: '#fffbf0' }}>
                    <td colSpan={canWrite ? 6 : 5} style={{ padding: '6px 8px' }}>
                      <div className="d-flex flex-column gap-2">
                        <div className="form-check form-switch mb-0">
                          <input className="form-check-input" type="checkbox" id="esGrupo"
                            checked={editData.es_grupo}
                            onChange={e => setEditData(d => ({ ...d, es_grupo: e.target.checked, duracion_dias: e.target.checked ? 0 : (d.duracion_dias || 1) }))} />
                          <label className="form-check-label small" htmlFor="esGrupo">Es sección</label>
                        </div>
                        <input ref={inputRef} className="form-control form-control-sm" placeholder="Nombre"
                          value={editData.nombre}
                          onChange={e => setEditData(d => ({ ...d, nombre: e.target.value }))} />
                        <div className="d-flex gap-2 flex-wrap">
                          {!editData.es_grupo && (
                            <div style={{ width: 90 }}>
                              <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Días</label>
                              <input type="number" className="form-control form-control-sm" min={1}
                                value={editData.duracion_dias}
                                onChange={e => setEditData(d => ({ ...d, duracion_dias: parseInt(e.target.value) || 1 }))} />
                            </div>
                          )}
                          <div>
                            <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Grupo/sección</label>
                            <input className="form-control form-control-sm" placeholder="Sección padre"
                              value={editData.grupo}
                              onChange={e => setEditData(d => ({ ...d, grupo: e.target.value }))} />
                          </div>
                          <div>
                            <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Color</label>
                            <div className="d-flex flex-wrap gap-1 mt-1">
                              {COLORES.map(c => (
                                <button key={c} type="button"
                                  style={{ width: 16, height: 16, borderRadius: 3, background: c || '#4e79a7',
                                    border: editData.color === c ? '2px solid #000' : '1px solid #aaa', padding: 0 }}
                                  onClick={() => setEditData(d => ({ ...d, color: c }))} />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="d-flex gap-2">
                          <button className="btn btn-sm btn-success py-0 px-3" onClick={() => guardarTarea(t.id)} disabled={saving}>
                            {saving ? <span className="spinner-border spinner-border-sm" /> : <><i className="bi bi-check-lg me-1" />Guardar</>}
                          </button>
                          <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => setEditId(null)}>Cancelar</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id}
                    style={{ background: t.es_grupo ? '#f0f4ff' : undefined, fontWeight: t.es_grupo ? 600 : undefined }}>
                    {canWrite && (
                      <td style={{ padding: '2px 4px' }}>
                        <div className="d-flex flex-column">
                          <button className="btn btn-xs p-0" style={{ fontSize: '0.6rem', lineHeight: 1 }}
                            onClick={() => mover(idx, -1)} disabled={idx === 0}>
                            <i className="bi bi-chevron-up" />
                          </button>
                          <button className="btn btn-xs p-0" style={{ fontSize: '0.6rem', lineHeight: 1 }}
                            onClick={() => mover(idx, 1)} disabled={idx === filtradas.length - 1}>
                            <i className="bi bi-chevron-down" />
                          </button>
                        </div>
                      </td>
                    )}
                    <td style={{ padding: '2px 4px' }}>
                      {t.es_grupo
                        ? <i className="bi bi-folder-fill text-warning" style={{ fontSize: '0.85rem' }} />
                        : <div style={{ width: 6, height: 20, borderRadius: 2, background: t.color || '#4e79a7' }} />
                      }
                    </td>
                    <td>{t.es_grupo ? <span className="text-primary">{t.nombre}</span> : t.nombre}</td>
                    <td className="text-center text-muted">{t.es_grupo ? '—' : `${t.duracion_dias}d`}</td>
                    <td className="text-muted" style={{ fontSize: '0.7rem' }}>{t.grupo || '—'}</td>
                    {canWrite && (
                      <td>
                        <div className="d-flex gap-1">
                          <button className="btn btn-xs p-0 px-1 text-secondary" onClick={() => iniciarEdicion(t)}>
                            <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                          </button>
                          <button className="btn btn-xs p-0 px-1 text-danger" onClick={() => eliminarTarea(t.id)}>
                            <i className="bi bi-trash" style={{ fontSize: '0.75rem' }} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 6 : 5} className="text-center text-muted py-4">
                      {buscar ? 'Sin resultados' : selSet !== null ? 'Plantilla vacía — agregá tareas con el botón + Tarea' : 'Sin tareas en el set global'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal: duplicar set ──────────────────────────────────────────── */}
      {dupSet && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1090 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-copy me-2" />Usar "{dupSet.nombre}" como base
                </h6>
                <button className="btn-close" onClick={() => setDupSet(null)} />
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-3">
                  Se copiará la plantilla completa con todas sus tareas. Podés modificarla libremente sin afectar la original.
                </p>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Nombre de la nueva plantilla <span className="text-danger">*</span></label>
                  <input className="form-control form-control-sm"
                    placeholder="Ej: Fabricación equipo DAF"
                    value={dupNombre} onChange={e => setDupNombre(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && duplicarSet()}
                    autoFocus />
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setDupSet(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={duplicarSet}
                  disabled={savingDup || !dupNombre.trim()}>
                  {savingDup
                    ? <><span className="spinner-border spinner-border-sm me-1" />Copiando...</>
                    : <><i className="bi bi-copy me-1" />Crear copia</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: crear/editar set ───────────────────────────────────────── */}
      {formSet && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1090 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  {formSet === 'nuevo' ? 'Nueva plantilla' : `Editar: ${formSet.nombre}`}
                </h6>
                <button className="btn-close" onClick={() => setFormSet(null)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Nombre <span className="text-danger">*</span></label>
                  <input className="form-control form-control-sm" placeholder="Ej: Fabricación equipo DAF"
                    value={setNombre} onChange={e => setSetNombre(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && guardarSet()} autoFocus />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Descripción (opcional)</label>
                  <input className="form-control form-control-sm" placeholder="Equipos de tipo DAF, 34 tareas..."
                    value={setDesc} onChange={e => setSetDesc(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setFormSet(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarSet} disabled={savingSet || !setNombre.trim()}>
                  {savingSet ? <span className="spinner-border spinner-border-sm" /> : <><i className="bi bi-check-lg me-1" />Guardar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
