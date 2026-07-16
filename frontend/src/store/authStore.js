const TOKEN_KEY = 'erp_token'
const USER_KEY  = 'erp_user'
const IMP_TOKEN = 'erp_imp_token'
const IMP_USER  = 'erp_imp_user'

// sessionStorage: se borra al cerrar el browser/pestaña — requiere login en cada sesión
export const getToken = () => sessionStorage.getItem(IMP_TOKEN) || sessionStorage.getItem(TOKEN_KEY)

export const getUser = () => {
  try {
    const imp = sessionStorage.getItem(IMP_USER)
    if (imp) return JSON.parse(imp)
    const u = sessionStorage.getItem(USER_KEY)
    return u ? JSON.parse(u) : null
  } catch { return null }
}

export const setAuth = (token, user) => {
  // Limpiar cualquier token viejo en localStorage (migración)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const setAuthImpersonated = (token, user) => {
  sessionStorage.setItem(IMP_TOKEN, token)
  sessionStorage.setItem(IMP_USER, JSON.stringify(user))
}

export const clearAuth = () => {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(IMP_TOKEN)
  sessionStorage.removeItem(IMP_USER)
}

export const isAuthenticated = () => !!getToken()

export const getPermisos = () => {
  const u = getUser()
  return u?.permisos ?? {}
}

export const puedeLeer    = modulo => getUser()?.rol === 'admin' || !!(getPermisos()[modulo]?.leer)
export const puedeEscribir = modulo => getUser()?.rol === 'admin' || !!(getPermisos()[modulo]?.escribir)
