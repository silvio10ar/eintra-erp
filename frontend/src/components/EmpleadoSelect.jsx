import { useEmpleados } from '../hooks/useEmpleados'

export default function EmpleadoSelect({ value, onChange, className, size, disabled, placeholder = '— Seleccionar —' }) {
  const { empleados } = useEmpleados()
  const cls = (className ?? 'form-select') + (size ? ` form-select-${size}` : '')
  return (
    <select className={cls} value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {empleados.map(e => (
        <option key={e.id} value={e.nombre}>{e.nombre}</option>
      ))}
    </select>
  )
}
