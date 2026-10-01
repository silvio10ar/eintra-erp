import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir, getUser } from '../../store/authStore'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import DateInput from '../../components/DateInput'
import { manejarPegadoNumero } from '../../utils/numero'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const TIPOS = [
  { v:'entrada',    l:'Entrada',    c:'success' },
  { v:'salida',     l:'Salida',     c:'danger'  },
  { v:'devolucion', l:'Devolución', c:'warning' },
  { v:'ajuste',     l:'Ajuste',     c:'info'    },
]

const fmt    = n => esMontoOculto(n) ? MONTO_OCULTO : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const hoy    = () => new Date().toISOString().slice(0,10)
const fmtF   = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtCod = c => {
  if (!c) return ''
  if (c.includes('/')) return c.replace('/', '')
  if (!/\d$/.test(c))  return c + '0'
  return c
}
// Etiqueta de una opción de lote en los selectores "de qué partida/serie
// sale" — una unidad con serie no necesita mostrar "disponible" (siempre 1).
const etiquetaLote = (l, esSerie) => esSerie
  ? `Serie: ${l.partida || '(sin serie)'}`
  : `${l.partida || '(sin partida)'} — ${fmt(l.cantidad_actual)} disponibles`

const FORM_M ={ producto_id:'', tipo:'entrada', cantidad:'', fecha:hoy(), referencia:'', precio_unit:0, proveedor:'', proyecto:'', cliente_interno:'', observaciones:'', autorizado_por_id:'', partida:'', lote_id:'', remito:'', substock_destino:'' }
const FORM_H = { desde:'', hasta:'', tipo:'', codigo:'', descripcion:'', proveedor:'', proyecto:'', cliente_interno:'', remito:'', substock:'' }
const SUBSTOCKS = [{ v:'produccion', l:'Producción' }, { v:'calidad', l:'Calidad' }, { v:'electrico', l:'Eléctrico' }]

