/**
 * SSH Tunnel Manager for Driftwarden
 * Establishes and maintains SSH tunnels for secure MySQL access
 */

import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import net from 'net';
import { logger } from '../utils/logger.js';
import { withRetry, isRetryableError } from '../utils/retry.js';

/**
 * Create an SSH tunnel to forward local port to remote MySQL
 * @param {object} config - SSH and tunnel configuration
 * @returns {Promise<{client: Client, server: net.Server, close: Function}>}
 */
export async function createTunnel(config) {
  const { ssh, tunnel } = config;

  return new Promise((resolve, reject) => {
    const sshClient = new Client();
    let localServer = null;
    let isConnected = false;

    // Read private key
    let privateKey;
    try {
      privateKey = readFileSync(ssh.privateKeyPath, 'utf-8');
    } catch (err) {
      reject(new Error(`Failed to read SSH key: ${err.message}`));
      return;
    }

    // SSH connection config
    const sshConfig = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.user,
      privateKey,
      passphrase: ssh.passphrase || undefined,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    // Handle SSH connection ready
    sshClient.on('ready', () => {
      logger.info(`SSH connection established to ${ssh.host}:${ssh.port}`);
      isConnected = true;

      // Create local TCP server for tunnel
      localServer = net.createServer((localSocket) => {
        if (!isConnected) {
          localSocket.destroy();
          return;
        }

        // Forward connection through SSH tunnel
        sshClient.forwardOut(
          '127.0.0.1',
          tunnel.localPort,
          tunnel.remoteHost,
          tunnel.remotePort,
          (err, remoteSocket) => {
            if (err) {
              logger.error(`Tunnel forward error: ${err.message}`);
              localSocket.destroy();
              return;
            }

            // Pipe data between local and remote sockets
            localSocket.pipe(remoteSocket);
            remoteSocket.pipe(localSocket);

            localSocket.on('error', (err) => {
              logger.debug(`Local socket error: ${err.message}`);
              remoteSocket.destroy();
            });

            remoteSocket.on('error', (err) => {
              logger.debug(`Remote socket error: ${err.message}`);
              localSocket.destroy();
            });

            localSocket.on('close', () => remoteSocket.destroy());
            remoteSocket.on('close', () => localSocket.destroy());
          }
        );
      });

      localServer.on('error', (err) => {
        logger.error(`Local server error: ${err.message}`);
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${tunnel.localPort} is already in use`));
        }
      });

      // Start listening
      localServer.listen(tunnel.localPort, '127.0.0.1', () => {
        logger.info(`SSH tunnel listening on 127.0.0.1:${tunnel.localPort} -> ${tunnel.remoteHost}:${tunnel.remotePort}`);

        // Create close function
        const close = () => {
          return new Promise((resolveClose) => {
            isConnected = false;

            if (localServer) {
              localServer.close(() => {
                logger.debug('Local tunnel server closed');
              });
            }

            sshClient.end();
            logger.info('SSH tunnel closed');
            resolveClose();
          });
        };

        resolve({
          client: sshClient,
          server: localServer,
          close,
        });
      });
    });

    // Handle SSH errors
    sshClient.on('error', (err) => {
      logger.error(`SSH connection error: ${err.message}`);
      isConnected = false;
      reject(err);
    });

    // Handle SSH close
    sshClient.on('close', () => {
      logger.info('SSH connection closed');
      isConnected = false;
      if (localServer) {
        localServer.close();
      }
    });

    // Handle SSH timeout
    sshClient.on('timeout', () => {
      logger.error('SSH connection timeout');
      isConnected = false;
      sshClient.end();
      reject(new Error('SSH connection timeout'));
    });

    // Initiate connection
    logger.info(`Connecting to SSH server ${ssh.host}:${ssh.port}...`);
    sshClient.connect(sshConfig);
  });
}

/**
 * Create tunnel with retry logic using centralized retry utility
 * @param {object} config - Full config object
 * @returns {Promise<{client: Client, server: net.Server, close: Function}>}
 */
export async function createTunnelWithRetry(config) {
  const { retry = {} } = config;

  return withRetry(
    () => createTunnel(config),
    {
      maxAttempts: retry.maxAttempts || 5,
      baseDelayMs: retry.baseDelayMs || 1000,
      maxDelayMs: retry.maxDelayMs || 30000,
      multiplier: retry.multiplier || 2,
      operationName: 'SSH tunnel connection',
      shouldRetry: isRetryableError,
    }
  );
}

export default { createTunnel, createTunnelWithRetry };
