/**
 * @module dusk/quasar
 */

'use strict';

const assert = require('node:assert');
const merge = require('merge');
const async = require('async');
const { knuthShuffle } = require('knuth-shuffle');
const uuid = require('uuid');
const constants = require('./constants');
const utils = require('./utils');
const BloomFilter = require('atbf');
const LruCache = require('lru-cache');
const secp256k1 = require('secp256k1');


/**
 * Implements the handlers for Quasar message types
 */
class QuasarRules {

  /**
   * @constructor
   * @param {module:dusk/quasar~QuasarPlugin} quasar
   */
  constructor(quasar) {
    this.quasar = quasar;
  }

  /**
   * Upon receipt of a PUBLISH message, we validate it, then check if we or
   * our neighbors are subscribed. If we are subscribed, we execute our
   * handler. If our neighbors are subscribed, we relay the publication to
   * ALPHA random of the closest K. If our neighbors are not subscribed, we
   * relay the publication to a random contact
   * @param {AbstractNode~request} request
   * @param {AbstractNode~response} response
   * @param {AbstractNode~next} next
   */
  publish(request, response, next) {
    console.log('publish', request)
    /* eslint max-statements: [2, 18] */
    let { ttl, topic, uuid, contents, origin } = request.params;
    let neighbors = [...this.quasar.node.router.getClosestContactsToKey(
      this.quasar.node.identity,
      constants.K
    ).entries()];

    if (!utils.isHexaString(contents)) {
      return next('Invalid publication contents');
    }

    if (this.quasar.cached.get(uuid)) {
      return next(new Error('Message previously routed'));
    }

    if (ttl > constants.MAX_RELAY_HOPS || ttl < 0) {
      return next(new Error('Message includes invalid TTL'));
    }

    this.quasar._verifyOrigin(uuid, topic, contents, origin).then(() => {
      neighbors = knuthShuffle(neighbors.filter(([nodeId]) => {
        return request.params.publishers.indexOf(nodeId) === -1;
      })).splice(0, constants.ALPHA);

      request.params.publishers.push(this.quasar.node.identity.toString('hex'));
      this.quasar.cached.set(uuid, Date.now());

      if (this.quasar.isSubscribedTo(topic)) {
        this.quasar.groups.get(topic)(contents, topic);

        async.each(neighbors, (contact, done) => {
          this._relayPublication(request, contact, done);
        });
        return response.send([]);
      }

      if (ttl - 1 === 0) {
        return response.send([]);
      }

      async.each(neighbors, (contact, done) => {
        this.quasar.pullFilterFrom(contact, (err, filter) => {
          if (err) {
            return done();
          }

          if (!QuasarRules.shouldRelayPublication(request, filter)) {
            contact = this.quasar._getRandomContact();
          }

          this._relayPublication(request, contact, done);
        });
      });
      response.send([]);
    }, next);
  }

  /**
   * Upon receipt of a SUBSCRIBE message, we simply respond with a serialized
   * version of our attenuated bloom filter
   * @param {AbstractNode~request} request
   * @param {AbstractNode~response} response
   */
  subscribe(request, response) {

    console.log('subscribe', request)
    response.send(this.quasar.filter.toHexArray());
  }

  /**
   * Upon receipt of an UPDATE message we merge the delivered attenuated bloom
   * filter with our own
   * @param {AbstractNode~request} request
   * @param {AbstractNode~response} response
   * @param {AbstractNode~next} next
   */
  update(request, response, next) {
    console.log('update', request)
    if (!Array.isArray(request.params)) {
      return next(new Error('Invalid bloom filters supplied'));
    }

    try {
      request.params.forEach(str => assert(utils.isHexaString(str),
        'Invalid hex string'));
      this.quasar.filter.merge(BloomFilter.from(request.params));
    } catch (err) {
      return next(err);
    }

    response.send([]);
  }

  /**
   * Returns a boolean indicating if we should relay the message to the contact
   * @param {AbstractNode~request} request
   * @param {array} attenuatedBloomFilter - List of topic bloom filters
   */
  static shouldRelayPublication(request, filter) {
    let negated = true;

    filter.forEach((level) => {
      if (level.has(request.params.topic)) {
        negated = false;
      }
    });

    request.params.publishers.forEach((pub) => {
      filter.forEach((level) => {
        if (level.has(pub)) {
          negated = true;
        }
      });
    });

    return !negated;
  }

  /**
   * Takes a request object for a publication and relays it to the supplied
   * contact
   * @private
   */
  _relayPublication(request, contact, callback) {
    this.quasar.node.send(
      request.method,
      merge({}, request.params, { ttl: request.params.ttl - 1 }),
      contact,
      callback
    );
  }

}


/**
 * Implements the primary interface for the publish-subscribe system
 * and decorates the given node object with it's public methods
 */
class QuasarPlugin {

  static get PUBLISH_METHOD() {
    return 'PUBLISH';
  }

  static get SUBSCRIBE_METHOD() {
    return 'SUBSCRIBE';
  }

