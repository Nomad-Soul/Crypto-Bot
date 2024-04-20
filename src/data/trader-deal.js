import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import ClientBase from '../services/client.js';
import BotSettings from './bot-settings.js';
import App from '../app.js';
import CryptoBot from '../crypto-bot.js';
import { nanoid } from 'nanoid';
import ExchangeOrder from './exchange-order.js';
import PairData from './pair-data.js';

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

  /** @type {ExchangeOrder[]} */
  #exchangeOrders;

  constructor(data) {
    this.id = data.id ?? `${data.account}:${nanoid(12)}`;
    this.botId = data.botId;
    this.index = data.index;
    data.buyOrders.forEach((txid) => this.buyOrders.push(txid));
    data.sellOrders.forEach((txid) => this.sellOrders.push(txid));
    this.status = data.status;
    this.account = data.account;
    this.overrideAveragePrice = data.overrideAveragePrice ?? 0;
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
   * @returns
   */
  async refreshExchangeOrders(bot) {
    this.#exchangeOrders = await bot.getExchangeOrdersFromPlannedOrderIds(this.buyOrders, this.account, true);
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  fetchExchangeOrders(bot) {
    this.#exchangeOrders = bot.getLocalExchangeOrdersFromPlannedOrderIds(this.buyOrders, this.account);
  }
  /**
   *
   * @param {CryptoBot} bot
   * @param {PairData} pairData
   */
  isCompleted(bot, pairData) {
    var allSellOrdersExecuted = this.sellOrders.length > 0 && this.sellOrders.map((id) => bot.getPlannedOrder(id)).every((o) => o.isClosed);

    var allBalanceSold = Math.abs(this.calculateTotalVolumeBought(bot) - this.calculateTotalVolumeSold(bot)) < pairData.minVolume;

    if (allSellOrdersExecuted && allBalanceSold) {
      App.log(greenBright`[${this.id}]: deal completed`);
      return true;
    } else return false;
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
   * @param {CryptoBot} bot
   * @returns
   */
  calculateCostBasis(bot) {
    if (!this.#exchangeOrders) this.fetchExchangeOrders(bot);
    var exchangeOrders = this.#exchangeOrders;

    var sumValue = exchangeOrders.reduce((sv, order) => {
      if (typeof order === 'undefined') {
        App.warning(`Missing local order in deal ${this.id}`);
        return sv;
      } else if (!order.isClosed) return sv;

      sv += order.volume * order.price + order.fees;
      return sv;
    }, 0);

    let sumWeights = this.calculateTotalVolumeBought(bot);
    var averagePrice = sumValue / sumWeights;
    var costBasis = averagePrice * sumWeights;

    if (typeof costBasis === 'undefined') App.error(`Undefined cost basis for deal ${this.id}`);

    return { averagePrice: averagePrice, costBasis: costBasis };
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  #sumVolume(bot, direction = 'buy') {
    var orders = direction === 'buy' ? this.buyOrders : this.sellOrders;
    return this.orders.reduce((sumVolume, id) => {
      let plannedOrder = bot.getPlannedOrder(id);
      if (!plannedOrder.isClosed) return sumVolume;
      let exchangeOrder = bot.getClient(this.account).getLocalOrder(plannedOrder.txid);

      sumVolume += Number(exchangeOrder.volume);
      return sumVolume;
    }, 0);
  }

  /**
   *
   * @param {CryptoBot} bot
   * @param {BotSettings} botSettings
   * @returns
   */
  calculateProfitTarget(bot, botSettings) {
    var { averagePrice, costBasis } = this.calculateCostBasis(bot);
    var targetPrice = TraderDeal.CalculateProfitTarget(averagePrice, botSettings.options.profitTarget, botSettings.options.makerFees);

    return { averagePrice: averagePrice, costBasis: costBasis, targetPrice: targetPrice };
  }

  static CalculateProfitTarget(averagePrice, targetProfit = 0.01, fees = 0.0016) {
    // sp,ap sell/average price
    // t target profit
    // v volume f fees
    // spv - spvf - apv = tapv
    // spv (1-f) = apv(t+1)
    // sp = ap(t+1)/(1-f)
    return (averagePrice * (1 + targetProfit)) / (1 - fees);
  }

  /**
   *
   * @param {CryptoBot} bot
   * @returns
   */
  calculateProfit(bot) {
    var { averagePrice, costBasis } = this.calculateCostBasis(bot);
    var profit = this.sellOrders.reduce((profit, id) => {
      let order = bot.getLocalExchangeOrderFromPlannedOrderId(id, this.account);
      if (order.status === 'open') return profit;
      profit += order.volume * order.price - order.fees - costBasis;
      return profit;
    }, 0);

    return profit;
  }
}
