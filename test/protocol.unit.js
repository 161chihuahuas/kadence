'use strict';

const { expect } = require('chai');
const { stub } = require('sinon');
const keys = require('../lib/keys');
const { Contact } = require('../lib/contact');
const { Protocol } = require('../lib/protocol');


describe('@class Protocol', function() {

  describe('@method ping', function() {

    it('should respond with a timestamp', function(done) {
      let rules = new Protocol();
      rules.PING(function(err, result) {
        expect(Array.isArray(result)).to.equal(true);
        expect(result).to.have.lengthOf(1);
        expect(typeof result[0]).to.equal('number');
        done();
      });
    });

  });

  describe('@method store', function() { 

    it('should pass to error handler if invalid key', function(done) {
      let rules = new Protocol();
      rules.STORE('some key', {
        meta: {
          timestamp: Date.now(),
          publisher: keys.getRandomKeyString()
        },
        blob: Buffer.from('test')
      }, (err) => {
        expect(err.message).to.equal('Key does not match value hash');
        done();
      });
    }); 

    it('should pass to error handler if store fail', function(done) {
      let rules = new Protocol();
      rules.events.on('storage:put', (key, { meta, blob }, done) => {
        done(new Error('FAILED'));
      });
      let blob = Buffer.from('test');
      let hash = keys.hash160(blob).toString('hex');
      rules.STORE(hash, {
        meta: {
          timestamp: Date.now(),
          publisher: keys.getRandomKeyString()
        },
        blob: blob
      }, (err) => {
        expect(err.message).to.equal('FAILED');
        done();
      });
    });

    it('should echo back arguments if stored', function(done) {
      let rules = new Protocol();
      rules.events.on('storage:put', (key, { meta, blob }, done) => {
        done(null, key, { meta, blob });
      });
      let blob = Buffer.from('test');
      let hash = keys.hash160(blob).toString('hex');
      const timestamp = Date.now();
      const publisher = keys.getRandomKeyString();
      rules.STORE(hash, {
        meta: {
          timestamp,
          publisher
        },
        blob: blob
      }, (err, key, { meta, blob }) => {
        expect(key).to.equal(key);
        expect(meta.timestamp).to.equal(timestamp);
        expect(meta.publisher).to.equal(publisher);
        expect(blob).to.equal(blob);
        done();
      });
    });

  });

  describe('@method findNode', function() {

    it('should pass to error handler if invalid key', function(done) {
      let rules = new Protocol();
      rules.FIND_NODE('invalid key', (err) => {
        expect(err.message).to.equal('Invalid lookup key supplied');
        done();
      });
    });

    it('should send result router#getClosestContactsToKey', function(done) {
      let contacts = new Map();
      contacts.set('node id', new Contact({ hostname: 'localhost', port: 8080 }, 'node id'));
      let rules = new Protocol({
        getClosestContactsToKey: () => contacts
      });
      rules.FIND_NODE(keys.getRandomKeyString(), (err, result) => {
        expect(Array.isArray(result)).to.equal(true);
        expect(result[0][1].fingerprint).to.equal('node id');
        expect(result[0][1].address.hostname).to.equal('localhost');
        expect(result[0][1].address.port).to.equal(8080);
        done();
      });
    });

  });

  describe('@method findValue', function() {

    it('should pass to error handler if invalid key', function(done) {
      let rules = new Protocol();
      rules.FIND_VALUE('invalid key', (err) => {
        expect(err.message).to.equal('Invalid lookup key supplied');
        done();
      });
    });

    it('should call findNode if item not found', function(done) {
      let contacts = new Map();
      contacts.set('node id', new Contact({ hostname: 'localhost', port: 8080 }, 'node id'));
      let rules = new Protocol({
        getClosestContactsToKey: stub().returns(contacts)
      });
      rules.events.on('storage:get', (key, done) => {
        done(new Error('Blob not found'));
      });
      rules.FIND_VALUE(keys.getRandomKeyString(), (err, result) => {
        expect(Array.isArray(result)).to.equal(true);
        expect(result[0][0]).to.equal('node id');
        expect(result[0][1].address.hostname).to.equal('localhost');
        expect(result[0][1].address.port).to.equal(8080);
        done();
      });
    });

    it('should respond with the item if found', function(done) {
      let item = {
        meta: {
          timestamp: Date.now(),
          publisher: keys.getRandomKeyString()
        },
        blob: Buffer.from('some string')
      };
      const timestamp = Date.now();
      const publisher = keys.getRandomKeyString();
      let rules = new Protocol();
      rules.events.on('storage:get', (key, done) => {
        done(null, item);
      });
      rules.FIND_VALUE(keys.getRandomKeyString(), (err, result) => {
        expect(result).to.equal(item);
        done();
      });
    });

  });

});
