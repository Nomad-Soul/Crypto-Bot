import Terminal from '../app/terminal.js';
import ExchangeOrder from './exchange-order.js';

export default class FifoCalculator {
  /** @type {ExchangeOrder[]}  */
  orders;

  /**@type {number} */
  costBasis;

  constructor() {
    this.orders = [];
    this.costBasis = 0;
  }

  /** @param {ExchangeOrder} order */
  buy(order) {
    this.orders.push(order);
  }

  /**
   *  @param {ExchangeOrder} order
   * @returns
   */
  sell(order) {
    var term = Terminal.instance;
    const { volume, price, fees } = order;

    let remainingToSell = volume;
    let totalRevenue = volume * price - fees;
    let currentVolume = order.volume;

    while (remainingToSell > 0 && this.orders.length > 0) {
      let order = this.orders[0];
      let firstOrderCost = order.totalCost;

      if (order.volume <= remainingToSell) {
        this.costBasis += firstOrderCost;
        remainingToSell -= order.volume;
        this.orders.shift(); // Remove fully used buy order
      } else {
        let proportion = remainingToSell / order.volume;
        this.costBasis += proportion * firstOrderCost;
        currentVolume -= remainingToSell;
        remainingToSell = 0;
      }
    }

    const profit = totalRevenue - this.costBasis;
    return profit;
  }

  get totalAmountBought() {
    return this.orders.reduce((sum, order) => sum + (order.side === 'buy' && order.isClosed ? order.totalCost : 0), 0);
  }

  get averageCost() {
    return this.costBasis / this.balance;
  }

  get balance() {
    return this.orders.reduce((sum, order) => sum + order.volume, 0);
  }
}
