import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import App from '../app.js';
import CryptoBot from '../crypto-bot.js';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import PairData from '../data/pair-data.js';
import TraderDeal from '../data/trader-deal.js';

export default class DealPlanner {
  #bot;
  botId;
  maxSafetyOrders;
  priceDeviation;
  safetyOrderStepScale;
  safetyOrderVolumeScale;
  /** @type {PairData} */
  pairData;

  /**
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    this.#bot = bot;
    this.botId = botId;
    try {
      this.botSettings = bot.getBotSettings(botId);
      this.initialOrderSize = this.botSettings.options.initialOrderSize;
      this.safetyOrder = this.botSettings.options.safetyOrder;
      this.maxSafetyOrders = this.botSettings.options.maxSafetyOrders;
      this.priceDeviation = this.botSettings.options.priceDeviation;
      this.safetyOrderStepScale = this.botSettings.options.safetyOrderStepScale;
      this.safetyOrderVolumeScale = this.botSettings.options.safetyOrderVolumeScale;
      this.profitTarget = this.botSettings.options.profitTarget;
      var accountSettings = bot.getAccountSettings(this.botSettings.account);
      this.makerFee = accountSettings.makerFees;
      this.takerFee = accountSettings.takerFees;
      this.pairData = this.#bot.getClient(this.botSettings.account).getPairData(this.botSettings.pair);
    } catch (e) {
      App.printObject(this.botSettings.toJSON());
      App.error(`[${this.botId}]: invalid bot settings`);
    }
  }

  /**
   *
   * @param {TraderDeal} openDeal
   * @returns
   */
  calculateSafetyOrder(openDeal) {
    let n = openDeal.buyOrders.length;
    if (n - 1 >= this.maxSafetyOrders) {
      let message = `[${this.botId}]: max Safety Orders reached: ${n - 1}`;
      App.warning(message);
      return null;
    }
    var pair = this.botSettings.pair;
    let safetyOrder = this.safetyOrder;
    let priceDeviation = this.priceDeviation;
    let safetyOrders = openDeal.buyOrders
      .map((id) => this.#bot.getExchangeOrderFromPlannedOrderId(id, this.botSettings.account))
      .filter((o) => !o.isOpen)
      .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());

    let firstOrder = safetyOrders[0];
    let initialPrice = openDeal.overrideAveragePrice > 0 ? openDeal.overrideAveragePrice : firstOrder.price;
    let limitPrice;
    let volume;

    for (let i = 0; i < openDeal.buyOrders.length; i++) {
      limitPrice = initialPrice - initialPrice * (i + 1) * priceDeviation;
      volume = safetyOrder / limitPrice;
      priceDeviation *= this.safetyOrderStepScale;
      safetyOrder *= this.safetyOrderVolumeScale;
    }

    return new EcaOrder({
      botId: this.botId,
      strategy: 'eca-trader',
      type: 'limit',
      direction: 'buy',
      status: 'planned',
      openDate: new Date(Date.now()),
      price: limitPrice,
      volume: volume.toFixed(this.pairData.maxBaseDigits),
      volumeEur: limitPrice * volume,
      pair: pair,
      userref: safetyOrders[0].userref,
      account: this.botSettings.account,
    });
  }

