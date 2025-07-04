/**
 * A column of the routing table holding up to K contacts
 * @module kdns/bucket
 */

'use strict';

const constants = require('./constants');
const keys = require('./keys');


class Bucket extends Map {

  /**
   * @constructor
   * @extends Map
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
   */
  constructor() {
    super();
  }

  /**
   * @property {number} length - The number of contacts in the bucket
   */
  get length() {
    return super.size;
  }

  /**
   * @property {Array<string, module:kdns/contacts~Contact>} head - The contact at the bucket head
   */
  get head() {
    return [...super.entries()].shift();
  }

  /**
   * @property {Array<string, module:kdns/contacts~Contact>} tail - The contact at the bucket tail
   */
  get tail() {
    return [...super.entries()].pop();
  }

  /**
   * Sets the contact to the node ID in the bucket if it is not full; if the
   * bucket already contains the contact, move it to the tail - otherwise we
   * place it at the head
   * @param {string} nodeId - The identity key for the contact
   * @param {module:kdns/contacts~Contact} contact - The address information for the contact
   * @returns {number} index
   */
  set(nodeId, contact) {
    if (this.has(nodeId)) {
      super.delete(nodeId);
      super.set(nodeId, contact);
    } else if (this.size < constants.K) {
      let bucketEntries = [...this.entries()];

      super.clear();
      super.set(nodeId, contact);

      for (let [nodeId, contact] of bucketEntries) {
        super.set(nodeId, contact);
      }
    }

    return this.indexOf(nodeId);
  }

  /**
   * Returns the index of the given node id
   * @param {string} key - Node identity key for getting index
   * @returns {number}
   */
  indexOf(key) {
    let isMissing = -1;
    let index = isMissing;

    for (let nodeId of this.keys()) {
      index++;

      if (key !== nodeId) {
        continue;
      }

      return index;
    }

    return isMissing;
  }

  /**
   * Returns an array of contacts in the bucket that are closest to the given
   * key
   * @param {string|buffer} key - Reference key for finding other contacts
   * @param {number} [count=constants.K] - Max results to return
   * @param {boolean} [exclusive=false] - Exclude result matching the key exactly
   * @returns {Array<string, module:kdns/contacts~Contact>}
   */
  getClosestToKey(key, count = constants.K, exclusive = false) {
    let contacts = [];

    for (let [identity, contact] of this.entries()) {
      contacts.push({
        contact, identity, distance: keys.getDistance(identity, key)
      });
    }

    return new Map(contacts.sort((a, b) => {
      return keys.compareKeyBuffers(
        Buffer.from(a.distance, 'hex'),
        Buffer.from(b.distance, 'hex')
      );
    }).filter((result) => {
      if (exclusive) {
        return result.identity !== key.toString('hex');
      } else {
        return true;
      }
    }).map((obj) => [obj.identity, obj.contact]).splice(0, count));
  }
}

module.exports.Bucket = Bucket;
