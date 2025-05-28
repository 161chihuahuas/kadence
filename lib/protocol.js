'use strict';

const { Contact } = require('./contact');
const { EventEmitter } = require('node:events');
const { Router } = require('./router');
const { keyStringIsValid, hash160 } = require('./keys');


class Protocol {

  /**
   * @constructor
   */
  constructor(router, extensions = {}) {
    this.events = new EventEmitter(); 
    this.router = router || new Router();
    
    for (let method in extensions) {
      this[method] = extensions[method].bind(this);
    }
  }

  /**
   * This RPC involves one node sending a PING message to another, which
   * presumably replies with a PONG. This has a two-fold effect: the
   * recipient of the PING must update the bucket corresponding to the
   * sender; and, if there is a reply, the sender must update the bucket
   * appropriate to the recipient.
   */
  PING(contact, respond) {
    this.router.addContactByNodeId(contact.fingerprint, contact);
    respond(null, [Date.now()]);
  }

  /**
   * The sender of the STORE RPC provides a key and a block of data and
   * requires that the recipient store the data and make it available for
   * later retrieval by that key.
   */
  STORE(key, { meta, blob }, contact, respond) {
    this.router.addContactByNodeId(contact.fingerprint, contact);
    const kbuf = Buffer.from(key, 'hex');
    const hash = hash160(Buffer.from(blob));
    const isContentAddressable = Buffer.compare(kbuf, hash) === 0;

    if (!isContentAddressable) {
      return respond(new Error('Key does not match value hash'));
    }

    this.events.emit('storage_put', key, { meta, blob }, respond);
  }

  /**
   * The FIND_NODE RPC includes a 160-bit key. The recipient of the RPC returns
   * up to K contacts that it knows to be closest to the key. The recipient
   * must return K contacts if at all possible. It may only return fewer than K
   * if it is returning all of the contacts that it has knowledge of.
   */
  FIND_NODE(key, contact, respond) {
    this.router.addContactByNodeId(contact.fingerprint, 
      new Contact(contact.address, contact.fingerprint));
   
    if (!keyStringIsValid(key)) {
      return respond(new Error('Invalid lookup key supplied'));
    }

    const result = [
      ...this.router.getClosestContactsToKey(key).entries()
    ].map(([,_contact]) => {
      return new Contact(_contact.address, _contact.fingerprint);
    });
    respond(null, result);
  }

  /**
   * A FIND_VALUE RPC includes a B=160-bit key. If a corresponding value is
   * present on the recipient, the associated data is returned. Otherwise the
   * RPC is equivalent to a FIND_NODE and a set of K contacts is returned.
   */
  FIND_VALUE(key, contact, respond) {
    this.router.addContactByNodeId(contact.fingerprint, contact);
    if (!keyStringIsValid(key)) {
      return respond(new Error('Invalid lookup key supplied'));
    }

    this.events.emit('storage_get', key, (err, item) => {
      if (err) {
        return this.FIND_NODE(key, contact, respond);
      }

      respond(null, item);
    });
  }

}

module.exports.Protocol = Protocol;
