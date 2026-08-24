'use strict';

// Normaliza un CUIT/CUIL a formato XX-XXXXXXXX-X. Si no tiene exactamente 11
// dígitos (dato incompleto, vacío, o texto que no es un CUIT) se devuelve tal
// cual vino, recortado — no forzamos un formato sobre un dato que no lo tiene.
function formatCuit(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length !== 11) return String(valor || '').trim();
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

module.exports = { formatCuit };
