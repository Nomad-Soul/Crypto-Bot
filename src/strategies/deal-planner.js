import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import CryptoBot from '../crypto-bot.js';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import PairData from '../data/pair-data.js';
import TraderDeal from '../data/trader-deal.js';
import ExchangeOrder from '../data/exchange-order.js';
import { nanoid } from 'nanoid';
import Terminal from '../app/terminal.js';

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
      let client = this.#bot.getClient(this.botSettings.account);
      this.pairData = client.getPairData(this.botSettings.pair);
    } catch (e) {
      Terminal.printObject(this.botSettings.toJSON());
      Terminal.error(`[${this.botId}]: invalid bot settings`);
    }
  }

  #generateNewOrderId() {
    return `${this.botSettings.pair}-${nanoid(8)}`.slice(0, 18);
  }

  /**
   *
   * @param {TraderDeal} openDeal
   * @returns
   */
  proposeSafetyOrder(openDeal) {
    let n = openDeal.buyOrders.length;
    if (n - 1 >= this.maxSafetyOrders) {
      let message = `[${this.botId}]: max Safety Orders reached: ${n - 1}`;
      Terminal.warning(message);
    }
    var client = this.#bot.getClient(this.botSettings.account);
    var pair = this.botSettings.pair;

    let { limitPrice, volume } = this.#calculateNextSafetyOrder(openDeal, n);
    let currentPrice = client.getPrice(pair);

    while (Math.abs(limitPrice - currentPrice) < this.priceDeviation * currentPrice) {
      let result = this.#calculateNextSafetyOrder(openDeal, ++n);
      limitPrice = result.limitPrice;
    }

    var cost = limitPrice * volume;
    var fees = this.makerFee * cost;

    var buyOrder = new EcaOrder(
      {
        botId: this.botId,
        strategy: this.botSettings.strategyType,
        volumeQuote: cost,
        account: this.botSettings.account,
      },
      new ExchangeOrder({
        type: 'limit',
        side: 'buy',
        status: 'planned',
        openDate: new Date(),
        price: limitPrice,
        volume: Number(volume.toFixed(this.pairData.maxBaseDigits)),
        fees: fees,
        pair: pair,
        userref: this.#generateNewOrderId(),
      }),
    );

    Terminal.log(
      `[^c${openDeal.id}]^:: proposing ^rbuy^ at ^Y${limitPrice.toFixed(this.pairData.maxQuoteDigits)}^ Volume: ^Y${volume.toFixed(this.pairData.maxBaseDigits)}^ Total Cost: ^R${(cost + fees).toFixed(this.pairData.maxQuoteDigits)}`,
    );

    return buyOrder;
  }

  /**
   * @param {TraderDeal} openDeal
   * @param {number} n
   */
  #calculateNextSafetyOrder(openDeal, n) {
    let limitPrice = Number.MAX_SAFE_INTEGER;
    let priceDeviation = this.priceDeviation;
    let safetyOrder = this.safetyOrder;
    var client = this.#bot.getClient(this.botSettings.account);
    let safetyOrders = openDeal.buyOrders
      .map((id) => client.getLocalOrder(id))
      .filter((o) => o && !o.isOpen)
      .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());

    let firstOrder = safetyOrders[0];
    let initialPrice = openDeal.overrideAveragePrice > 0 ? openDeal.overrideAveragePrice : firstOrder.price;

    let volume;
    for (let i = 0; i < n; i++) {
      limitPrice = initialPrice - initialPrice * (i + 1) * priceDeviation;
      volume = safetyOrder / limitPrice;
      priceDeviation *= this.safetyOrderStepScale;
      safetyOrder *= this.safetyOrderVolumeScale;
    }
    return { limitPrice, volume };
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
      new EcaOrder(
        {
          botId: this.botId,
          strategy: this.botSettings.strategyType,
          volumeQuote: initialOrderSize,
          account: this.botSettings.account,
        },
        new ExchangeOrder({
          type: 'market',
          side: 'buy',
          status: 'planned',
          openDate: new Date(),
          price: Number(currentPrice),
          volume: Number(volume.toFixed(maxBaseDigits)),
          fees: this.takerFee * initialOrderSize,
          userref: this.#generateNewOrderId(),
          pair: pair,
        }),
      ),
    );

    let safetyOrder = this.safetyOrder;
    let priceDeviation = this.priceDeviation;
    let maxOrders = maxSafetyOrders === 0 ? this.maxSafetyOrders : maxSafetyOrders;

    for (var i = 0; i < maxOrders; i++) {
      let limitPrice = currentPrice - currentPrice * (i + 1) * priceDeviation;

      orders.push(
        new EcaOrder(
          {
            botId: this.botId,
            strategy: this.botSettings.strategyType,
            volumeQuote: safetyOrder,
            account: this.botSettings.account,
          },
          new ExchangeOrder({
            type: 'limit',
            side: 'buy',
            status: 'planned',
            openDate: new Date(),
            price: Number(limitPrice),
            volume: Number((safetyOrder / limitPrice).toFixed(maxBaseDigits)),
            fees: this.makerFee * safetyOrder,
            userref: this.#generateNewOrderId(),
            pair: pair,
          }),
        ),
      );

      priceDeviation *= this.safetyOrderStepScale;
      safetyOrder *= this.safetyOrderVolumeScale;
    }

    let volumeCurrency = currentPrice * volume;
    let averageCost = currentPrice * (1 + this.takerFee);
    let targetProfit = TraderDeal.CalculateProfitTarget(averageCost, this.profitTarget, this.makerFee);
    let sellVolume = orders[0].order.volume * targetProfit;

    orders.push(
      new EcaOrder(
        {
          botId: this.botId,
          strategy: this.botSettings.strategyType,
          volumeQuote: Number(sellVolume.toFixed(maxQuoteDigits)),
          account: this.botSettings.account,
        },
        new ExchangeOrder({
          type: 'limit',
          side: 'sell',
          status: 'planned',
          openDate: new Date(),
          price: Number(targetProfit.toFixed(2)),
          volume: Number(orders[0].order.volume.toFixed(maxBaseDigits)),
          fees: this.makerFee * sellVolume,
          userref: this.#generateNewOrderId(),
          pair: pair,
        }),
      ),
    );

    var total = orders.reduce((sum, ecaOrder) => {
      let order = ecaOrder.order;
      if (order.side === 'sell') return sum;
      let volumeCurrency = Number(order.volume * order.price);
      let fee = Number(order.fees);
      sum += volumeCurrency + fee;
      return sum;
    }, 0);

    Terminal.warning(`Total spent: ${total.toFixed(2)}`);
    var newDeal = new TraderDeal({
      index: this.botSettings.userref + dealIndex,
      botId: this.botId,
      buyOrders: orders.filter((o) => o.order.side === 'buy').map((o) => o.id),
      sellOrders: [],
      status: 'open',
      account: this.botSettings.account,
    });

    return { balanceRequired: total, deal: newDeal, orders: orders };
  }

  /**
   *
   * @param {TraderDeal} deal
   * @param { { averageCost: Number, costBasis: Number, targetPrice: Number }} dealData
   */
  proposeTakeProfitOrder(deal, dealData = null) {
    var term = Terminal.instance;
    if (dealData === null) dealData = deal.calculateProfitTarget(this.#bot, this.botSettings);

    const { averageCost, costBasis, targetPrice } = dealData;

    var client = this.#bot.getClient(this.botSettings.account);
    var currentPrice = client.getPrice(this.botSettings.pair);
    var sellPrice = targetPrice;

    sellPrice = currentPrice > sellPrice ? currentPrice : sellPrice;
    sellPrice = Number(sellPrice.toFixed(this.pairData.maxQuoteDigits));

    var volume = client.getBalance(this.botSettings.base);
    if (volume === 0) volume = client.getBalance(this.botSettings.alternateBase);
    if (volume === 0) Terminal.error(`Cannot plan take profit order: no volume for ${deal.id}`);

    var volumeQuote = volume * sellPrice;
    var pnl = (sellPrice - averageCost) * volume;

    term.log(
      `[^c${deal.id}^:]: proposing sell at ^Y${sellPrice.toFixed(this.pairData.maxQuoteDigits)}^ Volume: ^Y${volume.toFixed(this.pairData.maxBaseDigits)}`,
    );
    var colour = pnl > 0 ? '^G' : '^R';
    term.log(
      `Estimated PnL: ${colour}${pnl.toFixed(this.pairData.maxQuoteDigits)}^ ${this.pairData.quote.toUpperCase()} (${colour}${((100 * pnl) / costBasis).toFixed(2)} %^:)`,
    );

    var sellOrder = new EcaOrder(
      {
        botId: this.botId,
        strategy: this.botSettings.strategyType,
        volumeQuote: Number(volumeQuote.toFixed(this.pairData.maxQuoteDigits)),
        account: this.botSettings.account,
      },
      new ExchangeOrder({
        type: 'limit',
        side: 'sell',
        status: 'planned',
        openDate: new Date(),
        price: sellPrice,
        volume: Number(volume.toFixed(this.pairData.maxBaseDigits)),
        fees: Number((this.makerFee * volumeQuote).toFixed(this.pairData.maxQuoteDigits)),
        userref: this.#generateNewOrderId(),
        pair: this.botSettings.pair,
      }),
    );

    return sellOrder;
  }
}
