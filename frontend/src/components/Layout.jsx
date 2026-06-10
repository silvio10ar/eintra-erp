import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { getUser, clearAuth, getPermisos } from '../store/authStore'

const TODOS_LOS_ITEMS = [
  { to: '/dashboard',  label: 'Dashboard',   icon: 'speedometer2', modulo: null          },
  { to: '/stock',      label: 'Stock',        icon: 'box-seam',     modulo: 'stock'       },
  { to: '/compras',    label: 'Compras',      icon: 'cart3',        modulo: 'compras'     },
  { to: '/ventas',     label: 'Ventas',       icon: 'briefcase',    modulo: 'ventas'      },
  { to: '/proyectos',  label: 'Proyectos',    icon: 'kanban',       modulo: 'proyectos'   },
  { to: '/produccion', label: 'Producción',   icon: 'tools',        modulo: 'produccion'  },
  { to: '/finanzas',      label: 'Finanzas',      icon: 'cash-stack',    modulo: 'finanzas'      },
  { to: '/mantenimiento', label: 'Mantenimiento', icon: 'wrench-adjustable', modulo: 'mantenimiento' },
  { to: '/rrhh',         label: 'RRHH',          icon: 'people-fill',       modulo: 'rrhh'           },
  { to: '/administracion', label: 'Administración', icon: 'building-gear', modulo: 'administracion' },
  { to: '/usuarios',      label: 'Usuarios',      icon: 'people-gear',   modulo: '__admin__'     },
  { to: '/roles',      label: 'Roles',        icon: 'shield-lock',  modulo: '__admin__'   },
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
  const navigate  = useNavigate()
  const user      = getUser()
  const rol       = user?.rol ?? 'solo_lectura'
  const permisos  = getPermisos()

  const NAV_ITEMS = TODOS_LOS_ITEMS.filter(i => {
    if (i.modulo === '__admin__') return rol === 'admin'
    if (!i.modulo) return true  // Dashboard siempre visible
    if (rol === 'admin') return true
    return !!(permisos[i.modulo]?.leer || permisos[i.modulo]?.escribir)
  })

  const handleLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex' }}>
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-title">E-INTRA</div>
          <div className="brand-sub">Sistema ERP</div>
        </div>

        <nav>
          <div className="nav-section">Principal</div>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} className="nav-link">
              <i className={`bi bi-${item.icon}`} />
              {item.label}
            </NavLink>
          ))}
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
          <span className="fw-semibold text-secondary" style={{ fontSize: '0.85rem' }}>
            E-INTRA ERP
          </span>
          <div className="d-flex align-items-center gap-3">
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
    </div>
  )
}
