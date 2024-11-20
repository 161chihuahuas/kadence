'use strict';

const { expect } = require('chai');
const dusk = require('..');
const network = require('./fixtures/node-generator');
const hashcash = require('../lib/plugin-hashcash');


describe('@module dusk/hashcash + @class HTTPTransport', function() {

  let [node1, node2] = network(2, dusk.HTTPTransport);

  before(function(done) {
    dusk.constants.T_RESPONSETIMEOUT = 200;
    [node1, node2].forEach((node) => {
      node.hashcash = node.plugin(hashcash());
      node.listen(node.contact.port);
    });
    setTimeout(done, 1000);
  });

  after(function() {
    process._getActiveHandles().forEach((h) => h.unref());
  })

  it('should stamp and verify proof of work', function(done) {
    this.timeout(8000);
    node1.ping([node2.identity.toString('hex'), node2.contact], (err) => {
      expect(err).to.equal(null);
      done();
    });
  });

});
