import { useEmpleados } from '../hooks/useEmpleados'

export default function EmpleadoSelect({
  value, onChange, className, size, style, disabled,
  placeholder = '— Seleccionar —',
  soloInternos = false,
}) {
  const { empleados } = useEmpleados()
  const cls = (className ?? 'form-select') + (size ? ` form-select-${size}` : '')

  const lista = soloInternos ? empleados.filter(e => e.tipo === 'interno') : empleados

  // Si el valor guardado no está en la lista (empleado inactivo o lista aún cargando),
  // lo mostramos igual para que no desaparezca silenciosamente
  const enLista = !value || lista.some(e => e.nombre === value)

  return (
    <select className={cls} style={style} value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {!enLista && value && <option value={value}>{value}</option>}
      {lista.map(e => (
        <option key={e.id} value={e.nombre}>{e.nombre}</option>
      ))}
    </select>
  )
}
