import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { buildCodigo, flujoActivo, copiarTexto, Asistente } from './AsistenteCore'


// ── Configuración ────────────────────────────────────────────────────────────────
function Configuracion({ config, onSave }) {
  const [local,      setLocal]     = useState(() => JSON.parse(JSON.stringify(config)))
  const [dirty,      setDirty]     = useState(false)
  const [saving,     setSaving]    = useState(false)
  // navegación (igual que Asistente pero sobre local)
  const [tipoId,     setTipoId]    = useState('')
  const [respuestas, setRespuestas]= useState({})
  const [libreVal,   setLibreVal]  = useState({})
  // qué pregunta tiene el editor abierto
  const [editandoId, setEditandoId]= useState(null)
  // agregar nuevo paso
  const [addingPaso,       setAddingPaso]       = useState(false)
  const [newPasoDesde,     setNewPasoDesde]      = useState(7)
  const [newPasoHasta,     setNewPasoHasta]      = useState(10)
  const [newPasoLabel,     setNewPasoLabel]      = useState('')
  const [newPasoTipo,      setNewPasoTipo]        = useState('opcion')
  const [newPasoOpciones,  setNewPasoOpciones]   = useState([{ codigo: '', descripcion: '' }])
  const [newPasoSiPregId,  setNewPasoSiPregId]  = useState('')
  const [newPasoSiEn,      setNewPasoSiEn]       = useState('')
  // editor de condición inline
  const [editandoCondId,   setEditandoCondId]    = useState(null)
  const [condSiPregId,     setCondSiPregId]      = useState('')
  const [condSiEn,         setCondSiEn]          = useState('')

  function mutate(fn) {
    setLocal(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      fn(next)
      return next
    })
    setDirty(true)
  }

  async function guardar() {
    setSaving(true)
    try {
      await api.put('/codificacion/config', local)
      setDirty(false)
      onSave(local)
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  const tipo    = local.tipos.find(t => t.id === tipoId)
  const flujo   = tipo?.flujo || []
  const activos = flujoActivo(flujo, respuestas)
  const corrienteIdx = activos.findIndex(p => respuestas[p.pregunta_id] === undefined)

  function elegirTipo(id) { setTipoId(id); setRespuestas({}); setLibreVal({}); setEditandoId(null) }
  function reiniciar()     { setTipoId(''); setRespuestas({}); setLibreVal({}); setEditandoId(null) }

  function responder(pregId, valor) {
    setRespuestas(prev => {
      const next = { ...prev, [pregId]: valor }
      const activosIds = new Set(flujoActivo(flujo, next).map(p => p.pregunta_id))
      for (const id of Object.keys(next)) {
        const step = flujo.find(p => p.pregunta_id === id)
        if (step?.si && !activosIds.has(id)) delete next[id]
      }
      return next
    })
    setLibreVal(prev => { const n = { ...prev }; delete n[pregId]; return n })
    setEditandoId(null)
  }

  function editarDesde(pregId) {
    const oldVal = respuestas[pregId]
    setRespuestas(prev => {
      const next = { ...prev }
      let borrar = false
      for (const p of activos) {
        if (p.pregunta_id === pregId) borrar = true
        if (borrar) delete next[p.pregunta_id]
      }
      return next
    })
    if (oldVal !== undefined)
      setLibreVal(prev => ({ ...prev, [pregId]: String(oldVal) }))
  }

  // Devuelve la condición si para nuevos pasos según lo que el usuario eligió en pos2-3
  function getSiContexto() {
    const pos23Step = flujo.find(p => !p.si && p.pos_desde <= 2 && p.pos_hasta >= 2)
    if (!pos23Step) return null
    const val = respuestas[pos23Step.pregunta_id]
    if (!val) return null
    return { pregunta_id: pos23Step.pregunta_id, en: [val] }
  }

  function delPasoFromFlujo(pregId) {
    mutate(c => {
      const t = c.tipos.find(t => t.id === tipoId)
      t.flujo = t.flujo.filter(p => p.pregunta_id !== pregId)
    })
    setRespuestas(prev => { const n = { ...prev }; delete n[pregId]; return n })
    if (editandoId === pregId) setEditandoId(null)
  }

  function confirmarNuevoPaso() {
    if (!newPasoLabel.trim()) return
    const pregId = `${tipoId}_custom_${Date.now()}`
    let si = null
    if (newPasoSiPregId && newPasoSiEn.trim())
      si = { pregunta_id: newPasoSiPregId, en: newPasoSiEn.split(',').map(v => v.trim()).filter(Boolean) }
    const opcs = newPasoOpciones.filter(o => o.codigo.trim())
    mutate(c => {
      c.preguntas[pregId] = {
        label:   newPasoLabel.trim(),
        tipo:    newPasoTipo,
        ...(newPasoTipo === 'opcion' ? { opciones: opcs } : { longitud: newPasoHasta - newPasoDesde + 1 })
      }
      const t = c.tipos.find(t => t.id === tipoId)
      const step = { pregunta_id: pregId, pos_desde: +newPasoDesde, pos_hasta: +newPasoHasta }
      if (si) step.si = si
      t.flujo.push(step)
      t.flujo.sort((a, b) => a.pos_desde - b.pos_desde)
    })
    setAddingPaso(false)
    setNewPasoLabel(''); setNewPasoOpciones([{ codigo: '', descripcion: '' }])
    setNewPasoTipo('opcion'); setNewPasoSiPregId(''); setNewPasoSiEn('')
  }

  // ── Editor inline — aparece debajo de las opciones del paso ──────────
  function renderEditor(pregId) {
    const preg = local.preguntas[pregId]
    if (!preg) return null
    return (
      <div className="border-top mt-3 pt-3">
        <div className="row g-2 mb-3">
          <div className="col-8">
            <label className="form-label small mb-1 fw-semibold text-dark">Texto de la pregunta</label>
            <input className="form-control form-control-sm" value={preg.label}
              onChange={e => mutate(c => { c.preguntas[pregId].label = e.target.value })} />
          </div>
          <div className="col-4">
            <label className="form-label small mb-1 fw-semibold text-dark">Tipo de respuesta</label>
            <select className="form-select form-select-sm" value={preg.tipo}
              onChange={e => mutate(c => {
                const p = c.preguntas[pregId]
                p.tipo = e.target.value
                if (e.target.value === 'libre') {
                  p.longitud = p.longitud || 1
                  delete p.opciones
                } else {
                  p.opciones = p.opciones || []
                  delete p.longitud
                }
              })}>
              <option value="opcion">Lista de opciones</option>
              <option value="libre">Valor manual</option>
            </select>
          </div>
          {preg.tipo === 'libre' && (<>
            <div className="col-3">
              <label className="form-label small mb-1 fw-semibold text-dark">Longitud (chars)</label>
              <input type="number" className="form-control form-control-sm text-center"
                min={1} max={10} value={preg.longitud || 1}
                onChange={e => mutate(c => { c.preguntas[pregId].longitud = +e.target.value })} />
            </div>
            <div className="col-5">
              <label className="form-label small mb-1 fw-semibold text-dark">Relleno con ceros</label>
              <select className="form-select form-select-sm" value={preg.relleno || 'derecha'}
                onChange={e => mutate(c => { c.preguntas[pregId].relleno = e.target.value })}>
                <option value="derecha">a la derecha (texto: AB→AB0)</option>
                <option value="izquierda">a la izquierda (número: 40→040)</option>
              </select>
            </div>
          </>)}
        </div>
        {preg.tipo === 'opcion' && (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <span className="small fw-semibold text-dark">
                Opciones <span className="badge bg-secondary ms-1">{preg.opciones?.length || 0}</span>
              </span>
              <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.72rem' }}
                onClick={() => mutate(c => c.preguntas[pregId].opciones.push({ codigo: '', descripcion: '' }))}>
                + Agregar
              </button>
            </div>
            <div className="d-flex flex-column gap-1" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {(preg.opciones || []).map((op, i) => (
                <div key={i} className="d-flex align-items-center gap-1">
                  <input className="form-control form-control-sm text-center fw-bold"
                    style={{ width: 60, fontFamily: 'monospace', fontSize: '0.85rem' }}
                    value={op.codigo}
                    onChange={e => mutate(c => { c.preguntas[pregId].opciones[i].codigo = e.target.value.toUpperCase() })} />
                  <input className="form-control form-control-sm flex-grow-1" style={{ fontSize: '0.85rem' }}
                    value={op.descripcion}
                    onChange={e => mutate(c => { c.preguntas[pregId].opciones[i].descripcion = e.target.value })} />
                  <button className="btn btn-sm btn-outline-danger py-0 px-1" style={{ fontSize: '0.7rem' }}
                    onClick={() => mutate(c => { c.preguntas[pregId].opciones.splice(i, 1) })}>✕</button>
                </div>
              ))}
              {!(preg.opciones?.length) && (
                <div className="text-muted small text-center py-1">Sin opciones — usá &quot;+ Agregar&quot;</div>
              )}
            </div>
          </div>
        )}
        {/* ── Condición de visibilidad ── */}
        {(() => {
          const paso = flujo.find(p => p.pregunta_id === pregId)
          const editCond = editandoCondId === pregId
          return (
            <div className="mt-3 pt-2 border-top">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="small fw-semibold text-muted">
                  <i className="bi bi-funnel me-1 text-warning" />Condición (mostrar solo si...)
                </span>
                {!editCond && (
                  <button className="btn btn-sm btn-link py-0 text-muted" style={{ fontSize: '0.72rem' }}
                    onClick={() => {
                      setCondSiPregId(paso?.si?.pregunta_id || '')
                      setCondSiEn((paso?.si?.en || []).join(', '))
                      setEditandoCondId(pregId)
                    }}>
                    {paso?.si ? 'editar' : '+ agregar'}
                  </button>
                )}
              </div>
              {!editCond && paso?.si && (
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="badge bg-warning text-dark" style={{ fontSize: '0.68rem' }}>
                    si [{paso.si.en.join(', ')}] — {local.preguntas[paso.si.pregunta_id]?.label?.split('\n')[0]?.substring(0, 30) || paso.si.pregunta_id}
                  </span>
                  <button className="btn btn-sm btn-link py-0 text-danger" style={{ fontSize: '0.7rem' }}
                    onClick={() => mutate(c => {
                      const s = c.tipos.find(t => t.id === tipoId)?.flujo.find(p => p.pregunta_id === pregId)
                      if (s) delete s.si
                    })}>quitar</button>
                </div>
              )}
              {!editCond && !paso?.si && (
                <span className="text-muted small">Sin condición — siempre visible</span>
              )}
              {editCond && (
                <div>
                  <select className="form-select form-select-sm mb-1" value={condSiPregId}
                    onChange={e => setCondSiPregId(e.target.value)}>
                    <option value="">-- elegir pregunta --</option>
                    {Object.entries(local.preguntas)
                      .filter(([pid]) => pid !== pregId)
                      .map(([pid, p]) => (
                        <option key={pid} value={pid}>{p.label.split('\n')[0].substring(0, 55)}</option>
                      ))}
                  </select>
                  <input className="form-control form-control-sm mb-1"
                    style={{ fontFamily: 'monospace' }}
                    placeholder="valores separados por coma: 00, Q0, A0"
                    value={condSiEn} onChange={e => setCondSiEn(e.target.value)} />
                  <div className="d-flex gap-1">
                    <button className="btn btn-sm btn-primary py-0"
                      disabled={!condSiPregId || !condSiEn.trim()}
                      onClick={() => {
                        mutate(c => {
                          const s = c.tipos.find(t => t.id === tipoId)?.flujo.find(p => p.pregunta_id === pregId)
                          if (s) s.si = { pregunta_id: condSiPregId, en: condSiEn.split(',').map(v => v.trim()).filter(Boolean) }
                        })
                        setEditandoCondId(null)
                      }}>
                      <i className="bi bi-check me-1" />Guardar condición
                    </button>
                    {paso?.si && (
                      <button className="btn btn-sm btn-outline-danger py-0"
                        onClick={() => {
                          mutate(c => {
                            const s = c.tipos.find(t => t.id === tipoId)?.flujo.find(p => p.pregunta_id === pregId)
                            if (s) delete s.si
                          })
                          setEditandoCondId(null)
                        }}>Quitar</button>
                    )}
                    <button className="btn btn-sm btn-outline-secondary py-0"
                      onClick={() => setEditandoCondId(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const codigo = tipo ? buildCodigo(tipo.codigo_pos1, activos, respuestas, local.preguntas) : '0000000000'

  return (
    <div className="row justify-content-center">
      <div className="col-lg-8 col-md-10">

        {/* Guardar cambios */}
        {dirty && (
          <div className="d-flex justify-content-end mb-2">
            <button className="btn btn-sm btn-warning" onClick={guardar} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : <><i className="bi bi-floppy me-1" />Guardar cambios</>}
            </button>
          </div>
        )}

        {/* Preview del código */}
        {tipo && (
          <div className="mb-2 p-2 bg-light border rounded d-flex justify-content-center gap-1">
            {codigo.split('').map((c, i) => {
              const curr    = activos[corrienteIdx]
              const enCurso = curr && i >= curr.pos_desde - 1 && i <= curr.pos_hasta - 1
              const fijo    = i < tipo.codigo_pos1.length ||
                activos.some(p => respuestas[p.pregunta_id] !== undefined && i >= p.pos_desde - 1 && i <= p.pos_hasta - 1)
              const esLetra = fijo && /[A-Za-zÑñ]/.test(c)
              return (
                <span key={i} className="border rounded text-center fw-bold"
                  style={{
                    fontFamily: 'monospace', fontSize: '0.95rem', minWidth: 26, padding: '3px 0',
                    background: enCurso ? '#cfe2ff' : esLetra ? '#e8eaf6' : fijo ? '#f8f9fa' : '#fff',
                    color: enCurso ? '#0d47a1' : esLetra ? '#1a237e' : fijo ? '#333' : '#ccc',
                    borderColor: enCurso ? '#0d6efd' : esLetra ? '#7986cb' : undefined
                  }}>{c}</span>
              )
            })}
          </div>
        )}

        {/* Paso 0: elegir tipo */}
        <div className={`card mb-2 ${!tipo ? 'border-primary shadow-sm' : ''}`}>
          <div className="card-body py-2">
            {!tipo ? (
              <>
                <p className="small fw-semibold mb-2 text-muted">¿Qué tipo de material querés editar?</p>
                <div className="d-flex flex-column gap-1" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {local.tipos.map(t => (
                    <button key={t.id} className="btn btn-sm text-start btn-outline-secondary"
                      onClick={() => elegirTipo(t.id)}>
                      <span className="badge bg-dark me-2" style={{ fontFamily: 'monospace', minWidth: 26 }}>{t.codigo_pos1}</span>
                      {t.descripcion}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted small">Tipo:</span>
                <span className="badge bg-dark" style={{ fontFamily: 'monospace' }}>{tipo.codigo_pos1}</span>
                <span className="fw-semibold small">{tipo.descripcion}</span>
                <button className="btn btn-sm btn-link ms-auto py-0 text-muted" onClick={reiniciar}>cambiar</button>
              </div>
            )}
          </div>
        </div>

        {/* Pasos del flujo — con editor inline por paso */}
        {tipo && activos.map((p, idx) => {
          const preg     = local.preguntas[p.pregunta_id]
          const resp     = respuestas[p.pregunta_id]
          const esCurr   = idx === corrienteIdx
          const enEdicion = editandoId === p.pregunta_id

          if (!preg) return null
          if (resp === undefined && !esCurr) return null

          if (resp !== undefined) {
            const opDesc = preg.tipo === 'opcion'
              ? (preg.opciones.find(o => o.codigo === resp)?.descripcion || '')
              : ''
            return (
              <div key={p.pregunta_id} className={`card mb-1 ${enEdicion ? 'border-warning' : ''}`}>
                <div className="card-body py-2 px-3">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="small text-muted" style={{ minWidth: 120 }}>
                      {preg.label.split('\n')[0].trim().substring(0, 32)}
                      <span className="ms-1 opacity-50" style={{ fontSize: '0.7rem' }}>
                        pos.{p.pos_desde}{p.pos_hasta > p.pos_desde ? '-' + p.pos_hasta : ''}
                      </span>
                    </span>
                    <code className="fw-bold text-primary" style={{ fontSize: '0.85rem' }}>{resp}</code>
                    {opDesc && <span className="small text-truncate" style={{ maxWidth: 220 }}>{opDesc}</span>}
                    <div className="ms-auto d-flex gap-2 align-items-center">
                      <button className="btn btn-sm btn-link py-0 text-muted" style={{ fontSize: '0.72rem' }}
                        onClick={() => editarDesde(p.pregunta_id)}>
                        editar resp.
                      </button>
                      <button className={`btn btn-sm btn-link py-0 ${enEdicion ? 'text-warning fw-bold' : 'text-muted'}`}
                        style={{ fontSize: '0.72rem' }}
                        onClick={() => setEditandoId(enEdicion ? null : p.pregunta_id)}>
                        <i className={`bi ${enEdicion ? 'bi-x-lg' : 'bi-pencil'} me-1`} />
                        {enEdicion ? 'cerrar' : 'editar lista'}
                      </button>
                      <button className="btn btn-sm btn-link py-0 text-danger" style={{ fontSize: '0.72rem' }}
                        title="Eliminar paso del flujo"
                        onClick={() => delPasoFromFlujo(p.pregunta_id)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </div>
                  {enEdicion && renderEditor(p.pregunta_id)}
                </div>
              </div>
            )
          }

          return (
            <div key={p.pregunta_id} className={`card mb-2 shadow-sm ${enEdicion ? 'border-warning' : 'border-primary'}`}>
              <div className={`card-header py-2 d-flex justify-content-between align-items-center ${enEdicion ? 'bg-warning text-dark' : 'bg-primary text-white'}`}>
                <span className="small fw-semibold">
                  {preg.label.split('\n').filter(Boolean).join(' · ')}
                </span>
                <div className="d-flex align-items-center gap-2">
                  <span className={`badge ${enEdicion ? 'bg-dark' : 'bg-light text-dark'}`}
                    style={{ fontSize: '0.68rem', fontFamily: 'monospace' }}>
                    pos.{p.pos_desde}{p.pos_hasta > p.pos_desde ? '-' + p.pos_hasta : ''}
                  </span>
                  <button className={`btn btn-sm py-0 px-2 ${enEdicion ? 'btn-dark' : 'btn-outline-light'}`}
                    style={{ fontSize: '0.72rem' }}
                    onClick={() => setEditandoId(enEdicion ? null : p.pregunta_id)}>
                    <i className={`bi ${enEdicion ? 'bi-x-lg' : 'bi-pencil'} me-1`} />
                    {enEdicion ? 'Cerrar editor' : 'Editar'}
                  </button>
                  <button className={`btn btn-sm py-0 px-1 ${enEdicion ? 'btn-outline-dark' : 'btn-outline-light'}`}
                    style={{ fontSize: '0.72rem' }} title="Eliminar paso"
                    onClick={() => delPasoFromFlujo(p.pregunta_id)}>
                    <i className="bi bi-trash" />
                  </button>
                </div>
              </div>
              <div className="card-body py-2">
                {preg.tipo === 'opcion' && (
                  <div className="d-flex flex-column gap-1" style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {preg.opciones.map(op => (
                      <button key={op.codigo}
                        className="btn btn-sm text-start d-flex align-items-center gap-2 btn-outline-secondary"
                        onClick={() => responder(p.pregunta_id, op.codigo)}>
                        <code style={{ minWidth: 32, fontWeight: 'bold' }}>{op.codigo}</code>
                        <span>{op.descripcion || <em className="opacity-50">—</em>}</span>
                      </button>
                    ))}
                  </div>
                )}
                {preg.tipo === 'libre' && (
                  <div className="d-flex gap-2 align-items-start">
                    <div>
                      <input type="text" className="form-control form-control-lg"
                        style={{ fontFamily: 'monospace', letterSpacing: 4, maxWidth: 200 }}
                        maxLength={preg.longitud}
                        placeholder={'0'.repeat(preg.longitud)}
                        value={libreVal[p.pregunta_id] || ''}
                        onChange={e => {
                          const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').substring(0, preg.longitud)
                          setLibreVal(prev => ({ ...prev, [p.pregunta_id]: v }))
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (libreVal[p.pregunta_id] || '').length > 0)
                            responder(p.pregunta_id, libreVal[p.pregunta_id])
                        }}
                      />
                      <div className="form-text mt-1">
                        {preg.longitud} caracteres — se completa con ceros a la {preg.relleno === 'izquierda' ? 'izquierda' : 'derecha'}.
                      </div>
                    </div>
                    <button className="btn btn-primary"
                      disabled={!(libreVal[p.pregunta_id] || '').length}
                      onClick={() => responder(p.pregunta_id, libreVal[p.pregunta_id] || '')}>
                      OK
                    </button>
                  </div>
                )}
                {enEdicion && renderEditor(p.pregunta_id)}
              </div>
            </div>
          )
        })}

        {/* ── Agregar nuevo paso ── */}
        {tipo && (
          <div className="mt-2">
            {!addingPaso ? (
              <button className="btn btn-sm btn-outline-primary w-100"
                onClick={() => {
                  // Sugerir siguiente posición libre
                  const ocupadas = activos.map(p => p.pos_hasta)
                  const maxOcup  = ocupadas.length ? Math.max(...ocupadas) : (tipo.codigo_pos1.length)
                  const desde = Math.min(maxOcup + 1, 10)
                  setNewPasoDesde(desde)
                  setNewPasoHasta(Math.min(desde + 3, 10))
                  setNewPasoLabel('')
                  setNewPasoTipo('opcion')
                  setNewPasoOpciones([{ codigo: '', descripcion: '' }])
                  setAddingPaso(true)
                }}>
                <i className="bi bi-plus-lg me-1" />Agregar paso al flujo
              </button>
            ) : (
              <div className="card border-primary shadow-sm">
                <div className="card-header py-2 bg-primary text-white small fw-semibold d-flex justify-content-between">
                  <span><i className="bi bi-plus-circle me-1" />Nuevo paso</span>
                  <button className="btn btn-sm btn-outline-light py-0 px-1" style={{ fontSize: '0.7rem' }}
                    onClick={() => setAddingPaso(false)}>✕</button>
                </div>
                <div className="card-body py-3">
                  {/* Posiciones */}
                  <div className="row g-2 mb-3 align-items-end">
                    <div className="col-auto">
                      <label className="form-label small mb-1 fw-semibold">Pos. desde</label>
                      <input type="number" className="form-control form-control-sm text-center"
                        style={{ width: 64, fontFamily: 'monospace' }} min={1} max={10}
                        value={newPasoDesde}
                        onChange={e => setNewPasoDesde(+e.target.value)} />
                    </div>
                    <div className="col-auto pb-1 text-muted">–</div>
                    <div className="col-auto">
                      <label className="form-label small mb-1 fw-semibold">Pos. hasta</label>
                      <input type="number" className="form-control form-control-sm text-center"
                        style={{ width: 64, fontFamily: 'monospace' }} min={1} max={10}
                        value={newPasoHasta}
                        onChange={e => setNewPasoHasta(+e.target.value)} />
                    </div>
                    <div className="col">
                      <label className="form-label small mb-1 fw-semibold">Tipo de respuesta</label>
                      <select className="form-select form-select-sm" value={newPasoTipo}
                        onChange={e => setNewPasoTipo(e.target.value)}>
                        <option value="opcion">Lista de opciones</option>
                        <option value="libre">Texto libre</option>
                      </select>
                    </div>
                  </div>
                  {/* Label */}
                  <div className="mb-3">
                    <label className="form-label small mb-1 fw-semibold">Texto de la pregunta</label>
                    <input className="form-control form-control-sm"
                      placeholder="Ej: CORRIENTE NOMINAL (contactor)"
                      value={newPasoLabel}
                      onChange={e => setNewPasoLabel(e.target.value)} />
                  </div>
                  {/* Opciones */}
                  {newPasoTipo === 'opcion' && (
                    <div className="mb-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <span className="small fw-semibold text-muted">
                          Opciones <span className="badge bg-secondary ms-1">{newPasoOpciones.length}</span>
                        </span>
                        <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.72rem' }}
                          onClick={() => setNewPasoOpciones(prev => [...prev, { codigo: '', descripcion: '' }])}>
                          + Agregar
                        </button>
                      </div>
                      <div className="d-flex flex-column gap-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {newPasoOpciones.map((op, i) => (
                          <div key={i} className="d-flex align-items-center gap-1">
                            <input className="form-control form-control-sm text-center fw-bold"
                              style={{ width: 60, fontFamily: 'monospace', fontSize: '0.85rem' }}
                              placeholder="00" value={op.codigo}
                              onChange={e => setNewPasoOpciones(prev => {
                                const n = [...prev]; n[i] = { ...n[i], codigo: e.target.value.toUpperCase() }; return n
                              })} />
                            <input className="form-control form-control-sm flex-grow-1" style={{ fontSize: '0.85rem' }}
                              placeholder="descripción" value={op.descripcion}
                              onChange={e => setNewPasoOpciones(prev => {
                                const n = [...prev]; n[i] = { ...n[i], descripcion: e.target.value }; return n
                              })} />
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" style={{ fontSize: '0.7rem' }}
                              onClick={() => setNewPasoOpciones(prev => prev.filter((_, j) => j !== i))}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Condición manual */}
                  <div className="mb-3">
                    <label className="form-label small mb-1 fw-semibold">
                      <i className="bi bi-funnel me-1 text-warning" />Condición (mostrar solo si...)
                    </label>
                    <select className="form-select form-select-sm mb-1" value={newPasoSiPregId}
                      onChange={e => { setNewPasoSiPregId(e.target.value); setNewPasoSiEn('') }}>
                      <option value="">Sin condición — siempre visible</option>
                      {activos.map(p => (
                        <option key={p.pregunta_id} value={p.pregunta_id}>
                          {local.preguntas[p.pregunta_id]?.label?.split('\n')[0]?.substring(0, 50) || p.pregunta_id}
                        </option>
                      ))}
                    </select>
                    {newPasoSiPregId && (
                      <input className="form-control form-control-sm" style={{ fontFamily: 'monospace' }}
                        placeholder="valores separados por coma: 00, Q0, A0"
                        value={newPasoSiEn} onChange={e => setNewPasoSiEn(e.target.value)} />
                    )}
                  </div>
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-primary"
                      disabled={!newPasoLabel.trim()}
                      onClick={confirmarNuevoPaso}>
                      <i className="bi bi-check-lg me-1" />Agregar al flujo
                    </button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setAddingPaso(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── componente principal ─────────────────────────────────────────────────────────
export default function Codificacion() {
  const puedeConfig  = puedeEscribir('codificacion')

  const [tab,    setTab]    = useState('asistente')
  const [config, setConfig] = useState(null)
  const [error,  setError]  = useState(null)

  const cargarConfig = useCallback(() => {
    api.get('/codificacion/config')
      .then(r => setConfig(r.data))
      .catch(() => setError('No se pudo cargar la configuración del módulo.'))
  }, [])

  useEffect(() => { cargarConfig() }, [cargarConfig])

  if (error) return <div className="alert alert-danger m-3">{error}</div>
  if (!config) return <div className="text-center py-5"><span className="spinner-border" /></div>

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0"><i className="bi bi-tag me-2" />Codificación de Materiales</h4>
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link py-1 ${tab === 'asistente' ? 'active' : ''}`} onClick={() => setTab('asistente')}>
            <i className="bi bi-qr-code-scan me-1" />Asistente
          </button>
        </li>
        {puedeConfig && (
          <li className="nav-item">
            <button className={`nav-link py-1 ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>
              <i className="bi bi-gear me-1" />Configuración
            </button>
          </li>
        )}
      </ul>

      {tab === 'asistente' && <Asistente config={config} />}
      {tab === 'config' && puedeConfig && <Configuracion config={config} onSave={c => setConfig(c)} />}
    </div>
  )
}
