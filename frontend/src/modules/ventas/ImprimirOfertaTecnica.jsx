import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api/client'

const fmtF = s => s ? s.slice(0, 10).split('-').reverse().join('/') : ''

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

export default function ImprimirOfertaTecnica() {
  const { id } = useParams()  // presupuesto_id
  const [ppto,    setPpto]    = useState(null)
  const [ot,      setOt]      = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get(`/ventas/presupuestos/${id}`),
      api.get(`/ventas/ofertas-tecnicas/${id}`),
    ]).then(([rp, rot]) => {
      setPpto(rp.data)
      setOt(rot.data)
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (ot && ppto) setTimeout(() => window.print(), 400)
  }, [ot, ppto])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  )
  if (!ppto || !ot) return <div className="p-4 text-danger">Oferta Técnica no encontrada</div>

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222; }
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          .no-print { display: none !important; }
          body { font-size: 9.5pt; }
          .page-break { page-break-before: always; }
        }
        .page { max-width: 800px; margin: 0 auto; padding: 20px; }

        /* Encabezado */
        .header { background: #1a3c6e; color: #fff; padding: 14px 20px;
                  display: flex; justify-content: space-between; align-items: center;
                  border-radius: 4px 4px 0 0; }
        .header-left h1 { margin: 0; font-size: 1.4rem; letter-spacing: 0.5px; font-weight: 700; }
        .header-left p  { margin: 2px 0 0; font-size: 0.75rem; opacity: 0.85; }
        .header-right   { text-align: right; }
        .header-right h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
        .header-right p  { margin: 3px 0 0; font-size: 0.78rem; opacity: 0.85; }

        /* Bloque de referencia / cliente */
        .ref-block { border: 1px solid #1a3c6e; border-top: none;
                     padding: 8px 16px; display: flex; gap: 20px;
                     font-size: 0.82rem; margin-bottom: 14px; }
        .ref-left  { flex: 1; }
        .ref-right { text-align: right; min-width: 180px; }
        .ref-left strong, .ref-right strong { color: #1a3c6e; }

        /* Secciones */
        .seccion { margin-bottom: 14px; }
        .seccion-title {
          background: #1a3c6e; color: #fff;
          font-size: 9.5pt; font-weight: 700;
          padding: 4px 10px; margin-bottom: 4px;
          border-radius: 2px;
        }
        .seccion-body {
          border: 1px solid #dde3ed;
          padding: 8px 12px;
          font-size: 9pt;
          line-height: 1.55;
          white-space: pre-wrap;
          min-height: 28px;
          border-radius: 0 0 2px 2px;
        }
        .seccion-body:empty::after { content: '—'; color: #aaa; }

        /* Pie de página */
        .page-foot {
          margin-top: 20px; border-top: 2px solid #1a3c6e; padding-top: 8px;
          display: flex; justify-content: space-between; align-items: flex-start;
          font-size: 7.5pt; color: #666;
        }
        .page-foot .company { font-weight: 700; color: #1a3c6e; font-size: 8pt; }
        .firma-row { display: flex; justify-content: flex-end; margin-top: 28px; }
        .firma-box { text-align: center; width: 200px; }
        .firma-line { border-top: 1px solid #888; margin-bottom: 4px; }
      `}</style>

      {/* Barra de impresión */}
      <div className="no-print" style={{
        padding: '8px 16px', background: '#f0f0f0', borderBottom: '1px solid #ccc',
        display: 'flex', gap: 8
      }}>
        <button onClick={() => window.print()}
          style={{ padding: '5px 14px', background: '#1a3c6e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          🖨 Imprimir / Guardar PDF
        </button>
        <button onClick={() => window.close()}
          style={{ padding: '5px 14px', background: '#fff', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>
          Cerrar
        </button>
        <span style={{ marginLeft: 8, color: '#666', fontSize: '0.82rem', alignSelf: 'center' }}>
          Para guardar como PDF elegí "Guardar como PDF" en el destino de impresión
        </span>
      </div>

      <div className="page">
        {/* Encabezado */}
        <div className="header">
          <div className="header-left">
            <h1>E-INTRA SRL</h1>
            <p>Ingeniería Industrial · Automatización · Control de Procesos</p>
          </div>
          <div className="header-right">
            <h2>OFERTA TÉCNICA</h2>
            {ot.tipo_equipo && <p>{ot.tipo_equipo}{ot.modelo ? ` — Modelo ${ot.modelo}` : ''}</p>}
            <p>Fecha: {fmtF(ppto.fecha)}</p>
          </div>
        </div>

        {/* Referencia / Cliente */}
        <div className="ref-block">
          <div className="ref-left">
            <div><strong>Cliente:</strong> {ppto.cli_nombre}</div>
            {ppto.cli_contacto && <div><strong>Atención:</strong> {ppto.cli_contacto}</div>}
            {ot.ref_codigo && <div><strong>REF:</strong> {ot.ref_codigo}</div>}
          </div>
          <div className="ref-right">
            <div><strong>Presupuesto N°:</strong> {ppto.numero}</div>
            {ot.elaborado_por && <div><strong>Elaborado por:</strong> {ot.elaborado_por}</div>}
            <div><strong>Moneda:</strong> {ppto.moneda}</div>
          </div>
        </div>

        {/* Secciones técnicas */}
        {SECCIONES.map(sec => (
          ot[sec.key] ? (
            <div className="seccion" key={sec.key}>
              <div className="seccion-title">{sec.label}</div>
              <div className="seccion-body">{ot[sec.key]}</div>
            </div>
          ) : null
        ))}

        {/* Firma */}
        <div className="firma-row">
          <div className="firma-box">
            <div style={{ height: 36 }} />
            <div className="firma-line" />
            <div style={{ fontSize: '8pt', color: '#555' }}>{ot.elaborado_por || 'Firma y sello'}</div>
          </div>
        </div>

        {/* Pie */}
        <div className="page-foot">
          <div>
            <div className="company">E-INTRA SRL</div>
            <div>Ingeniería Industrial · Automatización · Control de Procesos</div>
            <div>silvio.licenziato@e-intrasrl.com</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {ot.ref_codigo && <div>REF: {ot.ref_codigo}</div>}
          </div>
        </div>
      </div>
    </>
  )
}
