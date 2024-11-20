'use strict';

const { expect } = require('chai');
const rolodex = require('../lib/plugin-rolodex');
const sinon = require('sinon');
const RoutingTable = require('../lib/routing-table');
const utils = require('../lib/utils');
const path = require('node:path');
const os = require('node:os');


describe('@module kadence/rolodex', function() {

  let plugin;

  const id = Buffer.from(utils.getRandomKeyString(), 'hex');
  const node = {
    router: new RoutingTable(id),
    logger: {
      warn: sinon.stub(),
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub()
    }
  };

  let nodeid1 = utils.getRandomKeyString();
  let nodeid2 = utils.getRandomKeyString();

  before(function() {
    plugin = rolodex(path.join(os.tmpdir(), id.toString('hex')))(node);
  });

  it('should store the contact in the db', function(done) {
    let contact1 = {
      hostname: '127.0.0.1',
      port: 8080,
      protocol: 'http:'
    };
    let contact2 = {
      hostname: '127.0.0.1',
      port: 8081,
      protocol: 'http:'
    };
    node.router.addContactByNodeId(nodeid1, contact1);
    setTimeout(function() {
      node.router.addContactByNodeId(nodeid2, contact2);
      setTimeout(function() {
        plugin.getBootstrapCandidates().then(function(peers) {
          console.log(peers)
          expect(peers[0]).to.equal(`http://127.0.0.1:8081/#${nodeid2}`);
          expect(peers[1]).to.equal(`http://127.0.0.1:8080/#${nodeid1}`);
          done();
        }, done);
      }, 100);
    }, 100);
  });

  describe('@class RolodexPlugin', function() {

    describe('@method getExternalPeerInfo', function() {

      it('should return the peer info', function(done) {
        plugin.getExternalPeerInfo(nodeid1).then(contact => {
          expect(contact.hostname).to.equal('127.0.0.1');
          expect(contact.port).to.equal(8080);
          expect(contact.protocol).to.equal('http:');
          done();
        }, done);
      });

    });

    describe('@method setInternalPeerInfo', function() {

      it('should set the internal peer info', function(done) {
        plugin.setInternalPeerInfo(nodeid1, {
          reputation: 95
        }).then(() => done(), done);
      });

    });

    describe('@method getInternalPeerInfo', function() {

      it('should return the internal peer info', function(done) {
        plugin.getInternalPeerInfo(nodeid1).then(info => {
          expect(info.reputation).to.equal(95);
          done();
        }, done);
      });

    });

  });

});
