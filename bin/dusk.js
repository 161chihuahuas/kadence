#!/usr/bin/env sh
':' //; exec "$(command -v node || command -v nodejs)" "$0" "$@"

'use strict';

const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const assert = require('node:assert');
const async = require('async');
const program = require('commander');
const dusk = require('../index');
const bunyan = require('bunyan');
const RotatingLogStream = require('bunyan-rotating-file-stream');
const fs = require('node:fs');
const path = require('node:path');
const options = require('./config');
const npid = require('npid');
const daemon = require('daemon');
const levelup = require('levelup');
const leveldown = require('leveldown');
const boscar = require('boscar');
const rc = require('rc');
const encoding = require('encoding-down');
const secp256k1 = require('secp256k1');
const readline = require('node:readline');


program.version(dusk.version.software);

const description = `
             _/                      _/      
        _/_/_/  _/    _/    _/_/_/  _/  _/   
     _/    _/  _/    _/  _/_/      _/_/      
    _/    _/  _/    _/      _/_/  _/  _/     
     _/_/_/    _/_/_/  _/_/_/    _/    _/    

        (d)arknet (u)nder (s/k)ademlia

                    ~ Ⓐ ~
                                           
     copyleft N©! 2024 tactical chihuahua 
         licensed under the AGPL-3.0
`;

program.description(description);
program.option('--config, -c <file>', 'path to a dusk configuration file',
  path.join(homedir(), '.config/dusk/dusk.ini'));
program.option('--datadir <path>', 'path to the default data directory',
  path.join(homedir(), '.config/dusk'));
program.option('--kill', 'sends the shutdown signal to the daemon');
program.option('--testnet', 'runs with reduced identity difficulty');
program.option('--daemon, -d', 'sends the dusk daemon to the background');
program.option('--rpc [method] [params]', 'send a command to the daemon');
program.option('--repl', 'starts the interactive rpc console');
program.option('--logs, -f', 'tails the log file defined in the config');
program.option('--export, -x', 'dumps the public identity bundle as dusk:uri')
program.option('--export-secret', 'dumps the extended private identity key')
program.parse(process.argv);

let argv;

if (program.datadir) {
  argv = { config: path.join(program.datadir, 'config') };
  program.config = argv.config;
}

if (program.testnet) {
  process.env.dusk_TestNetworkEnabled = '1';
}

console.log(description);

let config = rc('dusk', options(program.datadir), argv);
let privkey, identity, logger, controller, node, nonce, proof;

// Initialize logging
const prettyPrint = spawn(
  path.join(__dirname, '../node_modules/bunyan/bin/bunyan'),
  ['--color']
);

logger = bunyan.createLogger({
  name: 'dusk',
  streams: [
    {
      stream: new RotatingLogStream({
        path: config.LogFilePath,
        totalFiles: parseInt(config.LogFileMaxBackCopies),
        rotateExisting: true,
        gzip: false
      })
    },
    { stream: prettyPrint.stdin }
  ],
  level: parseInt(config.VerboseLoggingEnabled) ? 'debug' : 'info'
});

prettyPrint.stdout.pipe(process.stdout);


