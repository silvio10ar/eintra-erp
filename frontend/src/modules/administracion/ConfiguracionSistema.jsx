import { useState, useEffect } from 'react'
import api from '../../api/client'

// ── Directivas ────────────────────────────────────────────────────────────────

const DIRECTIVA_VACIA = { titulo: '', descripcion: '' }

function TabDirectivas() {
  const [lista, setLista]     = useState([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(null)   // null | 'new' | { id, titulo, descripcion }
  const [form, setForm]       = useState(DIRECTIVA_VACIA)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    api.get('/configuracion/directivas').then(r => setLista(r.data)).finally(() => setLoading(false))
  }, [])

  const abrirNueva = () => { setForm(DIRECTIVA_VACIA); setEditando('new') }
  const abrirEditar = d => { setForm({ titulo: d.titulo, descripcion: d.descripcion }); setEditando(d) }
  const cancelar = () => setEditando(null)

  const guardar = async () => {
    if (!form.titulo.trim()) return
    setSaving(true)
    try {
      if (editando === 'new') {
        const r = await api.post('/configuracion/directivas', form)
        setLista(p => [...p, r.data])
      } else {
        const r = await api.put(`/configuracion/directivas/${editando.id}`, { ...form, activa: editando.activa })
        setLista(p => p.map(x => x.id === editando.id ? r.data : x))
      }
      setEditando(null)
    } finally { setSaving(false) }
  }

  const toggle = async d => {
    const r = await api.patch(`/configuracion/directivas/${d.id}/toggle`)
    setLista(p => p.map(x => x.id === d.id ? r.data : x))
  }

  const eliminar = async d => {
    if (!confirm(`¿Eliminar directiva "${d.titulo}"?`)) return
    await api.delete(`/configuracion/directivas/${d.id}`)
    setLista(p => p.filter(x => x.id !== d.id))
  }

  if (loading) return <div className="d-flex justify-content-center py-4"><span className="spinner-border text-primary" /></div>

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted small mb-0">
          Reglas y lineamientos operativos del sistema. Sirven como referencia para el equipo y para configurar el comportamiento esperado.
        </p>
        <button className="btn btn-sm btn-primary ms-3 flex-shrink-0" onClick={abrirNueva}>
          <i className="bi bi-plus-lg me-1" />Nueva directiva
        </button>
      </div>

      {editando && (
        <div className="card border-primary mb-3">
          <div className="card-body">
            <div className="mb-2">
              <label className="form-label small fw-semibold">Título *</label>
              <input className="form-control form-control-sm" value={form.titulo}
                onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))}
                placeholder="Ej: Formato de fecha" autoFocus />
            </div>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Descripción</label>
              <textarea className="form-control form-control-sm" rows={3} value={form.descripcion}
                onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Descripción detallada de la directiva..." />
            </div>
            <div className="d-flex gap-2 justify-content-end">
              <button className="btn btn-sm btn-outline-secondary" onClick={cancelar}>Cancelar</button>
              <button className="btn btn-sm btn-primary" onClick={guardar} disabled={saving || !form.titulo.trim()}>
                {saving ? <span className="spinner-border spinner-border-sm" /> : <><i className="bi bi-floppy me-1" />Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {lista.length === 0 && !editando && (
        <p className="text-muted small text-center py-3">No hay directivas cargadas.</p>
      )}

      <div className="d-flex flex-column gap-2">
        {lista.map(d => (
          <div key={d.id} className={`card border-0 shadow-sm ${!d.activa ? 'opacity-50' : ''}`}>
            <div className="card-body py-2 px-3">
              <div className="d-flex align-items-start gap-2">
                <i className={`bi bi-${d.activa ? 'check-circle-fill text-success' : 'circle text-secondary'} mt-1 flex-shrink-0`} style={{ fontSize: '0.9rem' }} />
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <p className="fw-semibold mb-0 small">{d.titulo}</p>
                  {d.descripcion && <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>{d.descripcion}</p>}
                </div>
                <div className="d-flex gap-1 flex-shrink-0">
                  <button className="btn btn-sm btn-outline-secondary py-0 px-2" title={d.activa ? 'Desactivar' : 'Activar'} onClick={() => toggle(d)}>
                    <i className={`bi bi-toggle-${d.activa ? 'on text-success' : 'off'}`} style={{ fontSize: '0.9rem' }} />
                  </button>
                  <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => abrirEditar(d)}>
                    <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                  </button>
                  <button className="btn btn-sm btn-outline-danger py-0 px-2" onClick={() => eliminar(d)}>
                    <i className="bi bi-trash" style={{ fontSize: '0.75rem' }} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CAMPOS_SMTP = [
  { k: 'smtp_host',   l: 'Servidor SMTP',        tipo: 'text',     ph: 'smtp.gmail.com', col: 'col-md-6' },
  { k: 'smtp_port',   l: 'Puerto',                tipo: 'number',   ph: '587',            col: 'col-md-2' },
  { k: 'smtp_secure', l: 'Seguro (SSL/TLS)',       tipo: 'check',                          col: 'col-md-2' },
  { k: 'smtp_user',   l: 'Usuario / Email',        tipo: 'text',     ph: 'usuario@dominio.com', col: 'col-md-6' },
  { k: 'smtp_pass',   l: 'Contraseña',             tipo: 'password', ph: '',               col: 'col-md-4' },
  { k: 'smtp_from',   l: 'Dirección "De"',         tipo: 'text',     ph: '"E-INTRA ERP" <noreply@dominio.com>', col: 'col-md-8' },
  { k: 'backup_to',   l: 'Destinatario del backup',tipo: 'email',    ph: 'admin@empresa.com', col: 'col-md-6' },
]

const VACIO = { smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'', smtp_from:'', smtp_secure:'false', backup_to:'' }

export default function ConfiguracionSistema() {
  const [tab, setTab]           = useState('sistema')
  const [form, setForm]         = useState(VACIO)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(false)
  const [backing, setBacking]   = useState(false)
  const [msg, setMsg]           = useState(null)   // { tipo: 'ok'|'err', texto }
  const [showPass, setShowPass] = useState(false)
  const [descargando, setDescargando] = useState(null)  // 'backup' | 'instalador' | null

  useEffect(() => {
    api.get('/configuracion')
      .then(r => setForm({ ...VACIO, ...r.data }))
      .finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const guardar = async e => {
    e.preventDefault(); setSaving(true); setMsg(null)
    try {
      await api.put('/configuracion', form)
      setMsg({ tipo: 'ok', texto: 'Configuración guardada correctamente.' })
    } catch(err) {
      setMsg({ tipo: 'err', texto: err.response?.data?.error ?? 'Error al guardar' })
    } finally { setSaving(false) }
  }

  const enviarBackup = async () => {
    setBacking(true); setMsg(null)
    try {
      const r = await api.post('/configuracion/backup-ahora')
      setMsg({ tipo: 'ok', texto: r.data.mensaje })
    } catch(err) {
      setMsg({ tipo: 'err', texto: err.response?.data?.error ?? 'Error al enviar backup' })
    } finally { setBacking(false) }
  }

  const descargar = async (endpoint, tipo) => {
    setDescargando(tipo); setMsg(null)
    try {
      const r = await api.get(endpoint, { responseType: 'blob' })
      const cd = r.headers['content-disposition'] || ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : (tipo === 'backup' ? 'backup.db' : 'instalador.tar.gz')
      const url = URL.createObjectURL(new Blob([r.data]))
      const a   = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ tipo: 'err', texto: 'Error al descargar: ' + (e.response?.data?.error || e.message) })
    } finally { setDescargando(null) }
  }

  const testEmail = async () => {
    setTesting(true); setMsg(null)
    try {
      const r = await api.post('/configuracion/test-email', {
        smtp_host:   form.smtp_host,
        smtp_port:   form.smtp_port,
        smtp_user:   form.smtp_user,
        smtp_pass:   form.smtp_pass !== '***' ? form.smtp_pass : undefined,
        smtp_from:   form.smtp_from,
        smtp_secure: form.smtp_secure,
        to:          form.backup_to || undefined,
      })
      setMsg({ tipo: 'ok', texto: r.data.mensaje })
    } catch(err) {
      setMsg({ tipo: 'err', texto: err.response?.data?.error ?? 'Error al enviar' })
    } finally { setTesting(false) }
  }

  if (loading) return (
    <div className="d-flex justify-content-center py-5">
      <span className="spinner-border text-primary"/>
    </div>
  )

  return (
    <div style={{ maxWidth: 760 }}>
      <h5 className="fw-bold mb-3">Configuración del sistema</h5>

      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'sistema' ? 'active' : ''}`} onClick={() => setTab('sistema')}>
            <i className="bi bi-gear me-1" />Sistema
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'directivas' ? 'active' : ''}`} onClick={() => setTab('directivas')}>
            <i className="bi bi-journal-check me-1" />Directivas del programa
          </button>
        </li>
      </ul>

      {tab === 'directivas' && <TabDirectivas />}

      {tab === 'sistema' && <form onSubmit={guardar}>
        {/* ── Correo saliente ──────────────────────────────────── */}
        <div className="card mb-3">
          <div className="card-header py-2 d-flex align-items-center gap-2">
            <i className="bi bi-envelope-at text-primary"/>
            <strong className="small">Correo saliente (SMTP)</strong>
          </div>
          <div className="card-body pb-2">
            <div className="row g-3">
              {CAMPOS_SMTP.map(c => (
                <div key={c.k} className={c.col}>
                  <label className="form-label small fw-medium mb-1">{c.l}</label>
                  {c.tipo === 'check' ? (
                    <div className="form-check mt-1">
                      <input className="form-check-input" type="checkbox"
                        id="smtp_secure"
                        checked={form.smtp_secure === 'true'}
                        onChange={e => set('smtp_secure', e.target.checked ? 'true' : 'false')}/>
                      <label className="form-check-label small" htmlFor="smtp_secure">
                        Activar SSL/TLS
                      </label>
                    </div>
                  ) : c.tipo === 'password' ? (
                    <div className="input-group">
                      <input
                        className="form-control form-control-sm"
                        type={showPass ? 'text' : 'password'}
                        value={form.smtp_pass}
                        placeholder={form.smtp_pass === '***' ? '(sin cambios)' : c.ph}
                        onChange={e => set('smtp_pass', e.target.value)}
                        onFocus={() => { if (form.smtp_pass === '***') set('smtp_pass', '') }}
                      />
                      <button type="button" className="btn btn-outline-secondary btn-sm"
                        onClick={() => setShowPass(p => !p)}>
                        <i className={`bi bi-eye${showPass ? '-slash' : ''}`}/>
                      </button>
                    </div>
                  ) : (
                    <input
                      className="form-control form-control-sm"
                      type={c.tipo}
                      value={form[c.k]}
                      placeholder={c.ph}
                      onChange={e => set(c.k, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2 border-top d-flex align-items-center gap-2 flex-wrap">
              <small className="text-muted flex-grow-1">
                <i className="bi bi-info-circle me-1"/>
                El backup diario se envía a las 00:00 al destinatario configurado.
              </small>
              <button type="button" className="btn btn-sm btn-outline-success"
                onClick={enviarBackup} disabled={backing}>
                {backing
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Enviando...</>
                  : <><i className="bi bi-database-down me-1"/>Enviar backup ahora</>}
              </button>
              <button type="button" className="btn btn-sm btn-outline-primary"
                onClick={testEmail} disabled={testing}>
                {testing
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Enviando...</>
                  : <><i className="bi bi-send me-1"/>Enviar email de prueba</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Backup y seguridad ─────────────────────────────── */}
        <div className="card mb-3">
          <div className="card-header py-2 d-flex align-items-center gap-2">
            <i className="bi bi-shield-lock text-success"/>
            <strong className="small">Backup y seguridad del sistema</strong>
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-6">
                <div className="border rounded p-3 h-100">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i className="bi bi-database-down text-primary fs-5"/>
                    <strong className="small">Backup de base de datos</strong>
                  </div>
                  <p className="text-muted small mb-3">
                    Descarga una copia de seguridad completa de la base de datos en formato <code>.db</code>.
                    El archivo se genera en caliente sin detener el sistema.
                  </p>
                  <button type="button"
                    className="btn btn-sm btn-outline-primary w-100"
                    disabled={descargando === 'backup'}
                    onClick={() => descargar('/configuracion/backup-db', 'backup')}>
                    {descargando === 'backup'
                      ? <><span className="spinner-border spinner-border-sm me-1"/>Generando...</>
                      : <><i className="bi bi-download me-1"/>Descargar backup (.db)</>}
                  </button>
                </div>
              </div>
              <div className="col-md-6">
                <div className="border rounded p-3 h-100">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i className="bi bi-box-arrow-up text-warning fs-5"/>
                    <strong className="small">Instalador del sistema</strong>
                  </div>
                  <p className="text-muted small mb-3">
                    Genera un paquete <code>.tar.gz</code> con el código fuente completo y un script
                    <code> install.sh</code> para instalar el sistema en un servidor nuevo.
                  </p>
                  <button type="button"
                    className="btn btn-sm btn-outline-warning w-100"
                    disabled={descargando === 'instalador'}
                    onClick={() => descargar('/configuracion/instalador', 'instalador')}>
                    {descargando === 'instalador'
                      ? <><span className="spinner-border spinner-border-sm me-1"/>Generando...</>
                      : <><i className="bi bi-download me-1"/>Descargar instalador (.tar.gz)</>}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-muted small mt-2 mb-0">
              <i className="bi bi-info-circle me-1"/>
              El navegador pedirá dónde guardar el archivo según su configuración de descargas.
              Para que siempre pregunte la ubicación, activar "Preguntar dónde guardar" en la configuración del navegador.
            </p>
          </div>
        </div>

        {msg && (
          <div className={`alert alert-${msg.tipo === 'ok' ? 'success' : 'danger'} py-2 small`}>
            <i className={`bi bi-${msg.tipo === 'ok' ? 'check-circle' : 'exclamation-triangle'} me-2`}/>
            {msg.texto}
          </div>
        )}

        <div className="d-flex justify-content-end">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</>
              : <><i className="bi bi-floppy me-1"/>Guardar configuración</>}
          </button>
        </div>
      </form>}
    </div>
  )
}
