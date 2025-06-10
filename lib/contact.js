/**
 * Interfaces for managing transport and implementation specific 
 * address information.
 * @module kdns/contacts
 */

'use strict';

const { 
  compareKeyBuffers, 
  getRandomKeyString,
  getDistance,
  hash160 } = require('./keys');


class Contact {

  /**
   * An object containing implementation-dependant address data
   * and a fingerprint.
   * @constructor
   * @param {object} [address] - Any transport specific information
   * @param {string|function} [fingerprint] - Unique ID or function for creating one
   */
  constructor(address, _fingerprint)  {    
    this.address = address || { id: getRandomKeyString() };
    this.fingerprint = typeof _fingerprint === 'function'
      ? _fingerprint(this.address).toString('hex')
      : _fingerprint
        ? _fingerprint.toString('hex')
        : hash160(JSON.stringify(this.address)).toString('hex');
  }

}


class ContactList {

  /**
   * State machine used for sorting through {@link Contact}s during 
   * a {@link Node#iterativeFindNode} lookup.
   * @constructor
   * @param {string} key - 160 bit hex reference key for distance caluclation
   * @param {Array<module:kdns/contacts~Contact>} [contacts] - List to initialize with
   */
  constructor(key, contacts = []) {
    this.key = key;

    this._contacts = [];
    this._contacted = new Set();
    this._active = new Set();

    this.add(contacts);
  }

  /**
   * @property {module:kdns/contacts~Contact} closest - The contact closest to the reference key
   */
  get closest() {
    return this._contacts[0];
  }

  /**
   * @property {module:kdns/contacts~Contact[]} active - Contacts in the list that are active
   */
  get active() {
    return this._contacts.filter(contact => this._active.has(contact.fingerprint));
  }

  /**
   * @property {module:kdns/contacts~Contact[]} uncontacted - Contacts in the list that have not been
   * contacted
   */
  get uncontacted() {
    return this._contacts.filter(contact => !this._contacted.has(contact.fingerprint));
  }

  /**
   * Adds the given contacts to the list
   * @param {module:kdns/contacts~Contact[]} contacts - Contacts to add to the list
   * @returns {module:kdns/contacts~Contact[]} added - Contacts added to the list
   */
  add(contacts) {
    let identities = this._contacts.map(c => c.fingerprint);
    let added = [];

    contacts.forEach(contact => {
      if (identities.indexOf(contact.fingerprint) === -1) {
        this._contacts.push(contact);
        identities.push(contact.fingerprint);
        added.push(contact);
      }
    });

    this._contacts.sort(this._identitySort.bind(this));

    return added;
  }

  /**
   * Marks the supplied contact as contacted
   * @param {module:kdns/contacts~Contact} contact - Mark as contacted
   * @returns {undefined}
   */
  contacted(contact) {
    this._contacted.add(contact.fingerprint);
  }

  /**
   * Marks the supplied contact as active
   * @param {module:kdns/contacts~Contact} contact - Mark as responded
   * @returns {undefined}
   */
  responded(contact) {
    this._active.add(contact.fingerprint);
  }

  /**
   * @private
   */
  _identitySort(aContact, bContact) {
    return compareKeyBuffers(
      Buffer.from(getDistance(aContact.fingerprint, this.key), 'hex'),
      Buffer.from(getDistance(bContact.fingerprint, this.key), 'hex')
    );
  }

}

module.exports.ContactList = ContactList;
module.exports.Contact = Contact;
