'use strict';

const { 
  compareKeyBuffers, 
  getRandomKeyString,
  getDistance,
  hash160 } = require('./utils');

class Contact {

  constructor(address, _fingerprint)  {
    
    this.address = address || { id: getRandomKeyString() };
    this.fingerprint = typeof _fingerprint === 'function'
      ? _fingerprint(this.address)
      : _fingerprint || hash160(JSON.stringify(this.address));
  }

}

class ContactList {

  constructor(key, contacts = []) {
    this.key = key;

    this._contacts = [];
    this._contacted = new Set();
    this._active = new Set();

    this.add(contacts);
  }

  /**
   * @property {Bucket~contact} closest - The contact closest to the reference key
   */
  get closest() {
    return this._contacts[0];
  }

  /**
   * @property {Bucket~contact[]} active - Contacts in the list that are active
   */
  get active() {
    return this._contacts.filter(contact => this._active.has(contact.fingerprint));
  }

  /**
   * @property {Bucket~contact[]} uncontacted - Contacts in the list that have not been
   * contacted
   */
  get uncontacted() {
    return this._contacts.filter(contact => !this._contacted.has(contact.fingerprint));
  }

  /**
   * Adds the given contacts to the list
   * @param {Bucket~contact[]} contacts
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
   * @param {Bucket~contact} contact
   */
  contacted(contact) {
    this._contacted.add(contact.fingerprint);
  }

  /**
   * Marks the supplied contact as active
   * @param {Bucket~contact} contact
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
