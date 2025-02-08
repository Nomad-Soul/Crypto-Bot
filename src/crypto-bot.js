import { yellowBright, cyanBright, redBright, greenBright, magentaBright } from 'ansis';
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
import ExchangeClient from './services/exchange-client.js';


export default class CryptoBot {

  /**
   * @type {import ('./types.js').Settings}
   */
  #settings = {};
  // /**
  //  * @type {Map<string, EcaOrder>}
  //  */
  //#plannedOrders = new Map();
  #clients = {};
  #activeBots = [];
  /**
   * @type {TelegramCryptoBot}
   */
  telegramBot;

  /** @type {ExchangeClient} */
  ccxtClient;

  constructor() {
    this.loadSettings();
    Object.keys(this.#settings.accounts).forEach((accountId) => {
      var accountSettings = this.getAccountSettings(accountId);
      accountSettings.id = accountId;
      switch (accountSettings.type.toLowerCase()) {
        case 'kraken':
        case 'coinbase':
          this.#clients[accountId] = new ExchangeClient(accountSettings);
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

    Object.values(this.#settings.bots).forEach(bot => {
      switch (bot.strategyType) {
        case 'eca-stacker':
          bot.strategy = new EcaStacker(this, bot.id);
          break;
        case 'eca-trader':
          bot.strategy = new EcaTrader(this, bot.id);
          break;
      }
      if (bot.active)
        this.#activeBots.push(bot.id);
    });
  }

  async rebuildHistory(account = null, refresh = false) {
    var promises = [];
    var accountsToCheck = [];

    if (account === null) accountsToCheck = Object.entries(this.#clients);
    else accountsToCheck.push([account, this.#clients[account]]);

    if (refresh) {
      // Download all orders
      accountsToCheck.forEach((/** @type {[string, ClientBase]} */ [key, client]) => {
        promises.push(client.rebuildHistory());
      });
    }
    return this.recoverDeals();
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
        stackingHistory: account.stackingHistory,
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
    return Object.values(this.#settings.bots)
      .filter((bot) => bot.strategyType === 'eca-trader')
      .map((botSettings) => botSettings.id);
  }

  /**
   *
   * @param {string} id
   * @returns {import('./types.js').AccountSettings}
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
   * @param {string} accountId 
   * @returns {boolean}
   */
  hasActiveClient(accountId) {
    var accountClient = this.#clients[accountId];
    if (typeof accountClient === 'undefined' || !accountClient.active) 
      return false;
    else return true;
  }

  // /**
  //  * @param {string} id
  //  * @param {EcaOrder} plannedOrder
  //  */
  // setPlannedOrder(id, plannedOrder) {
  //   this.#plannedOrders.set(id, plannedOrder);
  // }

  // /**
  //  *
  //  * @param {EcaOrder[]} orders
  //  */
  // addPlannedOrders(orders) {
  //   if (typeof orders === 'undefined') App.error('Attempted to add empty EcaOrder');
  //   orders.forEach((order) => this.setPlannedOrder(order.id, order));
  // }

  // /**
  //  *
  //  * @param {EcaOrder} order
  //  */
  // deletePlannedOrder(order) {
  //   if (typeof order === 'undefined' || !this.hasPlannedOrder(order.id)) App.error('Attempted to remove unknown EcaOrder');
  //   this.#plannedOrders.delete(order.id);
  // }

  async downloadOrders(account = null) {
    var promises = [];
    /** @type {[string, ClientBase][]} */ 
    var accountsToCheck = [];
    if (account === null) accountsToCheck = Object.entries(this.#clients);
    else accountsToCheck.push([account, this.#clients[account]]);

    accountsToCheck.filter(([key, client])=> client.active)
      .forEach(([key, client]) => {
        promises.push(client.requestOrdersByStatus('open', true).then(() => (this.#settings.lastOpenOrderCheck = new Date(Date.now()))));
        promises.push(client.requestOrdersByStatus('closed', true).then(() => (this.#settings.lastClosedOrderCheck = new Date(Date.now()))));
        promises.push(client.requestBalance());
      });

    return Promise.all(promises);
  }

  async updatePrices() {
    var pairMap = new Map();

    Object.entries(this.#settings.bots).forEach(([botId, botSettings]) => {
      if (!pairMap.has(botSettings.account)) {
        pairMap.set(botSettings.account, []);
      }
      let accountClient = this.getClient(botSettings.account);
      if (typeof(accountClient) !== 'undefined') {
        pairMap.get(botSettings.account).push(accountClient.getPairId(botSettings).toUpperCase());
      }
    });

    var promises = [];

    [...pairMap.entries()].forEach(([key, tickers]) => {
      let client = this.getClient(key);
      let promise = client.requestTickers(tickers).then((response) => client.updateTickers(response));
      promises.push(promise);
    });

    return Promise.allSettled(promises);
  }

  // updatePlanSchedule() {
  //   App.log('Updating plan file');
  //   var data = {};

  //   for (let [key, value] of this.#plannedOrders) {
  //     data[key] = value.toJSON();
  //   }
  //   App.writeFile(`${App.DataPath}/crypto-bot-orders`, data);
  // }

  listMissingLocalOrders() {
    let data = this.getPlannedOrders('all');
    var missingOrders = new Map();
    Object.keys(this.#clients).forEach((account) => missingOrders.set(account, []));
    var filtered = data
      .filter((order) => order.status === 'executed' && this.hasActiveClient(order.account) && !this.getClient(order.account).hasLocalExchangeOrder(order.txid))
      .forEach((order) => {
        missingOrders.get(order.account).push(order.txid ?? order.id);
        if (!order.txid)
          App.warning(`Order ${order.id} contains empty txid`);
      });

    return missingOrders;
  }

  // /**
  //  *
  //  * @param {string} botId
  //  * @returns {ExchangeOrder[]}
  //  */
  // getPlannedOrders(botId) {
  //   let data = [...this.#plannedOrders.values()];
  //   if (botId === 'all') return data;
  //   else return data.filter((entry) => entry.botId === botId);
  // }

  /**
   * 
   * @param {string} botId 
   * @returns {Map<string, ExchangeOrder[]>}
   */
  getPlannedOrders(botId = null) {
    var botsToCheck = [];
    if (botId == null) {
      botsToCheck = Object.keys(this.#settings.bots);
    }
    else {
      botsToCheck.push(botId);
    }

    var ordersByBot = new Map();
    for (botId in this.#settings.bots) {
      let bot = this.getBotSettings(botId);
      let client = this.getClient(bot.account);
      let orders = Array.from(client.orders.values());
      ordersByBot.set(botId, orders);
    }

    return ordersByBot;
  }
  // /**
  //  *
  //  * @param {string} id
  //  * @returns {EcaOrder | null}
  //  */
  // getPlannedOrder(id) {
  //   if (!this.#plannedOrders.has(id)) {
  //     App.warning(`Planned order ${id} not found`);
  //     return null;
  //   }

  //   return this.#plannedOrders.get(id);
  // }

  // /**
  //  *
  //  * @param {string} id
  //  * @returns
  //  */
  // hasPlannedOrder(id) {
  //   return this.#plannedOrders.has(id);
  // }

  // /**
  //  *
  //  * @param {string} txid
  //  * @param {string} botId
  //  * @returns {EcaOrder | undefined}
  //  */
  // getPlannedOrderByTxid(txid, botId = undefined) {
  //   var orders;
  //   if (typeof botId !== 'undefined') orders = this.getPlannedOrders(botId);
  //   else orders = this.getPlannedOrders('all');

  //   return orders.find((o) => o.txid === txid);
  // }

  // /**
  //  *
  //  * @param {string} id
  //  * @param {string} account
  //  * @returns
  //  */
  // getLocalExchangeOrderFromPlannedOrderId(id, account) {
  //   var accountClient = this.getClient(account);
  //   return accountClient.getLocalOrder(this.getPlannedOrder(id).txid);
  // }

  // async getExchangeOrderFromPlannedOrderId(id, account, redownload = false) {
  //   var accountClient = this.getClient(account);
  //   return accountClient.getExchangeOrder(this.getPlannedOrder(id).txid, redownload);
  // }

  // /**
  //  *
  //  * @param {string[]} ids
  //  * @param {string} account
  //  * @param {boolean} redownload
  //  */
  // async getExchangeOrdersFromPlannedOrderIds(ids, account, redownload = false) {
  //   var accountClient = this.getClient(account);

  //   var exchangeOrders = ids
  //     .map((id) => this.getPlannedOrder(id))
  //     .filter((order) => order.txid)
  //     .map((order) => accountClient.getExchangeOrder(order.txid, redownload));

  //   return Promise.all(exchangeOrders);
  // }

  // /**
  //  *
  //  * @param {string[]} ids
  //  * @param {string} account
  //  */
  // getLocalExchangeOrdersFromPlannedOrderIds(ids, account) {
  //   var accountClient = this.getClient(account);

  //   var exchangeOrders = ids
  //     .map((id) => this.getPlannedOrder(id))
  //     .filter((order) => order.txid)
  //     .map((order) => accountClient.getLocalOrder(order.txid));

  //   return exchangeOrders;
  // }

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

  /**
   * 
   * @returns {BotSettings[]}
   */
  getAllBots() {
    return this.#settings.bots;
  }

  // selectPlanOrders(status) {
  //   return [...this.#plannedOrders.values()].filter((p) => p.status === status);
  // }

  // loadPlannedOrders() {
  //   App.log('Loading planned orders');
  //   var data = App.readFileSync(`${App.DataPath}/crypto-bot-orders.json`);
  //   this.#plannedOrders = new Map(Object.keys(data).map((key) => [key, new EcaOrder(data[key])]));
  // }

  async loadSettings() {
    const settingsFile = `${App.DataPath}/settings.json`;
    
    if (!fs.existsSync(settingsFile)) {
      App.error(`No settings file found in ${App.DataPath}`);
    }

    this.#settings = App.readFileSync(settingsFile);
    this.#settings.bots = Object.fromEntries(Object.entries(this.#settings.bots).map(([botId, botData]) => [botId, new BotSettings(botId, botData)]));

    if (!fs.existsSync(`${App.DataPath}/exchanges/`)) {
      App.log(greenBright`Created 'exchanges' folder`);
      fs.mkdirSync(`${App.DataPath}/exchanges`, 0o755);
    }
    if (typeof this.#settings.locale !== 'undefined') App.locale = this.#settings.locale;
  }

  saveAllOrders(n = 50) {
    Object.entries(this.#clients).forEach(([id, accountClient]) => {
      let data = [...accountClient.orders.entries()].slice(-n);
      var dateNow = new Date(Date.now());
      let dataFiltered = {};

      for (const [key, order] of data) {
        try {
          let filter = order.openDate.getFullYear() === dateNow.getFullYear();
          if (filter) {
            dataFiltered[key] = order;
          }
        }
        catch (ex)
        {
          App.printObject(order);
          App.error(ex);
        }
      }
      accountClient.saveOrdersToFile(`${accountClient.id}-current-orders`, dataFiltered);
    });
  }

  /**
   * @param {string} [account]
   */
  async syncExchangeStatus(account) {
    return this.downloadOrders(account).then((response) => {
      // if (response) this.checkPendingOrders();
      // var missingOrders = this.listMissingLocalOrders();
      // for (const [exchange, txidArray] of missingOrders) {
      //   if (txidArray.length > 0) this.getClient(exchange).requestOrdersByTxid(txidArray);
      // }

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

  // async checkPendingOrders() {
  //   App.log(greenBright`Checking pending orders`, true);
  //   let pendingPlannedOrders = [...this.#plannedOrders.values()].filter((entry) => entry.status === 'pending');
  //   let updateFile = false;

  //   for (let i = 0; i < pendingPlannedOrders.length; i++) {
  //     let plannedOrder = pendingPlannedOrders[i];

  //     let accountClient;
  //     if (this.hasActiveClient(plannedOrder.account)) {
  //       accountClient = this.getClient(plannedOrder.account);
  //     }
  //     else continue;
  //     let botSettings = this.getBotSettings(plannedOrder.botId);
  //     let exchangeOrder = await accountClient.getExchangeOrder(plannedOrder.txid);
  //     let check = await accountClient.checkPendingOrder(plannedOrder, exchangeOrder);

  //     App.log(`CPO: ${plannedOrder.id}`);
  //     if (check.result) {
  //       switch (check.newStatus) {
  //         case 'executed': {
  //           let message = `[${greenBright`${plannedOrder.id}`}]: order ${greenBright`filled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale.id)} for ${Number(exchangeOrder.price).toFixed(2)} (${Number(exchangeOrder.cost).toFixed(2)} ${botSettings.quote})`;
  //           App.log(message, true);
  //           this.telegramBot.log(message);
  //           updateFile = true;
  //           break;
  //         }

  //         case 'cancelled': {
  //           let message = `[${greenBright`${plannedOrder.id}`}]: order ${redBright`cancelled`} at ${plannedOrder.closeDate.toLocaleTimeString(App.locale.id)}`;
  //           App.warning(message);
  //           this.deletePlannedOrder(plannedOrder);
  //           updateFile = true;
  //           break;
  //         }

  //         default:
  //           App.warning(`CPO: ${check.newStatus}`);
  //       }
  //     }
  //   }

  //   if (updateFile) this.updatePlanSchedule();
  //   return updateFile;
  // }

  // resetPlannedOrder(order) {
  //   order.status = 'planned';
  //   order.txid = '';
  //   this.updatePlanSchedule();
  // }

  /**
   *
   * @param {Action} action
   * @returns {Promise<ExchangeOrder|any>}
   */
  async processAction(action) {
    if (typeof action === 'undefined') throw new Error('Action is undefined');

    var response;
    var order = this.getPlannedOrder(action.order.id);
    if (typeof order === 'undefined') throw new Error(`Cannot find order in ${action.command}`);
    var accountClient = this.getClient(order.account);
    response = await accountClient.processAction(action);

    if (typeof response === 'undefined') throw new Error(redBright`No response!`);

    switch (action.command) {
      case 'editOrder':
      case 'submitOrder': {
        if (action.isTest) {
          return;
        }

        App.warning('Process Action');

        order.txid = accountClient.getTxidFromResponse(response);
        App.warning('Waiting 500 ms');
        await new Promise(resolve => setTimeout(resolve, 500));

        let promise = new Promise((resolve) => resolve(accountClient.updatePlannedOrder(order)))
          .then((txinfo) => {
            if (typeof txinfo === 'undefined') {
              this.telegramBot.log(`Unexpected error when updating ${order.id}`);
              return;
            } else {
              this.telegramBot.log(
                `[${order.id}] submitted ${order.type} order ${order.direction} at ${txinfo.price} (${txinfo.cost.toFixed(2)} €) on ${order.account}`,
              );

              if (txinfo.status === 'open') accountClient.requestOrdersByStatus('open');
              this.updatePlanSchedule();
              return txinfo;
            }
          });

        return promise;
      }

      case 'cancelOrder':
        App.log(redBright`[${order.id}] cancelled ${order.account} order ${order.txid}`);
        return response;
    }
  }

  async recoverDeals() {
    Object.values(this.#settings.bots).forEach((botSettings) => {
      switch (botSettings.strategyType) {
        case 'eca-stacker':
          if (this.getClient(botSettings.account) &&  typeof botSettings.strategy === 'undefined') {
            botSettings.strategy = new EcaStacker(this, botSettings.id);
            botSettings.strategy.rebuildHistory();
          }
          break;
      }
    });
  }

  async processPlans() {
    var dateNow = new Date(Date.now());
    var dateLastCheck = new Date(this.#settings.lastClosedOrderCheck);
    var deltaTime = Math.abs(dateLastCheck.getTime() - dateNow.getTime()) / 3600000;

    if (deltaTime > 0.5) {
      // Update closed orders
      App.log(`Closed orders check: ${(deltaTime * 60).toFixed(2)} minutes ago > ${yellowBright`updating now`}`, true);
      await this.syncExchangeStatus().then(() => App.log('Update complete.'));
    } else App.log(`Last check: ${(deltaTime * 60).toFixed(2)} minutes ago > proceeding`);

    var promises = [];

    this.#activeBots.forEach((botId) => {
      var botSettings = this.getBotSettings(botId);
      if (botSettings == null) {
        App.warning(`${botId}: invalid strategy`);
        return;
      }

      if(!this.getAccountSettings(botSettings.account).active) {
        App.warning(`Bot: ${botId} account ${botSettings.account} is not active.`);
        return;
      }

      var shouldCheck = false;
      switch (botSettings.strategyType) {
        case 'eca-stacker':
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
      App.log(`${[action.order.id]}: ${action.command}`);

      switch (action.command) {
        case 'submitOrder':
        case 'editOrder':
          responses.push(await this.processAction(action));
          break;

        case 'cancelOrder':
          responses.push(await this.processAction(action));
          break;

        default:
          App.printObject(action);
          App.error(`Unknown action: ${action.command}`);
          break;
      }
    }
    return responses;
  }
}
