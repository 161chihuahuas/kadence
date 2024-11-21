'use strict';

const async = require('async');
const dusk = require('..');
const quasar = require('../lib/plugin-quasar');
const spartacus = require('../lib/plugin-spartacus');
const network = require('./fixtures/node-generator');

dusk.constants.IDENTITY_DIFFICULTY = dusk.constants.TESTNET_DIFFICULTY;

const TOTAL_NODES = 6;

describe('@module dusk/quasar + @class HTTPTransport', function() {

  this.timeout(400000);

  let nodes, seed;

  let topics = {};

  before(function(done) {
    dusk.constants.T_RESPONSETIMEOUT = 400000;
    nodes = network(TOTAL_NODES, dusk.HTTPTransport);
    async.each(nodes, (node, done) => {
      node.spartacus = node.plugin(spartacus(null, { checkPublicKeyHash: false }));
      const identity = new dusk.eclipse.EclipseIdentity(node.spartacus.privateKey);
      identity.solve().then(() => {
        node.plugin(dusk.eclipse(identity));
        node.plugin(quasar());
        node.listen(node.contact.port, node.contact.hostname, done);
      }, done);
    }, () => {
      seed = nodes.shift();
      nodes.forEach((node) => {
        topics[node.identity.toString('hex')] = (TOTAL_NODES) / 4;
        seed.router.addContactByNodeId(
          node.identity.toString('hex'),
          node.contact
        );
      });
      console.log('bootstrapping local testnet, this can take quite a while...')
      async.each(nodes, (node, done) => {
        node.join([
          seed.identity.toString('hex'),
          seed.contact
        ], () => {
          console.log('done!')
          done();
        });
      }, done);
    });
  });

  after(function() {
    nodes.forEach((node) => node.transport.server.close());
  });

  it('nodes subscribed to a topic should receive publication', function(done) {
    let topicCounter = 0;
    function getTopicName() {
      if (topicCounter === 0 || topicCounter < 4) {
        return nodes[topicCounter++].identity.toString('hex');
      } else {
        topicCounter = 0;
        return getTopicName();
      }
    }
    function confirmPublicationReceipt(topic) {
      console.log(topics, topic)
      topics[topic]--;
      for (let t in topics) {
        if (topics[t] > 0) {
          return;
        }
      }
      done();
    }
    async.eachLimit(nodes, 4, (node, next) => {
      let topic = getTopicName();
      node.quasarSubscribe(topic, () => confirmPublicationReceipt(topic));
      setTimeout(() => next(), 500);
    }, () => {
      let publishers = nodes.splice(0, 4);
      async.each(publishers, (node, done) => {
        node.quasarPublish(Buffer.from('000000', 'hex'), done);
      }, () => {
        setTimeout(() => {
          let totalMembersRemaining = 0;
          for (let t in topics) {
            totalMembersRemaining += topics[t];
          }
          if (totalMembersRemaining > Math.floor((TOTAL_NODES - 1) * 0.15)) {
            return done(new Error(
              `${totalMembersRemaining} group members did not get message`
            ));
          }
          done();
        }, 12000);
      });
    });
  });

});
