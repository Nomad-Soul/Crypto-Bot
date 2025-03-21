import Terminal from '../app/terminal.js';
import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import PairData from './pair-data.js';
import App from '../app/app.js';

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
      Terminal.printObject(data);
      Terminal.error(`Order ${this.txid} does not have a closing time`);
    }

    if (this.isOpen && !this.cost) {
      this.cost = this.volume * this.price + this.fees;
    }

    if (this.status !== 'planned' && !this.txid) {
      Terminal.printObject(data);
      Terminal.error(`Orders that have been submitted to an exchange must have a transaction id <txid>`);
    }

    if (this.txid && !this.status) {
      if (this.status !== 'open' && !this.volume) {
        Terminal.printObject(data);
        Terminal.error(`Order ${this.txid} is invalid`);
      }
    }
  }

  get totalCost() {
    return this.volume * this.price + this.fees;
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

  /**
   *
   * @param {PairData} pairData
   * @returns {string}
   */
  toString(pairData) {
    var sideColor = this.side === 'buy' ? '^G' : '^R';
    var costColor = this.side === 'buy' ? '^R' : '^G';
    var orderColor = this.type === 'market' ? '^R' : '^y';
    var volume = `^C${this.volume.toFixed(pairData.maxBaseDigits)}^`;
    var price = `^Y${this.price.toFixed(pairData.maxQuoteDigits)}^`;

    var minQuoteDigits = Math.min(App.locale.minQuoteDigits, pairData.maxQuoteDigits);
    var cost = `${costColor}${this.totalCost.toFixed(minQuoteDigits)}^`;
    return `${orderColor}${this.type} ${sideColor}${this.side} ${volume} ${pairData.base.toUpperCase()} at ${price} for ${cost} ${pairData.quote.toUpperCase()}`;
  }
}
