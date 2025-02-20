import App from '../app.js';
import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import EcaPlanner from './eca-planner.js';
import CryptoBot from '../crypto-bot.js';
import EcaOrder from '../data/eca-order.js';
import Action from '../data/action.js';
import Utils from '../utils.js';
import Strategy from './strategy.js';

export default class EcaStacker extends Strategy {
  botSettings;
  planner;
  /** @type {Action[]} */
  actions = [];
  /** @type {Date} */
  dateNow;
  /** @type {Date} */
  lastOrderDate;

  /**@type {EcaOrder} */
  lastOrder;

  /**
   * @typedef {Object} StrategyOrders
   * @property {string[]} executed
   * @property {string[]} pending
   * @property {string[]} planned
   */

  /** @type {import('../types.js').postExecutionCallback} */
  #updateCallback = (response) => {
    let order = response.order;
    this.#findAndReplaceOrder(order.txid, EcaOrder.StatusFromExchangeOrder(order.status));
    this.saveHistory();
    return order;
  };

  /**
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    super(bot, botId);
    if (typeof bot === 'undefined') throw new Error('Invalid argument: bot');

    this.botSettings = bot.getBotSettings(botId);
    this.planner = new EcaPlanner(botId, this.botSettings);

    if (!Object.hasOwn(this.strategyOrders, 'executed')) this.strategyOrders['executed'] = [];
    if (!Object.hasOwn(this.strategyOrders, 'pending')) this.strategyOrders['pending'] = [];
    if (!Object.hasOwn(this.strategyOrders, 'planned')) this.strategyOrders['planned'] = [];
  }

  /**
   *
   * @returns {Boolean}
   */
  hasActiveOrders() {
    return this.getPlannedOrders().some((order) => {
      return order.isScheduledForToday || order.isPastExecutionDate || order.isActive;
    });
  }

  /**
   * @param {EcaOrder[]} plannedOrders
   */
  hasNoPlannedOrders(plannedOrders) {
    return plannedOrders.every((order) => order.isExecuted);
  }

  /**
   * @returns {Promise<boolean>}
   */
  async updatePendingOrders() {
    var pendingTxids = this.strategyOrders.pending;
    var update = false;

    if (pendingTxids.length > 0) {
      let pendingOrders = await this.client.requestOrdersByTxid(pendingTxids);
      for (const order of pendingOrders) {
        if (order.isClosed && this.strategyOrders.pending.includes(order.txid)) {
          update = this.#findAndReplaceOrder(order.txid, 'executed');
          if (update) App.log(`Order [${cyanBright`${order.txid}`}] status ${greenBright`updated`}`);
          else App.error(`Update failed: ${order.txid}`);
        }
      }
      return update;
    }
    return update;
  }

  async decide() {
    this.dateNow = new Date();
    var client = this.bot.getClient(this.botSettings.account);
    var plannedOrders = this.getPlannedOrders();
    this.currentPrice = client.getPrice(this.pairData.id);

    this.statusMessages = [];
    this.actions = [];

    if (await this.updatePendingOrders()) {
      this.saveHistory();
    }

    this.logStatus(`Processing [${cyanBright`${this.botId}`}]: ${this.botSettings.options.type}`, 'infoTimestamp');
    this.logStatus(
      `Plan for ${yellowBright`${this.botId}`} has ${cyanBright`${this.strategyOrders.executed.length}`} executed orders, ${yellowBright`${this.strategyOrders.pending.length}`} pending orders, ${yellowBright`${this.strategyOrders.planned.length}`} planned orders`,
    );
    this.lastOrder = plannedOrders
      .filter((o) => o.status === 'executed')
      .sort((a, b) => a.order.closeDate.getTime() - b.order.closeDate.getTime())
      .at(-1);

    if (this.botSettings.active && this.hasNoPlannedOrders(plannedOrders)) {
      if (!this.checkStatus(plannedOrders)) return { botId: this.botId, status: `${this.botId}: no orders in plan.` };
    }

    for (let i = 0; i < plannedOrders.length; i++) {
      let plannedOrder = plannedOrders[i];
      let exchangeOrder = plannedOrder.order;

      if (plannedOrder.status === 'planned' && exchangeOrder == null) {
        this.processPlannedOrder(plannedOrder);
      } else if (plannedOrder.status === 'pending' && exchangeOrder != null && exchangeOrder.isOpen) {
        this.processPendingOrder(plannedOrder);
      } else if (plannedOrder.status === 'executed' && exchangeOrder != null && !exchangeOrder.isOpen) {
        this.processExecutedOrder(plannedOrder);
      } else {
        this.logStatus(`Unexpected branch for ${this.botId}`, 'warning');
        App.printObject(plannedOrder);
        App.printObject(exchangeOrder);
        throw new Error();
      }
    }

    this.checkDealFlags();

    var response;
    //if (this.actions.length > 0) response = this.client.executeActions(this.actions);
    App.printObject(this.actions);

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };

    return this.lastResult;
  }

  /**
   * @param {EcaOrder[]} plannedOrders
   */
  checkStatus(plannedOrders) {
    var requiresNewPlannedOrder = true;
    let hoursElapsed;
    let invalidHoursElapsed = false;
    let firstOrder = false;
    if (typeof this.lastOrder === 'undefined') {
      hoursElapsed = this.botSettings.options.frequency;
      this.logStatus('This is the first plan');
      firstOrder = true;
    } else if (this.lastOrder.status === 'executed') {
      hoursElapsed = this.lastOrder.hoursElapsed(this.dateNow);
      invalidHoursElapsed = this.lastOrder.order.closeDate.getFullYear() === 1970;
    } else if (this.lastOrder.status === 'planned') {
      hoursElapsed = this.lastOrder.hoursElapsed(this.dateNow, false);
      invalidHoursElapsed = this.lastOrder.order.openDate.getFullYear() === 1970;
    }

    if (invalidHoursElapsed || isNaN(hoursElapsed)) {
      requiresNewPlannedOrder = false;
      App.printObject(this.lastOrder);
      App.error(`${this.botId}: invalid hours elapsed: ${hoursElapsed}`);
    } else {
      if (firstOrder) this.logStatus(`This is the first order`);
      else
        this.logStatus(
          `${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} have elapsed since last ${cyanBright`${this.pairData.base}`} order [${cyanBright`${this.lastOrder.id}`}]`,
        );
    }

    if (plannedOrders.every((order) => order.isExecuted)) {
      if (this.botSettings.options.type === 'recurring') {
        let ordersToday = this.getPlannedOrders().filter(
          (o) => Utils.toShortDate(new Date(o.order.closeDate)) === Utils.toShortDate(new Date(Date.now())),
        ).length;

        if (ordersToday > 0) App.log(`Today ${cyanBright`${ordersToday.toString()}`} orders for ${cyanBright`${this.botId}`} were executed`);
        if (ordersToday >= this.botSettings.options.maxOrdersPerDay) requiresNewPlannedOrder = false;
      } else if (this.botSettings.options.type === 'monthly') {
        if (this.countOrdersInMonth(plannedOrders) >= 1) {
          App.warning(`${this.botId}: plan already executed for this month`);
          requiresNewPlannedOrder = true;
        }
      } else {
        requiresNewPlannedOrder = false;
      }
    } else requiresNewPlannedOrder = false;

    this.logStatus(`[${cyanBright`${this.botId}`}] ${requiresNewPlannedOrder ? greenBright`requires` : redBright`does not require`} a new order`);

    if (requiresNewPlannedOrder) {
      var orders = this.planner.proposeNext(this.lastOrder);
      var newPlannedOrder = orders.pop();
      this.logStatus(`New planned order ${newPlannedOrder.toString()}`);
      this.setFlag({ requiresNewPlannedOrder }, newPlannedOrder);
    }

    return requiresNewPlannedOrder;
  }

  /**
   *
   * @param {EcaOrder[]} plannedOrders
   * @returns {Number}
   */
  countOrdersInMonth(plannedOrders) {
    var thisYear = this.dateNow.getFullYear();
    var thisMonth = this.dateNow.getMonth();
    var ordersThisMonth = plannedOrders.filter((o) => o.order.closeDate.getMonth() == thisMonth && o.order.closeDate.getFullYear() == thisYear);
    return ordersThisMonth.length;
  }

  checkDealFlags() {
    for (const [key, order] of this.flags) {
      var orderValid = typeof order != 'undefined';
      if (!orderValid) continue;

      switch (key) {
        case 'submitPlannedBuyOrder':
          break;

        case 'requiresNewPlannedOrder':
          this.strategyOrders.planned.push(order);
          break;

        case 'replacePendingOrder':
          this.actions.push(this.replaceAction(order));
          break;

        default:
          App.warning(`Unrecognised flag: ${key}`);
          continue;
      }

      if (this.canSubmit(order)) {
        var action = this.decideAction(order, this.currentPrice);
        if (typeof action === 'undefined') {
          App.printObject(order);
          App.error(`Invalid action in ${this.botId} [${key}]`);
        }
        this.actions.push(action);
      } else {
        if (order.isActive) this.logStatus(`[${order.id}] is already planned or active`);
        else this.logStatus(`[${order.id}] cannot be submitted`);
      }
    }
  }

  /**
   *
   * @param {EcaOrder} order
   */
  canSubmit(order) {
    var balanceCheck = this.balanceCheck(order.volumeQuote);
    var isToday = order.isScheduledForToday || order.isPastExecutionDate;

    return balanceCheck && isToday;
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPlannedOrder(plannedOrder) {
    if (typeof plannedOrder === 'undefined') {
      App.error(`Invalid order in ${this.botId}`);
    }

    this.logStatus(`Processing planned order ${plannedOrder.id}`);
    var hoursElapsed = plannedOrder.hoursElapsed(this.dateNow, false);
    var submitPlannedBuyOrder = this.dateNow > plannedOrder.order.openDate;

    if (submitPlannedBuyOrder) {
      if (isNaN(hoursElapsed)) App.error(`Invalid time delta: ${plannedOrder.order.openDate} - ${hoursElapsed}`);
      let message = `[${cyanBright`${plannedOrder.id}`}] needs to be executed ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} past.`;
      this.logStatus(message);
      this.setFlag({ submitPlannedBuyOrder }, plannedOrder);
    } else {
      this.logStatus(
        `[${this.botId}] No actions need to be taken now. Next action in: ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} (${yellowBright`${Utils.toShortDate(plannedOrder.order.openDate)}`} ${Utils.toShortTime(plannedOrder.order.openDate)})`,
      );
      this.balanceCheck();
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPendingOrder(plannedOrder) {
    this.logStatus(yellowBright`[${plannedOrder.id}] still pending at ${Utils.toShortTime(this.dateNow)}`);

    let waitDate = new Date(plannedOrder.order.openDate);
    waitDate.setHours(23, 29, 0);
    if (waitDate.getFullYear() == 1970) App.error(`Wrong date: ${Utils.toShortDate(waitDate)} - plan.date: ${plannedOrder.order.openDate}`);

    this.logStatus(`${greenBright`Waiting`} until ${Utils.toShortDate(waitDate)} ${yellowBright`${Utils.toShortTime(waitDate)}`}`);

    var replacePendingOrder = new Date(Date.now()) >= waitDate;

    if (replacePendingOrder) {
      this.logStatus('Pending order can be executed');
      plannedOrder.order.type = 'market';
      this.setFlag({ replacePendingOrder }, plannedOrder);
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processExecutedOrder(plannedOrder) {}

  /**
   *
   * @param {EcaOrder} plannedOrder
   * @param {Number} currentPrice
   * @returns {Action}
   */
  decideAction(plannedOrder, currentPrice) {
    var action;
    const maxPrice = this.botSettings.maxPrice;
    var test = false;

    if (currentPrice > maxPrice) {
      App.log(yellowBright`[${plannedOrder.id}]: above max price, setting limit to ${redBright`${maxPrice}`}`);
      action = this.limitBuyAction(plannedOrder, currentPrice);
    } else action = this.marketBuyAction(plannedOrder, currentPrice);

    App.log(`Order planned for today or past due? ${yellowBright`${plannedOrder.isScheduledForToday || plannedOrder.isPastExecutionDate ? 'yes' : 'no'}`}`);
    return action;
  }

  /**
   *
   * @param {EcaOrder} ecaOrder
   * @param {Number} currentPrice
   * @param {boolean} isTest
   * @returns {Action}
   */
  marketBuyAction(ecaOrder, currentPrice, isTest = true) {
    ecaOrder.order.type = EcaOrder.OrderTypes.market;
    ecaOrder.order.volume = Number(ecaOrder.volumeQuote / currentPrice);
    if (ecaOrder.order.volume < this.pairData.minVolume) ecaOrder.order.volume = this.pairData.minVolume;

    ecaOrder.order.side = 'buy';
    ecaOrder.order.price = this.client.getPrice(ecaOrder.order.pair);

    return Action.MarketAction(ecaOrder, this.pairData, this.#updateCallback);
  }

  /**
   *
   * @param {EcaOrder} ecaOrder
   * @param {Number} currentPrice
   * @param {boolean} isTest
   * @returns
   */
  limitBuyAction(ecaOrder, currentPrice, isTest = true) {
    const maxPrice = this.botSettings.maxPrice;

    ecaOrder.order.type = EcaOrder.OrderTypes.limit;

    if (currentPrice > maxPrice) {
      ecaOrder.order.price = maxPrice;
    }

    ecaOrder.order.volume = Number(ecaOrder.volumeQuote / currentPrice);

    App.log(
      `Cost: ${ecaOrder.volumeQuote.toFixed(this.pairData.maxQuoteDigits)} Price: ${currentPrice.toFixed(this.pairData.maxQuoteDigits)} -> Volume: ${ecaOrder.order.volume.toFixed(this.pairData.maxBaseDigits)}`,
    );

    if (ecaOrder.order.volume < this.pairData.minVolume) {
      ecaOrder.order.volume = this.pairData.minVolume;
    }

    ecaOrder.volumeQuote = ecaOrder.order.volume * currentPrice;
    return Action.LimitAction(ecaOrder, this.pairData, this.#updateCallback);
  }

  /**
   *
   * @param {EcaOrder} ecaOrder
   */
  replaceAction(ecaOrder) {
    var currentPrice = this.client.getPrice(ecaOrder.order.pair);
    ecaOrder.order.price = currentPrice;
    ecaOrder.order.volume = this.botSettings.maxVolumeQuote / currentPrice;

    var action = Action.ReplaceAction(
      new EcaOrder(
        {
          botId: this.botId,
          strategy: this.botSettings.strategyType,
          volumeQuote: this.botSettings.maxVolumeQuote,
          account: this.botSettings.account,
        },
        ecaOrder.order,
      ),
      this.pairData,
      this.#updateCallback,
    );
    return action;
  }

  rebuildHistory(tolerance = 0.5) {
    var accountClient = this.bot.getClient(this.botSettings.account);
    App.log(`Rebuilding history for <${cyanBright`${this.botId}`}>: ${accountClient.orders.size} orders to parse.`);

    var volumeQuote = this.botSettings.maxVolumeQuote;
    var lowerLimit = volumeQuote - tolerance * volumeQuote;
    var upperLimit = volumeQuote + tolerance * volumeQuote;
    App.log(`Search range: ${lowerLimit}-${upperLimit} ${this.botSettings.quote}`);

    var orders = [];
    var leftOutOrders = [];

    accountClient.orders.forEach((order) => {
      if (order.pair !== this.botSettings.pair) return;
      if ((order.isClosed && order.cost >= lowerLimit && order.cost <= upperLimit) || order.isOpen) orders.push(order);
      else {
        let txid = order.txid;
        let cost = order.cost;
        leftOutOrders.push({ [txid]: cost });
      }
    });

    App.log(`Qualifying orders: ${cyanBright`${orders.length.toString()}`}`);
    App.log(`Left out orders  : ${redBright`${leftOutOrders.length.toString()}`}`);

    App.printObject(leftOutOrders);

    /** @type {StrategyOrders} */
    var result = Object.groupBy(orders, ({ status }) => EcaOrder.StatusFromExchangeOrder(status));
    Object.entries(result).forEach(([k, array]) => (result[k] = array.map((order) => order.txid)));
    result['lastCheck'] = new Date().toISOString();
    let filename = this.botId.replace('/', '-');
    App.writeFile(`${App.DataPath}/${accountClient.type}/${this.botSettings.fileId}`, result);
  }

  saveHistory() {
    App.log(greenBright`Updating ${this.botSettings.fileId}`);
    this.strategyOrders['lastCheck'] = new Date().toISOString();
    App.writeFile(`${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}`, this.strategyOrders);
  }

  /**
   *
   * @param {string} txid
   * @param {string} toArray
   * @returns {Boolean}
   */
  #findAndReplaceOrder(txid, toArray) {
    var data = Object.entries(this.strategyOrders);
    var found = false;
    for (const [type, orders] of data) {
      if (orders.constructor !== Array) continue;

      let index = orders.indexOf(txid);
      orders.splice(index, 1);
      found = true;
    }

    if (found) this.strategyOrders[toArray].push(txid);

    return found;
  }
}
