import App from '../app/app.js';
import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import fs from 'fs';
import EcaPlanner from './eca-planner.js';
import CryptoBot from '../crypto-bot.js';
import EcaOrder from '../data/eca-order.js';
import Action from '../data/action.js';
import Utils from '../utils.js';
import Strategy from './strategy.js';
import Terminal from '../app/terminal.js';
import ExchangeOrder from '../data/exchange-order.js';

export default class EcaStacker extends Strategy {
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
   * @property {string[]} [executed]
   * @property {string[]} [pending]
   * @property {EcaOrder[]} [planned]
   */

  /** @type {StrategyOrders} */
  strategyOrders = {};

  #lastHistoryCheck;

  /** @type {import('../types.js').postExecutionCallback} */
  #updateCallback = async (response) => {
    let order = response.order;
    let found = this.#findAndReplaceOrder(order.txid, EcaOrder.StatusFromExchangeOrder(order.status));
    if (!found) {
      this.strategyOrders.executed.push(order.txid);
      this.strategyOrders.planned = this.strategyOrders.planned.filter((order) => order.id !== response.action.plannedOrder.id);
    }
    if (response.result) {
      let telegram = this.bot.getService('telegram');
      if (telegram) {
        if (!order.volume) {
          // Empyric wait
          await new Promise((r) => setTimeout(r, 1000));
          let finalizedOrder = await this.client.requestOrder(order.txid);
          if (response.action.command === 'submitOrder')
            telegram.log(`Placed new order: ${finalizedOrder.toString(this.pairData)} on ${this.botSettings.account}`);
        }
      }
      this.saveHistory();
    } else {
      Terminal.printObject(response);
      Terminal.error('Invalid response');
    }
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

    let path = `${App.DataPath}/${this.botSettings.account}/${this.botSettings.strategyType.replace('eca-', '')}-${this.botId.replace('/', '-')}.json`;
    if (fs.existsSync(path)) {
      this.strategyOrders = App.readFileSync(path);
      this.#lastHistoryCheck = this.strategyOrders['lastCheck'];
      delete this.strategyOrders['lastCheck'];
    } else {
      this.rebuildHistory();
      if (this.botId === 'link/eur') Terminal.instance.warning('oh no!');
    }

    if (!Object.hasOwn(this.strategyOrders, 'executed')) this.strategyOrders['executed'] = [];
    if (!Object.hasOwn(this.strategyOrders, 'pending')) this.strategyOrders['pending'] = [];
    if (!Object.hasOwn(this.strategyOrders, 'planned')) this.strategyOrders['planned'] = [];

