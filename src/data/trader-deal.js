import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import ClientBase from '../services/client.js';
import BotSettings from './bot-settings.js';
import App from '../app.js';
import CryptoBot from '../crypto-bot.js';
import { nanoid } from 'nanoid';

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
   */
  isCompleted(bot) {
    if (this.sellOrders.length > 0 && this.sellOrders.map((id) => bot.getPlannedOrder(id)).every((o) => o.status === 'executed')) {
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
    let sumValue = this.buyOrders
      .map((id) => bot.getPlannedOrder(id))
      .filter((order) => order.isClosed)
      .map((order) => bot.getExchangeOrderFromPlannedOrderId(order.id, this.account))
      .reduce((sv, order) => {
        if (typeof order === 'undefined') {
          App.warning(`Missing local order in deal ${this.id}`);
          return sv;
        }
        sv += order.volume * order.price + order.fees;
        return sv;
      }, 0);

    let sumWeights = this.#sumVolume(bot);
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
  #sumVolume(bot) {
    return this.buyOrders.reduce((sw, id) => {
      let plannedOrder = bot.getPlannedOrder(id);
      if (!plannedOrder.isClosed) return sw;
      let exchangeOrder = bot.getClient(this.account).getLocalOrder(plannedOrder.txid);

      let vol = Number(exchangeOrder.volume);
      sw += vol;
      return sw;
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
      let order = bot.getExchangeOrderFromPlannedOrderId(id, this.account);
      if (order.status === 'open') return profit;
      profit += order.volume * order.price - order.fees - costBasis;
      return profit;
    }, 0);

    return profit;
  }
}
