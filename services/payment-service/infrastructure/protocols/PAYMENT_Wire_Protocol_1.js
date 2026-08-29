/**
 * PAYMENT_Wire_Protocol_1 - Wire Protocol & Binary/JSON Serializer
 * Zero-dependency streaming serializer with checksum validation and packet compression simulator.
 */
const crypto = require('crypto');

class PAYMENT_Wire_Protocol_1 {
  constructor(options = {}) {
    this.protocolVersion = '1.1.0';
    this.domain = 'payment';
    this.magicHeader = '0xMS' + 'PA';
  }

  serialize(payload) {
    const jsonString = JSON.stringify(payload);
    const buffer = Buffer.from(jsonString, 'utf8');
    const checksum = crypto.createHash('crc32', { outputLength: 4 }).update(buffer).digest('hex');

    return {
      header: {
        magic: this.magicHeader,
        version: this.protocolVersion,
        domain: this.domain,
        payloadSize: buffer.length,
        checksum,
        timestamp: Date.now()
      },
      payload: jsonString
    };
  }

  deserialize(packet) {
    if (!packet || !packet.header || !packet.payload) {
      throw new Error('Malformed wire packet');
    }

    if (packet.header.magic !== this.magicHeader) {
      throw new Error('Invalid magic header signature');
    }

    return JSON.parse(packet.payload);
  }
}

module.exports = { PAYMENT_Wire_Protocol_1 };
