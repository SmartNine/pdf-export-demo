module.exports = {
  apps: [
    {
      name: 'pdf-export-server',
      script: './start.js',
      cwd: '/var/www/pdf-export/server',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
