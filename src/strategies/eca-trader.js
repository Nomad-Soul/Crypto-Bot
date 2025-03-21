import App from '../app/app.js';
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
import Terminal from '../app/terminal.js';

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
  async updatePendingOrders(openDeals) {
    var term = Terminal.instance;
    term.log('Updating pending orders');

    // update all pending orders
    var orders = openDeals.map((deal) => deal.orders).flat();

    var pendingOrders = [];
    try {
      for (const txid of orders) {
        if (!this.client.hasLocalOrder(txid)) {
          pendingOrders.push(txid);
        } else {
          let exOrder = this.client.getLocalOrder(txid);
          if (exOrder.isOpen) {
            pendingOrders.push(txid);
          }
        }
      }
      if (pendingOrders.length > 0) await this.client.requestOrdersByTxid(pendingOrders);
    } catch (ex) {
      if (ex.name == 'ExchangeError') {
        term.error(ex.message);
        return;
      }
      term.error(`${pendingOrders.length} orders do not exist on ${this.botSettings.account}, recovering...`, false);
      term.printObject(ex);
      var txidToRemove = [];
      for (const txid of pendingOrders) {
        try {
          term.warning(`Checking order ${txid}`);
          await this.client.requestOrdersByTxid([txid]);
        } catch (ex) {
          txidToRemove.push(txid);
          term.warning(`Order ${redBright`${txid}`} does not exist on ${this.client.id}`);
        }
      }
      for (const deal of openDeals) {
        for (const txid of txidToRemove) {
          if (deal.hasOrder(txid)) {
            deal.removeOrder(txid);
          }
        }
      }

      this.updateDeals();
    }

    if (openDeals.length == 0) {
      // If there are no open deals check that the balance of the crypto we trade is 0.
      if (this.client.getBalance(this.pairData.base) > 0) {
        return {
          botId: this.botId,
          requiresNewPlannedOrder: false,
          reason: `Invalid state: non-zero ${this.pairData.base} balance found, likely a previous deal was not closed correctly.`,
        };
      } else return { botId: this.botId, requiresNewPlannedOrder: false, reason: this.logStatus('No active open deals.') };
    } else {
      // otherwise check that we have data about all orders in the deal
      let test = true;
      for (const deal of openDeals) {
        for (const txid of deal.orders) {
          let found = this.client.hasLocalOrder(txid);
          if (!found) {
            term.warning(`Missing order ${redBright`${txid}`}`);
            await this.client.requestOrder(txid);
          }
          let order = this.client.getLocalOrder(txid);
          if (order.isCancelled) deal.removeOrder(order.txid);
          test = test && found;
        }
      }
    }
  }

  /**
   * @param {string} statusFilter
   * @returns {Promise<EcaOrder[]>}
   */
  async getPlannedOrders(statusFilter = undefined) {
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
    var term = Terminal.instance;
    term.log('\r\n');
    term.warning(`--- [${this.botId}]: ${this.botSettings.strategyType} ---`);
    term.setIndentString(' | ');
    this.dateNow = new Date(Date.now());
    await this.client.awaitPrices();
    await this.client.awaitBalances();
    this.currentPrice = this.client.getPrice(this.pairData.id);
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    this.statusMessages = [];
    this.actions = [];

    await this.updatePendingOrders(openDeals);

    for (let i = 0; i < openDeals.length; i++) {
      this.clearFlags();
      var deal = openDeals[i];
      term.log(`Processing deal ^y${deal.id}`);

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
        }

        if (this.checkDealIntegrity(deal, dealData)) {
          term.warning(`New orders planned for ${deal.id}`);
        }
      }

      this.checkDealFlags(deal);
    }

    var response;
    if (this.actions.length > 0) {
      for (const action of this.actions) {
        response = await this.awaitConfirmation(action, (order) => {
          term.warning(`What should I do with ${order.txid}?`);
        });
        //Terminal.prompt();
      }
    }

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };
    term.setIndent(0);
    term.log('\r');

    return this.lastResult;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  checkDealFlags(deal) {
    var term = Terminal.instance;
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
            term.log(`Added ${response.order.txid} to ${deal.id} buy orders`);
            this.updateDeals();
            return response.order;
          };
          break;

        case 'requiresTakeProfitOrder':
        case 'submitWaitingSellOrder':
          if (!orderValid) throw new Error(`${key}: Invalid Order`);
          postExecutionCallback = (response) => {
            deal.sellOrders.push(response.order.txid);
            term.log(`Added ${response.order.txid} to ${deal.id} sell orders`);
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
            //term.log(`Replaced ${previousTxid} with ${order.txid}`);
            //this.updateDeals();
            Terminal.printObject(order);
            return order;
          };

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
          term.warning(`Cancelling all pending orders for deal ${deal.id}`);
          postExecutionCallback = (response) => {
            if (response.result) {
              deal.removeOrder(response.order.txid);
              this.updateDeals();
            }
            return response.order;
          };
          this.actions.push(
            ...deal.orders
              .map((id) => this.getPlannedOrder(id))
              .filter((order) => order.isActive)
              .map((order) => Action.CancelAction(order, postExecutionCallback)),
          );
          newOrder = false;
          continue;

        default:
          term.warning(`Unrecognised flag: ${key}`);
          continue;
      }
      try {
        if (newOrder && this.canSubmit(ecaOrder)) {
          var action = Action.OrderToAction(ecaOrder, this.pairData, postExecutionCallback);
          action.tradeId = deal.id;
          this.actions.push(action);
        }
      } catch (ex) {
        term.printObject(this.flags);
        term.error(ex.message);
      }
    }
  }

  /**
   *
   * @param {TraderDeal} deal
   * @returns {import('../types.js').DealData}
   */
  reportDealStatus(deal) {
    var term = Terminal.instance;
    if (deal.status != 'open') {
      this.logStatus(`No active orders for ${deal.id}`, 'warning');
    }

    var dealData = deal.calculateProfitTarget(this.bot, this.botSettings);
    term.log(`Cost Basis: ^Y${dealData.costBasis.toFixed(2)}^: Average Price: ^Y${dealData.averageCost.toFixed(this.pairData.maxQuoteDigits)}`);
    var colour = this.currentPrice > dealData.targetPrice ? '^G' : '^R';
    var percentDistance = (100 * (this.currentPrice - dealData.targetPrice)) / dealData.targetPrice;
    term.log(
      `Current price: ${colour}${this.currentPrice.toFixed(this.pairData.maxQuoteDigits)}^: Target: ^G${dealData.targetPrice.toFixed(this.pairData.maxQuoteDigits)}^ (${colour}${percentDistance.toFixed(2)}%^:)`,
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
    var term = Terminal.instance;
    var ordersAdded = false;
    const removeCancelledOrders = (id, array) => {
      let idx = deal.buyOrders.indexOf(id);
      array.splice(idx, 1);
    };

    var volumeAvailable = this.client.getBalance(this.pairData.base);
    if (volumeAvailable == 0) volumeAvailable = this.client.getBalance(this.botSettings.alternateBase);

    var quoteAvailable = this.client.getBalance(this.botSettings.quote);
    //var alternateQuote = this.client.getBalance(this.botSettings.alternateQuote);
    if (quoteAvailable == 0) quoteAvailable = this.client.getBalance(this.botSettings.alternateQuote);

    // check if there are open orders that have been cancelled
    deal.buyOrders.filter((id) => !this.client.hasLocalOrder(id)).forEach((id) => removeCancelledOrders(id, deal.buyOrders));
    deal.sellOrders.filter((id) => !this.client.hasLocalOrder(id)).forEach((id) => removeCancelledOrders(id, deal.sellOrders));

    var safetyOrdersRemaining = this.botSettings.options.maxSafetyOrders + 1 - deal.buyOrders.length;
    // Check if more safety orders are needed
    if (safetyOrdersRemaining > 0) {
      term.log(`${safetyOrdersRemaining} more safety orders possible.`);
      var plannedOrders = deal.buyOrders.map((id) => this.getPlannedOrder(id));
      var requiresSafetyOrder = plannedOrders.every((order) => order.isExecuted);
      if (requiresSafetyOrder) {
        term.log(`[^c${deal.id}^:]: requires a new limit buy order`);
        var plannedBuyOrder = this.dealPlanner.proposeSafetyOrder(deal);

        if (plannedBuyOrder.order.price > this.client.getPrice(plannedBuyOrder.order.pair)) {
          term.printObject(dealData);
          term.printObject(plannedBuyOrder);
          term.error('Proposed buy price is higher than current price!');
        }

        this.setFlag({ requiresSafetyOrder }, plannedBuyOrder);
        ordersAdded = true;
      } else {
        var plannedOrder = plannedOrders.find((o) => !o.isExecuted);
        term.log(`${deal.id} ^Yalready^: has a ${plannedOrder.status} ${plannedOrder.order.type} buy order: ^C${plannedOrder.id}`);
      }
    } else {
      var minQuoteDigits = Math.min(App.locale.minQuoteDigits, this.pairData.maxQuoteDigits);
      term.warning('No more safety orders possible');
      term.log(`Balance available: ^g${quoteAvailable.toFixed(minQuoteDigits)}`);
    }

    // check if there is no take profit order
    var sellOrders = deal.sellOrders.map((id) => this.getPlannedOrder(id));
    var requiresTakeProfitOrder = !sellOrders.some((o) => o.status === 'pending');
    if (requiresTakeProfitOrder) {
      term.log(`[^c${deal.id}^:]: requires a new limit sell order`);
      this.createTakeProfitOrder(deal, dealData);
      ordersAdded = true;
    } else {
      var sellOrder = sellOrders.find((o) => o.status === 'pending');
      // check if the take profit order needs to be adjusted

      var volumeDelta = Math.abs(sellOrder.order.volume - volumeAvailable);
      var priceDelta = Math.abs(dealData.targetPrice - sellOrder.order.price);

      var volumeMatch = volumeDelta <= this.botSettings.options.volumeUpdateThreshold * volumeAvailable;
      var priceMatch = priceDelta <= 2 * this.pairData.precision.price;
      var updateTakeProfitOrder = !volumeMatch || !priceMatch;

      if (dealData.targetPrice < this.client.getPrice(sellOrder.order.pair)) {
        term.printObject(dealData);
        term.printObject(sellOrder);
        term.error('Proposed sell price is lower than current price!');
      }

      var labelVolume;
      if (volumeMatch) {
        if (volumeDelta <= 2 * this.pairData.precision.amount) {
          labelVolume = `^Gmatches^:`;
        } else if (volumeDelta <= 0.005 * volumeAvailable) {
          labelVolume = `^ynerly matches^:`;
        }
      } else labelVolume = `^Rdoes not match^:`;

      term.log(
        `Current take profit order volume ${labelVolume} volume available: ^y${sellOrder.order.volume.toFixed(this.pairData.maxBaseDigits)}^:/^Y${volumeAvailable.toFixed(this.pairData.maxBaseDigits)}^:: ${volumeDelta.toFixed(this.pairData.maxBaseDigits)} < ${this.botSettings.options.volumeUpdateThreshold * 100}%`,
      );
      term.log(
        `Current take profit order price ${priceMatch ? `^Gmatches^:` : `^Rdoes not match`} proposed target price: ^g${sellOrder.order.price.toFixed(this.pairData.maxQuoteDigits)}^:/^G${dealData.targetPrice.toFixed(this.pairData.maxQuoteDigits)}^:: ${priceDelta.toFixed(this.pairData.maxQuoteDigits)}`,
      );

      if (updateTakeProfitOrder) {
        this.editTakeProfitOrder(deal, sellOrder, volumeAvailable, dealData);
      }
    }
    return ordersAdded;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  #checkCompletion(deal) {
    var term = Terminal.instance;
    if (deal.isCompleted(this.bot, this.pairData)) {
      term.log(`^GProfit: ${deal.calculateProfit(this.bot).toFixed(2)} ${this.botSettings.quote.toUpperCase()}`);
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
    sellOrder.order.price = Number(dealData.targetPrice.toFixed(this.pairData.maxQuoteDigits));
    sellOrder.order.volume = +(volumeAvailable - this.pairData.precision.amount).toFixed(this.pairData.maxBaseDigits);
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
      let message = `[^c${plannedOrder.id}^:] ${plannedOrder.order.toString(this.pairData)} was ^gfilled^: on ^y${Utils.toShortDate(plannedOrder.order.closeDate)} ${Utils.toShortTime(plannedOrder.order.closeDate)}`;
      this.logStatus(message);
    } catch (e) {
      Terminal.instance.warning(`${plannedOrder.id}`);
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPlannedOrder(plannedOrder) {
    var term = Terminal.instance;
    let order = plannedOrder.order;
    term.log(`[^C${plannedOrder.id}^:]: processing planned order`);
    if (this.dateNow > order.openDate) {
      let hoursElapsed = plannedOrder.hoursElapsed(this.dateNow, false);
      if (isNaN(hoursElapsed)) term.error(`Invalid time delta: ${order.openDate} - ${hoursElapsed}`);
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
    let colour = order.side === 'buy' ? '^r' : '^g';
    let message = `[^c${pendingOrder.id}^:] ${order.toString(this.pairData)} is still ^ypending^`;
    this.logStatus(message);
  }

  /**
   *
   * @param {EcaOrder} ecaOrder
   */
  canSubmit(ecaOrder) {
    let order = ecaOrder.order;
    if (order.side === 'buy') {
      var balanceCheck = this.balanceCheck(ecaOrder.volumeQuote + ecaOrder.order.fees);
      return balanceCheck && (ecaOrder.isScheduledForToday || ecaOrder.isPastExecutionDate);
    } else {
      var volumeCheck = this.volumeCheck(order.volume) || this.volumeCheck(order.volume, true);
      return volumeCheck && (ecaOrder.isScheduledForToday || ecaOrder.isPastExecutionDate);
    }
  }

  async startDeal() {
    var term = Terminal.instance;
    var index = this.deals.size + 1;
    var proposedDeal = this.dealPlanner.proposeDeal(this.client.getPrice(this.pairData.id), 1, index);
    var balanceCheck = this.balanceCheck(proposedDeal.balanceRequired);

    var status = false;
    /** @type {Action[]} */
    var actions = [];
    if (!balanceCheck) {
      status = await this.requestDeallocation(this.pairData.quote, proposedDeal.balanceRequired);
    } else {
      this.deals.set(proposedDeal.deal.id, proposedDeal.deal);
      var postExecutionCallback = (/** @type {{order: ExchangeOrder, action: Action, result: Boolean}} */ response) => {
        let deal = this.deals.get(response.action.tradeId);
        deal.buyOrders.push(response.order.txid);
        term.log(`Added ${response.order.txid} to ${deal.id} buy orders`);
        this.updateDeals();
        return response.order;
      };
      status = true;
      // Ignore sell order until the bot has actually bought something
      var buyOrders = proposedDeal.orders.filter((o) => o.order.side === 'buy');
      actions = buyOrders.map((order) => Action.OrderToAction(order, this.pairData, postExecutionCallback));
    }

    var result;
    if (actions.length > 0) {
      for (const action of actions) {
        action.tradeId = proposedDeal.deal.id;
        result = await this.awaitConfirmation(action, (order) => {
          term.warning(`What should I do with ${order.txid}?`);
        });
        if (result) {
          let index = proposedDeal.deal.buyOrders.indexOf(action.plannedOrder.id);
          proposedDeal.deal.buyOrders.slice(index, 1);
        }
      }
    }

    return { status: status, actions: actions, result: result };
  }

  /**
   *
   * @param {string} currency
   * @param {number} amount
   */
  async requestDeallocation(currency, amount) {
    var term = Terminal.instance;
    var accountClient = this.bot.getClient(this.botSettings.account);
    var response = await accountClient.requestEarnAllocations(currency, this.bot.appCurrency);
    term.log(response);

    var allocation = response.find((item) => item.asset.toLowerCase() === currency);

    if (Number(allocation.amount) >= amount) {
      var deallocationResponse = await accountClient.deallocateFunds(allocation.strategyId, amount);
      return true;
    } else {
      term.warning(`Insufficient funds for deallocation: requested ${amount} available ${allocation.amount}`);
      return false;
    }
  }

  updateDeals() {
    Terminal.instance.log(`Updating ^Y${this.botSettings.fileId}-deals`);
    var data = {};

    for (let [key, value] of this.deals) {
      data[key] = value;
    }

    App.writeFile(`${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}-deals`, data);
  }

  loadDeals() {
    var term = Terminal.instance;
    term.log(`Loading ^C${this.botSettings.fileId}-deals`);
    const file = `${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}-deals.json`;
    try {
      if (fs.existsSync(file)) {
        var data = App.readFileSync(file);
        this.deals = new Map(Object.keys(data).map((key) => [key, new TraderDeal(data[key])]));
      } else {
        term.warning(`File <${file}> does not exist`);
      }
    } catch (ex) {
      term.error(file, false);
      term.rethrow(ex);
    }
  }
}