  static get UPDATE_METHOD() {
    return 'UPDATE';
  }

  /**
   * @constructor
   * @param {KademliaNode} node
   */
  constructor(node) {
    const handlers = new QuasarRules(this);

    this.cached = new LruCache(constants.LRU_CACHE_SIZE)
    this.groups = new Map();
    this.filter = new BloomFilter({
      filterDepth: constants.FILTER_DEPTH,
      bitfieldSize: constants.B
    });
    this._lastPushUpdate = 0;
    this._lastPullUpdate = 0;

    this.node = node;
    this.node.quasarSubscribe = this.quasarSubscribe.bind(this);
    this.node.quasarPublish = this.quasarPublish.bind(this);

    this.node.use(QuasarPlugin.UPDATE_METHOD, handlers.update.bind(handlers));
    this.node.use(QuasarPlugin.PUBLISH_METHOD,
      handlers.publish.bind(handlers));
    this.node.use(QuasarPlugin.SUBSCRIBE_METHOD,
      handlers.subscribe.bind(handlers));

    this.filter[0].add(this.node.identity.toString('hex'));
  }

  /**
   * Returns our ALPHA closest neighbors
   * @property {Bucket~contact[]} neighbors
   */
  get neighbors() {
    return [...this.node.router.getClosestContactsToKey(
      this.node.identity.toString('hex'),
      constants.ALPHA
    ).entries()];
  }

  /**
   * Publishes the content to the network by selecting ALPHA contacts closest
   * to the node identity (or the supplied routing key). Errors if message is
   * unable to be delivered to any contacts. Tries to deliver to ALPHA contacts
   * until exhausted.
   * @param {object} contents - Arbitrary publication payload
   * @param {object} [options]
   * @param {string} [options.routingKey] - Publish to neighbors close to this
   * key instead of our own identity
   * @param {QuasarPlugin~quasarPublishCallback} [callback]
   */
  quasarPublish(contents, options = {}, callback = () => null) {
    
    console.log('quasarPublish', contents, callback)
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    if (!Buffer.isBuffer(contents)) {
      return callback(new Error('publish contents must be a buffer'));
    }
    contents = contents.toString('hex');

    const topic = this.node.identity.toString('hex');
    console.log(topic)
    const publicationId = uuid.v4();
    const neighbors = [...this.node.router.getClosestContactsToKey(
      options.routingKey || this.node.identity.toString('hex'),
      this.node.router.size
    ).entries()];

    let deliveries = [];

    async.until(() => {
      return deliveries.length === constants.ALPHA || !neighbors.length;
    }, done => {
      const candidates = [];

      for (let i = 0; i < constants.ALPHA - deliveries.length; i++) {
        candidates.push(neighbors.shift());
      }

      async.each(candidates, (contact, next) => {
        this.node.send(QuasarPlugin.PUBLISH_METHOD, {
          uuid: publicationId,
          topic,
          contents,
          origin: this._signOrigin(publicationId, contents),
          publishers: [this.node.identity.toString('hex')],
          ttl: constants.MAX_RELAY_HOPS
        }, contact, err => {
          if (err) {
            this.node.logger.warn(err.message);
          } else {
            deliveries.push(contact);
          }

          next();
        });
      }, done);
    }, err => {
      if (!err && deliveries.length === 0) {
        err = new Error('Failed to deliver any publication messages');
      }

      callback(err, deliveries);
    });
  }
  /**
   * @callback QuasarPlugin~quasarPublishCallback
   * @param {error|null} err
   * @param {Bucket~contact[]} deliveries
   */

  /**
   * Publishes the content to the network
   * @param {string|string[]} topics - Identifier for subscribers
   * @param {QuasarPlugin~quasarSubscribeHandler} handler
   */
  quasarSubscribe(topics, handler) {
    const self = this;
    console.log('quasarSubscribe', topics, handler)

    if (Array.isArray(topics)) {
      topics.forEach((topic) => addTopicToFilter(topic));
    } else {
      addTopicToFilter(topics);
    }

    function addTopicToFilter(topic) {
      self.filter[0].add(topic);
      self.groups.set(topic, handler);
    }

    this.pullFilters(() => this.pushFilters());
  }
  /**
   * @callback QuasarPlugin~quasarSubscribeHandler
   * @param {object} publicationContent
   */

  /**
   * Requests neighbor bloom filters and merges with our records
   * @param {function} [callback]
   */
  pullFilters(callback = () => null) {
    console.log('pullFilters')
    const now = Date.now();

    if (this._lastPullUpdate > now - constants.SOFT_STATE_TIMEOUT) {
      return callback();
    } else {
      this._lastPullUpdate = now;
    }

    async.each(this.neighbors, (contact, done) => {
      this.pullFilterFrom(contact, (err, filter) => {
        if (err) {
          this.node.logger.warn('failed to pull filter from %s, reason: %s',
            contact[0], err.message);
        } else {
          this.filter.merge(filter);
        }

        done(err);
      });
    }, callback);
  }

