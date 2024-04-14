export default class ExchangeOrder {
  /** @type {string} */
  type;
  /** @type {string} */
  status;
  /** @type {string} */
  side;
  /** @type {Date} */
  openDate;
  /** @type {Date} */
  closeDate;
  /** @type {Number} */
  volume;
  /** @type {Number} */
  price;
  /** @type {string} */
  txid;
  /**@type {string} */
  userref;
  /**@type {string} */
  pair;
  /** @type {Number} */
  fees;
  /** @type {Number} */
  cost;

  constructor(data) {
    this.type = data.type;
    this.status = data.status;
    this.side = data.side;
    this.openDate = data.openDate;
    this.closeDate = data.closeDate;
    this.volume = data.volume;
    this.price = data.price;
    this.txid = data.txid;
    this.userref = data.userref;
    this.fees = data.fees;
    this.cost = data.cost;
    this.pair = data.pair;
  }

  get isOpen() {
    return this.status === 'open';
  }

  get isClosed() {
    return this.status === 'closed';
  }
}
