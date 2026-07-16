import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api/client'
import logo from '../../assets/logo.avif'
import { getUser } from '../../store/authStore'

/* ── Datos fijos de E-INTRA ───────────────────────────────────────── */
const EI = {
  nombre:        'E-INTRA, S.R.L.',
  dir1:          'PABLO POGGIO 961, VILLA BOSCH',
  dir2:          'CP-1682, PROVINCIA DE BUENOS AIRES',
  cuit:          'CUIT 30-71454338-1',
  cond_fiscal:   'RESPONSABLE INSCRIPTO',
  tel:           'Tel +54 11 - 4844-5666',
  lugar_entrega: 'MARTIN MIGUENS 6363, VILLA BOSCH, TRES DE FEBRERO, PROV. BS.AS.',
  horario:       'LUNES A VIERNES DE: 8:00 A 12:30 Y DE: 14:00 A 17:30',
}

const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtN = (n, dec = 2) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n ?? 0)

function sumarDias(fechaISO, dias) {
  if (!fechaISO || dias === '' || dias == null) return ''
  const [y, m, d] = fechaISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + parseInt(dias, 10))
  return dt.toISOString().slice(0, 10)
}

const MIN_FILAS = 15

export default function ImprimirOC() {
  const { id } = useParams()
  const [oc,   setOc]   = useState(null)
  const [prov, setProv] = useState(null)
  const [err,  setErr]  = useState('')

  useEffect(() => {
    api.get(`/compras/oc/${id}`)
      .then(r => {
        setOc(r.data)
        // Buscar proveedor por ID o por nombre (incluye inactivos)
        const params = r.data.proveedor_id
          ? { id: r.data.proveedor_id }
          : r.data.proveedor_nombre ? { nombre: r.data.proveedor_nombre } : null
        if (params) {
          api.get('/compras/proveedores/buscar', { params })
            .then(pr => setProv(pr.data))
            .catch(() => {})
        }
      })
      .catch(() => setErr('No se pudo cargar la OC'))
  }, [id])

  if (err)  return <div style={{padding:20,color:'red',fontFamily:'Arial'}}>{err}</div>
  if (!oc)  return <div style={{padding:20,fontFamily:'Arial'}}>Cargando OC…</div>

  /* ── Datos de moneda ────────────────────────────────────────────── */
  const esUSD   = !oc.moneda || oc.moneda.toUpperCase().includes('D')
  const esEUR   = oc.moneda?.toUpperCase().includes('EUR')
  const simb    = esEUR ? '€' : esUSD ? 'U$S' : '$'
  const monNom  = esEUR ? 'Euro' : esUSD ? 'Dólar' : 'Pesos'
  const colorMon = esUSD ? '#1a5c2a' : esEUR ? '#1a3a5c' : '#7b1a1a'
  const conTC   = oc.tasa_cambio > 1  // Solo mostrar $ARS con tasa real

  /* ── Filas de ítems (según cantidad real, con un mínimo prolijo) ───── */
  const totalFilas = Math.max(MIN_FILAS, (oc.items || []).length)
  const filas = Array.from({ length: totalFilas }, (_, i) => {
    const num = i + 1
    return { num, item: (oc.items || []).find(it => it.item_num === num) ?? null }
  })

  const subtotal    = (oc.items || []).reduce((s, it) => s + (it.cantidad || 0) * (it.precio_final || 0), 0)
  const subtotalARS = conTC ? subtotal * oc.tasa_cambio : 0

  /* ── Estilos ────────────────────────────────────────────────────── */
  const css = `
    @page { size: A4 portrait; margin: 8mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; margin: 0; padding: 0; color: #111; }
    @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    table { border-collapse: collapse; width: 100%; }
    .bloque { border: 1.5px solid #1a3a5c; margin-bottom: 3px; }
    .bloque td, .bloque th { border: 1px solid #b0bec5; padding: 2px 4px; }
    .items thead th { background: #1a3a5c; color: #fff; text-align: center; font-size: 6.8pt; padding: 2.5px 2px; border: 1px solid #0d2644; }
    .items tbody td { border: 1px solid #d0d7de; padding: 1.5px 3px; font-size: 7.5pt; }
    .items tbody tr.empty td { color: #bbb; }
    .items tfoot td { border: 1px solid #999; padding: 2px 4px; font-weight: bold; font-size: 7.5pt; }
    .print-btn { position: fixed; top: 12px; right: 12px; background: #0d6efd; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  `

  return (
    <>
      <style>{css}</style>
      <div className="no-print" style={{position:'fixed', top:12, right:12, display:'flex', gap:8, zIndex:999}}>
        <button style={{padding:'8px 16px', background:'#1d6f42', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13}}
          onClick={async () => {
            const resp = await fetch(`/api/v1/compras/oc/${id}/exportar`, { headers: { Authorization: `Bearer ${localStorage.getItem('erp_token')}` } })
            const blob = await resp.blob()
            const url  = URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href = url; a.download = `OC_${oc?.numero || id}.xlsx`; a.click()
            URL.revokeObjectURL(url)
          }}>
          📊 Exportar Excel
        </button>
        <button style={{padding:'8px 16px', background:'#0d6efd', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13}}
          onClick={() => window.print()}>
          🖨 Imprimir / PDF
        </button>
      </div>

      <div style={{padding:'1mm 0'}}>

        {/* ── ENCABEZADO ──────────────────────────────────────────── */}
        <table style={{marginBottom:'3px'}}>
          <tbody>
            <tr>
              {/* Logo / Datos E-INTRA */}
              <td style={{width:'44%', verticalAlign:'top', paddingRight:8}}>
                <img src={logo} alt="E-INTRA" style={{height:48, marginBottom:5}} />
                <div style={{fontSize:'8.5pt', fontWeight:'bold'}}>{EI.nombre}</div>
                <div style={{fontSize:'7pt', lineHeight:'1.45', marginTop:2, color:'#333'}}>
                  {EI.dir1}<br/>{EI.dir2}<br/>{EI.cuit}<br/>{EI.cond_fiscal}<br/>{EI.tel}
                </div>
              </td>

              {/* Título */}
              <td style={{width:'30%', textAlign:'center', verticalAlign:'middle'}}>
                <div style={{fontSize:'15pt', fontWeight:'bold', letterSpacing:'1px', color:'#1a3a5c'}}>
                  ORDEN DE COMPRA
                </div>
              </td>

              {/* OC / Metadatos */}
              <td style={{width:'26%', verticalAlign:'top', textAlign:'right'}}>
                <div style={{fontSize:'6.5pt', color:'#888', marginBottom:1}}>Form 15 / rev 1</div>
                <div style={{fontSize:'13pt', fontWeight:'bold', color:'#1a3a5c', lineHeight:1.1}}>
                  OC: {oc.numero}
                </div>
                <table style={{width:'100%', marginTop:4, fontSize:'7.5pt'}}>
                  <tbody>
                    {[
                      ['Fecha:',          fmtF(oc.fecha)],
                      ...(oc.modo_plazo !== 'ITEM' && oc.fecha_entrega_est ? [['Entrega Est.:', fmtF(oc.fecha_entrega_est)]] : []),
                      ['Autorizado por:', oc.autorizado_por || '—'],
                      ['Elaborado por:',  oc.elaborado_por  || '—'],
                      ...(oc.presupuesto_n ? [['Presupuesto N°:', oc.presupuesto_n]] : []),
                    ].map(([l, v]) => (
                      <tr key={l}>
                        <td style={{fontWeight:'bold', whiteSpace:'nowrap', paddingRight:4, color:'#444'}}>{l}</td>
                        <td style={{textAlign:'right'}}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── BLOQUE PROVEEDOR ────────────────────────────────────── */}
        <table className="bloque" style={{marginBottom:'4px'}}>
          <tbody>
            {/* Fila 1: nombre + moneda */}
            <tr style={{background:'#eef2f7'}}>
              <td style={{width:'13%', fontWeight:'bold', fontSize:'7.5pt', verticalAlign:'middle', whiteSpace:'nowrap'}}>
                EMITIDA PARA:
              </td>
              <td colSpan={3} style={{fontSize:'12pt', fontWeight:'bold', fontStyle:'italic', padding:'3px 6px'}}>
                {oc.proveedor_nombre}
              </td>
              <td style={{width:'18%', textAlign:'center', borderLeft:'2px solid #1a3a5c', padding:'2px 6px'}}>
                <div style={{fontSize:'6.5pt', fontWeight:'bold', color:'#555'}}>MONEDA</div>
                <div style={{fontSize:'11pt', fontWeight:'bold', color: colorMon}}>{monNom}</div>
              </td>
            </tr>

            {/* Fila 2: CUIT + condición de pago */}
            <tr>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555'}}>CUIT:</td>
              <td style={{fontSize:'7.5pt'}} colSpan={2}>{oc.proveedor_cuit || prov?.cuit || '—'}</td>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555', textAlign:'right', whiteSpace:'nowrap'}}>
                Condición de Compra:
              </td>
              <td style={{fontSize:'7.5pt', textAlign:'center', fontWeight:'bold', borderLeft:'2px solid #1a3a5c', background:'#f8f9fa'}}>
                {oc.condicion_pago}
              </td>
            </tr>

            {/* Fila 3: Teléfono + Dirección del proveedor */}
            <tr>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555'}}>TELÉFONO:</td>
              <td style={{fontSize:'7pt'}}>{prov?.telefono || '—'}</td>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555', textAlign:'right', whiteSpace:'nowrap'}}>DIRECCIÓN:</td>
              <td style={{fontSize:'7pt'}} colSpan={2}>{prov?.direccion || '—'}</td>
            </tr>

            {/* Fila 4: Localidad + CP + Tasa + Página */}
            <tr>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555'}}>LOCALIDAD:</td>
              <td style={{fontSize:'7pt'}}>{prov?.localidad || '—'}</td>
              <td style={{fontSize:'7pt'}}>
                <strong>CÓD. POSTAL:</strong> {prov?.cp || '—'}
              </td>
              <td style={{fontSize:'7pt', textAlign:'right'}}>
                <strong>TASA CAMBIO:</strong>{' '}
                {conTC
                  ? <span style={{fontWeight:'bold', color:'#7b4a00'}}>{fmtN(oc.tasa_cambio)}</span>
                  : <span style={{color:'#999'}}>—</span>
                }
              </td>
              <td style={{fontSize:'7pt', textAlign:'center', borderLeft:'2px solid #1a3a5c', fontWeight:'bold'}}>
                PÁGINA 1/1
              </td>
            </tr>

            {/* Fila 5: Vendedor + Email */}
            <tr>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555'}}>VENDEDOR:</td>
              <td style={{fontSize:'7pt'}} colSpan={2}>{prov?.vendedor || '—'}</td>
              <td style={{fontSize:'7pt', fontWeight:'bold', color:'#555', textAlign:'right'}}>E-Mail:</td>
              <td style={{fontSize:'7pt', borderLeft:'2px solid #1a3a5c'}}>{prov?.email || '—'}</td>
            </tr>

            {/* Aviso importante */}
            <tr>
              <td colSpan={5} style={{fontSize:'6.5pt', fontWeight:'bold', fontStyle:'italic', borderTop:'1px solid #aaa', textDecoration:'underline', padding:'2px 4px', background:'#fffde7'}}>
                IMPORTANTE: EL NÚMERO DE LA ORDEN DE COMPRA DEBE APARECER EN TODAS LAS FACTURAS, REMITOS Y CORRESPONDENCIA.
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── TABLA DE ÍTEMS ───────────────────────────────────────── */}
        <table className="items">
          <thead>
            <tr>
              <th style={{width:'3%'}}>ÍTEM</th>
              <th style={{width:'6%'}}>CANT.</th>
              <th style={{width:'4%'}}>UNID.<br/>MED.</th>
              <th style={{width: conTC ? '18%' : '22%'}}>DESCRIPCIÓN</th>
              <th style={{width:'8%'}}>PRECIO UNIT.<br/><span style={{color:'#adf'}}>{simb}</span></th>
              <th style={{width:'3%'}}>BONIF<br/>1</th>
              <th style={{width:'3%'}}>BONIF<br/>2</th>
              <th style={{width:'3%'}}>BONIF<br/>3</th>
              <th style={{width:'3%'}}>BONIF<br/>4</th>
              <th style={{width:'7%', background: colorMon, color:'#fff'}}>
                P.UNIT.<br/>FINAL {simb}
              </th>
              <th style={{width:'8%', background:'#1a3a5c', color:'#fff'}}>
                SUBTOTAL<br/>{simb}
              </th>
              {conTC && (
                <th style={{width:'8%', background:'#7b4a00', color:'#fff'}}>
                  EQUIV.<br/>$ARS
                </th>
              )}
              <th style={{width:'7%'}}>PLAZO DE<br/>ENTREGA</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ num, item }) =>
              item ? (
                <tr key={num}>
                  <td style={{textAlign:'center'}}>{num}</td>
                  <td style={{textAlign:'right'}}>{fmtN(item.cantidad, 3)}</td>
                  <td style={{textAlign:'center'}}>{item.unidad}</td>
                  <td>{item.descripcion}</td>
                  <td style={{textAlign:'right', color:'#555'}}>
                    {item.precio_unitario > 0 ? fmtN(item.precio_unitario) : '—'}
                  </td>
                  <td style={{textAlign:'center', color:'#555'}}>
                    {item.bonif1 > 0 ? item.bonif1 : ''}
                  </td>
                  <td style={{textAlign:'center', color:'#555'}}>
                    {item.bonif2 > 0 ? item.bonif2 : ''}
                  </td>
                  <td style={{textAlign:'center', color:'#555'}}>
                    {item.bonif3 > 0 ? item.bonif3 : ''}
                  </td>
                  <td style={{textAlign:'center', color:'#555'}}>
                    {item.bonif4 > 0 ? item.bonif4 : ''}
                  </td>
                  <td style={{textAlign:'right', color: colorMon}}>
                    {fmtN(item.precio_final)}
                  </td>
                  <td style={{textAlign:'right', fontWeight:'bold', background:'#e8f4fd', color:'#1a3a5c'}}>
                    {fmtN((item.cantidad || 0) * (item.precio_final || 0))}
                  </td>
                  {conTC && (
                    <td style={{textAlign:'right', color:'#7b4a00', background:'#fffde7'}}>
                      {fmtN((item.cantidad || 0) * (item.precio_final || 0) * oc.tasa_cambio)}
                    </td>
                  )}
                  <td style={{textAlign:'center', fontSize:'7pt'}}>
                    {item.dias_plazo != null && item.dias_plazo !== ''
                      ? fmtF(sumarDias(oc.fecha, item.dias_plazo))
                      : item.plazo}
                  </td>
                </tr>
              ) : (
                <tr key={num} className="empty">
                  <td style={{textAlign:'center', color:'#ccc'}}>{num}</td>
                  <td/><td/><td style={{color:'#ccc'}}>—</td>
                  <td/><td/><td/><td/><td/>
                  <td style={{color:'#ccc', background:'#fafffe'}}/>
                  <td style={{textAlign:'right', color:'#ccc', background:'#e8f4fd'}}>—</td>
                  {conTC && <td style={{background:'#fffef5'}}/>}
                  <td/>
                </tr>
              )
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10} style={{textAlign:'right', background:'#e8eef5', color:'#1a3a5c', paddingRight:8}}>
                SUB-TOTAL SIN I.V.A.
              </td>
              <td style={{textAlign:'right', background:'#d0e8f8', color:'#1a3a5c', fontWeight:'bold', fontSize:'8pt'}}>
                {simb} {fmtN(subtotal)}
              </td>
              {conTC && (
                <td style={{textAlign:'right', background:'#fff8e1', color:'#7b4a00', fontSize:'8pt'}}>
                  $ {fmtN(subtotalARS)}
                </td>
              )}
              <td style={{background:'#e8eef5'}}/>
            </tr>
          </tfoot>
        </table>

        {/* ── PIE ─────────────────────────────────────────────────── */}
        <table style={{marginTop:'5px', border:'1.5px solid #1a3a5c'}}>
          <tbody>
            <tr>
              <td style={{width:'32%', padding:'8px', verticalAlign:'bottom', borderRight:'1.5px solid #1a3a5c'}}>
                <div style={{height:'28px'}}/>
                <div style={{borderTop:'1px solid #333', paddingTop:'3px', textAlign:'center', fontSize:'7.5pt'}}>
                  <div style={{fontWeight:'bold'}}>{getUser()?.empleado_nombre || getUser()?.nombre || ''}</div>
                  <div style={{fontSize:'6.5pt', color:'#555'}}>E-INTRA SRL</div>
                </div>
              </td>
              <td style={{width:'68%', padding:'5px 8px', verticalAlign:'top', fontSize:'7.5pt'}}>
                <div style={{marginBottom:'3px'}}>
                  <strong>LUGAR DE ENTREGA:</strong>{' '}
                  <span style={{fontWeight:'bold', color:'#1a3a5c'}}>{oc.lugar_entrega || 'E-INTRA'}</span>
                </div>
                <div style={{marginBottom:'2px'}}>{EI.lugar_entrega}</div>
                <div style={{fontSize:'7pt', color:'#444', marginBottom: oc.observaciones ? '4px' : 0}}>
                  {EI.horario}
                </div>
                {oc.observaciones && (
                  <div style={{marginTop:'4px', fontStyle:'italic', fontSize:'7pt', borderTop:'1px dashed #ccc', paddingTop:'2px'}}>
                    <strong>Observaciones:</strong> {oc.observaciones}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Aviso EPP */}
        <div style={{textAlign:'center', fontWeight:'bold', fontStyle:'italic', fontSize:'7pt', textDecoration:'underline', marginTop:'4px', color:'#1a3a5c'}}>
          IMPORTANTE: AL INGRESO A NUESTRAS INSTALACIONES, ES OBLIGATORIO EL USO DE ELEMENTOS DE SEGURIDAD PERSONAL (EPP)
        </div>

      </div>
    </>
  )
}
