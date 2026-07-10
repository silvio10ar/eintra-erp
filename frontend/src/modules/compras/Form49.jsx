import React, { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import { PREFIJOS, FAM_NOMBRES } from './prefijos'

const hoy  = () => new Date().toISOString().slice(0,10)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtN = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)

const MONEDAS   = ['PESOS', 'DÓLAR', 'EURO']
const FORM_ITEM = { descripcion:'', cantidad:1, unidad:'UND.', n_parte:'', n_serie:'', n_lote:'',
                    precio_unitario:0, precio_final:0, plazo:'INMEDIATO',
                    producto_id:'', producto_codigo:'' }
const FORM_VACIO = {
  proveedor_id:'', proveedor_nombre:'', proveedor_cuit:'',
  fecha:hoy(), moneda:'PESOS', tasa_cambio:0, condicion_pago:'', lugar_entrega:'',
  proyecto:'', presupuesto_n:'', autorizado_por:'', elaborado_por:'', recibido_por:'', observaciones:'',
  items:[{ ...FORM_ITEM }]
}

export default function Form49({ canWrite, proveedores = [], productos = [], proyectos = [] }) {
  const [lista,     setLista]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [cargando,  setCargando]  = useState(false)
  const [buscar,    setBuscar]    = useState('')
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(FORM_VACIO)
  const [error,     setError]     = useState('')
  const [guardando, setGuardando] = useState(false)
  const [detalle,    setDetalle]    = useState(null)
  const [sugsP,      setSugsP]      = useState([])
  const [sugsItem,   setSugsItem]   = useState({ idx: null, list: [], pos: null })
  const [modalGenOC, setModalGenOC] = useState(null)   // null | { f49, items, fecha, moneda, tc, condicion, nro_factura, obs }
  const [savGenOC,   setSavGenOC]   = useState(false)
  const [errGenOC,   setErrGenOC]   = useState('')

  // ── Modal OC consolidada por proveedor ────────────────────────────
  const [modalOCProv,  setModalOCProv]  = useState(null)
  // null | { filtroNombre, sugsProvs, provSel, ingresos, loadingIng, selItemIds, itemsEdit, fecha, moneda, tc, condicion, obs }
  const [savOCProv,    setSavOCProv]    = useState(false)
  const [errOCProv,    setErrOCProv]    = useState('')
  const [linkingItem,     setLinkingItem]     = useState(null) // { itemId, mode, query, sugs, ... } para modalOCProv
  const [linkingFormItem, setLinkingFormItem] = useState(null) // { idx, mode, query, sugs, ... } para form principal
  const descRefs = useRef({})

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = { page, limit: 50 }
      if (buscar) params.buscar = buscar
      const { data } = await api.get('/compras/form49', { params })
      setLista(data.datos); setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }, [page, buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(FORM_VACIO); setError(''); setSugsP([]); setModal('nuevo') }

  const abrirEditar = async (f49) => {
    setCargando(true)
    try {
      const { data } = await api.get(`/compras/form49/${f49.id}`)
      setForm({
        proveedor_id:    data.proveedor_id || '',
        proveedor_nombre: data.proveedor_nombre || '',
        proveedor_cuit:  data.proveedor_cuit || '',
        fecha:           data.fecha || hoy(),
        moneda:          data.moneda || 'PESOS',
        tasa_cambio:     data.tasa_cambio || 0,
        condicion_pago:  data.condicion_pago || '',
        lugar_entrega:   data.lugar_entrega || '',
        proyecto:        data.proyecto || '',
        presupuesto_n:   data.presupuesto_n || '',
        autorizado_por:  data.autorizado_por || '',
        elaborado_por:   data.elaborado_por || '',
        recibido_por:    data.recibido_por || '',
        observaciones:   data.observaciones || '',
        items: data.items?.length ? data.items.map(i => ({
          descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad,
          n_parte: i.n_parte, n_serie: i.n_serie, n_lote: i.n_lote,
          precio_unitario: i.precio_unitario||0, precio_final: i.precio_final||0,
          plazo: i.plazo||'INMEDIATO',
          producto_id: i.producto_id||'', producto_codigo: i.producto_codigo||'',
        })) : [{ ...FORM_ITEM }],
      })
      setError(''); setSugsP([]); setModal(data)
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }

  const verDetalle = async (f49) => {
    try { const { data } = await api.get(`/compras/form49/${f49.id}`); setDetalle(data) }
    catch (e) { console.error(e) }
  }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.proveedor_nombre.trim()) { setError('Proveedor es obligatorio'); return }
    const itemsValidos = form.items.filter(i => i.descripcion.trim())
    if (!itemsValidos.length) { setError('Ingresá al menos un ítem con descripción'); return }
    const sinCodigo = itemsValidos.filter(i => !i.producto_id)
    if (sinCodigo.length) {
      setError(`${sinCodigo.length} ítem${sinCodigo.length !== 1 ? 's' : ''} sin producto asignado. Codificá todos los materiales antes de guardar.`)
      return
    }
    setGuardando(true); setError('')
    try {
      const payload = { ...form, items: itemsValidos }
      if (modal === 'nuevo') await api.post('/compras/form49', payload)
      else await api.put(`/compras/form49/${modal.id}`, payload)
      setModal(null); cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }

  const eliminar = async (f49) => {
    if (!window.confirm(`¿Eliminar el ingreso ${f49.numero}?`)) return
    try { await api.delete(`/compras/form49/${f49.id}`); cargar() }
    catch (e) { alert(e.response?.data?.error || 'Error') }
  }

  // ── Generar OC desde factura ───────────────────────────────────────
  const abrirGenOC = (f49) => {
    setErrGenOC('')
    setModalGenOC({
      f49,
      fecha:      hoy(),
      moneda:     f49.moneda || 'PESOS',
      tc:         f49.tasa_cambio || 0,
      condicion:  f49.condicion_pago || 'CTA. CTE.',
      nro_factura: '',
      obs:        '',
      items: (f49.items || []).map(it => ({
        descripcion:     it.descripcion,
        cantidad:        it.cantidad,
        unidad:          it.unidad,
        plazo:           it.plazo || 'INMEDIATO',
        producto_id:     it.producto_id || '',
        precio_unitario: it.precio_final || it.precio_unitario || 0,
        precio_final:    it.precio_final || 0,
      })),
    })
  }

  const confirmarGenOC = async () => {
    setSavGenOC(true); setErrGenOC('')
    try {
      const payload = {
        fecha:        modalGenOC.fecha,
        moneda:       modalGenOC.moneda,
        tasa_cambio:  modalGenOC.tc,
        condicion_pago: modalGenOC.condicion,
        nro_factura:  modalGenOC.nro_factura,
        observaciones: modalGenOC.obs,
        items: modalGenOC.items,
      }
      const { data } = await api.post(`/compras/form49/${modalGenOC.f49.id}/generar-oc`, payload)
      setModalGenOC(null)
      // refresca el detalle con el nro de OC
      const { data: det } = await api.get(`/compras/form49/${modalGenOC.f49.id}`)
      setDetalle(det)
      cargar()
      alert(`OC generada: ${data.oc_numero}`)
    } catch (e) {
      setErrGenOC(e.response?.data?.error || 'Error al generar OC')
    } finally { setSavGenOC(false) }
  }

  const setGenOCItem = (idx, campo, valor) =>
    setModalGenOC(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [campo]: valor } : it) }))

  // ── OC consolidada por proveedor ───────────────────────────────────
  const abrirModalOCProv = () => {
    setErrOCProv(''); setLinkingItem(null)
    setModalOCProv({
      filtroNombre: '', sugsProvs: [], provSel: null,
      ingresos: null, loadingIng: false,
      selItemIds: new Set(), itemsEdit: {},
      fecha: hoy(), moneda: 'PESOS', tc: 0, condicion: '', obs: '',
    })
  }

  const buscarIngresosProveedor = async (prov) => {
    if (!prov) return
    setModalOCProv(p => ({ ...p, loadingIng: true, ingresos: null, provSel: prov }))
    setErrOCProv('')
    try {
      const params = { proveedor_nombre: prov.nombre }
      if (prov.id) params.proveedor_id = prov.id
      const { data } = await api.get('/compras/form49/stock-por-proveedor', { params })
      const allIds = new Set(data.flatMap(f => f.items.map(it => it.id)))
      const itemsEdit = {}
      data.forEach(f => f.items.forEach(it => { itemsEdit[it.id] = { precio_unitario: it.precio_unitario || it.precio_final || 0, precio_final: it.precio_final || 0 } }))
      setModalOCProv(p => ({ ...p, ingresos: data, loadingIng: false, selItemIds: allIds, itemsEdit,
        moneda: data[0]?.moneda || 'PESOS', tc: data[0]?.tasa_cambio || 0, condicion: data[0]?.condicion_pago || '' }))
    } catch(e) {
      setErrOCProv(e.response?.data?.error || 'Error al buscar ingresos')
      setModalOCProv(p => ({ ...p, loadingIng: false }))
    }
  }

  const toggleItemOCProv = (itemId) => {
    setModalOCProv(p => {
      const next = new Set(p.selItemIds)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return { ...p, selItemIds: next }
    })
  }

  const toggleF49OCProv = (f49items) => {
    setModalOCProv(p => {
      const allSel = f49items.every(it => p.selItemIds.has(it.id))
      const next = new Set(p.selItemIds)
      f49items.forEach(it => allSel ? next.delete(it.id) : next.add(it.id))
      return { ...p, selItemIds: next }
    })
  }

  const setItemEditOCProv = (itemId, campo, val) => {
    setModalOCProv(p => ({
      ...p,
      itemsEdit: { ...p.itemsEdit, [itemId]: { ...p.itemsEdit[itemId], [campo]: val,
        ...(campo === 'precio_unitario' ? { precio_final: val } : {}) } }
    }))
  }

  const iniciarLink   = (itemId) => setLinkingItem({ itemId, mode:'search', query:'', sugs:[] })
  const iniciarCrear  = (itemId) => setLinkingItem({ itemId, mode:'create', query:'', sugs:[], crearPrefijo:'', crearCodigo:'', crearLoadingCod:false })

  const onCrearPrefijoCambio = async (prefijo) => {
    setLinkingItem(p => ({ ...p, crearPrefijo: prefijo, crearCodigo:'', crearLoadingCod: !!prefijo }))
    if (!prefijo) return
    try {
      const { data } = await api.get(`/materiales/next-codigo/${prefijo}`)
      setLinkingItem(p => p?.crearPrefijo === prefijo ? { ...p, crearCodigo: data.codigo, crearLoadingCod: false } : p)
    } catch {
      setLinkingItem(p => ({ ...p, crearCodigo:'', crearLoadingCod: false }))
    }
  }

  const confirmarCrearProd = async (descripcion) => {
    if (!linkingItem?.crearCodigo) return
    setLinkingItem(p => ({ ...p, crearLoadingCod: true }))
    try {
      const { data: prod } = await api.post('/materiales', {
        codigo: linkingItem.crearCodigo,
        descripcion,
        unidad: 'UND.',
        codigo_generado: 1,
      })
      confirmarLinkProd(prod)
    } catch(e) {
      setErrOCProv(e.response?.data?.error || 'Error al crear el producto')
      setLinkingItem(p => ({ ...p, crearLoadingCod: false }))
    }
  }

  const buscarLinkProd = (query) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const sugs = query.length > 1
      ? productos.filter(p => {
          const hay = (p.codigo + ' ' + p.descripcion).toLowerCase()
          return words.every(w => hay.includes(w))
        }).slice(0, 10)
      : []
    setLinkingItem(p => ({ ...p, query, sugs }))
  }

  const confirmarLinkProd = (prod) => {
    if (!linkingItem) return
    setModalOCProv(p => ({
      ...p,
      ingresos: p.ingresos.map(f => ({
        ...f,
        items: f.items.map(it => it.id === linkingItem.itemId
          ? { ...it, producto_id: prod.id, producto_codigo: prod.codigo }
          : it
        )
      }))
    }))
    setLinkingItem(null)
    setErrOCProv('')
  }

  const confirmarOCProv = async () => {
    setSavOCProv(true); setErrOCProv('')
    try {
      const { provSel, ingresos, selItemIds, itemsEdit, fecha, moneda, tc, condicion, obs } = modalOCProv
      const selItems = ingresos.flatMap(f => f.items).filter(it => selItemIds.has(it.id))
      const sinCodigo = selItems.filter(it => !it.producto_id)
      if (sinCodigo.length) {
        setErrOCProv(`${sinCodigo.length} ítem${sinCodigo.length !== 1 ? 's' : ''} sin producto asignado. Asigná un producto a cada ítem marcado antes de generar la OC.`)
        setSavOCProv(false)
        return
      }
      const items = []
      const fuenteNums = []
      for (const f49 of ingresos) {
        const selDeEste = f49.items.filter(it => selItemIds.has(it.id))
        if (selDeEste.length) fuenteNums.push(f49.numero)
        for (const it of selDeEste) {
          items.push({
            descripcion:     it.descripcion,
            cantidad:        it.cantidad,
            unidad:          it.unidad,
            producto_id:     it.producto_id || null,
            plazo:           it.plazo || 'INMEDIATO',
            precio_unitario: itemsEdit[it.id]?.precio_unitario ?? it.precio_final ?? 0,
            precio_final:    itemsEdit[it.id]?.precio_final    ?? it.precio_final ?? 0,
          })
        }
      }
      if (!items.length) { setErrOCProv('Seleccioná al menos un ítem'); setSavOCProv(false); return }
      const { data } = await api.post('/compras/form49/generar-oc-proveedor', {
        proveedor_id:   provSel.id || null,
        proveedor_nombre: provSel.nombre,
        proveedor_cuit: provSel.cuit || '',
        fecha, moneda, tasa_cambio: tc, condicion_pago: condicion,
        observaciones: obs, items, fuente_numeros: fuenteNums,
      })
      setModalOCProv(null)
      alert(`OC ${data.oc_numero} creada en estado Recibida.`)
    } catch(e) { setErrOCProv(e.response?.data?.error || 'Error al crear OC') }
    finally { setSavOCProv(false) }
  }

  // ── Proveedor autocomplete ──────────────────────────────────────────
  const onProvChange = (val) => {
    setForm(f => ({ ...f, proveedor_nombre: val, proveedor_id: '', proveedor_cuit: '' }))
    setSugsP(val.length > 1
      ? proveedores.filter(p => p.nombre.toLowerCase().includes(val.toLowerCase())).slice(0, 8)
      : [])
  }
  const selProv = (p) => {
    setForm(f => ({ ...f, proveedor_id: p.id, proveedor_nombre: p.nombre, proveedor_cuit: p.cuit||'' }))
    setSugsP([])
  }

  // ── Items helpers ──────────────────────────────────────────────────
  const setItem = (idx, campo, valor) =>
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [campo]: valor } : it) }))

  const addItem  = () => setForm(f => ({ ...f, items: [...f.items, { ...FORM_ITEM }] }))
  const delItem  = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  const buscarProductoItem = (idx, val) => {
    setItem(idx, 'descripcion', val)
    if (val.length > 1) {
      const words = val.toLowerCase().split(/\s+/).filter(Boolean)
      const list = productos.filter(p => {
        const hay = (p.codigo + ' ' + p.descripcion).toLowerCase()
        return words.every(w => hay.includes(w))
      }).slice(0, 20)
      const el = descRefs.current[idx]
      const pos = el ? (() => { const r = el.getBoundingClientRect(); return { top: r.bottom + window.scrollY, left: r.left + window.scrollX, width: Math.max(r.width, 480) } })() : null
      setSugsItem({ idx, list, pos })
    } else {
      setSugsItem({ idx: null, list: [], pos: null })
    }
  }

  const selProductoItem = (idx, prod) => {
    setForm(f => ({ ...f, items: f.items.map((it, i) => i !== idx ? it : {
      ...it,
      descripcion:     prod.descripcion,
      unidad:          prod.unidad || it.unidad,
      precio_unitario: prod.precio_costo || 0,
      precio_final:    prod.precio_costo || 0,
      producto_id:     prod.id,
      producto_codigo: prod.codigo,
    })}))
    setSugsItem({ idx: null, list: [], pos: null })
  }

  // ── Inline codificación en form principal ──────────────────────────
  const iniciarLinkForm  = (idx) => setLinkingFormItem({ idx, mode:'search', query:'', sugs:[] })
  const iniciarCrearForm = (idx) => setLinkingFormItem({ idx, mode:'create', query:'', sugs:[], crearPrefijo:'', crearCodigo:'', crearLoadingCod:false })

  const buscarLinkFormProd = (query) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const sugs = query.length > 1
      ? productos.filter(p => { const h=(p.codigo+' '+p.descripcion).toLowerCase(); return words.every(w=>h.includes(w)) }).slice(0,10)
      : []
    setLinkingFormItem(p => ({ ...p, query, sugs }))
  }

  const confirmarLinkFormProd = (prod) => {
    if (!linkingFormItem) return
    setForm(f => ({ ...f, items: f.items.map((it, i) => i !== linkingFormItem.idx ? it : {
      ...it, producto_id: prod.id, producto_codigo: prod.codigo
    })}))
    setLinkingFormItem(null)
  }

  const onCrearPrefijoCambioForm = async (prefijo) => {
    setLinkingFormItem(p => ({ ...p, crearPrefijo: prefijo, crearCodigo:'', crearLoadingCod: !!prefijo }))
    if (!prefijo) return
    try {
      const { data } = await api.get(`/materiales/next-codigo/${prefijo}`)
      setLinkingFormItem(p => p?.crearPrefijo === prefijo ? { ...p, crearCodigo: data.codigo, crearLoadingCod: false } : p)
    } catch { setLinkingFormItem(p => ({ ...p, crearCodigo:'', crearLoadingCod: false })) }
  }

  const confirmarCrearFormProd = async (descripcion) => {
    if (!linkingFormItem?.crearCodigo) return
    setLinkingFormItem(p => ({ ...p, crearLoadingCod: true }))
    try {
      const { data: prod } = await api.post('/materiales', { codigo: linkingFormItem.crearCodigo, descripcion, unidad:'UND.', codigo_generado:1 })
      confirmarLinkFormProd(prod)
    } catch(e) {
      setError(e.response?.data?.error || 'Error al crear el producto')
      setLinkingFormItem(p => ({ ...p, crearLoadingCod: false }))
    }
  }

  const totalPages = Math.ceil(total / 50)
  const totalForm  = form.items.reduce((s, it) => s + (parseFloat(it.cantidad)||0) * (parseFloat(it.precio_final)||0), 0)

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
        <h6 className="mb-0 fw-bold text-secondary">
          <i className="bi bi-box-arrow-in-down me-1" />Ingreso de Materiales sin OC
        </h6>
        <input className="form-control form-control-sm ms-2" style={{ maxWidth: 260 }}
          placeholder="Buscar por N°, proveedor, proyecto..."
          value={buscar} onChange={e => { setBuscar(e.target.value); setPage(1) }} />
        <div className="ms-auto d-flex gap-2">
          {canWrite && (
            <button className="btn btn-sm btn-outline-primary" onClick={abrirModalOCProv}>
              <i className="bi bi-box-arrow-up me-1" />Generar OC por proveedor
            </button>
          )}
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo ingreso
            </button>
          )}
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>N°</th><th>Fecha</th><th>Proveedor</th><th>Proyecto</th>
              <th>Ítems</th><th>Moneda</th><th>Autorizado por</th><th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-4 text-muted">Sin registros</td></tr>
            ) : lista.map(f => (
              <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(f)}>
                <td className="fw-semibold text-primary">{f.numero}</td>
                <td>{fmtF(f.fecha)}</td>
                <td>{f.proveedor_nombre || '—'}</td>
                <td>{f.proyecto || '—'}</td>
                <td className="text-center">{f.n_items || 0}</td>
                <td className="text-muted">{f.moneda || 'PESOS'}</td>
                <td>{f.autorizado_por || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  {canWrite && (
                    <div className="d-flex gap-1 justify-content-end">
                      {!f.enviado_stock && (
                        <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(f)}>
                          <i className="bi bi-pencil" />
                        </button>
                      )}
                      <button className="btn btn-outline-danger btn-sm" title="Eliminar" onClick={() => eliminar(f)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="d-flex gap-2 align-items-center mt-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(p => p-1)}>
            <i className="bi bi-chevron-left" />
          </button>
          <span className="small">Pág {page} / {totalPages}</span>
          <button className="btn btn-sm btn-outline-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p+1)}>
            <i className="bi bi-chevron-right" />
          </button>
          <span className="small text-muted ms-2">{total} registros</span>
        </div>
      )}

      {/* ══ MODAL DETALLE ════════════════════════════════════════════════ */}
      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-in-down me-2" />
                  {detalle.numero} — {detalle.proveedor_nombre}
                </h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3 small">
                  <div className="col-auto"><strong>Fecha:</strong> {fmtF(detalle.fecha)}</div>
                  {detalle.moneda        && <div className="col-auto"><strong>Moneda:</strong> {detalle.moneda}{detalle.tasa_cambio>0?` (TC: ${detalle.tasa_cambio})`:''}</div>}
                  {detalle.proveedor_cuit && <div className="col-auto"><strong>CUIT:</strong> {detalle.proveedor_cuit}</div>}
                  {detalle.condicion_pago && <div className="col-auto"><strong>Cond. Pago:</strong> {detalle.condicion_pago}</div>}
                  {detalle.proyecto       && <div className="col-auto"><strong>Proyecto:</strong> {detalle.proyecto}</div>}
                  {detalle.presupuesto_n  && <div className="col-auto"><strong>Presup. N°:</strong> {detalle.presupuesto_n}</div>}
                  {detalle.lugar_entrega  && <div className="col-auto"><strong>Lugar Entrega:</strong> {detalle.lugar_entrega}</div>}
                  {detalle.autorizado_por && <div className="col-auto"><strong>Autoriza:</strong> {detalle.autorizado_por}</div>}
                  {detalle.elaborado_por  && <div className="col-auto"><strong>Elabora:</strong> {detalle.elaborado_por}</div>}
                  {detalle.recibido_por   && <div className="col-auto"><strong>Recibe:</strong> {detalle.recibido_por}</div>}
                  {detalle.observaciones  && <div className="col-12 text-muted"><i>{detalle.observaciones}</i></div>}
                </div>
                <table className="table table-sm table-bordered" style={{ fontSize: '0.83rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th>#</th><th>Código</th><th>Descripción</th><th className="text-end">Cant.</th>
                      <th>Unidad</th><th className="text-end">Precio F.</th>
                      <th className="text-end">Subtotal</th><th>Plazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detalle.items || []).map((it, i) => (
                      <tr key={i}>
                        <td className="text-muted">{i+1}</td>
                        <td>
                          {it.producto_codigo
                            ? <span className="badge bg-dark" style={{fontFamily:'monospace',fontSize:'0.68rem'}}>{it.producto_codigo}</span>
                            : <span className="badge bg-warning text-dark" style={{fontSize:'0.65rem'}}>Sin código</span>}
                        </td>
                        <td>
                          {it.descripcion}
                          {it.n_parte && <div className="text-muted" style={{fontSize:'0.75rem'}}>P/N: {it.n_parte}</div>}
                        </td>
                        <td className="text-end">{fmtN(it.cantidad)}</td>
                        <td>{it.unidad}</td>
                        <td className="text-end">{fmtN(it.precio_final)}</td>
                        <td className="text-end">{fmtN((it.cantidad||0)*(it.precio_final||0))}</td>
                        <td>{it.plazo}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="fw-bold">
                      <td colSpan={6} className="text-end">TOTAL {detalle.moneda}</td>
                      <td className="text-end">{fmtN((detalle.items||[]).reduce((s,it)=>s+(it.cantidad||0)*(it.precio_final||0),0))}</td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <div className="d-flex gap-2 align-items-center">
                  {detalle.oc_numero ? (
                    <span className="badge bg-success fs-6">
                      <i className="bi bi-check2-circle me-1"/>OC generada: {detalle.oc_numero}
                    </span>
                  ) : canWrite && (
                    <button className="btn btn-sm btn-warning" onClick={() => abrirGenOC(detalle)}>
                      <i className="bi bi-file-earmark-plus me-1"/>Generar OC desde factura
                    </button>
                  )}
                </div>
                <div className="d-flex gap-2">
                  {canWrite && !detalle.enviado_stock && (
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => { setDetalle(null); abrirEditar(detalle) }}>
                      <i className="bi bi-pencil me-1" />Editar
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CREAR / EDITAR ══════════════════════════════════════════ */}
      {modal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <form className="modal-content" onSubmit={guardar}>
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-in-down me-2" />
                  {modal === 'nuevo' ? 'Nuevo Ingreso de Materiales sin OC' : `Editar ${modal.numero}`}
                </h5>
                <button type="button" className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {error && <div className="alert alert-danger py-2 small">{error}</div>}
                {modal !== 'nuevo' && (
                  <div className="alert alert-warning py-2 small mb-3 d-flex align-items-center gap-2">
                    <i className="bi bi-exclamation-triangle-fill flex-shrink-0"/>
                    <span>
                      Estás editando un formulario existente. Al guardar, los materiales con código quedarán como <strong>pendientes de ingreso al stock</strong>.
                      Para registrar una nueva entrega, cerrá y creá un <strong>formulario nuevo</strong>.
                    </span>
                  </div>
                )}

                {/* ── Cabecera ── */}
                <div className="border rounded px-3 pt-2 pb-2 mb-3" style={{ background: '#f8f9fa' }}>
                  {/* Fila 1 */}
                  <div className="row g-2 mb-2">
                    {/* Proveedor */}
                    <div className="col-md-4 position-relative">
                      <label className="form-label small fw-medium mb-1">Proveedor <span className="text-danger">*</span></label>
                      <input className="form-control form-control-sm" value={form.proveedor_nombre}
                        onChange={e => onProvChange(e.target.value)}
                        placeholder="Buscar o escribir razón social..."
                        autoComplete="off" />
                      {sugsP.length > 0 && (
                        <div className="border rounded shadow-sm position-absolute bg-white"
                          style={{ zIndex: 9999, top: '100%', left: 0, right: 0, maxHeight: 180, overflowY: 'auto' }}>
                          {sugsP.map(p => (
                            <div key={p.id} className="px-2 py-1 small" style={{ cursor: 'pointer' }}
                              onMouseDown={() => selProv(p)}>
                              {p.nombre}{p.cuit ? <span className="text-muted ms-2">{p.cuit}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* CUIT */}
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">CUIT</label>
                      <input className="form-control form-control-sm" value={form.proveedor_cuit}
                        onChange={e => setForm(f => ({ ...f, proveedor_cuit: e.target.value }))}
                        placeholder="xx-xxxxxxxx-x" />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Fecha</label>
                      <DateInput className="form-control form-control-sm" value={form.fecha}
                        onChange={v => setForm(f => ({ ...f, fecha: v }))} />
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">Moneda</label>
                      <select className="form-select form-select-sm" value={form.moneda}
                        onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}>
                        {MONEDAS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">TC</label>
                      <input type="number" className="form-control form-control-sm" value={form.tasa_cambio}
                        min="0" step="any" onChange={e => setForm(f => ({ ...f, tasa_cambio: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Cond. Pago</label>
                      <input className="form-control form-control-sm" value={form.condicion_pago}
                        onChange={e => setForm(f => ({ ...f, condicion_pago: e.target.value }))} />
                    </div>
                  </div>
                  {/* Fila 2 */}
                  <div className="row g-2">
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Lugar Entrega</label>
                      <input className="form-control form-control-sm" value={form.lugar_entrega}
                        onChange={e => setForm(f => ({ ...f, lugar_entrega: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Presupuesto N°</label>
                      <input className="form-control form-control-sm" value={form.presupuesto_n}
                        onChange={e => setForm(f => ({ ...f, presupuesto_n: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Proyecto</label>
                      <select className="form-select form-select-sm" value={form.proyecto}
                        onChange={e => setForm(f => ({ ...f, proyecto: e.target.value }))}>
                        <option value="">— Sin proyecto —</option>
                        {proyectos.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                      </select>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Elaborado por</label>
                      <EmpleadoSelect size="sm" value={form.elaborado_por}
                        onChange={v => setForm(f => ({ ...f, elaborado_por: v }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Autorizado por</label>
                      <EmpleadoSelect size="sm" value={form.autorizado_por}
                        onChange={v => setForm(f => ({ ...f, autorizado_por: v }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Recibido por</label>
                      <EmpleadoSelect size="sm" value={form.recibido_por}
                        onChange={v => setForm(f => ({ ...f, recibido_por: v }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label small fw-medium mb-1">Observaciones</label>
                      <input className="form-control form-control-sm" value={form.observaciones}
                        onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* ── Ítems ── */}
                <div className="d-flex align-items-center mb-2">
                  <span className="fw-semibold small">Detalle de materiales</span>
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-2" onClick={addItem}>
                    <i className="bi bi-plus" /> Agregar ítem
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered" style={{ fontSize: '0.81rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 28 }}>#</th>
                        <th style={{ width: 130 }}>CÓDIGO</th>
                        <th style={{ minWidth: 200 }}>Descripción <span className="text-danger">*</span></th>
                        <th style={{ width: 70 }}>Unidad</th>
                        <th style={{ width: 75 }}>Cant.</th>
                        <th style={{ width: 95 }}>Precio U.</th>
                        <th style={{ width: 95 }}>Precio F.</th>
                        <th style={{ width: 95 }}>Subtotal</th>
                        <th style={{ width: 90 }}>Plazo</th>
                        <th style={{ width: 105 }}>N° Parte</th>
                        <th style={{ width: 32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((it, idx) => (
                        <tr key={idx} style={!it.producto_id ? { background: '#fff8e1' } : {}}>
                          <td className="text-muted text-center align-middle">{idx+1}</td>
                          <td className="align-middle" style={{verticalAlign:'middle'}}>
                            {it.producto_id
                              ? <span className="badge bg-dark" style={{fontFamily:'monospace', fontSize:'0.68rem', letterSpacing:0.5}}>{it.producto_codigo||'—'}</span>
                              : linkingFormItem?.idx === idx && linkingFormItem.mode === 'search'
                              ? (
                                <div className="position-relative">
                                  <input className="form-control form-control-sm" style={{fontSize:'0.78rem'}}
                                    placeholder="Buscar producto..." value={linkingFormItem.query} autoFocus
                                    onChange={e => buscarLinkFormProd(e.target.value)}
                                    onBlur={() => setTimeout(() => setLinkingFormItem(null), 200)} />
                                  {linkingFormItem.sugs.length > 0 && (
                                    <div className="border rounded shadow bg-white position-absolute"
                                      style={{zIndex:9999,left:0,right:0,top:'100%',maxHeight:180,overflowY:'auto'}}>
                                      {linkingFormItem.sugs.map(p => (
                                        <div key={p.id} className="px-2 py-1 d-flex gap-2 align-items-start"
                                          style={{cursor:'pointer',fontSize:'0.78rem'}}
                                          onMouseDown={() => confirmarLinkFormProd(p)}>
                                          <span className="badge bg-dark flex-shrink-0 mt-1" style={{fontFamily:'monospace',fontSize:'0.65rem'}}>{p.codigo}</span>
                                          <span>{p.descripcion}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <button type="button" className="btn btn-link btn-sm p-0 mt-1 text-primary" style={{fontSize:'0.7rem'}}
                                    onMouseDown={() => iniciarCrearForm(idx)}>¿No existe? Crear con código nuevo</button>
                                </div>
                              )
                              : linkingFormItem?.idx === idx && linkingFormItem.mode === 'create'
                              ? (
                                <div className="border rounded p-1" style={{background:'#f0f4ff',fontSize:'0.78rem'}}>
                                  <div className="fw-semibold text-primary mb-1" style={{fontSize:'0.73rem'}}><i className="bi bi-tag me-1"/>Crear con código nuevo</div>
                                  <div className="d-flex gap-1 align-items-center mb-1 flex-wrap">
                                    <select className="form-select form-select-sm" style={{maxWidth:220,fontSize:'0.75rem'}}
                                      value={linkingFormItem.crearPrefijo} onChange={e => onCrearPrefijoCambioForm(e.target.value)}>
                                      <option value="">— Familia / Tipo —</option>
                                      {Object.entries(PREFIJOS.reduce((acc, pf) => { const f=pf.p[0]; (acc[f]=acc[f]||[]).push(pf); return acc }, {}))
                                        .map(([fam, its]) => (
                                        <optgroup key={fam} label={`${fam} — ${FAM_NOMBRES[fam]||fam}`}>
                                          {its.map(pf => <option key={pf.p} value={pf.p}>{pf.p} — {pf.d}</option>)}
                                        </optgroup>
                                      ))}
                                    </select>
                                    <input className="form-control form-control-sm" readOnly style={{maxWidth:110,fontFamily:'monospace',fontSize:'0.78rem'}}
                                      value={linkingFormItem.crearCodigo} placeholder="Código..." />
                                    {linkingFormItem.crearLoadingCod && <span className="spinner-border spinner-border-sm text-primary"/>}
                                  </div>
                                  <div className="d-flex gap-1">
                                    <button type="button" className="btn btn-primary btn-sm py-0" style={{fontSize:'0.73rem'}}
                                      disabled={!linkingFormItem.crearCodigo || linkingFormItem.crearLoadingCod}
                                      onClick={() => confirmarCrearFormProd(it.descripcion)}>
                                      <i className="bi bi-plus-lg me-1"/>Crear y asignar
                                    </button>
                                    <button type="button" className="btn btn-outline-secondary btn-sm py-0" style={{fontSize:'0.73rem'}}
                                      onClick={() => iniciarLinkForm(idx)}>Buscar existente</button>
                                    <button type="button" className="btn btn-outline-danger btn-sm py-0" style={{fontSize:'0.73rem'}}
                                      onClick={() => setLinkingFormItem(null)}>Cancelar</button>
                                  </div>
                                </div>
                              )
                              : (
                                <div className="d-flex flex-column gap-1">
                                  <span className="badge bg-warning text-dark" style={{fontSize:'0.65rem'}}>Sin código</span>
                                  <div className="d-flex gap-1">
                                    <button type="button" className="btn btn-outline-warning btn-sm py-0 px-1" style={{fontSize:'0.65rem'}}
                                      onClick={() => iniciarLinkForm(idx)}>Asignar</button>
                                    <button type="button" className="btn btn-outline-primary btn-sm py-0 px-1" style={{fontSize:'0.65rem'}}
                                      onClick={() => iniciarCrearForm(idx)}>Crear</button>
                                  </div>
                                </div>
                              )
                            }
                          </td>
                          <td>
                            <input className="form-control form-control-sm border-0 p-0 px-1"
                              ref={el => { descRefs.current[idx] = el }}
                              value={it.descripcion}
                              onChange={e => buscarProductoItem(idx, e.target.value)}
                              onBlur={() => setTimeout(() => setSugsItem({ idx: null, list: [], pos: null }), 150)} />
                            {sugsItem.idx === idx && sugsItem.pos && (
                              <div className="border rounded shadow bg-white"
                                style={{position:'fixed', zIndex:9999, top: sugsItem.pos.top, left: sugsItem.pos.left, width: sugsItem.pos.width, maxWidth:620}}
                                onMouseDown={e => e.preventDefault()}>
                                <div style={{maxHeight:228, overflowY:'auto'}}>
                                  {sugsItem.list.length === 0
                                    ? <div className="px-3 py-2 text-muted small fst-italic">Sin coincidencias</div>
                                    : sugsItem.list.map(p => (
                                        <div key={p.id}
                                          className="d-flex align-items-start gap-2 px-2 py-2 border-bottom"
                                          style={{cursor:'pointer'}}
                                          onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                                          onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                                          onClick={() => selProductoItem(idx, p)}>
                                          <span className="badge bg-dark text-white flex-shrink-0"
                                            style={{fontFamily:'monospace', fontSize:'0.72rem', minWidth:72, letterSpacing:0.5}}>
                                            {p.codigo}
                                          </span>
                                          <span className="flex-grow-1" style={{fontSize:'0.82rem'}}>
                                            {p.descripcion}
                                          </span>
                                          <span className="d-flex flex-column align-items-end flex-shrink-0 gap-0"
                                            style={{fontSize:'0.7rem', lineHeight:'1.2'}}>
                                            <span className="text-muted">{p.unidad || 'UND.'}</span>
                                            <span className={p.stock_actual > 0 ? 'text-success fw-semibold' : 'text-danger'}>
                                              stock: {fmtN(p.stock_actual)}
                                            </span>
                                          </span>
                                        </div>
                                      ))
                                  }
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <input className="form-control form-control-sm border-0 text-center" value={it.unidad}
                              onChange={e => setItem(idx, 'unidad', e.target.value)} />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end" value={it.cantidad}
                              onChange={e => setItem(idx, 'cantidad', e.target.value)} min="0" step="any" />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end" value={it.precio_unitario}
                              onChange={e => {
                                const v = parseFloat(e.target.value)||0
                                setForm(f => ({ ...f, items: f.items.map((x, i) =>
                                  i !== idx ? x : { ...x, precio_unitario: v, precio_final: v }
                                )}))
                              }} min="0" step="any" />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end fw-semibold" value={it.precio_final}
                              onChange={e => setItem(idx, 'precio_final', parseFloat(e.target.value)||0)} min="0" step="any" />
                          </td>
                          <td className="text-end align-middle pe-2 text-muted">
                            {fmtN((parseFloat(it.cantidad)||0) * (parseFloat(it.precio_final)||0))}
                          </td>
                          <td>
                            <input className="form-control form-control-sm border-0 text-center" value={it.plazo}
                              onChange={e => setItem(idx, 'plazo', e.target.value)} />
                          </td>
                          <td>
                            <input className="form-control form-control-sm border-0" value={it.n_parte}
                              onChange={e => setItem(idx, 'n_parte', e.target.value)} placeholder="—" />
                          </td>
                          <td className="text-center align-middle">
                            {form.items.length > 1 && (
                              <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => delItem(idx)}>
                                <i className="bi bi-x-lg" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="fw-bold">
                        <td colSpan={6} className="text-end">TOTAL {form.moneda}</td>
                        <td className="text-end pe-2">{fmtN(totalForm)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-success btn-sm" disabled={guardando}>
                  {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ══ MODAL OC CONSOLIDADA POR PROVEEDOR ══════════════════════════ */}
      {modalOCProv && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1075 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-up me-2"/>Generar OC desde ingresos sin OC
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalOCProv(null)}/>
              </div>
              <div className="modal-body">
                {errOCProv && <div className="alert alert-danger py-2 small mb-2">{errOCProv}</div>}

                {/* ── Paso 1: selección de proveedor ── */}
                <div className="border rounded p-3 mb-3" style={{ background: '#f8f9fa' }}>
                  <div className="row g-2 align-items-end">
                    <div className="col-md-5 position-relative">
                      <label className="form-label small fw-medium mb-1">Proveedor</label>
                      <input className="form-control form-control-sm"
                        placeholder="Buscar por nombre..."
                        value={modalOCProv.filtroNombre}
                        onChange={e => {
                          const val = e.target.value
                          const sugs = val.length > 1
                            ? proveedores.filter(p => p.nombre.toLowerCase().includes(val.toLowerCase())).slice(0,10)
                            : []
                          setModalOCProv(p => ({ ...p, filtroNombre: val, sugsProvs: sugs,
                            provSel: sugs.length===1 && sugs[0].nombre.toLowerCase()===val.toLowerCase() ? sugs[0] : p.provSel,
                            ingresos: null }))
                        }}
                        autoComplete="off" />
                      {modalOCProv.sugsProvs.length > 0 && (
                        <div className="border rounded shadow-sm position-absolute bg-white"
                          style={{ zIndex:9999, top:'100%', left:0, right:0, maxHeight:180, overflowY:'auto' }}>
                          {modalOCProv.sugsProvs.map(p => (
                            <div key={p.id} className="px-2 py-1 small" style={{ cursor:'pointer' }}
                              onMouseDown={() => setModalOCProv(prev => ({ ...prev,
                                filtroNombre: p.nombre, sugsProvs: [], provSel: p, ingresos: null }))}>
                              <strong>{p.nombre}</strong>
                              {p.cuit ? <span className="text-muted ms-2">{p.cuit}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-auto">
                      <button className="btn btn-sm btn-primary"
                        disabled={(!modalOCProv.provSel && !modalOCProv.filtroNombre.trim()) || modalOCProv.loadingIng}
                        onClick={() => {
                          const prov = modalOCProv.provSel || { id: null, nombre: modalOCProv.filtroNombre.trim(), cuit: '' }
                          buscarIngresosProveedor(prov)
                        }}>
                        {modalOCProv.loadingIng
                          ? <span className="spinner-border spinner-border-sm me-1"/>
                          : <i className="bi bi-search me-1"/>}
                        Buscar ingresos
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Sin resultados ── */}
                {modalOCProv.ingresos !== null && modalOCProv.ingresos.length === 0 && (
                  <div className="alert alert-info py-2 small">
                    <i className="bi bi-info-circle me-1"/>
                    No hay ingresos sin OC con ítems para stock de este proveedor.
                  </div>
                )}

                {/* ── Paso 2: cabecera OC ── */}
                {modalOCProv.ingresos?.length > 0 && (
                  <>
                    <div className="border rounded px-3 pt-2 pb-2 mb-3" style={{ background: '#f0f4ff' }}>
                      <div className="small fw-semibold mb-2 text-primary">
                        <i className="bi bi-file-earmark-plus me-1"/>Datos de la OC a generar
                      </div>
                      <div className="row g-2">
                        <div className="col-md-2">
                          <label className="form-label small fw-medium mb-1">Fecha</label>
                          <DateInput className="form-control form-control-sm" value={modalOCProv.fecha}
                            onChange={v => setModalOCProv(p => ({ ...p, fecha: v }))} />
                        </div>
                        <div className="col-md-2">
                          <label className="form-label small fw-medium mb-1">Moneda</label>
                          <select className="form-select form-select-sm" value={modalOCProv.moneda}
                            onChange={e => setModalOCProv(p => ({ ...p, moneda: e.target.value }))}>
                            {MONEDAS.map(m => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="col-md-1">
                          <label className="form-label small fw-medium mb-1">TC</label>
                          <input type="number" className="form-control form-control-sm" value={modalOCProv.tc}
                            min="0" step="any" onChange={e => setModalOCProv(p => ({ ...p, tc: e.target.value }))} />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small fw-medium mb-1">Cond. Pago</label>
                          <input className="form-control form-control-sm" value={modalOCProv.condicion}
                            onChange={e => setModalOCProv(p => ({ ...p, condicion: e.target.value }))} />
                        </div>
                        <div className="col-md-4">
                          <label className="form-label small fw-medium mb-1">Observaciones</label>
                          <input className="form-control form-control-sm" value={modalOCProv.obs}
                            placeholder="Opcional"
                            onChange={e => setModalOCProv(p => ({ ...p, obs: e.target.value }))} />
                        </div>
                      </div>
                    </div>

                    {/* ── Tabla de ítems agrupada por F49 ── */}
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="small fw-semibold">
                        Ítems al stock ({modalOCProv.selItemIds.size} de {modalOCProv.ingresos.reduce((s,f)=>s+f.items.length,0)} seleccionados)
                      </span>
                      <div className="d-flex gap-2">
                        <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                          onClick={() => {
                            const allIds = new Set(modalOCProv.ingresos.flatMap(f=>f.items.map(it=>it.id)))
                            setModalOCProv(p => ({ ...p, selItemIds: allIds }))
                          }}>Sel. todos</button>
                        <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                          onClick={() => setModalOCProv(p => ({ ...p, selItemIds: new Set() }))}>Desel. todos</button>
                      </div>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.81rem' }}>
                        <thead className="table-dark">
                          <tr>
                            <th style={{width:32}}/>
                            <th>Descripción</th>
                            <th style={{width:70}}>Unidad</th>
                            <th style={{width:80}} className="text-end">Cant.</th>
                            <th style={{width:120}}>Precio U.</th>
                            <th style={{width:120}}>Precio F.</th>
                            <th style={{width:100}} className="text-end">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modalOCProv.ingresos.map(f49 => {
                            const todosSel = f49.items.every(it => modalOCProv.selItemIds.has(it.id))
                            return (
                              <React.Fragment key={f49.id}>
                                {/* ── Fila agrupadora (F49) ── */}
                                <tr style={{ background: '#e9ecef' }}>
                                  <td className="text-center align-middle">
                                    <input type="checkbox" className="form-check-input mt-0"
                                      checked={todosSel}
                                      onChange={() => toggleF49OCProv(f49.items)} />
                                  </td>
                                  <td colSpan={6} className="fw-semibold small py-1">
                                    <i className="bi bi-file-earmark-text me-1 text-muted"/>
                                    {f49.numero}
                                    <span className="text-muted fw-normal ms-2">{fmtF(f49.fecha)}</span>
                                    <span className="badge bg-secondary ms-2" style={{fontSize:'0.6rem'}}>{f49.items.length} ítem{f49.items.length !== 1 ? 's' : ''}</span>
                                  </td>
                                </tr>
                                {/* ── Ítems del F49 ── */}
                                {f49.items.map(it => {
                                  const sel = modalOCProv.selItemIds.has(it.id)
                                  const ed  = modalOCProv.itemsEdit[it.id] || {}
                                  const pf  = parseFloat(ed.precio_final ?? it.precio_final) || 0
                                  const pu  = parseFloat(ed.precio_unitario ?? it.precio_unitario) || 0
                                  return (
                                    <tr key={it.id} style={!sel ? { opacity:0.4 } : (!it.producto_id ? { background:'#fff8e1', outline:'1px solid #ffc107' } : {})}>
                                      <td className="text-center align-middle">
                                        <input type="checkbox" className="form-check-input mt-0"
                                          checked={sel}
                                          onChange={() => toggleItemOCProv(it.id)} />
                                      </td>
                                      <td className="align-middle">
                                        {it.descripcion}
                                        {it.producto_codigo
                                          ? <span className="badge bg-dark ms-1" style={{fontFamily:'monospace',fontSize:'0.65rem'}}>{it.producto_codigo}</span>
                                          : sel && (
                                            linkingItem?.itemId === it.id && linkingItem.mode === 'search'
                                              ? (
                                                <div className="mt-1 position-relative">
                                                  <input
                                                    className="form-control form-control-sm"
                                                    style={{ fontSize:'0.78rem' }}
                                                    placeholder="Buscar producto del catálogo..."
                                                    value={linkingItem.query}
                                                    autoFocus
                                                    onChange={e => buscarLinkProd(e.target.value)}
                                                    onBlur={() => setTimeout(() => setLinkingItem(null), 200)} />
                                                  {linkingItem.sugs.length > 0 && (
                                                    <div className="border rounded shadow bg-white position-absolute"
                                                      style={{ zIndex:9999, left:0, right:0, top:'100%', maxHeight:180, overflowY:'auto' }}>
                                                      {linkingItem.sugs.map(p => (
                                                        <div key={p.id} className="px-2 py-1 d-flex gap-2 align-items-start"
                                                          style={{ cursor:'pointer', fontSize:'0.78rem' }}
                                                          onMouseDown={() => confirmarLinkProd(p)}>
                                                          <span className="badge bg-dark flex-shrink-0 mt-1" style={{fontFamily:'monospace',fontSize:'0.65rem'}}>{p.codigo}</span>
                                                          <span>{p.descripcion}</span>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}
                                                  <button type="button" className="btn btn-link btn-sm p-0 mt-1 text-primary"
                                                    style={{fontSize:'0.7rem'}}
                                                    onMouseDown={() => { iniciarCrear(it.id) }}>
                                                    ¿No existe? Crear con código nuevo
                                                  </button>
                                                </div>
                                              )
                                              : linkingItem?.itemId === it.id && linkingItem.mode === 'create'
                                              ? (
                                                <div className="mt-1 border rounded p-2" style={{background:'#f0f4ff', fontSize:'0.78rem'}}>
                                                  <div className="fw-semibold text-primary mb-1" style={{fontSize:'0.73rem'}}>
                                                    <i className="bi bi-tag me-1"/>Crear con código nuevo
                                                  </div>
                                                  <div className="d-flex gap-1 align-items-center mb-1 flex-wrap">
                                                    <select className="form-select form-select-sm" style={{maxWidth:260, fontSize:'0.75rem'}}
                                                      value={linkingItem.crearPrefijo}
                                                      onChange={e => onCrearPrefijoCambio(e.target.value)}>
                                                      <option value="">— Familia / Tipo —</option>
                                                      {Object.entries(
                                                        PREFIJOS.reduce((acc, pf) => {
                                                          const fam = pf.p[0]
                                                          ;(acc[fam] = acc[fam] || []).push(pf)
                                                          return acc
                                                        }, {})
                                                      ).map(([fam, items]) => (
                                                        <optgroup key={fam} label={`${fam} — ${FAM_NOMBRES[fam] || fam}`}>
                                                          {items.map(pf => (
                                                            <option key={pf.p} value={pf.p}>{pf.p} — {pf.d}</option>
                                                          ))}
                                                        </optgroup>
                                                      ))}
                                                    </select>
                                                    <input className="form-control form-control-sm" readOnly
                                                      style={{maxWidth:115, fontFamily:'monospace', fontSize:'0.78rem'}}
                                                      value={linkingItem.crearCodigo}
                                                      placeholder="Código..." />
                                                    {linkingItem.crearLoadingCod && <span className="spinner-border spinner-border-sm text-primary"/>}
                                                  </div>
                                                  <div className="d-flex gap-1 flex-wrap">
                                                    <button type="button" className="btn btn-primary btn-sm py-0"
                                                      style={{fontSize:'0.73rem'}}
                                                      disabled={!linkingItem.crearCodigo || linkingItem.crearLoadingCod}
                                                      onClick={() => confirmarCrearProd(it.descripcion)}>
                                                      <i className="bi bi-plus-lg me-1"/>Crear y asignar
                                                    </button>
                                                    <button type="button" className="btn btn-outline-secondary btn-sm py-0"
                                                      style={{fontSize:'0.73rem'}}
                                                      onClick={() => iniciarLink(it.id)}>
                                                      Buscar existente
                                                    </button>
                                                    <button type="button" className="btn btn-outline-danger btn-sm py-0"
                                                      style={{fontSize:'0.73rem'}}
                                                      onClick={() => setLinkingItem(null)}>
                                                      Cancelar
                                                    </button>
                                                  </div>
                                                </div>
                                              )
                                              : (
                                                <div className="mt-1 d-flex align-items-center gap-1 flex-wrap">
                                                  <span className="badge bg-warning text-dark" style={{fontSize:'0.65rem'}}>Sin código</span>
                                                  <button type="button" className="btn btn-outline-warning btn-sm py-0 px-1" style={{fontSize:'0.65rem'}}
                                                    onClick={() => iniciarLink(it.id)}>
                                                    Asignar existente
                                                  </button>
                                                  <button type="button" className="btn btn-outline-primary btn-sm py-0 px-1" style={{fontSize:'0.65rem'}}
                                                    onClick={() => iniciarCrear(it.id)}>
                                                    Crear nuevo
                                                  </button>
                                                </div>
                                              )
                                          )
                                        }
                                      </td>
                                      <td className="text-center align-middle">{it.unidad}</td>
                                      <td className="text-end align-middle fw-semibold">{fmtN(it.cantidad)}</td>
                                      <td>
                                        <input type="number" className="form-control form-control-sm border-0 text-end"
                                          value={pu} min="0" step="any" disabled={!sel}
                                          onChange={e => {
                                            const v = parseFloat(e.target.value)||0
                                            setItemEditOCProv(it.id, 'precio_unitario', v)
                                            setItemEditOCProv(it.id, 'precio_final', v)
                                          }} />
                                      </td>
                                      <td>
                                        <input type="number" className="form-control form-control-sm border-0 text-end fw-semibold"
                                          value={pf} min="0" step="any" disabled={!sel}
                                          onChange={e => setItemEditOCProv(it.id, 'precio_final', parseFloat(e.target.value)||0)} />
                                      </td>
                                      <td className="text-end align-middle pe-2 text-muted">
                                        {fmtN(it.cantidad * pf)}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="fw-bold">
                            <td colSpan={6} className="text-end">TOTAL {modalOCProv.moneda}</td>
                            <td className="text-end pe-2">
                              {fmtN(modalOCProv.ingresos.flatMap(f=>f.items)
                                .filter(it => modalOCProv.selItemIds.has(it.id))
                                .reduce((s,it) => s + it.cantidad * (parseFloat(modalOCProv.itemsEdit[it.id]?.precio_final ?? it.precio_final)||0), 0)
                              )}
                            </td>
                            <td/>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <span className="text-muted small">
                  {modalOCProv.provSel ? <>Proveedor: <strong>{modalOCProv.provSel.nombre}</strong></> : 'Seleccioná un proveedor'}
                </span>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setModalOCProv(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-success btn-sm"
                    disabled={savOCProv || !modalOCProv.ingresos?.length || modalOCProv.selItemIds.size === 0}
                    onClick={confirmarOCProv}>
                    {savOCProv
                      ? <span className="spinner-border spinner-border-sm me-1"/>
                      : <i className="bi bi-check-lg me-1"/>}
                    Crear OC ({modalOCProv.selItemIds.size} ítems)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL GENERAR OC ═════════════════════════════════════════════ */}
      {modalGenOC && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1070 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-file-earmark-plus me-2"/>
                  Generar OC desde ingreso {modalGenOC.f49.numero}
                  <small className="text-muted fw-normal ms-2">({modalGenOC.f49.proveedor_nombre})</small>
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalGenOC(null)}/>
              </div>
              <div className="modal-body">
                {errGenOC && <div className="alert alert-danger py-2 small">{errGenOC}</div>}

                <div className="border rounded px-3 pt-2 pb-2 mb-3" style={{ background: '#f8f9fa' }}>
                  <div className="row g-2">
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Fecha factura</label>
                      <DateInput className="form-control form-control-sm" value={modalGenOC.fecha}
                        onChange={v => setModalGenOC(p => ({ ...p, fecha: v }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">N° Factura</label>
                      <input className="form-control form-control-sm" value={modalGenOC.nro_factura}
                        placeholder="ej. 0001-00012345"
                        onChange={e => setModalGenOC(p => ({ ...p, nro_factura: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Moneda</label>
                      <select className="form-select form-select-sm" value={modalGenOC.moneda}
                        onChange={e => setModalGenOC(p => ({ ...p, moneda: e.target.value }))}>
                        {MONEDAS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">TC</label>
                      <input type="number" className="form-control form-control-sm" value={modalGenOC.tc}
                        min="0" step="any" onChange={e => setModalGenOC(p => ({ ...p, tc: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Cond. Pago</label>
                      <input className="form-control form-control-sm" value={modalGenOC.condicion}
                        onChange={e => setModalGenOC(p => ({ ...p, condicion: e.target.value }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1">Observaciones</label>
                      <input className="form-control form-control-sm" value={modalGenOC.obs}
                        onChange={e => setModalGenOC(p => ({ ...p, obs: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <p className="small text-muted mb-2">
                  <i className="bi bi-info-circle me-1"/>
                  Completá los precios. La OC se creará en estado <strong>Recibida</strong> con todos los ítems ya recibidos.
                </p>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered" style={{ fontSize: '0.81rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{width:28}}>#</th>
                        <th>Descripción</th>
                        <th style={{width:70}}>Unidad</th>
                        <th style={{width:80}} className="text-end">Cantidad</th>
                        <th style={{width:120}}>Precio U. <span className="text-danger">*</span></th>
                        <th style={{width:120}}>Precio F.</th>
                        <th style={{width:100}} className="text-end">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalGenOC.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="text-muted text-center align-middle">{idx+1}</td>
                          <td className="align-middle">{it.descripcion}</td>
                          <td className="align-middle text-center">{it.unidad}</td>
                          <td className="align-middle text-end fw-semibold">{fmtN(it.cantidad)}</td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end"
                              value={it.precio_unitario} min="0" step="any"
                              onChange={e => {
                                const v = parseFloat(e.target.value)||0
                                setGenOCItem(idx, 'precio_unitario', v)
                                setGenOCItem(idx, 'precio_final', v)
                              }} />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end fw-semibold"
                              value={it.precio_final} min="0" step="any"
                              onChange={e => setGenOCItem(idx, 'precio_final', parseFloat(e.target.value)||0)} />
                          </td>
                          <td className="align-middle text-end pe-2 text-muted">
                            {fmtN((it.cantidad||0) * (it.precio_final||0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="fw-bold">
                        <td colSpan={6} className="text-end">TOTAL {modalGenOC.moneda}</td>
                        <td className="text-end pe-2">
                          {fmtN(modalGenOC.items.reduce((s,it)=>s+(it.cantidad||0)*(it.precio_final||0),0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setModalGenOC(null)}>
                  Cancelar
                </button>
                <button className="btn btn-success btn-sm" disabled={savGenOC} onClick={confirmarGenOC}>
                  {savGenOC
                    ? <span className="spinner-border spinner-border-sm me-1"/>
                    : <i className="bi bi-check-lg me-1"/>}
                  Crear OC (Recibida)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
