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
      App.printObject(this);
      throw e;
    }
  }

  /**
   *
   * @param {EcaOrder} order
   * @returns {Action}
   */
  static CancelAction(order, isTest = false) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.CancelAction');
    return new Action({
      command: 'cancelOrder',
      order: order,
      isTest: isTest,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {PairData} pairData
   * @returns {Action}
   */
  static ReplaceAction(order, pairData, isTest = false) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.ReplaceAction');
    return new Action({
      command: 'editOrder',
      order: order,
      isTest: isTest,
      pairData: pairData,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {PairData} pairData
   * @returns {Action}
   */
  static MarketAction(order, pairData) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.MarketAction');
    if (order.type !== EcaOrder.OrderTypes.market) throw new Error(`[${order.id}]: Invalid order type ${order.type} - expected 'market'`);
    return new Action({
      command: 'submitOrder',
      order: order,
      pairData: pairData,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @returns {Action}
   */
  static LimitAction(order, pairData) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.LimitAction');
    if (order.type !== EcaOrder.OrderTypes.limit) throw new Error(`[${order.id}]: Invalid order type ${order.type} - expected ${EcaOrder.OrderTypes.limit}`);
    return new Action({
      command: 'submitOrder',
      order: order,
      pairData: pairData,
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
