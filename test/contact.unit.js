'use strict';

const { expect } = require('chai');
const { ContactList, Contact } = require('../lib/contact');

describe('@class ContactList', function() {
  describe('@property closest', function() {
    it('returns the closest node to the key', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      expect(shortlist.closest.fingerprint).to.equal(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
      );
    });
  });

  describe('@property active', function() {
    it('returns nodes that have responded', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      shortlist.responded(
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
      );
      expect(shortlist.active.length).to.equal(1);
      expect(shortlist.active[0].fingerprint).to.equal(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'
      );
    });
  });

  describe('@property uncontacted', function() {
    it('returns uncontacted nodes', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      shortlist.contacted(
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125')
      );
      expect(shortlist.uncontacted.length).to.equal(2);
      expect(shortlist.uncontacted).to.not.deep.include(
        new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125')
      );
    });
  });

  describe('@method add', function() {
    it('adds new nodes in distance order', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      shortlist.add(
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc124'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc129'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc123')
        ]
      );
      expect(shortlist.closest.fingerprint).to.equal(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'
      );
      expect(shortlist._contacts.slice(-1)[0].fingerprint).to.equal(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc129'
      );
    });

    it('does not insert duplicates', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      shortlist.add(
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125')
        ]
      );
      expect(shortlist._contacts.length).to.equal(3);
    });

    it('returns the inserted nodes', function() {
      let contact = { hostname: 'localhost', port: 8080 };
      let shortlist = new ContactList(
        'ea48d3f07a5241291ed0b4cab6483fa8b8fcc126',
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc127'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc128')
        ]
      );
      let added = shortlist.add(
        [
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc125'),
          new Contact(contact, 'ea48d3f07a5241291ed0b4cab6483fa8b8fcc129')
        ]
      );
      expect(added.length).to.equal(1);
      expect(added[0].fingerprint).to.equal('ea48d3f07a5241291ed0b4cab6483fa8b8fcc129');
    });
  });
});
