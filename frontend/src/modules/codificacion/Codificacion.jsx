import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'

// ── helpers ──────────────────────────────────────────────────────────────────────
function buildCodigo(codigoPos1, flujo, respuestas) {
  const arr = Array(10).fill('0')
  const prefLen = codigoPos1.length
  for (let i = 0; i < prefLen; i++) arr[i] = codigoPos1[i]
  for (const paso of flujo) {
    const val = respuestas[paso.pregunta_id] || ''
    const len = paso.pos_hasta - paso.pos_desde + 1
    const padded = val.padEnd(len, '0').substring(0, len)
    for (let i = 0; i < padded.length; i++) arr[paso.pos_desde - 1 + i] = padded[i]
  }
  return arr.join('')
}

function copiarTexto(txt, setCopied) {
  navigator.clipboard.writeText(txt).then(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  })
}

// ── Asistente ────────────────────────────────────────────────────────────────────
function Asistente({ config }) {
  const [tipoId,     setTipoId]     = useState('')
  const [paso,       setPaso]       = useState(0)   // 0 = elegir tipo, 1..N = preguntas
  const [respuestas, setRespuestas] = useState({})
  const [copiado,    setCopiado]    = useState(false)

  const tipo   = config.tipos.find(t => t.id === tipoId)
  const flujo  = tipo?.flujo || []
  const total  = flujo.length
  const listo  = tipo && paso > total

  function reiniciar() {
    setTipoId(''); setPaso(0); setRespuestas({})
  }

  function responder(pregId, valor) {
    setRespuestas(prev => ({ ...prev, [pregId]: valor }))
  }

  function siguiente() {
    if (paso === 0 && !tipoId) return
    setPaso(p => p + 1)
  }

  function anterior() {
    setPaso(p => Math.max(0, p - 1))
  }

  // ── pantalla: elegir tipo ──────────────────────────────────────────────────
  if (paso === 0) {
    return (
      <div className="row justify-content-center">
        <div className="col-lg-6 col-md-8">
          <div className="card">
            <div className="card-header py-2 bg-primary text-white">
              <i className="bi bi-qr-code-scan me-2" />Generador de código
            </div>
            <div className="card-body">
              <p className="small text-muted mb-3">¿Qué tipo de material vas a codificar?</p>
              <div className="d-flex flex-column gap-2">
                {config.tipos.map(t => (
                  <button key={t.id}
                    className={`btn btn-sm text-start ${tipoId === t.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setTipoId(t.id)}>
                    <span className="badge bg-dark me-2" style={{ fontFamily: 'monospace', minWidth: 26 }}>{t.codigo_pos1}</span>
                    {t.descripcion}
                  </button>
                ))}
              </div>
            </div>
            <div className="card-footer py-2 text-end">
              <button className="btn btn-primary btn-sm" disabled={!tipoId} onClick={siguiente}>
                Comenzar <i className="bi bi-arrow-right ms-1" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── pantalla: resultado final ──────────────────────────────────────────────
  if (listo) {
    const codigo = buildCodigo(tipo.codigo_pos1, flujo, respuestas)

    return (
      <div className="row justify-content-center">
        <div className="col-lg-6 col-md-8">
          <div className="card">
            <div className="card-header py-2 bg-success text-white">
              <i className="bi bi-check-circle me-2" />Código generado
            </div>
            <div className="card-body">

              {/* Código grande */}
              <div className="text-center mb-4">
                <div className="d-flex justify-content-center gap-1 mb-2">
                  {codigo.split('').map((c, i) => (
                    <span key={i} className="border rounded px-1 py-1 fw-bold"
                      style={{ fontFamily: 'monospace', fontSize: '1.5rem', minWidth: 32, textAlign: 'center', background: '#f8f9fa' }}>
                      {c}
                    </span>
                  ))}
                </div>
                <button className={`btn btn-sm ${copiado ? 'btn-success' : 'btn-outline-primary'}`}
                  onClick={() => copiarTexto(codigo, setCopiado)}>
                  <i className={`bi ${copiado ? 'bi-check-lg' : 'bi-clipboard'} me-1`} />
                  {copiado ? 'Copiado' : 'Copiar código'}
                </button>
              </div>

              {/* Desglose */}
              <p className="small fw-semibold text-muted mb-2">Desglose</p>
              <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.82rem' }}>
                <tbody>
                  {/* Posición 1: familia */}
                  <tr className="table-light">
                    <td style={{ width: 80 }} className="text-center">
                      <span className="badge bg-secondary" style={{ fontFamily: 'monospace' }}>
                        pos. 1{tipo.codigo_pos1.length > 1 ? '-2' : ''}
                      </span>
                    </td>
                    <td><code>{tipo.codigo_pos1}</code></td>
                    <td>{tipo.descripcion}</td>
                  </tr>
                  {/* Preguntas respondidas */}
                  {flujo.map(paso => {
                    const preg    = config.preguntas[paso.pregunta_id]
                    const val     = respuestas[paso.pregunta_id] || ''
                    const len     = paso.pos_hasta - paso.pos_desde + 1
                    const padded  = val.padEnd(len, '0').substring(0, len)
                    const opDesc  = preg?.tipo === 'opcion'
                      ? (preg.opciones.find(o => o.codigo === padded)?.descripcion || preg.opciones.find(o => padded.startsWith(o.codigo))?.descripcion || '')
                      : ''
                    return (
                      <tr key={paso.pregunta_id}>
                        <td className="text-center">
                          <span className="badge bg-secondary" style={{ fontFamily: 'monospace' }}>
                            pos. {paso.pos_desde}{paso.pos_hasta > paso.pos_desde ? '-' + paso.pos_hasta : ''}
                          </span>
                        </td>
                        <td><code>{padded}</code></td>
                        <td>
                          <span className="text-muted small">{preg?.label?.split('(pos')[0].trim()}</span>
                          {opDesc && <><br /><strong>{opDesc}</strong></>}
                          {!opDesc && val && preg?.tipo === 'libre' && <><br /><strong>{val}</strong></>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-footer py-2 text-end">
              <button className="btn btn-outline-primary btn-sm" onClick={reiniciar}>
                <i className="bi bi-arrow-counterclockwise me-1" />Generar otro
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── pantalla: pregunta actual ──────────────────────────────────────────────
  const pasoActual = flujo[paso - 1]
  const pregunta   = config.preguntas[pasoActual?.pregunta_id]
  const respActual = respuestas[pasoActual?.pregunta_id] || ''
  const puedeAvanzar = pasoActual?.pregunta_id && (
    respActual.trim() !== '' ||
    pregunta?.tipo === 'opcion' // opcion requiere selección
      ? respActual !== ''
      : respActual.length > 0
  )

  return (
    <div className="row justify-content-center">
      <div className="col-lg-6 col-md-8">
        <div className="card">
          <div className="card-header py-2 bg-primary text-white d-flex justify-content-between align-items-center">
            <span><i className="bi bi-qr-code-scan me-2" />{tipo?.descripcion}</span>
            <span className="badge bg-light text-dark">{paso} / {total}</span>
          </div>

          {/* Progreso */}
          <div className="progress" style={{ height: 4, borderRadius: 0 }}>
            <div className="progress-bar" style={{ width: `${(paso / total) * 100}%` }} />
          </div>

          <div className="card-body">
            {/* Preview del código en construcción */}
            <div className="mb-3 p-2 bg-light rounded d-flex justify-content-center gap-1">
              {buildCodigo(tipo?.codigo_pos1 || '', flujo.slice(0, paso - 1), respuestas).split('').map((c, i) => {
                const enCurso = pasoActual && i >= pasoActual.pos_desde - 1 && i <= pasoActual.pos_hasta - 1
                const yaFijo  = i < (tipo?.codigo_pos1.length || 1) || flujo.slice(0, paso - 1).some(p => i >= p.pos_desde - 1 && i <= p.pos_hasta - 1)
                return (
                  <span key={i}
                    className={`border rounded text-center fw-bold`}
                    style={{
                      fontFamily: 'monospace', fontSize: '1rem', minWidth: 24,
                      background: enCurso ? '#cfe2ff' : yaFijo ? '#f8f9fa' : '#fff',
                      color: yaFijo ? '#333' : '#aaa',
                      borderColor: enCurso ? '#0d6efd' : undefined
                    }}>
                    {c}
                  </span>
                )
              })}
            </div>

            <p className="fw-semibold mb-3">
              {pregunta?.label || ''}
              <span className="text-muted fw-normal small ms-2">
                pos. {pasoActual?.pos_desde}{pasoActual?.pos_hasta > pasoActual?.pos_desde ? '–' + pasoActual?.pos_hasta : ''}
              </span>
            </p>

            {/* Opciones */}
            {pregunta?.tipo === 'opcion' && (
              <div className="d-flex flex-column gap-2" style={{ maxHeight: 340, overflowY: 'auto' }}>
                {pregunta.opciones.map(op => (
                  <button key={op.codigo}
                    className={`btn btn-sm text-start d-flex align-items-center gap-2 ${respActual === op.codigo ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => {
                      responder(pasoActual.pregunta_id, op.codigo)
                    }}>
                    <code style={{ minWidth: 32, fontWeight: 'bold' }}>{op.codigo}</code>
                    <span>{op.descripcion || <em className="opacity-50">—</em>}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Libre */}
            {pregunta?.tipo === 'libre' && (
              <div>
                <input
                  type="text"
                  className="form-control form-control-lg"
                  style={{ fontFamily: 'monospace', letterSpacing: 4, maxWidth: 220 }}
                  maxLength={pregunta.longitud}
                  placeholder={'0'.repeat(pregunta.longitud)}
                  value={respActual}
                  autoFocus
                  onChange={e => {
                    const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').substring(0, pregunta.longitud)
                    responder(pasoActual.pregunta_id, v)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && respActual.length > 0) siguiente()
                  }}
                />
                <div className="form-text mt-1">
                  {pregunta.longitud} caracteres. Se completa con ceros a la derecha.
                  {pregunta.longitud >= 5 && ' Ej: 12 → 00012 (½"), 114 → 00114 (1¼"), 200 → 00200 (2")'}
                </div>
              </div>
            )}
          </div>

          <div className="card-footer py-2 d-flex justify-content-between">
            <button className="btn btn-outline-secondary btn-sm" onClick={anterior}>
              <i className="bi bi-arrow-left me-1" />Anterior
            </button>
            <button className="btn btn-primary btn-sm"
              disabled={!puedeAvanzar}
              onClick={siguiente}>
              {paso === total ? <><i className="bi bi-check-lg me-1" />Ver código</> : <>Siguiente <i className="bi bi-arrow-right ms-1" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Configuración ────────────────────────────────────────────────────────────────
function Configuracion({ config, onSave }) {
  const [local,        setLocal]       = useState(() => JSON.parse(JSON.stringify(config)))
  const [subTab,       setSubTab]      = useState('tipos')
  const [saving,       setSaving]      = useState(false)
  const [editTipoId,   setEditTipoId]  = useState(null)
  const [editPregId,   setEditPregId]  = useState(null)
  const [dirty,        setDirty]       = useState(false)
  const [addingStepTo, setAddingStepTo] = useState(null)

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
      alert('Configuración guardada')
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  // ── Tab: Tipos ─────────────────────────────────────────────────────────────
  function TabTipos() {
    const tipo = local.tipos.find(t => t.id === editTipoId)

    function addTipo() {
      const id = `tipo_${Date.now()}`
      mutate(c => c.tipos.push({ id, descripcion: 'Nuevo tipo', codigo_pos1: '?', flujo: [] }))
      setEditTipoId(id)
    }

    function delTipo(id) {
      if (!confirm('¿Eliminar este tipo?')) return
      mutate(c => { c.tipos = c.tipos.filter(t => t.id !== id) })
      if (editTipoId === id) setEditTipoId(null)
    }

    function movPaso(idx, dir) {
      const j = idx + dir
      if (!tipo || j < 0 || j >= tipo.flujo.length) return
      mutate(c => {
        const t = c.tipos.find(t => t.id === editTipoId)
        ;[t.flujo[idx], t.flujo[j]] = [t.flujo[j], t.flujo[idx]]
      })
    }

    function delPaso(idx) {
      mutate(c => c.tipos.find(t => t.id === editTipoId).flujo.splice(idx, 1))
    }

    function setPasoPos(idx, field, val) {
      mutate(c => { c.tipos.find(t => t.id === editTipoId).flujo[idx][field] = +val })
    }

    function addPaso(pregId) {
      mutate(c => c.tipos.find(t => t.id === editTipoId).flujo.push({
        pregunta_id: pregId, pos_desde: 2, pos_hasta: 2
      }))
      setAddingStepTo(null)
    }

    return (
      <div className="row g-3">
        {/* Lista de tipos — misma estética que el asistente */}
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-header py-2 bg-primary text-white d-flex justify-content-between align-items-center small fw-semibold">
              Tipos de material
              <button className="btn btn-sm btn-light py-0 px-2" style={{ fontSize: '0.75rem' }} onClick={addTipo}>+ Nuevo</button>
            </div>
            <div className="d-flex flex-column gap-1 p-2" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {local.tipos.map(t => (
                <div key={t.id} className="d-flex gap-1">
                  <button
                    className={`btn btn-sm text-start flex-grow-1 ${editTipoId === t.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => { setEditTipoId(t.id); setAddingStepTo(null) }}>
                    <span className="badge bg-dark me-2" style={{ fontFamily: 'monospace', minWidth: 26 }}>{t.codigo_pos1}</span>
                    {t.descripcion}
                  </button>
                  <button className="btn btn-sm btn-outline-danger py-0 px-1"
                    onClick={() => delTipo(t.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor del tipo */}
        <div className="col-md-8">
          {!tipo ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-arrow-left me-2" />Seleccioná un tipo para editarlo
            </div>
          ) : (<>
            {/* Nombre y código */}
            <div className="card mb-3">
              <div className="card-body py-2">
                <div className="row g-2 align-items-end">
                  <div className="col-3">
                    <label className="form-label small mb-1 fw-semibold">Código pos. 1</label>
                    <input className="form-control form-control-sm text-center fw-bold"
                      style={{ fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: 2 }}
                      maxLength={2} value={tipo.codigo_pos1}
                      onChange={e => mutate(c => c.tipos.find(t => t.id === editTipoId).codigo_pos1 = e.target.value.toUpperCase())} />
                  </div>
                  <div className="col-9">
                    <label className="form-label small mb-1 fw-semibold">Nombre del tipo</label>
                    <input className="form-control form-control-sm" value={tipo.descripcion}
                      onChange={e => mutate(c => c.tipos.find(t => t.id === editTipoId).descripcion = e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Flujo visual */}
            <div className="card">
              <div className="card-header py-2 d-flex justify-content-between align-items-center">
                <span className="small fw-semibold"><i className="bi bi-list-ol me-1" />Secuencia de preguntas</span>
                <button className="btn btn-sm btn-outline-primary py-0 px-2"
                  onClick={() => setAddingStepTo(editTipoId)}>
                  + Agregar pregunta
                </button>
              </div>

              {/* Picker inline */}
              {addingStepTo === editTipoId && (
                <div className="border-bottom bg-light px-3 py-2">
                  <p className="small fw-semibold mb-2">¿Qué pregunta querés agregar?</p>
                  <div className="d-flex flex-column gap-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {Object.entries(local.preguntas).map(([pid, preg]) => (
                      <button key={pid}
                        className="btn btn-sm btn-outline-secondary text-start d-flex justify-content-between align-items-center"
                        onClick={() => addPaso(pid)}>
                        <span className="small">{preg.label}</span>
                        <span className={`badge ms-2 flex-shrink-0 ${preg.tipo === 'libre' ? 'bg-warning text-dark' : 'bg-secondary'}`} style={{ fontSize: '0.65rem' }}>
                          {preg.tipo === 'libre' ? `libre ${preg.longitud}c` : `${preg.opciones?.length || 0} opciones`}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-sm btn-link text-danger mt-1 py-0 ps-0"
                    onClick={() => setAddingStepTo(null)}>Cancelar</button>
                </div>
              )}

              <div className="card-body py-2">
                {tipo.flujo.length === 0 && (
                  <div className="text-center text-muted py-3 small">Sin preguntas. Usá "+ Agregar pregunta".</div>
                )}
                <div className="d-flex flex-column gap-2">
                  {tipo.flujo.map((paso, idx) => {
                    const preg = local.preguntas[paso.pregunta_id]
                    return (
                      <div key={idx} className="border rounded p-2" style={{ background: '#f8f9fa' }}>
                        {/* Fila superior: número, posiciones, controles */}
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge bg-primary" style={{ minWidth: 22, fontSize: '0.7rem' }}>{idx + 1}</span>
                          <span className="text-muted small flex-shrink-0">pos.</span>
                          <input type="number" className="form-control form-control-sm py-0 text-center"
                            style={{ width: 46, fontFamily: 'monospace' }}
                            min={1} max={10} value={paso.pos_desde}
                            onChange={e => setPasoPos(idx, 'pos_desde', e.target.value)} />
                          <span className="text-muted">–</span>
                          <input type="number" className="form-control form-control-sm py-0 text-center"
                            style={{ width: 46, fontFamily: 'monospace' }}
                            min={1} max={10} value={paso.pos_hasta}
                            onChange={e => setPasoPos(idx, 'pos_hasta', e.target.value)} />
                          <div className="ms-auto d-flex gap-1">
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: '0.7rem' }}
                              disabled={idx === 0} onClick={() => movPaso(idx, -1)}>↑</button>
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: '0.7rem' }}
                              disabled={idx === tipo.flujo.length - 1} onClick={() => movPaso(idx, 1)}>↓</button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" style={{ fontSize: '0.7rem' }}
                              onClick={() => delPaso(idx)}>✕</button>
                          </div>
                        </div>

                        {/* Fila inferior: pregunta */}
                        <div className="mt-2 ps-1">
                          {preg ? (<>
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <span className="small fw-semibold">{preg.label}</span>
                              <span className={`badge ${preg.tipo === 'libre' ? 'bg-warning text-dark' : 'bg-info text-dark'}`} style={{ fontSize: '0.62rem' }}>
                                {preg.tipo === 'libre' ? `texto libre · ${preg.longitud} chars` : `${preg.opciones?.length || 0} opciones`}
                              </span>
                            </div>
                            {preg.tipo === 'opcion' && preg.opciones?.length > 0 && (
                              <div className="d-flex flex-wrap gap-1">
                                {preg.opciones.slice(0, 5).map((op, i) => (
                                  <span key={i} className="badge bg-white border text-dark" style={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                    <strong>{op.codigo}</strong>{op.descripcion ? ` ${op.descripcion.substring(0, 18)}` : ''}
                                  </span>
                                ))}
                                {preg.opciones.length > 5 && (
                                  <span className="badge bg-light text-muted border" style={{ fontSize: '0.65rem' }}>+{preg.opciones.length - 5} más</span>
                                )}
                              </div>
                            )}
                          </>) : (
                            <span className="text-danger small">⚠ Pregunta no encontrada: {paso.pregunta_id}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>)}
        </div>
      </div>
    )
  }

  // ── Tab: Preguntas ─────────────────────────────────────────────────────────
  function TabPreguntas() {
    const preg = editPregId ? local.preguntas[editPregId] : null

    function addPregunta() {
      const id = `pregunta_${Date.now()}`
      mutate(c => { c.preguntas[id] = { label: 'Nueva pregunta', tipo: 'opcion', opciones: [] } })
      setEditPregId(id)
    }

    function delPregunta(id) {
      if (!confirm('¿Eliminar esta pregunta? Verificá que no esté en ningún flujo.')) return
      mutate(c => { delete c.preguntas[id] })
      if (editPregId === id) setEditPregId(null)
    }

    function addOpcion() {
      mutate(c => c.preguntas[editPregId].opciones.push({ codigo: '', descripcion: '' }))
    }

    function delOpcion(idx) {
      mutate(c => c.preguntas[editPregId].opciones.splice(idx, 1))
    }

    return (
      <div className="row g-3">
        {/* Lista con labels legibles */}
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-header py-2 bg-primary text-white d-flex justify-content-between align-items-center small fw-semibold">
              Preguntas ({Object.keys(local.preguntas).length})
              <button className="btn btn-sm btn-light py-0 px-2" style={{ fontSize: '0.75rem' }} onClick={addPregunta}>+ Nueva</button>
            </div>
            <div className="d-flex flex-column gap-1 p-2" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {Object.entries(local.preguntas).map(([pid, p]) => (
                <div key={pid} className="d-flex gap-1">
                  <button
                    className={`btn btn-sm text-start flex-grow-1 d-flex justify-content-between align-items-center ${editPregId === pid ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setEditPregId(pid)}>
                    <span className="small text-truncate" style={{ maxWidth: 160 }}>{p.label}</span>
                    <span className={`badge ms-1 flex-shrink-0 ${p.tipo === 'libre' ? 'bg-warning text-dark' : 'bg-info text-dark'}`} style={{ fontSize: '0.6rem' }}>
                      {p.tipo === 'libre' ? `L${p.longitud}` : p.opciones?.length || 0}
                    </span>
                  </button>
                  <button className="btn btn-sm btn-outline-danger py-0 px-1"
                    onClick={() => delPregunta(pid)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor de pregunta */}
        <div className="col-md-8">
          {!preg ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-arrow-left me-2" />Seleccioná una pregunta para editarla
            </div>
          ) : (
            <div className="card">
              <div className="card-header py-2 small fw-semibold bg-light">Editar pregunta</div>
              <div className="card-body">
                <div className="row g-2 mb-3">
                  <div className="col-12">
                    <label className="form-label small mb-1 fw-semibold">Texto que ve el usuario</label>
                    <input className="form-control" value={preg.label}
                      onChange={e => mutate(c => c.preguntas[editPregId].label = e.target.value)} />
                  </div>
                  <div className="col-5">
                    <label className="form-label small mb-1 fw-semibold">Tipo de respuesta</label>
                    <select className="form-select" value={preg.tipo}
                      onChange={e => mutate(c => {
                        c.preguntas[editPregId].tipo = e.target.value
                        if (e.target.value === 'libre') {
                          c.preguntas[editPregId].longitud = c.preguntas[editPregId].longitud || 1
                          delete c.preguntas[editPregId].opciones
                        } else {
                          c.preguntas[editPregId].opciones = c.preguntas[editPregId].opciones || []
                        }
                      })}>
                      <option value="opcion">Lista de opciones</option>
                      <option value="libre">Texto libre</option>
                    </select>
                  </div>
                  {preg.tipo === 'libre' && (
                    <div className="col-3">
                      <label className="form-label small mb-1 fw-semibold">Longitud</label>
                      <input type="number" className="form-control" min={1} max={10}
                        value={preg.longitud || 1}
                        onChange={e => mutate(c => c.preguntas[editPregId].longitud = +e.target.value)} />
                    </div>
                  )}
                </div>

                {preg.tipo === 'opcion' && (
                  <>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="small fw-semibold">Opciones ({preg.opciones?.length || 0})</span>
                      <button className="btn btn-sm btn-outline-primary py-0" onClick={addOpcion}>+ Agregar opción</button>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.82rem' }}>
                        <thead className="table-light">
                          <tr><th style={{ width: 90 }}>Código</th><th>Descripción</th><th style={{ width: 36 }}/></tr>
                        </thead>
                        <tbody>
                          {(preg.opciones || []).map((op, i) => (
                            <tr key={i}>
                              <td>
                                <input className="form-control form-control-sm py-0 text-center fw-bold"
                                  style={{ fontFamily: 'monospace' }}
                                  value={op.codigo}
                                  onChange={e => mutate(c => c.preguntas[editPregId].opciones[i].codigo = e.target.value.toUpperCase())} />
                              </td>
                              <td>
                                <input className="form-control form-control-sm py-0" value={op.descripcion}
                                  onChange={e => mutate(c => c.preguntas[editPregId].opciones[i].descripcion = e.target.value)} />
                              </td>
                              <td className="text-center">
                                <button className="btn btn-sm btn-outline-danger py-0 px-1" style={{ fontSize: '0.7rem' }} onClick={() => delOpcion(i)}>✕</button>
                              </td>
                            </tr>
                          ))}
                          {!preg.opciones?.length && (
                            <tr><td colSpan={3} className="text-center text-muted py-2 small">Sin opciones</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <ul className="nav nav-tabs mb-0">
          {[['tipos','Tipos de material'],['preguntas','Preguntas y opciones']].map(([id, lbl]) => (
            <li className="nav-item" key={id}>
              <button className={`nav-link py-1 ${subTab === id ? 'active' : ''}`} onClick={() => setSubTab(id)}>{lbl}</button>
            </li>
          ))}
        </ul>
        {dirty && (
          <button className="btn btn-sm btn-warning" onClick={guardar} disabled={saving}>
            {saving ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : <><i className="bi bi-floppy me-1" />Guardar cambios</>}
          </button>
        )}
      </div>

      {subTab === 'tipos'     && TabTipos()}
      {subTab === 'preguntas' && TabPreguntas()}
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
