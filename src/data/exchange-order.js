import App from '../app.js';

export default class ExchangeOrder {
  static CurrentVersion = '1.0';
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
  /** @type {string} */
  version;
  /** @type {string} */
  original;

  constructor(data) {
    this.type = data.type;
    this.status = data.status;
    this.side = data.side;
    this.openDate = new Date(data.openDate);
    this.volume = data.volume;
    this.price = data.price;
    this.txid = data.txid;
    this.userref = data.userref;
    this.fees = data.fees;
    this.cost = data.cost;
    this.pair = data.pair;
    this.original = data.original;

    if (data.closeDate)
      this.closeDate = new Date(data.closeDate);
    else if (this.type === 'market') {
      this.closeDate = new Date(data.openDate);
    } else {
      App.warning(`Order ${this.txid} does not have a closing time`);
      App.printObject(data);
      App.error();
    }
  }

  get isOpen() {
    return this.status === 'open';
  }

  get isClosed() {
    return this.status === 'closed';
  }

  get isCancelled() {
    return this.status === 'cancelled';
  }
}
