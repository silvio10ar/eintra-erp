// Normaliza un CUIT/CUIL a formato XX-XXXXXXXX-X. Si no tiene exactamente 11
// dígitos (dato incompleto, todavía se está tipeando) se devuelve tal cual,
// para no interrumpir al usuario mientras completa el campo.
export function formatCuit(valor) {
  const digitos = String(valor || '').replace(/\D/g, '')
  if (digitos.length !== 11) return String(valor || '').trim()
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
}
