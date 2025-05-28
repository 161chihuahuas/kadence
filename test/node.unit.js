'use strict';

const { Readable: ReadableStream } = require('node:stream');
const { expect } = require('chai');
const sinon = require('sinon');
const utils = require('../lib/utils');
const { Node } = require('../lib/node');
const { Contact } = require('../lib/contact');
const constants = require('../lib/constants');


describe('@class Node', function() {

  this.timeout(12000)

  let kademliaNode, clock;

  const contact = new Contact({
    name: 'test:node.unit.js'
  }, 'aa48d3f07a5241291ed0b4cab6483fa8b8fcc128');

  before(() => {
    clock = sinon.useFakeTimers(Date.now(), 'setInterval');
    kademliaNode = new Node(contact);
  });

  describe('@private _updateContact', function() {

    it('should add the contact to the routing table', function(done) {
      let contact = new Contact({
        hostname: 'localhost', 
        port: 8080 
      }, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128');
      kademliaNode._updateContact(contact);
      setImmediate(() => {
        expect(kademliaNode.router.getContactByNodeId(
          'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        )).to.equal(contact);
        done();
      });
    });

    it('should not add itself to the routing table', function() {
      let contact = new Contact({ 
        hostname: 'localhost', 
        port: 8080 
      }, 'aa48d3f07a5241291ed0b4cab6483fa8b8fcc128');
      kademliaNode._updateContact(contact);
      expect(kademliaNode.router.getContactByNodeId(
        'aa48d3f07a5241291ed0b4cab6483fa8b8fcc128'
      )).to.equal(undefined);
    });

    it('should replace the head contact if ping fails', function(done) {
      let bucketIndex = kademliaNode.router.indexOf(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'
      );
      let addContactByNodeId = sinon.stub(
        kademliaNode.router,
        'addContactByNodeId'
      );
      addContactByNodeId.onCall(0).returns(
        [bucketIndex, kademliaNode.router.get(bucketIndex), -1]
      );
      addContactByNodeId.onCall(1).returns(
        [bucketIndex, kademliaNode.router.get(bucketIndex), 0]
      );
      let ping = sinon.stub(kademliaNode, 'ping').callsFake(
        () => Promise.reject(new Error('Timeout')));
      let removeContactByNodeId = sinon.stub(
        kademliaNode.router,
        'removeContactByNodeId'
      );
      kademliaNode._updateContact(new Contact({ 
        hostname: 'localhost', 
        port: 8080 
      }, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'));
      setImmediate(() => {
        addContactByNodeId.restore();
        ping.restore();
        removeContactByNodeId.restore();
        expect(addContactByNodeId.callCount).to.equal(2);
        expect(removeContactByNodeId.callCount).to.equal(1);
        done();
      });
    });

    it('should do nothing if the head contact responds', function(done) {
      let bucketIndex = kademliaNode.router.indexOf(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'
      );
      let addContactByNodeId = sinon.stub(
        kademliaNode.router,
        'addContactByNodeId'
      );
      addContactByNodeId.onCall(0).returns(
        [bucketIndex, kademliaNode.router.get(bucketIndex), -1]
      );
      addContactByNodeId.onCall(1).returns(
        [bucketIndex, kademliaNode.router.get(bucketIndex), 0]
      );
      let ping = sinon.stub(kademliaNode, 'ping').callsFake(() => {
        return Promise.resolve([Date.now()]);
      });
      let removeContactByNodeId = sinon.stub(
        kademliaNode.router,
        'removeContactByNodeId'
      );
      kademliaNode._updateContact(new Contact({ hostname: 'localhost', port: 8080 },
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'));
      setImmediate(() => {
        addContactByNodeId.restore();
        ping.restore();
        removeContactByNodeId.restore();
        expect(addContactByNodeId.callCount).to.equal(1);
        expect(removeContactByNodeId.callCount).to.equal(0);
        done();
      });
    });

  });
 
  describe('@method join', function() {

    it('should insert contact, lookup, and refresh buckets', function(done) {
      let addContactByNodeId = sinon.stub(
        kademliaNode.router,
        'addContactByNodeId'
      );
      let iterativeFindNode = sinon.stub(
        kademliaNode,
        'iterativeFindNode'
      ).returns(new Promise((resolve) => {
        kademliaNode.router.addContactByNodeId(
          'da48d3f07a5241291ed0b4cab6483fa8b8fcc128',
          {}
        );
        kademliaNode.router.addContactByNodeId(
          'ca48d3f07a5241291ed0b4cab6483fa8b8fcc128',
          {}
        );
        kademliaNode.router.addContactByNodeId(
          'ba48d3f07a5241291ed0b4cab6483fa8b8fcc128',
          {}
        );
        resolve();
      }));
      let getClosestBucket = sinon.stub(
        kademliaNode.router,
        'getClosestBucket'
      ).returns([constants.B - 1, kademliaNode.router.get(constants.B - 1)]);
      let refresh = sinon.stub(kademliaNode, 'refresh').returns(() => Promise.resolve());
      kademliaNode.join(new Contact({
        hostname: 'localhost',
        port: 8080
      }, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')).then(() => {
        kademliaNode.router.removeContactByNodeId(
          'da48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        );
        kademliaNode.router.removeContactByNodeId(
          'ca48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        );
        kademliaNode.router.removeContactByNodeId(
          'ba48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        );
        iterativeFindNode.restore();
        getClosestBucket.restore();
        refresh.restore();
        addContactByNodeId.restore();
        expect(addContactByNodeId.calledWithMatch(
          'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        )).to.equal(true);
        expect(iterativeFindNode.calledWithMatch(
          kademliaNode.identity.toString('hex')
        )).to.equal(true);
        expect(refresh.callCount).to.equal(1);
        done();
      }, done);
    });

    it('should error if lookup fails', function(done) {
      let addContactByNodeId = sinon.stub(
        kademliaNode.router,
        'addContactByNodeId'
      );
      let iterativeFindNode = sinon.stub(
        kademliaNode,
        'iterativeFindNode'
      ).returns(new Promise((resolve, reject) => {
        reject('Lookup failed');
      }));
      let getClosestBucket = sinon.stub(
        kademliaNode.router,
        'getClosestBucket'
      ).returns([constants.B - 1, kademliaNode.router.get(constants.B - 1)]);
      let refresh = sinon.stub(kademliaNode, 'refresh').returns(() => Promise.resolve());
      kademliaNode.join(new Contact({
        hostname: 'localhost',
        port: 8080
      }, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')).then(() => {
        done(new Error('Did not fail when intended'));
      }, (err) => {
        addContactByNodeId.restore();
        iterativeFindNode.restore();
        getClosestBucket.restore();
        refresh.restore();
        expect(err).to.equal('Lookup failed');
        expect(addContactByNodeId.calledWithMatch(
          'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'
        )).to.equal(true);
        expect(iterativeFindNode.calledWithMatch(
          kademliaNode.identity.toString('hex')
        )).to.equal(true);
        expect(refresh.callCount).to.equal(0);
        done();
      });
    });

  });

  describe('@method ping', function() {

    it('should call send with PING message', function(done) {
      let contact = new Contact({
        hostname: 'localhost',
        port: 8080
      }, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128');
      kademliaNode.events.once('node:rpc', (method, params, contact, done) => {
        setTimeout(() => {
          done(null, [Date.now()]);
        }, 25);
      });
      kademliaNode.ping(contact).then((latency) => {
        expect(latency > 0).to.equal(true);
        done();
      });
    });

  });

  describe('@method iterativeStore', function() {

    it('should send store rpc to found contacts', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = { hostname: 'localhost', port: 8080 };
      sandbox.stub(
        kademliaNode,
        'iterativeFindNode'
      ).callsFake(() => {
        return Promise.resolve(
          Array(20).fill(null).map(() => new Contact(contact, utils.getRandomKeyString()))
        );
      });
      let rpcEvents = 0;
      kademliaNode.events.on('node:rpc', (m, p, c, d) => {
        rpcEvents++;
        d(null, p);
      });
      kademliaNode.iterativeStore(utils.getRandomKeyString(), 
        'some storage item data').then(() => {
          sandbox.restore();
          done();
        }, done);
    });

    it('should send the store rpc with the existing metadata', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = new Contact({ hostname: 'localhost', port: 8080 });
      sandbox.stub(
        kademliaNode,
        'iterativeFindNode'
      ).callsFake(function() {
        return Promise.resolve(
          Array(20).fill(null).map(() => [utils.getRandomKeyString(), contact])
        );
      });
      kademliaNode.events.removeAllListeners();
      kademliaNode.events.once('node:rpc', (m, p, c, d) => {
        d(new Error('Failed'));
        kademliaNode.events.on('node:rpc', (m, p, c, d) => d());
      });
      kademliaNode.iterativeStore(utils.getRandomKeyString(), {
        blob: Buffer.from('some storage item data'),
        meta: {
          publisher: 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127',
          timestamp: Date.now()
        } 
      }).then((stored) => {
        kademliaNode.events.removeAllListeners();
        sandbox.restore();
        expect(stored).to.equal(19);
        done();
      });
    });

  });

  describe('@method iterativeFindNode', function() {

    it('should send iterative FIND_NODE calls', function(done) {
      let contact = { hostname: 'localhost', port: 8080 };
      let getClosestContactsToKey = sinon.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns([
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128'),
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc129')
      ]);
      let _updateContact = sinon.stub(kademliaNode, '_updateContact');
      let contacts = Array(20).fill(null).map(() => {
        return new Contact(contact, utils.getRandomKeyString())
      });
      kademliaNode.events.once('node:rpc', (method, params, contact, done) => {
        done(null, contacts);
        kademliaNode.events.once('node:rpc', (method, params, contact, done) => {
          done(new Error('Lookup failed'));
          kademliaNode.events.on('node:rpc', (method, params, contact, done) => {
            done(null, contacts);
          });
        });
      });
      kademliaNode.iterativeFindNode('ea48d3f07a5241291ed0b4cab6483fa8b8fcc126').then(results => {
        getClosestContactsToKey.restore();
        _updateContact.restore();
        expect(_updateContact.callCount).to.equal(20);
        expect(results).to.have.lengthOf(2);
        results.forEach(([key, c]) => {
          expect(utils.keyStringIsValid(key)).to.equal(true);
          expect(contact).to.equal(c);
        });
        kademliaNode.events.removeAllListeners();
        done();
      });
    });

    it('should iterate through closer nodes', function(done) {
      let contact = { hostname: 'localhost', port: 8080 };
      let getClosestContactsToKey = sinon.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns([
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc125', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc128', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc129', contact]
      ]);
      let _updateContact = sinon.stub(kademliaNode, '_updateContact');
      let send = sinon.stub(kademliaNode, 'send');
      send.callsArgWith(
        3,
        null,
        Array(20).fill(null).map(() => {
          return [utils.getRandomKeyString(), contact]
        })
      );
      send.onCall(0).callsArgWith(
        3,
        null,
        [['ea48d3f07a5241291ed0b4cab6483fa8b8fcc127', contact]].concat(
          Array(20).fill(null).map(() => {
            return [utils.getRandomKeyString(), contact]
          })
        )
      )
      kademliaNode.iterativeFindNode(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        (err, results) => {
          getClosestContactsToKey.restore();
          _updateContact.restore();
          send.restore();
          expect(err).to.equal(null);
          expect(results).to.have.lengthOf(constants.K);
          expect(results[0][0]).to.equal(
            'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
          );
          expect(results[1][0]).to.equal(
            'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'
          );
          done();
        }
      );
    });

    it('should call each node a maximum of once', function(done) {
      let contact = { hostname: 'localhost', port: 8080 };
      let getClosestContactsToKey = sinon.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns([
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc125', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc128', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc129', contact]
      ]);
      let _updateContact = sinon.stub(kademliaNode, '_updateContact');
      let send = sinon.stub(kademliaNode, 'send');
      send.callsArgWith(
        3,
        null,
        Array(20).fill(null).map(() => {
          return [utils.getRandomKeyString(), contact]
        })
      );
      kademliaNode.iterativeFindNode(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        () => {
          let sentNodes = send.args.map( args => args[2][0]);
          expect(sentNodes).to.deep.equal(sentNodes.filter(
            (value, index, self) => {
              return self.indexOf(value) === index;
            })
          )
          getClosestContactsToKey.restore();
          _updateContact.restore();
          send.restore();
          done();
        }
      );
    });

    it('should not include inactive nodes in the result', function(done) {
      let contact = { hostname: 'localhost', port: 8080 };
      let getClosestContactsToKey = sinon.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns([
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc127', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc128', contact],
        ['ea48d3f07a5241291ed0b4cab6483fa8b8fcc129', contact]
      ]);
      let _updateContact = sinon.stub(kademliaNode, '_updateContact');
      let send = sinon.stub(kademliaNode, 'send');
      let contacts = Array(20).fill(null).map(() => {
        return [utils.getRandomKeyString(), contact]
      });
      send.onCall(0).callsArgWith(
        3,
        null,
        contacts
      );
      send.onCall(1).callsArgWith(
        3,
        new Error('Lookup failed')
      );
      send.onCall(2).callsArgWith(
        3,
        null,
        contacts
      );
      for (var i=0; i<20; i++) {
        send.onCall(i + 3).callsArgWith(
          3,
          contacts
        );
      }
      kademliaNode.iterativeFindNode(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        (err, results) => {
          getClosestContactsToKey.restore();
          _updateContact.restore();
          send.restore();
          expect(err).to.equal(null);
          results.forEach(([key]) => {
            expect(key).to.not.equal('ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
          });
          done();
        }
      );
    });
  });

  describe('@method iterativeFindValue', function() {

    it('should return a node list if no value is found', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = { hostname: 'localhost', port: 8080 };
      sandbox.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns(new Map(Array(20).fill(null).map(() => [
        utils.getRandomKeyString(),
        contact
      ])));
      sandbox.stub(kademliaNode, 'send').callsArgWith(
        3,
        null,
        Array(20).fill(20).map(() => [utils.getRandomKeyString(), contact])
      );
      kademliaNode.iterativeFindValue(
        utils.getRandomKeyString(),
        (err, result) => {
          sandbox.restore();
          expect(Array.isArray(result)).to.equal(true);
          expect(result).to.have.lengthOf(constants.K);
          done();
        }
      );
    });

    it('should find a value at a currently unknown node', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = { hostname: 'localhost', port: 8080 };
      sandbox.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns(new Map(Array(10).fill(null).map(() => [
        utils.getRandomKeyString(),
        contact
      ])));
      let send = sandbox.stub(kademliaNode, 'send').callsArgWith(
        3,
        null,
        Array(20).fill(null).map(() => {
          return [utils.getRandomKeyString(), contact]
        })
      );
      send.onCall(10).callsArgWith(3, null, {
        value: 'some data value',
        timestamp: Date.now(),
        publisher: 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
      });
      kademliaNode.iterativeFindValue(
        utils.getRandomKeyString(),
        (err, result) => {
          sandbox.restore();
          expect(result.value).to.equal('some data value');
          done();
        }
      );
    });

    it('should store the value at the closest missing node', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = { hostname: 'localhost', port: 8080 };
      sandbox.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns(new Map(Array(20).fill(null).map(() => [
        utils.getRandomKeyString(),
        contact
      ])));
      let send = sandbox.stub(kademliaNode, '_send').returns(Promise.resolve(
        Array(20).fill(20).map(() => [utils.getRandomKeyString(), contact])
      ));
      send.onCall(4).returns(Promise.resolve({
        value: 'some data value',
        timestamp: Date.now(),
        publisher: 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
      }));
      kademliaNode.iterativeFindValue(
        utils.getRandomKeyString(),
        (err, result) => {
          sandbox.restore();
          expect(result.value).to.equal('some data value');
          expect(send.callCount >= 6).to.equal(true);
          done();
        }
      );
    });

    it('should immediately callback if value found', function(done) {
      let sandbox = sinon.sandbox.create();
      let contact = { hostname: 'localhost', port: 8080 };
      sandbox.stub(
        kademliaNode.router,
        'getClosestContactsToKey'
      ).returns(new Map(Array(20).fill(null).map(() => [
        utils.getRandomKeyString(),
        contact
      ])));
      let send = sandbox.stub(kademliaNode, '_send').returns(Promise.resolve({
        value: 'some data value',
        timestamp: Date.now(),
        publisher: 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
      }));
      send.onCall(0).returns(Promise.reject(new Error('Request timeout')));
      kademliaNode.iterativeFindValue(
        utils.getRandomKeyString(),
        (err, result) => {
          sandbox.restore();
          expect(result.value).to.equal('some data value');
          expect(send.callCount >= 3).to.equal(true);
          done();
        }
      );
    });

  });

  describe('@method replicate', function() {

    it('should replicate and republish the correct items', function(done) {
      let sandbox = sinon.sandbox.create();
      let items = [
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - constants.T_REPUBLISH,
            publisher: kademliaNode.identity.toString('hex')
          }
        },
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - constants.T_REPLICATE,
            publisher: utils.getRandomKeyString()
          }
        },
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - 1000,
            publisher: utils.getRandomKeyString()
          }
        }
      ];
      sandbox.stub(
        kademliaNode.storage,
        'createReadStream'
      ).returns(new ReadableStream({
        objectMode: true,
        read: function() {
          if (items.length) {
            this.push(items.shift());
          } else {
            this.push(null);
          }
        }
      }));
      let iterativeStore = sandbox.stub(kademliaNode, 'iterativeStore')
        .callsArg(2);
      kademliaNode.replicate((err) => {
        sandbox.restore();
        expect(err).to.equal(undefined);
        expect(iterativeStore.callCount).to.equal(2);
        done();
      });
    });

  });

  describe('@method expire', function() {

    it('should expire the correct items', function(done) {
      let sandbox = sinon.sandbox.create();
      let items = [
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - constants.T_EXPIRE,
            publisher: kademliaNode.identity.toString('hex')
          }
        },
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - constants.T_EXPIRE,
            publisher: utils.getRandomKeyString()
          }
        },
        {
          key: utils.getRandomKeyString(),
          value: {
            value: 'some value',
            timestamp: Date.now() - 1000,
            publisher: utils.getRandomKeyString()
          }
        }
      ];
      sandbox.stub(
        kademliaNode.storage,
        'createReadStream'
      ).returns(new ReadableStream({
        objectMode: true,
        read: function() {
          if (items.length) {
            this.push(items.shift());
          } else {
            this.push(null);
          }
        }
      }));
      let del = sandbox.stub(
        kademliaNode.storage,
        'del'
      ).callsArg(1);
      kademliaNode.expire((err) => {
        sandbox.restore();
        expect(err).to.equal(undefined);
        expect(del.callCount).to.equal(2);
        done();
      });
    });

  });

  describe('@method refresh', function() {

    it('should refresh the correct buckets', function(done) {
      let sandbox = sinon.sandbox.create();
      let iterativeFindNode = sandbox.stub(
        kademliaNode,
        'iterativeFindNode'
      ).callsArgWith(1, null, []);
      kademliaNode.router.get(0).set(
        utils.getRandomKeyString(),
        { hostname: 'localhost', port: 8080 }
      );
      kademliaNode.router.get(2).set(
        utils.getRandomKeyString(),
        { hostname: 'localhost', port: 8080 }
      );
      for (var i=0; i<constants.B; i++) {
        kademliaNode._lookups.set(i, Date.now());
      }
      kademliaNode._lookups.set(1, Date.now() - constants.T_REFRESH);
      kademliaNode._lookups.set(2, Date.now() - constants.T_REFRESH);
      kademliaNode.refresh(0, () => {
        sandbox.restore();
        expect(iterativeFindNode.callCount).to.equal(2);
        done();
      });
    });

  });

});
