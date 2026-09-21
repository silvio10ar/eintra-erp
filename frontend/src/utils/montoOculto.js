// Un usuario cuyo puesto tiene "oculta_montos" (ej. Auditoría de Calidad)
// recibe este string en vez del número real en cualquier campo de monto
// (backend/helpers/masking.js) — todo formateador de moneda/número del
// frontend tiene que reconocerlo antes de intentar parsearlo/formatearlo,
// sin romperse ni mostrar "NaN".
export const MONTO_OCULTO = '••••••'
export const esMontoOculto = n => n === MONTO_OCULTO