async function _init() {
  if (parseInt(config.TestNetworkEnabled)) {
    logger.info('dusk is running in test mode, difficulties are reduced');
    process.env.dusk_TestNetworkEnabled = config.TestNetworkEnabled;
    dusk.constants.IDENTITY_DIFFICULTY = dusk.constants.TESTNET_DIFFICULTY;
  }

  // Generate a private extended key if it does not exist
  if (!fs.existsSync(config.PrivateKeyPath)) {
    fs.writeFileSync(config.PrivateKeyPath, dusk.utils.generatePrivateKey());
  }

  if (fs.existsSync(config.IdentityProofPath)) {
    proof = fs.readFileSync(config.IdentityProofPath);
  }

  if (fs.existsSync(config.IdentityNoncePath)) {
    nonce = parseInt(fs.readFileSync(config.IdentityNoncePath).toString());
  }

  if (program.shutdown) {
    try {
      process.kill(parseInt(
        fs.readFileSync(config.DaemonPidFilePath).toString().trim()
      ), 'SIGTERM');
    } catch (err) {
      logger.error('failed to shutdown daemon, is it running?');
      process.exit(1);
    }
    process.exit();
  }

  if (program.daemon) {
    require('daemon')({ cwd: process.cwd() });
  }

  try {
    npid.create(config.DaemonPidFilePath).removeOnExit();
  } catch (err) {
    logger.error('Failed to create PID file, is dusk already running?');
    process.exit(1);
  }

  // Shutdown children cleanly on exit
  process.on('exit', killChildrenAndExit);
  process.on('SIGTERM', killChildrenAndExit);
  process.on('SIGINT', killChildrenAndExit);
  process.on('uncaughtException', (err) => {
    npid.remove(config.DaemonPidFilePath);
    logger.error(err.message);
    logger.debug(err.stack);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    npid.remove(config.DaemonPidFilePath);
    logger.error(err.message);
    logger.debug(err.stack);
    process.exit(1);
  });

  // Initialize private extended key
  privkey = fs.readFileSync(config.PrivateKeyPath);
  identity = new dusk.eclipse.EclipseIdentity(
    Buffer.from(secp256k1.publicKeyCreate(privkey)),
    nonce,
    proof
  );

  // If identity is not solved yet, start trying to solve it
  let identityHasValidProof = false;

  logger.info(`proof difficulty param N=${dusk.constants.IDENTITY_DIFFICULTY.n}`);
  logger.info(`proof difficulty param K=${dusk.constants.IDENTITY_DIFFICULTY.k}`);

  try {
    identityHasValidProof = await identity.validate();
  } catch (err) {
    logger.warn(`identity validation failed, ${err.message}`);
  }

  if (!identityHasValidProof) {
    logger.info(`identity proof not yet solved, this can take a while`);
    await identity.solve();
    fs.writeFileSync(config.IdentityNoncePath, identity.nonce.toString());
    fs.writeFileSync(config.IdentityProofPath, identity.proof);
    logger.info('identity solution found');
  }

  logger.info(`pubkey ${identity.pubkey.toString('hex')}`);
  logger.info(`proof: ${identity.proof.toString('hex')}`);
  logger.info(`nonce: ${identity.nonce}`);
  logger.info(`fingerprint ${identity.fingerprint.toString('hex')}`);
  init();
}

function killChildrenAndExit() {
  logger.info('exiting, killing child services, cleaning up');
  npid.remove(config.DaemonPidFilePath);
  process.removeListener('exit', killChildrenAndExit);

  if (controller && parseInt(config.ControlSockEnabled)) {
    controller.server.close();
  }

  process.exit(0);
}

function registerControlInterface() {
  assert(!(parseInt(config.ControlPortEnabled) &&
           parseInt(config.ControlSockEnabled)),
  'ControlSock and ControlPort cannot both be enabled');

  controller = new boscar.Server(new dusk.Control(node));

  if (parseInt(config.ControlPortEnabled)) {
    logger.info('binding controller to port ' + config.ControlPort);
    controller.listen(parseInt(config.ControlPort), '0.0.0.0');
  }

  if (parseInt(config.ControlSockEnabled)) {
    logger.info('binding controller to path ' + config.ControlSock);
    controller.listen(config.ControlSock);
  }
}

