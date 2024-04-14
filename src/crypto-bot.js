import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import App from './app.js';
import fs from 'fs';
import EcaOrder from './data/eca-order.js';
import KrakenClient from './services/kraken.js';
import CoinbaseClient from './services/coinbase.js';
import EcaStacker from './strategies/eca-stacker.js';
import PairData from './data/pair-data.js';
import BotSettings from './data/bot-settings.js';
import ClientBase from './services/client.js';
import Action from './data/action.js';
import ExchangeOrder from './data/exchange-order.js';
import EcaTrader from './strategies/eca-trader.js';
import TelegramCryptoBot from './services/telegram-bot.js';
import Strategy from './strategies/strategy.js';
import Utils from './utils.js';

export default class CryptoBot {
  #settings = {};
  /**
   * @type {Map<string, EcaOrder>}
   */
  #plannedOrders = new Map();
  #priceData = new Map();
  #clients = {};
  #activeBots = [];
  /**
   * @type {TelegramCryptoBot}
   */
  telegramBot;

  constructor() {
    this.loadSettings();
    this.loadPlannedOrders();
    Object.keys(this.#settings.accounts).forEach((accountId) => {
      var accountSettings = this.getAccountSettings(accountId);
      accountSettings.id = accountId;
      switch (accountSettings.type.toLowerCase()) {
        case 'kraken':
          if (accountSettings.active) this.#clients[accountId] = new KrakenClient(accountSettings);
          break;

        case 'coinbase':
          if (accountSettings.active) this.#clients[accountId] = new CoinbaseClient(accountSettings);
          break;

        default:
          App.error(`${accountId}: invalid exchange.`);
          break;
      }
    });

    Object.keys(this.#settings.services).forEach((serviceId) => {
      switch (serviceId) {
        case 'telegram': {
          this.telegramBot = new TelegramCryptoBot(this.#settings.services.telegram);
          this.telegramBot.onMessage(this.handleMessages.bind(this));
          break;
        }
        default:
          App.error(`${serviceId}: invalid service.`);
          break;
      }
    });

