import App from '../app.js';
import Utils from '../utils.js';
import Action from '../data/action.js';
import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
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

  getLatestOpenDeal() {
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    return openDeals.at(-1);
  }

  async decide() {
    this.dateNow = new Date(Date.now());
    this.currentPrice = this.bot.getPrice(this.pairData.id);
    var openDeals = Array.from(this.deals.values()).filter((deal) => deal.status === 'open');
    this.statusMessages = [];
    this.actions = [];

    if (openDeals.length == 0) {
      if (this.accountClient.getBalance(this.pairData.baseCurrency) > 0) {
        await this.recoverDeal();
        return {
          botId: this.botId,
          requiresNewPlannedOrder: false,
          reason: this.logStatus(
            `Invalid state: non-zero ${this.pairData.baseCurrency} balance found, likely a previous deal was not closed correctly.`,
            'errorNonBlocking',
          ),
        };
      } else return { botId: this.botId, requiresNewPlannedOrder: false, reason: this.logStatus('No active open deals.') };
    }

    for (let i = 0; i < openDeals.length; i++) {
      this.clearFlags();
      var deal = openDeals[i];
      this.logStatus(`Processing [${cyanBright`${this.botId}`}]: ${deal.id}`, 'infoTimestamp');

      if (deal.status === 'closed') return;

      var dealData = this.reportDealStatus(deal);

      var completed = this.#checkCompletion(deal);

      if (completed) continue;

      var plannedOrders = deal.orders.map((id) => this.bot.getPlannedOrder(id));
      for (let i = 0; i < plannedOrders.length; i++) {
        let plannedOrder = plannedOrders[i];

        let exchangeOrder = typeof plannedOrder.txid === 'undefined' ? null : this.accountClient.getLocalOrder(plannedOrder.txid);
        if (plannedOrder.status === 'planned' && exchangeOrder == null) {
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
        App.warning(`Orders added to ${deal.id}`);
      }
      this.checkDealFlags(deal);
    }

    var response;
    if (this.actions.length > 0) response = await this.bot.executeActions(this.actions);
    console.log(this.actions);

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };

    return this.lastResult;
  }

  checkDealFlags(deal) {
    var newOrder = true;

    for (const [key, order] of this.flags) {
      var orderValid = typeof order != 'undefined';
      if (!orderValid) continue;

      switch (key) {
        case 'requiresSafetyOrder':
        case 'submitWaitingBuyOrder':
          deal.buyOrders.push(order.id);
          App.log(`Added ${order.id} to ${deal.id} buy orders`);
          this.updateDeals();
          break;

        case 'requiresTakeProfitOrder':
        case 'submitWaitingSellOrder':
          deal.sellOrders.push(order.id);
          App.log(`Added ${order.id} to ${deal.id} sell orders`);
          this.updateDeals();
          break;

        case 'submitPlannedBuyOrder':
        case 'submitPlannedSellOrder':
          break;

        case 'editTakeProfitOrder':
          App.warning(`Editing ${order.id}`);
          this.actions.push(Action.ReplaceAction(order, this.pairData));
          newOrder = false;
          break;

        default:
          App.warning(`Unrecognised flag: ${key}`);

          continue;
      }

      if (newOrder && this.canSubmit(order)) this.actions.push(Action.OrderToAction(order, this.pairData));
    }
  }

  /**
   *
   * @param {TraderDeal} deal
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
   *
   * @param {TraderDeal} deal
   */
  checkDealIntegrity(deal, dealData) {
    var ordersAdded = false;
    const removeCancelledOrders = (id, array) => {
      let idx = deal.buyOrders.indexOf(id);
      array.splice(idx, 1);
    };

    // check if there are open orders that have been cancelled
    deal.buyOrders.filter((id) => !this.bot.hasPlannedOrder(id)).forEach((id) => removeCancelledOrders(id, deal.buyOrders));
    deal.sellOrders.filter((id) => !this.bot.hasPlannedOrder(id)).forEach((id) => removeCancelledOrders(id, deal.sellOrders));

    // Check if more safety orders are needed
    if (deal.buyOrders.length <= this.botSettings.options.maxSafetyOrders + 1) {
      this.logStatus(`${this.botSettings.options.maxSafetyOrders + 1 - deal.buyOrders.length} more safety orders possible.`);
      var plannedOrders = deal.buyOrders.map((id) => this.bot.getPlannedOrder(id));
      var requiresSafetyOrder = plannedOrders.every((order) => order.isClosed);
      if (requiresSafetyOrder) {
        this.logStatus(`${cyanBright`${deal.id}`} requires a new limit buy order`, 'warning');
        var plannedBuyOrder = this.dealPlanner.calculateSafetyOrder(deal);
        this.setFlag({ requiresSafetyOrder }, plannedBuyOrder);
        this.bot.addPlannedOrders([plannedBuyOrder]);
        this.bot.updatePlanSchedule();
        ordersAdded = true;
      } else {
        this.logStatus(`${deal.id} ${yellowBright`already`} has an open buy order: ${cyanBright`${plannedOrders.find((o) => !o.isClosed).id}`}`);
      }
    } else App.warning('No more safety orders possible.');

    // check if there is no take profit order
    var sellOrders = deal.sellOrders.map((id) => this.bot.getPlannedOrder(id));
    var requiresTakeProfitOrder = !sellOrders.some((o) => o.status === 'pending');
    if (requiresTakeProfitOrder) {
      App.warning('Missing sell order.');
      this.createTakeProfitOrder(deal, dealData);
      ordersAdded = true;
    } else {
      var sellOrder = sellOrders.find((o) => o.status === 'pending');
      // check if the take profit order needs to be adjusted
      var volumeAvailable = this.accountClient.getBalance(this.pairData.baseCurrency);
      var updateTakeProfitOrder = sellOrder.volume != volumeAvailable;
      if (updateTakeProfitOrder) {
        App.warning('Current take profit order volume does not match current availability');
        this.editTakeProfitOrder(deal, sellOrder, volumeAvailable);
      }
    }
    return ordersAdded;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  #checkCompletion(deal) {
    if (deal.isCompleted(this.bot)) {
      this.logStatus(greenBright`Profit: ${deal.calculateProfit(this.bot).toFixed(2)} ${this.botSettings.quoteCurrency.toUpperCase()}`);
      deal.status = 'closed';
      this.updateDeals();
    }
    return deal.status;
  }

  /**
   *
   * @param {TraderDeal} deal
   */
  createTakeProfitOrder(deal, dealData) {
    var requiresTakeProfitOrder = true;
    var takeProfitOrder = this.dealPlanner.proposeTakeProfitOrder(deal, dealData);
    var availableBalance = this.accountClient.getBalance(this.botSettings.crypto.toLowerCase());
    if (takeProfitOrder.volume < availableBalance) {
      takeProfitOrder.volume = availableBalance;
    }
    if (takeProfitOrder.price < this.currentPrice) {
      takeProfitOrder.price = this.currentPrice;
    }
    this.setFlag({ requiresTakeProfitOrder }, takeProfitOrder);
    this.bot.addPlannedOrders([takeProfitOrder]);
    this.bot.updatePlanSchedule();
  }

  /**
   *
   * @param {TraderDeal} deal
   * @param {EcaOrder} sellOrder
   * @param {number} volumeAvailable
   */
  editTakeProfitOrder(deal, sellOrder, volumeAvailable) {
    var editTakeProfitOrder = true;
    App.log(
      `Order volume: ${yellowBright`${sellOrder.volume.toFixed(this.pairData.maxBaseDigits)}`} Available: ${yellowBright`${volumeAvailable.toFixed(this.pairData.maxBaseDigits)}`}`,
    );

    var dealData = deal.calculateProfitTarget(this.bot, this.botSettings);
    sellOrder.price = dealData.targetPrice + 1;
    sellOrder.volume = volumeAvailable;
    this.setFlag({ editTakeProfitOrder }, sellOrder);
  }

  /**
   *
   * @param {EcaOrder} waitingOrder
   * @param {TraderDeal} deal
   */
  processWaitingOrder(waitingOrder, deal) {
    if (waitingOrder.direction === 'sell') {
      var dealData = this.reportDealStatus(deal);
      var targetPrice = dealData.targetPrice;
      var submitWaitingSellOrder = this.currentPrice > targetPrice;

      if (submitWaitingSellOrder) {
        console.log(this.accountClient.balances);
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
      let message = `[${cyanBright`${plannedOrder.id}`}] ${plannedOrder.type} ${plannedOrder.direction} order ${greenBright`was filled`} on ${Utils.toShortDate(plannedOrder.closeDate)} ${Utils.toShortTime(plannedOrder.closeDate)}`;
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
    App.log(`[${cyanBright`${plannedOrder.id}`}]: processing planned order`);
    if (this.dateNow > plannedOrder.openDate) {
      let hoursElapsed = plannedOrder.hoursElapsed(this.dateNow, false);
      if (isNaN(hoursElapsed)) App.error(`Invalid time delta: ${plannedOrder.openDate} - ${hoursElapsed}`);
      let message = `[${cyanBright`${plannedOrder.id}`}] needs to be executed ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} past.`;
      this.logStatus(message);
      var submitPlannedBuyOrder = plannedOrder.direction === 'buy';
      var submitPlannedSellOrder = plannedOrder.direction === 'sell';
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
    let message = `[${cyanBright`${pendingOrder.id}`}] ${pendingOrder.type} ${pendingOrder.direction} order ${yellowBright`is still pending`} at ${Utils.toShortDateTime(this.dateNow)}`;
    this.logStatus(message);
  }

  /**
   *
   * @param {EcaOrder} order
   */
  canSubmit(order) {
    if (order.direction === 'buy') {
      var balanceCheck = this.balanceCheck(order.volumeEur);
      return balanceCheck && order.isScheduledForToday;
    } else {
      var volumeCheck = this.volumeCheck(order.volume);
      return volumeCheck && order.isScheduledForToday;
    }
  }

  async startDeal() {
    var lastDeal = [...this.deals.values()].slice(-1).pop();

    console.log(lastDeal);
    var baseIndex = lastDeal.buyOrders.length + lastDeal.sellOrders.length - 1;
    var proposedDeal = this.dealPlanner.proposeDeal(this.bot.getPrice(this.pairData.id), 1, baseIndex);
    var balanceCheck = this.balanceCheck(proposedDeal.balanceRequired);

    var status = false;
    var actions = [];
    if (!balanceCheck) {
      status = await this.requestDeallocation(this.pairData.quoteCurrency, proposedDeal.balanceRequired);
    } else {
      status = true;
      // Ignore sell order until the bot has actually bought something
      var buyOrders = proposedDeal.orders.filter((o) => o.direction === 'buy');
      actions = buyOrders.map((order) => Action.OrderToAction(order, this.pairData));
      this.bot.addPlannedOrders(buyOrders);
      this.bot.updatePlanSchedule();
    }

    var result;
    if (actions.length > 0) {
      this.updateDeals();
      result = await this.bot.executeActions(actions);
      this.deals.set(proposedDeal.deal.id, proposedDeal.deal);
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
    var response = await accountClient.requestEarnAllocations(currency);
    console.log(response);

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
    App.log(`Updating ${this.botSettings.account}-deals`);
    var data = {};

    for (let [key, value] of this.deals) {
      data[key] = value;
    }

    App.writeFile(`${App.DataPath}/${this.botSettings.account}/${this.botSettings.account}-deals`, data);
  }

  loadDeals() {
    App.log(greenBright`Loading ${this.botSettings.id}-deals`);
    const file = `${App.DataPath}/${this.botSettings.account}/${this.botSettings.account}-deals.json`;
    var data = App.readFileSync(file);
    this.deals = new Map(Object.keys(data).map((key) => [key, new TraderDeal(data[key])]));
  }

  async recoverDeal() {
    await this.bot.syncExchangeStatus(this.botSettings.account);
    App.warning('----- Attempting deal recovery -----');
    var orders = [...this.accountClient.orders.entries()]
      .map(([txid, rawOrder]) => this.accountClient.convertResponseToExchangeOrder(rawOrder, txid))
      .sort((a, b) => a.openDate.getTime() - b.openDate.getTime());

    var ordersWithoutPlannedOrder = orders
      .filter((o) => this.bot.getPlannedOrderByTxid(o.txid, this.botId) === undefined)
      .filter((o) => Utils.toShortDate(o.openDate) === Utils.toShortDate(this.dateNow));

    console.log(ordersWithoutPlannedOrder);

    if (ordersWithoutPlannedOrder.length > 0) {
      var plannedOrders = this.bot.getPlannedOrders(this.botId);
      var incompletePlannedOrders = ordersWithoutPlannedOrder.map((o) => [
        plannedOrders.find(
          (plannedOrder) =>
            Math.abs(plannedOrder.openDate.getTime() - o.openDate.getTime()) <= 1000 &&
            plannedOrder.direction === o.side &&
            plannedOrder.type === o.type &&
            plannedOrder.volume == o.volume,
        ).id,
        o.txid,
      ]);
      if (incompletePlannedOrders.length > 0) {
        App.log('Likely candidates:');
        if (incompletePlannedOrders.every((candidate) => typeof candidate[1] !== 'undefined')) App.log('All order matched!');
        else App.warning('Incomplete matches');
        App.log('Recovering deal');
        var buyOrders = [];
        var sellOrders = [];
        var status = 'closed';
        incompletePlannedOrders.forEach((match) => {
          var plannedId = match[0];
          var txId = match[1];
          var plannedOrder = this.bot.getPlannedOrder(plannedId);
          plannedOrder.txid = txId;
          var exchangeOrder = this.accountClient.getLocalOrder(txId);
          plannedOrder.closeDate = exchangeOrder.closeDate;
          if (exchangeOrder.isClosed) {
            plannedOrder.status = 'executed';
          } else {
            plannedOrder.status = 'pending';
            status = 'open';
          }

          if (plannedOrder.direction === 'buy') buyOrders.push(plannedOrder.id);
          else sellOrders.push(plannedOrder.id);
        });
        this.bot.updatePlanSchedule();
        var recoveredDeal = new TraderDeal({
          botId: this.botId,
          index: this.botSettings.userref + this.deals.size + 1,
          buyOrders: buyOrders,
          sellOrders: sellOrders,
          status: status,
        });
        console.log(recoveredDeal);
        this.deals.set(recoveredDeal.id, recoveredDeal);
        this.updateDeals();
      } else {
        App.log('No candidate orders found');
      }
    }
    // console.log(ordersWithPlannedOrder.map((o) => o.txid));
    // var deals = [...this.deals.values()];
    // var ordersNotInDeal = orders.filter(o=> deals.every(deal => deal.hasOrder())

    App.warning('----- end -----');
  }
}
