import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { getUser, clearAuth, getPermisos, getToken } from '../store/authStore'
import MiParte from './MiParte'
import logo from '../assets/logo.avif'

// Las secciones del menú se agrupan por gerencia (rama del organigrama que
// tiene asignado cada módulo — ver GET /auth/gerencias-modulos), no por
// categorías fijas: si el organigrama cambia, el menú se reordena solo.
// Dashboard (sin módulo) y Sistema (solo admin) quedan fijos aparte de eso.
const TODOS_LOS_ITEMS = [
  { to: '/dashboard',      label: 'Dashboard',       icon: 'speedometer2',      modulo: null },
  { to: '/ventas',         label: 'Ventas',          icon: 'briefcase',         modulo: 'ventas' },
  { to: '/proyectos',      label: 'Proyectos',       icon: 'kanban',           modulo: 'proyectos' },
  { to: '/analisis-proyectos', label: 'Análisis de Proyectos', icon: 'graph-up-arrow', modulo: 'analisis_proyectos' },
  { to: '/costeo-equipos', label: 'Costeo de Equipos', icon: 'calculator', modulo: 'costeo_equipos' },
  // Sin módulo/permiso a propósito, igual que Dashboard: cualquier usuario
  // autenticado tiene que poder ver sus propias tareas y las de su gente,
  // sin que un admin le tenga que asignar un permiso aparte.
  { to: '/mis-tareas',     label: 'Mis Tareas',      icon: 'check2-square',    modulo: null },
  { to: '/produccion',     label: 'Producción',      icon: 'tools',            modulo: 'produccion' },
  { to: '/mantenimiento',  label: 'Mantenimiento',   icon: 'wrench-adjustable', modulo: 'mantenimiento' },
  { to: '/calidad',        label: 'Calidad',         icon: 'clipboard2-check', modulo: 'calidad' },
  { to: '/compras',        label: 'Compras',         icon: 'cart3',            modulo: 'compras' },
  { to: '/materiales',     label: 'Materiales',      icon: 'boxes',            modulo: 'materiales' },
  { to: '/stock',          label: 'Stock',           icon: 'box-seam',        modulo: 'stock' },
  { to: '/pedido-stock',   label: 'Pedido de Stock', icon: 'clipboard-check', modulo: 'pedidos_stock' },
  { to: '/rrhh',           label: 'RRHH',            icon: 'people-fill',      modulo: 'rrhh' },
  { to: '/partes',         label: 'Partes',          icon: 'file-earmark-text', modulo: 'partes' },
  { to: '/administracion', label: 'Administración',  icon: 'building-gear',    modulo: 'administracion' },
  { to: '/finanzas',       label: 'Finanzas',        icon: 'cash-stack',       modulo: 'finanzas' },
  // ── Sistema (solo admin) ───────────────────────────
  { to: '/configuracion',  label: 'Configuración',   icon: 'gear',              modulo: '__admin__'       },
  { to: '/usuarios',       label: 'Usuarios',        icon: 'people-gear',       modulo: '__admin__'       },
]

// Módulos que tienen su propia entrada en el menú y por lo tanto tiene sentido
// agruparlos por gerencia (a diferencia de "codificacion"/"crm", que viajan
// siempre junto a su módulo padre por JERARQUIA sin item propio, o "usuarios"/
// "compras_informes", que son solo permisos de una función puntual dentro de
// otra pantalla). Se usa en Usuarios.jsx para no ofrecer ahí módulos que no
// se ven agrupados en ningún lado.
export const MODULOS_MENU = new Set(
  TODOS_LOS_ITEMS.filter(i => i.modulo && i.modulo !== '__admin__').map(i => i.modulo)
)

const ROL_LABELS = {
  admin:       'Administrador',
  gerencia:    'Gerencia',
  compras:     'Compras',
  ventas:      'Ventas',
  deposito:    'Depósito',
  produccion:  'Producción',
  finanzas:    'Finanzas',
  solo_lectura:'Solo lectura',
}

