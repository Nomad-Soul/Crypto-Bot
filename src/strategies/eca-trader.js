import App from '../app.js';
import fs from 'fs';
import Utils from '../utils.js';
import Action from '../data/action.js';
import { yellowBright, cyanBright, redBright, greenBright, magentaBright } from 'ansis';
import DealPlanner from './deal-planner.js';
import TraderDeal from '../data/trader-deal.js';
import CryptoBot from '../crypto-bot.js';
import EcaOrder from '../data/eca-order.js';
import ExchangeOrder from '../data/exchange-order.js';
import Strategy from './strategy.js';

export default class EcaTrader extends Strategy {
  /**
   * @type {Map<string,TraderDeal>}
   */
  deals = new Map();
  /** @type {Action[]} */
  actions = [];
  /** @type {Date} */
  dateNow;

  /**
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    super(bot, botId);
    this.dealPlanner = new DealPlanner(bot, botId);
    this.loadDeals();
  }

  /**
   *
   * @param {TraderDeal[]} openDeals
   * @returns
   */
  async checkDataIntegrity(openDeals) {
    // update all pending orders
    for (const order of this.getPlannedOrders('pending')) {
      await this.client.requestOrder(order.id);
    }

    if (openDeals.length == 0) {
      // If there are no open deals check that the balance of the crypto we trade is 0.
      if (this.client.getBalance(this.pairData.base) > 0) {
        return {
          botId: this.botId,
          requiresNewPlannedOrder: false,
          reason: this.logStatus(
            `Invalid state: non-zero ${this.pairData.base} balance found, likely a previous deal was not closed correctly.`,
            'errorNonBlocking',
          ),
        };
      } else return { botId: this.botId, requiresNewPlannedOrder: false, reason: this.logStatus('No active open deals.') };
    } else {
      // otherwise check that we have data about all orders in the deal
      let test = true;
      for (const deal of openDeals) {
        for (const order of deal.orders) {
          let found = this.client.hasLocalOrder(order);
          if (!found) {
            App.warning(`Missing order ${redBright`${order}`}`);
            await this.client.requestOrder(order);
          }
          test = test && found;
        }
      }
    }
  }

  /**
   * @param {string} statusFilter
   * @returns {EcaOrder[]}
   */
  getPlannedOrders(statusFilter = undefined) {
    var orders = [];
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    for (const deal of openDeals) {
      orders = orders.concat(deal.orders);
    }

    return orders.map((o) => this.getPlannedOrder(o)).filter((o) => o.status == statusFilter);
  }

  getLatestOpenDeal() {
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    return openDeals.at(-1);
  }

  async decide() {
    this.dateNow = new Date(Date.now());
    await this.client.awaitPrices();
    await this.client.awaitBalances();
    this.currentPrice = this.client.getPrice(this.pairData.id);
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    this.statusMessages = [];
    this.actions = [];

    await this.checkDataIntegrity(openDeals);

    for (let i = 0; i < openDeals.length; i++) {
      this.clearFlags();
      var deal = openDeals[i];
      this.logStatus(`Processing [${cyanBright`${this.botId}`}]: ${deal.id}`, 'infoTimestamp');

      var dealData = this.reportDealStatus(deal);
      var completed = this.#checkCompletion(deal);

      if (!completed) {
        var plannedOrders = deal.orders.map((id) => this.getPlannedOrder(id));
        for (let i = 0; i < plannedOrders.length; i++) {
          let plannedOrder = plannedOrders[i];

          let exchangeOrder = plannedOrder.order;

          if (plannedOrder.status === 'planned') {
            this.processPlannedOrder(plannedOrder);
          } else if (plannedOrder.status === 'pending') {
            this.processPendingOrder(plannedOrder, deal);
          } else if (plannedOrder.status === 'waiting') {
            this.processWaitingOrder(plannedOrder, deal);
          } else if (plannedOrder.status === 'executed' && exchangeOrder != null) {
            this.processExecutedOrder(plannedOrder, deal);
          }
          //console.log(`${plannedOrder.id}: ${result.requiresNewPlannedOrder}`);
        }
        if (this.checkDealIntegrity(deal, dealData)) {
          App.warning(`New orders planned for ${deal.id}`);
        }
      }

      this.checkDealFlags(deal);
    }

    var response;
    if (this.actions.length > 0) response = await this.client.executeActions(this.actions);
    App.printObject(this.actions);

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };

