import App from '../app/app.js';
import Terminal from '../app/terminal.js';
import EcaOrder from './eca-order.js';
import PairData from './pair-data.js';

export default class Action {
  command;
  /** @type {EcaOrder} */
  plannedOrder;
  /** @type {PairData} */
  pairData;

  /** @type {string} */
  tradeId;

  /** @type {import('../types.js').postExecutionCallback} */
  postExecutionCallback;

  /**
   *
   * @param {{command: string, pairData?: PairData, order: EcaOrder, tradeId?: string, isTest?: Boolean, callback?: import('../types.js').postExecutionCallback}} data
   */
  constructor(data) {
    this.command = data.command;
    this.pairData = data.pairData;
    this.tradeId = data.tradeId;
    this.postExecutionCallback = data.callback;

    switch (this.command) {
      default:
        this.plannedOrder = data.order;
        break;
    }

    this.isTest = data.isTest ?? false;
  }

  performChecks() {
    try {
      switch (this.command) {
        default:
          if (typeof this.plannedOrder === 'undefined') throw new Error(`[${this.command}]: Invalid order`);
          return this.plannedOrder.isValid();
      }
    } catch (e) {
      Terminal.printObject(this);
      throw e;
    }
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {import('../types.js').postExecutionCallback} callback
   * @returns {Action}
   */
  static CancelAction(order, callback, isTest = false) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.CancelAction');
    return new Action({
      command: 'cancelOrder',
      order: order,
      isTest: isTest,
      callback: callback,
    });
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {PairData} pairData
   * @param {import('../types.js').postExecutionCallback} callback
   * @returns {Action}
   */
  static ReplaceAction(order, pairData, callback, isTest = false) {
    if (typeof order === 'undefined') throw new Error('Invalid order passed to Action.ReplaceAction');
    return new Action({
      command: 'editOrder',
      order: order,
      isTest: isTest,
      pairData: pairData,
      callback: callback,
    });
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {PairData} pairData
   * @param {import('../types.js').postExecutionCallback} callback
   * @returns {Action}
   */
  static MarketAction(plannedOrder, pairData, callback) {
    if (typeof plannedOrder === 'undefined') throw new Error('Invalid order passed to Action.MarketAction');
    if (plannedOrder.order.type !== EcaOrder.OrderTypes.market)
      throw new Error(`[${plannedOrder.id}]: Invalid order type ${plannedOrder.order.type} - expected 'market'`);
    return new Action({
      command: 'submitOrder',
      order: plannedOrder,
      pairData: pairData,
      callback: callback,
    });
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {PairData} pairData
   * @param {import('../types.js').postExecutionCallback} callback
   * @returns {Action}
   */
  static LimitAction(plannedOrder, pairData, callback) {
    if (typeof plannedOrder === 'undefined') throw new Error('Invalid order passed to Action.LimitAction');
    if (plannedOrder.order.type !== EcaOrder.OrderTypes.limit)
      throw new Error(`[${plannedOrder.id}]: Invalid order type ${plannedOrder.order.type} - expected ${EcaOrder.OrderTypes.limit}`);
    return new Action({
      command: 'submitOrder',
      order: plannedOrder,
      pairData: pairData,
      callback: callback,
    });
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {PairData} pairData
   * @param {import('../types.js').postExecutionCallback} callback
   * @returns
   */
  static OrderToAction(plannedOrder, pairData, callback = null) {
    switch (plannedOrder.order.type) {
      case 'market':
        return this.MarketAction(plannedOrder, pairData, callback);
      case 'limit':
        return this.LimitAction(plannedOrder, pairData, callback);

      default:
        Terminal.error(`Invalid order type in ${plannedOrder.id}`);
    }
  }
}
