'use strict';

const { expect } = require('chai');

const { 
  Client,
  Server } = require('@tacticalchihuahua/mascara');

const {
  constants,
  keys,
  Node,
  Contact } = require('..');


function createKademliaNode(port) {
  const contact = new Contact({
    hostname: '127.0.0.1',
    port: port
  });
  const node = new Node(contact);
  const server = new Server({
    PING() { node.protocol.PING(...arguments) },
    FIND_NODE() { node.protocol.FIND_NODE(...arguments) },
    FIND_VALUE() { node.protocol.FIND_VALUE(...arguments) },
    STORE() { node.protocol.STORE(...arguments) },
  });
  const pool = new Map();
  const store = new Map();

  node.events.on('message_queued', (method, params, target, send) => {
    let client = pool.get(target.fingerprint);

    if (!client) {
      client = new Client();
      
      client.stream.on('connect', () => {
          pool.set(target.fingerprint, client);
          client.invoke(method, params, send);
        }).on('error', (err) => {
          pool.delete(target.fingerprint)
        });

      client.connect(target.address.port);
    } else {
      client.invoke(method, params, send);
    }
  }).on('storage_get', (hash, done) => {
    if (store.has(hash)) {
      done(null, store.get(hash));
    } else {
      done(new Error('Not found'));
    }
  }).on('storage_put', (hash, data, done) => {
    store.set(hash, data);
    done(null, hash);
  }).on('storage_delete', (hash, done) => {
    store.delete(hash);
    done(null);
  }).on('storage_replicate', (replicatorStream) => {
    const data = [...store.values()];
    const readStream = new ReadableStream({
      objectMode: true,
      read() {
        this.push(data.shift() || null);
      }
    });
    readStream.pipe(replicatorStream);
  }).on('storage_expire', (expirerStream) => {
    const data = [...store.values()];
    const readStream = new ReadableStream({
      objectMode: true,
      read() {
        this.push(data.shift() || null);
      }
    });
    readStream.pipe(expirerStream);
  });

  return new Promise((resolve, reject) => {
    server.listen(contact.address.port, contact.address.hostname, () => {
      resolve(node);
    });
  });
}

describe('@module kadence', function() {

  this.timeout(120000);

  let portCtr = 6000;
  let network = new Array(constants.B).fill(null);

  before((done) => {
    network = network.map(() => {
      return createKademliaNode(portCtr++);
    });

    Promise.allSettled(network).then((results) => {
      network = results.map(r => r.value);
      done();
    });
  });

  describe('__setup (n=' + constants.B + ')', function() { 
    it('creates a local network', function() {
      for (let i = 0; i < network.length; i++) {
        expect(network[i] instanceof Node).to.equal(true);
      }
    });
  });

  describe('#join (n=' + constants.B + ')', function() { 
    it('connects the nodes together using one seed', async function() {
      for (let i = 1; i < network.length; i++) {
        await network[i].join(network[0].contact);
      }
      for (let i = 1; i < network.length; i++) {
        expect(network[i].router.size > constants.K).to.equal(true);
      }
    });
  });

  describe('#iterativeStore', function() { 
    it('a "randomly" selected node can store a record in the dht', async function() {
      const kindofRandomIndex = Math.ceil(Math.random() * constants.B);
      const _node = network[kindofRandomIndex];
      const blob = Buffer.from('every city, every town.');
      const hash = keys.hash160(blob).toString('hex')
      await _node.iterativeStore(hash, blob);
    });
  });

  describe('#iterativeFindValue', function() { 
    it('a "randomly" selected node can find that record in the dht', async function() {
      const kindofRandomIndex = Math.ceil(Math.random() * constants.B);
      const _node = network[kindofRandomIndex];
      const blob = Buffer.from('every city, every town.');
      const hash = keys.hash160(blob).toString('hex')
      let result = await _node.iterativeFindValue(hash);
      
      if (Array.isArray(result)) {
        await _node.iterativeFindNode(hash);
        result = await _node.iterativeFindValue(hash);
      }

      expect(Array.isArray(result)).to.equal(false);
      expect(Buffer.compare(
        blob,
        Buffer.from(result.blob)
      )).to.equal(0);
    });
  });

}); 