async function init() {
  logger.info('initializing dusk');

  // Initialize public contact data
  const contact = {
    hostname: '',
    protocol: 'http:',
    port: parseInt(config.NodePublicPort)
  };

  const transport = new dusk.HTTPTransport();

  // Initialize protocol implementation
  node = new dusk.KademliaNode({
    logger,
    transport,
    contact,
    storage: levelup(encoding(leveldown(config.EmbeddedDatabaseDirectory)))
  });
  
  // Extend S/Kademlia with Quasar pub/sub
  node.plugin(dusk.quasar());
  // Require pub/sub rpcs to contain a hashcash stamp to mitigate DoS
  node.hashcash = node.plugin(dusk.hashcash({
    methods: ['PUBLISH', 'SUBSCRIBE'],
    difficulty: 8
  }));
  // Sign and verify messages
  node.spartacus = node.plugin(dusk.spartacus(privkey, {
    checkPublicKeyHash: false
  }));
  // DHT is content addressable only - no arbitrary k/v pairs
  node.content = node.plugin(dusk.contentaddress({
    valueEncoding: 'hex'
  }));
  // Mitigage exclipse attacks by requiring equihash proofs
  node.eclipse = node.plugin(dusk.eclipse(identity));

  // Route all traffic through Tor and establish an onion service
  dusk.constants.T_RESPONSETIMEOUT = 20000;
  node.onion = node.plugin(dusk.onion({
    dataDirectory: config.OnionHiddenServiceDirectory,
    virtualPort: config.OnionVirtualPort,
    localMapping: `127.0.0.1:${config.NodeListenPort}`,
    torrcEntries: {
      // dusk-specific Tor configuration
      CircuitBuildTimeout: 10,
      KeepalivePeriod: 60,
      NewCircuitPeriod: 60,
      NumEntryGuards: 8,
      Log: `${config.OnionLoggingVerbosity} stdout`
    },
    passthroughLoggingEnabled: !!parseInt(config.OnionLoggingEnabled)
  }));

  // Handle any fatal errors
  node.on('error', (err) => {
    logger.error(err.message.toLowerCase());
  });

  // Use verbose logging if enabled
  if (!!parseInt(config.VerboseLoggingEnabled)) {
    node.plugin(dusk.logger(logger));
  }

  // Cast network nodes to an array
  if (typeof config.NetworkBootstrapNodes === 'string') {
    config.NetworkBootstrapNodes = config.NetworkBootstrapNodes.trim().split();
  }

  async function joinNetwork(callback) {
    let peers = config.NetworkBootstrapNodes;

    if (peers.length === 0) {
      logger.info('no bootstrap seeds provided');
      logger.info('running in seed mode (waiting for connections)');

      return node.router.events.once('add', (identity) => {
        config.NetworkBootstrapNodes = [
          dusk.utils.getContactURL([
            identity,
            node.router.getContactByNodeId(identity)
          ])
        ];
        joinNetwork(callback)
      });
    }

    logger.info(`joining network from ${peers.length} seeds`);
    async.detectSeries(peers, (url, done) => {
      const contact = dusk.utils.parseContactURL(url);
      node.join(contact, (err) => {
        done(null, (err ? false : true) && node.router.size > 1);
      });
    }, (err, result) => {
      if (!result) {
        logger.error('failed to join network, will retry in 1 minute');
        callback(new Error('Failed to join network'));
      } else {
        callback(null, result);
      }
    });
  }

  node.listen(parseInt(config.NodeListenPort), () => {
    logger.info('dusk node is running! your identity is:');
    logger.info('');
    logger.info('');
    const identBundle = dusk.utils.getContactURL([node.identity, node.contact]); 
    logger.info(identBundle);
    logger.info('');
    logger.info('');
    fs.writeFileSync(
      path.join(program.datadir, 'dusk.pub'),
      identBundle
    );
    
    registerControlInterface();
    async.retry({
      times: Infinity,
      interval: 60000
    }, done => joinNetwork(done), (err, entry) => {
      if (err) {
        logger.error(err.message);
        process.exit(1);
      }

      logger.info(`connected to network via ${entry}`);
      logger.info(`discovered ${node.router.size} peers from seed`);
    });
  });
}

// Check if we are sending a command to a running daemon's controller
if (program.rpc || program.repl) {
  assert(!(parseInt(config.ControlPortEnabled) &&
           parseInt(config.ControlSockEnabled)),
    'ControlSock and ControlPort cannot both be enabled');

  const client = new boscar.Client();

  if (parseInt(config.ControlPortEnabled)) {
    client.connect(parseInt(config.ControlPort));
  } else if (parseInt(config.ControlSockEnabled)) {
    client.connect(config.ControlSock);
  }

  client.on('ready', () => {
    if (program.rpc === true || program.repl) {
      if (program.rpc) {
        logger.warn('no command provided to --rpc, starting repl');
      }
      return setTimeout(() => _initRepl(), 100);
    }

    const [method, ...params] = program.rpc.trim().split(' ');
    console.log(`(dusk:rpc) <~ ${method}(${params.join(' , ')})`);
    client.invoke(method, params, function(err, ...results) {
      if (err) {
        console.error(`(dusk:rpc) ~> ${err.message}`);
        process.exit(1);
      } else {
        console.info('(dusk:rpc) ~>');
        console.dir(results, { depth: null });
        process.exit(0);
      }
    });
  });

  client.socket.on('close', () => {
    console.error('Connection terminated! :(');
    process.exit(1);
  });

  client.on('error', err => {
    console.error(err);
    process.exit(1)
  });

  function _initRepl() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '(dusk:repl) ~ ',
    });

    rl.prompt();

    rl.on('line', (line) => {
      if (!line) {
        return rl.prompt();
      }

      const [method, ...params] = line.trim().split(' ');
      client.invoke(method, params, function(err, ...results) {
        if (err) {
          console.error(err.message);
        } else {
          console.dir(results, { depth: null });
        }
      
        rl.prompt();
      });
    }).on('close', () => {
      console.log('bye ♥ ');
      process.exit(0);
    });
  }
} else if (program.logs) {
  const tail = spawn('tail', ['-f', config.LogFilePath]);
  tail.stdout.pipe(prettyPrint.stdin).pipe(process.stdout);
} else {
  // Otherwise, kick everything off
  _init();
}
