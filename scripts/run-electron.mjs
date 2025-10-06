import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

function ensureElectronBinary() {
  if (fs.existsSync(electronBinary)) {
    return;
  }
  const installScript = require.resolve('electron/install.js');
  const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`electron install.js exited with code ${result.status ?? 'null'}`);
  }
  if (!fs.existsSync(electronBinary)) {
    throw new Error('Electron binary not found after running install script.');
  }
}

function run() {
  ensureElectronBinary();
  const args = process.argv.slice(2);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, args, {
    stdio: 'inherit',
    env
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on('error', (error) => {
    console.error('Failed to start Electron:', error);
    process.exit(1);
  });
}

run();
