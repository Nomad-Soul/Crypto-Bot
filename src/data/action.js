import App from '../app.js';
import EcaOrder from './eca-order.js';
import PairData from './pair-data.js';

export default class Action {
  command;
  /** @type {EcaOrder} */
  order;
  /** @type {PairData} */
  pairData;

  constructor(data) {
    this.command = data.command;
    this.account = data.account;
    this.pairData = data.pairData;

    switch (this.command) {
      default:
        this.order = data.order;
        break;
    }

    this.isTest = data.isTest;
  }

  performChecks() {
    try {
      switch (this.command) {
        default:
          if (typeof this.order === 'undefined') throw new Error(`[${this.command}]: Invalid order`);
          return this.order.isValid();
      }
    } catch (e) {
      App.warning(`[${this.account}]: error in Action ${this.command}`);
      App.printObject(this);
      throw e;
    }
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {string} account
   * @returns {Action}
   */
  static CancelAction(order, account, isTest = false) {
    return new Action({
      command: 'cancelOrder',
      order: order,
      isTest: isTest,
      account: account,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {PairData} pairData
   * @param {string} account
   * @returns {Action}
   */
  static ReplaceAction(order, pairData, account, isTest = false) {
    return new Action({
      command: 'editOrder',
      order: order,
      isTest: isTest,
      pairData: pairData,
      account: account,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {PairData} pairData
   * @param {string} account
   * @returns {Action}
   */
  static MarketAction(order, pairData, account) {
    if (order.type !== EcaOrder.OrderTypes.market) throw new Error(`[${order.id}]: Invalid order type ${order.type} - expected 'market'`);
    return new Action({
      command: 'submitOrder',
      order: order,
      pairData: pairData,
      account: account,
    });
  }
  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {string} account
   * @returns {Action}
   */
  static LimitAction(order, pairData, account) {
    if (order.type !== EcaOrder.OrderTypes.limit) throw new Error(`[${order.id}]: Invalid order type ${order.type} - expected ${EcaOrder.OrderTypes.limit}`);
    return new Action({
      command: 'submitOrder',
      order: order,
      pairData: pairData,
      account: account,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {string} account
   * @returns
   */
  static OrderToAction(order, pairData, account) {
    switch (order.type) {
      case 'market':
        return this.MarketAction(order, pairData, account);
      case 'limit':
        return this.LimitAction(order, pairData, account);

      default:
        App.error(`Invalid order type in ${order.id}`);
    }
  }
}
