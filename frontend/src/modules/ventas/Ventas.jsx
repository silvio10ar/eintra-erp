import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import DateInput from '../../components/DateInput'

const fmtN = n => n != null ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n) : '—'
const fmtF = s => s ? s.slice(0,10).split('-').reverse().join('/') : '—'
const hoy  = () => new Date().toISOString().slice(0,10)

function calcFinal(p, b1, b2, b3, b4) {
  let v = parseFloat(p) || 0
  for (const b of [b1, b2, b3, b4]) {
    const pct = parseFloat(b) || 0
    if (pct > 0) v *= (1 - pct / 100)
  }
  return Math.round(v * 10000) / 10000
}

const ESTADO_BADGE = {
  Borrador: 'secondary', Enviado: 'info',
  Aprobado: 'success',  Rechazado: 'danger', Facturado: 'primary',
}

const ITEM0  = { cantidad: 1, unidad: 'UND.', descripcion: '', precio_unitario: 0, bonif1: 0, bonif2: 0, bonif3: 0, bonif4: 0, precio_final: 0, plazo: 'A CONVENIR' }
const FORM0  = () => ({
  cliente_id: '', cli_nombre: '', cli_cuit: '', cli_contacto: '', cli_telefono: '',
  cli_email: '', cli_direccion: '', cli_localidad: '',
  fecha: hoy(), validez: '30 días', estado: 'Borrador', moneda: 'DÓLAR', tasa_cambio: '',
  condicion_pago: 'TRANSFERENCIA BANCARIA', lugar_entrega: 'E-INTRA',
  elaborado_por: '', observaciones: '',
  items: [{ ...ITEM0 }],
})
const CLI0 = { nombre: '', cuit: '', contacto: '', telefono: '', email: '', direccion: '', localidad: '', cp: '', condicion_pago: '' }

