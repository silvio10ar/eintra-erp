import { puedeEscribir } from '../../store/authStore'
import SubstockPanel from '../../components/SubstockPanel'

export default function Electrico() {
  const canWrite = puedeEscribir('electrico')

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Eléctrico</h5>
        </div>
      </div>

      <div className="card border-0 shadow-sm">
        <div className="card-body p-3">
          <SubstockPanel substock="electrico" canWrite={canWrite} />
        </div>
      </div>
    </>
  )
}
