module.exports = {
  apps: [{
    name: 'playcode',
    script: './app.js',
    instances: 2,  // 2개 인스턴스 (t4g.small의 2 vCPU 활용)
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '900M',  // 메모리 900MB 초과 시 재시작
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
