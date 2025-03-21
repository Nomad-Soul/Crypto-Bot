import App from '../app/app.js';
import Utils from '../utils.js';
import { nanoid } from 'nanoid';
import ExchangeOrder from './exchange-order.js';
import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import Terminal from '../app/terminal.js';

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
  /** @type {Number} */
  volumeQuote = 0;
  #order;

  /**
   *
   * @param {{id?:string, botId: string, account: string, strategy: string, volumeQuote?: Number}} data
   * @param {ExchangeOrder} order
   */
  constructor(data, order) {
    this.id = order.txid ?? data.id ?? `${data.botId}:${nanoid(12)}`;
    this.botId = data.botId;
    this.account = data.account ?? 'unknown';
    this.strategy = data.strategy;
    this.volumeQuote = data.volumeQuote;
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

      case 'open':
        return 'pending';

      case 'planned':
        return 'planned';

      case 'cancelled':
        return 'cancelled';

      default:
        Terminal.warning(`Unknown status: ${status}`);
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
        if (typeof this.volumeQuote === 'undefined' || this.volumeQuote === 0) Terminal.error('Invalid order parameter: {volumeQuote}');
      } else if (typeof order.volume === 'undefined' || order.volume === 0) Terminal.error('Invalid order parameter: {volume}');
      if (typeof order.type === 'undefined') Terminal.error('Invalid order parameter: {type}');
      if (typeof order.pair === 'undefined') throw Terminal.error(`[${this.id}]: Invalid order parameter: {pair}`);
      switch (order.type) {
        case 'market':
          break;

        case 'limit':
          if (typeof order.price === 'undefined' || order.price === 0) Terminal.error('Invalid order parameter: {price}');
          break;
        default:
          Terminal.error('Invalid order type');
      }
    } catch (e) {
      Terminal.printObject(this);
      Terminal.rethrow(e);
    }
    return true;
  }

  get isActive() {
    return this.status === 'pending';
  }

  get isExecuted() {
    return this.status === 'executed';
  }

  get isPlanned() {
    return this.status === 'planned';
  }

  get isScheduledForToday() {
    var date1 = this.order.openDate.setHours(0, 0, 0, 0);
    var date2 = new Date().setHours(0, 0, 0, 0);

    Terminal.instance.log(`${this.isPlanned} ${date1 == date2}`);
    return this.isPlanned && date1 == date2;
  }

  get isPastExecutionDate() {
    var dateNow = new Date(Date.now());
    return this.isPlanned && this.order.openDate < dateNow;
  }

  toString() {
    var colorSide = this.order.side === 'buy' ? '^G' : '^R';
    return `[^c${this.id}] ${this.order.type} ${colorSide}${this.order.side}^ order on ^C${this.account}^ open from ^Y${Utils.toShortDateTime(this.order.openDate)}`;
  }

  toJSON() {
    switch (this.order.status) {
      default:
        return {
          id: this.id,
          botId: this.botId,
          strategy: this.strategy,
          account: this.account,
          volumeQuote: this.volumeQuote,
          status: this.status,
          order: this.order,
        };
    }
  }
}
