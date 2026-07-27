module.exports = {
  apps: [
    {
      name: 'eintra-erp',
      script: 'server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
}