  /**
   * Requests the attenuated bloom filter from the supplied contact
   * @param {Bucket~contact} contact
   * @param {function} callback
   */
  pullFilterFrom(contact, callback) {
    const method = QuasarPlugin.SUBSCRIBE_METHOD;
    console.log('pullFilterFrom', contact)
    this.node.send(method, [], contact, (err, result) => {
      if (err) {
        return callback(err);
      }

      try {
        result.forEach(str => assert(utils.isHexaString(str),
          'Invalid hex string'));
        return callback(null, BloomFilter.from(result));
      } catch (err) {
        return callback(err);
      }
    });
  }

  /**
   * Notifies neighbors that our subscriptions have changed
   * @param {function} [callback]
   */
  pushFilters(callback = () => null) {
    const now = Date.now();
    console.log('pushFilters')

    console.log(this._lastPushUpdate, now - constants.SOFT_STATE_TIMEOUT)
    if (this._lastPushUpdate > now - constants.SOFT_STATE_TIMEOUT) {
      console.log('soft state timeout')
      return callback();
    } else {
      this._lastPushUpdate = now;
    }

    console.log(this.neighbors)
    async.each(this.neighbors, (contact, done) => {
      this.pushFilterTo(contact, done);
    }, callback);
  }

  /**
   * Sends our attenuated bloom filter to the supplied contact
   * @param {Bucket~contact} contact
   * @param {function} callback
   */
  pushFilterTo(contact, callback) {
    console.log('pushFilterTo');
    this.node.send(QuasarPlugin.UPDATE_METHOD, this.filter.toHexArray(),
      contact, callback);
  }

  /**
   * Check if we are subscribed to the topic
   * @param {string} topic - Topic to check subscription
   * @returns {boolean}
   */
  isSubscribedTo(topic) {
    return this.filter[0].has(topic) && this.groups.has(topic);
  }

  /**
   * Check if our neighbors are subscribed to the topic
   * @param {string} topic - Topic to check subscription
   * @returns {boolean}
   */
  hasNeighborSubscribedTo(topic) {
    let index = 1;

    while (this.filter[index]) {
      if (this.filter[index].has(topic)) {
        return true;
      } else {
        index++;
      }
    }

    return false;
  }

  /**
   * Returns a random contact from the routing table
   * @private
   */
  _getRandomContact() {
    return knuthShuffle([...this.node.router.getClosestContactsToKey(
      this.node.identity.toString('hex'),
      this.node.router.size,
      true
    ).entries()]).shift();
  }

  _signOrigin(uuid, contents) {
    const { pubkey, proof, nonce } = this.node.contact;
    const c = [
      Buffer.from(uuid, 'utf8').toString('hex'), 
      contents.toString('hex'),
      pubkey.toString('hex'),
      proof.toString('hex'),
      Buffer.from([parseInt(nonce)], 'hex').toString('hex')
    ].join('::');
    const buffer = Buffer.from(c, 'utf8');    
    const { signature, recovery } = secp256k1.ecdsaSign(
      utils.hash256(buffer),
      this.node.spartacus.privateKey
    );
    const origin = {
      pubkey,
      proof,
      nonce,
      signature: Buffer.from(signature).toString('hex'),
      recovery
    };

    return origin; 
  }

  _verifyOrigin(uuid, topic, contents, origin) {
    return new Promise((resolve, reject) => {
      let {
        pubkey, proof,
        nonce, signature
      //  recovery
      } = origin;
      contents = Buffer.from(contents, 'hex');
      const c = Buffer.from([
        Buffer.from(uuid, 'utf8').toString('hex'),
        contents.toString('hex'),
        pubkey.toString('hex'),
        proof.toString('hex'),
        Buffer.from([parseInt(nonce)], 'hex').toString('hex')
      ].join('::'), 'utf8');
      try {
        const sigValid = secp256k1.ecdsaVerify(
          Buffer.from(signature, 'hex'),
          utils.hash256(c), 
          Buffer.from(pubkey, 'hex')
        );

        if (topic !== this.node.identity.toString('hex')) {
          return reject(new Error('Topic must match the proof fingerprint'));
        }
        if (!sigValid) {
          return reject(new Error('Invalid origin signature'));
        }

        utils.eqverify(
          utils.hash256(Buffer.from(pubkey, 'hex')),
          Buffer.from(proof, 'hex'),
          parseInt(nonce),
          constants.IDENTITY_DIFFICULTY.n,
          constants.IDENTITY_DIFFICULTY.k
        ).then(resolve, reject);
      } catch (e) {
        return reject(e);
      }
    });
  }

}

/**
 * Registers a {@link module:dusk/quasar~QuasarPlugin} with a {@link KademliaNode}
 */
module.exports = function() {
  return function(node) {
    return new QuasarPlugin(node);
  };
};

module.exports.QuasarPlugin = QuasarPlugin;
module.exports.QuasarRules = QuasarRules;
