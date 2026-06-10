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
import Roles from './modules/configuracion/Roles'
import Administracion from './modules/administracion/Administracion'
import RRHH from './modules/rrhh/RRHH'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Rutas de impresión: protegidas pero sin Layout */}
        <Route element={<ProtectedRoute />}>
          <Route path="/imprimir/oc/:id" element={<ImprimirOC />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard"   element={<Dashboard />} />
            <Route path="/stock"       element={<Stock />} />
            <Route path="/compras"     element={<Compras />} />
            <Route path="/ventas"      element={<EnConstruccion modulo="Ventas" icono="briefcase" />} />
            <Route path="/proyectos"   element={<EnConstruccion modulo="Proyectos" icono="kanban" />} />
            <Route path="/produccion"  element={<EnConstruccion modulo="Producción" icono="tools" />} />
            <Route path="/finanzas"    element={<EnConstruccion modulo="Finanzas" icono="cash-stack" />} />
            <Route path="/mantenimiento" element={<Mantenimiento />} />
            <Route path="/rrhh"         element={<RRHH />} />
            <Route path="/administracion" element={<Administracion />} />
            <Route path="/usuarios"    element={<Usuarios />} />
            <Route path="/roles"       element={<Roles />} />
            <Route index element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
