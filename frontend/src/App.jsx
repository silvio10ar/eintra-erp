import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './modules/auth/Login'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RutaConPermiso from './components/RutaConPermiso'

// Cada módulo se descarga recién al entrar a esa pantalla, no todos de una
// al arrancar la app — antes, alguien que solo usaba Stock igual bajaba el
// código completo de Finanzas, RRHH, Mantenimiento, etc.
const CambiarPassword      = lazy(() => import('./modules/auth/CambiarPassword'))
const Dashboard            = lazy(() => import('./modules/dashboard/Dashboard'))
const Stock                = lazy(() => import('./modules/stock/Stock'))
const PedidoStock          = lazy(() => import('./modules/stock/PedidoStock'))
const Compras              = lazy(() => import('./modules/compras/Compras'))
const ImprimirOC           = lazy(() => import('./modules/compras/ImprimirOC'))
const Mantenimiento        = lazy(() => import('./modules/mantenimiento/Mantenimiento'))
const Usuarios             = lazy(() => import('./modules/configuracion/Usuarios'))
const Administracion       = lazy(() => import('./modules/administracion/Administracion'))
const RRHH                 = lazy(() => import('./modules/rrhh/RRHH'))
const Partes               = lazy(() => import('./modules/rrhh/Partes'))
const Materiales           = lazy(() => import('./modules/compras/Materiales'))
const ConfiguracionSistema = lazy(() => import('./modules/administracion/ConfiguracionSistema'))
const Proyectos            = lazy(() => import('./modules/proyectos/Proyectos'))
const AnalisisProyectos    = lazy(() => import('./modules/proyectos/AnalisisProyectos'))
const CosteoEquipos        = lazy(() => import('./modules/costeo/CosteoEquipos'))
const MisTareas            = lazy(() => import('./modules/proyectos/MisTareas'))
const Mensajes             = lazy(() => import('./modules/mensajes/Mensajes'))
const Ventas               = lazy(() => import('./modules/ventas/Ventas'))
const ImprimirPresupuesto  = lazy(() => import('./modules/ventas/ImprimirPresupuesto'))
const OfertaTecnica        = lazy(() => import('./modules/ventas/OfertaTecnica'))
const ImprimirOfertaTecnica = lazy(() => import('./modules/ventas/ImprimirOfertaTecnica'))
const Finanzas              = lazy(() => import('./modules/finanzas/Finanzas'))
const Calidad               = lazy(() => import('./modules/calidad/Calidad'))
const Produccion            = lazy(() => import('./modules/produccion/Produccion'))

const Cargando = () => (
  <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '50vh' }}>
    <span className="spinner-border text-secondary" />
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Cargando />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protegida pero sin Layout — el propio ProtectedRoute redirige acá
            cuando debe_cambiar_password está activo, y esta ruta queda
            excluida de ese redirect para no generar un loop. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/cambiar-password" element={<CambiarPassword />} />
        </Route>

        {/* Rutas de impresión: protegidas pero sin Layout */}
        <Route element={<ProtectedRoute />}>
          <Route path="/imprimir/oc/:id" element={<RutaConPermiso modulo="compras"><ImprimirOC /></RutaConPermiso>} />
          <Route path="/ventas/presupuesto/:id/imprimir" element={<RutaConPermiso modulo="ventas"><ImprimirPresupuesto /></RutaConPermiso>} />
          <Route path="/ventas/presupuesto/:id/oferta-tecnica/imprimir" element={<RutaConPermiso modulo="ventas"><ImprimirOfertaTecnica /></RutaConPermiso>} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard"   element={<Dashboard />} />
            <Route path="/stock"       element={<RutaConPermiso modulo="stock"><Stock /></RutaConPermiso>} />
            <Route path="/pedido-stock" element={<RutaConPermiso modulo="pedidos_stock"><PedidoStock /></RutaConPermiso>} />
            <Route path="/mis-tareas" element={<MisTareas />} />
            <Route path="/compras"     element={<RutaConPermiso modulo="compras"><Compras /></RutaConPermiso>} />
            <Route path="/ventas"      element={<RutaConPermiso modulo="ventas"><Ventas /></RutaConPermiso>} />
            <Route path="/ventas/presupuesto/:id/oferta-tecnica" element={<RutaConPermiso modulo="ventas"><OfertaTecnica /></RutaConPermiso>} />
            <Route path="/crm"         element={<Navigate to="/ventas" replace />} />
            <Route path="/proyectos"   element={<RutaConPermiso modulo="proyectos"><Proyectos /></RutaConPermiso>} />
            <Route path="/analisis-proyectos" element={<RutaConPermiso modulo="analisis_proyectos"><AnalisisProyectos /></RutaConPermiso>} />
            <Route path="/costeo-equipos" element={<RutaConPermiso modulo="costeo_equipos"><CosteoEquipos /></RutaConPermiso>} />
            <Route path="/produccion"  element={<RutaConPermiso modulo="produccion"><Produccion /></RutaConPermiso>} />
            <Route path="/finanzas"    element={<RutaConPermiso modulo="finanzas"><Finanzas /></RutaConPermiso>} />
            <Route path="/calidad"     element={<RutaConPermiso modulo="calidad"><Calidad /></RutaConPermiso>} />
            <Route path="/mantenimiento" element={<RutaConPermiso modulo="mantenimiento"><Mantenimiento /></RutaConPermiso>} />
            <Route path="/rrhh"         element={<RutaConPermiso modulo="rrhh"><RRHH /></RutaConPermiso>} />
            <Route path="/partes"       element={<RutaConPermiso modulo="partes"><Partes /></RutaConPermiso>} />
            <Route path="/codificacion" element={<Navigate to="/materiales" replace />} />
            <Route path="/codificacion/futura" element={<Navigate to="/materiales" replace />} />
            <Route path="/materiales"  element={<RutaConPermiso modulo="materiales"><Materiales /></RutaConPermiso>} />
            <Route path="/mensajes"       element={<Mensajes />} />
            <Route path="/administracion" element={<RutaConPermiso modulo="administracion"><Administracion /></RutaConPermiso>} />
            <Route path="/configuracion"  element={<RutaConPermiso modulo="__admin__"><ConfiguracionSistema /></RutaConPermiso>} />
            <Route path="/usuarios"    element={<RutaConPermiso modulo="__admin__"><Usuarios /></RutaConPermiso>} />
            <Route index element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
