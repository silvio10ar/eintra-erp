// Botón + dropdown para elegir qué columnas mostrar en una tabla ancha.
// `columnas` es [{ key, label }] — el orden en la lista es el orden en que se
// ofrecen para tildar/destildar, no necesariamente el orden de la tabla.
export default function SelectorColumnas({ columnas, visible, onToggle }) {
  return (
    <div className="dropdown">
      <button type="button" className="btn btn-sm btn-outline-secondary" title="Elegir columnas visibles"
        data-bs-toggle="dropdown" data-bs-auto-close="outside">
        <i className="bi bi-layout-three-columns" />
      </button>
      <ul className="dropdown-menu p-2" style={{ minWidth: 220, maxHeight: 320, overflowY: 'auto' }}>
        <li className="dropdown-header px-1 py-0 mb-1">Columnas visibles</li>
        {columnas.map(c => (
          <li key={c.key} className="form-check px-3 py-1 mb-0">
            <input className="form-check-input" type="checkbox" id={`colvis-${c.key}`}
              checked={visible(c.key)} onChange={() => onToggle(c.key)} />
            <label className="form-check-label small" htmlFor={`colvis-${c.key}`}>{c.label}</label>
          </li>
        ))}
      </ul>
    </div>
  )
}