    this.#activeBots = [...Object.keys(this.#settings.bots)];
  }

  /**
   * @returns {string}
   */
  get appCurrency() {
    return this.#settings.locale.currency ?? 'eur';
  }

  getClientSettings() {
    var data = {};
    Object.values(this.#settings.accounts).forEach((account) => {
      data[account.id] = {
        watchBalance: account.watchBalance,
        showDealPreview: account.showDealPreview,
        tradeBalance: account.tradeBalance,
        purchaseHistory: account.purchaseHistory,
        strategy: account.strategyType,
      };
    });

    return data;
  }

  getLocalSettings() {
    return this.#settings.locale;
  }

  getServerPort() {
    return this.#settings.serverPort;
  }

  getTraderBotIds() {
    return Object.values(this.#settings.bots).filter((bot) => bot.strategyType === 'eca-trader');
  }

  /**
   *
   * @param {string} id
   * @returns {AccountSettings}
   */
  getAccountSettings(id) {
    return this.#settings.accounts[id];
  }

  /**
   *
   * @param {string} accountId
   * @returns {ClientBase}
   */
  getClient(accountId) {
    var accountClient = this.#clients[accountId];
    if (typeof accountClient === 'undefined') App.error(`Unknown account ${accountId}`);
    return accountClient;
  }

  /**
   * @param {string} id
   * @param {EcaOrder} plannedOrder
   */
  setPlannedOrder(id, plannedOrder) {
    this.#plannedOrders.set(id, plannedOrder);
  }

  /**
   *
   * @param {EcaOrder[]} orders
   */
  addPlannedOrders(orders) {
    if (typeof orders === 'undefined') App.error('Attempted to add empty EcaOrder');
    orders.forEach((order) => this.setPlannedOrder(order.id, order));
  }

  /**
   *
   * @param {EcaOrder} order
   */
  deletePlannedOrder(order) {
    if (typeof order === 'undefined' || !this.hasPlannedOrder(order.id)) App.error('Attempted to remove unknown EcaOrder');
    this.#plannedOrders.delete(order.id);
  }

  setPrice(pair, price) {
    this.#priceData.set(pair, Number(price));
  }

  getPrice(pair) {
    let price = this.#priceData.get(pair);
    if (typeof price === 'undefined') {
      let message = `Price for ${pair} not found`;
      App.printObject(this.#priceData);
      App.error(message);
    }
    return price;
  }

  async downloadOrders(account = null) {
    var promises = [];
    var accountsToCheck = [];
    if (account === null) accountsToCheck = Object.entries(this.#clients);
    else accountsToCheck.push([account, this.#clients[account]]);

    accountsToCheck.forEach(([key, client]) => {
      promises.push(client.downloadOrders('open').then(() => (this.#settings.lastOpendOrderCheck = new Date(Date.now()))));
      promises.push(client.downloadOrders('closed').then(() => (this.#settings.lastClosedOrderCheck = new Date(Date.now()))));
      promises.push(client.requestBalance());
    });

    return Promise.all(promises);
  }

  async updatePricesSync() {
    var pairMap = new Map();

    Object.entries(this.#settings.bots).forEach(([botId, botSettings]) => {
      if (!pairMap.has(botSettings.account)) {
        pairMap.set(botSettings.account, []);
      }
      let accountClient = this.getClient(botSettings.account);
      pairMap.get(botSettings.account).push(accountClient.getPairId(botSettings));
    });

    var promises = [];

    [...pairMap.entries()].forEach(([key, tickers]) => {
      var promise = this.#clients[key].requestTickers(tickers).then((response) => this.updateTickers(response));
      promises.push(promise);
    });

    return Promise.allSettled(promises);
  }

  updateTickers(data) {
    for (const [key, price] of Object.entries(data)) {
      let pair = PairData.Get(key);
      if (typeof pair === 'undefined') {
        App.warning(`Pair ${pair} not found`);
        pair = key;
      }
      this.setPrice(pair, Number(price));
    }
  }

  updatePlanSchedule() {
    App.log('Updating plan file');
    var data = {};

    for (let [key, value] of this.#plannedOrders) {
      data[key] = value.toJSON();
    }
    App.writeFile(`${App.DataPath}/crypto-bot-orders`, data);
  }

  listMissingLocalOrders() {
    let data = this.getPlannedOrders('all');
    var missingOrders = new Map();
    Object.keys(this.#clients).forEach((account) => missingOrders.set(account, []));
    var filtered = data
      .filter((order) => order.status === 'executed' && !this.getClient(order.account).hasLocalExchangeOrder(order.txid))
      .forEach((order) => {
        missingOrders.get(order.account).push(order.txid);
      });

    return missingOrders;
  }

  /**
   *
   * @param {string} botId
   * @returns {EcaOrder[]}
   */
  getPlannedOrders(botId) {
    let data = [...this.#plannedOrders.values()];
    if (botId === 'all') return data;
    else return data.filter((entry) => entry.botId === botId);
  }

  /**
   *
   * @param {string} id
   * @returns {EcaOrder | null}
   */
  getPlannedOrder(id) {
    if (!this.#plannedOrders.has(id)) {
      App.warning(`Planned order ${id} not found`);
      return null;
    }

    return this.#plannedOrders.get(id);
  }

  /**
   *
   * @param {string} id
   * @returns
   */
  hasPlannedOrder(id) {
    return this.#plannedOrders.has(id);
  }

  /**
   *
   * @param {string} txid
   * @param {string} botId
   * @returns {EcaOrder | undefined}
   */
  getPlannedOrderByTxid(txid, botId = undefined) {
    var orders;
    if (typeof botId !== 'undefined') orders = this.getPlannedOrders(botId);
    else orders = this.getPlannedOrders('all');

    return orders.find((o) => o.txid === txid);
  }

  /**
   *
   * @param {string} id
   * @param {string} account
   * @returns
   */
  getExchangeOrderFromPlannedOrderId(id, account) {
    var accountClient = this.getClient(account);
    return accountClient.getLocalOrder(this.getPlannedOrder(id).txid);
  }

  /**
   *
   * @param {string} botId
   * @returns {BotSettings}
   */
  getBotSettings(botId) {
    let botSettings = this.#settings.bots;
    if (typeof botId === 'undefined') App.error(`No settings found for ${botId}`);
    else return botSettings[botId];
  }

  hasBot(botId) {
    return typeof this.#settings.bots[botId] !== 'undefined';
  }

  getAllBots() {
    return this.#settings.bots;
  }

  selectPlanOrders(status) {
    return [...this.#plannedOrders.values()].filter((p) => p.status === status);
  }

  loadPlannedOrders() {
    App.log('Loading planned orders');
    var data = App.readFileSync(`${App.DataPath}/crypto-bot-orders.json`);
    this.#plannedOrders = new Map(Object.keys(data).map((key) => [key, new EcaOrder(data[key])]));
  }

  async loadSettings() {
    const file = `${App.DataPath}/settings.json`;
    this.#settings = App.readFileSync(file);
    this.#settings.bots = Object.fromEntries(Object.entries(this.#settings.bots).map(([botId, botData]) => [botId, new BotSettings(botId, botData)]));

    if (!fs.existsSync(`${App.DataPath}/exchanges/`)) {
      App.log(greenBright`Created 'exchanges' folder`);
      fs.mkdirSync(`${App.DataPath}/exchanges`, 0o755);
    }
    if (typeof this.#settings.locale !== 'undefined') App.locale = this.#settings.locale;
  }

  saveAllOrders(n = 100) {
    Object.entries(this.#clients).forEach(([id, accountClient]) => {
      let data = [...accountClient.orders.entries()].slice(-n);
      var dateNow = new Date(Date.now());
      let dataFiltered = {};

      for (const [key, order] of data) {
        var exchangeOrder = accountClient.convertResponseToExchangeOrder(order);

        let filter = exchangeOrder.openDate.getFullYear() === dateNow.getFullYear();
        if (filter) {
          dataFiltered[key] = order;
        }
      }
      accountClient.saveOrdersToFile(`${accountClient.id}-orders`, dataFiltered);
    });
  }

  async syncExchangeStatus(account) {
    return this.downloadOrders(account).then((response) => {
      if (response) this.checkPendingOrders();
      var missingOrders = this.listMissingLocalOrders();
      for (const [exchange, txidArray] of missingOrders) {
        if (txidArray.length > 0) this.getClient(exchange).downloadOrdersByTxid(txidArray);
      }

      App.writeFile('settings', this.#settings, (key, value) => {
        if (key === 'strategy' && value instanceof Strategy) {
          return value.botSettings.strategyType;
        }
        if (key === 'strategyType') return undefined;
        return value;
      });
      return true;
    });
  }
  async simulateResponse() {
    var cbClient = this.getClient('coinbase');
    var po = this.getPlannedOrder('doge/eur-0002');
    var action = Action.OrderToAction(po, cbClient.getPairData(po.pair));
    var txinfo = await cbClient.updatePlannedOrder(po, action);
    this.updatePlanSchedule();
    console.log(txinfo);
  }

  async checkPendingOrders() {
    App.log(greenBright`Checking pending orders`, true);
    let pendingPlannedOrders = [...this.#plannedOrders.values()].filter((entry) => entry.status === 'pending');
    let updateFile = false;

    for (let i = 0; i < pendingPlannedOrders.length; i++) {
      let plannedOrder = pendingPlannedOrders[i];

      let accountClient = this.getClient(plannedOrder.account);
      let botSettings = this.getBotSettings(plannedOrder.botId);
      let exchangeOrder = await accountClient.getExchangeOrder(plannedOrder.txid);
      let check = await accountClient.checkPendingOrder(plannedOrder, exchangeOrder);

      App.log(`CPO: ${plannedOrder.id}`);
      if (check.result) {
        switch (check.newStatus) {
          case 'executed': {
            let message = `[${greenBright`${plannedOrder.id}`}]: order ${greenBright`filled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale)} for ${Number(exchangeOrder.price).toFixed(2)} (${Number(exchangeOrder.cost).toFixed(2)} ${botSettings.quoteCurrency})`;
            App.log(message, true);
            this.telegramBot.log(message);
            updateFile = true;
            break;
          }

          case 'cancelled': {
            let message = `[${greenBright`${plannedOrder.id}`}]: order ${redBright`cancelled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale)}`;
            App.warning(message);
            this.deletePlannedOrder(plannedOrder);
            updateFile = true;
            break;
          }

          default:
            App.warning(`CPO: ${check.newStatus}`);
        }
      }
    }

    if (updateFile) this.updatePlanSchedule();
    return updateFile;
  }

  resetPlannedOrder(order) {
    order.status = 'planned';
    order.txid = '';
    this.updatePlanSchedule();
  }

  /**
   *
   * @param {Action} action
   * @returns {Promise<ExchangeOrder|any>}
   */
  async processAction(action) {
    if (typeof action === 'undefined') throw new Error('Action is undefined');

    var response;
    var order = this.getPlannedOrder(action.id);
    if (typeof order === 'undefined') throw new Error(`Cannot find order ${action.id}`);
    var accountClient = this.getClient(action.account);

    response = await accountClient.processActionSync(action);
    if (typeof response === 'undefined') throw new Error(redBright`No response!`);

    switch (action.command) {
      case 'editOrder':
      case 'submitOrder': {
        if (action.isTest) {
          return;
        }

        order.txid = accountClient.getTxidFromResponse(response);
        let promise = accountClient.updatePlannedOrder(order, action).then((txinfo) => {
          if (typeof txinfo === 'undefined') {
            this.telegramBot.log(`Unexpected error when updating ${order.id}`);
            return;
          } else {
            this.telegramBot.log(
              `[${action.id}] submitted ${action.type} order ${action.direction} at ${txinfo.price} (${txinfo.cost.toFixed(2)} €) on ${action.account}`,
            );

            if (txinfo.status === 'open') accountClient.downloadOrders('open');
            this.updatePlanSchedule();
            return txinfo;
          }
        });

        return promise;
      }

      case 'cancelOrder':
        App.log(redBright`[${order.id}] cancelled ${action.account} order ${order.txid}`);
        return response;
    }
  }

  async processPlans() {
    var dateNow = new Date(Date.now());
    var dateLastCheck = new Date(this.#settings.lastClosedOrderCheck);
    var deltaTime = Math.abs(dateLastCheck.getTime() - dateNow.getTime()) / 3600000;

    if (deltaTime > 0.5) {
      // Update closed orders
      App.log(`Closed orders check: ${(deltaTime * 60).toFixed(2)} minutes ago > ${yellowBright`updating now}`}`, true);
      await this.syncExchangeStatus().then(() => App.log('Update complete.'));
    } else App.log(`Last check: ${(deltaTime * 60).toFixed(2)} minutes ago > proceeding`);

    var promises = [];

    this.#activeBots.forEach((botId) => {
      var botSettings = this.getBotSettings(botId);
      if (botSettings == null) {
        App.warning(`${botId}: invalid strategy`);
        return;
      }

      var shouldCheck = false;
      switch (botSettings.strategyType) {
        case 'eca-stacker':
          if (typeof botSettings.strategy === 'undefined') botSettings.strategy = new EcaStacker(this, botSettings.id);
          shouldCheck = botSettings.strategy.hasActiveOrders() || botSettings.strategy.requiresNewPlannedOrder();
          break;
        case 'eca-trader':
          if (typeof botSettings.strategy === 'undefined') botSettings.strategy = new EcaTrader(this, botSettings.id);
          shouldCheck = botSettings.strategy.hasActiveOrders();
          break;
      }
      if (shouldCheck) {
        promises.push(botSettings.strategy.decide());
      } else {
        App.warning(`${botId}: no active orders`);
      }
    });

    return Promise.all(promises);
  }

  async handleMessages(message) {
    var commandArguments = message.text.toLowerCase().split(' ');
    const command = commandArguments[0];
    const parameter = commandArguments[1];
    switch (command) {
      case 'status': {
        if (!this.hasBot(parameter)) return this.telegramBot.log(`Bot ${parameter} not found`);
        let botSettings = this.getBotSettings(parameter);
        return this.telegramBot.log(botSettings.strategy?.lastResult?.status || 'none');
      }

      case 'next': {
        let reports = this.getPlannedOrders('all')
          .filter((o) => o.isScheduledForToday && !o.isClosed && Utils.toShortDate(o.openDate) === Utils.toShortDate(new Date(Date.now())))
          .sort((a, b) => a.openDate.getTime() - b.openDate.getTime())
          .map((o) => o.toString());

        if (reports.length > 0) return this.telegramBot.log(reports.join('\n'));
        else return this.telegramBot.log('No orders planned for today');
      }

      default:
        return this.telegramBot.respond(message);
    }
  }

  /**
   *
   * @param {Action[]} actions
   * @returns {Promise<ExchangeOrder[]|any>}
   */
  async executeActions(actions) {
    if (actions.length == 0) return 'Nothing to do';
    var responses = [];
    for (let i = 0; i < actions.length; i++) {
      let action = actions[i];
      App.log(`${[action.id]}: ${action.command}`);

      switch (action.command) {
        case 'submitOrder':
        case 'editOrder':
          responses.push(this.processAction(action));
          break;

        case 'cancelOrder':
          responses.push(this.processAction(action));
          break;

        default:
          App.printObject(action);
          App.error(`Unknown action: ${action.command}`);
          break;
      }
    }
    return Promise.all(responses);
  }
}
