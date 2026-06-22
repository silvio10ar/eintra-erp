'use strict'
// Revierte movimientos de OC 002133 y resetea el estado de la OC
// Uso: node revertir-ingresos-oc002133.js

const BASE = 'http://10.1.1.10:3002/api/v1'
const USER = 'admin'
const PASS = 'eintra2026'

async function main() {
  // 1) Login
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!loginRes.ok) { console.error('Login fallido'); process.exit(1) }
  const { token } = await loginRes.json()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 2) Obtener movimientos del día 17/06/2026 tipo entrada
  const movsRes = await fetch(`${BASE}/stock/movimientos?desde=2026-06-17&hasta=2026-06-17&tipo=entrada&limit=500`, { headers })
  if (!movsRes.ok) { console.error('Error al obtener movimientos'); process.exit(1) }
  const { datos } = await movsRes.json()

  const aEliminar = (datos || []).filter(m => m.proveedor !== 'LIESA SA')
  const omitidos  = (datos || []).filter(m => m.proveedor === 'LIESA SA')

  if (aEliminar.length === 0) {
    console.log('No hay movimientos del 17/06/2026 para revertir (ya fueron eliminados o no existen).')
  } else {
    console.log(`\nMovimientos a revertir (${aEliminar.length}):`)
    aEliminar.forEach(m => {
      console.log(`  ID ${m.id} | ${m.codigo||'?'} — ${m.descripcion||'?'} | cant: ${m.cantidad} | obs: ${m.observaciones||'—'} | prov: ${m.proveedor||'—'}`)
    })
  }
  if (omitidos.length) {
    console.log(`\nMovimientos OMITIDOS (LIESA SA — no se tocan):`)
    omitidos.forEach(m => console.log(`  ID ${m.id} | ${m.descripcion||'?'}`))
  }

  // 3) Siempre resetear OC 002133
  console.log('\nBuscando OC 002133...')
  const ocsRes  = await fetch(`${BASE}/compras/oc?buscar=002133&limit=10`, { headers })
  const ocsData = await ocsRes.json()
  const oc2133  = (ocsData.datos || []).find(o => o.numero === '002133')

  if (!oc2133) {
    console.log('  ? OC 002133 no encontrada.')
  } else {
    console.log(`  Estado actual: ${oc2133.estado}`)
  }

  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout })
  const pregunta = q => new Promise(r => readline.question(q, r))

  const msg = aEliminar.length > 0
    ? `\n¿Eliminar ${aEliminar.length} movimientos y resetear OC 002133 → Emitida? (s/N): `
    : `\n¿Resetear OC 002133 → Emitida (sin tocar movimientos)? (s/N): `

  const resp = await pregunta(msg)
  readline.close()

  if (resp.trim().toLowerCase() !== 's') { console.log('Cancelado.'); return }

  // 4) Eliminar movimientos (si los hay)
  let ok = 0, err = 0
  for (const m of aEliminar) {
    const r = await fetch(`${BASE}/stock/movimientos/${m.id}`, { method: 'DELETE', headers })
    if (r.ok) {
      console.log(`  ✓ Eliminado ID ${m.id} — ${m.codigo} (${m.cantidad})`)
      ok++
    } else {
      const body = await r.json().catch(() => ({}))
      console.log(`  ✗ Error ID ${m.id}: ${body.error || r.status}`)
      err++
    }
  }
  if (aEliminar.length > 0) console.log(`\nMovimientos: ${ok} eliminados, ${err} errores`)

  // 5) Resetear OC
  if (oc2133) {
    const rr = await fetch(`${BASE}/compras/oc/${oc2133.id}/resetear-recepcion`, { method: 'POST', headers })
    if (rr.ok) console.log(`✓ OC 002133 reseteada → Emitida, cant_recibida = 0`)
    else        console.log(`✗ Error al resetear OC 002133: ${rr.status}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
