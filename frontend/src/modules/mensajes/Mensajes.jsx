import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { getUser } from '../../store/authStore'

const fmtFecha = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  const hoy = new Date()
  const esHoy = d.toDateString() === hoy.toDateString()
  if (esHoy) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const ROL_LABELS = { admin:'Admin', gerencia:'Gerencia', compras:'Compras', ventas:'Ventas', deposito:'Depósito', produccion:'Producción', finanzas:'Finanzas', solo_lectura:'Lectura' }

export default function Mensajes({ onCambioNoLeidos }) {
  const me = getUser()
  const [tab,       setTab]       = useState('inbox')   // 'inbox' | 'sent'
  const [msgs,      setMsgs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selMsg,    setSelMsg]     = useState(null)      // mensaje abierto
  const [composing, setComposing] = useState(false)
  const [usuarios,  setUsuarios]  = useState([])

  // Formulario nuevo mensaje
  const [fPara,     setFPara]     = useState('')
  const [fAsunto,   setFAsunto]   = useState('')
  const [fCuerpo,   setFCuerpo]   = useState('')
  const [sending,   setSending]   = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    setMsgs([])
    const url = tab === 'inbox' ? '/mensajes' : '/mensajes/enviados'
    api.get(url)
      .then(r => setMsgs(r.data))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    api.get('/mensajes/usuarios/lista').then(r => setUsuarios(r.data)).catch(() => {})
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
    await api.delete(`/mensajes/${id}`)
    setSelMsg(null)
    cargar()
    onCambioNoLeidos?.()
  }

  const enviar = async e => {
    e.preventDefault()
    setSending(true)
    try {
      await api.post('/mensajes', { para_id: fPara, asunto: fAsunto, cuerpo: fCuerpo })
      setComposing(false); setFPara(''); setFAsunto(''); setFCuerpo('')
      if (tab === 'sent') cargar()
    } catch(err) { alert(err.response?.data?.error || 'Error al enviar') }
    finally { setSending(false) }
  }

  const responder = () => {
    setFPara(String(selMsg.de_id))
    setFAsunto(selMsg.asunto.startsWith('Re:') ? selMsg.asunto : `Re: ${selMsg.asunto}`)
    setFCuerpo('')
    setSelMsg(null)
    setComposing(true)
  }

  const noLeidos = msgs.filter(m => !m.leido).length

  return (
    <div className="container-fluid py-3" style={{ maxWidth: 900 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0"><i className="bi bi-envelope me-2"/>Mensajes</h5>
        <button className="btn btn-primary btn-sm" onClick={() => { setComposing(true); setFPara(''); setFAsunto(''); setFCuerpo('') }}>
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

      {/* Lista */}
      {loading
        ? <div className="text-center py-5"><span className="spinner-border text-secondary"/></div>
        : msgs.length === 0
          ? <div className="text-center text-muted py-5">
              <i className="bi bi-envelope-open" style={{fontSize:'2.5rem', opacity:0.3}}/>
              <div className="mt-2">No hay mensajes</div>
            </div>
          : <div className="card border-0 shadow-sm">
              {msgs.map((m, i) => {
                const noLeido = tab === 'inbox' && !m.leido
                return (
                  <div key={m.id}
                    className={`d-flex align-items-center gap-3 px-3 py-2 ${i > 0 ? 'border-top' : ''}`}
                    style={{ cursor:'pointer', background: noLeido ? '#f0f7ff' : '#fff' }}
                    onClick={() => abrirMensaje(m)}>
                    <div className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{width:36, height:36, fontSize:'0.85rem', fontWeight:700}}>
                      {((tab==='inbox' ? m.de_nombre : m.para_nombre) || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <div className="d-flex justify-content-between align-items-center">
                        <span className={`${noLeido ? 'fw-bold' : 'fw-semibold'}`} style={{fontSize:'0.87rem'}}>
                          {tab==='inbox' ? m.de_nombre : m.para_nombre}
                        </span>
                        <div className="d-flex align-items-center gap-2" style={{flexShrink:0}}>
                          {tab === 'sent' && (
                            m.leido
                              ? <span title={`Leído el ${fmtFecha(m.leido_at)}`}
                                  style={{color:'#0d6efd', fontSize:'0.78rem', fontWeight:600}}>
                                  ✓✓ Leído
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
                      : `Para: ${selMsg.para_nombre}`
                    } · {fmtFecha(selMsg.created_at)}
                    {tab === 'sent' && (
                      selMsg.leido
                        ? <span className="ms-2" style={{color:'#0d6efd', fontWeight:600}}>
                            ✓✓ Leído el {fmtFecha(selMsg.leido_at)}
                          </span>
                        : <span className="ms-2 text-secondary">✓ No leído aún</span>
                    )}
                  </small>
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
                  <label className="form-label small fw-semibold mb-1">Para</label>
                  <select className="form-select form-select-sm" required value={fPara} onChange={e => setFPara(e.target.value)}>
                    <option value="">— seleccioná un destinatario —</option>
                    {usuarios.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre} ({ROL_LABELS[u.rol] || u.rol})</option>
                    ))}
                  </select>
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
                <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !fPara || !fCuerpo.trim()}>
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
