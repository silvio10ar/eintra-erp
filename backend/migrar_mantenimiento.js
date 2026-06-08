#!/usr/bin/env node
// Script de migración: inicializa la DB y aplica mantenimiento.sql
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { db, inicializar } = require('./db/database');
const fs = require('fs');

console.log('Inicializando esquema base...');
inicializar();
console.log('Esquema base OK.');

const sqlPath = path.join(__dirname, '..', 'mantenimiento.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log('Ejecutando mantenimiento.sql...');
try {
  db.exec(sql);
  console.log('Migración de mantenimiento completada.');
} catch (e) {
  console.error('Error en migración:', e.message);
  process.exit(1);
}

// Verificar resultados
const equipos = db.prepare('SELECT COUNT(*) as c FROM mant_equipos').get().c;
const tareas  = db.prepare('SELECT COUNT(*) as c FROM mant_tareas_preventivas').get().c;
const insp    = db.prepare('SELECT COUNT(*) as c FROM mant_inspecciones').get().c;
const bajas   = db.prepare("SELECT COUNT(*) as c FROM mant_equipos WHERE estado='baja'").get().c;

console.log(`\nResultados:`);
console.log(`  mant_equipos:              ${equipos} registros`);
console.log(`  mant_tareas_preventivas:   ${tareas} registros`);
console.log(`  mant_inspecciones:         ${insp} registros`);
console.log(`  Equipos dados de baja:     ${bajas}`);
