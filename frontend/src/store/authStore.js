const TOKEN_KEY = 'erp_token'
const USER_KEY  = 'erp_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)

export const getUser = () => {
  try {
    const u = localStorage.getItem(USER_KEY)
    return u ? JSON.parse(u) : null
  } catch { return null }
}

export const setAuth = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const clearAuth = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export const isAuthenticated = () => !!getToken()

export const getPermisos = () => {
  const u = getUser()
  return u?.permisos ?? {}
}

export const puedeLeer    = modulo => getUser()?.rol === 'admin' || !!(getPermisos()[modulo]?.leer)
export const puedeEscribir = modulo => getUser()?.rol === 'admin' || !!(getPermisos()[modulo]?.escribir)
