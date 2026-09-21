// Un <input type="number"> nativo solo entiende "1234.56" (punto decimal,
// sin separador de miles) — si se le pega un número con formato argentino
// ("2.138.474,91") lo interpreta mal en silencio (queda "2.13847491"), sin
// ningún aviso. Esto intercepta el pegado, interpreta el texto sea cual sea
// el formato en el que venga, y carga el valor ya bien.
export function parseNumeroPegado(texto) {
  const s = (texto || '').trim()
  if (!s) return null

  const limpio = s.replace(/[^\d,.-]/g, '')
  const tieneComa = limpio.includes(',')
  const tienePunto = limpio.includes('.')
  let normalizado = limpio

  if (tieneComa && tienePunto) {
    normalizado = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')   // argentino: punto=miles, coma=decimal
      : limpio.replace(/,/g, '')                       // inglés: coma=miles, punto=decimal
  } else if (tieneComa) {
    normalizado = limpio.replace(/\./g, '').replace(',', '.')
  } else if (tienePunto) {
    const partes = limpio.split('.')
    if (partes.length > 2) {
      normalizado = partes.join('')  // varios puntos → son de miles (ej. "2.138.474")
    } else if (partes[1]?.length === 3) {
      // Un solo punto con exactamente 3 dígitos después ("150.000") es el
      // formato argentino de miles, no un decimal con tres ceros (nadie
      // pega eso queriendo decir "150,000 veces más chico") — si no se
      // detecta esto acá, "150.000" quedaba entendido como 150 en vez de
      // 150000, mil veces menos en silencio.
      normalizado = partes.join('')
    }
    // un solo punto con 1, 2 o 4+ dígitos después es un decimal genuino
    // (ej. "150.5", "150.25") — se deja tal cual.
  }

  const n = parseFloat(normalizado)
  return Number.isNaN(n) ? null : n
}

// Handler de onPaste para <input type="number">: si el texto pegado no es un
// número nativo válido, lo interpreta y carga el valor ya corregido en el
// campo (disparando el evento nativo para que React lo capture como si lo
// hubiera escrito el usuario).
export function manejarPegadoNumero(e) {
  const texto = e.clipboardData?.getData('text')
  const n = parseNumeroPegado(texto)
  if (n == null) return
  e.preventDefault()
  const input = e.target
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, String(n))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