function TablaPptos({ rows, canWrite, onEditar, onEliminar, onImprimir, onOfertaTecnica }) {
  return (
    <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
      <table className="table table-hover table-sm mb-0" style={{ fontSize: '0.82rem' }}>
        <thead className="table-dark sticky-top">
          <tr>
            <th style={{ width: 90 }}>N°</th>
            <th style={{ width: 90 }}>Fecha</th>
            <th>Cliente</th>
            <th className="text-center" style={{ width: 60 }}>Ítems</th>
            <th style={{ width: 80 }}>Moneda</th>
            <th className="text-end" style={{ width: 120 }}>Total</th>
            <th style={{ width: 100 }}>Estado</th>
            <th style={{ width: 90 }}>Validez</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={9} className="text-center text-muted py-4">Sin resultados</td></tr>
          )}
          {rows.map(p => (
            <tr key={p.id}>
              <td className="font-monospace fw-semibold text-primary">{p.numero}</td>
              <td className="text-nowrap">{fmtF(p.fecha)}</td>
              <td className="fw-semibold">{p.cli_nombre}</td>
              <td className="text-center">{p.n_items || 0}</td>
              <td className="text-muted">{p.moneda}</td>
              <td className="text-end text-nowrap">{fmtN(p.total_usd)}</td>
              <td>
                <span className={`badge bg-${ESTADO_BADGE[p.estado] ?? 'secondary'}`} style={{ fontSize: '0.72rem' }}>
                  {p.estado}
                </span>
              </td>
              <td className="text-muted" style={{ fontSize: '0.78rem' }}>{p.validez}</td>
              <td className="text-nowrap">
                <button className="btn btn-outline-info btn-sm py-0 px-1 me-1" title="Imprimir Oferta Comercial"
                  onClick={() => onImprimir(p.id)}>
                  <i className="bi bi-printer" style={{ fontSize: '0.75rem' }} />
                </button>
                <button className="btn btn-outline-primary btn-sm py-0 px-1 me-1" title="Oferta Técnica"
                  onClick={() => onOfertaTecnica(p.id)}>
                  <i className="bi bi-file-earmark-text" style={{ fontSize: '0.75rem' }} />
                </button>
                {canWrite && (
                  <>
                    <button className="btn btn-outline-secondary btn-sm py-0 px-1 me-1" title="Editar"
                      onClick={() => onEditar(p.id)}>
                      <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                    </button>
                    <button className="btn btn-outline-danger btn-sm py-0 px-1" title="Eliminar"
                      onClick={() => onEliminar(p.id)}>
                      <i className="bi bi-trash" style={{ fontSize: '0.75rem' }} />
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Ventas() {
  const navigate  = useNavigate()
  const canWrite  = puedeEscribir('ventas')

  const [tab,        setTab]        = useState('resumen')
  const [stats,      setStats]      = useState(null)
  const [pptos,      setPptos]      = useState([])
  const [totalPptos, setTotalPptos] = useState(0)
  const [loadPptos,  setLoadPptos]  = useState(false)
  const [filtros,    setFiltros]    = useState({ estado: '', buscar: '' })
  const [page,       setPage]       = useState(1)
  const LIMIT = 50

  const [clientes,   setClientes]   = useState([])
  const [buscarCli,  setBuscarCli]  = useState('')

  const [vista,      setVista]      = useState('lista')
  const [editId,     setEditId]     = useState(null)
  const [editNumero, setEditNumero] = useState('')
  const [form,       setForm]       = useState(FORM0)
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState('')

  const [modalCli,   setModalCli]   = useState(null)
  const [formCli,    setFormCli]    = useState(CLI0)
  const [savingCli,  setSavingCli]  = useState(false)

  const [cliQ,       setCliQ]       = useState('')
  const [cliSugs,    setCliSugs]    = useState([])
  const cliRef = useRef(null)

  // ── Loaders ─────────────────────────────────────────────────────────────
  const cargarStats = useCallback(() => {
    api.get('/ventas/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  const cargarPptos = useCallback(() => {
    setLoadPptos(true)
    api.get('/ventas/presupuestos', { params: { ...filtros, page, limit: LIMIT } })
      .then(r => { setPptos(r.data.datos); setTotalPptos(r.data.total) })
      .finally(() => setLoadPptos(false))
  }, [filtros, page])

  const cargarClientes = useCallback(() => {
    api.get('/ventas/clientes', { params: { buscar: buscarCli } })
      .then(r => setClientes(r.data))
  }, [buscarCli])

  useEffect(() => { cargarStats() }, [cargarStats])
  useEffect(() => {
    if (tab === 'resumen' || tab === 'presupuestos') cargarPptos()
  }, [cargarPptos, tab])
  useEffect(() => {
    if (tab === 'clientes') cargarClientes()
  }, [cargarClientes, tab])

  // ── Autocomplete cliente ──────────────────────────────────────────────────
  const onCliQ = v => {
    setCliQ(v)
    setForm(f => ({ ...f, cliente_id: '', cli_nombre: v }))
    if (v.length < 1) { setCliSugs([]); return }
    api.get('/ventas/clientes', { params: { buscar: v } }).then(r => setCliSugs(r.data))
  }

  const selCliente = cli => {
    setCliQ(cli.nombre)
    setCliSugs([])
    setForm(f => ({
      ...f,
      cliente_id: cli.id, cli_nombre: cli.nombre, cli_cuit: cli.cuit || '',
      cli_contacto: cli.contacto || '', cli_telefono: cli.telefono || '',
      cli_email: cli.email || '', cli_direccion: cli.direccion || '',
      cli_localidad: cli.localidad || '',
      condicion_pago: cli.condicion_pago || f.condicion_pago,
    }))
  }

  useEffect(() => {
    const c = e => { if (cliRef.current && !cliRef.current.contains(e.target)) setCliSugs([]) }
    document.addEventListener('mousedown', c)
    return () => document.removeEventListener('mousedown', c)
  }, [])

  // ── Items ────────────────────────────────────────────────────────────────
  const setItem = (i, k, v) => {
    setForm(f => {
      const items = [...f.items]
      items[i] = { ...items[i], [k]: v }
      if (['precio_unitario','bonif1','bonif2','bonif3','bonif4'].includes(k)) {
        const it = items[i]
        items[i].precio_final = calcFinal(it.precio_unitario, it.bonif1, it.bonif2, it.bonif3, it.bonif4)
      }
      return { ...f, items }
    })
  }

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...ITEM0 }] }))
  const delItem = i => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))

  const totalPpto = form.items.reduce((s, it) =>
    s + (parseFloat(it.cantidad)||0) * (parseFloat(it.precio_final)||0), 0)

  // ── Abrir / guardar presupuesto ───────────────────────────────────────────
  const abrirNuevo = () => {
    setForm(FORM0()); setEditId(null); setEditNumero('')
    setCliQ(''); setCliSugs([]); setFormError(''); setVista('form')
  }

  const abrirEditar = async id => {
    const r = await api.get(`/ventas/presupuestos/${id}`)
    const p = r.data
    setForm({
      cliente_id: p.cliente_id||'', cli_nombre: p.cli_nombre||'', cli_cuit: p.cli_cuit||'',
      cli_contacto: p.cli_contacto||'', cli_telefono: p.cli_telefono||'',
      cli_email: p.cli_email||'', cli_direccion: p.cli_direccion||'',
      cli_localidad: p.cli_localidad||'',
      fecha: p.fecha||hoy(), validez: p.validez||'30 días', estado: p.estado||'Borrador',
      moneda: p.moneda||'DÓLAR', tasa_cambio: p.tasa_cambio||'',
      condicion_pago: p.condicion_pago||'', lugar_entrega: p.lugar_entrega||'',
      elaborado_por: p.elaborado_por||'', observaciones: p.observaciones||'',
      items: p.items?.length ? p.items : [{ ...ITEM0 }],
    })
    setCliQ(p.cli_nombre||'')
    setEditId(id); setEditNumero(p.numero||'')
    setFormError(''); setVista('form')
  }

  const guardar = async e => {
    e.preventDefault()
    if (!form.cli_nombre.trim()) { setFormError('El campo Cliente es requerido'); return }
    if (!form.items.length)      { setFormError('Agregue al menos un ítem'); return }
    setSaving(true); setFormError('')
    try {
      if (editId) await api.put(`/ventas/presupuestos/${editId}`, form)
      else        await api.post('/ventas/presupuestos', form)
      setVista('lista'); cargarPptos(); cargarStats()
    } catch(err) { setFormError(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSaving(false) }
  }

  const eliminar = async id => {
    if (!confirm('¿Eliminar este presupuesto? Esta acción no se puede deshacer.')) return
    await api.delete(`/ventas/presupuestos/${id}`)
    cargarPptos(); cargarStats()
  }

  // ── Clientes CRUD ─────────────────────────────────────────────────────────
  const guardarCli = async e => {
    e.preventDefault(); setSavingCli(true)
    try {
      if (modalCli === 'nuevo') await api.post('/ventas/clientes', formCli)
      else                      await api.put(`/ventas/clientes/${modalCli.id}`, formCli)
      setModalCli(null); cargarClientes()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavingCli(false) }
  }

  const toggleActivo = async cli => {
    await api.delete(`/ventas/clientes/${cli.id}`)
    cargarClientes()
  }

  const totalPages = Math.ceil(totalPptos / LIMIT)

  // ══════════════════ VISTA FORMULARIO ═══════════════════════════════════════
  if (vista === 'form') {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h4 className="mb-0 fw-bold">
            <i className="bi bi-file-earmark-text me-2 text-primary" />
            {editId ? `Presupuesto N° ${editNumero}` : 'Nuevo Presupuesto'}
          </h4>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => setVista('lista')}>
            <i className="bi bi-arrow-left me-1" />Volver
          </button>
        </div>

        <form onSubmit={guardar}>
          {formError && <div className="alert alert-danger py-2 mb-3">{formError}</div>}

          {/* ── CLIENTE ── */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-header bg-light py-2 fw-semibold" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-building me-1" />Datos del Cliente
            </div>
            <div className="card-body py-3" style={{ fontSize: '0.85rem' }}>
              <div className="row g-2">
                <div className="col-md-5">
                  <label className="form-label mb-1">Cliente *</label>
                  <div ref={cliRef} style={{ position: 'relative' }}>
                    <input className="form-control form-control-sm"
                      placeholder="Buscar cliente registrado o escribir nombre..."
                      value={cliQ} onChange={e => onCliQ(e.target.value)} />
                    {cliSugs.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                        background: '#fff', border: '1px solid #dee2e6', borderRadius: 4,
                        boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxHeight: 200, overflowY: 'auto',
                      }}>
                        {cliSugs.map(c => (
                          <div key={c.id} onClick={() => selCliente(c)}
                            style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.83rem' }}
                            onMouseEnter={ev => ev.currentTarget.style.background = '#f0f4ff'}
                            onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                            <strong>{c.nombre}</strong>
                            {c.cuit && <span className="text-muted ms-2 font-monospace">{c.cuit}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1">CUIT</label>
                  <input className="form-control form-control-sm" value={form.cli_cuit}
                    onChange={e => setForm(f => ({ ...f, cli_cuit: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Contacto</label>
                  <input className="form-control form-control-sm" value={form.cli_contacto}
                    onChange={e => setForm(f => ({ ...f, cli_contacto: e.target.value }))} />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1">Teléfono</label>
                  <input className="form-control form-control-sm" value={form.cli_telefono}
                    onChange={e => setForm(f => ({ ...f, cli_telefono: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Email</label>
                  <input className="form-control form-control-sm" value={form.cli_email}
                    onChange={e => setForm(f => ({ ...f, cli_email: e.target.value }))} />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1">Dirección</label>
                  <input className="form-control form-control-sm" value={form.cli_direccion}
                    onChange={e => setForm(f => ({ ...f, cli_direccion: e.target.value }))} />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-1">Localidad</label>
                  <input className="form-control form-control-sm" value={form.cli_localidad}
                    onChange={e => setForm(f => ({ ...f, cli_localidad: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          {/* ── CONDICIONES ── */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-header bg-light py-2 fw-semibold" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-gear me-1" />Condiciones del Presupuesto
            </div>
            <div className="card-body py-3" style={{ fontSize: '0.85rem' }}>
              <div className="row g-2">
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">Fecha</label>
                  <DateInput className="form-control form-control-sm" value={form.fecha}
                    onChange={v => setForm(f => ({ ...f, fecha: v }))} />
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">Validez</label>
                  <input className="form-control form-control-sm" value={form.validez}
                    onChange={e => setForm(f => ({ ...f, validez: e.target.value }))} />
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">Estado</label>
                  <select className="form-select form-select-sm" value={form.estado}
                    onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                    {Object.keys(ESTADO_BADGE).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">Moneda</label>
                  <select className="form-select form-select-sm" value={form.moneda}
                    onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}>
                    <option>DÓLAR</option><option>EURO</option><option>PESOS</option>
                  </select>
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">T.C. ($/USD)</label>
                  <input type="number" className="form-control form-control-sm" value={form.tasa_cambio}
                    placeholder="0"
                    onChange={e => setForm(f => ({ ...f, tasa_cambio: e.target.value }))} />
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label mb-1">Elaborado por</label>
                  <input className="form-control form-control-sm" value={form.elaborado_por}
                    onChange={e => setForm(f => ({ ...f, elaborado_por: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Condición de pago</label>
                  <input className="form-control form-control-sm" value={form.condicion_pago}
                    onChange={e => setForm(f => ({ ...f, condicion_pago: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Lugar de entrega</label>
                  <input className="form-control form-control-sm" value={form.lugar_entrega}
                    onChange={e => setForm(f => ({ ...f, lugar_entrega: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Observaciones</label>
                  <input className="form-control form-control-sm" value={form.observaciones}
                    onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          {/* ── ITEMS ── */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-header bg-light py-2 d-flex justify-content-between align-items-center">
              <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-list-ul me-1" />Ítems ({form.items.length})
              </span>
              <button type="button" className="btn btn-outline-primary btn-sm py-0" onClick={addItem}>
                <i className="bi bi-plus me-1" />Agregar ítem
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                <thead className="table-dark">
                  <tr>
                    <th style={{ width: 32 }} className="text-center">#</th>
                    <th style={{ width: 60 }} className="text-center">Cant.</th>
                    <th style={{ width: 68 }} className="text-center">Unidad</th>
                    <th>Descripción</th>
                    <th style={{ width: 90 }} className="text-end">P. Unitario</th>
                    <th style={{ width: 58 }} className="text-center">B1%</th>
                    <th style={{ width: 58 }} className="text-center">B2%</th>
                    <th style={{ width: 58 }} className="text-center">B3%</th>
                    <th style={{ width: 58 }} className="text-center">B4%</th>
                    <th style={{ width: 90 }} className="text-end">P. Final</th>
                    <th style={{ width: 100 }}>Plazo</th>
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, i) => (
                    <tr key={i}>
                      <td className="text-center text-muted align-middle">{i + 1}</td>
                      <td>
                        <input type="number" className="form-control form-control-sm p-0 px-1 text-center border-0"
                          value={it.cantidad} min={0} step="any"
                          onChange={e => setItem(i, 'cantidad', e.target.value)} />
                      </td>
                      <td>
                        <input className="form-control form-control-sm p-0 px-1 text-center border-0"
                          value={it.unidad}
                          onChange={e => setItem(i, 'unidad', e.target.value)} />
                      </td>
                      <td>
                        <input className="form-control form-control-sm p-0 px-1 border-0"
                          value={it.descripcion} placeholder="Descripción del ítem"
                          onChange={e => setItem(i, 'descripcion', e.target.value)} />
                      </td>
                      <td>
                        <input type="number" className="form-control form-control-sm p-0 px-1 text-end border-0"
                          value={it.precio_unitario} min={0} step="any"
                          onChange={e => setItem(i, 'precio_unitario', e.target.value)} />
                      </td>
                      {['bonif1','bonif2','bonif3','bonif4'].map(b => (
                        <td key={b}>
                          <input type="number" className="form-control form-control-sm p-0 px-1 text-center border-0"
                            value={it[b]} min={0} max={100} step="any"
                            onChange={e => setItem(i, b, e.target.value)} />
                        </td>
                      ))}
                      <td className="text-end fw-semibold align-middle text-primary">
                        {fmtN(it.precio_final)}
                      </td>
                      <td>
                        <input className="form-control form-control-sm p-0 px-1 border-0"
                          value={it.plazo}
                          onChange={e => setItem(i, 'plazo', e.target.value)} />
                      </td>
                      <td className="text-center align-middle">
                        <button type="button" className="btn btn-outline-danger btn-sm py-0 px-1"
                          onClick={() => delItem(i)}>
                          <i className="bi bi-trash" style={{ fontSize: '0.7rem' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table-light">
                    <td colSpan={9} className="text-end fw-bold" style={{ fontSize: '0.85rem' }}>
                      TOTAL {form.moneda}
                    </td>
                    <td className="text-end fw-bold text-primary" style={{ fontSize: '0.9rem' }}>
                      {fmtN(totalPpto)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="d-flex gap-2 justify-content-end pb-4">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVista('lista')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
              <i className="bi bi-floppy me-1" />Guardar presupuesto
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ══════════════════ VISTA LISTA ════════════════════════════════════════════
  return (
    <div style={{ padding: '1.5rem' }}>

      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0 fw-bold">
          <i className="bi bi-briefcase me-2 text-primary" />Ventas
        </h4>
        <div className="d-flex gap-2">
          {(tab === 'resumen' || tab === 'presupuestos') && canWrite && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Presupuesto
            </button>
          )}
          {tab === 'clientes' && canWrite && (
            <button className="btn btn-outline-primary btn-sm"
              onClick={() => { setFormCli(CLI0); setModalCli('nuevo') }}>
              <i className="bi bi-plus-lg me-1" />Nuevo Cliente
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {[
          { key: 'resumen',      icon: 'graph-up',          label: 'Resumen'       },
          { key: 'presupuestos', icon: 'file-earmark-text', label: 'Presupuestos'  },
          { key: 'clientes',     icon: 'people',            label: 'Clientes'      },
        ].map(t => (
          <li key={t.key} className="nav-item">
            <button className={`nav-link ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}>
              <i className={`bi bi-${t.icon} me-1`} />{t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* ═══════════════ RESUMEN ═══════════════ */}
      {tab === 'resumen' && (
        <div>
          {stats && (
            <>
              <div className="row g-3 mb-4">
                {Object.entries(ESTADO_BADGE).map(([est, col]) => {
                  const d = stats.porEstado.find(e => e.estado === est) || { c: 0, monto: 0 }
                  return (
                    <div key={est} className="col-6 col-md">
                      <div className="card border-0 shadow-sm h-100 p-3 text-center">
                        <span className={`badge bg-${col} mb-2`} style={{ fontSize: '0.75rem' }}>{est}</span>
                        <div style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>{d.c}</div>
                        {d.monto > 0 && (
                          <div className="text-muted mt-1" style={{ fontSize: '0.78rem' }}>{fmtN(d.monto)}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {stats.porMes?.length > 0 && (
                <div className="card border-0 shadow-sm mb-4">
                  <div className="card-header bg-white py-2 fw-semibold" style={{ fontSize: '0.88rem' }}>
                    Últimos 12 meses
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                      <thead className="table-dark">
                        <tr>
                          <th>Período</th>
                          <th className="text-end">Cant.</th>
                          <th className="text-end">Monto total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.porMes.map(m => (
                          <tr key={m.mes}>
                            <td><strong>{m.mes}</strong></td>
                            <td className="text-end">{m.c}</td>
                            <td className="text-end">{fmtN(m.monto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
          <h6 className="fw-semibold mb-2">Últimos presupuestos</h6>
          {loadPptos
            ? <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-secondary" /></div>
            : <TablaPptos rows={pptos.slice(0, 10)} canWrite={canWrite}
                onEditar={abrirEditar} onEliminar={eliminar}
                onImprimir={id => window.open(`/ventas/presupuesto/${id}/imprimir`, '_blank')}
                onOfertaTecnica={id => navigate(`/ventas/presupuesto/${id}/oferta-tecnica`)} />
          }
        </div>
      )}

      {/* ═══════════════ PRESUPUESTOS ═══════════════ */}
      {tab === 'presupuestos' && (
        <div>
          <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
            <input className="form-control form-control-sm" style={{ maxWidth: 260 }}
              placeholder="Buscar cliente / N°..." value={filtros.buscar}
              onChange={e => { setFiltros(f => ({ ...f, buscar: e.target.value })); setPage(1) }} />
            <select className="form-select form-select-sm" style={{ maxWidth: 170 }}
              value={filtros.estado}
              onChange={e => { setFiltros(f => ({ ...f, estado: e.target.value })); setPage(1) }}>
              <option value="">Todos los estados</option>
              {Object.keys(ESTADO_BADGE).map(s => <option key={s}>{s}</option>)}
            </select>
            <span className="text-muted ms-1" style={{ fontSize: '0.8rem' }}>{totalPptos} registros</span>
          </div>
          <div className="card border-0 shadow-sm">
            {loadPptos
              ? <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-secondary" /></div>
              : <TablaPptos rows={pptos} canWrite={canWrite}
                  onEditar={abrirEditar} onEliminar={eliminar}
                  onImprimir={id => window.open(`/ventas/presupuesto/${id}/imprimir`, '_blank')}
                  onOfertaTecnica={id => navigate(`/ventas/presupuesto/${id}/oferta-tecnica`)} />
            }
          </div>
          {totalPages > 1 && (
            <div className="d-flex align-items-center gap-2 mt-2">
              <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}>‹</button>
              <span style={{ fontSize: '0.82rem' }}>Pág. {page} / {totalPages}</span>
              <button className="btn btn-sm btn-outline-secondary" disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ CLIENTES ═══════════════ */}
      {tab === 'clientes' && (
        <div>
          <div className="mb-3">
            <input className="form-control form-control-sm" style={{ maxWidth: 280 }}
              placeholder="Buscar por nombre o CUIT..." value={buscarCli}
              onChange={e => setBuscarCli(e.target.value)} />
          </div>
          <div className="card border-0 shadow-sm">
            <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              <table className="table table-hover table-sm mb-0" style={{ fontSize: '0.83rem' }}>
                <thead className="table-dark sticky-top">
                  <tr>
                    <th>Nombre</th><th>CUIT</th><th>Contacto</th>
                    <th>Teléfono</th><th>Cond. Pago</th><th>Localidad</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted py-4">Sin resultados</td></tr>
                  )}
                  {clientes.map(c => (
                    <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.45 }}>
                      <td className="fw-semibold">{c.nombre}</td>
                      <td className="font-monospace small">{c.cuit || '—'}</td>
                      <td>{c.contacto || '—'}</td>
                      <td>{c.telefono || '—'}</td>
                      <td className="text-muted">{c.condicion_pago || '—'}</td>
                      <td className="text-muted">{c.localidad || '—'}</td>
                      <td className="text-nowrap">
                        {canWrite && (
                          <>
                            <button className="btn btn-outline-secondary btn-sm py-0 px-1 me-1"
                              title="Editar" onClick={() => { setFormCli({ ...c }); setModalCli(c) }}>
                              <i className="bi bi-pencil" style={{ fontSize: '0.72rem' }} />
                            </button>
                            <button className={`btn btn-outline-${c.activo ? 'warning' : 'success'} btn-sm py-0 px-1`}
                              title={c.activo ? 'Desactivar' : 'Activar'} onClick={() => toggleActivo(c)}>
                              <i className={`bi bi-${c.activo ? 'pause-circle' : 'play-circle'}`} style={{ fontSize: '0.72rem' }} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-muted mt-2" style={{ fontSize: '0.8rem' }}>{clientes.length} clientes</div>
        </div>
      )}

      {/* ═══════════════ MODAL CLIENTE ═══════════════ */}
      {modalCli && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                  {modalCli === 'nuevo' ? 'Nuevo Cliente' : `Editar: ${modalCli.nombre}`}
                </h5>
                <button className="btn-close" onClick={() => setModalCli(null)} />
              </div>
              <form onSubmit={guardarCli}>
                <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                  <div className="row g-2">
                    {[
                      ['nombre',        'Nombre *',          'col-md-6', true],
                      ['cuit',          'CUIT',              'col-md-3'],
                      ['contacto',      'Contacto',          'col-md-3'],
                      ['telefono',      'Teléfono',          'col-md-3'],
                      ['email',         'Email',             'col-md-4'],
                      ['condicion_pago','Condición de pago', 'col-md-5'],
                      ['direccion',     'Dirección',         'col-md-6'],
                      ['localidad',     'Localidad',         'col-md-3'],
                      ['cp',            'CP',                'col-md-3'],
                    ].map(([k, l, col, req]) => (
                      <div key={k} className={col || 'col-md-4'}>
                        <label className="form-label mb-1">{l}</label>
                        <input className="form-control form-control-sm"
                          value={formCli[k] || ''}
                          onChange={e => setFormCli(f => ({ ...f, [k]: e.target.value }))}
                          required={!!req} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setModalCli(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={savingCli}>
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
