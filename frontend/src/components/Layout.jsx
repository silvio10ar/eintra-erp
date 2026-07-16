import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { getUser, clearAuth, getPermisos, getToken } from '../store/authStore'
import MiParte from './MiParte'
import logo from '../assets/logo.avif'

const TODOS_LOS_ITEMS = [
  // ── Dashboard (siempre primero) ────────────────────
  { to: '/dashboard',      label: 'Dashboard',       icon: 'speedometer2',      modulo: null              },
  // ── Módulos principales (orden alfabético) ─────────
  { to: '/administracion', label: 'Administración',  icon: 'building-gear',     modulo: 'administracion'  },
  { to: '/calidad',        label: 'Calidad',         icon: 'clipboard2-check',  modulo: 'calidad'         },
  { to: '/compras',        label: 'Compras',         icon: 'cart3',             modulo: 'compras'         },
  { to: '/materiales',     label: 'Materiales',      icon: 'boxes',             modulo: 'materiales',     padre: 'compras' },
  { to: '/crm',            label: 'CRM',             icon: 'people',            modulo: 'ventas'          },
  { to: '/finanzas',       label: 'Finanzas',        icon: 'cash-stack',        modulo: 'finanzas'        },
  { to: '/mantenimiento',  label: 'Mantenimiento',   icon: 'wrench-adjustable', modulo: 'mantenimiento'   },
  { to: '/mensajes',       label: 'Mensajes',        icon: 'envelope',          modulo: null              },
  { to: '/produccion',     label: 'Producción',      icon: 'tools',             modulo: 'produccion'      },
  { to: '/proyectos',      label: 'Proyectos',       icon: 'kanban',            modulo: 'proyectos'       },
  { to: '/rrhh',           label: 'RRHH',            icon: 'people-fill',       modulo: 'rrhh'            },
  { to: '/partes',         label: 'Partes',          icon: 'file-earmark-text', modulo: 'partes',         padre: 'rrhh'  },
  { to: '/stock',          label: 'Stock',           icon: 'box-seam',          modulo: 'stock'           },
  { to: '/ventas',         label: 'Ventas',          icon: 'briefcase',         modulo: 'ventas'          },
  // ── Sistema (solo admin) ───────────────────────────
  { to: '/configuracion',  label: 'Configuración',   icon: 'gear',              modulo: '__admin__'       },
  { to: '/usuarios',       label: 'Usuarios',        icon: 'people-gear',       modulo: '__admin__'       },
]

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
  const [expandidos, setExpandidos]   = useState(new Set(['rrhh', 'compras']))
  const [msgCount,   setMsgCount]     = useState(0)
  const [toast,      setToast]        = useState(null)
  const prevCount = useRef(null)

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

  const toggleExpand = modulo => setExpandidos(prev => {
    const next = new Set(prev)
    next.has(modulo) ? next.delete(modulo) : next.add(modulo)
    return next
  })

  const NAV_ITEMS = TODOS_LOS_ITEMS.filter(i => {
    if (i.modulo === '__admin__') return rol === 'admin'
    if (!i.modulo) return true
    if (rol === 'admin') return true
    return !!(permisos[i.modulo]?.leer || permisos[i.modulo]?.escribir)
  })
  const visibles = new Set(NAV_ITEMS.map(i => i.modulo))
  // Items de primer nivel: sin padre, o cuyo padre no está visible
  const topLevel = NAV_ITEMS.filter(i => !i.padre)

  const handleLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex' }}>
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div style={{ background: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: '5px 10px', display: 'inline-flex', alignItems: 'center' }}>
            <img src={logo} alt="E-INTRA" style={{ height: 34 }} />
          </div>
          <div className="brand-sub" style={{ marginTop: 6 }}>Sistema de Gestión E-INTRA</div>
        </div>

        <nav>
          <div className="nav-section">Principal</div>
          {topLevel.filter(i => i.modulo !== '__admin__').map(item => {
            const hijos      = NAV_ITEMS.filter(c => c.padre === item.modulo)
            const tieneHijos = hijos.length > 0
            const expandido  = expandidos.has(item.modulo)
            return (
              <div key={item.to}>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  <NavLink to={item.to} className="nav-link" style={{ flex: 1, minWidth: 0 }}>
                    <i className={`bi bi-${item.icon}`} />
                    {item.label}
                    {item.to === '/mensajes' && msgCount > 0 && (
                      <span className="badge bg-danger ms-1" style={{ fontSize: '0.62rem', verticalAlign: 'middle' }}>
                        {msgCount}
                      </span>
                    )}
                  </NavLink>
                  {tieneHijos && (
                    <button
                      onClick={() => toggleExpand(item.modulo)}
                      title={expandido ? 'Contraer' : 'Expandir'}
                      style={{
                        background: 'none', border: 'none',
                        padding: '0 0.75rem', flexShrink: 0,
                        color: '#5a7090', cursor: 'pointer',
                        display: 'flex', alignItems: 'center',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#8b9ab0' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#5a7090' }}
                    >
                      <i className={`bi bi-chevron-${expandido ? 'down' : 'right'}`}
                         style={{ fontSize: '0.72rem' }} />
                    </button>
                  )}
                </div>
                {tieneHijos && expandido && hijos.map(hijo => (
                  <NavLink key={hijo.to} to={hijo.to} className="nav-link"
                    style={{ paddingLeft: '2.25rem', fontSize: '0.82rem', opacity: 0.88 }}>
                    <span style={{ marginRight: '0.5rem', color: '#4a6080', fontSize: '0.7rem' }}>└</span>
                    <i className={`bi bi-${hijo.icon}`} />
                    {hijo.label}
                  </NavLink>
                ))}
              </div>
            )
          })}

          {rol === 'admin' && (
            <>
              <div className="nav-section" style={{ marginTop: '0.5rem' }}>Sistema</div>
              {topLevel.filter(i => i.modulo === '__admin__').map(item => (
                <NavLink key={item.to} to={item.to} className="nav-link">
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
          <div className="d-flex align-items-center gap-2">
            <img src={logo} alt="E-INTRA" style={{ height: 28 }} />
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1a3a5c' }}>Sistema de Gestión E-INTRA</span>
          </div>
          <div className="d-flex align-items-center gap-3">
            <button className="btn btn-sm btn-primary" onClick={() => setShowMiParte(true)}>
              <i className="bi bi-file-earmark-text me-1" />Mi Parte
            </button>
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              <i className="bi bi-person-circle me-1" />
              {user?.username}
            </span>
            <button className="btn btn-sm btn-outline-secondary" onClick={handleLogout}>
              <i className="bi bi-box-arrow-right me-1" />
              Salir
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