    return this.lastResult;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  checkDealFlags(deal) {
    var newOrder = true;
    /** @type {import('../types.js').postExecutionCallback} */
    var postExecutionCallback = null;

    for (const [key, ecaOrder] of this.flags) {
      var orderValid = typeof ecaOrder != 'undefined';

      switch (key) {
        case 'requiresSafetyOrder':
        case 'submitWaitingBuyOrder':
          if (!orderValid) throw new Error(`${key}: Invalid Order`);
          postExecutionCallback = (response) => {
            deal.buyOrders.push(response.order.txid);
            App.log(`Added ${response.order.txid} to ${deal.id} buy orders`);
            this.updateDeals();
            return response.order;
          };
          break;

        case 'requiresTakeProfitOrder':
        case 'submitWaitingSellOrder':
          if (!orderValid) throw new Error(`${key}: Invalid Order`);
          postExecutionCallback = (response) => {
            deal.sellOrders.push(response.order.txid);
            App.log(`Added ${response.order.txid} to ${deal.id} sell orders`);
            this.updateDeals();
            return response.order;
          };
          break;

        case 'submitPlannedBuyOrder':
        case 'submitPlannedSellOrder':
          if (!orderValid) throw new Error(`${key}: Invalid Order`);
          break;

        case 'editTakeProfitOrder':
          if (!orderValid) throw new Error(`${key}: Invalid Order`);
          newOrder = false;
          let previousTxid = ecaOrder.id;

          postExecutionCallback = (response) => {
            let order = response.order;
            if (order.side === 'buy') {
              delete deal.buyOrders[previousTxid];
              deal.buyOrders.push(order.txid);
            } else {
              delete deal.sellOrders[previousTxid];
              deal.sellOrders.push(order.txid);
            }
            App.log(`Replaced ${previousTxid} with ${order.txid}`);
            this.updateDeals();
            return order;
          };

          App.warning(`Editing ${ecaOrder.id}`);
          this.actions.push(
            Action.ReplaceAction(
              new EcaOrder(
                {
                  botId: this.botId,
                  strategy: 'trader',
                  volumeQuote: ecaOrder.order.volume * ecaOrder.order.price + ecaOrder.order.fees,
                  account: this.botSettings.account,
                },
                ecaOrder.order,
              ),
              this.pairData,
              postExecutionCallback,
            ),
          );
          newOrder = false;
          break;

        case 'cancelAllPendingOrders':
          App.warning(`Cancelling all pending orders for deal ${deal.id}`);
          this.actions.push(
            ...deal.orders
              .map((id) => this.getPlannedOrder(id))
              .filter((order) => order.isActive)
              .map((order) => Action.CancelAction(order)),
          );
          newOrder = false;
          break;

        default:
          App.warning(`Unrecognised flag: ${key}`);
          continue;
      }

      if (newOrder && this.canSubmit(ecaOrder)) this.actions.push(Action.OrderToAction(ecaOrder, this.pairData, postExecutionCallback));
    }
  }

  /**
   *
   * @param {TraderDeal} deal
   * @returns {import('../types.js').DealData}
   */
  reportDealStatus(deal) {
    if (deal.status != 'open') {
      this.logStatus(`No active orders for ${deal.id}`, 'warning');
    }

    var dealData = deal.calculateProfitTarget(this.bot, this.botSettings);
    this.logStatus(yellowBright`Cost Basis: ${dealData.costBasis.toFixed(2)} Average Price: ${dealData.averagePrice.toFixed(this.pairData.maxQuoteDigits)}`);
    var colour = this.currentPrice > dealData.targetPrice ? greenBright : redBright;
    this.logStatus(
      colour`Current price: ${this.currentPrice.toFixed(this.pairData.maxQuoteDigits)} Target: ${dealData.targetPrice.toFixed(this.pairData.maxQuoteDigits)} (${((100 * (this.currentPrice - dealData.targetPrice)) / dealData.targetPrice).toFixed(2)}%)`,
    );

    return dealData;
  }