  /**
   *
   * @param {Number} initialPrice
   * @param {Number} maxSafetyOrders
   * @param {Number} dealIndex
   * @returns
   */
  proposeDeal(initialPrice, maxSafetyOrders = 0, dealIndex = 0) {
    var orders = [];
    let initialOrderSize = this.initialOrderSize;
    let currentPrice = initialPrice - 0.0005 * initialPrice;
    let volume = initialOrderSize / currentPrice;
    var pair = this.botSettings.pair;
    var maxBaseDigits = this.pairData.maxBaseDigits;
    var maxQuoteDigits = this.pairData.maxQuoteDigits;
    orders.push(
      new EcaOrder({
        botId: this.botId,
        strategy: 'eca-trader',
        type: 'market',
        direction: 'buy',
        status: 'planned',
        openDate: new Date(Date.now()),
        price: Number(currentPrice),
        volume: Number(volume.toFixed(maxBaseDigits)),
        volumeEur: initialOrderSize,
        fees: this.takerFee * initialOrderSize,
        account: this.botSettings.account,
        userref: this.botSettings.userref + dealIndex,
        pair: pair,
      }),
    );

    let safetyOrder = this.safetyOrder;
    let priceDeviation = this.priceDeviation;
    let maxOrders = maxSafetyOrders === 0 ? this.maxSafetyOrders : maxSafetyOrders;

    for (var i = 0; i < maxOrders; i++) {
      let limitPrice = currentPrice - currentPrice * (i + 1) * priceDeviation;

      orders.push(
        new EcaOrder({
          botId: this.botId,
          strategy: 'eca-trader',
          type: 'limit',
          direction: 'buy',
          status: 'planned',
          openDate: new Date(Date.now()),
          price: Number(limitPrice),
          volume: Number((safetyOrder / limitPrice).toFixed(maxBaseDigits)),
          volumeEur: safetyOrder,
          fees: this.makerFee * safetyOrder,
          account: this.botSettings.account,
          userref: this.botSettings.userref + dealIndex,
          pair: pair,
        }),
      );

      priceDeviation *= this.safetyOrderStepScale;
      safetyOrder *= this.safetyOrderVolumeScale;
    }

    let volumeCurrency = currentPrice * volume;
    let averagePrice = currentPrice * (1 + this.takerFee);
    let targetProfit = TraderDeal.CalculateProfitTarget(averagePrice, this.profitTarget, this.makerFee);
    let sellVolume = orders[0].volume * targetProfit;

    orders.push(
      new EcaOrder({
        botId: this.botId,
        strategy: 'eca-trader',
        type: 'limit',
        direction: 'sell',
        status: 'planned',
        openDate: Date.now(),
        price: Number(targetProfit.toFixed(2)),
        volume: Number(orders[0].volume.toFixed(maxBaseDigits)),
        volumeEur: Number(sellVolume.toFixed(maxQuoteDigits)),
        fees: this.makerFee * sellVolume,
        account: this.botSettings.account,
        userref: this.botSettings.userref + dealIndex,
        pair: pair,
      }),
    );

    var total = orders.reduce((sum, order) => {
      if (order.direction === 'sell') return sum;
      let volumeCurrency = Number(order.volume * order.price);
      let fee = Number(order.fees);
      sum += volumeCurrency + fee;
      return sum;
    }, 0);

    App.warning(`Total spent: ${total.toFixed(2)}`);
    var newDeal = new TraderDeal({
      id: `${this.botId}-${this.botSettings.userref + dealIndex}`,
      botId: this.botId,
      buyOrders: orders.filter((o) => o.direction === 'buy').map((o) => o.id),
      sellOrders: [],
      status: 'open',
      account: this.botSettings.account,
    });

    return { balanceRequired: total, deal: newDeal, orders: orders };
  }

  /**
   *
   * @param {TraderDeal} deal
   * @param {*} dealData
   */
  proposeTakeProfitOrder(deal, dealData = null) {
    if (dealData === null) dealData = deal.calculateProfitTarget(this.#bot, this.botSettings);

    const { averagePrice, costBasis, targetPrice: targetPrice } = dealData;

    var accountClient = this.#bot.getClient(this.botSettings.account);
    var volume = accountClient.getBalance(this.botSettings.crypto);
    var volumeEur = volume * targetPrice;
    var pnl = (targetPrice - averagePrice) * volume;

    App.log(
      `[${cyanBright`${deal.id}`}]: Proposing sell at ${yellowBright`${targetPrice.toFixed(this.pairData.maxQuoteDigits)}`} Volume: ${yellowBright`${volume.toFixed(this.pairData.maxBaseDigits)}`}`,
    );
    var colour = pnl > 0 ? greenBright : redBright;
    App.log(
      yellowBright`Estimated PnL: ${colour`${pnl.toFixed(this.pairData.maxQuoteDigits)} ${this.pairData.quoteCurrency} (${((100 * pnl) / costBasis).toFixed(2)} %)`}`,
    );

    var sellOrder = new EcaOrder({
      botId: this.botId,
      strategy: 'eca-trader',
      type: 'limit',
      direction: 'sell',
      status: 'planned',
      openDate: Date.now(),
      price: Number(targetPrice.toFixed(this.pairData.maxQuoteDigits)),
      volume: volume,
      volumeEur: Number(volumeEur.toFixed(this.pairData.maxQuoteDigits)),
      fees: Number((this.makerFee * volumeEur).toFixed(this.pairData.maxQuoteDigits)),
      account: this.botSettings.account,
      userref: deal.index,
      pair: this.botSettings.pair,
    });

    console.log(sellOrder);
    return sellOrder;
  }

  /**
   * @param {number} index
   * @param {{ index: any; orders: string | string[]; }} deal
   */
  findIndex(index, deal) {
    var id = `${this.botId}:${deal.index}/${index.toString().padStart(2, '0')}`;
    if (deal.orders.includes(id)) return this.findIndex(index + 1, deal);
    else return id;
  }
}
