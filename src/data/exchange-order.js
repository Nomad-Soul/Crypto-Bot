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

  /**
   *
   * @param { {txid?:string, type: string, side: string, status: string, openDate: Date, closeDate?: Date, price: Number, volume?: Number, fees: Number, cost?: Number, userref: any, pair?:string}} data
   */
  constructor(data) {
    this.type = data.type;
    this.status = data.status;
    this.side = data.side;
    this.openDate = new Date(data.openDate);
    this.price = data.price;
    this.volume = data.volume;
    this.txid = data.txid;
    this.userref = data.userref;
    this.fees = Number(data.fees);
    this.cost = data.cost;
    this.pair = data.pair;

    if (data.closeDate) this.closeDate = new Date(data.closeDate);

    if (this.type === 'market') {
      if (!this.openDate) {
        this.openDate = new Date();
        this.closeDate = this.openDate;
        if (!this.status) this.status = 'closed';
      }
    }

    if (this.isClosed && !this.closeDate) {
      App.printObject(data);
      App.error(`Order ${this.txid} does not have a closing time`);
    }

    if (this.status !== 'planned' && !this.txid) {
      App.printObject(data);
      App.error(`Orders that have been submitted to an exchange must have a transaction id <txid>`);
    }

    if (this.txid && !this.status) {
      if (this.status !== 'open' && !this.volume) {
        App.printObject(data);
        App.error(`Order ${this.txid} is invalid`);
      }
    }
  }

  get isOpen() {
    return this.status === 'open' || this.status === 'planned';
  }

  get isClosed() {
    return this.status === 'closed';
  }

  get isCancelled() {
    return this.status === 'cancelled';
  }
}