export default function Stock() {
  const canWrite = puedeEscribir('stock')
  const esAdmin   = getUser()?.rol === 'admin'
  const location  = useLocation()

  /* ── Estado productos ───────────────────────────────────────────── */
  const [prods, setProds]     = useState([])
  const [ubics, setUbics]     = useState([])
  const [loading, setLoading] = useState(false)
  const [selId, setSelId]     = useState(null)
  const [buscar, setBuscar]   = useState('')
  const [buscarQuery, setBuscarQuery] = useState('')
  const [paginaProds, setPaginaProds] = useState(1)
  const PRODS_POR_PAGINA = 100
  const [filUbic, setFilUbic] = useState('')
  const [filAlerta, setFilAlerta] = useState(location.state?.filAlerta || '')   // ''|'ok'|'bajo'|'agotado'

  /* ── Estado modales ─────────────────────────────────────────────── */
  const [modalUbic, setModalUbic] = useState(null)  // null | prod
  const [ubicVal,   setUbicVal]   = useState('')
  const [savUbic,   setSavUbic]   = useState(false)

  const [modalLotes, setModalLotes] = useState(null) // null | { producto, lotes }
  const verLotes = p => {
    setModalLotes({ producto: p, lotes: null })
    api.get(`/stock/productos/${p.id}`)
      .then(r => setModalLotes({ producto: p, lotes: r.data.lotes || [] }))
      .catch(() => setModalLotes({ producto: p, lotes: [] }))
  }
  // Asignar partida/serie real a un lote existente (típicamente el genérico
  // "sin partida": stock que ya estaba antes de activar la trazabilidad de
  // este material) — { productoId, loteId, cantidad, partidaNueva }. Se usa
  // tanto desde "Ver lotes" de un material puntual como desde la pantalla
  // consolidada de "Partidas pendientes" (todos los materiales a la vez).
  const [asignando, setAsignando] = useState(null)
  const [savAsignar, setSavAsignar] = useState(false)
  const [errAsignar, setErrAsignar] = useState('')
  const guardarReasignacion = async () => {
    setSavAsignar(true); setErrAsignar('')
    try {
      await api.post(`/stock/productos/${asignando.productoId}/lotes/${asignando.loteId}/reasignar`, {
        cantidad: asignando.cantidad, partida_nueva: asignando.partidaNueva,
      })
      setAsignando(null)
      if (modalLotes) verLotes(modalLotes.producto)
      if (modalPendientes) cargarPendientesLotes()
    } catch (e) { setErrAsignar(e.response?.data?.error || 'Error al asignar') }
    finally { setSavAsignar(false) }
  }

  /* ── Partidas/series pendientes de asignar (todos los materiales) ──── */
  const [modalPendientes, setModalPendientes] = useState(false)
  const [pendientesLotes, setPendientesLotes] = useState([])
  const cargarPendientesLotes = useCallback(() => {
    api.get('/stock/lotes-pendientes')
      .then(r => setPendientesLotes(r.data))
      .catch(e => console.error(e))
  }, [])
  useEffect(() => { cargarPendientesLotes() }, [cargarPendientesLotes])

  const [modalM, setModalM]   = useState(null)    // null | { tipo }
  const [formM, setFormM]     = useState(FORM_M)
  const [savM, setSavM]       = useState(false)
  const [errM, setErrM]       = useState('')
  const [editandoMovId, setEditandoMovId] = useState(null) // id del movimiento en edición (admin), o null si es alta nueva
  const [buscarP, setBuscarP] = useState('')
  const [sugs, setSugs]       = useState([])
  // Proveedor de catálogo del producto seleccionado — en una salida no se
  // elige proveedor (no aplica, se retira lo que ya está en stock): se
  // muestra de referencia quién lo proveyó, tomado de la ficha del producto.
  const [prodProveedorCatalogo, setProdProveedorCatalogo] = useState('')
  // Trazabilidad de stock del producto elegido: 'ninguna' | 'partida' | 'serie'.
  // Si no es 'ninguna', la entrada pide un texto libre (partida o número de
  // serie) y la salida obliga a elegir de qué lote (con saldo) sale — nunca
  // se descuenta "del total" a ciegas.
  const [prodTrazabilidad, setProdTrazabilidad] = useState('ninguna')
  const [lotesDisponibles, setLotesDisponibles] = useState([])
  const [lotesAfuera, setLotesAfuera] = useState([]) // lotes/series dados de salida y aún sin volver, para elegir qué se devuelve
  const [loteEditActual, setLoteEditActual] = useState(null) // {id, partida} del lote que ya tenía el movimiento en edición, por si ya no tiene saldo

  const [modalH, setModalH]   = useState(false)
  const [filtH, setFiltH]     = useState(FORM_H)
  const [movs, setMovs]       = useState([])
  const [totalMovs, setTotalMovs] = useState(0)
  const [pageH, setPageH]     = useState(1)
  const [loadH, setLoadH]     = useState(false)
  const [valoresH, setValoresH] = useState({})  // autocomplete por campo: { codigo: [...], proveedor: [...], ... }
  const [provsList, setProvsList] = useState([])
  const [proyActivos, setProyActivos] = useState([])
  const [actividadesActivas, setActividadesActivas] = useState([])
  const [autorizantes, setAutorizantes] = useState([])

  // ── Fusionador de proyectos legado (historial de Stock) ────────────────────
  const [proyectosTodos, setProyectosTodos]     = useState([]) // para el destino de la fusión (no solo Activos)
  const [modalProyLegado, setModalProyLegado]   = useState(false)
  const [proyLegado,      setProyLegado]        = useState([])
  const [proyLegadoLoad,  setProyLegadoLoad]    = useState(false)
  const [fusSelect,       setFusSelect]         = useState({})
  const [fusEnCurso,      setFusEnCurso]        = useState(null)
  const [buscarLegado,    setBuscarLegado]      = useState('')
  const [seleccionLegado, setSeleccionLegado]   = useState(new Set())
  const [destinoMasivo,   setDestinoMasivo]     = useState('')
  const [fusionandoMasivo, setFusionandoMasivo] = useState(false)
  const [nombreProvisorio, setNombreProvisorio] = useState('')       // toolbar masivo: nombre del proyecto a crear
  const [nombreProvisorioFila, setNombreProvisorioFila] = useState({}) // por fila: {nombreLegado: nombreElegido}

  const cargarProyLegado = () => {
    setProyLegadoLoad(true)
    api.get('/stock/proyectos-legado')
      .then(r => setProyLegado(r.data))
      .catch(e => console.error(e))
      .finally(() => setProyLegadoLoad(false))
  }

  const legadoFiltrado = proyLegado.filter(p =>
    !buscarLegado.trim() || p.nombre.toLowerCase().includes(buscarLegado.trim().toLowerCase())
  )

  // Opciones de destino compartidas entre el select masivo y el de cada fila.
  const opcionesDestino = (
    <>
      <option value="">— seleccionar destino —</option>
      <option value="__nuevo__">➕ Crear proyecto provisorio</option>
      {proyectosTodos.length > 0 && (
        <optgroup label="Proyectos">
          {proyectosTodos.map(pa => (
            <option key={`p-${pa.id}`} value={`p-${pa.id}`}>
              {pa.codigo ? `${pa.codigo} — ${pa.nombre}` : pa.nombre}{pa.estado !== 'Activo' ? ` (${pa.estado})` : ''}
            </option>
          ))}
        </optgroup>
      )}
      {actividadesActivas.length > 0 && (
        <optgroup label="Actividades">
          {actividadesActivas.map(a => <option key={`a-${a.id}`} value={`a-${a.id}`}>{a.nombre}</option>)}
        </optgroup>
      )}
    </>
  )

  // value del select viene como "p-<id>" o "a-<id>", mismo formato que ya usa
  // el selector "Proyecto o Actividad" del formulario de salida.
  const parseDestino = valor => valor.startsWith('p-')
    ? { destino_tipo: 'proyecto', destino_id: valor.slice(2) }
    : { destino_tipo: 'actividad', destino_id: valor.slice(2) }

  // Hay nombres legado que no corresponden a ningún proyecto ni actividad
  // real cargados — "__nuevo__" crea un proyecto provisorio (código
  // PROV-####) al vuelo y fusiona contra ese, para regularizarlo después
  // desde el módulo de Proyectos.
  const resolverDestino = async (valor, nombreSugerido) => {
    if (valor === '__nuevo__') {
      const nombreNuevo = (nombreSugerido || '').trim()
      if (!nombreNuevo) throw new Error('Elegí un nombre para el proyecto provisorio')
      const { data } = await api.post('/stock/proyectos-legado/crear-provisorio', { nombre: nombreNuevo })
      setProyectosTodos(prev => [...prev, data])
      return { destino_tipo: 'proyecto', destino_id: data.id }
    }
    return parseDestino(valor)
  }

  const fusionarProyLegado = async nombre => {
    const destino = fusSelect[nombre]
    if (!destino) return alert('Elegí un proyecto, actividad, o creá uno provisorio')
    if (!confirm(`¿Fusionar "${nombre}"? Todos los movimientos de stock con ese proyecto van a apuntar al elegido.`)) return
    setFusEnCurso(nombre)
    try {
      const destinoResuelto = await resolverDestino(destino, nombreProvisorioFila[nombre] ?? nombre)
      const r = await api.post('/stock/proyectos-legado/fusionar', { nombre, ...destinoResuelto })
      alert(`Fusionado. ${r.data.movimientos_actualizados} movimientos actualizados.`)
      setProyLegado(prev => prev.filter(p => p.nombre !== nombre))
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Error al fusionar')
    } finally { setFusEnCurso(null) }
  }

  const conservarProyLegado = nombre => {
    if (!confirm(`¿Conservar "${nombre}" tal cual está, sin cambios en los movimientos?`)) return
    setFusEnCurso(nombre)
    api.post('/stock/proyectos-legado/conservar', { nombre })
      .then(() => setProyLegado(prev => prev.filter(p => p.nombre !== nombre)))
      .catch(e => alert(e.response?.data?.error || 'Error'))
      .finally(() => setFusEnCurso(null))
  }

  const toggleSeleccionLegado = nombre => setSeleccionLegado(prev => {
    const next = new Set(prev)
    next.has(nombre) ? next.delete(nombre) : next.add(nombre)
    return next
  })
  const toggleSeleccionTodosLegado = () => setSeleccionLegado(prev =>
    prev.size === legadoFiltrado.length ? new Set() : new Set(legadoFiltrado.map(p => p.nombre))
  )

  // Fusiona todos los seleccionados de una — mismo destino para todos, un
  // POST por nombre en paralelo (no hay un endpoint bulk en el backend, y no
  // hace falta: son pocos elementos por tanda).
  const fusionarSeleccionLegado = async () => {
    if (!destinoMasivo) return alert('Elegí un proyecto, actividad, o creá uno provisorio')
    const nombres = [...seleccionLegado]
    if (!confirm(`¿Fusionar ${nombres.length} nombres legado con el destino elegido?`)) return
    setFusionandoMasivo(true)
    try {
      const destino = await resolverDestino(destinoMasivo, nombreProvisorio || nombres[0])
      await Promise.all(nombres.map(nombre => api.post('/stock/proyectos-legado/fusionar', { nombre, ...destino })))
      setProyLegado(prev => prev.filter(p => !seleccionLegado.has(p.nombre)))
      setSeleccionLegado(new Set())
      setDestinoMasivo('')
      setNombreProvisorio('')
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'No se pudieron fusionar todos los seleccionados')
      cargarProyLegado()
    } finally { setFusionandoMasivo(false) }
  }

  const conservarSeleccionLegado = async () => {
    const nombres = [...seleccionLegado]
    if (!confirm(`¿Conservar ${nombres.length} nombres legado tal cual están, sin cambios?`)) return
    setFusionandoMasivo(true)
    try {
      await Promise.all(nombres.map(nombre => api.post('/stock/proyectos-legado/conservar', { nombre })))
      setProyLegado(prev => prev.filter(p => !seleccionLegado.has(p.nombre)))
      setSeleccionLegado(new Set())
    } catch (e) {
      alert('No se pudieron conservar todos los seleccionados')
      cargarProyLegado()
    } finally { setFusionandoMasivo(false) }
  }
  // Mismo criterio que "quién puede autorizar un retiro" (admin o gerente de
  // gerencia por organigrama) — el historial completo y la exportación
  // muestran todo el movimiento de materiales de la empresa, no solo lo propio.
  const esGerente = autorizantes.some(u => u.id === getUser()?.id)

  /* ── Ingresos pendientes ─────────────────────────────────────────── */
  const [ingPend,      setIngPend]      = useState([])
  const [ingPendSinOC, setIngPendSinOC] = useState([])
  const [modalIngPend, setModalIngPend] = useState(false)
  const [savIng,       setSavIng]       = useState(null)
  // confirmar sin-OC: { id, prodBuscar, prodSugs, prodSel }
  const [confirmSinOC, setConfirmSinOC] = useState(null)
  // Partida tipeada al confirmar un ingreso pendiente (OC o sin OC), por si el
  // material la requiere y todavía no se cargó — {ingreso_id: texto}.
  const [partidaPorIngreso, setPartidaPorIngreso] = useState({})
  // Cantidad real que entra a stock, cuando el material se compra en una
  // unidad distinta (unidad_compra) — sin esto, se asume que la cantidad de
  // la OC/Form49 y la que entra al depósito son la misma — {ingreso_id: texto}.
  const [cantStockPorIngreso, setCantStockPorIngreso] = useState({})

  const cargarIngPend = useCallback(() => {
    api.get('/stock/ingresos-pendientes').then(r => setIngPend(r.data)).catch(e => console.error(e))
    api.get('/stock/ingresos-sin-oc-pendientes').then(r => setIngPendSinOC(r.data)).catch(e => console.error(e))
  }, [])

  useEffect(() => { cargarIngPend() }, [cargarIngPend])

  /* ── Pedidos de stock (solicitudes internas) ────────────────────────── */
  const [pedidosPend, setPedidosPend] = useState([])
  const [modalPedidos, setModalPedidos] = useState(false)
  const [entregaCant, setEntregaCant] = useState({}) // { [item_id]: cantidad }
  const [entregaLote, setEntregaLote] = useState({}) // { [item_id]: lote_id } — solo materiales con partida
  const [lotesPorItemPedido, setLotesPorItemPedido] = useState({}) // { [item_id]: [...lotes] }
  const [savPedido, setSavPedido] = useState(null)

  const cargarPedidosPend = useCallback(() => {
    api.get('/stock/pedidos').then(r => {
      setPedidosPend(r.data)
      setEntregaCant(prev => {
        const next = { ...prev }
        for (const ped of r.data) {
          for (const it of ped.items) {
            if (!(it.id in next)) next[it.id] = it.cantidad - it.cantidad_entregada
          }
        }
        return next
      })
    }).catch(e => console.error(e))
  }, [])

  useEffect(() => { cargarPedidosPend() }, [cargarPedidosPend])

  // Materiales con trazabilidad por partida: traer los lotes con saldo de
  // cada ítem pendiente, para poder elegir de cuál sale al entregar.
  useEffect(() => {
    const items = pedidosPend.flatMap(p => p.items).filter(it => it.trazabilidad_stock !== 'ninguna' && it.cantidad - it.cantidad_entregada > 0.0001)
    if (!items.length) { setLotesPorItemPedido({}); return }
    Promise.all(items.map(it => api.get(`/stock/productos/${it.producto_id}/lotes`).then(r => [it.id, r.data])))
      .then(pares => setLotesPorItemPedido(Object.fromEntries(pares)))
      .catch(() => setLotesPorItemPedido({}))
  }, [pedidosPend])

  const faltaLotePedido = ped => ped.items.some(it => {
    const pendiente = it.cantidad - it.cantidad_entregada
    const cant = parseFloat(entregaCant[it.id] ?? pendiente) || 0
    return it.trazabilidad_stock !== 'ninguna' && cant > 0 && !entregaLote[it.id]
  })

  const entregarPedido = async ped => {
    setSavPedido(ped.id)
    try {
      const entregas = {}
      for (const it of ped.items) {
        const cant = entregaCant[it.id] ?? 0
        entregas[it.real_id] = it.trazabilidad_stock !== 'ninguna' ? { cantidad: cant, lote_id: entregaLote[it.id] || null } : cant
      }
      // Un retiro de Venta de Repuestos usa su propio endpoint (mismo permiso
      // de Stock, pero la tabla que actualiza es otra) — ver GET /stock/pedidos.
      const esVentaRepuesto = ped.origen === 'venta_repuesto'
      await api.post(
        esVentaRepuesto ? `/venta-repuestos/${ped.real_id}/retirar` : `/stock/pedidos/${ped.real_id}/entregar`,
        esVentaRepuesto ? { retiros: entregas } : { entregas }
      )
      // Se borran los valores tipeados para este pedido: si queda algo pendiente
      // (entrega parcial), que se recalcule de nuevo contra el saldo real, en
      // vez de arrastrar la cantidad vieja que ya se entregó.
      setEntregaCant(prev => { const next = { ...prev }; for (const it of ped.items) delete next[it.id]; return next })
      setEntregaLote(prev => { const next = { ...prev }; for (const it of ped.items) delete next[it.id]; return next })
      cargarPedidosPend(); cargar()
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al confirmar la entrega')
    } finally { setSavPedido(null) }
  }

  useEffect(() => {
    // /rrhh/proyectos: listado liviano sin costos, abierto a cualquier usuario
    // autenticado — evita que este selector quede vacío para quien no tiene
    // el permiso completo del módulo Proyectos (ver Partes.jsx, mismo caso).
    api.get('/rrhh/proyectos')
      .then(r => { setProyActivos(r.data.filter(p => p.estado === 'Activo')); setProyectosTodos(r.data) })
      .catch(e => console.error(e))
    // Mismo motivo: /rrhh/actividades tampoco tiene gate de módulo, así que
    // este selector se completa para cualquier usuario que registre un movimiento.
    api.get('/rrhh/actividades')
      .then(r => setActividadesActivas(r.data.filter(a => a.activo)))
      .catch(e => console.error(e))
    // Para el selector obligatorio de "Autorizado por" en un retiro (salida).
    api.get('/stock/autorizantes')
      .then(r => setAutorizantes(r.data))
      .catch(e => console.error(e))
  }, [])

  const confirmarIngreso = async id => {
    setSavIng(id)
    try {
      await api.post(`/stock/ingresos-pendientes/${id}/confirmar`,
        { partida: partidaPorIngreso[id], cantidad_stock: cantStockPorIngreso[id] || undefined })
      cargarIngPend(); cargar()
    } catch(err) { alert(err.response?.data?.error ?? 'Error al confirmar') }
    finally { setSavIng(null) }
  }

  const rechazarIngreso = async (id, desc) => {
    if (!confirm(`¿Rechazar ingreso de "${desc}"? El material NO entrará al stock.`)) return
    setSavIng(id)
    try {
      await api.delete(`/stock/ingresos-pendientes/${id}`)
      cargarIngPend()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  const confirmarSinOC = async (id, producto_id) => {
    setSavIng(id)
    try {
      await api.post(`/stock/ingresos-sin-oc-pendientes/${id}/confirmar`,
        { producto_id, partida: partidaPorIngreso[id], cantidad_stock: cantStockPorIngreso[id] || undefined })
      setConfirmSinOC(null); cargarIngPend(); cargar()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  const rechazarSinOC = async (id, desc) => {
    if (!confirm(`¿Rechazar ingreso de "${desc}"? El material NO entrará al stock.`)) return
    setSavIng(id)
    try {
      await api.delete(`/stock/ingresos-sin-oc-pendientes/${id}`)
      cargarIngPend()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  /* ── Cargar productos ───────────────────────────────────────────── */
  // Con miles de productos en el catálogo real, traer todo de entrada es lo
  // que hacía sentir lenta la pantalla — igual que en Materiales, ahora no se
  // pide nada hasta que haya al menos un criterio activo.
  const hayFiltro = !!(buscarQuery || filUbic || filAlerta)

  const cargar = useCallback(() => {
    if (!hayFiltro) { setProds([]); return }
    setLoading(true)
    api.get('/stock/productos', { params: { buscar: buscarQuery||undefined, ubicacion: filUbic||undefined, alerta: filAlerta||undefined } })
      .then(r => setProds(r.data))
      .finally(() => setLoading(false))
  }, [buscarQuery, filUbic, filAlerta, hayFiltro])

  useEffect(() => { cargar() }, [cargar])

  /* ── Contadores de la barra de estado ──────────────────────────────
     Siempre reflejan el catálogo completo, no lo que esté filtrado/cargado
     en pantalla — por eso se piden aparte, con un solo número por categoría
     en vez de traer todas las filas. */
  const [contadores, setContadores] = useState({ total: 0, disponibles: 0, stockBajo: 0, agotados: 0 })
  useEffect(() => {
    api.get('/stock/productos/contadores').then(r => setContadores(r.data)).catch(e => console.error(e))
  }, [])

  // Debounce: esperar una pausa antes de consultar, en vez de un pedido por
  // cada letra tipeada (mismo patrón que ya usan Compras/Materiales/Finanzas).
  useEffect(() => {
    const t = setTimeout(() => setBuscarQuery(buscar), 300)
    return () => clearTimeout(t)
  }, [buscar])

  useEffect(() => {
    api.get('/stock/productos/ubicaciones').then(r => setUbics(r.data))
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(e => console.error(e))
  }, [])

  /* ── Cargar historial ───────────────────────────────────────────── */
  // Cada campo de texto filtra de forma independiente — se pueden combinar
  // todos los que hagan falta a la vez (antes había que elegir uno solo de
  // una lista).
  const cargarHistorial = useCallback(() => {
    if (!modalH) return
    setLoadH(true)
    const params = { page: pageH, limit: 200,
      tipo: filtH.tipo||undefined, desde: filtH.desde||undefined, hasta: filtH.hasta||undefined,
      codigo: filtH.codigo||undefined, descripcion: filtH.descripcion||undefined,
      proveedor: filtH.proveedor||undefined, proyecto: filtH.proyecto||undefined,
      cliente_interno: filtH.cliente_interno||undefined, remito: filtH.remito||undefined,
      substock: filtH.substock||undefined }
    api.get('/stock/movimientos', { params })
      .then(r => { setMovs(r.data.datos); setTotalMovs(r.data.total) })
      .finally(() => setLoadH(false))
  }, [modalH, filtH, pageH])

  useEffect(() => { cargarHistorial() }, [cargarHistorial])

  // Autocompletado — un datalist por campo, cargados juntos al abrir el
  // historial (no hace falta esperar a que se elija un campo primero).
  useEffect(() => {
    if (!modalH) return
    const campos = ['codigo','descripcion','proveedor','proyecto','cliente_interno','remito']
    Promise.all(campos.map(c =>
      api.get('/stock/movimientos/valores', { params: { campo: c } }).then(r => [c, r.data]).catch(() => [c, []])
    )).then(pares => setValoresH(Object.fromEntries(pares)))
  }, [modalH])

  /* ── Sugerencias búsqueda de producto en modal movimiento ──────────
     Independiente de "prods" (que ahora puede estar vacío si no hay ningún
     filtro activo en la pantalla principal) — busca directo contra el backend. */
  useEffect(() => {
    if (!buscarP || buscarP.length < 2) { setSugs([]); return }
    const t = setTimeout(() => {
      api.get('/stock/productos', { params: { buscar: buscarP } })
        .then(r => setSugs(r.data.slice(0, 8)))
        .catch(() => setSugs([]))
    }, 250)
    return () => clearTimeout(t)
  }, [buscarP])

  /* ── Sugerencias búsqueda de producto en "Confirmar ingreso sin OC" ──
     Mismo motivo que arriba: no depende de "prods". */
  useEffect(() => {
    const q = confirmSinOC?.prodBuscar || ''
    if (q.length < 2) return
    const t = setTimeout(() => {
      api.get('/stock/productos', { params: { buscar: q } })
        .then(r => setConfirmSinOC(prev => prev ? { ...prev, prodSugs: r.data.slice(0, 8) } : prev))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [confirmSinOC?.prodBuscar])

  /* ── Producto seleccionado ──────────────────────────────────────── */
  const sel = prods.find(p => p.id === selId)

  /* ── Abrir modales ──────────────────────────────────────────────── */
  const abrirEditarUbic = p => { if (!p) return; setUbicVal(p.ubicacion || ''); setModalUbic(p) }

  const abrirMov = (tipo) => {
    const p = sel
    setFormM({ ...FORM_M, tipo, fecha: hoy(), producto_id: p?.id??'' })
    setBuscarP(p ? `${p.codigo} — ${p.descripcion}` : '')
    setProdProveedorCatalogo(p?.proveedor || '')
    setProdTrazabilidad(p?.trazabilidad_stock || 'ninguna')
    setLotesDisponibles([]); setLoteEditActual(null)
    setSugs([]); setErrM(''); setEditandoMovId(null); setModalM({ tipo })
  }

  // Editar un movimiento ya cargado (admin, doble click en la fila del historial).
  const abrirEditarMov = m => {
    if (!esAdmin) return
    setFormM({
      producto_id: m.producto_id, tipo: m.tipo, cantidad: m.cantidad,
      fecha: m.fecha?.slice(0, 10) || hoy(), referencia: m.referencia || '',
      precio_unit: m.precio_unit || 0, proveedor: m.proveedor || '',
      proyecto: m.proyecto || '', cliente_interno: m.cliente_interno || '',
      observaciones: m.observaciones || '', autorizado_por_id: m.autorizado_por_id || '',
      partida: m.partida || '', lote_id: m.lote_id || '', remito: m.remito || '',
      // Sin campo propio en el formulario (se sacó de Salida), pero si el
      // movimiento ya traía un vínculo a una Hoja de Ruta hay que reenviarlo
      // tal cual al guardar — si no, editar cualquier otro campo lo borraría.
      hoja_ruta_id: m.hoja_ruta_id || '',
    })
    setBuscarP(`${m.codigo} — ${m.descripcion}`)
    setProdProveedorCatalogo(m.producto_proveedor || '')
    setProdTrazabilidad(m.producto_trazabilidad_stock || 'ninguna')
    // El lote que tenía este movimiento puede ya no tener saldo (se consumió
    // después) — se agrega igual como opción para poder guardar sin cambiar
    // de dónde salió, aunque ya no tenga stock disponible.
    setLoteEditActual(m.lote_id ? { id: m.lote_id, partida: m.partida || '' } : null)
    setLotesDisponibles([])
    setSugs([]); setErrM(''); setEditandoMovId(m.id); setModalM({ tipo: m.tipo })
  }

  const cerrarModalM = () => { setModalM(null); setEditandoMovId(null) }

  // Lotes con saldo del producto elegido — solo hace falta para elegir "de
  // qué partida/serie sale" en una salida de un material que la requiere.
  useEffect(() => {
    if (!modalM || formM.tipo !== 'salida' || prodTrazabilidad === 'ninguna' || !formM.producto_id) {
      setLotesDisponibles([]); return
    }
    api.get(`/stock/productos/${formM.producto_id}/lotes`)
      .then(r => setLotesDisponibles(r.data))
      .catch(() => setLotesDisponibles([]))
  }, [modalM, formM.tipo, formM.producto_id, prodTrazabilidad])

  // Lotes/series ya dados de salida (y sin volver) del producto elegido —
  // para elegir "qué unidad se devuelve" en vez de retipear el número de
  // serie a mano, con el riesgo de errores de tipeo que eso implica.
  useEffect(() => {
    if (!modalM || formM.tipo !== 'devolucion' || prodTrazabilidad === 'ninguna' || !formM.producto_id) {
      setLotesAfuera([]); return
    }
    api.get(`/stock/productos/${formM.producto_id}/lotes-afuera`)
      .then(r => setLotesAfuera(r.data))
      .catch(() => setLotesAfuera([]))
  }, [modalM, formM.tipo, formM.producto_id, prodTrazabilidad])

  /* ── Guardar ubicación ──────────────────────────────────────────── */
  const guardarUbic = async e => {
    e.preventDefault(); setSavUbic(true)
    try {
      await api.put(`/stock/productos/${modalUbic.id}`, { ...modalUbic, ubicacion: ubicVal })
      setModalUbic(null); cargar()
    } catch { alert('Error al guardar') }
    finally { setSavUbic(false) }
  }

  /* ── Guardar movimiento ─────────────────────────────────────────── */
  const guardarM = async e => {
    e.preventDefault()
    if (formM.tipo === 'salida' && !formM.substock_destino && !formM.autorizado_por_id) {
      setErrM('Elegí quién autoriza este retiro'); return
    }
    setSavM(true); setErrM('')
    const payload = formM.tipo === 'salida' ? { ...formM, proveedor: prodProveedorCatalogo } : formM
    try {
      if (editandoMovId) {
        await api.put(`/stock/movimientos/${editandoMovId}`, payload)
        cerrarModalM(); cargar(); cargarHistorial()
      } else {
        const { data } = await api.post('/stock/movimientos', payload)
        setModalM(null); cargar()
        alert(data.mensaje)
      }
    } catch(err) { setErrM(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavM(false) }
  }

  /* ── Exportar ───────────────────────────────────────────────────── */
  // Antes se abría la descarga con window.open — una navegación normal del
  // navegador, que nunca manda el header Authorization (eso solo lo agrega
  // el interceptor de axios en `api`). El backend rechazaba SIEMPRE con
  // "Token requerido", para cualquier usuario, no solo los de solo lectura.
  // Se pasa a descargar vía axios (mismo patrón que ya usa, por ejemplo,
  // Administracion.jsx) para que el token viaje correctamente.
  const descargarBlob = async (url, nombreArchivo) => {
    try {
      const r = await api.get(url, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = blobUrl; a.download = nombreArchivo; a.click()
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      alert(e.response?.data?.error || 'No se pudo exportar')
    }
  }

  const exportar = tipo => {
    const params = new URLSearchParams()
    if (tipo === 'filtrado') { if (buscar) params.set('buscar',buscar); if (filUbic) params.set('ubicacion',filUbic); if (filAlerta) params.set('alerta',filAlerta) }
    if (tipo === 'entradas') params.set('tipo_export','entradas')
    if (tipo === 'salidas')  params.set('tipo_export','salidas')
    descargarBlob(`/stock/exportar?${params}`, `stock_${hoy()}.xlsx`)
  }

  const exportarHistorial = () => {
    const params = new URLSearchParams()
    ;['tipo','desde','hasta','codigo','descripcion','proveedor','proyecto','cliente_interno','remito','substock']
      .forEach(k => { if (filtH[k]) params.set(k, filtH[k]) })
    descargarBlob(`/stock/exportar-historial?${params}`, `historial_${hoy()}.xlsx`)
  }

  /* ── Contadores barra estado (siempre del catálogo completo, ver arriba) ── */
  const { total, disponibles, stockBajo, agotados } = contadores
  const totalPags   = Math.ceil(totalMovs / 200)

  // Paginar solo la RENDERIZACIÓN: la lista completa ya llegó filtrada del
  // servidor (para los contadores de arriba), pero dibujar de una miles de
  // filas en el DOM es lo que hacía lento cada re-render.
  useEffect(() => { setPaginaProds(1) }, [prods])
  const totalPagsProds = Math.max(1, Math.ceil(prods.length / PRODS_POR_PAGINA))
  const prodsPagina = prods.slice((paginaProds - 1) * PRODS_POR_PAGINA, paginaProds * PRODS_POR_PAGINA)

  return (
    <>
      {/* ── Título ────────────────────────────────────────────────── */}
      <h5 className="fw-bold mb-3">Stock</h5>

      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        {canWrite && <>
          <button className="btn btn-sm btn-outline-primary" onClick={() => abrirEditarUbic(sel)} disabled={!sel}><i className="bi bi-geo-alt me-1"/>Editar ubicación</button>
          <div className="vr mx-1"/>
          <button className="btn btn-sm btn-outline-success" onClick={() => abrirMov('entrada')}   disabled={!sel}><i className="bi bi-arrow-up me-1"/>Entrada</button>
          <button className="btn btn-sm btn-outline-danger"  onClick={() => abrirMov('salida')}    disabled={!sel}><i className="bi bi-arrow-down me-1"/>Salida</button>
          <button className="btn btn-sm btn-outline-warning" onClick={() => abrirMov('devolucion')} disabled={!sel}><i className="bi bi-arrow-return-left me-1"/>Devolución</button>
          <div className="vr mx-1"/>
        </>}
        {esGerente && (
          <button className="btn btn-sm btn-outline-secondary" onClick={() => { setModalH(true); setPageH(1) }}>
            <i className="bi bi-clock-history me-1"/>Historial
          </button>
        )}
        {esGerente && (
          <button className="btn btn-sm btn-outline-secondary" onClick={() => { setModalProyLegado(true); setBuscarLegado(''); setSeleccionLegado(new Set()); setDestinoMasivo(''); cargarProyLegado() }}>
            <i className="bi bi-arrow-left-right me-1"/>Proyectos legado
          </button>
        )}
        {canWrite && (
          <button className={`btn btn-sm position-relative ${pendientesLotes.length > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
            onClick={() => { setModalPendientes(true); cargarPendientesLotes() }}>
            <i className="bi bi-upc-scan me-1"/>Partidas pendientes
            {pendientesLotes.length > 0 && (
              <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                style={{fontSize:'0.68rem'}}>{pendientesLotes.length}</span>
            )}
          </button>
        )}
        <button className={`btn btn-sm position-relative ${(ingPend.length + ingPendSinOC.length) > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
          onClick={() => setModalIngPend(true)}>
          <i className="bi bi-box-arrow-in-down me-1"/>Ingresos pendientes
          {(ingPend.length + ingPendSinOC.length) > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{fontSize:'0.68rem'}}>{ingPend.length + ingPendSinOC.length}</span>
          )}
        </button>
        <button className={`btn btn-sm position-relative ${pedidosPend.length > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
          onClick={() => setModalPedidos(true)}>
          <i className="bi bi-clipboard-check me-1"/>Pedidos de stock
          {pedidosPend.length > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{fontSize:'0.68rem'}}>{pedidosPend.length}</span>
          )}
        </button>
        {esGerente && (
          <div className="dropdown">
            <button className="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">
              <i className="bi bi-file-excel me-1"/>Exportar
            </button>
            <ul className="dropdown-menu">
              <li><button className="dropdown-item" onClick={() => exportar('filtrado')}>Stock filtrado</button></li>
              <li><button className="dropdown-item" onClick={() => exportar('completo')}>Stock completo</button></li>
            </ul>
          </div>
        )}
      </div>

      {/* ── Filtros ───────────────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-2 mb-2">
        <div className="position-relative">
          <input className="form-control form-control-sm" style={{width:260}} placeholder="Buscar…"
            value={buscar} onChange={e => setBuscar(e.target.value)} />
          {buscar && <button className="btn btn-sm position-absolute top-0 end-0 py-0 px-1 text-muted"
            onClick={() => setBuscar('')}><i className="bi bi-x"/></button>}
        </div>
        <select className="form-select form-select-sm" style={{width:160}} value={filUbic} onChange={e => setFilUbic(e.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {ubics.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <div className="btn-group btn-group-sm">
          {[['','Todos'],['ok','Disponibles'],['bajo','Stock bajo'],['agotado','Agotados']].map(([v,l]) => (
            <button key={v} className={`btn btn-outline-secondary ${filAlerta===v?'active':''}`}
              onClick={() => setFilAlerta(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── Tabla ─────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm">
        {!hayFiltro
          ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-search fs-3 d-block mb-2"/>
              Escribí para buscar, o elegí una ubicación / alerta de stock
            </div>
          )
          : loading
          ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
          : <div className="table-responsive" style={{maxHeight:'calc(100vh - 300px)', overflowY:'auto'}}>
              <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                <thead className="table-dark sticky-top">
                  <tr>
                    <th>CÓDIGO</th>
                    <th>DESCRIPCIÓN</th>
                    <th className="text-end">STOCK</th>
                    <th className="text-center">DISPONIB</th>
                    <th>UBICACIÓN</th>
                    <th className="text-end">MÍNIMO</th>
                  </tr>
                </thead>
                <tbody>
                  {prods.length === 0
                    ? <tr><td colSpan={6} className="text-center text-muted py-4">Sin resultados</td></tr>
                    : prodsPagina.map(p => {
                        const agot = p.stock_actual <= 0
                        const bajo = !agot && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
                        return (
                          <tr key={p.id}
                            className={selId===p.id ? 'table-primary' : ''}
                            style={{ cursor:'pointer', color: agot ? '#dc3545' : bajo ? '#d97706' : undefined }}
                            onClick={() => setSelId(p.id === selId ? null : p.id)}
                            onDoubleClick={() => canWrite && abrirEditarUbic(p)}>
                            <td className="fw-semibold">
                              {p.codigo}
                              {p.codigo_proveedor && <div className="text-muted fw-normal" style={{fontSize:'0.74rem'}}>{p.codigo_proveedor}</div>}
                            </td>
                            <td>
                              <div>
                                {p.descripcion}
                                {p.trazabilidad_stock !== 'ninguna' && (
                                  <button type="button" className="btn btn-link btn-sm p-0 ms-1 align-baseline"
                                    title={p.trazabilidad_stock === 'serie' ? 'Ver números de serie' : 'Ver partidas / lotes'}
                                    onClick={e => { e.stopPropagation(); verLotes(p) }}>
                                    <i className={p.trazabilidad_stock === 'serie' ? 'bi bi-qr-code' : 'bi bi-upc-scan'}/>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="text-end fw-semibold">
                              {fmt(p.stock_actual)}
                              {(p.substock_produccion > 0 || p.substock_calidad > 0 || p.substock_electrico > 0) && (
                                <div className="text-muted fw-normal" style={{fontSize:'0.68rem'}}
                                  title="Material ya afectado a un substock (Producción/Calidad/Eléctrico) — no está disponible para retirar del depósito, pero sigue en la empresa">
                                  {p.substock_produccion > 0 && <>+{fmt(p.substock_produccion)} Prod.</>}
                                  {p.substock_produccion > 0 && (p.substock_calidad > 0 || p.substock_electrico > 0) && ' · '}
                                  {p.substock_calidad > 0 && <>+{fmt(p.substock_calidad)} Cal.</>}
                                  {p.substock_calidad > 0 && p.substock_electrico > 0 && ' · '}
                                  {p.substock_electrico > 0 && <>+{fmt(p.substock_electrico)} Eléc.</>}
                                </div>
                              )}
                            </td>
                            <td className="text-center">{agot ? '✗' : '✓'}</td>
                            <td>{p.ubicacion || ''}</td>
                            <td className="text-end text-muted">{p.stock_minimo > 0 ? fmt(p.stock_minimo) : 0}</td>
                          </tr>
                        )
                      })
                  }
                </tbody>
              </table>
            </div>
        }
        {totalPagsProds > 1 && (
          <div className="border-top px-3 py-1 d-flex align-items-center justify-content-center gap-2" style={{fontSize:'0.78rem'}}>
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" disabled={paginaProds <= 1}
              onClick={() => setPaginaProds(p => p - 1)}>‹ Anterior</button>
            <span className="text-muted">Página {paginaProds} de {totalPagsProds}</span>
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" disabled={paginaProds >= totalPagsProds}
              onClick={() => setPaginaProds(p => p + 1)}>Siguiente ›</button>
          </div>
        )}
        {/* Barra estado */}
        <div className="border-top px-3 py-1 d-flex gap-3 text-muted" style={{fontSize:'0.78rem', background:'#f8f9fa'}}>
          <span>Total: <strong>{total}</strong></span>
          <span className="text-success">✓ Disponibles: <strong>{disponibles}</strong></span>
          <span className="text-warning">⚠ Stock bajo: <strong>{stockBajo}</strong></span>
          <span className="text-danger">✗ Agotados: <strong>{agotados}</strong></span>
          {sel && <span className="ms-auto text-primary">Seleccionado: <strong>{sel.codigo}</strong> — {sel.descripcion}</span>}
        </div>
      </div>

      {/* ══ MODAL: HISTORIAL ════════════════════════════════════════ */}
      {modalH && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">Historial de Movimientos</h5>
                <button className="btn-close" onClick={() => setModalH(false)}/>
              </div>
              <div className="modal-body p-0">
                {/* Filtros historial */}
                <div className="border-bottom p-2 bg-light d-flex flex-wrap gap-2 align-items-end">
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Desde</label>
                    <DateInput className="form-control form-control-sm" style={{width:130}}
                      value={filtH.desde} onChange={v => { setFiltH(p=>({...p,desde:v})); setPageH(1) }}/>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Hasta</label>
                    <DateInput className="form-control form-control-sm" style={{width:130}}
                      value={filtH.hasta} onChange={v => { setFiltH(p=>({...p,hasta:v})); setPageH(1) }}/>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Tipo</label>
                    <select className="form-select form-select-sm" style={{width:120}}
                      value={filtH.tipo} onChange={e => { setFiltH(p=>({...p,tipo:e.target.value})); setPageH(1) }}>
                      <option value="">Todos</option>
                      {TIPOS.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                  <div className="vr mx-1"/>
                  {/* Cada campo filtra por separado — se pueden combinar varios a la vez */}
                  {[
                    { k:'codigo',          l:'Código',       w:110 },
                    { k:'descripcion',     l:'Descripción',  w:150 },
                    { k:'proveedor',       l:'Proveedor',    w:140 },
                    { k:'proyecto',        l:'Proyecto',     w:120 },
                    { k:'cliente_interno', l:'Cliente Int.', w:120 },
                    { k:'remito',          l:'Remito',       w:110 },
                  ].map(c => (
                    <div key={c.k}>
                      <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>{c.l}</label>
                      <input className="form-control form-control-sm" style={{width:c.w}} placeholder="Buscar…"
                        list={`hist-valores-${c.k}`}
                        value={filtH[c.k]} onChange={e => { setFiltH(p=>({...p,[c.k]:e.target.value})); setPageH(1) }}/>
                      <datalist id={`hist-valores-${c.k}`}>
                        {(valoresH[c.k]||[]).map(v => <option key={v} value={v}/>)}
                      </datalist>
                    </div>
                  ))}
                  <div className="vr mx-1"/>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Substock</label>
                    <select className="form-select form-select-sm" style={{width:130}}
                      value={filtH.substock} onChange={e => { setFiltH(p=>({...p,substock:e.target.value})); setPageH(1) }}>
                      <option value="">Todos</option>
                      <option value="ninguno">Sin substock</option>
                      {SUBSTOCKS.map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => { setFiltH(FORM_H); setPageH(1) }}>Limpiar</button>
                </div>

                {/* Tabla historial */}
                {loadH
                  ? <div className="text-center py-4"><div className="spinner-border text-secondary"/></div>
                  : <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.8rem'}}>
                        <thead className="table-light">
                          <tr>
                            <th>FECHA</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>TIPO</th>
                            <th className="text-end">CANT.</th><th>PROVEEDOR</th>
                            <th className="text-end">PRECIO U.</th><th>PROYECTO</th>
                            <th>CLIENTE INT.</th><th>REMITO</th><th>SUBSTOCK</th><th>AUTORIZÓ</th><th>OBS.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movs.length === 0
                            ? <tr><td colSpan={13} className="text-center text-muted py-3">Sin resultados</td></tr>
                            : movs.map(m => (
                              <tr key={m.id}
                                style={{color: m.tipo==='salida'?'#dc3545': m.tipo==='entrada'?'#198754':undefined, cursor: esAdmin?'pointer':undefined}}
                                title={esAdmin ? 'Doble click para editar' : undefined}
                                onDoubleClick={() => abrirEditarMov(m)}>
                                <td className="text-nowrap">{fmtF(m.fecha)}</td>
                                <td className="fw-semibold">{m.codigo}</td>
                                <td><div className="text-truncate" style={{maxWidth:200}} title={m.descripcion}>{m.descripcion}</div></td>
                                <td><span className={`badge bg-${TIPOS.find(t=>t.v===m.tipo)?.c??'secondary'}`}>{m.tipo}</span></td>
                                <td className="text-end fw-semibold">{fmt(m.cantidad)}</td>
                                <td className="text-muted">{m.proveedor||'—'}</td>
                                <td className="text-end">{esMontoOculto(m.precio_unit) ? fmt(m.precio_unit) : (m.precio_unit > 0 ? fmt(m.precio_unit) : '—')}</td>
                                <td className="text-muted">{m.proyecto||'—'}</td>
                                <td className="text-muted">{m.cliente_interno||'—'}</td>
                                <td className="text-muted">{m.remito||'—'}</td>
                                <td>
                                  {m.substock_destino
                                    ? <span className="badge bg-info-subtle text-info-emphasis border" style={{fontSize:'0.68rem'}} title={`Traspaso hacia el substock de ${m.substock_destino}`}>→ {m.substock_destino}</span>
                                    : m.substock_origen
                                    ? <span className="badge bg-warning-subtle text-warning-emphasis border" style={{fontSize:'0.68rem'}} title={`Movimiento desde el substock de ${m.substock_origen}`}>← {m.substock_origen}</span>
                                    : '—'}
                                </td>
                                <td className="text-muted">{m.autorizado_por_nombre||'—'}</td>
                                <td><div className="text-truncate" style={{maxWidth:150}} title={m.observaciones}>{m.observaciones||'—'}</div></td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                }
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <div className="d-flex align-items-center gap-3">
                  <small className="text-muted">Mostrando {movs.length} de {totalMovs} movimientos</small>
                  {totalPags > 1 && (
                    <div className="d-flex gap-1">
                      <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageH===1} onClick={()=>setPageH(p=>p-1)}>‹</button>
                      <span className="btn btn-xs btn-light py-0 px-2 disabled">{pageH}/{totalPags}</span>
                      <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageH>=totalPags} onClick={()=>setPageH(p=>p+1)}>›</button>
                    </div>
                  )}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-outline-success" onClick={exportarHistorial}>
                    <i className="bi bi-file-excel me-1"/>Exportar filtrado
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setModalH(false)}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: EDITAR UBICACIÓN ══════════════════════════════════ */}
      {modalUbic && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-sm">
            <form className="modal-content" onSubmit={guardarUbic}>
              <div className="modal-header py-2">
                <h6 className="modal-title">Editar ubicación</h6>
                <button type="button" className="btn-close" onClick={() => setModalUbic(null)}/>
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-2">
                  <strong>{modalUbic.codigo}</strong> — {modalUbic.descripcion}
                </p>
                <input className="form-control" autoFocus
                  placeholder="Ej: Estante A3"
                  list="ubics-stock-list"
                  value={ubicVal}
                  onChange={e => setUbicVal(e.target.value)} />
                <datalist id="ubics-stock-list">
                  {ubics.map(u => <option key={u} value={u}/>)}
                </datalist>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalUbic(null)}>Cancelar</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={savUbic}>
                  {savUbic && <span className="spinner-border spinner-border-sm me-1"/>}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: PARTIDAS / LOTES DE UN MATERIAL ═══════════════════════ */}
      {modalLotes && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  {modalLotes.producto.trazabilidad_stock === 'serie' ? 'Números de serie' : 'Partidas'} de{' '}
                  <strong>{modalLotes.producto.codigo}</strong> — {modalLotes.producto.descripcion}
                </h6>
                <button type="button" className="btn-close" onClick={() => setModalLotes(null)}/>
              </div>
              <div className="modal-body">
                {modalLotes.lotes === null ? (
                  <div className="text-center py-4"><span className="spinner-border spinner-border-sm text-secondary"/></div>
                ) : modalLotes.lotes.length === 0 ? (
                  <div className="text-center text-muted py-3">
                    Todavía no hay {modalLotes.producto.trazabilidad_stock === 'serie' ? 'ningún número de serie' : 'ninguna partida'} cargada para este material.
                  </div>
                ) : (
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>{modalLotes.producto.trazabilidad_stock === 'serie' ? 'N° de Serie' : 'Partida'}</th>
                        <th className="text-end">Disponible</th>
                        <th>Ingresó</th>
                        <th>Proveedor</th>
                        <th>Referencia</th>
                        <th>Remito</th>
                        {canWrite && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {modalLotes.lotes.flatMap(l => [
                        <tr key={l.id} className={l.cantidad_actual <= 0.0001 ? 'text-muted' : ''}>
                          <td>{l.partida || <span className="fst-italic">(sin dato)</span>}</td>
                          <td className="text-end fw-semibold">{fmt(l.cantidad_actual)}</td>
                          <td>{fmtF(l.fecha_ingreso)}</td>
                          <td>{l.proveedor || '—'}</td>
                          <td className="text-muted small">{l.referencia || '—'}</td>
                          <td className="text-muted small">{l.remito || '—'}</td>
                          {canWrite && (
                            <td className="text-end">
                              {/* Solo tiene sentido "asignar" en la fila genérica sin partida/serie
                                  todavía (stock legado, de antes de activar la trazabilidad) — una
                                  fila que ya tiene su propia serie/partida no necesita otra. */}
                              {!l.partida && l.cantidad_actual > 0.0001 && asignando?.loteId !== l.id && (
                                <button type="button" className="btn btn-sm btn-outline-primary py-0 px-2" style={{fontSize:'0.72rem'}}
                                  onClick={() => { setErrAsignar(''); setAsignando({ productoId: modalLotes.producto.id, loteId: l.id, cantidad: modalLotes.producto.trazabilidad_stock === 'serie' ? 1 : l.cantidad_actual, partidaNueva: '' }) }}>
                                  Asignar {modalLotes.producto.trazabilidad_stock === 'serie' ? 'serie' : 'partida'}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>,
                        asignando?.loteId === l.id && (
                          <tr key={`${l.id}-asignar`}>
                            <td colSpan={canWrite ? 7 : 6} className="bg-light">
                              <div className="d-flex align-items-center flex-wrap gap-2 py-1">
                                <span className="small text-muted">Mover</span>
                                <input type="number" className="form-control form-control-sm" style={{width:90}}
                                  min="0.001" max={l.cantidad_actual} step="any"
                                  disabled={modalLotes.producto.trazabilidad_stock === 'serie'}
                                  value={asignando.cantidad}
                                  onChange={e => setAsignando(a => ({...a, cantidad: e.target.value}))} />
                                <span className="small text-muted">a la {modalLotes.producto.trazabilidad_stock === 'serie' ? 'serie' : 'partida'}</span>
                                <input className="form-control form-control-sm" style={{width:180}}
                                  placeholder={modalLotes.producto.trazabilidad_stock === 'serie' ? 'Nuevo N° de serie' : 'Nueva partida'}
                                  value={asignando.partidaNueva} autoFocus
                                  onChange={e => setAsignando(a => ({...a, partidaNueva: e.target.value}))} />
                                <button type="button" className="btn btn-sm btn-primary" disabled={savAsignar || !asignando.partidaNueva?.trim()}
                                  onClick={guardarReasignacion}>
                                  {savAsignar ? <span className="spinner-border spinner-border-sm"/> : 'Guardar'}
                                </button>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setAsignando(null); setErrAsignar('') }}>
                                  Cancelar
                                </button>
                              </div>
                              {errAsignar && <div className="text-danger small mt-1">{errAsignar}</div>}
                            </td>
                          </tr>
                        ),
                      ])}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setModalLotes(null); setAsignando(null) }}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: PARTIDAS/SERIES PENDIENTES (todos los materiales) ═════ */}
      {modalPendientes && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h5 className="modal-title mb-0">Partidas / series pendientes de asignar</h5>
                  <small className="text-muted">Stock sin partida ni número de serie, de materiales que ahora los requieren</small>
                </div>
                <button className="btn-close" onClick={() => { setModalPendientes(false); setAsignando(null) }}/>
              </div>
              <div className="modal-body p-0">
                {pendientesLotes.length === 0 ? (
                  <div className="alert alert-success m-3 mb-0">
                    <i className="bi bi-check-circle me-2"/>No queda stock sin partida o número de serie por asignar.
                  </div>
                ) : (
                  <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                    <thead className="table-dark sticky-top">
                      <tr>
                        <th>Código</th><th>Descripción</th><th>Tipo</th>
                        <th className="text-end">Cantidad</th><th>Ingresó</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendientesLotes.flatMap(l => [
                        <tr key={l.id}>
                          <td><code style={{fontSize:'0.78rem'}}>{l.codigo}</code></td>
                          <td>{l.descripcion}</td>
                          <td>
                            <span className={`badge ${l.trazabilidad_stock === 'serie' ? 'bg-info text-dark' : 'bg-light text-dark border'}`}>
                              {l.trazabilidad_stock === 'serie' ? 'Serie' : 'Partida'}
                            </span>
                          </td>
                          <td className="text-end fw-semibold">{fmt(l.cantidad_actual)} {l.unidad}</td>
                          <td>{fmtF(l.fecha_ingreso)}</td>
                          <td className="text-end">
                            {canWrite && asignando?.loteId !== l.id && (
                              <button type="button" className="btn btn-sm btn-outline-primary py-0 px-2" style={{fontSize:'0.72rem'}}
                                onClick={() => { setErrAsignar(''); setAsignando({ productoId: l.producto_id, loteId: l.id, cantidad: l.trazabilidad_stock === 'serie' ? 1 : l.cantidad_actual, partidaNueva: '' }) }}>
                                Asignar {l.trazabilidad_stock === 'serie' ? 'serie' : 'partida'}
                              </button>
                            )}
                          </td>
                        </tr>,
                        asignando?.loteId === l.id && (
                          <tr key={`${l.id}-asignar`}>
                            <td colSpan={6} className="bg-light">
                              <div className="d-flex align-items-center flex-wrap gap-2 py-1">
                                <span className="small text-muted">Mover</span>
                                <input type="number" className="form-control form-control-sm" style={{width:90}}
                                  min="0.001" max={l.cantidad_actual} step="any"
                                  disabled={l.trazabilidad_stock === 'serie'}
                                  value={asignando.cantidad}
                                  onChange={e => setAsignando(a => ({...a, cantidad: e.target.value}))} />
                                <span className="small text-muted">a la {l.trazabilidad_stock === 'serie' ? 'serie' : 'partida'}</span>
                                <input className="form-control form-control-sm" style={{width:180}}
                                  placeholder={l.trazabilidad_stock === 'serie' ? 'Nuevo N° de serie' : 'Nueva partida'}
                                  value={asignando.partidaNueva} autoFocus
                                  onChange={e => setAsignando(a => ({...a, partidaNueva: e.target.value}))} />
                                <button type="button" className="btn btn-sm btn-primary" disabled={savAsignar || !asignando.partidaNueva?.trim()}
                                  onClick={guardarReasignacion}>
                                  {savAsignar ? <span className="spinner-border spinner-border-sm"/> : 'Guardar'}
                                </button>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setAsignando(null); setErrAsignar('') }}>
                                  Cancelar
                                </button>
                              </div>
                              {errAsignar && <div className="text-danger small mt-1">{errAsignar}</div>}
                            </td>
                          </tr>
                        ),
                      ])}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-outline-secondary btn-sm" onClick={cargarPendientesLotes}>
                  <i className="bi bi-arrow-clockwise me-1"/>Actualizar
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setModalPendientes(false); setAsignando(null) }}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: MOVIMIENTO ═══════════════════════════════════════ */}
      {modalM && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={guardarM}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {editandoMovId ? 'Editar movimiento' : `Registrar ${TIPOS.find(t=>t.v===formM.tipo)?.l}`}
                </h5>
                <button type="button" className="btn-close" onClick={cerrarModalM}/>
              </div>
              <div className="modal-body">
                {errM && <div className="alert alert-danger py-2 small">{errM}</div>}
                <div className="row g-3">
                  {/* Tipo */}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Tipo *</label>
                    <select className="form-select" value={formM.tipo} onChange={e=>setFormM(p=>({...p,tipo:e.target.value}))}>
                      {TIPOS.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Cantidad *</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control" value={formM.cantidad} required min="0.001" step="any" onChange={e=>setFormM(p=>({...p,cantidad:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <DateInput className="form-control" value={formM.fecha} required onChange={v=>setFormM(p=>({...p,fecha:v}))}/>
                  </div>
                  {/* Búsqueda producto */}
                  <div className="col-12 position-relative">
                    <label className="form-label small fw-medium">Producto *</label>
                    <input className="form-control" placeholder="Buscar por código o descripción…"
                      value={buscarP} onChange={e=>{setBuscarP(e.target.value); setFormM(p=>({...p,producto_id:'',partida:'',lote_id:''})); setProdProveedorCatalogo(''); setProdTrazabilidad('ninguna'); setLoteEditActual(null)}}/>
                    {sugs.length > 0 && (
                      <div className="border rounded shadow-sm position-absolute w-100 bg-white" style={{zIndex:9999,top:'100%',maxHeight:220,overflowY:'auto'}}>
                        {sugs.map(p=>(
                          <div key={p.id} className="px-3 py-2 border-bottom d-flex justify-content-between"
                            style={{cursor:'pointer',fontSize:'0.84rem'}}
                            onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                            onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                            onClick={()=>{setFormM(prev=>({...prev,producto_id:p.id,partida:'',lote_id:''})); setBuscarP(`${p.codigo} — ${p.descripcion}`); setProdProveedorCatalogo(p.proveedor || ''); setProdTrazabilidad(p.trazabilidad_stock || 'ninguna'); setLoteEditActual(null); setSugs([])}}>
                            <span><strong>{p.codigo}</strong> — {p.descripcion}
                              {p.trazabilidad_stock === 'partida' && <i className="bi bi-upc-scan ms-1 text-muted" title="Requiere partida"/>}
                              {p.trazabilidad_stock === 'serie' && <i className="bi bi-qr-code ms-1 text-muted" title="Requiere número de serie"/>}
                            </span>
                            <span className={`badge ${p.stock_actual>0?'bg-success':'bg-danger'}`}>Stock: {fmt(p.stock_actual)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Partida / serie — solo si el producto elegido requiere trazabilidad */}
                  {prodTrazabilidad !== 'ninguna' && (formM.tipo === 'entrada' || formM.tipo === 'ajuste') && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">{prodTrazabilidad === 'serie' ? 'N° de Serie *' : 'Partida *'}</label>
                      <input className="form-control" placeholder={prodTrazabilidad === 'serie' ? 'Ej: SN-2026-0001' : 'Ej: LOTE-2026-08'}
                        value={formM.partida} onChange={e=>setFormM(p=>({...p,partida:e.target.value}))}/>
                      <div className="form-text">
                        {prodTrazabilidad === 'serie'
                          ? 'Este material requiere número de serie — una unidad por ingreso'
                          : 'Este material requiere partida para trazabilidad'}
                      </div>
                    </div>
                  )}
                  {/* Devolución de un material con trazabilidad: se elige de la lista de
                      lo que está afuera (dado de salida) en vez de retipear el número de
                      serie/partida a mano — si ya se eligió Cliente interno, se filtra a
                      lo entregado a esa persona. */}
                  {prodTrazabilidad !== 'ninguna' && formM.tipo === 'devolucion' && (() => {
                    const opciones = formM.cliente_interno
                      ? lotesAfuera.filter(l => l.cliente_interno === formM.cliente_interno)
                      : lotesAfuera
                    return (
                      <div className="col-md-4">
                        <label className="form-label small fw-medium">
                          {prodTrazabilidad === 'serie' ? 'Qué número de serie se devuelve *' : 'Qué partida se devuelve *'}
                        </label>
                        <select className="form-select" value={formM.partida}
                          onChange={e => {
                            const l = lotesAfuera.find(x => x.partida === e.target.value)
                            setFormM(p => ({...p, partida: e.target.value, cliente_interno: p.cliente_interno || l?.cliente_interno || ''}))
                          }}>
                          <option value="">{prodTrazabilidad === 'serie' ? '— Elegir serie —' : '— Elegir partida —'}</option>
                          {opciones.map(l => (
                            <option key={l.id} value={l.partida}>
                              {l.partida}{l.cliente_interno ? ` — ${l.cliente_interno}` : ''}{l.proyecto ? ` (${l.proyecto})` : ''}{l.fecha_salida ? ` · salió ${fmtF(l.fecha_salida)}` : ''}
                            </option>
                          ))}
                        </select>
                        <div className="form-text">
                          {formM.cliente_interno && opciones.length === 0
                            ? 'No hay nada afuera a nombre de ese cliente interno — probá sin filtrar, o revisá quién lo tiene'
                            : 'Solo se listan las que están afuera (dadas de salida) sin volver todavía'}
                        </div>
                      </div>
                    )
                  })()}
                  {prodTrazabilidad !== 'ninguna' && formM.tipo === 'salida' && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">
                        {prodTrazabilidad === 'serie' ? 'De qué número de serie sale *' : 'De qué partida sale *'}
                      </label>
                      <select className="form-select" value={formM.lote_id}
                        onChange={e=>setFormM(p=>({...p,lote_id:e.target.value}))}>
                        <option value="">{prodTrazabilidad === 'serie' ? '— Elegir serie —' : '— Elegir partida —'}</option>
                        {lotesDisponibles.map(l => (
                          <option key={l.id} value={l.id}>
                            {prodTrazabilidad === 'serie'
                              ? etiquetaLote(l, true)
                              : `${etiquetaLote(l, false)}${l.fecha_ingreso ? ` — ingresó ${fmtF(l.fecha_ingreso)}` : ''}`}
                          </option>
                        ))}
                        {loteEditActual && !lotesDisponibles.some(l => l.id === loteEditActual.id) && (
                          <option value={loteEditActual.id}>{loteEditActual.partida || '(sin dato)'} — (sin más saldo, ya asignada a este movimiento)</option>
                        )}
                      </select>
                      <div className="form-text">
                        {prodTrazabilidad === 'serie'
                          ? 'Este material requiere elegir de qué número de serie sale'
                          : 'Este material requiere elegir de qué partida sale'}
                      </div>
                    </div>
                  )}
                  {/* Campos extras */}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Proveedor{formM.tipo === 'entrada' ? ' *' : ''}</label>
                    {formM.tipo === 'salida' ? (
                      <>
                        <input className="form-control" disabled value={prodProveedorCatalogo || '— Sin proveedor registrado en el material —'} />
                        <div className="form-text">Proveedor del material según su ficha — no aplica elegir uno en una salida</div>
                      </>
                    ) : (
                      <select className="form-select" value={formM.proveedor} onChange={e=>setFormM(p=>({...p,proveedor:e.target.value}))}>
                        <option value="">{formM.tipo === 'entrada' ? '— Elegí un proveedor —' : '— Sin proveedor —'}</option>
                        {provsList.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                      </select>
                    )}
                    {formM.tipo === 'entrada' && (
                      <div className="form-text">Si es material fabricado por E-INTRA, elegí "E-INTRA SRL"</div>
                    )}
                  </div>
                  {formM.tipo === 'entrada' && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Remito</label>
                      <input className="form-control" placeholder="N° de remito de esta entrega"
                        value={formM.remito} onChange={e=>setFormM(p=>({...p,remito:e.target.value}))}/>
                      <div className="form-text">Si la OC se recibe en varias entregas, cada una puede tener su propio remito</div>
                    </div>
                  )}
                  {formM.tipo === 'salida' && (
                    <div className="col-12">
                      <label className="form-label small fw-medium d-block">Destino</label>
                      <div className="btn-group btn-group-sm" role="group">
                        <button type="button" className={`btn ${!formM.substock_destino ? 'btn-primary' : 'btn-outline-primary'}`}
                          onClick={() => setFormM(p => ({...p, substock_destino: ''}))}>
                          <i className="bi bi-person me-1"/>Persona
                        </button>
                        <button type="button" className={`btn ${formM.substock_destino ? 'btn-primary' : 'btn-outline-primary'}`}
                          onClick={() => setFormM(p => ({...p, substock_destino: p.substock_destino || 'calidad', proyecto: '', cliente_interno: '', autorizado_por_id: ''}))}>
                          <i className="bi bi-box-seam me-1"/>Substock
                        </button>
                      </div>
                    </div>
                  )}
                  {formM.tipo === 'salida' && formM.substock_destino && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Substock destino *</label>
                      <select className="form-select" value={formM.substock_destino}
                        onChange={e => setFormM(p => ({...p, substock_destino: e.target.value}))}>
                        {SUBSTOCKS.map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                      <div className="form-text">Traspaso interno — el substock lo entrega después a la persona y proyecto correspondiente</div>
                    </div>
                  )}
                  {!formM.substock_destino && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Proyecto o Actividad{formM.tipo === 'salida' ? ' *' : ''}</label>
                      <select className="form-select" value={formM.proyecto} onChange={e=>setFormM(p=>({...p,proyecto:e.target.value}))}>
                        <option value="">{formM.tipo === 'salida' ? '— Elegir —' : '— Sin asignar —'}</option>
                        {proyActivos.length > 0 && (
                          <optgroup label="Proyectos">
                            {proyActivos.map(p=>(
                              <option key={`p-${p.id}`} value={p.codigo}>{fmtCod(p.codigo)} — {p.nombre}</option>
                            ))}
                          </optgroup>
                        )}
                        {actividadesActivas.length > 0 && (
                          <optgroup label="Actividades">
                            {actividadesActivas.map(a=>(
                              <option key={`a-${a.id}`} value={a.nombre}>{a.nombre}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  )}
                  {!formM.substock_destino && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Cliente interno</label>
                      <EmpleadoSelect
                        value={formM.cliente_interno}
                        onChange={v => setFormM(p => ({...p, cliente_interno: v}))}
                        placeholder="— Sin asignar —"
                      />
                    </div>
                  )}
                  {formM.tipo === 'salida' && !formM.substock_destino && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Autorizado por *</label>
                      <select className="form-select" value={formM.autorizado_por_id}
                        onChange={e => setFormM(p => ({...p, autorizado_por_id: e.target.value}))}>
                        <option value="">— Elegir —</option>
                        {autorizantes.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                      <div className="form-text">Le llega una notificación con lo retirado</div>
                    </div>
                  )}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Precio unitario</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control" value={formM.precio_unit} min="0" step="any" onChange={e=>setFormM(p=>({...p,precio_unit:parseFloat(e.target.value)||0}))}/>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formM.observaciones} onChange={e=>setFormM(p=>({...p,observaciones:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={cerrarModalM}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savM || !formM.producto_id || (formM.tipo === 'salida' && !formM.substock_destino && !formM.autorizado_por_id) || (formM.tipo === 'salida' && !formM.substock_destino && !formM.proyecto?.trim()) || (formM.tipo === 'entrada' && !formM.proveedor) || (prodTrazabilidad !== 'ninguna' && formM.tipo !== 'salida' && !formM.partida?.trim()) || (prodTrazabilidad !== 'ninguna' && formM.tipo === 'salida' && !formM.lote_id) || (prodTrazabilidad === 'serie' && formM.tipo !== 'salida' && Number(formM.cantidad) !== 1)}>
                  {savM && <span className="spinner-border spinner-border-sm me-2"/>}{editandoMovId ? 'Guardar cambios' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: INGRESOS PENDIENTES ═══════════════════════════════════ */}
      {modalIngPend && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-in-down me-2"/>
                  Ingresos pendientes de confirmación
                  {ingPend.length > 0 && <span className="badge bg-warning text-dark ms-2">{ingPend.length}</span>}
                </h5>
                <button className="btn-close" onClick={()=>setModalIngPend(false)}/>
              </div>
              <div className="modal-body p-0">
                {ingPend.length === 0 && ingPendSinOC.length === 0
                  ? <p className="text-center text-muted py-5">No hay materiales pendientes de ingreso.</p>
                  : <>
                    {/* ── Desde OC ── */}
                    {ingPend.length > 0 && <>
                      <div className="px-3 py-2 bg-light border-bottom small fw-semibold text-secondary">
                        <i className="bi bi-cart me-1"/>Desde Órdenes de Compra ({ingPend.length})
                      </div>
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-dark sticky-top">
                          <tr>
                            <th>OC N°</th><th>PROVEEDOR</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th>
                            <th className="text-end">CANTIDAD</th><th>UNIDAD</th>
                            <th>REMITO</th><th>FECHA RECEP.</th><th>STOCK ACTUAL</th>
                            <th>CANT. A STOCK</th><th>PARTIDA</th><th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingPend.map(row => {
                            const partidaFalta = row.trazabilidad_stock !== 'ninguna' && !partidaPorIngreso[row.id]?.trim()
                            const esSerie = row.trazabilidad_stock === 'serie'
                            // El material se compra en una unidad distinta a la de stock (ej.
                            // chapas: OC en kg, depósito por unidad). Si al armar/recibir la OC
                            // ya se cargó la equivalencia en unidades, se precarga acá — si no,
                            // hay que cargarla a mano.
                            const distintaUnidad = !!row.unidad_compra?.trim() && row.unidad_compra.trim() !== (row.producto_unidad||'').trim()
                            const cantStockValor = (cantStockPorIngreso[row.id] !== undefined && cantStockPorIngreso[row.id] !== '')
                              ? cantStockPorIngreso[row.id] : (row.cantidad_unidades != null ? row.cantidad_unidades : '')
                            return (
                            <tr key={row.id}>
                              <td className="fw-semibold">{row.oc_numero}</td>
                              <td className="text-truncate" style={{maxWidth:140}} title={row.proveedor_nombre}>{row.proveedor_nombre}</td>
                              <td><code style={{fontSize:'0.78rem'}}>{row.producto_codigo}</code></td>
                              <td className="text-truncate" style={{maxWidth:220}} title={row.producto_desc}>{row.producto_desc}</td>
                              <td className="text-end fw-semibold">{fmt(row.cantidad)}</td>
                              <td>{row.unidad}</td>
                              <td>{row.numero_remito || <span className="text-muted">—</span>}</td>
                              <td>{fmtF(row.fecha_recepcion)}</td>
                              <td className="text-end">{fmt(row.stock_actual)}</td>
                              <td style={{minWidth:110}}>
                                {distintaUnidad ? (
                                  <input className="form-control form-control-sm" type="number" onPaste={manejarPegadoNumero}
                                    placeholder={`${row.cantidad} ${row.producto_unidad||''}?`}
                                    title={`La OC está en ${row.unidad} — cargá cuánto entró realmente en ${row.producto_unidad||'la unidad de stock'}`}
                                    value={cantStockValor}
                                    onChange={e => setCantStockPorIngreso(p => ({...p, [row.id]: e.target.value}))} />
                                ) : <span className="text-muted">—</span>}
                              </td>
                              <td style={{minWidth:130}}>
                                {row.trazabilidad_stock !== 'ninguna' ? (
                                  <input className="form-control form-control-sm" placeholder={esSerie ? 'N° de Serie *' : 'Partida *'}
                                    value={partidaPorIngreso[row.id] || ''}
                                    onChange={e => setPartidaPorIngreso(p => ({...p, [row.id]: e.target.value}))} />
                                ) : <span className="text-muted">—</span>}
                              </td>
                              <td className="text-end" style={{whiteSpace:'nowrap'}}>
                                {canWrite && (
                                  <button className="btn btn-sm btn-success me-1"
                                    disabled={savIng === row.id || partidaFalta || (distintaUnidad && !(parseFloat(cantStockValor) > 0))}
                                    title={partidaFalta ? (esSerie ? 'Este material requiere número de serie' : 'Este material requiere partida')
                                      : (distintaUnidad && !(parseFloat(cantStockValor) > 0)) ? 'Cargá cuánto entró realmente en la unidad de stock' : ''}
                                    onClick={() => confirmarIngreso(row.id)}>
                                    {savIng === row.id ? <span className="spinner-border spinner-border-sm"/> : <><i className="bi bi-check-lg me-1"/>Confirmar</>}
                                  </button>
                                )}
                                {canWrite && (
                                  <button className="btn btn-sm btn-outline-danger" disabled={savIng === row.id}
                                    onClick={() => rechazarIngreso(row.id, row.producto_desc)}>
                                    <i className="bi bi-x-lg"/>
                                  </button>
                                )}
                              </td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </>}

                    {/* ── Sin OC ── */}
                    {ingPendSinOC.length > 0 && <>
                      <div className="px-3 py-2 bg-light border-bottom border-top small fw-semibold text-secondary mt-2">
                        <i className="bi bi-box-arrow-in-down me-1"/>Sin Orden de Compra ({ingPendSinOC.length})
                      </div>
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-dark sticky-top">
                          <tr>
                            <th>N° Ingreso</th><th>PROVEEDOR</th><th>DESCRIPCIÓN</th>
                            <th className="text-end">CANTIDAD</th><th>UNIDAD</th>
                            <th>PRODUCTO CATÁLOGO</th><th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingPendSinOC.map(row => {
                            const isConfirming = confirmSinOC?.id === row.id
                            // trazabilidad del producto que quedaría vinculado: la del recién elegido
                            // en el autocompletar (si tiene el dato) o, si no se tocó, la ya vinculada.
                            const trazabilidadEfectiva = isConfirming
                              ? (confirmSinOC.prodSel?.trazabilidad_stock ?? row.trazabilidad_stock)
                              : row.trazabilidad_stock
                            const esSerieSinOC = trazabilidadEfectiva === 'serie'
                            const partidaFalta = isConfirming && trazabilidadEfectiva !== 'ninguna' && !partidaPorIngreso[row.id]?.trim()
                            // Mismo criterio que en la tabla "Desde OC": el producto elegido
                            // (recién seleccionado, o ya vinculado) puede comprarse en una
                            // unidad distinta a la de stock.
                            const unidadCompraEfectiva = isConfirming ? (confirmSinOC.prodSel?.unidad_compra ?? row.unidad_compra) : row.unidad_compra
                            const unidadStockEfectiva = isConfirming ? (confirmSinOC.prodSel?.unidad ?? row.producto_unidad) : row.producto_unidad
                            const distintaUnidadSinOC = !!unidadCompraEfectiva?.trim() && unidadCompraEfectiva.trim() !== (unidadStockEfectiva||'').trim()
                            const cantStockFalta = isConfirming && distintaUnidadSinOC && !(parseFloat(cantStockPorIngreso[row.id]) > 0)
                            return (
                              <tr key={row.id} style={isConfirming ? {background:'#f0f7ff'} : {}}>
                                <td className="fw-semibold">{row.form49_numero}</td>
                                <td className="text-truncate" style={{maxWidth:140}} title={row.proveedor_nombre}>{row.proveedor_nombre}</td>
                                <td>
                                  <div>{row.descripcion}</div>
                                  {row.n_parte && <div className="text-muted" style={{fontSize:'0.75rem'}}>P/N: {row.n_parte}</div>}
                                </td>
                                <td className="text-end fw-semibold">{fmt(row.cantidad)}</td>
                                <td>{row.unidad}</td>
                                <td style={{minWidth:200}}>
                                  {isConfirming ? (
                                    <div className="d-flex gap-1 align-items-center">
                                      <div className="position-relative flex-grow-1">
                                        <input className="form-control form-control-sm" style={{fontSize:'0.78rem'}}
                                          placeholder="Buscar producto en catálogo..."
                                          value={confirmSinOC.prodBuscar}
                                          onChange={e => {
                                            setConfirmSinOC(p => ({ ...p, prodBuscar: e.target.value, prodSel: null, prodSugs: [] }))
                                          }} />
                                        {confirmSinOC.prodSugs?.length > 0 && (
                                          <div className="border rounded shadow bg-white position-absolute"
                                            style={{zIndex:9999, top:'100%', left:0, right:0, maxHeight:160, overflowY:'auto'}}>
                                            {confirmSinOC.prodSugs.map(p => (
                                              <div key={p.id} className="px-2 py-1 border-bottom"
                                                style={{cursor:'pointer', fontSize:'0.75rem'}}
                                                onMouseDown={() => setConfirmSinOC(prev => ({
                                                  ...prev, prodBuscar: `${p.codigo} — ${p.descripcion}`,
                                                  prodSel: p, prodSugs: []
                                                }))}>
                                                <code style={{marginRight:6}}>{p.codigo}</code>{p.descripcion}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      {trazabilidadEfectiva !== 'ninguna' && (
                                        <input className="form-control form-control-sm" style={{fontSize:'0.78rem', maxWidth:120}}
                                          placeholder={esSerieSinOC ? 'N° Serie *' : 'Partida *'}
                                          value={partidaPorIngreso[row.id] || ''}
                                          onChange={e => setPartidaPorIngreso(p => ({...p, [row.id]: e.target.value}))} />
                                      )}
                                      {distintaUnidadSinOC && (
                                        <input className="form-control form-control-sm" type="number" onPaste={manejarPegadoNumero}
                                          style={{fontSize:'0.78rem', maxWidth:130}}
                                          placeholder={`Cant. en ${unidadStockEfectiva||'stock'} *`}
                                          title={`Se compra en ${unidadCompraEfectiva} — cargá cuánto entró realmente en ${unidadStockEfectiva||'la unidad de stock'}`}
                                          value={cantStockPorIngreso[row.id] ?? ''}
                                          onChange={e => setCantStockPorIngreso(p => ({...p, [row.id]: e.target.value}))} />
                                      )}
                                      <button className="btn btn-sm btn-success" style={{whiteSpace:'nowrap'}}
                                        disabled={!confirmSinOC.prodSel || savIng === row.id || partidaFalta || cantStockFalta}
                                        title={partidaFalta ? (esSerieSinOC ? 'Este material requiere número de serie' : 'Este material requiere partida')
                                          : cantStockFalta ? 'Cargá cuánto entró realmente en la unidad de stock' : ''}
                                        onClick={() => confirmarSinOC(row.id, confirmSinOC.prodSel?.id)}>
                                        {savIng === row.id ? <span className="spinner-border spinner-border-sm"/> : 'OK'}
                                      </button>
                                      <button className="btn btn-sm btn-outline-secondary"
                                        onClick={() => setConfirmSinOC(null)}>×</button>
                                    </div>
                                  ) : (
                                    row.producto_id
                                      ? <span className="text-success small"><i className="bi bi-check-circle me-1"/>{row.producto_codigo_actual || row.producto_codigo}</span>
                                      : <span className="text-muted small fst-italic">— sin vincular —</span>
                                  )}
                                </td>
                                <td className="text-end" style={{whiteSpace:'nowrap'}}>
                                  {canWrite && !isConfirming && (
                                    <button className="btn btn-sm btn-success me-1" disabled={savIng === row.id}
                                      onClick={() => setConfirmSinOC({ id: row.id, prodBuscar: row.producto_codigo || '', prodSugs: [], prodSel: row.producto_id ? { id: row.producto_id } : null })}>
                                      <i className="bi bi-check-lg me-1"/>Confirmar
                                    </button>
                                  )}
                                  {canWrite && !isConfirming && (
                                    <button className="btn btn-sm btn-outline-danger" disabled={savIng === row.id}
                                      onClick={() => rechazarSinOC(row.id, row.descripcion)}>
                                      <i className="bi bi-x-lg"/>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>}
                  </>
                }
              </div>
              <div className="modal-footer py-2">
                <small className="text-muted me-auto">Confirmá cada material para que ingrese al stock. Los ingresos sin OC requieren vincular un producto del catálogo.</small>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalIngPend(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalPedidos && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-clipboard-check me-2"/>
                  Pedidos de stock pendientes
                  {pedidosPend.length > 0 && <span className="badge bg-warning text-dark ms-2">{pedidosPend.length}</span>}
                </h5>
                <button className="btn-close" onClick={()=>setModalPedidos(false)}/>
              </div>
              <div className="modal-body p-0">
                {pedidosPend.length === 0
                  ? <p className="text-center text-muted py-5">No hay pedidos de materiales pendientes.</p>
                  : pedidosPend.map(ped => (
                    <div key={ped.id} className="border-bottom p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <div>
                          {ped.origen === 'venta_repuesto' ? (
                            <span className="badge bg-primary me-2"><i className="bi bi-truck me-1"/>Venta de repuestos #{ped.real_id}</span>
                          ) : (
                            <span className="fw-semibold me-2">Pedido #{ped.real_id}</span>
                          )}
                          <span className="text-muted small">{ped.solicitante_nombre}</span>
                          <span className="badge bg-light text-dark border ms-2">
                            {ped.origen === 'venta_repuesto'
                              ? `Cliente: ${ped.cliente_nombre}${ped.numero_oc_cliente ? ` · OC ${ped.numero_oc_cliente}` : ''}`
                              : (ped.actividad_nombre || `${ped.proyecto_codigo} — ${ped.proyecto_nombre}`)}
                          </span>
                          {ped.estado === 'Parcial' && <span className="badge bg-info text-dark ms-2">Parcial</span>}
                          {ped.autorizado_por_nombre && (
                            <span className="text-muted small ms-2">Autorizó: {ped.autorizado_por_nombre}</span>
                          )}
                        </div>
                        {canWrite && (
                          <button className="btn btn-sm btn-success" disabled={savPedido === ped.id || faltaLotePedido(ped)}
                            title={faltaLotePedido(ped) ? 'Elegí de qué partida sale cada material que la requiere' : ''}
                            onClick={() => entregarPedido(ped)}>
                            {savPedido === ped.id ? <span className="spinner-border spinner-border-sm"/> : <><i className="bi bi-check-lg me-1"/>Confirmar entrega</>}
                          </button>
                        )}
                      </div>
                      <table className="table table-sm mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-light">
                          <tr>
                            <th>Código</th><th>Descripción</th><th className="text-end">Pedido</th>
                            <th className="text-end">Stock</th><th style={{width:130}}>Entregar ahora</th><th>Partida</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ped.items.map(it => {
                            const pendiente = it.cantidad - it.cantidad_entregada
                            return (
                              <tr key={it.id}>
                                <td><code style={{fontSize:'0.78rem'}}>{it.codigo}</code></td>
                                <td>{it.descripcion}</td>
                                <td className="text-end">{fmt(pendiente)} / {fmt(it.cantidad)} {it.unidad}</td>
                                <td className={`text-end ${it.stock_actual < pendiente ? 'text-danger fw-semibold' : ''}`}>{fmt(it.stock_actual)}</td>
                                <td>
                                  {canWrite && pendiente > 0 && (
                                    <input type="number" onPaste={manejarPegadoNumero} min="0" max={pendiente} step="any" className="form-control form-control-sm"
                                      value={entregaCant[it.id] ?? pendiente}
                                      onChange={e => setEntregaCant(prev => ({ ...prev, [it.id]: e.target.value }))} />
                                  )}
                                </td>
                                <td style={{minWidth:170}}>
                                  {it.trazabilidad_stock !== 'ninguna' && pendiente > 0 ? (
                                    <select className="form-select form-select-sm" value={entregaLote[it.id] || ''}
                                      onChange={e => setEntregaLote(prev => ({ ...prev, [it.id]: e.target.value }))}>
                                      <option value="">— Elegir —</option>
                                      {(lotesPorItemPedido[it.id] || []).map(l => (
                                        <option key={l.id} value={l.id}>{etiquetaLote(l, it.trazabilidad_stock === 'serie')}</option>
                                      ))}
                                    </select>
                                  ) : <span className="text-muted">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {ped.observaciones && <p className="text-muted small mt-2 mb-0">{ped.observaciones}</p>}
                    </div>
                  ))
                }
              </div>
              <div className="modal-footer py-2">
                <small className="text-muted me-auto">Se puede entregar de a parte — lo que falte queda pendiente para la próxima vez.</small>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalPedidos(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: PROYECTOS LEGADO (fusionar historial viejo) ──────────── */}
      {modalProyLegado && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h5 className="modal-title mb-0">Proyectos legado en el historial de Stock</h5>
                  <small className="text-muted">Nombres cargados antes del sistema que aún no fueron mapeados a un proyecto real</small>
                </div>
                <button className="btn-close" onClick={()=>setModalProyLegado(false)}/>
              </div>
              <div className="modal-body">
                {proyLegadoLoad ? (
                  <div className="text-center py-4"><span className="spinner-border text-secondary"/></div>
                ) : proyLegado.length === 0 ? (
                  <div className="alert alert-success mb-0">
                    <i className="bi bi-check-circle me-2"/>No quedan nombres de proyecto sin resolver en el historial de Stock.
                  </div>
                ) : (
                  <>
                    <div className="mb-2 position-relative" style={{ maxWidth: 320 }}>
                      <i className="bi bi-search position-absolute text-muted" style={{ left: 10, top: 8, fontSize: '0.85rem' }} />
                      <input className="form-control form-control-sm ps-4" placeholder="Buscar nombre legado..."
                        value={buscarLegado} onChange={e => setBuscarLegado(e.target.value)} />
                      {buscarLegado && (
                        <button className="btn btn-sm position-absolute" style={{ right: 2, top: 1, padding: '2px 6px' }}
                          onClick={() => setBuscarLegado('')} title="Limpiar búsqueda">
                          <i className="bi bi-x" />
                        </button>
                      )}
                    </div>

                    {legadoFiltrado.length === 0 ? (
                      <div className="text-center text-muted py-4">
                        <i className="bi bi-search" style={{fontSize:'2rem', opacity:0.3}}/>
                        <div className="mt-2">Ningún nombre coincide con "{buscarLegado}"</div>
                      </div>
                    ) : (
                    <>
                    <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
                      <div className="form-check mb-0">
                        <input type="checkbox" className="form-check-input" id="chk-legado-todos"
                          checked={seleccionLegado.size > 0 && seleccionLegado.size === legadoFiltrado.length}
                          ref={el => { if (el) el.indeterminate = seleccionLegado.size > 0 && seleccionLegado.size < legadoFiltrado.length }}
                          onChange={toggleSeleccionTodosLegado} />
                        <label className="form-check-label small text-muted" htmlFor="chk-legado-todos">
                          {seleccionLegado.size > 0 ? `${seleccionLegado.size} seleccionado${seleccionLegado.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
                        </label>
                      </div>
                      {seleccionLegado.size > 0 && (
                        <div className="d-flex align-items-center gap-1 ms-2">
                          <select className="form-select form-select-sm" style={{ width: 220 }}
                            value={destinoMasivo} onChange={e => setDestinoMasivo(e.target.value)}>
                            {opcionesDestino}
                          </select>
                          {destinoMasivo === '__nuevo__' && (
                            <input className="form-control form-control-sm" style={{ width: 220 }}
                              placeholder={`Nombre del proyecto (ej: ${[...seleccionLegado][0]})`}
                              value={nombreProvisorio} onChange={e => setNombreProvisorio(e.target.value)} />
                          )}
                          <button className="btn btn-sm btn-primary"
                            disabled={!destinoMasivo || (destinoMasivo === '__nuevo__' && !nombreProvisorio.trim()) || fusionandoMasivo}
                            onClick={fusionarSeleccionLegado}>
                            <i className="bi bi-arrow-left-right me-1"/>Fusionar seleccionados
                          </button>
                          <button className="btn btn-sm btn-outline-secondary" disabled={fusionandoMasivo}
                            onClick={conservarSeleccionLegado}>
                            <i className="bi bi-check me-1"/>Conservar seleccionados
                          </button>
                          {fusionandoMasivo && <span className="spinner-border spinner-border-sm text-secondary"/>}
                        </div>
                      )}
                    </div>

                    <table className="table table-sm table-hover align-middle">
                      <thead className="table-dark">
                        <tr>
                          <th style={{width:36}}/>
                          <th>Nombre legado</th>
                          <th className="text-center">Movimientos</th>
                          <th>Desde</th>
                          <th>Hasta</th>
                          <th style={{minWidth:220}}>Fusionar con proyecto</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {legadoFiltrado.map(p => (
                          <tr key={p.nombre}>
                            <td className="text-center">
                              <input type="checkbox" className="form-check-input"
                                checked={seleccionLegado.has(p.nombre)}
                                onChange={() => toggleSeleccionLegado(p.nombre)} />
                            </td>
                            <td className="fw-semibold">{p.nombre}</td>
                            <td className="text-center"><span className="badge bg-secondary">{p.total_movimientos}</span></td>
                            <td className="text-nowrap small">{p.fecha_desde || '—'}</td>
                            <td className="text-nowrap small">{p.fecha_hasta || '—'}</td>
                            <td>
                              <select className="form-select form-select-sm"
                                value={fusSelect[p.nombre] || ''}
                                onChange={e => setFusSelect(prev => ({...prev, [p.nombre]: e.target.value}))}>
                                {opcionesDestino}
                              </select>
                              {fusSelect[p.nombre] === '__nuevo__' && (
                                <input className="form-control form-control-sm mt-1" placeholder="Nombre del proyecto"
                                  value={nombreProvisorioFila[p.nombre] ?? p.nombre}
                                  onChange={e => setNombreProvisorioFila(prev => ({...prev, [p.nombre]: e.target.value}))} />
                              )}
                            </td>
                            <td className="text-nowrap">
                              <button className="btn btn-sm btn-primary me-1"
                                disabled={!fusSelect[p.nombre] || (fusSelect[p.nombre] === '__nuevo__' && !(nombreProvisorioFila[p.nombre] ?? p.nombre).trim()) || fusEnCurso === p.nombre}
                                onClick={() => fusionarProyLegado(p.nombre)}>
                                <i className="bi bi-arrow-left-right me-1"/>Fusionar
                              </button>
                              <button className="btn btn-sm btn-outline-secondary" disabled={fusEnCurso === p.nombre}
                                onClick={() => conservarProyLegado(p.nombre)}>
                                <i className="bi bi-check me-1"/>Conservar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-outline-secondary btn-sm" onClick={cargarProyLegado} disabled={proyLegadoLoad}>
                  <i className="bi bi-arrow-clockwise me-1"/>Actualizar
                </button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalProyLegado(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
