'use strict';

const { Writable: WritableStream } = require('node:stream');
const { EventEmitter } = require('node:events');

const constants = require('./constants');
const utils = require('./utils');

const { Protocol } = require('./protocol');
const { Contact, ContactList } = require('./contact');
const { Router } = require('./router');


class Node {

  /**
   * @constructor
   */
  constructor(contact, options = {}) {
    this._lookups = new Map(); // NB: Track the last lookup time for buckets
    this._pings = new Map(); // NB: Track the last ping time for contacts
   
    this.events = new EventEmitter();
    this.contact = contact || new Contact();
    this.identity = Buffer.from(this.contact.fingerprint, 'hex')
    this.router = options.router || new Router(this.identity);
    this.protocol = options.protocol || new Protocol(this.router);
    
    setInterval(
      utils.preventConvoy(() => this.refresh(0)),
      constants.T_REFRESH
    );

    setInterval(
      utils.preventConvoy(() => this.replicate(() => this.expire())),
      constants.T_REPLICATE
    );
  }

  /**
   * Inserts the given contact into the routing table and uses it to perform
   * a {@link Node#iterativeFindNode} for this node's identity,
   * then refreshes all buckets further than it's closest neighbor, which will
   * be in the occupied bucket with the lowest index
   * @param {Bucket~contact} peer - Peer to bootstrap from
   * @returns {Promise}
   */
  join(peer) {
    return this._join(peer);
  }

  /**
   * @private
   */
  _join(contact) {
    const identity = contact.fingerprint;

    return new Promise(async (resolve, reject) => {
      this.router.addContactByNodeId(identity, contact);
      try {
        await this.iterativeFindNode(this.identity.toString('hex'));
        await this.refresh(this.router.getClosestBucket() + 1);
      } catch (e) {
        return reject(e);
      }
      resolve();
    });
  }

  /**
   * Sends a PING message to the supplied contact, resolves with latency
   * @param {Bucket~contact} peer
   * @returns {Promise<number>}
   */
  ping(contact) {
    return this._ping(contact);
  }

