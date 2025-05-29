/**
 * @module kadence/router
 */

'use strict';

const { EventEmitter } = require('node:events');
const { Bucket } = require('./bucket');
const keys = require('./keys');
const constants = require('./constants');


class Router extends Map {

  /**
   * Contact is inserted into the routing table
   * @event module:kadence/router~Router#contact_added
   * @param {string} fingerprint - Node ID of the inserted contact
   */
  
  /**
   * Contact is evicted from the routing table
   * @event module:kadence/router~Router#contact_deleted
   * @param {string} fingerprint - Node ID of the evicted contact
   */

  /**
   * Kademlia routing table consisting of {@link module:kadence/constants~B} total
   * {@link module:kadence/bucket~Bucket}s - each holding up to {@link module:kadence/constants~K} 
   * total {@link module:kadence/contacts~Contact}s.
   * @constructor
   * @extends Map
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
   * @param {buffer} identity - Reference point for calculating distances
   */
  constructor(identity) {
    super();

    /**
     * Exposes events arising from handling protocol messages. Some of these 
     * events may require handling if they pass a {@link Protocol~HandlerResponse}
     * @property {buffer} identity - Reference key for distance calculation
     */
    this.identity = identity || keys.getRandomKeyBuffer();
    /**
     * Exposes events arising from handling protocol messages. Some of these 
     * events may require handling if they pass a {@link Protocol~HandlerResponse}
     * @property {EventEmitter} events - Router events interface
     */
    this.events = new EventEmitter();

    for (let b = 0; b < constants.B; b++) {
      this.set(b, new Bucket());
    }
  }

  /**
   * The total contacts in the routing table
   * @property {number} size
   */
  get size() {
    let contacts = 0;
    this.forEach((bucket) => contacts += bucket.length);
    return contacts;
  }

  /**
   * The total buckets in the routing table
   * @property {number} length
   */
  get length() {
    let buckets = 0;
    this.forEach(() => buckets++);
    return buckets;
  }

  /**
   * Returns the bucket index of the given node id
   * @param {string|buffer} nodeId - Node identity to get index for
   * @returns {number}
   */
  indexOf(nodeId) {
    return keys.getBucketIndex(this.identity, nodeId);
  }

  /**
   * Returns the contact object associated with the given node id
   * @param {string|buffer} nodeId - Node identity of the contact
   * @returns {module:kadence/contacts~Contact}
   */
  getContactByNodeId(nodeId) {
    nodeId = nodeId.toString('hex');

    return this.get(this.indexOf(nodeId)).get(nodeId);
  }

  /**
   * Removes the contact from the routing table given a node id
   * @param {string|buffer} nodeId - Node identity to remove
   * @fires module:kadence/router~Router#contact_deleted
   * @return {undefined}
   */
  removeContactByNodeId(nodeId) {
    nodeId = nodeId.toString('hex');

    this.events.emit('contact_deleted', nodeId);
    return this.get(this.indexOf(nodeId)).delete(nodeId);
  }

  /**
   * Adds the contact to the routing table in the proper bucket position,
   * returning the [bucketIndex, bucket, contactIndex, contact]; if the
   * returned contactIndex is -1, it indicates the bucket is full and the
   * contact was not added; kademlia implementations should PING the contact
   * at bucket.head to determine if it should be dropped before calling this
   * method again.
   * @fires module:kadence/router~Router#contact_added
   * @param {string|buffer} nodeId - Node identity to add
   * @param {module:kadence/contacts~Contact} contact - Contact information for peer
   * @returns {array}
   */
  addContactByNodeId(nodeId, contact) {
    nodeId = nodeId.toString('hex');

    const bucketIndex = this.indexOf(nodeId);
    const bucket = this.get(bucketIndex);
    const contactIndex = bucket.set(nodeId, contact);

    this.events.emit('contact_added', nodeId);
    return [bucketIndex, bucket, contactIndex, contact];
  }

  /**
   * Returns the [index, bucket] of the occupied bucket with the lowest index
   * @returns {module:kadence/bucket~Bucket}
   */
  getClosestBucket() {
    for (let [index, bucket] of this) {
      if (index < constants.B - 1 && bucket.length === 0) {
        continue;
      }
      return [index, bucket];
    }
  }

  /**
   * Returns a array of N contacts closest to the supplied key
   * @param {string|buffer} key - Key to get buckets for
   * @param {number} [n=20] - Number of results to return
   * @param {boolean} [exclusive=false] - Exclude exact matches
   * @returns {Map}
   */
  getClosestContactsToKey(key, n = constants.K, exclusive = false) {
    const bucketIndex = this.indexOf(key);
    const contactResults = new Map();

    function _addNearestFromBucket(bucket) {
      let entries = [...bucket.getClosestToKey(key, n, exclusive).entries()];

      entries.splice(0, n - contactResults.size)
        .forEach(([id, contact]) => {
          /* istanbul ignore else */
          if (contactResults.size < n) {
            contactResults.set(id, contact);
          }
        });
    }

    let ascIndex = bucketIndex;
    let descIndex = bucketIndex;

    _addNearestFromBucket(this.get(bucketIndex));

    while (contactResults.size < n && descIndex >= 0) {
      _addNearestFromBucket(this.get(descIndex--));
    }

    while (contactResults.size < n && ascIndex < constants.B) {
      _addNearestFromBucket(this.get(ascIndex++));
    }

    return contactResults;
  }

}

module.exports.Router = Router;
