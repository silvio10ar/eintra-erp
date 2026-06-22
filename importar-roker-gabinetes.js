'use strict'
const http = require('http')

const SERVIDOR = '10.1.1.10'
const PUERTO   = 3002
const USUARIO  = 'admin'
const PASSWORD = 'eintra2026'

const p = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'))
const gc = (cat) => ({ categoria: cat, unidad: 'UND.', proveedor: 'ROKER' })

// Codigo E-INTRA: 9=MAT.ELECTRICO, A0=GABINETE, R4=ROKER, 00001-99999=secuencial
const ei = (n) => `9A0R4${String(n).padStart(5, '0')}`

// Lista Roker Metalico - Nro 29 (19/09/2025) - precios netos (67% dto)
const CATALOGO = [
  // GABINETES ESTANCOS - PUERTA CIEGA - Prof. 100
  { codigo_proveedor:'GA0200200100C', descripcion:'GAB.ESTANCO P.CIEGA 200X200X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('33.848,78') },
  { codigo_proveedor:'GA0250200100C', descripcion:'GAB.ESTANCO P.CIEGA 250X200X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('35.349,44') },
  { codigo_proveedor:'GA0300200100C', descripcion:'GAB.ESTANCO P.CIEGA 300X200X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('43.849,51') },
  { codigo_proveedor:'GA0300250100C', descripcion:'GAB.ESTANCO P.CIEGA 300X250X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('46.119,68') },
  { codigo_proveedor:'GA0300300100C', descripcion:'GAB.ESTANCO P.CIEGA 300X300X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('49.375,15') },
  { codigo_proveedor:'GA0450300100C', descripcion:'GAB.ESTANCO P.CIEGA 450X300X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('62.939,20') },
  { codigo_proveedor:'GA0450450100C', descripcion:'GAB.ESTANCO P.CIEGA 450X450X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('92.677,39') },
  { codigo_proveedor:'GA0600300100C', descripcion:'GAB.ESTANCO P.CIEGA 600X300X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('96.990,78') },
  { codigo_proveedor:'GA0600450100C', descripcion:'GAB.ESTANCO P.CIEGA 600X450X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('128.146,79') },
  { codigo_proveedor:'GA0600600100C', descripcion:'GAB.ESTANCO P.CIEGA 600X600X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('154.591,76') },
  { codigo_proveedor:'GA0750600100C', descripcion:'GAB.ESTANCO P.CIEGA 750X600X100',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('186.533,25') },
  // Prof. 150
  { codigo_proveedor:'GA0200200150C', descripcion:'GAB.ESTANCO P.CIEGA 200X200X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('39.199,60') },
  { codigo_proveedor:'GA0250200150C', descripcion:'GAB.ESTANCO P.CIEGA 250X200X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('40.910,85') },
  { codigo_proveedor:'GA0300200150C', descripcion:'GAB.ESTANCO P.CIEGA 300X200X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('48.296,62') },
  { codigo_proveedor:'GA0300250150C', descripcion:'GAB.ESTANCO P.CIEGA 300X250X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('49.234,47') },
  { codigo_proveedor:'GA0300300150C', descripcion:'GAB.ESTANCO P.CIEGA 300X300X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('55.829,93') },
  { codigo_proveedor:'GA0450200150C', descripcion:'GAB.ESTANCO P.CIEGA 450X200X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('63.693,24') },
  { codigo_proveedor:'GA0450300150C', descripcion:'GAB.ESTANCO P.CIEGA 450X300X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('68.441,36') },
  { codigo_proveedor:'GA0450450150C', descripcion:'GAB.ESTANCO P.CIEGA 450X450X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('99.265,51') },
  { codigo_proveedor:'GA0500400150C', descripcion:'GAB.ESTANCO P.CIEGA 500X400X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('97.798,53') },
  { codigo_proveedor:'GA0600300150C', descripcion:'GAB.ESTANCO P.CIEGA 600X300X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('101.180,28') },
  { codigo_proveedor:'GA0600450150C', descripcion:'GAB.ESTANCO P.CIEGA 600X450X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('134.008,59') },
  { codigo_proveedor:'GA0600500150C', descripcion:'GAB.ESTANCO P.CIEGA 600X500X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('140.095,61') },
  { codigo_proveedor:'GA0600600150C', descripcion:'GAB.ESTANCO P.CIEGA 600X600X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('161.155,95') },
  { codigo_proveedor:'GA0750450150C', descripcion:'GAB.ESTANCO P.CIEGA 750X450X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('149.282,10') },
  { codigo_proveedor:'GA0750600150C', descripcion:'GAB.ESTANCO P.CIEGA 750X600X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('187.760,24') },
  { codigo_proveedor:'GA0900600150C', descripcion:'GAB.ESTANCO P.CIEGA 900X600X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('217.343,64') },
  { codigo_proveedor:'GA0900750150C', descripcion:'GAB.ESTANCO P.CIEGA 900X750X150',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('280.166,90') },
  { codigo_proveedor:'GA1050600150C', descripcion:'GAB.ESTANCO P.CIEGA 1050X600X150',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('250.075,09') },
  { codigo_proveedor:'GA1200600150C', descripcion:'GAB.ESTANCO P.CIEGA 1200X600X150',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('287.569,77') },
  { codigo_proveedor:'GA1200750150C', descripcion:'GAB.ESTANCO P.CIEGA 1200X750X150',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('373.555,87') },
  // Prof. 225
  { codigo_proveedor:'GA0200200225C', descripcion:'GAB.ESTANCO P.CIEGA 200X200X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('55.593,59') },
  { codigo_proveedor:'GA0300200225C', descripcion:'GAB.ESTANCO P.CIEGA 300X200X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('62.880,94') },
  { codigo_proveedor:'GA0300300225C', descripcion:'GAB.ESTANCO P.CIEGA 300X300X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('68.287,50') },
  { codigo_proveedor:'GA0450300225C', descripcion:'GAB.ESTANCO P.CIEGA 450X300X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('87.091,30') },
  { codigo_proveedor:'GA0450450225C', descripcion:'GAB.ESTANCO P.CIEGA 450X450X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('118.838,45') },
  { codigo_proveedor:'GA0500400225C', descripcion:'GAB.ESTANCO P.CIEGA 500X400X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('116.682,54') },
  { codigo_proveedor:'GA0600300225C', descripcion:'GAB.ESTANCO P.CIEGA 600X300X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('107.874,45') },
  { codigo_proveedor:'GA0600450225C', descripcion:'GAB.ESTANCO P.CIEGA 600X450X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('141.144,80') },
  { codigo_proveedor:'GA0600500225C', descripcion:'GAB.ESTANCO P.CIEGA 600X500X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('158.199,75') },
  { codigo_proveedor:'GA0600600225C', descripcion:'GAB.ESTANCO P.CIEGA 600X600X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('173.192,97') },
  { codigo_proveedor:'GA0750450225C', descripcion:'GAB.ESTANCO P.CIEGA 750X450X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('162.207,58') },
  { codigo_proveedor:'GA0750600225C', descripcion:'GAB.ESTANCO P.CIEGA 750X600X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('201.893,52') },
  { codigo_proveedor:'GA0750750225C', descripcion:'GAB.ESTANCO P.CIEGA 750X750X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('253.678,21') },
  { codigo_proveedor:'GA0900600225C', descripcion:'GAB.ESTANCO P.CIEGA 900X600X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('237.521,80') },
  { codigo_proveedor:'GA0900750225C', descripcion:'GAB.ESTANCO P.CIEGA 900X750X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('294.858,95') },
  { codigo_proveedor:'GA0900900225C', descripcion:'GAB.ESTANCO P.CIEGA 900X900X225',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('381.504,85') },
  { codigo_proveedor:'GA1050600225C', descripcion:'GAB.ESTANCO P.CIEGA 1050X600X225',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('271.810,80') },
  { codigo_proveedor:'GA1200600225C', descripcion:'GAB.ESTANCO P.CIEGA 1200X600X225',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('313.825,66') },
  { codigo_proveedor:'GA1200750225C', descripcion:'GAB.ESTANCO P.CIEGA 1200X750X225',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('393.145,29') },
  { codigo_proveedor:'GA1200900225C', descripcion:'GAB.ESTANCO P.CIEGA 1200X900X225',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('482.319,54') },
  // Prof. 300
  { codigo_proveedor:'GA0300300300C', descripcion:'GAB.ESTANCO P.CIEGA 300X300X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('85.618,57') },
  { codigo_proveedor:'GA0450300300C', descripcion:'GAB.ESTANCO P.CIEGA 450X300X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('99.807,02') },
  { codigo_proveedor:'GA0450450300C', descripcion:'GAB.ESTANCO P.CIEGA 450X450X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('133.046,30') },
  { codigo_proveedor:'GA0600300300C', descripcion:'GAB.ESTANCO P.CIEGA 600X300X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('129.297,86') },
  { codigo_proveedor:'GA0600450300C', descripcion:'GAB.ESTANCO P.CIEGA 600X450X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('163.287,21') },
  { codigo_proveedor:'GA0600600300C', descripcion:'GAB.ESTANCO P.CIEGA 600X600X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('200.912,47') },
  { codigo_proveedor:'GA0750450300C', descripcion:'GAB.ESTANCO P.CIEGA 750X450X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('191.185,98') },
  { codigo_proveedor:'GA0750600300C', descripcion:'GAB.ESTANCO P.CIEGA 750X600X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('238.276,15') },
  { codigo_proveedor:'GA0750750300C', descripcion:'GAB.ESTANCO P.CIEGA 750X750X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('294.683,24') },
  { codigo_proveedor:'GA0900600300C', descripcion:'GAB.ESTANCO P.CIEGA 900X600X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('274.623,01') },
  { codigo_proveedor:'GA0900750300C', descripcion:'GAB.ESTANCO P.CIEGA 900X750X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('361.641,15') },
  { codigo_proveedor:'GA0900900300C', descripcion:'GAB.ESTANCO P.CIEGA 900X900X300',   ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('442.844,04') },
  { codigo_proveedor:'GA1050600300C', descripcion:'GAB.ESTANCO P.CIEGA 1050X600X300',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('306.739,26') },
  { codigo_proveedor:'GA1200600300C', descripcion:'GAB.ESTANCO P.CIEGA 1200X600X300',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('344.157,17') },
  { codigo_proveedor:'GA1200750300C', descripcion:'GAB.ESTANCO P.CIEGA 1200X750X300',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('464.966,41') },
  { codigo_proveedor:'GA1200900300C', descripcion:'GAB.ESTANCO P.CIEGA 1200X900X300',  ...gc('Gabinetes Estancos - Puerta Ciega'), precio_costo:p('552.552,94') },

  // GABINETES ESTANCOS - PUERTA TRANSPARENTE - Prof. 100
  { codigo_proveedor:'GA0450300100T', descripcion:'GAB.ESTANCO P.TRANSP. 450X300X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('101.880,07') },
  { codigo_proveedor:'GA0450450100T', descripcion:'GAB.ESTANCO P.TRANSP. 450X450X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('135.136,34') },
  { codigo_proveedor:'GA0600300100T', descripcion:'GAB.ESTANCO P.TRANSP. 600X300X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('124.039,83') },
  { codigo_proveedor:'GA0600450100T', descripcion:'GAB.ESTANCO P.TRANSP. 600X450X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('165.649,90') },
  { codigo_proveedor:'GA0600600100T', descripcion:'GAB.ESTANCO P.TRANSP. 600X600X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('209.462,48') },
  { codigo_proveedor:'GA0750600100T', descripcion:'GAB.ESTANCO P.TRANSP. 750X600X100',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('254.029,29') },
  // Prof. 150
  { codigo_proveedor:'GA0450300150T', descripcion:'GAB.ESTANCO P.TRANSP. 450X300X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('112.068,01') },
  { codigo_proveedor:'GA0450450150T', descripcion:'GAB.ESTANCO P.TRANSP. 450X450X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('147.176,88') },
  { codigo_proveedor:'GA0500400150T', descripcion:'GAB.ESTANCO P.TRANSP. 500X400X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('146.044,28') },
  { codigo_proveedor:'GA0600300150T', descripcion:'GAB.ESTANCO P.TRANSP. 600X300X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('137.528,76') },
  { codigo_proveedor:'GA0600450150T', descripcion:'GAB.ESTANCO P.TRANSP. 600X450X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('178.027,26') },
  { codigo_proveedor:'GA0600500150T', descripcion:'GAB.ESTANCO P.TRANSP. 600X500X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('192.783,94') },
  { codigo_proveedor:'GA0600600150T', descripcion:'GAB.ESTANCO P.TRANSP. 600X600X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('229.771,11') },
  { codigo_proveedor:'GA0750450150T', descripcion:'GAB.ESTANCO P.TRANSP. 750X450X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('218.684,21') },
  { codigo_proveedor:'GA0750600150T', descripcion:'GAB.ESTANCO P.TRANSP. 750X600X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('275.730,33') },
  { codigo_proveedor:'GA0900600150T', descripcion:'GAB.ESTANCO P.TRANSP. 900X600X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('310.351,51') },
  { codigo_proveedor:'GA0900750150T', descripcion:'GAB.ESTANCO P.TRANSP. 900X750X150',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('392.902,88') },
  { codigo_proveedor:'GA1050600150T', descripcion:'GAB.ESTANCO P.TRANSP. 1050X600X150', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('365.766,38') },
  { codigo_proveedor:'GA1200600150T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X600X150', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('424.247,80') },
  { codigo_proveedor:'GA1200750150T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X750X150', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('507.870,17') },
  // Prof. 225
  { codigo_proveedor:'GA0450300225T', descripcion:'GAB.ESTANCO P.TRANSP. 450X300X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('126.920,34') },
  { codigo_proveedor:'GA0450450225T', descripcion:'GAB.ESTANCO P.TRANSP. 450X450X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('162.329,24') },
  { codigo_proveedor:'GA0500400225T', descripcion:'GAB.ESTANCO P.TRANSP. 500X400X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('159.561,84') },
  { codigo_proveedor:'GA0600300225T', descripcion:'GAB.ESTANCO P.TRANSP. 600X300X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('156.743,18') },
  { codigo_proveedor:'GA0600450225T', descripcion:'GAB.ESTANCO P.TRANSP. 600X450X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('199.038,86') },
  { codigo_proveedor:'GA0600500225T', descripcion:'GAB.ESTANCO P.TRANSP. 600X500X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('212.548,83') },
  { codigo_proveedor:'GA0600600225T', descripcion:'GAB.ESTANCO P.TRANSP. 600X600X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('244.865,90') },
  { codigo_proveedor:'GA0750450225T', descripcion:'GAB.ESTANCO P.TRANSP. 750X450X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('241.699,81') },
  { codigo_proveedor:'GA0750600225T', descripcion:'GAB.ESTANCO P.TRANSP. 750X600X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('293.958,32') },
  { codigo_proveedor:'GA0750750225T', descripcion:'GAB.ESTANCO P.TRANSP. 750X750X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('375.956,51') },
  { codigo_proveedor:'GA0900600225T', descripcion:'GAB.ESTANCO P.TRANSP. 900X600X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('326.868,03') },
  { codigo_proveedor:'GA0900750225T', descripcion:'GAB.ESTANCO P.TRANSP. 900X750X225',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('417.526,08') },
  { codigo_proveedor:'GA1050600225T', descripcion:'GAB.ESTANCO P.TRANSP. 1050X600X225', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('405.939,50') },
  { codigo_proveedor:'GA1200600225T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X600X225', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('449.947,22') },
  { codigo_proveedor:'GA1200750225T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X750X225', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('535.694,45') },
  // Prof. 300
  { codigo_proveedor:'GA0450300300T', descripcion:'GAB.ESTANCO P.TRANSP. 450X300X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('147.406,36') },
  { codigo_proveedor:'GA0450450300T', descripcion:'GAB.ESTANCO P.TRANSP. 450X450X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('178.812,60') },
  { codigo_proveedor:'GA0600300300T', descripcion:'GAB.ESTANCO P.TRANSP. 600X300X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('173.289,97') },
  { codigo_proveedor:'GA0600450300T', descripcion:'GAB.ESTANCO P.TRANSP. 600X450X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('218.798,68') },
  { codigo_proveedor:'GA0600600300T', descripcion:'GAB.ESTANCO P.TRANSP. 600X600X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('267.550,43') },
  { codigo_proveedor:'GA0750450300T', descripcion:'GAB.ESTANCO P.TRANSP. 750X450X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('259.372,35') },
  { codigo_proveedor:'GA0750600300T', descripcion:'GAB.ESTANCO P.TRANSP. 750X600X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('336.056,07') },
  { codigo_proveedor:'GA0750750300T', descripcion:'GAB.ESTANCO P.TRANSP. 750X750X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('399.675,27') },
  { codigo_proveedor:'GA0900600300T', descripcion:'GAB.ESTANCO P.TRANSP. 900X600X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('371.736,60') },
  { codigo_proveedor:'GA0900750300T', descripcion:'GAB.ESTANCO P.TRANSP. 900X750X300',  ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('451.867,24') },
  { codigo_proveedor:'GA1050600300T', descripcion:'GAB.ESTANCO P.TRANSP. 1050X600X300', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('431.918,44') },
  { codigo_proveedor:'GA1200600300T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X600X300', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('477.120,96') },
  { codigo_proveedor:'GA1200750300T', descripcion:'GAB.ESTANCO P.TRANSP. 1200X750X300', ...gc('Gabinetes Estancos - Puerta Transparente'), precio_costo:p('568.421,46') },

  // CONTRAFRENTES ENTEROS FIJOS - CIEGOS
  { codigo_proveedor:'CE0300300CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 300X300',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('11.857,14') },
  { codigo_proveedor:'CE0450300CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 450X300',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('17.252,52') },
  { codigo_proveedor:'CE0450450CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 450X450',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('23.878,93') },
  { codigo_proveedor:'CE0500400CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 500X400',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('23.088,83') },
  { codigo_proveedor:'CE0600300CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 600X300',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('20.487,10') },
  { codigo_proveedor:'CE0600450CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 600X450',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('29.466,13') },
  { codigo_proveedor:'CE0600500CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 600X500',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('32.805,09') },
  { codigo_proveedor:'CE0600600CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 600X600',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('38.229,07') },
  { codigo_proveedor:'CE0750450CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 750X450',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('35.810,46') },
  { codigo_proveedor:'CE0750600CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 750X600',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('47.010,44') },
  { codigo_proveedor:'CE0750750CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 750X750',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('60.131,79') },
  { codigo_proveedor:'CE0900600CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 900X600',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('57.087,19') },
  { codigo_proveedor:'CE0900750CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 900X750',      ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('70.389,12') },
  { codigo_proveedor:'CE1050600CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 1050X600',     ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('66.182,07') },
  { codigo_proveedor:'CE1200600CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 1200X600',     ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('73.761,39') },
  { codigo_proveedor:'CE1200750CF',  descripcion:'CONTRAFRENTE ENTERO FIJO CIEGO 1200X750',     ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('93.959,32') },
  // FIJOS - CALADOS
  { codigo_proveedor:'CE0300300KF2', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 300X300 2R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('12.212,85') },
  { codigo_proveedor:'CE0450300KF2', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 450X300 2R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('17.770,10') },
  { codigo_proveedor:'CE0450300KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 450X300 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('17.942,62') },
  { codigo_proveedor:'CE0450450KF2', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 450X450 2R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('24.595,30') },
  { codigo_proveedor:'CE0450450KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 450X450 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('24.834,09') },
  { codigo_proveedor:'CE0500400KF2', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 500X400 2R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('23.781,50') },
  { codigo_proveedor:'CE0600300KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 600X300 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('21.101,71') },
  { codigo_proveedor:'CE0600300KF4', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 600X300 4R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('21.306,59') },
  { codigo_proveedor:'CE0600450KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 600X450 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('30.350,11') },
  { codigo_proveedor:'CE0600500KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 600X500 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('33.789,24') },
  { codigo_proveedor:'CE0600600KF3', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 600X600 3R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('39.375,94') },
  { codigo_proveedor:'CE0750450KF4', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 750X450 4R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('36.884,78') },
  { codigo_proveedor:'CE0750600KF4', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 750X600 4R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('48.420,75') },
  { codigo_proveedor:'CE0750750KF4', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 750X750 4R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('61.935,74') },
  { codigo_proveedor:'CE0900600KF5', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 900X600 5R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('58.799,80') },
  { codigo_proveedor:'CE0900750KF5', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 900X750 5R',  ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('72.500,80') },
  { codigo_proveedor:'CE1050600KF6', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 1050X600 6R', ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('68.167,53') },
  { codigo_proveedor:'CE1200600KF7', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 1200X600 7R', ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('75.974,23') },
  { codigo_proveedor:'CE1200750KF7', descripcion:'CONTRAFRENTE ENTERO FIJO CALADO 1200X750 7R', ...gc('Contrafrentes Enteros Fijos'), precio_costo:p('96.778,10') },

  // CONTRAFRENTES ENTEROS ABISAGRADOS - CIEGOS
  { codigo_proveedor:'CE0300300CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 300X300',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('12.687,14') },
  { codigo_proveedor:'CE0450300CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 450X300',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('18.460,20') },
  { codigo_proveedor:'CE0450450CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 450X450',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('25.550,45') },
  { codigo_proveedor:'CE0500400CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 500X400',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('24.705,05') },
  { codigo_proveedor:'CE0600300CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 600X300',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('21.921,20') },
  { codigo_proveedor:'CE0600450CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 600X450',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('31.528,75') },
  { codigo_proveedor:'CE0600500CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 600X500',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('35.101,44') },
  { codigo_proveedor:'CE0600600CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 600X600',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('40.905,10') },
  { codigo_proveedor:'CE0750450CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 750X450',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('38.317,20') },
  { codigo_proveedor:'CE0750600CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 750X600',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('50.301,17') },
  { codigo_proveedor:'CE0750750CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 750X750',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('64.341,01') },
  { codigo_proveedor:'CE0900600CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 900X600',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('61.083,29') },
  { codigo_proveedor:'CE0900750CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 900X750',      ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('75.316,36') },
  { codigo_proveedor:'CE1050600CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 1050X600',     ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('70.814,82') },
  { codigo_proveedor:'CE1200600CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 1200X600',     ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('78.924,68') },
  { codigo_proveedor:'CE1200750CA',  descripcion:'CONTRAFRENTE ENTERO ABIS. CIEGO 1200X750',     ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('100.536,47') },
  // ABISAGRADOS - CALADOS
  { codigo_proveedor:'CE0300300KA2', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 300X300 2R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('13.067,75') },
  { codigo_proveedor:'CE0450300KA2', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 450X300 2R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('19.014,00') },
  { codigo_proveedor:'CE0450300KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 450X300 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('19.198,60') },
  { codigo_proveedor:'CE0450450KA2', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 450X450 2R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('26.316,97') },
  { codigo_proveedor:'CE0450450KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 450X450 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('26.572,47') },
  { codigo_proveedor:'CE0500400KA2', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 500X400 2R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('25.446,20') },
  { codigo_proveedor:'CE0600300KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 600X300 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('22.578,83') },
  { codigo_proveedor:'CE0600300KA4', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 600X300 4R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('22.798,05') },
  { codigo_proveedor:'CE0600450KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 600X450 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('32.474,62') },
  { codigo_proveedor:'CE0600500KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 600X500 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('36.154,49') },
  { codigo_proveedor:'CE0600600KA3', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 600X600 3R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('42.132,26') },
  { codigo_proveedor:'CE0750450KA4', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 750X450 4R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('39.466,71') },
  { codigo_proveedor:'CE0750600KA4', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 750X600 4R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('51.810,20') },
  { codigo_proveedor:'CE0750750KA4', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 750X750 4R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('66.271,24') },
  { codigo_proveedor:'CE0900600KA5', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 900X600 5R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('62.915,79') },
  { codigo_proveedor:'CE0900750KA5', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 900X750 5R',  ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('77.575,85') },
  { codigo_proveedor:'CE1050600KA6', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 1050X600 6R', ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('72.939,26') },
  { codigo_proveedor:'CE1200600KA7', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 1200X600 7R', ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('81.292,43') },
  { codigo_proveedor:'CE1200750KA7', descripcion:'CONTRAFRENTE ENTERO ABIS. CALADO 1200X750 7R', ...gc('Contrafrentes Enteros Abisagrados'), precio_costo:p('103.552,56') },

  // CONTRAFRENTES PARCIALES
  { codigo_proveedor:'CP0300C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 300',   ...gc('Contrafrentes Parciales'), precio_costo:p('5.901,64') },
  { codigo_proveedor:'CP0400C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 400',   ...gc('Contrafrentes Parciales'), precio_costo:p('10.017,09') },
  { codigo_proveedor:'CP0450C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 450',   ...gc('Contrafrentes Parciales'), precio_costo:p('8.848,88') },
  { codigo_proveedor:'CP0500C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 500',   ...gc('Contrafrentes Parciales'), precio_costo:p('9.477,93') },
  { codigo_proveedor:'CP0600C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 600',   ...gc('Contrafrentes Parciales'), precio_costo:p('12.087,61') },
  { codigo_proveedor:'CP0750C', descripcion:'CONTRAFRENTE PARCIAL FIJO CIEGO 750',   ...gc('Contrafrentes Parciales'), precio_costo:p('15.330,10') },
  { codigo_proveedor:'CP0300K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 300',  ...gc('Contrafrentes Parciales'), precio_costo:p('5.861,48') },
  { codigo_proveedor:'CP0400K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 400',  ...gc('Contrafrentes Parciales'), precio_costo:p('9.806,66') },
  { codigo_proveedor:'CP0450K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 450',  ...gc('Contrafrentes Parciales'), precio_costo:p('11.382,10') },
  { codigo_proveedor:'CP0500K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 500',  ...gc('Contrafrentes Parciales'), precio_costo:p('9.359,38') },
  { codigo_proveedor:'CP0600K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 600',  ...gc('Contrafrentes Parciales'), precio_costo:p('15.544,98') },
  { codigo_proveedor:'CP0750K', descripcion:'CONTRAFRENTE PARCIAL FIJO CALADO 750',  ...gc('Contrafrentes Parciales'), precio_costo:p('19.708,97') },

  // CARATULAS
  { codigo_proveedor:'CA0300C', descripcion:'CARATULA GABINETE 300 KIT X2', ...gc('Accesorios Gabinetes'), precio_costo:p('3.240,62') },
  { codigo_proveedor:'CA0450C', descripcion:'CARATULA GABINETE 450 KIT X2', ...gc('Accesorios Gabinetes'), precio_costo:p('4.330,44') },
  { codigo_proveedor:'CA0500C', descripcion:'CARATULA GABINETE 500 KIT X2', ...gc('Accesorios Gabinetes'), precio_costo:p('5.203,35') },
  { codigo_proveedor:'CA0600C', descripcion:'CARATULA GABINETE 600 KIT X2', ...gc('Accesorios Gabinetes'), precio_costo:p('5.759,97') },
  { codigo_proveedor:'CA0750C', descripcion:'CARATULA GABINETE 750 KIT X2', ...gc('Accesorios Gabinetes'), precio_costo:p('7.304,45') },

  // RIELES DIN
  { codigo_proveedor:'RD0200X', descripcion:'RIEL DIN 200',  ...gc('Accesorios Gabinetes'), precio_costo:p('1.244,20') },
  { codigo_proveedor:'RD0250X', descripcion:'RIEL DIN 250',  ...gc('Accesorios Gabinetes'), precio_costo:p('1.441,56') },
  { codigo_proveedor:'RD0300X', descripcion:'RIEL DIN 300',  ...gc('Accesorios Gabinetes'), precio_costo:p('1.866,82') },
  { codigo_proveedor:'RD0400X', descripcion:'RIEL DIN 400',  ...gc('Accesorios Gabinetes'), precio_costo:p('2.398,46') },
  { codigo_proveedor:'RD0450X', descripcion:'RIEL DIN 450',  ...gc('Accesorios Gabinetes'), precio_costo:p('2.542,63') },
  { codigo_proveedor:'RD0500X', descripcion:'RIEL DIN 500',  ...gc('Accesorios Gabinetes'), precio_costo:p('3.051,41') },
  { codigo_proveedor:'RD0600X', descripcion:'RIEL DIN 600',  ...gc('Accesorios Gabinetes'), precio_costo:p('3.522,33') },
  { codigo_proveedor:'RD0750X', descripcion:'RIEL DIN 750',  ...gc('Accesorios Gabinetes'), precio_costo:p('4.015,83') },
  // RIELES DIN MODULARES
  { codigo_proveedor:'RDM0600', descripcion:'RIEL DIN MODULAR 600', ...gc('Accesorios Gabinetes'), precio_costo:p('3.522,33') },
  { codigo_proveedor:'RDM0750', descripcion:'RIEL DIN MODULAR 750', ...gc('Accesorios Gabinetes'), precio_costo:p('4.015,83') },
  { codigo_proveedor:'RDM0900', descripcion:'RIEL DIN MODULAR 900', ...gc('Accesorios Gabinetes'), precio_costo:p('4.819,00') },
  // RIELES DIN MULTIOBLONGO (x10 unidades)
  { codigo_proveedor:'RD0500MO', descripcion:'RIEL DIN 500 MULTIOBLONGO X10',  ...gc('Accesorios Gabinetes'), unidad:'KIT', precio_costo:p('13.947,88') },
  { codigo_proveedor:'RD1000MO', descripcion:'RIEL DIN 1000 MULTIOBLONGO X10', ...gc('Accesorios Gabinetes'), unidad:'KIT', precio_costo:p('24.006,50') },
  { codigo_proveedor:'RD1500MO', descripcion:'RIEL DIN 1500 MULTIOBLONGO X10', ...gc('Accesorios Gabinetes'), unidad:'KIT', precio_costo:p('40.643,24') },
  { codigo_proveedor:'RD2000MO', descripcion:'RIEL DIN 2000 MULTIOBLONGO X10', ...gc('Accesorios Gabinetes'), unidad:'KIT', precio_costo:p('53.231,79') },

  // CABALLETES (KIT X2)
  { codigo_proveedor:'SO150',  descripcion:'CABALLETE PROF. 150 KIT X2',            ...gc('Accesorios Gabinetes'), precio_costo:p('4.964,78') },
  { codigo_proveedor:'SO225',  descripcion:'CABALLETE PROF. 225 KIT X2',            ...gc('Accesorios Gabinetes'), precio_costo:p('5.724,15') },
  { codigo_proveedor:'SO300',  descripcion:'CABALLETE PROF. 300 KIT X2',            ...gc('Accesorios Gabinetes'), precio_costo:p('6.540,58') },
  { codigo_proveedor:'SOM225', descripcion:'CABALLETE TELESCOPICO PROF. 225',       ...gc('Accesorios Gabinetes'), precio_costo:p('5.335,15') },
  { codigo_proveedor:'SOM300', descripcion:'CABALLETE TELESCOPICO PROF. 300',       ...gc('Accesorios Gabinetes'), precio_costo:p('6.240,12') },

  // PORTA-ELEMENTOS
  { codigo_proveedor:'PE0500', descripcion:'PORTA-ELEMENTOS 500',         ...gc('Accesorios Gabinetes'), precio_costo:p('6.133,31') },
  { codigo_proveedor:'PE0600', descripcion:'PORTA-ELEMENTOS 600',         ...gc('Accesorios Gabinetes'), precio_costo:p('7.359,99') },
  { codigo_proveedor:'PE0750', descripcion:'PORTA-ELEMENTOS 750',         ...gc('Accesorios Gabinetes'), precio_costo:p('9.199,99') },
  { codigo_proveedor:'PEM0600', descripcion:'PORTA-ELEMENTOS MODULAR 600', ...gc('Accesorios Gabinetes'), precio_costo:p('5.528,22') },
  { codigo_proveedor:'PEM0750', descripcion:'PORTA-ELEMENTOS MODULAR 750', ...gc('Accesorios Gabinetes'), precio_costo:p('6.896,89') },
  { codigo_proveedor:'PEM0900', descripcion:'PORTA-ELEMENTOS MODULAR 900', ...gc('Accesorios Gabinetes'), precio_costo:p('8.193,67') },

  // TAPA MODULO DIN
  { codigo_proveedor:'R500/M', descripcion:'TAPA MODULO DIN X30 UNIDADES PARA 4 MODULOS', ...gc('Accesorios Gabinetes'), unidad:'KIT', precio_costo:p('9.477,53') },

  // GABINETES ARMADOS - PUERTA CIEGA
  { codigo_proveedor:'GC0300300100C',  descripcion:'GAB.ARMADO P.CIEGA 300X300X100',       ...gc('Gabinetes Armados'), precio_costo:p('67.060,30') },
  { codigo_proveedor:'GC0450300100C',  descripcion:'GAB.ARMADO P.CIEGA 450X300X100',       ...gc('Gabinetes Armados'), precio_costo:p('85.542,84') },
  { codigo_proveedor:'GC0450300100CE', descripcion:'GAB.ARMADO P.CIEGA 450X300X100 EXT.',  ...gc('Gabinetes Armados'), precio_costo:p('87.424,78') },
  { codigo_proveedor:'GC0450450100C',  descripcion:'GAB.ARMADO P.CIEGA 450X450X100',       ...gc('Gabinetes Armados'), precio_costo:p('110.592,33') },
  { codigo_proveedor:'GC0450450100CE', descripcion:'GAB.ARMADO P.CIEGA 450X450X100 EXT.',  ...gc('Gabinetes Armados'), precio_costo:p('112.804,14') },
  { codigo_proveedor:'GC0600300100C',  descripcion:'GAB.ARMADO P.CIEGA 600X300X100',       ...gc('Gabinetes Armados'), precio_costo:p('104.771,64') },
  { codigo_proveedor:'GC0600300100CE', descripcion:'GAB.ARMADO P.CIEGA 600X300X100 EXT.',  ...gc('Gabinetes Armados'), precio_costo:p('107.914,83') },
  { codigo_proveedor:'GC0600450100C',  descripcion:'GAB.ARMADO P.CIEGA 600X450X100',       ...gc('Gabinetes Armados'), precio_costo:p('132.686,31') },
  { codigo_proveedor:'GC0600600100C',  descripcion:'GAB.ARMADO P.CIEGA 600X600X100',       ...gc('Gabinetes Armados'), precio_costo:p('163.624,14') },
  { codigo_proveedor:'GC0750600100C',  descripcion:'GAB.ARMADO P.CIEGA 750X600X100',       ...gc('Gabinetes Armados'), precio_costo:p('200.756,26') },
  { codigo_proveedor:'GC0900600100C',  descripcion:'GAB.ARMADO P.CIEGA 900X600X100',       ...gc('Gabinetes Armados'), precio_costo:p('231.682,34') },
  // GABINETES ARMADOS - PUERTA TRANSPARENTE
  { codigo_proveedor:'GC0450300100T',  descripcion:'GAB.ARMADO P.TRANSP. 450X300X100',      ...gc('Gabinetes Armados'), precio_costo:p('135.226,59') },
  { codigo_proveedor:'GC0450300100TE', descripcion:'GAB.ARMADO P.TRANSP. 450X300X100 EXT.', ...gc('Gabinetes Armados'), precio_costo:p('137.186,75') },
  { codigo_proveedor:'GC0450450100T',  descripcion:'GAB.ARMADO P.TRANSP. 450X450X100',      ...gc('Gabinetes Armados'), precio_costo:p('182.592,55') },
  { codigo_proveedor:'GC0450450100TE', descripcion:'GAB.ARMADO P.TRANSP. 450X450X100 EXT.', ...gc('Gabinetes Armados'), precio_costo:p('185.262,31') },
  { codigo_proveedor:'GC0600300100T',  descripcion:'GAB.ARMADO P.TRANSP. 600X300X100',      ...gc('Gabinetes Armados'), precio_costo:p('169.232,31') },
  { codigo_proveedor:'GC0600300100TE', descripcion:'GAB.ARMADO P.TRANSP. 600X300X100 EXT.', ...gc('Gabinetes Armados'), precio_costo:p('171.192,47') },
  { codigo_proveedor:'GC0600450100T',  descripcion:'GAB.ARMADO P.TRANSP. 600X450X100',      ...gc('Gabinetes Armados'), precio_costo:p('222.713,40') },
  { codigo_proveedor:'GC0600600100T',  descripcion:'GAB.ARMADO P.TRANSP. 600X600X100',      ...gc('Gabinetes Armados'), precio_costo:p('281.222,10') },
  { codigo_proveedor:'GC0750600100T',  descripcion:'GAB.ARMADO P.TRANSP. 750X600X100',      ...gc('Gabinetes Armados'), precio_costo:p('341.144,19') },
  { codigo_proveedor:'GC0900600100T',  descripcion:'GAB.ARMADO P.TRANSP. 900X600X100',      ...gc('Gabinetes Armados'), precio_costo:p('399.138,70') },

  // GABINETES CCTV
  { codigo_proveedor:'GCCTV454522C', descripcion:'GAB.CIRCUITO CERRADO TV 450X450X225', ...gc('Gabinetes CCTV'), precio_costo:p('200.965,06') },
  { codigo_proveedor:'GCCTV604522C', descripcion:'GAB.CIRCUITO CERRADO TV 600X450X225', ...gc('Gabinetes CCTV'), precio_costo:p('223.674,11') },

  // GABINETES ESTANCOS CON DUCTO (codigos corregidos lista #29)
  { codigo_proveedor:'GD0900900225C',   descripcion:'GAB.ESTANCO CON DUCTO 900X900X225 P.CIEGA',    ...gc('Gabinetes con Ducto'), precio_costo:p('607.540,95') },
  { codigo_proveedor:'GD0900900300C',   descripcion:'GAB.ESTANCO CON DUCTO 900X900X300 P.CIEGA',    ...gc('Gabinetes con Ducto'), precio_costo:p('640.745,04') },
  { codigo_proveedor:'GD09001050225C',  descripcion:'GAB.ESTANCO CON DUCTO 900X1050X225 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('662.135,96') },
  { codigo_proveedor:'GD09001050300C',  descripcion:'GAB.ESTANCO CON DUCTO 900X1050X300 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('710.073,47') },
  { codigo_proveedor:'GD09001200225C',  descripcion:'GAB.ESTANCO CON DUCTO 900X1200X225 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('726.833,20') },
  { codigo_proveedor:'GD09001200300C',  descripcion:'GAB.ESTANCO CON DUCTO 900X1200X300 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('777.470,48') },
  { codigo_proveedor:'GD1200900225C',   descripcion:'GAB.ESTANCO CON DUCTO 1200X900X225 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('730.637,64') },
  { codigo_proveedor:'GD1200900300C',   descripcion:'GAB.ESTANCO CON DUCTO 1200X900X300 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('761.321,64') },
  { codigo_proveedor:'GD12001050225C',  descripcion:'GAB.ESTANCO CON DUCTO 1200X1050X225 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('797.766,02') },
  { codigo_proveedor:'GD12001050300C',  descripcion:'GAB.ESTANCO CON DUCTO 1200X1050X300 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('849.783,75') },
  { codigo_proveedor:'GD12001200225C',  descripcion:'GAB.ESTANCO CON DUCTO 1200X1200X225 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('854.612,01') },
  { codigo_proveedor:'GD12001200300C',  descripcion:'GAB.ESTANCO CON DUCTO 1200X1200X300 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('889.865,53') },
  { codigo_proveedor:'GD1500900225C',   descripcion:'GAB.ESTANCO CON DUCTO 1500X900X225 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('851.211,57') },
  { codigo_proveedor:'GD1500900300C',   descripcion:'GAB.ESTANCO CON DUCTO 1500X900X300 P.CIEGA',   ...gc('Gabinetes con Ducto'), precio_costo:p('890.349,46') },
  { codigo_proveedor:'GD15001050225C',  descripcion:'GAB.ESTANCO CON DUCTO 1500X1050X225 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('924.410,32') },
  { codigo_proveedor:'GD15001050300C',  descripcion:'GAB.ESTANCO CON DUCTO 1500X1050X300 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('969.466,19') },
  { codigo_proveedor:'GD15001200225C',  descripcion:'GAB.ESTANCO CON DUCTO 1500X1200X225 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('1.000.180,88') },
  { codigo_proveedor:'GD15001200300C',  descripcion:'GAB.ESTANCO CON DUCTO 1500X1200X300 P.CIEGA',  ...gc('Gabinetes con Ducto'), precio_costo:p('1.049.962,11') },

  // CONTRAFRENTES CON DUCTO / HIBRIDO
  { codigo_proveedor:'CEDH900600KA5',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X600 5R ABIS. CALADO',    ...gc('Contrafrentes con Ducto'), precio_costo:p('88.335,11') },
  { codigo_proveedor:'CEDH900600CA',    descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X600 ABIS. CIEGO',        ...gc('Contrafrentes con Ducto'), precio_costo:p('89.442,79') },
  { codigo_proveedor:'CEDH900750KA5',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X750 5R ABIS. CALADO',    ...gc('Contrafrentes con Ducto'), precio_costo:p('98.309,02') },
  { codigo_proveedor:'CEDH900750CA',    descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X750 ABIS. CIEGO',        ...gc('Contrafrentes con Ducto'), precio_costo:p('99.658,24') },
  { codigo_proveedor:'CEDH900900KA5',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X900 5R ABIS. CALADO',    ...gc('Contrafrentes con Ducto'), precio_costo:p('109.456,14') },
  { codigo_proveedor:'CEDH900900CA',    descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 900X900 ABIS. CIEGO',        ...gc('Contrafrentes con Ducto'), precio_costo:p('111.034,29') },
  { codigo_proveedor:'CEDH1200600KA7',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X600 7R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('108.485,65') },
  { codigo_proveedor:'CEDH1200600CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X600 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('111.068,64') },
  { codigo_proveedor:'CEDH1200750KA7',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X750 7R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('125.674,90') },
  { codigo_proveedor:'CEDH1200750CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X750 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('127.386,42') },
  { codigo_proveedor:'CEDH1200900KA7',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X900 7R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('177.229,53') },
  { codigo_proveedor:'CEDH1200900CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1200X900 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('178.926,17') },
  { codigo_proveedor:'CEDH1500600KA9',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X600 9R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('126.996,77') },
  { codigo_proveedor:'CEDH1500600CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X600 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('128.635,85') },
  { codigo_proveedor:'CEDH1500750KA9',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X750 9R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('140.491,79') },
  { codigo_proveedor:'CEDH1500750CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X750 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('142.565,62') },
  { codigo_proveedor:'CEDH1500900KA9',  descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X900 9R ABIS. CALADO',   ...gc('Contrafrentes con Ducto'), precio_costo:p('183.349,07') },
  { codigo_proveedor:'CEDH1500900CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1500X900 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('183.454,07') },
  { codigo_proveedor:'CEDH1800600KA11', descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1800X600 11R ABIS. CALADO',  ...gc('Contrafrentes con Ducto'), precio_costo:p('155.935,96') },
  { codigo_proveedor:'CEDH1800600CA',   descripcion:'CONTRAF.ENTERO C/DUCTO-HIBRIDO 1800X600 ABIS. CIEGO',       ...gc('Contrafrentes con Ducto'), precio_costo:p('155.935,96') },

  // GABINETES HIBRIDOS
  { codigo_proveedor:'GH0900900225C', descripcion:'GAB.ESTANCO HIBRIDO 900X900X225 P.CIEGA',    ...gc('Gabinetes Hibridos'), precio_costo:p('431.100,48') },
  { codigo_proveedor:'GH0900900300C', descripcion:'GAB.ESTANCO HIBRIDO 900X900X300 P.CIEGA',    ...gc('Gabinetes Hibridos'), precio_costo:p('487.128,44') },
  { codigo_proveedor:'GH1200600225C', descripcion:'GAB.ESTANCO HIBRIDO 1200X600X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('352.680,27') },
  { codigo_proveedor:'GH1200600300C', descripcion:'GAB.ESTANCO HIBRIDO 1200X600X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('378.572,89') },
  { codigo_proveedor:'GH1200750225C', descripcion:'GAB.ESTANCO HIBRIDO 1200X750X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('432.459,82') },
  { codigo_proveedor:'GH1200750300C', descripcion:'GAB.ESTANCO HIBRIDO 1200X750X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('511.463,05') },
  { codigo_proveedor:'GH1200900225C', descripcion:'GAB.ESTANCO HIBRIDO 1200X900X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('545.021,08') },
  { codigo_proveedor:'GH1200900300C', descripcion:'GAB.ESTANCO HIBRIDO 1200X900X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('607.808,24') },
  { codigo_proveedor:'GH1500600225C', descripcion:'GAB.ESTANCO HIBRIDO 1500X600X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('501.123,82') },
  { codigo_proveedor:'GH1500600300C', descripcion:'GAB.ESTANCO HIBRIDO 1500X600X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('537.914,68') },
  { codigo_proveedor:'GH1500750225C', descripcion:'GAB.ESTANCO HIBRIDO 1500X750X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('582.702,12') },
  { codigo_proveedor:'GH1500750300C', descripcion:'GAB.ESTANCO HIBRIDO 1500X750X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('624.323,70') },
  { codigo_proveedor:'GH1500900225C', descripcion:'GAB.ESTANCO HIBRIDO 1500X900X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('670.107,44') },
  { codigo_proveedor:'GH1500900300C', descripcion:'GAB.ESTANCO HIBRIDO 1500X900X300 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('721.926,31') },
  { codigo_proveedor:'GH1800600225C', descripcion:'GAB.ESTANCO HIBRIDO 1800X600X225 P.CIEGA',   ...gc('Gabinetes Hibridos'), precio_costo:p('601.348,59') },

  // GABINETES PETROLEROS - CON ZOCALO
  { codigo_proveedor:'GP756040ZC',  descripcion:'GAB.USO EXTREMO 750X600X400 CON ZOCALO',  ...gc('Gabinetes Petroleros'), precio_costo:p('808.950,65') },
  { codigo_proveedor:'GP906040ZC',  descripcion:'GAB.USO EXTREMO 900X600X400 CON ZOCALO',  ...gc('Gabinetes Petroleros'), precio_costo:p('823.884,17') },
  { codigo_proveedor:'GP1207540ZC', descripcion:'GAB.USO EXTREMO 1200X750X400 CON ZOCALO', ...gc('Gabinetes Petroleros'), precio_costo:p('982.482,23') },
  { codigo_proveedor:'GP1507550ZC', descripcion:'GAB.USO EXTREMO 1500X750X500 CON ZOCALO', ...gc('Gabinetes Petroleros'), precio_costo:p('1.353.337,60') },
  { codigo_proveedor:'GP1708050ZC', descripcion:'GAB.USO EXTREMO 1700X800X500 CON ZOCALO', ...gc('Gabinetes Petroleros'), precio_costo:p('1.586.125,13') },
  // GABINETES PETROLEROS - CON TRINEO
  { codigo_proveedor:'GP756040TR',  descripcion:'GAB.USO EXTREMO 750X600X400 CON TRINEO',  ...gc('Gabinetes Petroleros'), precio_costo:p('1.025.089,75') },
  { codigo_proveedor:'GP906040TR',  descripcion:'GAB.USO EXTREMO 900X600X400 CON TRINEO',  ...gc('Gabinetes Petroleros'), precio_costo:p('1.043.443,59') },
  { codigo_proveedor:'GP1207540TR', descripcion:'GAB.USO EXTREMO 1200X750X400 CON TRINEO', ...gc('Gabinetes Petroleros'), precio_costo:p('1.210.741,02') },
  { codigo_proveedor:'GP1507550TR', descripcion:'GAB.USO EXTREMO 1500X750X500 CON TRINEO', ...gc('Gabinetes Petroleros'), precio_costo:p('1.623.215,56') },
  { codigo_proveedor:'GP1708050TR', descripcion:'GAB.USO EXTREMO 1700X800X500 CON TRINEO', ...gc('Gabinetes Petroleros'), precio_costo:p('1.862.192,32') },

  // CONTRAFRENTES PETROLEROS
  { codigo_proveedor:'GPCF7560CA',  descripcion:'CONTRAFRENTE PETROLERO 750X600',   ...gc('Gabinetes Petroleros'), precio_costo:p('65.371,51') },
  { codigo_proveedor:'GPCF9060CA',  descripcion:'CONTRAFRENTE PETROLERO 900X600',   ...gc('Gabinetes Petroleros'), precio_costo:p('73.834,50') },
  { codigo_proveedor:'GPCF12075CA', descripcion:'CONTRAFRENTE PETROLERO 1200X750',  ...gc('Gabinetes Petroleros'), precio_costo:p('117.590,40') },
  { codigo_proveedor:'GPCF15075CA', descripcion:'CONTRAFRENTE PETROLERO 1500X750',  ...gc('Gabinetes Petroleros'), precio_costo:p('146.988,00') },
  { codigo_proveedor:'GPCF17080CA', descripcion:'CONTRAFRENTE PETROLERO 1700X800',  ...gc('Gabinetes Petroleros'), precio_costo:p('175.652,11') },
]

// HTTP helper
const request = (method, path, body, token) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : ''
  const opts = {
    hostname: SERVIDOR, port: PUERTO, path, method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
  const req = http.request(opts, res => {
    let buf = ''
    res.on('data', c => buf += c)
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
      catch { resolve({ status: res.statusCode, body: buf }) }
    })
  })
  req.on('error', reject)
  if (data) req.write(data)
  req.end()
})

// Genera codigos E-INTRA: 9A0R4XXXXX (MAT.ELECTRICO + GABINETE + ROKER + secuencial)
const PRODUCTOS = CATALOGO.map((item, i) => ({ ...item, codigo: ei(i + 1) }))

;(async () => {
  console.log(`Conectando a ${SERVIDOR}:${PUERTO}...`)
  const login = await request('POST', '/api/v1/auth/login', { username: USUARIO, password: PASSWORD })
  if (login.status !== 200 || !login.body.token) {
    console.error('Login fallido:', login.body); process.exit(1)
  }
  const token = login.body.token
  console.log('Login OK')
  console.log(`\nImportando ${PRODUCTOS.length} articulos (Lista Roker #29 - Sep 2025)...`)

  const result = await request('POST', '/api/v1/stock/importar', { productos: PRODUCTOS }, token)
  if (result.status !== 200) {
    console.error('Error:', result.body); process.exit(1)
  }
  console.log(`Creados     : ${result.body.creados}`)
  console.log(`Actualizados: ${result.body.actualizados} (precios actualizados)`)
  console.log(`Omitidos    : ${result.body.omitidos}`)
  console.log(`\nListo.`)
})()
