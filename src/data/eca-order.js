import App from '../app.js';
import Utils from '../utils.js';
import { nanoid } from 'nanoid';
import ExchangeOrder from './exchange-order.js';

export default class EcaOrder {
  static counter = 0;
  static OrderTypes = {
    market: 'market',
    limit: 'limit',
  };

  id = '';
  strategy = 'eca-stacker';
  botId = '';
  account = '';
  txid = '';
  #order;

  /**
   *
   * @param {any} data
   * @param {ExchangeOrder} order
   */
  constructor(data, order) {
    this.id = `${data.botId}:${nanoid(12)}`;
    this.botId = data.botId;
    this.account = data.account ?? 'unknown';
    this.strategy = data.strategy;
    this.#order = order;
    this.status = EcaOrder.StatusFromExchangeOrder(order.status);
  }

  /**
   * @param {string} status
   */
  static StatusFromExchangeOrder(status) {
    switch (status) {
      case 'closed':
        return 'executed';

      default:
        App.warning(`Unknown status: ${status}`);
        return status;
    }
  }

  get order() {
    return this.#order;
  }

  /**
   *
   * @param {Date| undefined} dateEnd
   * @param {boolean} useCloseTime
   * @returns {number}
   */
  hoursElapsed(dateEnd = undefined, useCloseTime = true) {
    var date;
    if (!dateEnd) date = Date.now();
    else date = dateEnd.getTime();
    return Number(Math.abs(date - (useCloseTime ? this.order.closeDate : this.order.openDate).getTime()) / (60 * 60 * 1000));
  }

  /**
   *
   * @returns
   */
  isValid() {
    var order = this.order;
    try {
      if (order.status === 'planned') {
        if (typeof this.volumeQuote === 'undefined' || this.volumeQuote === 0) App.error('Invalid order parameter: {volumeQuote}');
      } else if (typeof order.volume === 'undefined' || order.volume === 0) App.error('Invalid order parameter: {volume}');
      if (typeof order.type === 'undefined') App.error('Invalid order parameter: {type}');
      if (typeof order.pair === 'undefined') throw App.error(`[${this.id}]: Invalid order parameter: {pair}`);
      switch (order.type) {
        case 'market':
          break;

        case 'limit':
          if (typeof order.price === 'undefined' || order.price === 0) App.error('Invalid order parameter: {price}');
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
    return this.order.status === 'pending';
  }

  get isClosed() {
    return this.order.status === 'executed';
  }

  get isPlanned() {
    return this.order.status === 'planned';
  }

  get isScheduledForToday() {
    var date1 = new Date(this.order.openDate).setHours(0, 0, 0, 0);
    var date2 = new Date(Date.now()).setHours(0, 0, 0, 0);
    return this.isPlanned && date1 == date2;
  }

  get isPastExecutionDate() {
    var dateNow = new Date(Date.now());
    return this.isPlanned && this.order.openDate < dateNow;
  }

  toString() {
    return `[${this.id}] ${this.order.type} ${this.order.side} order on ${this.account} open from ${Utils.toShortDateTime(this.openDate)}`;
  }

  toJSON() {
    switch (this.order.status) {
      default:
        return {
          id: this.id,
          botId: this.botId,
          strategy: this.strategy,
          txid: this.txid,
          account: this.account,
        };
    }
  }
}
