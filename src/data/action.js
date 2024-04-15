import App from '../app.js';
import EcaOrder from './eca-order.js';
import PairData from './pair-data.js';

export default class Action {
  command;
  id;
  userref;
  txid;
  pair;
  volume;
  volumeQuote;
  price;
  direction;
  account;
  type;
  isTest;

  constructor(data) {
    this.id = data.id;
    this.command = data.command;
    this.account = data.account;

    switch (this.command) {
      case 'cancelOrder':
        this.txid = data.txid;
        break;

      case 'editOrder':
        this.pair = data.pair;
        this.txid = data.txid;
        this.volume = data.volume;
        this.type = data.type;
        this.price = data.price;
        this.direction = data.direction;
        break;

      default:
        this.userref = data.userref;
        this.pair = data.pair;
        this.direction = data.direction;
        this.volume = data.volume;
        this.volumeQuote = data.volumeQuote;
        this.type = data.type;
        this.price = data.price;
        break;
    }

    this.isTest = data.isTest;
  }

  performChecks() {
    try {
      if (typeof this.type === 'undefined' || !['market', 'limit'].includes(this.type)) throw new Error(`[${this.id}]: Invalid action parameter: {ordertype}`);
      if (typeof this.direction === 'undefined' || !['buy', 'sell'].includes(this.direction))
        throw new Error(`[${this.id}]: Invalid action parameter: {direction}`);
      if (typeof this.volume === 'undefined' || this.volume == 0) throw new Error(`[${this.id}]: Invalid action parameter: {volume}`);
      if (typeof this.pair === 'undefined') throw new Error(`[${this.id}]: Invalid action parameter: {pair}`);
      if (this.type === 'limit') {
        if (typeof this.price === 'undefined' || this.price <= 0) throw new Error(`[${this.id}]: Invalid action parameter for ${this.type} order: {price}`);
      }
    } catch (e) {
      App.warning(`[${this.account}]: error in ${this.id}`);
      App.printObject(this);
      throw e;
    }
    return true;
  }

  /**
   *
   * @param {EcaOrder} order
   * @returns {Action}
   */
  static CancelAction(order, isTest = false) {
    return new Action({
      command: 'cancelOrder',
      id: order.id,
      txid: order.txid,
      account: order.account,
      isTest: isTest,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   */
  static ReplaceAction(order, pairData, isTest = false) {
    console.log(order);
    return new Action({
      command: 'editOrder',
      id: order.id,
      txid: order.txid,
      pair: pairData.id,
      account: order.account,
      price: order.price.toFixed(pairData.maxQuoteDigits),
      volume: order.volume.toFixed(pairData.maxBaseDigits),
      type: order.type,
      isTest: isTest,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {boolean} [isTest=false]
   * @returns {Action}
   */
  static MarketAction(order, pairData, currentPrice = 0, isTest = false) {
    return new Action({
      id: order.id,
      ref: order.userref,
      command: 'submitOrder',
      pair: pairData.id,
      volume: Number(order.volume).toFixed(pairData.maxBaseDigits),
      volumeQuote: order.volumeQuote.toFixed(pairData.maxQuoteDigits),
      //price: (currentPrice > 0 ? currentPrice : order.price).toFixed(pairData.maxQuoteDigits),
      direction: order.direction,
      type: 'market',
      account: order.account,
      userref: order.userref,
      sTest: isTest,
    });
  }
  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {boolean} [isTest=false]
   * @returns {Action}
   */
  static LimitAction(order, pairData, isTest = false) {
    return new Action({
      id: order.id,
      ref: order.userref,
      command: 'submitOrder',
      pair: pairData.id,
      direction: order.direction,
      volume: Number(order.volume).toFixed(pairData.maxBaseDigits),
      type: 'limit',
      price: order.price.toFixed(pairData.maxQuoteDigits),
      volumeQuote: order.volumeQuote.toFixed(pairData.maxQuoteDigits),
      account: order.account,
      userref: order.userref,
      isTest: isTest,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @returns
   */
  static OrderToAction(order, pairData) {
    switch (order.type) {
      case 'market':
        return this.MarketAction(order, pairData);
      case 'limit':
        return this.LimitAction(order, pairData);

      default:
        App.error(`Invalid order type in ${order.id}`);
    }
  }
}
