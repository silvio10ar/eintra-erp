import { useState, useEffect } from 'react'
import api from '../../api/client'

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
  const [form, setForm]         = useState(VACIO)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(false)
  const [backing, setBacking]   = useState(false)
  const [msg, setMsg]           = useState(null)   // { tipo: 'ok'|'err', texto }
  const [showPass, setShowPass] = useState(false)

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
      <h5 className="fw-bold mb-4">Configuración del sistema</h5>

      <form onSubmit={guardar}>
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
      </form>
    </div>
  )
}
