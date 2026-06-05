export default function EnConstruccion({ modulo, icono }) {
  return (
    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
      <i className={`bi bi-${icono} text-secondary mb-3`} style={{ fontSize: '3.5rem' }} />
      <h4 className="text-secondary mb-1">{modulo}</h4>
      <p className="text-muted mb-0">Módulo en desarrollo — próximamente disponible</p>
    </div>
  )
}
