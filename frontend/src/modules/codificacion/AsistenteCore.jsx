import { useState, useRef } from 'react'
import api from '../../api/client'

export function buildCodigo(codigoPos1, flujo, respuestas, preguntas) {
  const arr = Array(10).fill('0')
  const prefLen = codigoPos1.length
  for (let i = 0; i < prefLen; i++) arr[i] = codigoPos1[i]
  for (const paso of flujo) {
    const val = respuestas[paso.pregunta_id] ?? ''
    const len = paso.pos_hasta - paso.pos_desde + 1
    const relleno = preguntas?.[paso.pregunta_id]?.relleno || 'derecha'
    const padded = relleno === 'izquierda'
      ? val.padStart(len, '0').slice(-len)
      : val.padEnd(len, '0').slice(0, len)
    for (let i = 0; i < padded.length; i++) arr[paso.pos_desde - 1 + i] = padded[i]
  }
  return arr.join('')
}

export function flujoActivo(flujo, respuestas) {
  return flujo.filter(p => {
    if (!p.si) return true
    const r = respuestas[p.si.pregunta_id] ?? ''
    if (p.si.no_en) return !p.si.no_en.some(v => r === v)
    return p.si.en.some(v => r === v)
  })
}

export function copiarTexto(txt, setCopied) {
  navigator.clipboard.writeText(txt).then(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  })
}

