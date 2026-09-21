import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { getUser } from '../../store/authStore'

const fmtFecha = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return `${fecha} ${hora}`
}

const ROL_LABELS = { admin:'Admin', gerencia:'Gerencia', compras:'Compras', ventas:'Ventas', deposito:'Depósito', produccion:'Producción', finanzas:'Finanzas', solo_lectura:'Lectura' }

export default function Mensajes({ onCambioNoLeidos }) {
  const me = getUser()
  const [tab,       setTab]       = useState('inbox')   // 'inbox' | 'sent'
  const [msgs,      setMsgs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [selMsg,    setSelMsg]     = useState(null)      // mensaje abierto
  const [composing, setComposing] = useState(false)
  const [usuarios,  setUsuarios]  = useState([])

  // Formulario nuevo mensaje
  const [fParaIds,  setFParaIds]  = useState([])
  const [fAsunto,   setFAsunto]   = useState('')
  const [fCuerpo,   setFCuerpo]   = useState('')
  const [sending,   setSending]   = useState(false)
  const [marcando,  setMarcando]  = useState(false)

  // Selección múltiple en la bandeja de Recibidos, para marcar leído/no leído en bloque.
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [marcandoMasivo, setMarcandoMasivo] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    setMsgs([])
    const url = tab === 'inbox' ? '/mensajes' : '/mensajes/enviados'
    api.get(url)
      .then(r => setMsgs(r.data))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setSeleccionados(new Set()) }, [tab])

  useEffect(() => {
    api.get('/mensajes/usuarios/lista').then(r => setUsuarios(r.data)).catch(e => console.error(e))
  }, [])

  const abrirMensaje = async m => {
    const { data } = await api.get(`/mensajes/${m.id}`)
    setSelMsg(data)
    if (tab === 'inbox' && !m.leido) {
      setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, leido: 1 } : x))
      onCambioNoLeidos?.()
    }
  }

  const eliminar = async id => {
    if (!confirm('¿Eliminar este mensaje?')) return
    await api.delete(`/mensajes/${id}`)
    setSelMsg(null)
    cargar()
    onCambioNoLeidos?.()
  }

  const enviar = async e => {
    e.preventDefault()
    setSending(true)
    try {
      await api.post('/mensajes', { para_ids: fParaIds, asunto: fAsunto, cuerpo: fCuerpo })
      setComposing(false); setFParaIds([]); setFAsunto(''); setFCuerpo('')
      if (tab === 'sent') cargar()
    } catch(err) { alert(err.response?.data?.error || 'Error al enviar') }
    finally { setSending(false) }
  }

  const responder = () => {
    setFParaIds([selMsg.de_id])
    setFAsunto(selMsg.asunto.startsWith('Re:') ? selMsg.asunto : `Re: ${selMsg.asunto}`)
    setFCuerpo('')
    setSelMsg(null)
    setComposing(true)
  }

  const toggleDestinatario = id => setFParaIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // Marcar como leído/no leído a mano (además del marcado automático al abrir).
  const toggleLeido = async () => {
    const nuevoLeido = !selMsg.destinatarios?.find(d => d.usuario_id === me.id)?.leido
    setMarcando(true)
    try {
      await api.patch(`/mensajes/${selMsg.id}/leido`, { leido: nuevoLeido })
      setSelMsg(prev => ({
        ...prev,
        destinatarios: prev.destinatarios.map(d => d.usuario_id === me.id ? { ...d, leido: nuevoLeido } : d),
      }))
      setMsgs(prev => prev.map(x => x.id === selMsg.id ? { ...x, leido: nuevoLeido ? 1 : 0 } : x))
      onCambioNoLeidos?.()
    } catch (err) { alert(err.response?.data?.error || 'Error al actualizar') }
    finally { setMarcando(false) }
  }

  const toggleSeleccion = (id, e) => {
    e.stopPropagation()
    setSeleccionados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSeleccionTodos = () => {
    setSeleccionados(prev => prev.size === msgsFiltrados.length ? new Set() : new Set(msgsFiltrados.map(m => m.id)))
  }

  // Marcar leído/no leído en bloque — reusa el mismo PATCH que el toggle
  // individual, uno por mensaje seleccionado.
  const marcarSeleccionados = async leido => {
    setMarcandoMasivo(true)
    try {
      await Promise.all([...seleccionados].map(id => api.patch(`/mensajes/${id}/leido`, { leido })))
      setMsgs(prev => prev.map(m => seleccionados.has(m.id) ? { ...m, leido: leido ? 1 : 0 } : m))
      setSeleccionados(new Set())
      onCambioNoLeidos?.()
    } catch (err) {
      alert('No se pudieron actualizar todos los mensajes seleccionados')
      cargar()
    } finally { setMarcandoMasivo(false) }
  }

  const noLeidos = msgs.filter(m => !m.leido).length

  // Filtro de búsqueda — por asunto, cuerpo y remitente/destinatario. El
  // contador de no leídos de arriba usa siempre el total, no lo filtrado.
  const msgsFiltrados = msgs.filter(m => {
    const q = buscar.trim().toLowerCase()
    if (!q) return true
    const nombres = tab === 'inbox' ? (m.de_nombre || '') : (m.destinatarios || []).map(d => d.usuario_nombre).join(' ')
    return (m.asunto || '').toLowerCase().includes(q)
      || (m.cuerpo || '').toLowerCase().includes(q)
      || nombres.toLowerCase().includes(q)
  })

  return (
    <div className="container-fluid py-3" style={{ maxWidth: 900 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0"><i className="bi bi-envelope me-2"/>Mensajes</h5>
        <button className="btn btn-primary btn-sm" onClick={() => { setComposing(true); setFParaIds([]); setFAsunto(''); setFCuerpo('') }}>
          <i className="bi bi-pencil-square me-1"/>Nuevo mensaje
        </button>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link py-1 ${tab==='inbox'?'active':''}`} onClick={() => setTab('inbox')}>
            <i className="bi bi-inbox me-1"/>Recibidos
            {noLeidos > 0 && tab === 'inbox' && (
              <span className="badge bg-danger ms-1" style={{fontSize:'0.65rem'}}>{noLeidos}</span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 ${tab==='sent'?'active':''}`} onClick={() => setTab('sent')}>
            <i className="bi bi-send me-1"/>Enviados
          </button>
        </li>
      </ul>

      {/* Buscador */}
      {msgs.length > 0 && (
        <div className="mb-2 position-relative" style={{ maxWidth: 340 }}>
          <i className="bi bi-search position-absolute text-muted" style={{ left: 10, top: 8, fontSize: '0.85rem' }} />
          <input className="form-control form-control-sm ps-4" placeholder="Buscar por asunto, contenido o persona..."
            value={buscar} onChange={e => setBuscar(e.target.value)} />
          {buscar && (
            <button className="btn btn-sm position-absolute" style={{ right: 2, top: 1, padding: '2px 6px' }}
              onClick={() => setBuscar('')} title="Limpiar búsqueda">
              <i className="bi bi-x" />
            </button>
          )}
        </div>
      )}

      {/* Barra de selección múltiple (solo Recibidos) */}
      {tab === 'inbox' && !loading && msgsFiltrados.length > 0 && (
        <div className="d-flex align-items-center gap-2 mb-2">
          <div className="form-check mb-0">
            <input type="checkbox" className="form-check-input" id="chk-todos"
              checked={seleccionados.size > 0 && seleccionados.size === msgsFiltrados.length}
              ref={el => { if (el) el.indeterminate = seleccionados.size > 0 && seleccionados.size < msgsFiltrados.length }}
              onChange={toggleSeleccionTodos} />
            <label className="form-check-label small text-muted" htmlFor="chk-todos">
              {seleccionados.size > 0 ? `${seleccionados.size} seleccionado${seleccionados.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
            </label>
          </div>
          {seleccionados.size > 0 && (
            <div className="d-flex gap-1 ms-2">
              <button className="btn btn-sm btn-outline-primary py-0" style={{fontSize:'0.78rem'}}
                disabled={marcandoMasivo} onClick={() => marcarSeleccionados(true)}>
                <i className="bi bi-envelope-open me-1"/>Marcar leídos
              </button>
              <button className="btn btn-sm btn-outline-secondary py-0" style={{fontSize:'0.78rem'}}
                disabled={marcandoMasivo} onClick={() => marcarSeleccionados(false)}>
                <i className="bi bi-envelope me-1"/>Marcar no leídos
              </button>
              {marcandoMasivo && <span className="spinner-border spinner-border-sm text-secondary"/>}
            </div>
          )}
        </div>
      )}

      {/* Lista */}
      {loading
        ? <div className="text-center py-5"><span className="spinner-border text-secondary"/></div>
        : msgs.length === 0
          ? <div className="text-center text-muted py-5">
              <i className="bi bi-envelope-open" style={{fontSize:'2.5rem', opacity:0.3}}/>
              <div className="mt-2">No hay mensajes</div>
            </div>
          : msgsFiltrados.length === 0
            ? <div className="text-center text-muted py-5">
                <i className="bi bi-search" style={{fontSize:'2.5rem', opacity:0.3}}/>
                <div className="mt-2">Ningún mensaje coincide con "{buscar}"</div>
              </div>
            : <div className="card border-0 shadow-sm">
              {msgsFiltrados.map((m, i) => {
                const noLeido = tab === 'inbox' && !m.leido
                const nombresPara = tab === 'sent' ? (m.destinatarios || []).map(d => d.usuario_nombre).join(', ') : ''
                const leidosPara = tab === 'sent' ? (m.destinatarios || []).filter(d => d.leido).length : 0
                return (
                  <div key={m.id}
                    className={`d-flex align-items-center gap-3 px-3 py-2 ${i > 0 ? 'border-top' : ''}`}
                    style={{ cursor:'pointer', background: noLeido ? '#f0f7ff' : '#fff' }}
                    onClick={() => abrirMensaje(m)}>
                    {tab === 'inbox' && (
                      <input type="checkbox" className="form-check-input flex-shrink-0" style={{ marginTop: 0 }}
                        checked={seleccionados.has(m.id)}
                        onClick={e => toggleSeleccion(m.id, e)}
                        onChange={() => {}} />
                    )}
                    <div className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{width:36, height:36, fontSize:'0.85rem', fontWeight:700}}>
                      {((tab==='inbox' ? m.de_nombre : nombresPara) || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <div className="d-flex justify-content-between align-items-center">
                        <span className={`text-truncate ${noLeido ? 'fw-bold' : 'fw-semibold'}`} style={{fontSize:'0.87rem', maxWidth: 400}}>
                          {tab==='inbox' ? m.de_nombre : nombresPara}
                        </span>
                        <div className="d-flex align-items-center gap-2" style={{flexShrink:0}}>
                          {tab === 'sent' && (
                            leidosPara > 0
                              ? <span title={`Leído por ${leidosPara} de ${m.destinatarios.length}`}
                                  style={{color:'#0d6efd', fontSize:'0.78rem', fontWeight:600}}>
                                  ✓✓ Leído por {leidosPara}/{m.destinatarios.length}
                                </span>
                              : <span title="Aún no fue leído"
                                  style={{color:'#adb5bd', fontSize:'0.78rem'}}>
                                  ✓ Enviado
                                </span>
                          )}
                          <span className="text-muted" style={{fontSize:'0.75rem'}}>{fmtFecha(m.created_at)}</span>
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        {noLeido && <span className="badge bg-primary" style={{fontSize:'0.6rem'}}>Nuevo</span>}
                        <span className={`text-truncate ${noLeido ? 'fw-semibold' : 'text-muted'}`} style={{fontSize:'0.82rem'}}>
                          {m.asunto}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
      }

      {/* ══ MODAL: LEER MENSAJE ══════════════════════════════════════════ */}
      {selMsg && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h6 className="modal-title mb-0">{selMsg.asunto}</h6>
                  <small className="text-muted">
                    {tab==='inbox'
                      ? `De: ${selMsg.de_nombre}`
                      : `Para: ${(selMsg.destinatarios || []).map(d => d.usuario_nombre).join(', ')}`
                    } · {fmtFecha(selMsg.created_at)}
                  </small>
                  {tab === 'sent' && (
                    <div className="mt-1 d-flex flex-wrap gap-2">
                      {(selMsg.destinatarios || []).map(d => (
                        <span key={d.usuario_id} className="badge bg-light text-dark border" style={{ fontSize: '0.72rem', fontWeight: 500 }}>
                          {d.usuario_nombre}: {d.leido
                            ? <span style={{ color: '#0d6efd' }}>✓✓ Leído el {fmtFecha(d.leido_at)}</span>
                            : <span className="text-secondary">✓ No leído aún</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn-close" onClick={() => setSelMsg(null)}/>
              </div>
              <div className="modal-body">
                <div style={{ whiteSpace:'pre-wrap', lineHeight:1.7, minHeight:80 }}>{selMsg.cuerpo}</div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-outline-danger btn-sm me-auto"
                  onClick={() => { if (confirm('¿Eliminar este mensaje?')) eliminar(selMsg.id) }}>
                  <i className="bi bi-trash me-1"/>Eliminar
                </button>
                {tab === 'inbox' && (
                  <button className="btn btn-outline-secondary btn-sm" disabled={marcando} onClick={toggleLeido}>
                    {marcando && <span className="spinner-border spinner-border-sm me-1"/>}
                    {selMsg.destinatarios?.find(d => d.usuario_id === me.id)?.leido
                      ? <><i className="bi bi-envelope me-1"/>Marcar como no leído</>
                      : <><i className="bi bi-envelope-open me-1"/>Marcar como leído</>}
                  </button>
                )}
                {tab === 'inbox' && (
                  <button className="btn btn-primary btn-sm" onClick={responder}>
                    <i className="bi bi-reply me-1"/>Responder
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => setSelMsg(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: NUEVO MENSAJE ════════════════════════════════════════ */}
      {composing && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1070}}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={enviar}>
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0"><i className="bi bi-pencil-square me-1"/>Nuevo mensaje</h6>
                <button type="button" className="btn-close" onClick={() => setComposing(false)}/>
              </div>
              <div className="modal-body">
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1">
                    Para {fParaIds.length > 0 && <span className="text-muted fw-normal">({fParaIds.length} elegido{fParaIds.length !== 1 ? 's' : ''})</span>}
                  </label>
                  <div className="border rounded" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {usuarios.map(u => (
                      <label key={u.id} className="d-flex align-items-center gap-2 px-2 py-1 mb-0"
                        style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input type="checkbox" className="form-check-input mt-0"
                          checked={fParaIds.includes(u.id)}
                          onChange={() => toggleDestinatario(u.id)} />
                        {u.nombre} <span className="text-muted">({ROL_LABELS[u.rol] || u.rol})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1">Asunto</label>
                  <input className="form-control form-control-sm" placeholder="Asunto (opcional)"
                    value={fAsunto} onChange={e => setFAsunto(e.target.value)} maxLength={120}/>
                </div>
                <div className="mb-1">
                  <label className="form-label small fw-semibold mb-1">Mensaje</label>
                  <textarea className="form-control form-control-sm" rows={5} required
                    placeholder="Escribí tu mensaje..."
                    value={fCuerpo} onChange={e => setFCuerpo(e.target.value)}/>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setComposing(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={sending || fParaIds.length === 0 || !fCuerpo.trim()}>
                  {sending && <span className="spinner-border spinner-border-sm me-1"/>}
                  <i className="bi bi-send me-1"/>Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
