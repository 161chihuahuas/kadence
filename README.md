# kadence *primitives for building p2p networks*

Kadence is a complete implementation of the 
[Kademlia](http://www.scs.stanford.edu/%7Edm/home/papers/kpos.pdf) distributed 
hash table. Kadence provides developers of distributed systems a 
set of primitives for inventing new protocols on a solid, well-tested base.

```
npm install @tacticalchihuahua/kadence
```

## example: quickstart template

Kadence focuses on just the protocol implementation and primitives. It leaves 
the transport and storage layers up to you. This is exposed through an 
event-driven interface. You can have a functional peer-to-peer network 
by writing just a few basic functions to handle some key events.

```js
const kadence = require('@tacticalchihuahua/kadence');
const node = new kadence.Node();

// how do you want to listen for connections and messages?
// use the kadence.Protocol object on node.protocol handle 
// messages received. see test/kadence.e2e.js for example 
// that uses JSON-RPC over TCP sockets

node.on('message_queued', (method, params, target, send) => {
    // how do you want to send another node a message?
    // do that here. serialize and transport however you like.
    // should be the "client" to the "server" you just setup
});

node.on('storage_get', (hash, done) => {
    // where are you going to fetch DHT entries from?
    // do that here using the hash as the lookup key
});

node.on('storage_put', (hash, data, done) => {
    // how do you want to save DHT entries?
    // do that here using the hash as a key. data has a 
    // blob and meta properties
});

node.on('storage_delete', (hash, done) => {
    // how do you want to delete DHT entries?
    // do that here keying from the hash. data does not have 
    // be immediately deleted.
});

node.on('storage_replicate', (replicatorStream) => {
    // the node wants to replicate. pipe a readable stream 
    // to the replicator and it will decide how to store entries
});

node.on('storage_expire', (expirerStream) => {
    // the node wants to expire distant items. pipe a readable
    // stream and it will decide how to expire entries
});

```

## research

Kadence has been used in academic research on distributed systems over the years. 
Some notable papers:

* [Secure and Trustable Distributed Aggregation based on Kademlia](https://arxiv.org/pdf/1709.03265.pdf)
* [Distributed Random Process for a large-scale Peer-to-Peer Lottery](https://hal.inria.fr/hal-01583824/document)
* [DHT-based collaborative Web Translation](https://etd.ohiolink.edu/!etd.send_file?accession=ucin1479821556144121&disposition=inline)
* [Kademlia with Consistency Checks as a Foundation of Borderless Collaboration in Open Science Services](https://www.sciencedirect.com/science/article/pii/S1877050916327041)

## license

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.