    if (this.strategyOrders.planned.length > 0) {
      this.strategyOrders.planned = this.strategyOrders.planned.map((data) => new EcaOrder(data, new ExchangeOrder(data.order)));
    }
  }

  /**
   *
   * @returns {Boolean}
   */
  hasActiveOrders() {
    return (
      this.strategyOrders.pending.length > 0 ||
      this.strategyOrders.planned.some((order) => order.isScheduledForToday || order.isPastExecutionDate) ||
      (this.strategyOrders.pending.length == 0 && this.strategyOrders.planned.length == 0)
    );
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
    var term = Terminal.instance;
    var pendingTxids = this.strategyOrders.pending;
    var update = false;

    if (pendingTxids.length > 0) {
      term.log(`Updating ^C${pendingTxids.length}^ pending orders`);
      let pendingOrders = await this.client.requestOrdersByTxid(pendingTxids);
      for (const order of pendingOrders) {
        if (order.isClosed && this.strategyOrders.pending.includes(order.txid)) {
          update = this.#findAndReplaceOrder(order.txid, 'executed');
          if (update) term.log(`Order [^c${order.txid}^:] status ^gupdated`);
          else term.error(`Update failed: ${order.txid}`);
        }
      }
      return update;
    }
    return update;
  }

  async decide() {
    var term = Terminal.instance;
    this.dateNow = new Date();
    this.clearFlags();

    var client = this.bot.getClient(this.botSettings.account);
    this.currentPrice = client.getPrice(this.pairData.id);

    this.statusMessages = [];
    this.actions = [];

    term.log('\r');
    term.warning(`--- [${this.botId}]: ${this.botSettings.strategyType} ${this.botSettings.options.type} plan ---`);
    term.setIndentString(' | ');
    term.log(
      `Bot [^c${this.botId}^] has ^g${this.strategyOrders.executed.length}^ executed orders, ^y${this.strategyOrders.pending.length}^ pending orders, ^c${this.strategyOrders.planned.length}^ planned orders`,
    );

    if (await this.updatePendingOrders()) {
      this.saveHistory();
    }

    var plannedOrders = await this.getPlannedOrders();

    this.lastOrder = plannedOrders
      .filter((o) => o.status === 'executed')
      .sort((a, b) => a.order.closeDate.getTime() - b.order.closeDate.getTime())
      .at(-1);

    if (this.botSettings.active && this.hasNoPlannedOrders(plannedOrders)) {
      if (!this.checkStatus(plannedOrders)) {
        term.setIndent(0);
        return { botId: this.botId, status: `${this.botId}: no orders in plan.` };
      }
    }

    for (let i = 0; i < plannedOrders.length; i++) {
      let plannedOrder = plannedOrders[i];
      let exchangeOrder = plannedOrder.order;

      if (plannedOrder.status === 'planned') {
        this.processPlannedOrder(plannedOrder);
      } else if (plannedOrder.status === 'pending' && exchangeOrder.isOpen) {
        this.processPendingOrder(plannedOrder);
      } else if (plannedOrder.status === 'executed' && !exchangeOrder.isOpen) {
        this.processExecutedOrder(plannedOrder);
      } else {
        term.printObject(plannedOrder);
        term.printObject(exchangeOrder);
        term.error(`Unexpected branch for ${this.botId}`);
      }
    }

    this.checkDealFlags();

    var response;
    if (this.actions.length > 0) {
      for (const action of this.actions) {
        response = await this.awaitConfirmation(action, (order) => this.#findAndDeleteOrder(order.txid));
      }
    }

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };
    term.setIndent(0);
    return this.lastResult;
  }

  /**
   * @param {string} statusFilter
   * @returns {Promise<EcaOrder[]>}
   */
  async getPlannedOrders(statusFilter = undefined) {
    var data = [];
    for (let [status, orders] of Object.entries(this.strategyOrders)) {
      if (statusFilter !== undefined && statusFilter !== status) continue;
      for (let orderTxid of orders) {
        try {
          if (status === 'lastCheck') continue;

          let order;
          if (status !== 'planned') {
            if (this.client.hasLocalOrder(orderTxid)) order = this.client.getLocalOrder(orderTxid);
            else order = await this.client.requestOrder(orderTxid);
          } else order = new ExchangeOrder(orderTxid.order);

          data.push(
            new EcaOrder(
              {
                id: orderTxid.id,
                botId: this.botId,
                account: this.client.id,
                strategy: this.botSettings.strategyType,
                volumeQuote: orderTxid.volumeQuote ?? order.volume * order.price + order.fees,
              },
              order,
            ),
          );
        } catch (ex) {
          continue;
        }
      }
    }
    return data;
  }

  /**
   * @param {EcaOrder[]} plannedOrders
   */
  checkStatus(plannedOrders) {
    var term = Terminal.instance;
    var requiresNewPlannedOrder = true;
    let hoursElapsed;
    let invalidHoursElapsed = false;
    let firstOrder = false;
    if (typeof this.lastOrder === 'undefined') {
      hoursElapsed = this.botSettings.options.frequency;
      term.log('This is the first plan');
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
      term.printObject(this.lastOrder ?? `No last order!`);
      term.error(`${this.botId}: invalid hours elapsed: ${hoursElapsed}`);
    } else {
      if (firstOrder) this.logStatus(`This is the first order`);
      else term.log(`^y${Utils.timeToHoursOrDaysText(hoursElapsed)}^ have elapsed since last ^c${this.pairData.base}^ order [^c${this.lastOrder.id}^:]`);
    }

    if (plannedOrders.every((order) => order.isExecuted)) {
      if (this.botSettings.options.type === 'recurring') {
        let ordersToday = plannedOrders.filter((o) => Utils.toShortDate(new Date(o.order.closeDate)) === Utils.toShortDate(new Date(Date.now()))).length;

        if (ordersToday > 0) term.log(`Today ^g${ordersToday.toString()}^ orders were executed`);
        if (ordersToday >= this.botSettings.options.maxOrdersPerDay) requiresNewPlannedOrder = false;
      } else if (this.botSettings.options.type === 'monthly') {
        if (this.countOrdersInMonth(plannedOrders) >= 1) {
          term.warning(`${this.botId}: plan already executed for this month`);
          requiresNewPlannedOrder = true;
        }
      } else {
        requiresNewPlannedOrder = false;
      }
    } else requiresNewPlannedOrder = false;

    term.log(`[^c${this.botId}^:] ${requiresNewPlannedOrder ? `^grequires` : `^ydoes not require`}^ a new order`);

    if (requiresNewPlannedOrder) {
      var orders = this.planner.proposeNext(this.lastOrder);
      var newPlannedOrder = orders.pop();
      term.log(`New planned order ${newPlannedOrder.toString()}`);
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
    var term = Terminal.instance;

    for (const [key, order] of this.flags) {
      var orderValid = typeof order != 'undefined';
      if (!orderValid) continue;

      switch (key) {
        case 'submitPlannedBuyOrder':
          break;

        case 'requiresNewPlannedOrder':
          this.strategyOrders.planned.push(order);
          this.saveHistory();
          break;

        case 'replacePendingOrder':
          this.actions.push(this.replaceAction(order));
          break;

        default:
          term.warning(`Unrecognised flag: ${key}`);
          continue;
      }

      if (this.canSubmit(order)) {
        var action = this.decideAction(order, this.currentPrice);
        if (typeof action === 'undefined') {
          term.printObject(order);
          term.error(`Invalid action in ${this.botId} [${key}]`);
        }
        this.actions.push(action);
      } else {
        if (order.isActive) term.log(`[^c${order.id}^:] is already planned or active`);
        else term.log(`[^c${order.id}^:] cannot be submitted`);
      }
    }
  }

  /**
   *
   * @param {EcaOrder} order
   */
  canSubmit(order) {
    var balanceCheck = this.balanceCheck(order.volumeQuote);
    return balanceCheck && order.isPastExecutionDate;
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPlannedOrder(plannedOrder) {
    var term = Terminal.instance;
    if (typeof plannedOrder === 'undefined') {
      term.error(`Invalid order in ${this.botId}`);
    }

    term.log(`Processing planned order ${plannedOrder.id}`);
    var hoursElapsed = plannedOrder.hoursElapsed(this.dateNow, false);
    var submitPlannedBuyOrder = this.dateNow > plannedOrder.order.openDate;

    if (submitPlannedBuyOrder) {
      if (isNaN(hoursElapsed)) Terminal.error(`Invalid time delta: ${plannedOrder.order.openDate} - ${hoursElapsed}`);
      term.log(`[^c${plannedOrder.id}^] needs to be executed ^R${Utils.timeToHoursOrDaysText(hoursElapsed)}^ past.`);
      this.setFlag({ submitPlannedBuyOrder }, plannedOrder);
    } else {
      term.log(
        `No actions need to be taken now. Next action in: ^Y${Utils.timeToHoursOrDaysText(hoursElapsed)}^ (^y${Utils.toShortDate(plannedOrder.order.openDate)} ${Utils.toShortTime(plannedOrder.order.openDate)}^:)`,
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
    if (waitDate.getFullYear() == 1970) Terminal.error(`Wrong date: ${Utils.toShortDate(waitDate)} - plan.date: ${plannedOrder.order.openDate}`);

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
    var term = Terminal.instance;
    var action;
    const maxPrice = this.botSettings.maxPrice;
    var test = false;

    if (currentPrice > maxPrice) {
      term.log(`[^c${plannedOrder.id}^]: above max price, setting limit to ^r${maxPrice}`);
      action = this.limitBuyAction(plannedOrder, currentPrice);
    } else action = this.marketBuyAction(plannedOrder, currentPrice);

    term.log(`Order planned for today or past due? ^y${plannedOrder.isScheduledForToday || plannedOrder.isPastExecutionDate ? 'yes' : 'no'}`);
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

    ecaOrder.order.cost = ecaOrder.order.volume * currentPrice;
    ecaOrder.order.fees = ecaOrder.order.cost * (ecaOrder.order.type === 'market' ? this.pairData.takerFees : this.pairData.makerFees);

    ecaOrder.order.side = 'buy';
    ecaOrder.order.price = currentPrice;

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

    Terminal.log(
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
    var term = Terminal.instance;
    var client = this.bot.getClient(this.botSettings.account);
    term.log(`Rebuilding history for <^c${this.botId}^:>: ^Y${client.orders.size}^ orders to parse.`);

    var volumeQuote = this.botSettings.maxVolumeQuote;
    var lowerLimit = volumeQuote - tolerance * volumeQuote;
    var upperLimit = volumeQuote + tolerance * volumeQuote;
    term.log(`Search range: ${lowerLimit}-${upperLimit} ${this.botSettings.quote}`);

    var orders = [];
    var leftOutOrders = [];

    client.orders.forEach((order) => {
      if (order.pair !== this.botSettings.pair) return;
      if (this.strategyOrders.pending.includes(order.txid) || this.strategyOrders.executed.includes(order.txid)) orders.push(order);
      else if ((order.isClosed && order.cost >= lowerLimit && order.cost <= upperLimit) || order.isOpen) orders.push(order);
      else {
        let txid = order.txid;
        let cost = order.cost;
        leftOutOrders.push({ [txid]: cost });
      }
    });

    term.log(`Qualifying orders: ^G${orders.length.toString()}`);
    term.log(`Left out orders  : ^R${leftOutOrders.length.toString()}`);

    /** @type {StrategyOrders} */
    var result = Object.groupBy(orders, ({ status }) => EcaOrder.StatusFromExchangeOrder(status));
    Object.entries(result).forEach(([k, array]) => (result[k] = array.map((order) => order.txid)));
    result['lastCheck'] = new Date().toISOString();
    let filename = this.botId.replace('/', '-');
    App.writeFile(`${App.DataPath}/${client.type}/${this.botSettings.fileId}`, result);
  }

  saveHistory() {
    Terminal.log(`^GUpdating^ ^C${this.botSettings.fileId}`);
    this.strategyOrders['lastCheck'] = new Date().toISOString();
    App.writeFile(`${App.DataPath}/${this.botSettings.account}/${this.botSettings.fileId}`, this.strategyOrders);
  }

  /**
   *
   * @param {string} txid
   * @param {string} toArray
   * @param {string} [newTxid]
   * @returns {Boolean}
   */
  #findAndReplaceOrder(txid, toArray, newTxid = undefined) {
    var term = Terminal.instance;
    var data = Object.entries(this.strategyOrders);
    var found = false;
    for (const [type, orders] of data) {
      if (orders.constructor !== Array) continue;

      let index = orders.indexOf(txid);
      if (index != -1) {
        orders.splice(index, 1);
        found = true;
      }
    }

    var orderTxid = newTxid ?? txid;
    if (found) this.strategyOrders[toArray].push(orderTxid);
    return found;
  }

  #findAndDeleteOrder(txid) {
    var data = Object.entries(this.strategyOrders);
    var found = false;

    for (const [type, orders] of data) {
      if (orders.constructor !== Array) continue;

      let index = orders.indexOf(txid);
      orders.splice(index, 1);
      found = true;
    }

    if (found) Terminal.log(`Order ${txid} ${redBright(`removed`)}`);
    else Terminal.error(`Order ${txid} not found in history!`, false);

    return found;
  }
}
