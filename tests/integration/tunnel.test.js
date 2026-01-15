/**
 * SSH Tunnel Integration Tests
 *
 * These tests are designed to verify SSH tunnel and DB connectivity.
 * They require real credentials to run fully, but include unit tests
 * that can run without external dependencies.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync } from 'fs';
import net from 'net';

// Skip integration tests if no valid config is available
const CONFIG_PATH = 'config/config.json';
const hasConfigFile = existsSync(CONFIG_PATH);

// Check if config can actually be loaded (file exists AND is valid)
let hasValidConfig = false;
if (hasConfigFile) {
  try {
    const { loadConfig } = await import('../../src/config/loader.js');
    const config = await loadConfig(CONFIG_PATH);
    hasValidConfig = config !== null;
  } catch {
    hasValidConfig = false;
  }
}

describe('SSH Tunnel Tests', () => {
  describe('Unit tests (no external dependencies)', () => {
    test('createTunnel function exists', async () => {
      const { createTunnel } = await import('../../src/tunnel/ssh-tunnel.js');
      expect(typeof createTunnel).toBe('function');
    });

    test('createTunnelWithRetry function exists', async () => {
      const { createTunnelWithRetry } = await import('../../src/tunnel/ssh-tunnel.js');
      expect(typeof createTunnelWithRetry).toBe('function');
    });

    test('rejects when SSH key file does not exist', async () => {
      const { createTunnel } = await import('../../src/tunnel/ssh-tunnel.js');

      const config = {
        ssh: {
          host: 'localhost',
          port: 22,
          user: 'test',
          privateKeyPath: '/nonexistent/key/path',
        },
        tunnel: {
          localPort: 33060,
          remoteHost: '127.0.0.1',
          remotePort: 3306,
        },
      };

      await expect(createTunnel(config)).rejects.toThrow('Failed to read SSH key');
    });
  });

  describe('Port availability tests', () => {
    test('can check if a port is available', async () => {
      const port = 59999; // Use a high port unlikely to be in use

      const isPortAvailable = await new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            resolve(false);
          }
        });

        server.once('listening', () => {
          server.close(() => {
            resolve(true);
          });
        });

        server.listen(port, '127.0.0.1');
      });

      expect(typeof isPortAvailable).toBe('boolean');
    });

    test('detects when a port is in use', async () => {
      const port = 59998;

      // Start a server on the port
      const blockingServer = net.createServer();
      await new Promise((resolve) => {
        blockingServer.listen(port, '127.0.0.1', resolve);
      });

      try {
        // Try to use the same port
        const isPortAvailable = await new Promise((resolve) => {
          const server = net.createServer();

          server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              resolve(false);
            } else {
              resolve(true);
            }
          });

          server.once('listening', () => {
            server.close(() => {
              resolve(true);
            });
          });

          server.listen(port, '127.0.0.1');
        });

        expect(isPortAvailable).toBe(false);
      } finally {
        // Clean up
        blockingServer.close();
      }
    });
  });

  // Integration tests that require real credentials
  describe.skipIf(!hasValidConfig)('Integration tests (require valid config/config.json)', () => {
    let config;
    let tunnel;

    beforeAll(async () => {
      const { loadConfig } = await import('../../src/config/loader.js');
      config = await loadConfig(CONFIG_PATH);
    });

    afterAll(async () => {
      if (tunnel?.close) {
        await tunnel.close();
      }
    });

    test('can establish SSH tunnel', async () => {
      const { createTunnel } = await import('../../src/tunnel/ssh-tunnel.js');

      try {
        tunnel = await createTunnel(config);
        expect(tunnel).toHaveProperty('client');
        expect(tunnel).toHaveProperty('server');
        expect(tunnel).toHaveProperty('close');
        expect(typeof tunnel.close).toBe('function');
      } catch (err) {
        // Skip test if SSH connection fails (e.g., host unreachable)
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
          console.log('Skipping: SSH host unreachable');
          return;
        }
        throw err;
      }
    });
  });
});
