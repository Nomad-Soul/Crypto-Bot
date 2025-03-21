import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import ClientBase from '../services/client.js';
import BotSettings from './bot-settings.js';
import App from '../app/app.js';
import CryptoBot from '../crypto-bot.js';
import { nanoid } from 'nanoid';
import ExchangeOrder from './exchange-order.js';
import PairData from './pair-data.js';
import Terminal from '../app/terminal.js';
import FifoCalculator from './fifoCalculator.js';

export default class TraderDeal {
  id;
  botId;
  /** @type {number} */
  index;
  /** @type {string[]} */
  buyOrders = [];
  /** @type {string[]} */
  sellOrders = [];
  /** @type {number} */
  overrideAveragePrice;
  account;

  /**
   * @param {{id?: string, botId: string, buyOrders: string[], sellOrders: string[], index: Number, status: string, account: string, overrideAveragePrice?: Number}} data
   */
  constructor(data) {
    this.id = data.id ?? `${data.account}:${nanoid(12)}`;
    this.botId = data.botId;
    this.index = data.index;
    data.buyOrders.forEach((txid) => this.buyOrders.push(txid));
    data.sellOrders.forEach((txid) => this.sellOrders.push(txid));
    this.status = data.status;
    this.account = data.account;
    this.overrideAveragePrice = data.overrideAveragePrice ?? 0;

    this.costBasis = 0;
    this.balance = 0;
  }

  get isOpen() {
    return this.status === 'open';
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns {Number}
   */

  calculateTotalVolumeBought(bot) {
    return this.#sumVolume(bot, 'buy');
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns {Number}
   */
  calculateTotalVolumeSold(bot) {
    return this.#sumVolume(bot, 'sell');
  }

  /**
   *
   * @param {CryptoBot} bot
   * @param {PairData} pairData
   */
  isCompleted(bot, pairData) {
    let client = bot.getClient(this.account);
    var allSellOrdersExecuted = this.sellOrders.length > 0 && this.sellOrders.map((id) => client.getLocalOrder(id)).every((o) => o.isClosed);

    var allBalanceSold = Math.abs(this.calculateTotalVolumeBought(bot) - this.calculateTotalVolumeSold(bot)) < pairData.minVolume;

    if (allSellOrdersExecuted && allBalanceSold) {
      Terminal.instance.log(`Deal ^Gcompleted`);
      return true;
    } else {
      Terminal.instance.log(
        `all: ${allSellOrdersExecuted} ${this.calculateTotalVolumeBought(bot) - this.calculateTotalVolumeSold(bot)} ${this.calculateTotalVolumeBought(bot)} / ${this.calculateTotalVolumeSold(bot)}`,
      );
      return false;
    }
  }

  /**
   *
   * @param {string} id
   * @returns
   */
  hasOrder(id) {
    return this.buyOrders.includes(id) || this.sellOrders.includes(id);
  }

  /**
   * @returns {string[]}
   */
  get orders() {
    return this.buyOrders.concat(this.sellOrders);
  }

  /**
   *
   * @param {string} txid
   */
  removeOrder(txid) {
    var term = Terminal.instance;
    if (this.buyOrders.includes(txid)) {
      let idx = this.buyOrders.indexOf(txid);
      this.buyOrders.splice(idx, 1);
      term.log(`Buy order ^c${txid}^ ^Rremoved^ from deal ^c${this.id}`);
    } else if (this.sellOrders.includes(txid)) {
      let idx = this.sellOrders.indexOf(txid);
      this.sellOrders.splice(idx, 1);
      term.log(`Sell order ^c${txid}^ ^Rremoved^ from deal ^c${this.id}`);
    } else {
      term.error(`Order ^y${txid}^ does not exist in deal ^c${this.id}`);
    }
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  calculateCostBasis(bot) {
    var term = Terminal.instance;
    var client = bot.getClient(this.account);
    var orders = this.orders
      .map((txid) => client.getLocalOrder(txid))
      .filter((order) => order.isClosed)
      .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());

    var totalCost = 0;
    var totalProfit = 0;
    var averageCost = 0;
    var fifo = new FifoCalculator();
    for (const order of orders) {
      if (order.side === 'buy') {
        fifo.buy(order);
        averageCost = fifo.totalAmountBought / fifo.balance;
      } else {
        let balance = fifo.balance;
        totalProfit += fifo.sell(order);
        averageCost = fifo.costBasis / balance;
      }
    }

    let costBasis = fifo.costBasis == 0 ? fifo.totalAmountBought : fifo.costBasis;

    if (isNaN(costBasis)) {
      term.printObject(orders);
      term.log(`Avg: ${averageCost} cb: ${costBasis} ${totalCost} tr: ${totalProfit}`);

      term.error(`Invalid cost basis for deal ${this.id}: ${this.costBasis}`);
      term.log(`Avg: ${averageCost} cb: ${costBasis} ${totalCost} tr: ${totalProfit}`);
    }
    if (isNaN(averageCost)) {
      term.printObject(orders);
      term.log(`Avg: ${averageCost} cb: ${costBasis} ${totalCost} tr: ${totalProfit}`);

      term.error(`Invalid average cost for deal ${this.id}: ${averageCost}`);
    }

    return { averageCost: averageCost, costBasis: costBasis, profit: totalProfit };
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  #sumVolume(bot, direction = 'buy') {
    var orders = direction === 'buy' ? this.buyOrders : this.sellOrders;
    let client = bot.getClient(this.account);
    return orders.reduce((sumVolume, id) => {
      let plannedOrder = client.getLocalOrder(id);
      if (!plannedOrder.isClosed) return sumVolume;
      let exchangeOrder = client.getLocalOrder(plannedOrder.txid);

      sumVolume += Number(exchangeOrder.volume);
      return sumVolume;
    }, 0);
  }

  /**
   *
   * @param {CryptoBot} bot
   * @param {BotSettings} botSettings
   * @returns { { averageCost: Number, costBasis: Number, targetPrice: Number }}
   */
  calculateProfitTarget(bot, botSettings) {
    var { averageCost, costBasis, _ } = this.calculateCostBasis(bot);
    var targetPrice = TraderDeal.CalculateProfitTarget(averageCost, botSettings.options.profitTarget, botSettings.options.makerFees);

    return { averageCost: averageCost, costBasis: costBasis, targetPrice: targetPrice };
  }

  static CalculateProfitTarget(averageCost, targetProfit = 0.01, fees = 0.0016) {
    // sp,ap sell/average price
    // t target profit
    // v volume f fees
    // spv - spvf - apv = tapv
    // spv (1-f) = apv(t+1)
    // sp = ap(t+1)/(1-f)
    Terminal.instance.log(`Avg: ${averageCost} T: ${targetProfit} f: ${fees}`);
    return (averageCost * (1 + targetProfit)) / (1 - fees);
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  calculateProfit(bot) {
    var { averageCost: averageCost, costBasis, profit } = this.calculateCostBasis(bot);
    return profit;
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      botId: this.botId,
      account: this.account,
      index: this.index,
      buyOrders: this.buyOrders,
      sellOrders: this.sellOrders,
      overrideAveragePrice: this.overrideAveragePrice > 0 ? this.overrideAveragePrice : undefined,
    };
  }
}
