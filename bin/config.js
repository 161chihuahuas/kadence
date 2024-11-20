'use strict';

const ini = require('ini');
const { existsSync, writeFileSync } = require('node:fs');
const mkdirp = require('mkdirp');
const { homedir } = require('node:os');
const { join } = require('node:path');

const DEFAULT_DATADIR = join(homedir(), '.config/dusk');

module.exports = function(datadir) {

  datadir = datadir || DEFAULT_DATADIR;

  const options = {

    // Process PID
    DaemonPidFilePath: join(datadir, 'dusk.pid'),

    // Identity/Cryptography
    PrivateKeyPath: join(datadir, 'dusk.secret'),
    IdentityNoncePath: join(datadir, 'nonce'),
    IdentityProofPath: join(datadir, 'proof'),

    // Database
    EmbeddedDatabaseDirectory: join(datadir, 'dusk.dht'),

    // Node Options
    NodeListenPort: '5274',
    OnionVirtualPort: '80',
    OnionHiddenServiceDirectory: join(datadir, 'tor.conf'),
    OnionLoggingVerbosity: 'notice',
    OnionLoggingEnabled: '0',

    // Network Bootstrapping
    NetworkBootstrapNodes: [

    ],

    // Debugging/Developer
    VerboseLoggingEnabled: '1',
    LogFilePath: join(datadir, 'dusk.log'),
    LogFileMaxBackCopies: '3',

    // Local Control Protocol
    ControlPortEnabled: '0',
    ControlPort: '5275',
    ControlSockEnabled: '1',
    ControlSock: join(datadir, 'dusk.sock'),

    // Enables the Test Mode (lowers difficulty)
    TestNetworkEnabled: '0'

  };

  if (!existsSync(join(datadir, 'config'))) {
    mkdirp.sync(datadir);
    writeFileSync(join(datadir, 'config'), ini.stringify(options));
  }

  if (!existsSync(join(datadir, 'dusk.dht'))) {
    mkdirp.sync(join(datadir, 'dusk.dht'));
  }

  return options;
};
