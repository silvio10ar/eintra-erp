import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api/client'

const fmt2 = n => n != null
  ? new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  : '0,00'
const fmtF = s => s ? s.slice(0, 10).split('-').reverse().join('/') : ''

export default function ImprimirPresupuesto() {
  const { id }    = useParams()
  const [ppto,    setPpto]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/ventas/presupuestos/${id}`)
      .then(r => setPpto(r.data))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (ppto) setTimeout(() => window.print(), 400)
  }, [ppto])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  )
  if (!ppto) return <div className="p-4 text-danger">Presupuesto no encontrado</div>

  const total = ppto.items.reduce((s, it) =>
    s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_final) || 0), 0)

  const hasBonif = ppto.items.some(it => it.bonif1 > 0 || it.bonif2 > 0 || it.bonif3 > 0 || it.bonif4 > 0)

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222; }
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          .no-print { display: none !important; }
          body { font-size: 9.5pt; }
        }
        .page { max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: #1a3c6e; color: #fff; padding: 14px 20px;
                  display: flex; justify-content: space-between; align-items: center;
                  border-radius: 4px 4px 0 0; }
        .header-left h1 { margin: 0; font-size: 1.4rem; letter-spacing: 0.5px; font-weight: 700; }
        .header-left p  { margin: 2px 0 0; font-size: 0.75rem; opacity: 0.85; }
        .header-right   { text-align: right; }
        .header-right h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
        .header-right p  { margin: 3px 0 0; font-size: 0.78rem; opacity: 0.85; }
        .cli-block { border: 1px solid #1a3c6e; border-top: none;
                     padding: 8px 16px; display: flex; gap: 20px;
                     font-size: 0.82rem; margin-bottom: 14px; }
        .cli-left  { flex: 1; }
        .cli-right { text-align: right; min-width: 180px; }
        .cli-left strong, .cli-right strong { color: #1a3c6e; }
        table.items { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
        table.items th {
          background: #1a3c6e; color: #fff; padding: 5px 6px;
          text-align: left; font-weight: 600; white-space: nowrap;
        }
        table.items th.r, table.items td.r { text-align: right; }
        table.items th.c, table.items td.c { text-align: center; }
        table.items td { padding: 4px 6px; border-bottom: 1px solid #e8e8e8; vertical-align: middle; }
        table.items tr:nth-child(even) td { background: #f7f9fc; }
        table.items tfoot td {
          background: #1a3c6e; color: #fff; font-weight: 700; padding: 5px 6px;
        }
        .footer-grid {
          display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 14px;
        }
        .footer-cell { border: 1px solid #ccc; padding: 7px 10px; font-size: 8.5pt; }
        .footer-cell h6 { margin: 0 0 3px; font-size: 7.5pt; color: #888;
                          text-transform: uppercase; letter-spacing: 0.3px; }
        .obs-block { border: 1px solid #ccc; padding: 7px 10px; margin-top: 10px;
                     font-size: 8.5pt; }
        .firma-row { display: flex; justify-content: flex-end; margin-top: 28px; }
        .firma-box { text-align: center; width: 200px; }
        .firma-line { border-top: 1px solid #888; margin-bottom: 4px; }
        .page-foot { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 6px;
                     font-size: 7.5pt; color: #999; text-align: center; }
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
            <h2>PRESUPUESTO N° {ppto.numero}</h2>
            <p>Fecha: {fmtF(ppto.fecha)}</p>
            <p>Validez: {ppto.validez}</p>
          </div>
        </div>

        {/* Datos cliente */}
        <div className="cli-block">
          <div className="cli-left">
            <div><strong>Cliente:</strong> {ppto.cli_nombre}</div>
            {ppto.cli_cuit      && <div><strong>CUIT:</strong> {ppto.cli_cuit}</div>}
            {ppto.cli_contacto  && <div><strong>Atención:</strong> {ppto.cli_contacto}{ppto.cli_telefono ? ` — Tel: ${ppto.cli_telefono}` : ''}</div>}
            {ppto.cli_email     && <div><strong>Email:</strong> {ppto.cli_email}</div>}
            {(ppto.cli_direccion || ppto.cli_localidad) && (
              <div><strong>Dirección:</strong> {[ppto.cli_direccion, ppto.cli_localidad].filter(Boolean).join(', ')}</div>
            )}
          </div>
          <div className="cli-right">
            <div><strong>Moneda:</strong> {ppto.moneda}</div>
            {ppto.tasa_cambio > 0 && <div><strong>T.C.:</strong> $ {fmt2(ppto.tasa_cambio)}</div>}
            <div><strong>Condición:</strong> {ppto.condicion_pago}</div>
            <div><strong>Entrega:</strong> {ppto.lugar_entrega}</div>
            {ppto.elaborado_por && <div><strong>Elaborado:</strong> {ppto.elaborado_por}</div>}
          </div>
        </div>

        {/* Tabla ítems */}
        <table className="items">
          <thead>
            <tr>
              <th className="c" style={{ width: 34 }}>Ítem</th>
              <th className="c" style={{ width: 48 }}>Cant.</th>
              <th className="c" style={{ width: 52 }}>Unidad</th>
              <th>Descripción</th>
              <th className="r" style={{ width: 78 }}>P. Unitario</th>
              {hasBonif && <th className="c" style={{ width: 56 }}>Bonif.</th>}
              <th className="r" style={{ width: 78 }}>P. Neto</th>
              <th className="r" style={{ width: 88 }}>Subtotal</th>
              <th style={{ width: 82 }}>Plazo</th>
            </tr>
          </thead>
          <tbody>
            {ppto.items.map((it, i) => {
              const bonifStr = [it.bonif1, it.bonif2, it.bonif3, it.bonif4]
                .filter(b => b > 0).map(b => `${b}%`).join('+') || '—'
              const subtotal = (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_final) || 0)
              return (
                <tr key={i}>
                  <td className="c">{it.item_num || i + 1}</td>
                  <td className="c">{it.cantidad}</td>
                  <td className="c">{it.unidad}</td>
                  <td>{it.descripcion}</td>
                  <td className="r">{fmt2(it.precio_unitario)}</td>
                  {hasBonif && <td className="c" style={{ fontSize: '8pt', color: '#555' }}>{bonifStr}</td>}
                  <td className="r">{fmt2(it.precio_final)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{fmt2(subtotal)}</td>
                  <td style={{ fontSize: '8pt', color: '#444' }}>{it.plazo}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={hasBonif ? 7 : 6} className="r" style={{ fontSize: '10pt' }}>
                TOTAL {ppto.moneda}
              </td>
              <td className="r" style={{ fontSize: '11pt' }}>{fmt2(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {/* Condiciones */}
        <div className="footer-grid">
          <div className="footer-cell">
            <h6>Condición de pago</h6>
            {ppto.condicion_pago}
          </div>
          <div className="footer-cell">
            <h6>Lugar de entrega</h6>
            {ppto.lugar_entrega}
          </div>
          <div className="footer-cell">
            <h6>Elaborado por</h6>
            {ppto.elaborado_por || '—'}
          </div>
        </div>

        {ppto.observaciones && (
          <div className="obs-block">
            <strong>Observaciones:</strong> {ppto.observaciones}
          </div>
        )}

        {/* Firma */}
        <div className="firma-row">
          <div className="firma-box">
            <div style={{ height: 36 }} />
            <div className="firma-line" />
            <div style={{ fontSize: '8pt', color: '#555' }}>Firma y sello</div>
          </div>
        </div>

        <div className="page-foot">
          E-INTRA SRL · silvio.licenziato@e-intrasrl.com
        </div>
      </div>
    </>
  )
}
