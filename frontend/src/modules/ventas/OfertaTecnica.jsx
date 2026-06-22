import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'

const FORM0 = () => ({
  ref_codigo: '',
  tipo_equipo: '',
  modelo: '',
  introduccion: '',
  principio_funcionamiento: '',
  seleccion_equipo: '',
  componentes: '',
  alcance: '',
  exclusiones: '',
  plazo_ejecucion: '',
  garantias: '',
  antecedentes: '',
  elaborado_por: '',
})

const SECCIONES = [
  { key: 'introduccion',             label: '1. Introducción' },
  { key: 'principio_funcionamiento', label: '2. Principio de Funcionamiento' },
  { key: 'seleccion_equipo',         label: '3. Selección del Equipo' },
  { key: 'componentes',              label: '4. Componentes Principales' },
  { key: 'alcance',                  label: '5. Alcance del Suministro' },
  { key: 'exclusiones',              label: '6. Exclusiones' },
  { key: 'plazo_ejecucion',          label: '7. Plazo de Ejecución' },
  { key: 'garantias',                label: '8. Garantías' },
  { key: 'antecedentes',             label: '9. Antecedentes' },
]

export default function OfertaTecnica() {
  const { id } = useParams()        // presupuesto_id
  const navigate = useNavigate()
  const puedo = puedeEscribir('ventas')

  const [ppto,    setPpto]    = useState(null)
  const [form,    setForm]    = useState(FORM0())
  const [existe,  setExiste]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState(null)

  const cargar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get(`/ventas/presupuestos/${id}`),
      api.get(`/ventas/ofertas-tecnicas/${id}`).catch(e => e.response?.status === 404 ? null : Promise.reject(e)),
    ]).then(([rp, rot]) => {
      setPpto(rp.data)
      if (rot) {
        setExiste(true)
        const { id: _, presupuesto_id: __, created_at: ___, updated_at: ____, ...campos } = rot.data
        setForm(f => ({ ...FORM0(), ...campos }))
      } else {
        setExiste(false)
        setForm(f => ({ ...FORM0(), elaborado_por: rp.data.elaborado_por || '' }))
      }
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const guardar = async () => {
    setSaving(true)
    setMsg(null)
    try {
      if (existe) {
        await api.put(`/ventas/ofertas-tecnicas/${id}`, form)
      } else {
        await api.post('/ventas/ofertas-tecnicas', { presupuesto_id: parseInt(id), ...form })
        setExiste(true)
      }
      setMsg({ tipo: 'success', texto: 'Oferta Técnica guardada correctamente.' })
    } catch(e) {
      setMsg({ tipo: 'danger', texto: e.response?.data?.error || 'Error al guardar' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center" style={{ height: '60vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  )

  if (!ppto) return <div className="p-4 text-danger">Presupuesto no encontrado</div>

  return (
    <div className="container-fluid py-3" style={{ maxWidth: 900 }}>
      {/* Encabezado */}
      <div className="d-flex align-items-center gap-2 mb-3">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/ventas')}>
          <i className="bi bi-arrow-left" /> Volver
        </button>
        <div className="ms-2">
          <h5 className="mb-0 fw-bold" style={{ color: '#1a3c6e' }}>
            <i className="bi bi-file-earmark-text me-2" />
            Oferta Técnica — Presupuesto N° {ppto.numero}
          </h5>
          <small className="text-muted">{ppto.cli_nombre}</small>
        </div>
        <div className="ms-auto d-flex gap-2">
          {existe && (
            <button
              className="btn btn-outline-primary btn-sm"
              onClick={() => window.open(`/ventas/presupuesto/${id}/oferta-tecnica/imprimir`, '_blank')}
            >
              <i className="bi bi-printer me-1" />Imprimir OT
            </button>
          )}
          {puedo && (
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={saving}>
              {saving ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-floppy me-1" />}
              {existe ? 'Actualizar' : 'Crear OT'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msg.tipo} alert-dismissible py-2`} role="alert">
          {msg.texto}
          <button type="button" className="btn-close" onClick={() => setMsg(null)} />
        </div>
      )}

      {/* Datos generales */}
      <div className="card mb-3">
        <div className="card-header py-2 fw-semibold" style={{ background: '#1a3c6e', color: '#fff' }}>
          Datos Generales
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label fw-semibold small">Código REF</label>
              <input
                className="form-control form-control-sm"
                value={form.ref_codigo}
                onChange={e => set('ref_codigo', e.target.value)}
                placeholder="EIN/BAW/DLV – EQUIPO/MODELO/DDMMYYYY - REV00"
                disabled={!puedo}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold small">Tipo de Equipo</label>
              <input
                className="form-control form-control-sm"
                value={form.tipo_equipo}
                onChange={e => set('tipo_equipo', e.target.value)}
                placeholder="Deshidratador de Lodos..."
                disabled={!puedo}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold small">Modelo</label>
              <input
                className="form-control form-control-sm"
                value={form.modelo}
                onChange={e => set('modelo', e.target.value)}
                placeholder="302, 352..."
                disabled={!puedo}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold small">Elaborado por</label>
              <input
                className="form-control form-control-sm"
                value={form.elaborado_por}
                onChange={e => set('elaborado_por', e.target.value)}
                disabled={!puedo}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Secciones técnicas */}
      {SECCIONES.map(sec => (
        <div className="card mb-3" key={sec.key}>
          <div className="card-header py-2 small fw-semibold" style={{ background: '#f0f4fa', color: '#1a3c6e' }}>
            {sec.label}
          </div>
          <div className="card-body p-2">
            <textarea
              className="form-control form-control-sm"
              rows={5}
              value={form[sec.key]}
              onChange={e => set(sec.key, e.target.value)}
              disabled={!puedo}
              style={{ fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
        </div>
      ))}

      {/* Botón inferior */}
      {puedo && (
        <div className="d-flex justify-content-end gap-2 mt-2 mb-4">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/ventas')}>
            Cancelar
          </button>
          <button className="btn btn-primary btn-sm" onClick={guardar} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-floppy me-1" />}
            {existe ? 'Actualizar Oferta Técnica' : 'Crear Oferta Técnica'}
          </button>
        </div>
      )}
    </div>
  )
}
