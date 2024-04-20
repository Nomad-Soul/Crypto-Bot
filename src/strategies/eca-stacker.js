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
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    super(bot, botId);
    if (typeof bot === 'undefined') throw new Error('Invalid argument: bot');

    this.botSettings = bot.getBotSettings(botId);
    this.planner = new EcaPlanner(botId, this.botSettings);
  }

  /**
   *
   * @returns
   */
  hasActiveOrders() {
    return this.bot.getPlannedOrders(this.botId).some((order) => {
      return (order.status === 'planned' && order.isScheduledForToday) || order.isActive;
    });
  }

  hasNoPlannedOrders() {
    return this.bot.getPlannedOrders(this.botId).every((order) => order.isClosed);
  }

  async decide() {
    this.dateNow = new Date(Date.now());
    var accountClient = this.bot.getClient(this.botSettings.account);
    var plannedOrders = this.bot.getPlannedOrders(this.botId);
    this.currentPrice = this.bot.getPrice(this.pairData.id);

    this.statusMessages = [];
    this.actions = [];

    this.logStatus(`Processing [${cyanBright`${this.botId}`}]: ${this.botSettings.options.type}`, 'infoTimestamp');
    this.logStatus(
      `Plan for ${yellowBright`${this.botId}`} has ${cyanBright`${plannedOrders.filter((o) => o.status === 'executed').length.toString()}`} executed orders, ${yellowBright`${plannedOrders.filter((o) => o.isPlanned).length.toString()}`} planned orders, ${yellowBright`${plannedOrders.filter((o) => o.isActive).length.toString()}`} pending orders`,
    );
    this.lastOrder = plannedOrders.filter((o) => o.status === 'executed').at(-1);

    if (plannedOrders.length == 0) {
      return { botId: this.botId, status: `${this.botId}: no orders in plan.` };
    }

    for (let i = 0; i < plannedOrders.length; i++) {
      let plannedOrder = plannedOrders[i];
      let exchangeOrder = typeof plannedOrder.txid === 'undefined' ? null : await accountClient.getExchangeOrder(plannedOrder.txid);

      if (plannedOrder.status === 'planned' && exchangeOrder == null) {
        this.processPlannedOrder(plannedOrder);
      } else if (plannedOrder.status === 'pending' && exchangeOrder != null && exchangeOrder.isOpen) {
        this.processPendingOrder(plannedOrder);
      } else if (plannedOrder.status === 'executed' && exchangeOrder != null && !exchangeOrder.isOpen) {
        this.processExecutedOrder(plannedOrder);
      } else {
        this.logStatus('Unexpected branch.', 'warning');
        App.printObject(plannedOrder);
        App.printObject(exchangeOrder);
      }
    }

    this.checkStatus(plannedOrders);
    this.checkDealFlags();

    var response;
    if (this.actions.length > 0) response = this.bot.executeActions(this.actions);

    this.lastResult = { botId: this.botId, flags: Object.keys(Object.fromEntries(this.flags)), status: this.statusMessages.join('\n') };

    return this.lastResult;
  }

  /**
   * @param {EcaOrder[]} plannedOrders
   */
  checkStatus(plannedOrders) {
    var requiresNewPlannedOrder = true;
    let hoursElapsed;
    if (typeof this.lastOrder === 'undefined') {
      hoursElapsed = this.botSettings.options.frequency;
      this.logStatus('This is the first plan');
    } else if (this.lastOrder.status === 'executed') {
      hoursElapsed = this.lastOrder.hoursElapsed(this.dateNow);
      this.logStatus(
        `${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} have elapsed since last ${cyanBright`${this.pairData.base}`} order [${cyanBright`${this.lastOrder.id}`}]`,
      );
    }

    if (isNaN(hoursElapsed)) {
      requiresNewPlannedOrder = false;
      App.error(`${this.botId}: invalid hours elapsed: ${hoursElapsed}`);
    }

    if (plannedOrders.every((order) => order.isClosed)) {
      if (this.botSettings.options.type === 'recurring') {
        let ordersToday = this.bot
          .getPlannedOrders(this.botId)
          .filter((o) => Utils.toShortDate(new Date(o.closeDate)) === Utils.toShortDate(new Date(Date.now()))).length;

        if (ordersToday > 0) App.log(`Today ${cyanBright`${ordersToday.toString()}`} orders for ${cyanBright`${this.botId}`} were executed`);
        if (ordersToday >= this.botSettings.options.maxOrdersPerDay) requiresNewPlannedOrder = false;
      } else if (this.botSettings.options.type === 'monthly') {
        let ordersThisMonth = this.bot.getPlannedOrders(this.botId).filter((o) => o.closeDate.getMonth() == this.dateNow.getMonth()).length;
        if (ordersThisMonth >= 1) {
          App.warning(`${this.botId}: plan already executed for this month`);
          requiresNewPlannedOrder = true;
        }
      } else {
        requiresNewPlannedOrder = false;
      }
    } else requiresNewPlannedOrder = false;

    this.logStatus(`[${cyanBright`${this.botId}`}] ${requiresNewPlannedOrder ? greenBright`requires` : redBright`does not require`} a new order`);
    if (requiresNewPlannedOrder) {
      var orders = this.planner.proposeNext(plannedOrders);
      var newPlannedOrder = orders.pop();
      this.logStatus(`New planned order ${newPlannedOrder.toString()}`);
      this.setFlag({ requiresNewPlannedOrder }, newPlannedOrder);
      this.bot.addPlannedOrders([newPlannedOrder]);
      this.bot.updatePlanSchedule();
    }
  }

  checkDealFlags() {
    for (const [key, order] of this.flags) {
      var orderValid = typeof order != 'undefined';
      if (!orderValid) continue;

      switch (key) {
        case 'submitPlannedBuyOrder':
        case 'requiresNewPlannedOrder':
          break;

        case 'replacePendingOrder':
          if (this.accountClient.hasLocalExchangeOrder(order.txid)) this.actions.push(Action.CancelAction(order));
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
    var isToday = order.isScheduledForToday && order.status === 'planned';

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
    var submitPlannedBuyOrder = this.dateNow > plannedOrder.openDate;

    if (submitPlannedBuyOrder) {
      if (isNaN(hoursElapsed)) App.error(`Invalid time delta: ${plannedOrder.openDate} - ${hoursElapsed}`);
      let message = `[${cyanBright`${plannedOrder.id}`}] needs to be executed ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} past.`;
      this.logStatus(message);
      this.setFlag({ submitPlannedBuyOrder }, plannedOrder);
    } else {
      this.logStatus(
        `[${this.botId}] No actions need to be taken now. Next action in: ${yellowBright`${Utils.timeToHoursOrDaysText(hoursElapsed)}`} (${yellowBright`${Utils.toShortDate(plannedOrder.openDate)}`} ${Utils.toShortTime(plannedOrder.openDate)})`,
      );
    }
  }

  /**
   *
   * @param {EcaOrder} plannedOrder
   */
  processPendingOrder(plannedOrder) {
    this.logStatus(yellowBright`[${plannedOrder.id}] still pending at ${Utils.toShortTime(this.dateNow)}`);

    let waitDate = new Date(plannedOrder.openDate);
    waitDate.setHours(23, 30, 0);
    if (waitDate.getFullYear() == 1970) App.error(`Wrong date: ${Utils.toShortDate(waitDate)} - plan.date: ${plannedOrder.openDate}`);

    this.logStatus(`${greenBright`Waiting`} until ${Utils.toShortDate(waitDate)} ${yellowBright`${Utils.toShortTime(waitDate)}`}`);

    var replacePendingOrder = new Date(Date.now()) >= waitDate;

    if (replacePendingOrder) {
      this.logStatus('Pending order can be executed');
      plannedOrder.type = 'market';
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
      action = this.limitBuyAction(plannedOrder, currentPrice, test);
    } else action = this.marketBuyAction(plannedOrder, currentPrice, test);

    App.log(`Order planned for today? ${yellowBright`${plannedOrder.isScheduledForToday ? 'yes' : 'no'}`}`);

    console.log(action);
    return action;
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {Number} currentPrice
   * @param {boolean} isTest
   * @returns {Action}
   */
  marketBuyAction(order, currentPrice, isTest = true) {
    order.type = EcaOrder.OrderTypes.market;
    order.volume = Number(order.volumeQuote / currentPrice);
    if (order.volume < this.pairData.minVolume) order.volume = this.pairData.minVolume;

    order.direction = 'buy';

    return Action.MarketAction(order, this.pairData, currentPrice);
  }

  /**
   *
   * @param {EcaOrder} order
   * @param {Number} currentPrice
   * @param {boolean} isTest
   * @returns
   */
  limitBuyAction(order, currentPrice, isTest = true) {
    const maxPrice = this.botSettings.maxPrice;

    order.type = EcaOrder.OrderTypes.limit;

    if (currentPrice > maxPrice) {
      order.price = maxPrice;
    }

    order.volume = Number(order.volumeQuote / currentPrice);

    App.log(
      `Cost: ${order.volumeQuote.toFixed(this.pairData.maxQuoteDigits)} Price: ${currentPrice.toFixed(this.pairData.maxQuoteDigits)} -> Volume: ${order.volume.toFixed(this.pairData.maxBaseDigits)}`,
    );

    if (order.volume < this.pairData.minVolume) {
      order.volume = this.pairData.minVolume;
    }

    order.volumeQuote = order.volume * currentPrice;
    return Action.LimitAction(order, this.pairData);
  }
}
