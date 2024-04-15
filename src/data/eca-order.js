import App from '../app.js';
import Utils from '../utils.js';
import { nanoid } from 'nanoid';

export default class EcaOrder {
  static counter = 0;
  id = '';
  userref = 0;
  strategy = 'eca-stacker';
  openDate = new Date();
  /**
   * @type {Date}
   */
  closeDate = undefined;
  /** @type {Number} */
  volumeQuote;
  status = '';
  pair = '';
  botId = '';
  account = '';
  txid = '';
  type;

  constructor(data) {
    if (typeof data === 'undefined') data = {};

    this.id = data.id ?? `${data.botId}:${nanoid(12)}`;

    this.botId = data.botId;
    this.openDate = new Date(data.openDate);
    this.status = data.status ?? 'unknown';
    if (data.status === 'executed') {
      this.closeDate = new Date(data.closeDate);
    }

    this.volume = data.volume;
    this.volumeQuote = data.volumeQuote;

    if (data.strategy === 'eca-trader') {
      this.price = data.price;
      this.fees = data.fees;
    }

    this.pair = data.pair ?? '???';
    this.direction = data.direction;
    this.type = data.type;
    this.account = data.account ?? 'unknown';
    this.txid = data.txid;
    this.userref = data.userref ?? 1;
    this.strategy = data.strategy;
  }

  /**
   *
   * @param {Date} dateNow
   * @param {boolean} useCloseTime
   * @returns {number}
   */
  hoursElapsed(dateNow, useCloseTime = true) {
    return Number(Math.abs(dateNow.getTime() - (useCloseTime ? this.closeDate : this.openDate).getTime()) / (60 * 60 * 1000));
  }

  /**
   *
   * @returns
   */
  isValid() {
    try {
      if (this.status === 'planned') {
        if (typeof this.volumeQuote === 'undefined' || this.volumeQuote === 0) App.error('Invalid order parameter: {volumeQuote}');
      } else if (typeof this.volume === 'undefined' || this.volume === 0) App.error('Invalid order parameter: {volume}');
      if (typeof this.type === 'undefined') App.error('Invalid order parameter: {type}');
      if (typeof this.pair === 'undefined') throw App.error(`[${this.id}]: Invalid order parameter: {pair}`);
      switch (this.type) {
        case 'market':
          break;

        case 'limit':
          if (typeof this.price === 'undefined' || this.price === 0) App.error('Invalid order parameter: {price}');
          break;
        default:
          App.error('Invalid order type');
      }
    } catch (e) {
      App.printObject(this);
      App.rethrow(e);
    }
    return true;
  }

  get isActive() {
    return this.status === 'pending';
  }

  get isClosed() {
    return this.status === 'executed';
  }

  get isPlanned() {
    return this.status === 'planned';
  }

  get isScheduledForToday() {
    var date1 = new Date(this.openDate).setHours(0, 0, 0, 0);
    var date2 = new Date(Date.now()).setHours(0, 0, 0, 0);
    return date1 == date2;
  }

  toString() {
    return `[${this.id}] ${this.type} ${this.direction} order on ${this.account} open from ${Utils.toShortDateTime(this.openDate)}`;
  }

  toJSON() {
    switch (this.status) {
      case 'executed':
        return {
          id: this.id,
          botId: this.botId,
          type: this.type,
          direction: this.direction,
          status: this.status,
          openDate: this.openDate,
          closeDate: this.closeDate,
          strategy: this.strategy,
          txid: this.txid,
          account: this.account,
          userref: this.userref,
        };

      default:
        return this;
    }
  }
}