  /**
   * @private
   */
  _ping(contact) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      
      this.events.emit('node:rpc', 'PING', [], contact, (err) => {
        if (err) {
          return reject(err);
        }

        resolve(Date.now() - start);
      });
    });
  }

  /**
   * @private
   */
  _createStorageItem(value) {
    if (typeof value === 'string') {
      value = Buffer.from(value);
    } else if (Buffer.isBuffer(value)) {
      // noop
    } else if (typeof value === 'object') {
      const keys = Object.keys(value);
      const meta = Object.keys(value.meta);
      const alreadyHasMetadata = keys.includes('blob') &&
                                 meta.includes('publisher') &&
                                 meta.includes('timestamp');

      if (alreadyHasMetadata) {
        value.meta.timestamp = Date.now();
        value.meta.publisher = value.meta.publisher.toString('hex');
        return value;
      }
    }

    return {
      blob: value,
      meta: {
        timestamp: Date.now(),
        publisher: this.identity.toString('hex')
      }
    };
  }

  /**
   * Performs a {@link Node#iterativeFindNode} to collect K contacts
   * nearest to the given key, sending a STORE message to each of them.
   * @param {buffer|string} key - Key to store data under
   * @param {buffer|string|object} value - Value to store by key
   * @returns {Promise<number>}
   */
  iterativeStore(key, value) {
    return this._iterativeStore(key, value);
  }
  /**
   * Note that if there is a protocol/validation error, you will not receive
   * it as an error in the callback. Be sure to also check that stored > 0 as
   * part of error handling here.
   * @callback Node~iterativeStoreCallback
   * @param {error|null} error
   * @param {number} stored - Total nodes who stored the pair
   */

  /**
   * @private
   */
  _iterativeStore(key, value) {
    return new Promise(async (resolve, reject) => {
      key = key.toString('hex');
      let stored = 0;

      const _wrapStore = (key, item, target) => {
        return new Promise((resolve, reject) => {
          this.events.emit('node:rpc', 'STORE', [key, item], target, (e) => {
            if (e) {
              return reject(e);
            }

            resolve();
          });
        });
      };

      const dispatchStoreRpcs = async (iterator) => {
        for (const [, target] of iterator) {
          try {
            await _wrapStore(key, this._createStorageItem(value), target);
          } catch (err) {
            continue;
          }
          
          stored++;
        }
      };

      const contacts = await this.iterativeFindNode(key);
      const entries = contacts.entries();
      const workers = new Array(constants.ALPHA).fill(entries).map(dispatchStoreRpcs);

      await Promise.allSettled(workers);

      if (stored === 0) {
        return reject(new Error('Failed to stored entry with peers'));
      }
      
      resolve(stored);
    });
  }

  /**
   * Basic kademlia lookup operation that builds a set of K contacts closest
   * to the given key
   * @param {buffer|string} key - Reference key for node lookup
   * @returns {Promise<Bucket~contact[]>}
   */
  iterativeFindNode(key) {
    key = key.toString('hex');
    return this._iterativeFind('FIND_NODE', key);
  }

  /**
   * Kademlia search operation that is conducted as a node lookup and builds
   * a list of K closest contacts. If at any time during the lookup the value
   * is returned, the search is abandoned. If no value is found, the K closest
   * contacts are returned. Upon success, we must store the value at the
   * nearest node seen during the search that did not return the value.
   * @param {buffer|string} key - Key for value lookup
   * @returns {Promise<object>}
   */
  iterativeFindValue(key) {
    key = key.toString('hex');
    return this._iterativeFind('FIND_VALUE', key);
  }

  /**
   * Performs a scan of the storage adapter and performs
   * republishing/replication of items stored. Items that we did not publish
   * ourselves get republished every T_REPLICATE. Items we did publish get
   * republished every T_REPUBLISH.
   * @returns {Promise}
   */
  replicate() {
    this.events.emit('node:replicate', this._replicate());
  }

  /**
   * @private
   */
  _replicate() {
    const replicateStream = new WritableStream({
      objectMode: true,
      write: maybeReplicate
    });

    function maybeReplicate({ key, meta, blob }, next) {
      const isPublisher = meta.publisher === self.identity.toString('hex');
      const republishDue = (meta.timestamp + constants.T_REPUBLISH) <= now;
      const replicateDue = (meta.timestamp + constants.T_REPLICATE) <= now;
      const shouldRepublish = isPublisher && republishDue;
      const shouldReplicate = !isPublisher && replicateDue;

      if (shouldReplicate || shouldRepublish) {
        return self.iterativeStore(key, { meta, blob }, next);
      }

      next();
    }

    return replicateStream;
  }

  /**
   * Items expire T_EXPIRE seconds after the original publication. All items
   * are assigned an expiration time which is "exponentially inversely
   * proportional to the number of nodes between the current node and the node
   * whose ID is closest to the key", where this number is "inferred from the
   * bucket structure of the current node".
   * @returns {Promise}
   */
  expire() {
    this.events.emit('node:expire', this._expire());
  }

  /**
   * @private
   */
  _expire() {
    const self = this;
    const now = Date.now();

    const expireStream = new WritableStream({
      objectMode: true,
      write: maybeExpire
    });

    function maybeExpire({ key, meta, blob }, next) {
      if ((meta.timestamp + constants.T_EXPIRE) <= now) {
        self.events.emit('storage:del', key);
      }

      next();
    }

    return expireStream;
  }

  /**
   * If no node lookups have been performed in any given bucket's range for
   * T_REFRESH, the node selects a random number in that range and does a
   * refresh, an iterativeFindNode using that number as key.
   * @param {number} startIndex - bucket index to start refresh from
   * @returns {Promise}
   */
  refresh(startIndex = 0) {
    return this._refresh(startIndex);
  }

  /**
   * @private
   */
  _refresh(startIndex) {
    const now = Date.now();
    const indices = [
      ...this.router.entries()
    ].slice(startIndex).map((entry) => entry[0]);

    // NB: We want to avoid high churn during refresh and prevent further
    // NB: refreshes if lookups in the next bucket do not return any new
    // NB: contacts. To do this we will shuffle the bucket indexes we are
    // NB: going to check and only continue to refresh if new contacts were
    // NB: discovered in the last MAX_UNIMPROVED_REFRESHES consecutive lookups.
    let results = new Set(), consecutiveUnimprovedLookups = 0;

    function isDiscoveringNewContacts() {
      return consecutiveUnimprovedLookups < constants.MAX_UNIMPROVED_REFRESHES;
    }

    return new Promise(async (resolve, reject) => {
      indices = utils.knuthShuffle(indices);

      for (let i = 0; i < indices.length; i++) {
        let index = indices[i];
        
        if (!isDiscoveringNewContacts()) {
          return resolve();
        }

        const lastBucketLookup = this._lookups.get(index) || 0;
        const needsRefresh = lastBucketLookup + constants.T_REFRESH <= now;

        if (needsRefresh) {
          let contacts;

          try {
            contacts = await this.iterativeFindNode(
              utils.getRandomBufferInBucketRange(this.identity, index)
                .toString('hex')
            );
          } catch (e) {
            return reject(e);
          }

          let discoveredNewContacts = false;

          for (let [identity] of contacts) {
            if (!results.has(identity)) {
              discoveredNewContacts = true;
              consecutiveUnimprovedLookups = 0;
              results.add(identity);
            }
          }

          if (!discoveredNewContacts) {
            consecutiveUnimprovedLookups++;
          }
        }
      }
      
      resolve();
    });
  }

  /**
   * Builds a list of closest contacts for a particular RPC
   * @private
   */
  _iterativeFind(method, key) {
    return new Promise((resolve) => {
      function createRpc(method, target) {
        return [method, [key], target];
      }

      let shortlist = new ContactList(key, [
        ...this.router.getClosestContactsToKey(key, constants.ALPHA)
      ]);
      let closest = shortlist.closest;

      this._lookups.set(utils.getBucketIndex(this.identity, key), Date.now());

      async function iterativeLookup(selection, continueLookup = true) {
        if (!selection.length) {
          return resolve(shortlist.active.slice(0, constants.K));
        }

        for (let i = 0; i < selection.length; i++) {
          const contact = selection[i];

          // NB: mark this node as contacted so as to avoid repeats
          shortlist.contacted(contact);

          let result;

          try {
            result = await this.events.emit('node:rpc', ...createRpc(method, contact));
          } catch (e) {
            continue;
          }

          // NB: mark this node as active to include it in any return values
          shortlist.responded(contact);

          // NB: If the result is a contact/node list, just keep track of it
          // NB: Otherwise, do not proceed with iteration, just callback
          if (Array.isArray(result) || method !== 'FIND_VALUE') {
            shortlist
              .add(Array.isArray(result) ? result : [])
              .forEach(contact => {
                // NB: If it wasn't in the shortlist, we haven't added to the
                // NB: routing table, so do that now.
                this._updateContact(contact);
              });

            continue;
          }

          // NB: If we did get an item back, get the closest node we contacted
          // NB: who is missing the value and store a copy with them
          const closestMissingValue = shortlist.active[0]

          if (closestMissingValue) {
            this.events.emit('node:rpc', 'STORE', [
              key,
              this._createStorageItem(result)
            ], closestMissingValue).then(() => null, () => null);
          }

          // NB: we found a value, so stop searching
          resolve(result, contact);
        }

        // NB: If we have reached at least K active nodes, or haven't found a
        // NB: closer node, even on our finishing trip, return to the caller
        // NB: the K closest active nodes.
        if (shortlist.active.length >= constants.K ||
          (closest[0] === shortlist.closest[0] && !continueLookup)
        ) {
          return resolve(shortlist.active.slice(0, constants.K));
        }

        // NB: we haven't discovered a closer node, call k uncalled nodes and
        // NB: finish up
        if (closest[0] === shortlist.closest[0]) {
          return iterativeLookup.call(
            this,
            shortlist.uncontacted.slice(0, constants.K),
            false
          );
        }

        closest = shortlist.closest;

        // NB: continue the lookup with ALPHA close, uncontacted nodes
        iterativeLookup.call(
          this,
          shortlist.uncontacted.slice(0, constants.ALPHA),
          true
        );
      }

      iterativeLookup.call(
        this,
        shortlist.uncontacted.slice(0, constants.ALPHA),
        true
      );
    });
  }

  /**
   * Worker for updating contact in a routing table bucket
   * @private
   */
  async _updateContact(contact) {
    const identity = contact.fingerprint.toString('hex');

    if (identity === this.identity.toString('hex')) {
      return;
    }

    const now = Date.now();
    const reset = 600000;
    const [, bucket, contactIndex] = this.router.addContactByNodeId(
      identity,
      contact
    );

    const [headId, headContact] = bucket.head;
    const lastPing = this._pings.get(headId);

    if (contactIndex !== -1) {
      return;
    }

    if (lastPing && lastPing.responded && lastPing.timestamp > (now - reset)) {
      return;
    }

    try {
      await this.ping(headContact);
    } catch (e) {
      this._pings.set(headId, { timestamp: Date.now(), responded: false });
      this.router.removeContactByNodeId(headId);
      this.router.addContactByNodeId(identity, contact);
      return;
    }

    this._pings.set(headId, { timestamp: Date.now(), responded: true });
  }
}

module.exports.Node = Node;