export default function Layout() {
  const navigate      = useNavigate()
  const user          = getUser()
  const rol           = user?.rol ?? 'solo_lectura'
  const permisos      = getPermisos()
  const [showMiParte, setShowMiParte] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [msgCount,   setMsgCount]     = useState(0)
  const [toast,      setToast]        = useState(null)
  const [gerenciaModulos, setGerenciaModulos] = useState({})
  const [raizArea,        setRaizArea]        = useState('Gerencia')
  const prevCount = useRef(null)

  useEffect(() => {
    fetch('/api/v1/auth/gerencias-modulos', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setGerenciaModulos(d.modulos || {}); setRaizArea(d.raizArea || 'Gerencia') } })
      .catch(e => console.error(e))
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/v1/mensajes/no-leidos', {
          headers: { Authorization: `Bearer ${getToken()}` }
        })
        if (!r.ok) return
        const { count } = await r.json()
        setMsgCount(count)
        if (prevCount.current !== null && count > prevCount.current) {
          setToast(count)
          setTimeout(() => setToast(null), 6000)
        }
        prevCount.current = count
      } catch {}
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])

  const NAV_ITEMS = TODOS_LOS_ITEMS.filter(i => {
    if (i.modulo === '__admin__') return rol === 'admin'
    if (!i.modulo) return true
    if (rol === 'admin') return true
    return !!(permisos[i.modulo]?.leer || permisos[i.modulo]?.escribir)
  })
  // Un módulo sin gerencia asignada todavía (recién agregado, o ningún puesto
  // tiene permiso sobre él) cae en la gerencia general por defecto.
  const grupoDe = item => item.modulo ? (gerenciaModulos[item.modulo] || raizArea) : null
  const itemsAgrupables = NAV_ITEMS.filter(i => i.modulo && i.modulo !== '__admin__')
  const gruposPresentes = [...new Set(itemsAgrupables.map(grupoDe))]
    .sort((a, b) => a === raizArea ? -1 : b === raizArea ? 1 : a.localeCompare(b, 'es'))

  const handleLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const renderItem = item => (
    <NavLink key={item.to} to={item.to} className="nav-link" onClick={() => setSidebarOpen(false)}>
      <i className={`bi bi-${item.icon}`} />
      {item.label}
    </NavLink>
  )

  return (
    <div style={{ display: 'flex' }}>
      {/* ── Fondo oscuro para cerrar el menú en celular ── */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div style={{ background: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: '5px 10px', display: 'inline-flex', alignItems: 'center' }}>
            <img src={logo} alt="E-INTRA" style={{ height: 34 }} />
          </div>
          <div className="brand-sub" style={{ marginTop: 6 }}>Sistema de Gestión E-INTRA</div>
        </div>

        <nav>
          {NAV_ITEMS.filter(i => !i.modulo).map(item => renderItem(item))}

          {gruposPresentes.map(grupo => {
            const items = itemsAgrupables.filter(i => grupoDe(i) === grupo)
              .sort((a, b) => a.label.localeCompare(b.label, 'es'))
            if (items.length === 0) return null
            return (
              <div key={grupo}>
                <div className="nav-section" style={{ marginTop: '0.5rem' }}>{grupo}</div>
                {items.map(item => renderItem(item))}
              </div>
            )
          })}

          {rol === 'admin' && (
            <>
              <div className="nav-section" style={{ marginTop: '0.5rem' }}>Sistema</div>
              {NAV_ITEMS.filter(i => i.modulo === '__admin__')
                .sort((a, b) => a.label.localeCompare(b.label, 'es'))
                .map(item => (
                <NavLink key={item.to} to={item.to} className="nav-link" onClick={() => setSidebarOpen(false)}>
                  <i className={`bi bi-${item.icon}`} />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #2d3f55' }}>
          <div style={{ fontSize: '0.8rem', color: '#8b9ab0' }}>
            <div style={{ color: '#c9d1d9', fontWeight: 600 }}>{user?.nombre ?? '—'}</div>
            <div>{ROL_LABELS[user?.rol] ?? user?.rol}</div>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────── */}
      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
            <button className="hamburger-btn d-lg-none btn btn-sm btn-outline-secondary flex-shrink-0"
              onClick={() => setSidebarOpen(o => !o)} title="Menú">
              <i className="bi bi-list" />
            </button>
            <img src={logo} alt="E-INTRA" style={{ height: 28 }} className="flex-shrink-0" />
            <span className="d-none d-md-inline text-truncate" style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1a3a5c' }}>
              Sistema de Gestión E-INTRA
            </span>
          </div>
          <div className="d-flex align-items-center gap-2 gap-sm-3 flex-shrink-0">
            <button className="btn btn-sm btn-outline-secondary position-relative" title="Mensajes"
              onClick={() => navigate('/mensajes')}>
              <i className="bi bi-envelope" />
              {msgCount > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                  style={{ fontSize: '0.62rem' }}>
                  {msgCount}
                </span>
              )}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowMiParte(true)}>
              <i className="bi bi-file-earmark-text d-none d-sm-inline me-sm-1" />
              <span className="d-none d-sm-inline">Mi Parte</span>
              <i className="bi bi-file-earmark-text d-inline d-sm-none" />
            </button>
            <span className="text-muted d-none d-md-inline" style={{ fontSize: '0.82rem' }}>
              <i className="bi bi-person-circle me-1" />
              {user?.username}
            </span>
            <button className="btn btn-sm btn-outline-secondary" onClick={handleLogout} title="Salir">
              <i className="bi bi-box-arrow-right d-none d-sm-inline me-sm-1" />
              <span className="d-none d-sm-inline">Salir</span>
              <i className="bi bi-box-arrow-right d-inline d-sm-none" />
            </button>
          </div>
        </header>

        {/* Page */}
        <main className="page-content">
          <Outlet />
        </main>
      </div>

      <MiParte show={showMiParte} onClose={() => setShowMiParte(false)} />

      {/* ── Toast notificación mensajes ────────────────────────── */}
      {toast && (
        <div onClick={() => { setToast(null); navigate('/mensajes') }}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            background: '#0d6efd', color: '#fff', borderRadius: 10,
            padding: '12px 16px', boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', maxWidth: 300,
          }}>
          <i className="bi bi-envelope-fill" style={{ fontSize: '1.4rem', flexShrink: 0 }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Mensaje nuevo</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.88 }}>
              Tenés {toast} mensaje{toast > 1 ? 's' : ''} sin leer
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); setToast(null) }}
            style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', padding: '0 2px', fontSize:'1rem' }}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