  hasActiveOrders() {
    return [...this.deals.values()].some((deal) => deal.isOpen);
  }

  /**
   * @param {TraderDeal} deal
   * @param {import("../types.js").DealData} dealData
   */
  checkDealIntegrity(deal, dealData) {
    var ordersAdded = false;
    const removeCancelledOrders = (id, array) => {
      let idx = deal.buyOrders.indexOf(id);
      array.splice(idx, 1);
    };

    // check if there are open orders that have been cancelled
    deal.buyOrders.filter((id) => !this.client.hasLocalOrder(id)).forEach((id) => removeCancelledOrders(id, deal.buyOrders));
    deal.sellOrders.filter((id) => !this.client.hasLocalOrder(id)).forEach((id) => removeCancelledOrders(id, deal.sellOrders));

    var safetyOrdersRemaining = this.botSettings.options.maxSafetyOrders + 1 - deal.buyOrders.length;
    // Check if more safety orders are needed
    if (safetyOrdersRemaining > 0) {
      this.logStatus(`${safetyOrdersRemaining} more safety orders possible.`);
      var plannedOrders = deal.buyOrders.map((id) => this.getPlannedOrder(id));
      var requiresSafetyOrder = plannedOrders.every((order) => order.isExecuted);
      App.warning(`RSO: ${requiresSafetyOrder}`);
      if (requiresSafetyOrder) {
        this.logStatus(`${cyanBright`${deal.id}`} requires a new limit buy order`, 'warning');
        var plannedBuyOrder = this.dealPlanner.calculateSafetyOrder(deal);
        this.setFlag({ requiresSafetyOrder }, plannedBuyOrder);
        ordersAdded = true;
      } else {
        var plannedOrder = plannedOrders.find((o) => !o.isExecuted);
        this.logStatus(
          `${deal.id} ${yellowBright`already`} has a ${plannedOrder.status} ${plannedOrder.order.type} buy order: ${cyanBright`${plannedOrder.id}`}`,
        );
      }
    } else App.warning('No more safety orders possible.');

    // check if there is no take profit order
    var sellOrders = deal.sellOrders.map((id) => this.getPlannedOrder(id));
    var requiresTakeProfitOrder = !sellOrders.some((o) => o.status === 'pending');
    if (requiresTakeProfitOrder) {
      App.warning('Missing sell order.');
      this.createTakeProfitOrder(deal, dealData);
      ordersAdded = true;
    } else {
      var sellOrder = sellOrders.find((o) => o.status === 'pending');
      // check if the take profit order needs to be adjusted
      var volumeAvailable = this.client.getBalance(this.pairData.base);
      if (volumeAvailable == 0) volumeAvailable = this.client.getBalance(this.botSettings.alternateBase);
      var volumeMatch = Math.abs(sellOrder.order.volume - volumeAvailable) > this.pairData.epsilon;
      var priceMatch = Math.abs(dealData.targetPrice - sellOrder.order.price) < 0.01;
      var updateTakeProfitOrder = !volumeMatch || !priceMatch;
      if (updateTakeProfitOrder) {
        this.editTakeProfitOrder(deal, sellOrder, volumeAvailable, dealData);
      }
      App.log(
        `Current take profit order volume ${volumeMatch ? `${greenBright`matches`}` : `${redBright`does not match`}`} volume available: ${sellOrder.order.volume.toFixed(this.pairData.maxBaseDigits)}/${volumeAvailable.toFixed(this.pairData.maxBaseDigits)}`,
      );
      App.log(
        `Current take profit order price ${priceMatch ? `${greenBright`matches`}` : `${redBright`does not match`}`} proposed target price: ${sellOrder.order.price.toFixed(this.pairData.maxBaseDigits)}/${dealData.targetPrice.toFixed(this.pairData.maxBaseDigits)}`,
      );
    }

    App.warning(`requiresTPO: ${requiresTakeProfitOrder}`);

    return ordersAdded;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  #checkCompletion(deal) {
    if (deal.isCompleted(this.bot, this.pairData)) {
      this.logStatus(greenBright`Profit: ${deal.calculateProfit(this.bot).toFixed(2)} ${this.botSettings.quote.toUpperCase()}`);
      this.setFlag({ cancelAllPendingOrders }, null);
      deal.status = 'closed';
      this.updateDeals();

      var cancelAllPendingOrders = true;
      return true;
    }
    return false;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  createTakeProfitOrder(deal, dealData) {
    var requiresTakeProfitOrder = true;
    var takeProfitOrder = this.dealPlanner.proposeTakeProfitOrder(deal, dealData);

    var availableBalance = this.client.getBalance(this.botSettings.base.toLowerCase());
    if (availableBalance === 0) {
      availableBalance = this.client.getBalance(this.botSettings.alternateBase.toLowerCase());
    }

    var tol = Math.pow(10, -this.pairData.maxBaseDigits);
    if (Math.abs(takeProfitOrder.order.volume - availableBalance) <= tol) {
      takeProfitOrder.order.volume -= tol;
    } else if (takeProfitOrder.order.volume < availableBalance) {
      takeProfitOrder.order.volume = availableBalance;
    }

    if (takeProfitOrder.order.price < this.currentPrice) {
      takeProfitOrder.order.price = this.currentPrice;
    }
    this.setFlag({ requiresTakeProfitOrder }, takeProfitOrder);
  }

  /**
   * @param {TraderDeal} deal
   * @param {EcaOrder} sellOrder
   * @param {number} volumeAvailable
   * @param {import("../types.js").DealData} dealData
   */
  editTakeProfitOrder(deal, sellOrder, volumeAvailable, dealData) {
    var editTakeProfitOrder = true;
    App.log(
      `Order volume: ${yellowBright`${sellOrder.order.volume.toFixed(this.pairData.maxBaseDigits)}`} Available: ${yellowBright`${volumeAvailable.toFixed(this.pairData.maxBaseDigits)}`}`,
    );

    sellOrder.order.price = Number(dealData.targetPrice.toFixed(this.pairData.maxQuoteDigits));
    sellOrder.order.volume = +(volumeAvailable - this.pairData.epsilon).toFixed(this.pairData.maxBaseDigits);
    this.setFlag({ editTakeProfitOrder }, sellOrder);
  }

  /**
   *
   * @param {EcaOrder} waitingOrder
   * @param {TraderDeal} deal
   */
  async processWaitingOrder(waitingOrder, deal) {
    if (waitingOrder.order.side === 'sell') {
      var dealData = this.reportDealStatus(deal);
      var targetPrice = dealData.targetPrice;
      var submitWaitingSellOrder = this.currentPrice > targetPrice;

      if (submitWaitingSellOrder) {
        console.log(this.client.balances);
        console.log(this.botSettings);
        this.bot.telegramBot.log(`${deal.id}: current price above target`);
        this.setFlag({ submitWaitingSellOrder }, waitingOrder);
      } else {
        this.logStatus(`Order ${waitingOrder.id} trigger not met.`);
      }
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {TraderDeal} deal
   * @returns
   */
  processExecutedOrder(plannedOrder, deal) {
    try {
      let message = `[${cyanBright`${plannedOrder.id}`}] ${plannedOrder.order.type} ${plannedOrder.order.side} order ${greenBright`was filled`} on ${Utils.toShortDate(plannedOrder.order.closeDate)} ${Utils.toShortTime(plannedOrder.order.closeDate)}`;
      this.logStatus(message);
    } catch (e) {
      App.warning(`${plannedOrder.id}`);
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPlannedOrder(plannedOrder) {
    let order = plannedOrder.order;
    App.log(`[${cyanBright`${plannedOrder.id}`}]: processing planned order`);
    if (this.dateNow > order.openDate) {
      let hoursElapsed = plannedOrder.hoursElapsed(this.dateNow, false);
      if (isNaN(hoursElapsed)) App.error(`Invalid time delta: ${order.openDate} - ${hoursElapsed}`);
      let message = `[${cyanBright`${plannedOrder.id}`}] needs to be executed ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} past.`;
      this.logStatus(message);
      var submitPlannedBuyOrder = order.side === 'buy';
      var submitPlannedSellOrder = order.side === 'sell';
      if (submitPlannedBuyOrder) {
        this.setFlag({ submitPlannedBuyOrder }, plannedOrder);
      } else if (submitPlannedSellOrder) {
        this.setFlag({ submitPlannedSellOrder }, plannedOrder);
      }
    }
  }

  /**
   *
   * @param {EcaOrder} pendingOrder
   * @param {TraderDeal} deal
   * @returns
   */
  processPendingOrder(pendingOrder, deal) {
    let order = pendingOrder.order;
    let message = `[${cyanBright`${pendingOrder.id}`}] ${order.type} ${order.side} order ${yellowBright`is still pending`} at ${Utils.toShortDateTime(this.dateNow)}`;
    this.logStatus(message);
  }

  /**
   *
   * @param {EcaOrder} ecaOrder
   */
  canSubmit(ecaOrder) {
    let order = ecaOrder.order;
    if (order.side === 'buy') {
      var balanceCheck = this.balanceCheck(ecaOrder.volumeQuote);
      return balanceCheck && (ecaOrder.isScheduledForToday || ecaOrder.isPastExecutionDate);
    } else {
      var volumeCheck = this.volumeCheck(order.volume) || this.volumeCheck(order.volume, true);
      return volumeCheck && (ecaOrder.isScheduledForToday || ecaOrder.isPastExecutionDate);
    }
  }

  async startDeal() {
    var index = this.deals.size + 1;
    var proposedDeal = this.dealPlanner.proposeDeal(this.client.getPrice(this.pairData.id), 1, index);
    var balanceCheck = this.balanceCheck(proposedDeal.balanceRequired);

    var status = false;
    var actions = [];
    if (!balanceCheck) {
      status = await this.requestDeallocation(this.pairData.quote, proposedDeal.balanceRequired);
    } else {
      status = true;
      // Ignore sell order until the bot has actually bought something
      var buyOrders = proposedDeal.orders.filter((o) => o.order.side === 'buy');
      actions = buyOrders.map((order) => Action.OrderToAction(order, this.pairData));
    }

    var result;
    if (actions.length > 0) {
      result = await this.client.executeActions(actions);
      this.deals.set(proposedDeal.deal.id, proposedDeal.deal);
      this.updateDeals();
    }

    return { status: status, actions: actions, result: result };
  }

  /**
   *
   * @param {string} currency
   * @param {number} amount
   */
  async requestDeallocation(currency, amount) {
    var accountClient = this.bot.getClient(this.botSettings.account);
    var response = await accountClient.requestEarnAllocations(currency, this.bot.appCurrency);
    App.log(response);

    var allocation = response.find((item) => item.asset.toLowerCase() === currency);

    if (Number(allocation.amount) >= amount) {
      var deallocationResponse = await accountClient.deallocateFunds(allocation.strategyId, amount);
      return true;
    } else {
      this.logStatus(`Insufficient funds for deallocation: requested ${amount} available ${allocation.amount}`, 'warning');
      return false;
    }
  }

  updateDeals() {
    App.log(`Updating ${this.botSettings.fileId}-deals`);
    var data = {};

    for (let [key, value] of this.deals) {
      data[key] = value;
    }

    App.writeFile(`${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}-deals`, data);
  }

  loadDeals() {
    App.log(greenBright`Loading ${this.botSettings.fileId}-deals`);
    const file = `${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}-deals.json`;
    try {
      if (fs.existsSync(file)) {
        var data = App.readFileSync(file);
        this.deals = new Map(Object.keys(data).map((key) => [key, new TraderDeal(data[key])]));
      } else {
        App.warning(`File <${file}> does not exist`);
      }
    } catch (ex) {
      App.error(file, false);
      App.rethrow(ex);
    }
  }
}