// onUsar(codigo): si se provee, aparece botón "Usar este código" en el resultado final
export function Asistente({ config, onUsar }) {
  const [tipoId,     setTipoId]     = useState('')
  const [respuestas, setRespuestas] = useState({})
  const [libreVal,   setLibreVal]   = useState({})
  const [copiado,    setCopiado]    = useState(false)
  const [faltaId,    setFaltaId]    = useState(null)   // pregunta_id del paso donde se reporta falta
  const [faltaTxt,   setFaltaTxt]   = useState('')
  const [faltaEnv,   setFaltaEnv]   = useState(false)
  const faltaRef = useRef()

  const tipo    = config.tipos.find(t => t.id === tipoId)
  const flujo   = tipo?.flujo || []
  const activos = flujoActivo(flujo, respuestas)

  const corrienteIdx = activos.findIndex(p => respuestas[p.pregunta_id] === undefined)
  const terminado    = tipo != null && corrienteIdx === -1

  const codigo = tipo ? buildCodigo(tipo.codigo_pos1, activos, respuestas, config.preguntas) : '0000000000'

  function elegirTipo(id) { setTipoId(id); setRespuestas({}); setLibreVal({}) }
  function reiniciar()    { setTipoId(''); setRespuestas({}); setLibreVal({}) }

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

  return (
    <div className="row justify-content-center">
      <div className="col-lg-7 col-md-9">

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
                  }}>
                  {c}
                </span>
              )
            })}
          </div>
        )}

        <div className={`card mb-2 ${!tipo ? 'border-primary shadow-sm' : ''}`}>
          <div className="card-body py-2">
            {!tipo ? (
              <>
                <p className="small fw-semibold mb-2 text-muted">¿Qué tipo de material vas a codificar?</p>
                <div className="d-flex flex-column gap-1" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {[...config.tipos].sort((a,b) => a.descripcion.localeCompare(b.descripcion, 'es')).map(t => (
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

        {tipo && activos.map((p, idx) => {
          const preg   = config.preguntas[p.pregunta_id]
          const resp   = respuestas[p.pregunta_id]
          const esCurr = idx === corrienteIdx

          if (!preg) return null
          if (resp === undefined && !esCurr) return null

          if (resp !== undefined) {
            const opDesc = preg.tipo === 'opcion'
              ? (preg.opciones.find(o => o.codigo === resp)?.descripcion || '')
              : ''
            return (
              <div key={p.pregunta_id} className="card mb-1">
                <div className="card-body py-1 px-3 d-flex align-items-center gap-2 flex-wrap">
                  <span className="small text-muted" style={{ minWidth: 120 }}>
                    {preg.label.split('\n')[0].trim().substring(0, 32)}
                    <span className="ms-1 opacity-50" style={{ fontSize: '0.7rem' }}>
                      pos.{p.pos_desde}{p.pos_hasta > p.pos_desde ? '-' + p.pos_hasta : ''}
                    </span>
                  </span>
                  <code className="fw-bold text-primary" style={{ fontSize: '0.85rem' }}>{resp}</code>
                  {opDesc && <span className="small text-truncate" style={{ maxWidth: 220 }}>{opDesc}</span>}
                  <button className="btn btn-sm btn-link ms-auto py-0 text-muted" style={{ fontSize: '0.72rem' }}
                    onClick={() => editarDesde(p.pregunta_id)}>
                    editar
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div key={p.pregunta_id} className="card mb-2 border-primary shadow-sm">
              <div className="card-header py-2 bg-primary text-white d-flex justify-content-between align-items-center">
                <span className="small fw-semibold">
                  {preg.label.split('\n').filter(Boolean).join(' · ')}
                </span>
                <span className="badge bg-light text-dark" style={{ fontSize: '0.68rem', fontFamily: 'monospace' }}>
                  pos.{p.pos_desde}{p.pos_hasta > p.pos_desde ? '-' + p.pos_hasta : ''}
                </span>
              </div>
              <div className="card-body py-2">
                {preg.tipo === 'opcion' && (
                  <>
                    <div className="d-flex flex-column gap-1" style={{ maxHeight: 280, overflowY: 'auto' }}>
                      {[...preg.opciones].sort((a,b) => (a.descripcion||'').localeCompare(b.descripcion||'', 'es')).map(op => (
                        <button key={op.codigo}
                          className="btn btn-sm text-start d-flex align-items-center gap-2 btn-outline-secondary"
                          onClick={() => responder(p.pregunta_id, op.codigo)}>
                          <code style={{ minWidth: 32, fontWeight: 'bold' }}>{op.codigo}</code>
                          <span>{op.descripcion || <em className="opacity-50">—</em>}</span>
                        </button>
                      ))}
                    </div>

                    {/* ── Reportar opción faltante ── */}
                    {faltaId !== p.pregunta_id ? (
                      <button className="btn btn-sm btn-link text-muted mt-2 px-0"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => { setFaltaId(p.pregunta_id); setFaltaTxt(''); setFaltaEnv(false); setTimeout(() => faltaRef.current?.focus(), 50) }}>
                        <i className="bi bi-question-circle me-1"/>No encuentro la opción que necesito
                      </button>
                    ) : faltaEnv ? (
                      <div className="mt-2 small text-success">
                        <i className="bi bi-check-circle me-1"/>Aviso enviado al administrador. Gracias.
                        <button className="btn btn-sm btn-link text-muted py-0 ms-2" onClick={() => setFaltaId(null)}>cerrar</button>
                      </div>
                    ) : (
                      <div className="mt-2 border rounded p-2 bg-light">
                        <p className="small mb-1 fw-semibold">Describí qué opción necesitás:</p>
                        <textarea ref={faltaRef} className="form-control form-control-sm mb-2"
                          rows={2}
                          placeholder="Ej: necesito agregar ROKER como fabricante..."
                          value={faltaTxt}
                          onChange={e => setFaltaTxt(e.target.value)}
                          onKeyDown={e => e.key === 'Escape' && setFaltaId(null)}
                        />
                        <div className="d-flex gap-2">
                          <button className="btn btn-sm btn-warning"
                            disabled={!faltaTxt.trim()}
                            onClick={() => {
                              api.post('/codificacion/pedido', {
                                familia_codigo: tipo.codigo_pos1,
                                familia_desc:   tipo.descripcion,
                                pregunta_id:    p.pregunta_id,
                                pregunta_label: preg.label,
                                descripcion:    faltaTxt.trim(),
                              }).then(() => setFaltaEnv(true)).catch(() => setFaltaEnv(true))
                            }}>
                            <i className="bi bi-send me-1"/>Enviar al administrador
                          </button>
                          <button className="btn btn-sm btn-outline-secondary"
                            onClick={() => setFaltaId(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {preg.tipo === 'libre' && (
                  <div className="d-flex gap-2 align-items-start">
                    <div>
                      <input type="text" className="form-control form-control-lg"
                        style={{ fontFamily: 'monospace', letterSpacing: 4, maxWidth: 200 }}
                        maxLength={preg.longitud}
                        placeholder={'0'.repeat(preg.longitud)}
                        value={libreVal[p.pregunta_id] || ''}
                        autoFocus
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
                        {preg.longitud >= 5 && ' Ej: 12 → 00012 (½"), 114 → 00114 (1¼")'}
                      </div>
                    </div>
                    <button className="btn btn-primary"
                      disabled={!(libreVal[p.pregunta_id] || '').length}
                      onClick={() => responder(p.pregunta_id, libreVal[p.pregunta_id] || '')}>
                      OK
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {terminado && (
          <div className="card mt-1 border-success">
            <div className="card-header py-2 bg-success text-white d-flex justify-content-between align-items-center">
              <span><i className="bi bi-check-circle me-2" />Código generado</span>
              <button className={`btn btn-sm ${copiado ? 'btn-light' : 'btn-outline-light'}`}
                onClick={() => copiarTexto(codigo, setCopiado)}>
                <i className={`bi ${copiado ? 'bi-check-lg' : 'bi-clipboard'} me-1`} />
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="card-body py-3">
              <div className="d-flex justify-content-center gap-1 mb-3">
                {codigo.split('').map((c, i) => {
                  const esLetra = /[A-Za-zÑñ]/.test(c)
                  return (
                    <span key={i} className="border rounded text-center fw-bold"
                      style={{
                        fontFamily: 'monospace', fontSize: '1.5rem', minWidth: 32,
                        background: esLetra ? '#e8eaf6' : '#f8f9fa',
                        color: esLetra ? '#1a237e' : '#333',
                        borderColor: esLetra ? '#7986cb' : undefined
                      }}>
                      {c}
                    </span>
                  )
                })}
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <button className="btn btn-outline-secondary btn-sm" onClick={reiniciar}>
                  <i className="bi bi-arrow-counterclockwise me-1" />Generar otro
                </button>
                {onUsar && (
                  <button className="btn btn-success btn-sm" onClick={() => {
                    const partes = [tipo.descripcion]
                    for (const paso of activos) {
                      const val  = respuestas[paso.pregunta_id]
                      if (val === undefined) continue
                      const preg = config.preguntas[paso.pregunta_id]
                      if (!preg) continue
                      if (preg.tipo === 'opcion') {
                        const op = preg.opciones.find(o => o.codigo === val)
                        if (op?.descripcion) partes.push(op.descripcion)
                      } else if (preg.tipo === 'libre' && val) {
                        partes.push(val)
                      }
                    }
                    onUsar(codigo, partes.join(' '))
                  }}>
                    <i className="bi bi-plus-circle me-1" />Usar este código — continuar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
