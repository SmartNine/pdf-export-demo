module.exports = {
  apps: [
    {
      name: 'pdf-export',
      script: './server.js',
      cwd: '/var/www/pdf-export/server',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
