import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './modules/auth/Login'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './modules/dashboard/Dashboard'
import EnConstruccion from './components/EnConstruccion'
import Stock from './modules/stock/Stock'
import Compras from './modules/compras/Compras'
import ImprimirOC from './modules/compras/ImprimirOC'
import Mantenimiento from './modules/mantenimiento/Mantenimiento'
import Usuarios from './modules/configuracion/Usuarios'
import Administracion from './modules/administracion/Administracion'
import RRHH from './modules/rrhh/RRHH'
import Partes from './modules/rrhh/Partes'
import Codificacion from './modules/codificacion/Codificacion'
import FuturaCodificacion from './modules/codificacion/FuturaCodificacion'
import Materiales from './modules/compras/Materiales'
import ConfiguracionSistema from './modules/administracion/ConfiguracionSistema'
import Proyectos from './modules/proyectos/Proyectos'
import Mensajes from './modules/mensajes/Mensajes'
import CRM from './modules/crm/CRM'
import Ventas from './modules/ventas/Ventas'
import ImprimirPresupuesto from './modules/ventas/ImprimirPresupuesto'
import OfertaTecnica from './modules/ventas/OfertaTecnica'
import ImprimirOfertaTecnica from './modules/ventas/ImprimirOfertaTecnica'
import Finanzas from './modules/finanzas/Finanzas'
import Calidad from './modules/calidad/Calidad'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Rutas de impresión: protegidas pero sin Layout */}
        <Route element={<ProtectedRoute />}>
          <Route path="/imprimir/oc/:id" element={<ImprimirOC />} />
          <Route path="/ventas/presupuesto/:id/imprimir" element={<ImprimirPresupuesto />} />
          <Route path="/ventas/presupuesto/:id/oferta-tecnica/imprimir" element={<ImprimirOfertaTecnica />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard"   element={<Dashboard />} />
            <Route path="/stock"       element={<Stock />} />
            <Route path="/compras"     element={<Compras />} />
            <Route path="/ventas"      element={<Ventas />} />
            <Route path="/ventas/presupuesto/:id/oferta-tecnica" element={<OfertaTecnica />} />
            <Route path="/crm"         element={<CRM />} />
            <Route path="/proyectos"   element={<Proyectos />} />
            <Route path="/produccion"  element={<EnConstruccion modulo="Producción" icono="tools" />} />
            <Route path="/finanzas"    element={<Finanzas />} />
            <Route path="/calidad"     element={<Calidad />} />
            <Route path="/mantenimiento" element={<Mantenimiento />} />
            <Route path="/rrhh"         element={<RRHH />} />
            <Route path="/partes"       element={<Partes />} />
            <Route path="/codificacion" element={<Codificacion />} />
            <Route path="/codificacion/futura" element={<FuturaCodificacion />} />
            <Route path="/materiales"  element={<Materiales />} />
            <Route path="/mensajes"       element={<Mensajes />} />
            <Route path="/administracion" element={<Administracion />} />
            <Route path="/configuracion"  element={<ConfiguracionSistema />} />
            <Route path="/usuarios"    element={<Usuarios />} />
            <Route index element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
