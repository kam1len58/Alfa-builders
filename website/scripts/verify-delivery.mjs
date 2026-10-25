import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
const version = run('docker', ['version', '--format', '{{.Server.Version}}']);
const report = {
  node: process.version,
  docker: {
    available: !version.error && version.status === 0,
    reason: version.error ? 'CLI_NOT_FOUND' : version.status !== 0 ? 'ENGINE_UNAVAILABLE' : null,
  },
  containerRun: 'not_run',
};
if (process.argv.includes('--docker') && report.docker.available) {
  const args = ['compose', '--env-file', resolve(process.env.DELIVERY_ENV_FILE || '.env.local')];
  if (run('docker', [...args, 'config', '--quiet']).status !== 0) {
    report.containerRun = 'invalid_config';
    process.exitCode = 1;
  } else if (run('docker', [...args, 'up', '--build', '-d']).status !== 0) {
    report.containerRun = 'build_or_start_failed';
    process.exitCode = 1;
  } else {
    for (let i = 0; i < 45; i++) {
      try {
        const state = run('docker', [...args, 'ps', '--all', '--format', 'json']);
        const rows = state.stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            const value = JSON.parse(line);
            return Array.isArray(value) ? value : [value];
          });
        const web = rows.find((row) => row.Service === 'website'),
          api = rows.find((row) => row.Service === 'backend');
        const check =
          web?.State === 'running' && web.Health === 'healthy' && api?.State === 'running'
            ? run('docker', [
                ...args,
                'exec',
                '-T',
                'website',
                'node',
                '-e',
                'Promise.all([fetch("http://127.0.0.1:4173/api/session").then(r=>r.json()),fetch("http://backend:8080/api/Companies").then(r=>r.json())]).then(([s,c])=>process.exit(typeof s.authenticated==="boolean"&&Array.isArray(c)&&c.length>0?0:1)).catch(()=>process.exit(1))',
              ])
            : null;
        if (check?.status === 0) {
          report.containerRun = 'healthy_and_backend_verified_inside_container';
          report.containers = { website: web.ID, backend: api.ID };
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (report.containerRun === 'not_run') {
      report.containerRun = 'health_timeout';
      process.exitCode = 1;
    }
  }
} else if (process.argv.includes('--docker')) process.exitCode = 2;
console.log(JSON.stringify(report, null, 2));
